/**
 * sovereign.js
 *
 * Sovereign mode — pure decentralised authority. No vault, no API key, no
 * server, no network. Just the substrate:
 *
 *   root → domain → action envelope → capability → sign → verify
 *
 * Every line runs offline. Nothing here depends on AgentEnvelope's hosted
 * infrastructure, and nothing here can be revoked, throttled, or observed by
 * anyone but the holder of the root. This is the free, unstoppable substrate
 * that the vault-anchored custody example (bot.js / verifier.js) governs.
 *
 * Run: node sovereign.js
 */

import { randomBytes } from 'node:crypto';
import { signAction, verifyAction, hexToBytes } from 'agent-envelope-sdk';
import {
  createDomainInfo,
  projectDomainKey,
  buildActionEnvelope,
  deriveAgentActionCapability,
} from 'agent-envelope-sdk/avatar';

// ─── 1. The sovereign root ───────────────────────────────────────────────────
//
// In a real deployment this is derived from a seed phrase or a secure element
// and never leaves the holder. Here we generate an ephemeral one to keep the
// example self-contained. There is no issuer — this root is its own universe.

const identityRoot = Uint8Array.from(randomBytes(32));

try {
  // ─── 2. Derive a domain from the root ──────────────────────────────────────
  const domainInfo = createDomainInfo({
    namespace: 'demo',
    domainId: 'support',
    kind: 'agent',
  });
  const domain = projectDomainKey(identityRoot, domainInfo);
  console.log('Domain address :', domain.domainAddress);

  // ─── 3. Describe the exact scoped, decaying authority ──────────────────────
  const envelope = buildActionEnvelope(domain, {
    agentId: 'demo-bot',
    actionIndex: 0,
    operation: 'send',
    resources: ['thread:demo'],
    decayMode: 'NONE',
    maxUses: null,
    notBefore: null,
    notAfter: null,
  });

  // ─── 4. Derive the capability (contains private signing material) ──────────
  const capability = deriveAgentActionCapability(identityRoot, domain, envelope);
  console.log('Agent address  :', capability.agentAddress);

  // ─── 5. Sign an action with the derived seed ───────────────────────────────
  const action = {
    operation: 'send',
    resource: 'thread:demo',
    actionIndex: 0,
    payload: { text: 'hello from sovereign mode' },
    issuedAt: new Date().toISOString(),
  };
  const actionSeed = hexToBytes(capability.actionSeedHex);
  const signature = signAction(actionSeed, action);
  console.log('Signature      :', signature.slice(0, 20) + '...');

  // ─── 6. Verify offline against the capability's public address ─────────────
  const good = verifyAction({
    message: action,
    signature,
    expectedAddress: capability.agentAddress,
  });
  console.log('\nVerify (authentic):', good.valid ? '✓ valid' : `✗ ${good.reason}`);

  // A tampered action must not verify against the same signature.
  const tampered = { ...action, payload: { text: 'transfer everything' } };
  const bad = verifyAction({
    message: tampered,
    signature,
    expectedAddress: capability.agentAddress,
  });
  console.log('Verify (tampered) :', bad.valid ? '✗ UNEXPECTEDLY VALID' : `✓ rejected (${bad.reason})`);

  if (!good.valid || bad.valid) process.exit(1);
  console.log('\n✓ Sovereign authority proven end-to-end — no vault, no key, no network.');
} finally {
  identityRoot.fill(0);
}
