/**
 * bot.js
 *
 * Vault-anchored bot. Authority is anchored to the vault, not to a local root.
 *
 * The bot holds only:
 *   - AE_API_KEY          the vault-issued key that gates every hosted call
 *   - AE_BOT_KEY          its own identity signing key (NOT the vault root)
 *   - mint-delegate.json  a MintDelegate issued by the vault owner in the console
 *   - AE_MINT_MATERIAL    (optional) mint material issued out-of-band; lets the
 *                         bot derive its action capability locally after the receipt
 *
 * It proves membership by signing a MintRequest with its own key against the
 * vault-issued delegate, then mints through the hosted API. The vault verifies,
 * server-side, the delegate issuer signature, the bot signature, and every
 * policy bound (operation, resources, action index, uses, time window, replay,
 * mint count), then returns a signed receipt.
 *
 * No vault root, passphrase, local vault, or local unwrapping is involved.
 */

import { readFileSync, existsSync } from 'node:fs';
import { AgentEnvelopeClient } from 'agent-envelope-sdk/client';
import { buildMintRequest, verifyMintDelegate, mintActionCapability, signAction, verifyAction, hexToBytes } from 'agent-envelope-sdk';
import { config } from './config.js';

const API_KEY   = config.apiKey();
const VAULT_ID  = config.vaultId();
const DOMAIN_ID = config.domainId();
const BOT_ID    = config.botId();
const BOT_KEY   = config.botKey();
const MINT_MATERIAL = config.mintMaterial();

// ─── Load the vault-issued delegate ──────────────────────────────────────────
//
// The delegate is issued by the Avatar owner inside the authenticated console
// and exported to the bot. It carries no signing material — only a signed,
// bounded grant of authority. It is the vault's statement: "this bot may mint
// within these limits."

if (!existsSync('mint-delegate.json')) {
  console.error('\nmint-delegate.json not found.');
  console.error('Issue a MintDelegate for this bot in the AgentEnvelope console and place it here.');
  process.exit(1);
}
const delegate = JSON.parse(readFileSync('mint-delegate.json', 'utf8'));

// Confirm the delegate is authentic before spending a mint the vault would
// reject anyway. This checks the domain issuer signature and policy shape.
const delegateCheck = verifyMintDelegate(delegate, delegate.issuerAddress);
if (!delegateCheck.valid) {
  console.error('\nDelegate failed local verification:', delegateCheck.reason);
  process.exit(1);
}
console.log('Delegate verified. Issued by domain issuer:', delegate.issuerAddress);

// ─── Build and sign the request with the bot's OWN key ───────────────────────

function concreteResource(r) {
  if (r === '*') return 'thread:demo';
  if (r.endsWith(':*')) return r.slice(0, -1) + 'demo';
  return r;
}

const botSeed = hexToBytes(BOT_KEY);
const now = Date.now();

const request = buildMintRequest(botSeed, delegate, {
  agentId:     BOT_ID,
  operation:   delegate.allowedOperations[0],
  resources:   [concreteResource(delegate.allowedResources[0])],
  actionIndex: delegate.actionIndexPolicy.min,
  maxUses:     1,
  timeWindow:  { notBefore: now, notAfter: now + 60 * 60 * 1000 },
  nonce:       crypto.randomUUID(),
  requestedAt: new Date().toISOString(),
});
// buildMintRequest zeros botSeed internally.

// ─── Mint through the vault-anchored API ─────────────────────────────────────

console.log(`\nMinting via vault ${VAULT_ID} / domain ${DOMAIN_ID} as bot ${BOT_ID}...`);

const client = new AgentEnvelopeClient({ apiKey: API_KEY });
const receipt = await client.mint({ delegate, request });

console.log('\n--- Mint receipt ---');
console.log(JSON.stringify(receipt, null, 2));

if (!receipt || receipt.valid !== true) {
  console.error('\nMint rejected by the vault:', receipt?.reason ?? receipt?.error ?? 'unknown');
  process.exit(1);
}

console.log('\n✓ The vault authorised this bot.');

// ─── Derive the action capability locally and exercise it ────────────────
//
// The receipt carries no key material. The bot now derives the SAME action seed
// the vault expects — deterministically from the out-of-band mint material, the
// delegate, and this exact request. Nothing secret ever crossed the network.

if (!MINT_MATERIAL) {
  console.log('\n  Set AE_MINT_MATERIAL (issued out-of-band by the Avatar owner) to derive the');
  console.log('  action capability locally and sign actions. Skipping the derivation step.');
  process.exit(0);
}

const mintMaterial = hexToBytes(MINT_MATERIAL);
const capability = mintActionCapability(mintMaterial, delegate, request);
// mintActionCapability zeros mintMaterial internally.
console.log('\nDerived action capability. Agent address:', capability.agentAddress);

const action = {
  operation:   request.operation,
  resource:    request.resources[0],
  actionIndex: request.actionIndex,
  payload:     { text: 'hello from a vault-authorised bot' },
  issuedAt:    new Date().toISOString(),
};
const actionSeed = hexToBytes(capability.actionSeedHex);
const signature = signAction(actionSeed, action);
console.log('Signed action  :', signature.slice(0, 20) + '...');

const check = verifyAction({ message: action, signature, expectedAddress: capability.agentAddress });
console.log('\nVerify (authentic):', check.valid ? '✓ valid' : `✗ ${check.reason}`);

const tampered = { ...action, payload: { text: 'transfer everything' } };
const bad = verifyAction({ message: tampered, signature, expectedAddress: capability.agentAddress });
console.log('Verify (tampered) :', bad.valid ? '✗ UNEXPECTEDLY VALID' : `✓ rejected (${bad.reason})`);

if (!check.valid || bad.valid) process.exit(1);
console.log('\n✓ Mint → derive → sign → verify complete. No signing material left the bot.');
