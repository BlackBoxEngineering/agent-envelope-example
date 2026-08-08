/**
 * vault-delegate.js
 *
 * Vault head → delegate → bot → process. Fully offline, no portal, no API key.
 *
 * The vault holder derives a domain, issues a MintDelegate scoped to one bot
 * and one operation, and hands the delegate + mint material to the bot. The bot
 * signs a MintRequest with its own key, derives its action capability locally,
 * signs an action, and the verifier checks it — all without any network call.
 *
 * This is the sovereign version of the portal-governed bot.js flow. The portal
 * replaces the vault-head section below; everything else is identical.
 *
 * Run: node vault-delegate.js
 */

import { randomBytes } from "node:crypto";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
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
} from "agent-envelope-sdk";
import {
  createDomainInfo,
  projectDomainKey,
} from "agent-envelope-sdk/avatar";

// ─── 1. Vault head: derive a domain ─────────────────────────────────────────
//
// In production the vault root comes from a seed phrase or secure element and
// never leaves the holder. Here we generate an ephemeral one.

const vaultRoot = Uint8Array.from(randomBytes(32));
const botSeed = Uint8Array.from(randomBytes(32));   // bot's own identity key

try {
  const domainInfo = createDomainInfo({
    namespace: "demo",
    domainId: "support",
    kind: "agent",
  });
  const domain = projectDomainKey(vaultRoot, domainInfo);
  console.log("Vault domain   :", domain.domainAddress);

  // The bot's public address — derived from its own key, not the vault.
  const botAddress = seedAddress(botSeed);
  console.log("Bot address    :", botAddress);

  // ─── 2. Vault head: issue a MintDelegate scoped to this bot ───────────────
  //
  // domainSeed is consumed (zeroed) by buildMintDelegate. We derive it inline
  // from the vault root so the vault root itself is never passed to the SDK
  // function that zeros its input.
  //
  // deriveMintMaterial gives the bot the material it needs to derive the same
  // action seed the delegate authorises — without ever seeing the vault root.

  const mintMaterial = deriveMintMaterial(vaultRoot, domain);

  // ── Derive domain seed (mirrors avatar.js _deriveDomainSeed) ──────────────
  // projectDomainKey zeroes the domain seed internally, so we re-derive it
  // here using the same HKDF path the SDK uses. The vault root never leaves
  // this process.
  const SALT = new TextEncoder().encode("agentenvelope-v1");
  const domainSeed = hkdf(
    sha256,
    vaultRoot,
    SALT,
    new TextEncoder().encode(canonicalJSON({ purpose: "domain", domainInfo })),
    32,
  );
  // buildMintDelegate zeros domainSeed.
  const now = Date.now();
  const delegate = buildMintDelegate(domainSeed, {
    domainHash: domain.domainHash,
    allowedOperations: ["send-message"],
    allowedResources: ["thread:*"],
    botPolicy: "address-set",
    allowedBotAddresses: [botAddress],
    actionIndexPolicy: { min: 0, max: 9 },
    maxMints: 10,
    maxUsesPerAction: 1,
    timeWindow: { notBefore: now, notAfter: now + 60 * 60 * 1000 },
    nonce: "0x" + Buffer.from(randomBytes(32)).toString("hex"),
    issuedAt: new Date().toISOString(),
  });
  console.log("\nDelegate issued:", delegate.delegateId);
  console.log("Issuer address :", delegate.issuerAddress);

  // Vault head hands `delegate` and `mintMaterial` to the bot out-of-band.
  // mintMaterial is private — treat it like a key.

  // ─── 3. Bot: verify the delegate, build a request, derive capability ───────

  const delegateCheck = verifyMintDelegate(delegate, delegate.issuerAddress);
  if (!delegateCheck.valid) throw new Error(`Delegate invalid: ${delegateCheck.reason}`);
  console.log("\n✓ Bot verified the delegate.");

  const request = buildMintRequest(botSeed, delegate, {
    agentId: "support-bot",
    operation: "send-message",
    resources: ["thread:customer-42"],
    actionIndex: 0,
    maxUses: 1,
    timeWindow: { notBefore: now, notAfter: now + 60 * 60 * 1000 },
    nonce: "0x" + Buffer.from(randomBytes(32)).toString("hex"),
    requestedAt: new Date().toISOString(),
  });
  // buildMintRequest zeros botSeed.

  const requestCheck = verifyMintRequest(request, delegate);
  if (!requestCheck.valid) throw new Error(`Request invalid: ${requestCheck.reason}`);
  console.log("✓ Bot's request verified against the delegate.");

  // Derive the action capability from the mint material the vault head issued.
  const capability = mintActionCapability(mintMaterial, delegate, request);
  // mintActionCapability zeros mintMaterial.
  console.log("Agent address  :", capability.agentAddress);

  // ─── 4. Bot: sign an action ───────────────────────────────────────────────

  const action = {
    operation: "send-message",
    resource: "thread:customer-42",
    actionIndex: 0,
    payload: { text: "hello from a vault-delegated bot" },
    issuedAt: new Date().toISOString(),
  };
  const actionSeed = hexToBytes(capability.actionSeedHex);
  const signature = signAction(actionSeed, action);
  console.log("\nSignature      :", signature.slice(0, 20) + "...");

  // ─── 5. Verifier: check the signature offline ─────────────────────────────

  const good = verifyAction({ message: action, signature, expectedAddress: capability.agentAddress });
  console.log("\nVerify (authentic):", good.valid ? "✓ valid" : `✗ ${good.reason}`);

  const tampered = { ...action, payload: { text: "transfer everything" } };
  const bad = verifyAction({ message: tampered, signature, expectedAddress: capability.agentAddress });
  console.log("Verify (tampered) :", bad.valid ? "✗ UNEXPECTEDLY VALID" : `✓ rejected (${bad.reason})`);

  if (!good.valid || bad.valid) process.exit(1);
  console.log("\n✓ Vault head → delegate → bot → sign → verify complete. No vault root left the head.");
} finally {
  vaultRoot.fill(0);
}
