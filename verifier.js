/**
 * verifier.js
 *
 * Portal-governed verification. The verifier holds only the portal-issued API key.
 *
 * That key is required because lookup and hosted verify are API-key-only Lambda
 * routes. The verifier asks the hosted API about authority registered in the portal; it never
 * holds a local vault, a local root, or a local record. Two API-key-gated reads:
 *
 *   1. Look up the registered public record for the bot.
 *   2. If a signed payload is present, verify it against that record.
 *
 * Offline verification is always available: with the SDK and a local copy of
 * the public record, verifyAction() checks the signature with no network and
 * no API key. The hosted verify route is the governance layer — it adds
 * receipts, verification events, and audit trails on top of the same check.
 */

import { readFileSync, existsSync } from "node:fs";
import { config } from "./config.js";
import { getAgentRecord, verifyAction } from "./hosted.js";

const API_KEY = config.apiKey();
const BOT_ID = config.botId();

// ─── 1. Look up the registered record via the API ────────────────────────────

console.log(`Looking up registered record for ${BOT_ID} via the hosted API...`);
const record = await getAgentRecord(API_KEY, BOT_ID);

if (!record || record.error) {
  console.error("\nLookup failed:", record?.error ?? "no record returned");
  process.exit(1);
}
console.log("\n--- Public record ---");
console.log("agentId     :", record.agentId);
console.log("agentAddress:", record.agentAddress);
console.log("status      :", record.status);

// ─── 2. Verify a signed payload, if one is present ───────────────────────────

if (!existsSync("signed-payload.json")) {
  console.log("\nNo signed-payload.json present — record lookup only.");
  console.log(
    "Produce a signature with a capability derived from a mint receipt to verify an action.",
  );
  process.exit(0);
}

const { payload, signature, actionIndex, actionEnvelopeHash } = JSON.parse(
  readFileSync("signed-payload.json", "utf8"),
);

console.log("\nVerifying the signed action via the hosted API...");
const report = await verifyAction(API_KEY, {
  agentId: BOT_ID,
  actionIndex,
  payload,
  signature,
  expectedActionEnvelopeHash: actionEnvelopeHash,
});

console.log("\n--- Verification report ---");
console.log(JSON.stringify(report, null, 2));

if (!report || report.valid !== true) {
  console.error(
    "\nVerification failed:",
    report?.reason ?? report?.error ?? "unknown",
  );
  process.exit(1);
}
console.log("\n✓ Verified by the hosted governance API.");
