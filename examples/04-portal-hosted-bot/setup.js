/**
 * portal-setup.js
 *
 * Local setup helper for the portal-governed example.
 * It never prints private key material. It can:
 *   - confirm AE_API_KEY reaches the hosted API
 *   - generate AE_BOT_KEY locally if missing
 *   - print the public bot address to paste into the portal delegate policy
 *
 * AE_BOT_KEY is local on purpose: it is the runtime bot's private identity key,
 * not a portal output and not the vault root. The portal issues delegates; the
 * bot keeps its own signing identity and proves itself with mint requests.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hexToBytes, seedAddress } from "agent-envelope-sdk";

const ENV_PATH = ".env.local";
const HOSTED_API_BASE =
  "https://jemdjwteae.execute-api.us-east-1.amazonaws.com/v1";
const ORDER = [
  "AE_API_KEY",
  "AE_BOT_ID",
  "AE_DELEGATE_ID",
  "AE_BOT_KEY",
  "AE_MINT_MATERIAL",
];

function readEnvFile() {
  const values = new Map();
  if (!existsSync(ENV_PATH)) return values;

  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function writeEnvFile(values) {
  const known = ORDER.map((key) => `${key}=${values.get(key) ?? ""}`);
  const extra = [...values.entries()]
    .filter(([key]) => !ORDER.includes(key))
    .map(([key, value]) => `${key}=${value}`);

  writeFileSync(ENV_PATH, [...known, ...extra, ""].join("\n"));
}

function requireValue(values, key, hint) {
  const value = values.get(key)?.trim();
  if (!value) {
    console.error(`Missing ${key}. ${hint}`);
    process.exit(1);
  }
  return value;
}

function ensureHexSeed(value, label) {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  try {
    const bytes = hexToBytes(normalized);
    if (bytes.length !== 32) throw new Error("expected 32 bytes");
    return normalized;
  } catch (err) {
    console.error(`${label} must be a 32-byte hex seed.`);
    console.error(err instanceof Error ? err.message : "invalid hex seed");
    process.exit(1);
  }
}

async function smokeTestApiKey(apiKey) {
  const response = await fetch(`${HOSTED_API_BASE}/sovereign/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({
      agentId: "ae_setup_smoke_missing_agent",
      actionIndex: 0,
      payload: {},
      signature: `0x${"00".repeat(65)}`,
    }),
  });

  let result;
  try {
    result = await response.json();
  } catch {
    result = { message: await response.text() };
  }

  if (
    response.status === 403 ||
    result?.message === "Forbidden" ||
    result?.message === "Missing Authentication Token"
  ) {
    throw new Error(result?.message ?? `HTTP ${response.status}`);
  }

  return true;
}

const values = readEnvFile();
const apiKey = requireValue(
  values,
  "AE_API_KEY",
  "Set it from Account > API keys in the portal.",
);

let botKey = values.get("AE_BOT_KEY")?.trim();
if (!botKey) {
  botKey = `0x${randomBytes(32).toString("hex")}`;
  values.set("AE_BOT_KEY", botKey);
  writeEnvFile(values);
  console.log(
    "Generated AE_BOT_KEY and stored it in .env.local. The private key was not printed.",
  );
} else {
  botKey = ensureHexSeed(botKey, "AE_BOT_KEY");
  values.set("AE_BOT_KEY", botKey);
  writeEnvFile(values);
  console.log(
    "AE_BOT_KEY is already set in .env.local. The private key was not printed.",
  );
}

const botAddress = seedAddress(hexToBytes(botKey));

console.log("\nPortal-governed setup status");
console.log("API key      : set");
console.log("Bot key      : set locally");
console.log("Bot address  :", botAddress);
console.log(
  "Agent id     :",
  values.get("AE_BOT_ID")?.trim() ? "set" : "missing",
);
console.log(
  "Delegate id  :",
  values.get("AE_DELEGATE_ID")?.trim() ? "set" : "missing",
);
console.log(
  "Delegate file:",
  existsSync("mint-delegate.json")
    ? "mint-delegate.json present"
    : "optional/missing",
);
console.log(
  "Mint material:",
  values.get("AE_MINT_MATERIAL")?.trim() ? "set" : "optional/missing",
);

try {
  await smokeTestApiKey(apiKey);
  console.log("\nHosted API   : reachable with AE_API_KEY");
} catch (err) {
  console.error("\nHosted API   : API key check failed");
  console.error(err instanceof Error ? err.message : "unknown error");
  process.exit(1);
}

const missingBotId      = !values.get("AE_BOT_ID")?.trim();
const missingDelegateId = !values.get("AE_DELEGATE_ID")?.trim() && !existsSync("mint-delegate.json");
const missingMintMaterial = !values.get("AE_MINT_MATERIAL")?.trim();
const allReady = !missingBotId && !missingDelegateId;

if (allReady) {
  console.log("\n✓ All required env vars are set. Run `npm run bot` to mint.");
  if (missingMintMaterial) {
    console.log("  AE_MINT_MATERIAL is not set — local capability derivation after mint will be skipped.");
    console.log("  Copy it from the issued delegate panel in the portal to enable it.");
  }
} else {
  console.log("\nNext steps to complete setup:");
  let step = 1;

  if (missingBotId || missingDelegateId) {
    console.log(`\n  ${step++}. Go to https://agentenvelope.io and sign in.`);
    console.log("     On Vault: create a vault (if you haven't) and create a domain.");
  }

  if (missingDelegateId) {
    console.log(`\n  ${step++}. On Agents: select your domain and click Configure delegate.`);
    console.log("     Set the allowed operations, resources, time window, and usage limits.");
    console.log("     Enter your vault passphrase and click Issue.");
    console.log("     Copy the active delegate id into AE_DELEGATE_ID in .env.local.");
    console.log("     Or save the full delegate JSON here as mint-delegate.json.");
  }

  if (missingBotId) {
    console.log(`\n  ${step++}. Set AE_BOT_ID in .env.local to the agent id this bot will mint for.`);
    console.log("     It must match the agentId in your delegate's allowed scope.");
  }

  console.log(`\n  ${step++}. If your delegate uses address-set bot policy, add this bot address in the portal:`);
  console.log(`     ${botAddress}`);

  if (missingMintMaterial) {
    console.log(`\n  ${step++}. Optional: copy AE_MINT_MATERIAL from the issued delegate panel.`);
    console.log("     This lets the bot derive its action capability locally after a valid mint receipt.");
  }

  console.log("\n  When done, run `npm run preflight` to confirm everything is ready.");
}
