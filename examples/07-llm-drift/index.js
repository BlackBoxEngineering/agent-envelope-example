/**
 * llm-drift.js — Demo: LLM agent with delegated authority
 *
 * Shows a real LLM (Bedrock Claude) operating under delegated authority.
 * The authority head (vault) issues a MintDelegate scoped to specific operations.
 * The bot must check authority before executing any tool call.
 *
 * Two modes:
 *
 *   Ephemeral mode (default):
 *     node llm-drift.js --mock
 *     Generates random keys, no account needed. Shows the concept.
 *
 *   Portal mode (uses your real vault):
 *     node llm-drift.js --portal
 *     Loads AE_DELEGATE_ID and AE_MINT_MATERIAL from .env.local.
 *     Authority traces back to your browser-held vault.
 *
 * Flow:
 *   1. Authority head issues delegate + mint material (out-of-band)
 *   2. Bot receives delegate, derives capability for allowed operations
 *   3. LLM makes tool calls
 *   4. Bot checks each call against its delegated authority
 *   5. Allowed calls get signed; disallowed calls are blocked
 */

import { randomBytes } from 'node:crypto'
import { config } from '../../shared/config.js'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import {
  seedAddress,
  buildMintDelegate,
  verifyMintDelegate,
  buildMintRequest,
  verifyMintRequest,
  mintActionCapability,
  deriveMintMaterial,
  canonicalJSON,
  signAction,
  verifyAction,
  hexToBytes,
} from 'agent-envelope-sdk'
import {
  createDomainInfo,
  projectDomainKey,
} from 'agent-envelope-sdk/avatar'

// ─── Config ──────────────────────────────────────────────────────────────────

const USE_PORTAL = process.argv.includes('--portal')

// ─── Tool definitions (what the LLM sees) ────────────────────────────────────

const tools = [
  {
    name: 'read_thread',
    description: 'Read messages from a support thread. Returns the conversation history.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The thread ID to read' },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to a support thread. Use this to reply to customers.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The thread ID to send to' },
        message: { type: 'string', description: 'The message content' },
      },
      required: ['threadId', 'message'],
    },
  },
  {
    name: 'issue_refund',
    description: 'Issue a refund to a customer. Requires order ID and amount.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The order ID to refund' },
        amount: { type: 'number', description: 'Refund amount in dollars' },
      },
      required: ['orderId', 'amount'],
    },
  },
]

// ─── Ephemeral authority (no account needed) ─────────────────────────────────

function setupEphemeralAuthority() {
  const vaultRoot = Uint8Array.from(randomBytes(32))
  const botSeed = Uint8Array.from(randomBytes(32))

  const domainInfo = createDomainInfo({
    namespace: 'demo',
    domainId: 'support',
    kind: 'communication',
  })
  const domain = projectDomainKey(vaultRoot, domainInfo)

  const botAddress = seedAddress(botSeed)
  const mintMaterial = deriveMintMaterial(vaultRoot, domain)

  // Re-derive domain seed for buildMintDelegate (it zeros the input)
  const SALT = new TextEncoder().encode('agentenvelope-v1')
  const domainSeed = hkdf(
    sha256,
    vaultRoot,
    SALT,
    new TextEncoder().encode(canonicalJSON({ purpose: 'domain', domainInfo })),
    32,
  )

  const now = Date.now()
  const delegate = buildMintDelegate(domainSeed, {
    domainHash: domain.domainHash,
    // ONLY read-thread allowed — no send-message, no issue-refund
    allowedOperations: ['read-thread'],
    allowedResources: ['thread:*'],
    botPolicy: 'address-set',
    allowedBotAddresses: [botAddress],
    actionIndexPolicy: { min: 0, max: 99 },
    maxMints: 100,
    maxUsesPerAction: 10,
    timeWindow: { notBefore: now, notAfter: now + 60 * 60 * 1000 },
    nonce: '0x' + Buffer.from(randomBytes(32)).toString('hex'),
    issuedAt: new Date().toISOString(),
  })

  vaultRoot.fill(0)

  return {
    mode: 'ephemeral',
    delegate,
    mintMaterial,
    botSeed,
    botAddress,
    domain,
  }
}

// ─── Portal authority (uses your real vault) ─────────────────────────────────

