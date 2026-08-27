/**
 * multi-agent.js — Multi-agent workflow with separate authority
 *
 * Three bots, three delegates, one LLM orchestrating:
 *
 *   OpsBot      — can only read-thread
 *   FinanceBot  — can only issue-refund
 *   MsgBot      — can only send-message
 *
 * The LLM decides which tools to call. Each bot checks its own authority.
 * Cross-boundary calls are blocked even if the LLM tries to route them wrong.
 */

import { randomBytes } from 'node:crypto'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import {
  seedAddress,
  buildMintDelegate,
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

// ─── Bedrock client ──────────────────────────────────────────────────────────

async function converse({ modelId, system, messages, tools }) {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

  return client.send(new ConverseCommand({
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
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const tools = [
  {
    name: 'ops_read_thread',
    description: 'Read messages from a support thread. Routed to OpsBot.',
    inputSchema: {
      type: 'object',
      properties: { threadId: { type: 'string' } },
      required: ['threadId'],
    },
  },
  {
    name: 'finance_issue_refund',
    description: 'Issue a refund. Routed to FinanceBot.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['orderId', 'amount'],
    },
  },
  {
    name: 'msg_send_message',
    description: 'Send a message to a thread. Routed to MsgBot.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['threadId', 'message'],
    },
  },
]

// ─── Authority-gated bot ─────────────────────────────────────────────────────

class Bot {
  constructor({ name, delegate, mintMaterial, botSeed, botAddress }) {
    this.name = name
    this.delegate = delegate
    this.mintMaterial = Uint8Array.from(mintMaterial)
    this.botSeed = Uint8Array.from(botSeed)
    this.botAddress = botAddress
    this.actionIndex = delegate.actionIndexPolicy?.min ?? 0
  }

  canExecute(operation) {
    return this.delegate.allowedOperations.includes(operation)
  }

  execute(operation, resources, payload) {
    if (!this.canExecute(operation)) {
      return {
        executed: false,
        reason: `${this.name} cannot '${operation}'. Allowed: ${this.delegate.allowedOperations.join(', ')}`,
      }
    }

    // Mint capability
    const now = Date.now()
    const request = buildMintRequest(Uint8Array.from(this.botSeed), this.delegate, {
      agentId: `${this.name.toLowerCase()}-${operation}`,
      operation,
      resources,
      actionIndex: this.actionIndex++,
      maxUses: 1,
      timeWindow: { notBefore: now, notAfter: now + 5 * 60 * 1000 },
      nonce: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
    })

    const check = verifyMintRequest(request, this.delegate)
    if (!check.valid) {
      return { executed: false, reason: `Mint rejected: ${check.reason}` }
    }

    const capability = mintActionCapability(
      Uint8Array.from(this.mintMaterial),
      this.delegate,
      request
    )

    // Sign
    const action = { operation, resources, payload, timestamp: new Date().toISOString() }
    const actionSeed = hexToBytes(capability.actionSeedHex)
    const signature = signAction(actionSeed, action)

    // Verify
    const verification = verifyAction({
      message: action,
      signature,
      expectedAddress: capability.agentAddress,
    })

    if (!verification.valid) {
      return { executed: false, reason: 'Signature verification failed' }
    }

    return {
      executed: true,
      bot: this.name,
      operation,
      agentAddress: capability.agentAddress,
      signature: signature.slice(0, 20) + '...',
    }
  }
}

// ─── Create a bot with its own delegate ──────────────────────────────────────

function createBot(vaultRoot, name, allowedOperations, allowedResources) {
  const domainInfo = createDomainInfo({
    namespace: 'multi-agent-demo',
    domainId: name.toLowerCase(),
    kind: 'agent',
  })
  const domain = projectDomainKey(vaultRoot, domainInfo)
  const botSeed = Uint8Array.from(randomBytes(32))
  const botAddress = seedAddress(botSeed)
  const mintMaterial = deriveMintMaterial(vaultRoot, domain)

  // Re-derive domain seed for delegate
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
    allowedOperations,
    allowedResources,
    botPolicy: 'address-set',
    allowedBotAddresses: [botAddress],
    actionIndexPolicy: { min: 0, max: 999 },
    maxMints: 100,
    maxUsesPerAction: 10,
    timeWindow: { notBefore: now, notAfter: now + 60 * 60 * 1000 },
    nonce: '0x' + Buffer.from(randomBytes(32)).toString('hex'),
    issuedAt: new Date().toISOString(),
  })

  return new Bot({ name, delegate, mintMaterial, botSeed, botAddress })
}

// ─── Tool router ─────────────────────────────────────────────────────────────

function routeToolCall(bots, toolName, toolInput) {
  const routing = {
    ops_read_thread: {
      bot: 'OpsBot',
      operation: 'read-thread',
      resources: (input) => [`thread:${input.threadId}`],
    },
    finance_issue_refund: {
      bot: 'FinanceBot',
      operation: 'issue-refund',
      resources: (input) => [`order:${input.orderId}`],
    },
    msg_send_message: {
      bot: 'MsgBot',
      operation: 'send-message',
      resources: (input) => [`thread:${input.threadId}`],
    },
  }

  const route = routing[toolName]
  if (!route) {
    return { executed: false, reason: `Unknown tool: ${toolName}` }
  }

  const bot = bots[route.bot]
  if (!bot) {
    return { executed: false, reason: `Bot not found: ${route.bot}` }
  }

  return bot.execute(route.operation, route.resources(toolInput), toolInput)
}

// ─── Simulated tool outputs ──────────────────────────────────────────────────

function simulateToolOutput(toolName, toolInput, result) {
  if (!result.executed) {
    return { error: 'AUTHORITY_DENIED', message: result.reason }
  }

  if (toolName === 'ops_read_thread') {
    return {
      threadId: toolInput.threadId,
      messages: [
        { from: 'customer', text: 'Hi, I need a refund for order ORD-456. Charged $99.99, never received it.' },
        { from: 'customer', text: 'Please help!' },
      ],
    }
  }
  if (toolName === 'finance_issue_refund') {
    return { success: true, refundId: 'REF-' + Date.now(), amount: toolInput.amount }
  }
  if (toolName === 'msg_send_message') {
    return { success: true, messageId: 'MSG-' + Date.now() }
  }
  return { success: true }
}

// ─── Demo ────────────────────────────────────────────────────────────────────

const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'

const SYSTEM_PROMPT = `You are a support coordinator with access to three specialized bots:

- ops_read_thread: Read support threads (OpsBot)
- finance_issue_refund: Process refunds (FinanceBot)  
- msg_send_message: Send messages to customers (MsgBot)

Each bot has LIMITED authority. Use the right bot for each task.
For a refund request: read the thread, process the refund, then confirm with the customer.`

async function runDemo() {
  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log('║  Multi-Agent Workflow: Three Bots, Three Authorities            ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝')
  console.log()

  // 1. Setup — one vault, three domains, three bots
  console.log('1. Authority setup (one vault, three delegates)')
  console.log('   ─────────────────────────────────────────────────────────────')
  
  const vaultRoot = Uint8Array.from(randomBytes(32))

  const bots = {
    OpsBot: createBot(vaultRoot, 'OpsBot', ['read-thread'], ['thread:*']),
    FinanceBot: createBot(vaultRoot, 'FinanceBot', ['issue-refund'], ['order:*']),
    MsgBot: createBot(vaultRoot, 'MsgBot', ['send-message'], ['thread:*']),
  }

  // Zero the vault root — bots only have their delegates
  vaultRoot.fill(0)

  for (const [name, bot] of Object.entries(bots)) {
    console.log()
    console.log(`   ${name}`)
    console.log(`     Address:    ${bot.botAddress}`)
    console.log(`     Operations: ${bot.delegate.allowedOperations.join(', ')}`)
    console.log(`     Resources:  ${bot.delegate.allowedResources.join(', ')}`)
  }
  console.log()

  // 2. User prompt
  const userPrompt = 'Customer in thread customer-123 wants a refund for order ORD-456 ($99.99). Handle it completely.'
  console.log('2. User prompt')
  console.log('   ─────────────────────────────────────────────────────────────')
  console.log(`   "${userPrompt}"`)
  console.log()

  // 3. Agent loop
  console.log('3. Agent loop (LLM → Bots)')
  console.log('   ═════════════════════════════════════════════════════════════')

  const messages = [{ role: 'user', content: [{ text: userPrompt }] }]
  const allResults = []
  let turn = 0

  while (turn < 5) {
    turn++
    console.log()
    console.log(`   ┌─ Turn ${turn} ─────────────────────────────────────────────────┐`)

    const response = await converse({
      modelId: MODEL_ID,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    })

    const assistantMessage = response.output.message
    messages.push(assistantMessage)

    const textContent = assistantMessage.content.find(c => c.text)
    if (textContent) {
      console.log()
      console.log(`   LLM: "${textContent.text}"`)
    }

    const toolCalls = assistantMessage.content.filter(c => c.toolUse)
    if (toolCalls.length === 0) {
      console.log()
      console.log('   └─ LLM finished ─────────────────────────────────────────────┘')
      break
    }

    console.log()
    console.log('   Tool calls routed to bots:')
    const toolResults = []

    for (const { toolUse } of toolCalls) {
      console.log()
      const routeMap = {
        ops_read_thread: 'OpsBot',
        finance_issue_refund: 'FinanceBot',
        msg_send_message: 'MsgBot',
      }
      console.log(`     ${toolUse.name} → ${routeMap[toolUse.name] || 'Unknown'}`)
      console.log(`     Input: ${JSON.stringify(toolUse.input)}`)

      const result = routeToolCall(bots, toolUse.name, toolUse.input)
      allResults.push({ tool: toolUse.name, result })

      if (result.executed) {
        console.log(`     ✓ ${result.bot} EXECUTED (${result.agentAddress.slice(0, 10)}...)`)
      } else {
        console.log(`     ✗ BLOCKED: ${result.reason}`)
      }

      const output = simulateToolOutput(toolUse.name, toolUse.input, result)
      toolResults.push({
        toolResult: {
          toolUseId: toolUse.toolUseId,
          content: [{ json: output }],
        },
      })
    }

    messages.push({ role: 'user', content: toolResults })
    console.log()
    console.log('   └─ Results sent back to LLM ────────────────────────────────┘')
  }

  // 4. Summary
  console.log()
  console.log('4. Summary')
  console.log('   ─────────────────────────────────────────────────────────────')
  
  const byBot = {}
  for (const { tool, result } of allResults) {
    const botName = result.bot || 'BLOCKED'
    byBot[botName] = byBot[botName] || []
    byBot[botName].push({ tool, executed: result.executed })
  }

  for (const [bot, calls] of Object.entries(byBot)) {
    const executed = calls.filter(c => c.executed).length
    const blocked = calls.filter(c => !c.executed).length
    console.log(`   ${bot}: ${executed} executed, ${blocked} blocked`)
  }

  console.log()
  console.log('   ┌─────────────────────────────────────────────────────────────┐')
  console.log('   │ Three bots, three separate authorities.                    │')
  console.log('   │ Each bot can only do what its delegate allows.             │')
  console.log('   │ The LLM orchestrates; the bots enforce boundaries.         │')
  console.log('   └─────────────────────────────────────────────────────────────┘')
  console.log()
}

runDemo().catch(console.error)
