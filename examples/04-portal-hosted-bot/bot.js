/**
 * bot.js
 *
 * Portal-governed bot. The bot holds no vault root, no passphrase, and no
 * domain seed. Authority comes from a MintDelegate the portal issued.
 *
 * The bot holds only:
 *   - AE_API_KEY          portal-issued API key required for hosted mint
 *   - AE_BOT_KEY          its own identity signing key (NOT the vault root)
 *   - AE_DELEGATE_ID      active delegate id from the portal Agents page, or
 *                         mint-delegate.json as a local fallback
 *   - AE_MINT_MATERIAL    (optional) mint material from the portal; lets the
 *                         bot derive its action capability locally after the receipt
 *
 * The bot proves membership by signing a MintRequest with its own key against
 * the portal-issued delegate, then mints through the hosted API. The hosted
 * verifier checks the delegate issuer signature, the bot signature, and every
 * policy bound (operation, resources, action index, uses, time window, replay,
 * mint count), then returns a signed receipt.
 *
 * The vault root lives in the browser. The portal is the governance surface.
 * The SDK is the crypto surface. Neither the vault root nor any domain seed
 * ever reaches this process.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  buildMintRequest,
  verifyMintDelegate,
  mintActionCapability,
  signAction,
  verifyAction,
  hexToBytes,
} from "agent-envelope-sdk";
import { config } from "../../shared/config.js";
import { getStoredDelegate, mint } from "../../shared/hosted.js";

const API_KEY = config.apiKey();
const BOT_ID = config.botId();
const BOT_KEY = config.botKey();
const DELEGATE_ID = config.delegateId();
const MINT_MATERIAL = config.mintMaterial();

// ─── Load the portal-issued delegate ─────────────────────────────────────────
//
// The delegate is issued from Agents inside the authenticated portal and
// exported to the bot. It carries no signing material, only a signed, bounded
// grant of authority: "this bot may mint within these limits."

async function loadDelegate() {
  if (DELEGATE_ID) {
    console.log(
      `Fetching active delegate ${DELEGATE_ID} from hosted governance...`,
    );
    return getStoredDelegate(API_KEY, DELEGATE_ID);
  }

  if (existsSync("mint-delegate.json")) {
    console.log("Loading delegate from mint-delegate.json...");
    return JSON.parse(readFileSync("mint-delegate.json", "utf8"));
  }

  console.error("\nNo delegate configured.");
  console.error(
    "Set AE_DELEGATE_ID from the Agents > Active delegates row, or place mint-delegate.json here.",
  );
  process.exit(1);
}

const delegate = await loadDelegate();

// Confirm the delegate is authentic before spending a mint the hosted API would
// reject anyway. This checks the domain issuer signature and policy shape.
const delegateCheck = verifyMintDelegate(delegate, delegate.issuerAddress);
if (!delegateCheck.valid) {
  console.error("\nDelegate failed local verification:", delegateCheck.reason);
  process.exit(1);
}
console.log(
  "Delegate verified. Issued by domain issuer:",
  delegate.issuerAddress,
);

// ─── Build and sign the request with the bot's OWN key ───────────────────────

function concreteResource(r) {
  if (r === "*") return "thread:demo";
  if (r.endsWith(":*")) return r.slice(0, -1) + "demo";
  return r;
}

const botSeed = hexToBytes(BOT_KEY);
const now = Date.now();

const request = buildMintRequest(botSeed, delegate, {
  agentId: BOT_ID,
  operation: delegate.allowedOperations[0],
  resources: [concreteResource(delegate.allowedResources[0])],
  actionIndex: delegate.actionIndexPolicy.min,
  maxUses: 1,
  timeWindow: { notBefore: now, notAfter: now + 60 * 60 * 1000 },
  nonce: crypto.randomUUID(),
  requestedAt: new Date().toISOString(),
});
// buildMintRequest zeros botSeed internally.

// ─── Mint through the hosted governance API ─────────────────────────────────

console.log(`Minting as bot ${BOT_ID}...`);

const receipt = await mint(API_KEY, delegate, request);

console.log("\n--- Mint receipt ---");
console.log(JSON.stringify(receipt, null, 2));

if (!receipt || receipt.valid !== true) {
  console.error(
    "\nMint rejected by the hosted API:",
    receipt?.reason ?? receipt?.error ?? "unknown",
  );
  process.exit(1);
}

console.log("\n✓ The hosted API authorised this bot.");

// ─── Derive the action capability locally and exercise it ────────────────
//
// The receipt carries no key material. The bot now derives the SAME action seed
// the public record expects, deterministically from the out-of-band mint material, the
// delegate, and this exact request. Nothing secret ever crossed the network.

if (!MINT_MATERIAL) {
  console.log(
    "\n  Set AE_MINT_MATERIAL (issued out-of-band from the portal) to derive the",
  );
  console.log(
    "  action capability locally and sign actions. Skipping the derivation step.",
  );
  process.exit(0);
}

const mintMaterial = hexToBytes(MINT_MATERIAL);
const capability = mintActionCapability(mintMaterial, delegate, request);
// mintActionCapability zeros mintMaterial internally.
console.log(
  "\nDerived action capability. Agent address:",
  capability.agentAddress,
);

const action = {
  operation: request.operation,
  resource: request.resources[0],
  actionIndex: request.actionIndex,
  payload: { text: "hello from a portal-authorised bot" },
  issuedAt: new Date().toISOString(),
};
const actionSeed = hexToBytes(capability.actionSeedHex);
const signature = signAction(actionSeed, action);
console.log("Signed action  :", signature.slice(0, 20) + "...");

const check = verifyAction({
  message: action,
  signature,
  expectedAddress: capability.agentAddress,
});
console.log(
  "\nVerify (authentic):",
  check.valid ? "✓ valid" : `✗ ${check.reason}`,
);

const tampered = { ...action, payload: { text: "transfer everything" } };
const bad = verifyAction({
  message: tampered,
  signature,
  expectedAddress: capability.agentAddress,
});
console.log(
  "Verify (tampered) :",
  bad.valid ? "✗ UNEXPECTEDLY VALID" : `✓ rejected (${bad.reason})`,
);

if (!check.valid || bad.valid) process.exit(1);
console.log(
  "\n✓ Mint → derive → sign → verify complete. No signing material left the bot.",
);