async function setupPortalAuthority() {
  const API_KEY = config.apiKey()
  const DELEGATE_ID = config.delegateId()
  const MINT_MATERIAL_HEX = config.mintMaterial()
  const BOT_KEY = config.botKey()

  if (!API_KEY || !DELEGATE_ID || !MINT_MATERIAL_HEX || !BOT_KEY) {
    console.error('\nPortal mode requires:')
    console.error('  AE_API_KEY        — portal-issued API key')
    console.error('  AE_DELEGATE_ID    — active delegate id from Agents')
    console.error('  AE_MINT_MATERIAL  — 32-byte mint material (0x hex)')
    console.error('  AE_BOT_KEY        — bot identity key (0x hex)')
    console.error('\nSet these in .env.local or run without --portal for ephemeral mode.')
    process.exit(1)
  }

  // Fetch delegate from hosted API
  const API_BASE = 'https://jemdjwteae.execute-api.us-east-1.amazonaws.com/v1'
  const res = await fetch(`${API_BASE}/sovereign/delegates/${DELEGATE_ID}`, {
    headers: { 'x-api-key': API_KEY },
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`\nFailed to fetch delegate: ${res.status} ${text}`)
    process.exit(1)
  }

  const body = await res.json()
  const delegate = body.delegate ?? body

  // Verify delegate locally
  const check = verifyMintDelegate(delegate, delegate.issuerAddress)
  if (!check.valid) {
    console.error(`\nDelegate failed verification: ${check.reason}`)
    process.exit(1)
  }

  const botSeed = hexToBytes(BOT_KEY)
  const botAddress = seedAddress(botSeed)
  const mintMaterial = hexToBytes(MINT_MATERIAL_HEX)

  return {
    mode: 'portal',
    delegate,
    mintMaterial,
    botSeed,
    botAddress,
    issuerAddress: delegate.issuerAddress,
  }
}

// ─── Bot: authority-gated agent ──────────────────────────────────────────────

class AuthorityGatedBot {
  constructor({ delegate, mintMaterial, botSeed, botAddress }) {
    this.delegate = delegate
    this.mintMaterial = Uint8Array.from(mintMaterial)
    this.botSeed = Uint8Array.from(botSeed)
    this.botAddress = botAddress
    this.actionIndex = delegate.actionIndexPolicy?.min ?? 0
  }

  // Check if an operation is allowed by the delegate
  checkAuthority(operation, resources) {
    // Check operation
    if (!this.delegate.allowedOperations.includes(operation)) {
      return {
        allowed: false,
        reason: `Operation '${operation}' not in delegate. Allowed: ${this.delegate.allowedOperations.join(', ')}`,
      }
    }

    // Check resources against delegate policy
    for (const resource of resources) {
      const prefix = resource.split(':')[0]
      const allowed = this.delegate.allowedResources.some(
        r => r === resource || r === `${prefix}:*` || r === '*'
      )
      if (!allowed) {
        return {
          allowed: false,
          reason: `Resource '${resource}' not allowed. Policy: ${this.delegate.allowedResources.join(', ')}`,
        }
      }
    }

    // Check time window
    const now = Date.now()
    const { notBefore, notAfter } = this.delegate.timeWindow
    if (notBefore && now < notBefore) {
      return { allowed: false, reason: 'Delegate not yet active' }
    }
    if (notAfter && now > notAfter) {
      return { allowed: false, reason: 'Delegate expired' }
    }

    return { allowed: true }
  }

  // Mint a capability for an allowed operation
  mintCapability(operation, resources) {
    const check = this.checkAuthority(operation, resources)
    if (!check.allowed) {
      return { success: false, reason: check.reason }
    }

    // Build mint request
    const now = Date.now()
    const request = buildMintRequest(Uint8Array.from(this.botSeed), this.delegate, {
      agentId: `llm-bot-${operation}`,
      operation,
      resources,
      actionIndex: this.actionIndex++,
      maxUses: 1,
      timeWindow: { notBefore: now, notAfter: now + 5 * 60 * 1000 },
      nonce: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
      ...(this.delegate.legitimacyRef?.legitimacyId ? { legitimacyId: this.delegate.legitimacyRef.legitimacyId } : {}),
    })

    // Verify request against delegate
    const requestCheck = verifyMintRequest(request, this.delegate)
    if (!requestCheck.valid) {
      return { success: false, reason: `Request rejected: ${requestCheck.reason}` }
    }

    // Derive capability from mint material
    const capability = mintActionCapability(
      Uint8Array.from(this.mintMaterial),
      this.delegate,
      request
    )

    return { success: true, capability, request }
  }

