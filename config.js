/**
 * config.js
 *
 * Portal-governed configuration. The vault root lives in the browser portal;
 * this process holds no passphrase, no vault file, no local root, and no local
 * encryption. The only credential here is the portal-issued API key.
 */

import { readFileSync, existsSync } from "node:fs";

// Minimal .env.local loader — no dependency, no secrets in source control.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined && match[2] !== "") {
      process.env[match[1]] = match[2];
    }
  }
}

function requireEnv(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\nMissing required environment variable: ${name}`);
    if (hint) console.error(`  ${hint}`);
    console.error("\nSet it in .env.local or your shell. See .env.example.");
    process.exit(1);
  }
  return value;
}

export const config = {
  apiKey: () =>
    requireEnv(
      "AE_API_KEY",
      "portal-issued API key — required for hosted lookup, verify, mint, and MCP governance tools",
    ),
  botId: () => requireEnv("AE_BOT_ID", "the agent id registered in the portal"),
  delegateId: () => process.env.AE_DELEGATE_ID?.trim() || null,
  // The bot’s OWN identity signing key — this is the bot’s private key, not the
  // vault root. The portal registered its address as AE_BOT_ID. The bot must hold
  // its own key to sign a MintRequest; the hosted API never receives it.
  botKey: () =>
    requireEnv(
      "AE_BOT_KEY",
      "the bot's own identity signing key (0x hex) — not the vault root",
    ),
  // Optional: 32-byte mint material (0x hex) from the portal. When present, the
  // bot derives its action capability locally after a valid mint receipt.
  mintMaterial: () => process.env.AE_MINT_MATERIAL?.trim() || null,
};
