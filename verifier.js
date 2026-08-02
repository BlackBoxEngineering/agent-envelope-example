/**
 * verifier.js
 *
 * Vault-anchored verification. The verifier holds only the vault-issued API key.
 *
 * It asks the hosted API about authority that lives in the vault — it never
 * holds a local vault, a local root, or a local record. Two API-key-gated reads:
 *
 *   1. Look up the registered public record for the bot (GET authority state).
 *   2. If a signed payload is present, verify it against that record.
 *
 * There is no offline fallback here: in the vault-anchored model the vault is
 * the source of truth, and the API key is what proves you may ask it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { AgentEnvelopeClient } from 'agent-envelope-sdk/client';
import { config } from './config.js';

const API_KEY = config.apiKey();
const BOT_ID  = config.botId();

const client = new AgentEnvelopeClient({ apiKey: API_KEY });

// ─── 1. Look up the registered record via the API ────────────────────────────

console.log(`Looking up registered record for ${BOT_ID} via the vault API...`);
const record = await client.getAgent(BOT_ID);

if (!record || record.error) {
  console.error('\nLookup failed:', record?.error ?? 'no record returned');
  process.exit(1);
}
console.log('\n--- Public record ---');
console.log('agentId     :', record.agentId);
console.log('agentAddress:', record.agentAddress);
console.log('status      :', record.status);

// ─── 2. Verify a signed payload, if one is present ───────────────────────────

if (!existsSync('signed-payload.json')) {
  console.log('\nNo signed-payload.json present — record lookup only.');
  console.log('Produce a signature with a capability derived from a mint receipt to verify an action.');
  process.exit(0);
}

const { payload, signature, actionIndex, actionEnvelopeHash } = JSON.parse(
  readFileSync('signed-payload.json', 'utf8'),
);

console.log('\nVerifying the signed action via the vault API...');
const report = await client.verifyAction({
  agentId: BOT_ID,
  actionIndex,
  payload,
  signature,
  expectedActionEnvelopeHash: actionEnvelopeHash,
});

console.log('\n--- Verification report ---');
console.log(JSON.stringify(report, null, 2));

if (!report || report.valid !== true) {
  console.error('\nVerification failed:', report?.reason ?? report?.error ?? 'unknown');
  process.exit(1);
}
console.log('\n✓ Verified by the vault-anchored API.');