  // Execute a tool call with authority check
  executeToolCall(toolName, toolInput) {
    // Map tool names to operations and resources
    const toolMap = {
      read_thread: {
        operation: 'read-thread',
        resources: (input) => [`thread:${input.threadId}`],
      },
      send_message: {
        operation: 'send-message',
        resources: (input) => [`thread:${input.threadId}`],
      },
      issue_refund: {
        operation: 'issue-refund',
        resources: (input) => [`order:${input.orderId}`],
      },
    }

    const mapping = toolMap[toolName]
    if (!mapping) {
      return { executed: false, reason: `Unknown tool: ${toolName}` }
    }

    const operation = mapping.operation
    const resources = mapping.resources(toolInput)

    // Step 1: Check authority
    const authCheck = this.checkAuthority(operation, resources)
    if (!authCheck.allowed) {
      return {
        executed: false,
        blocked: true,
        reason: authCheck.reason,
        stage: 'authority_check',
      }
    }

    // Step 2: Mint capability
    const mintResult = this.mintCapability(operation, resources)
    if (!mintResult.success) {
      return {
        executed: false,
        blocked: true,
        reason: mintResult.reason,
        stage: 'mint_capability',
      }
    }

    // Step 3: Sign the action
    const action = {
      operation,
      resources,
      toolName,
      toolInput,
      timestamp: new Date().toISOString(),
    }
    const actionSeed = hexToBytes(mintResult.capability.actionSeedHex)
    const signature = signAction(actionSeed, action)

    // Step 4: Verify (proves the signature is valid)
    const verification = verifyAction({
      message: action,
      signature,
      expectedAddress: mintResult.capability.agentAddress,
    })

    if (!verification.valid) {
      return {
        executed: false,
        reason: `Signature verification failed: ${verification.reason}`,
        stage: 'verify_signature',
      }
    }

    // Step 5: Execute (simulated)
    return {
      executed: true,
      action,
      signature: signature.slice(0, 20) + '...',
      agentAddress: mintResult.capability.agentAddress,
      stage: 'executed',
    }
  }
}

// ─── Bedrock client (or mock) ────────────────────────────────────────────────

async function converse({ modelId, system, messages, tools }) {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

  const response = await client.send(new ConverseCommand({
    modelId,
    messages,
    ...(system && { system: [{ text: system }] }),
    ...(tools && {
      toolConfig: {
        tools: tools.map(t => ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.inputSchema },
          },
        })),
      },
    }),
  }))

  return response
}

// ─── Demo runner ─────────────────────────────────────────────────────────────

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
const SYSTEM_PROMPT = `You are a support agent. You have three tools available:
- read_thread: Read a support thread
- send_message: Send a message to a thread  
- issue_refund: Process a refund

When helping customers, use ALL relevant tools. For refund requests, read the thread, send a confirmation, AND process the refund.`

