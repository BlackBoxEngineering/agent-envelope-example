/**
 * preflight.js
 *
 * Validates all env vars required for the portal-governed flow before any
 * network call is attempted. Run automatically via `npm run bot` and `npm run demo`,
 * or manually with `npm run preflight`.
 *
 * Exits 0 if everything is ready. Exits 1 with a clear, actionable message if not.
 */

import { existsSync } from "node:fs";
import "./config.js"; // loads .env.local into process.env

const PORTAL_URL = "https://agentenvelope.io";
const AGENT_ID_RE = /^[a-zA-Z0-9_:-]{1,128}$/;
const DELEGATE_ID_RE = /^ae-delegate-[a-fA-F0-9]{16}$/;
const HEX_SEED_RE = /^(0x)?[a-fA-F0-9]{64}$/;
const HEX_MATERIAL_RE = /^(0x)?[a-fA-F0-9]{64}$/;

const issues = [];

function check(name, value, re, hint) {
  if (!value) {
    issues.push({ name, problem: "missing", hint });
  } else if (re && !re.test(value)) {
    issues.push({ name, problem: "invalid format", hint });
  }
}

const apiKey    = process.env.AE_API_KEY?.trim();
const botId     = process.env.AE_BOT_ID?.trim();
const delegateId = process.env.AE_DELEGATE_ID?.trim();
const botKey    = process.env.AE_BOT_KEY?.trim();
const mintMaterial = process.env.AE_MINT_MATERIAL?.trim();

check("AE_API_KEY",     apiKey,      null,           `Get it from ${PORTAL_URL} → Account → API keys. Shown once — store it securely.`);
check("AE_BOT_ID",      botId,       AGENT_ID_RE,    "The agent id this bot will mint for. Set it to match the agentId in your delegate's allowed scope.");
check("AE_BOT_KEY",     botKey,      HEX_SEED_RE,    `Run \`npm run portal:setup\` to generate one. The private key stays in .env.local and is never printed.`);

// AE_DELEGATE_ID is required unless mint-delegate.json is present as a fallback.
if (!delegateId && !existsSync("mint-delegate.json")) {
  issues.push({
    name: "AE_DELEGATE_ID",
    problem: "missing",
    hint: `Go to ${PORTAL_URL} → Agents, select your domain, configure a delegate, and copy the active delegate id. Or save the delegate JSON as mint-delegate.json here.`,
  });
} else if (delegateId && !DELEGATE_ID_RE.test(delegateId)) {
  issues.push({
    name: "AE_DELEGATE_ID",
    problem: "invalid format",
    hint: "Should look like ae-delegate-<16 hex chars>. Copy it from the Active delegates row on the Agents page.",
  });
}

// AE_MINT_MATERIAL is optional but warn if it looks wrong when set.
if (mintMaterial && !HEX_MATERIAL_RE.test(mintMaterial)) {
  issues.push({
    name: "AE_MINT_MATERIAL",
    problem: "invalid format",
    hint: "Should be a 32-byte hex string (64 hex chars, optionally 0x-prefixed). Copy it from the issued delegate panel in the portal.",
  });
}

if (issues.length === 0) {
  console.log("✓ Preflight passed — all required env vars are set and valid.");
  console.log(`  AE_API_KEY     : set`);
  console.log(`  AE_BOT_ID      : ${botId}`);
  console.log(`  AE_BOT_KEY     : set (private)`);
  console.log(`  AE_DELEGATE_ID : ${delegateId ?? "using mint-delegate.json"}`);
  console.log(`  AE_MINT_MATERIAL: ${mintMaterial ? "set" : "not set (local derivation disabled)"}`);
  process.exit(0);
}

console.error("\n✗ Preflight failed — fix the following before running bot.js:\n");
for (const { name, problem, hint } of issues) {
  console.error(`  ${name} — ${problem}`);
  console.error(`    → ${hint}\n`);
}
console.error(`Run \`npm run portal:setup\` first if you have not already.\n`);
process.exit(1);