async function runDemo() {
  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log('║  AgentEnvelope Demo: LLM with Delegated Authority               ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝')
  console.log()

  // 1. Setup authority
  console.log('1. Authority setup')
  console.log('   ─────────────────────────────────────────────────────────────')

  let authority
  if (USE_PORTAL) {
    console.log('   Mode: PORTAL (using your real vault)')
    authority = await setupPortalAuthority()
    console.log(`   ✓ Delegate fetched: ${authority.delegate.delegateId}`)
    console.log(`   ✓ Issuer (your domain): ${authority.issuerAddress}`)
  } else {
    console.log('   Mode: EPHEMERAL (random keys, no account)')
    authority = setupEphemeralAuthority()
    console.log(`   ✓ Delegate issued: ${authority.delegate.delegateId}`)
  }

  console.log(`   Bot address:        ${authority.botAddress}`)
  console.log(`   Allowed operations: ${authority.delegate.allowedOperations.join(', ')}`)
  console.log(`   Allowed resources:  ${authority.delegate.allowedResources.join(', ')}`)
  console.log()

  // 2. Bot receives delegate out-of-band
  console.log('2. Bot initialized with delegated authority')
  console.log('   ─────────────────────────────────────────────────────────────')
  const bot = new AuthorityGatedBot({
    delegate: authority.delegate,
    mintMaterial: authority.mintMaterial,
    botSeed: authority.botSeed,
    botAddress: authority.botAddress,
  })
  console.log('   ✓ Delegate + mint material received (out-of-band)')
  console.log('   ✓ Bot can only mint capabilities the delegate allows')
  console.log()

  // 3. User prompt
  const userPrompt = 'A customer in thread customer-123 is asking for a refund on order ORD-456 for $99.99. Please help them.'
  console.log('3. User prompt')
  console.log('   ─────────────────────────────────────────────────────────────')
  console.log(`   "${userPrompt}"`)
  console.log()

  // 4. Multi-turn agent loop
  console.log('4. Agent loop (LLM ↔ Bot)')
  console.log('   ═════════════════════════════════════════════════════════════')

  const messages = [{ role: 'user', content: [{ text: userPrompt }] }]
  const allResults = []
  let turn = 0
  const maxTurns = 5

  while (turn < maxTurns) {
    turn++
    console.log()
    console.log(`   ┌─ Turn ${turn} ─────────────────────────────────────────────────┐`)

    // LLM generates response
    const response = await converse({
      modelId: MODEL_ID,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    })

    const assistantMessage = response.output.message
    messages.push(assistantMessage)

    // Show LLM's text response
    const textContent = assistantMessage.content.find(c => c.text)
    if (textContent) {
      console.log()
      console.log(`   LLM: "${textContent.text}"`)
    }

    // Check if LLM is done (no tool calls)
    const toolCalls = assistantMessage.content.filter(c => c.toolUse)
    if (toolCalls.length === 0) {
      console.log()
      console.log('   └─ LLM finished (no more tool calls) ─────────────────────────┘')
      break
    }

    // Execute each tool call through the authority gate
    console.log()
    console.log('   Bot executes tool calls:')
    const toolResults = []

    for (const { toolUse } of toolCalls) {
      console.log()
      console.log(`     Tool: ${toolUse.name}`)
      console.log(`     Input: ${JSON.stringify(toolUse.input)}`)

      const result = bot.executeToolCall(toolUse.name, toolUse.input)
      allResults.push({ tool: toolUse.name, result })

      let toolResultContent
      if (result.executed) {
        console.log(`     ✓ EXECUTED (signed by ${result.agentAddress.slice(0, 10)}...)`)
        // Simulate actual tool output
        if (toolUse.name === 'read_thread') {
          toolResultContent = JSON.stringify({
            threadId: toolUse.input.threadId,
            messages: [
              { from: 'customer', text: 'Hi, I need a refund for order ORD-456. I was charged $99.99 but never received the item.' },
              { from: 'customer', text: 'Can you please help?' },
            ],
          })
        } else {
          toolResultContent = JSON.stringify({ success: true })
        }
      } else {
        console.log(`     ✗ BLOCKED: ${result.reason}`)
        toolResultContent = JSON.stringify({
          error: 'AUTHORITY_DENIED',
          message: result.reason,
        })
      }

      toolResults.push({
        toolResult: {
          toolUseId: toolUse.toolUseId,
          content: [{ json: JSON.parse(toolResultContent) }],
        },
      })
    }

    // Send tool results back to LLM
    messages.push({ role: 'user', content: toolResults })
    console.log()
    console.log('   └─ Tool results sent back to LLM ────────────────────────────┘')
  }

  // 5. Summary
  console.log()
  console.log('5. Summary')
  console.log('   ─────────────────────────────────────────────────────────────')
  const executed = allResults.filter(r => r.result.executed)
  const blocked = allResults.filter(r => !r.result.executed)
  console.log(`   Total turns:  ${turn}`)
  console.log(`   Executed:     ${executed.length} (${executed.map(r => r.tool).join(', ') || 'none'})`)
  console.log(`   Blocked:      ${blocked.length} (${blocked.map(r => r.tool).join(', ') || 'none'})`)
  console.log()
  console.log('   ┌─────────────────────────────────────────────────────────────┐')
  console.log('   │ The LLM tried to exceed its authority.                     │')
  console.log('   │ The bot blocked unauthorized operations.                   │')
  console.log('   │ The LLM saw the errors and adapted its response.           │')
  console.log('   │ Authority is cryptographic, not prompt-based.              │')
  console.log('   └─────────────────────────────────────────────────────────────┘')
  console.log()
}

runDemo().catch(console.error)
