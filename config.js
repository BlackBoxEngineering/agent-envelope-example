/**
 * config.js
 *
 * Vault-anchored configuration. Authority lives in the vault, not on disk.
 *
 * There is no passphrase, no vault.json, no local root, and no local
 * encryption. The only credential this process holds is the vault-issued
 * API key. Every hosted call is gated by it.
 */

import { readFileSync, existsSync } from 'node:fs';

// Minimal .env.local loader — no dependency, no secrets in source control.
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined && match[2] !== '') {
      process.env[match[1]] = match[2];
    }
  }
}

function requireEnv(name, hint) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\nMissing required environment variable: ${name}`);
    if (hint) console.error(`  ${hint}`);
    console.error('\nSet it in .env.local or your shell. See .env.example.');
    process.exit(1);
  }
  return value;
}

export const config = {
  apiKey:   () => requireEnv('AE_API_KEY',   'vault-issued API key — gates every hosted call'),
  vaultId:  () => requireEnv('AE_VAULT_ID',  'the authenticated vault this bot belongs to'),
  domainId: () => requireEnv('AE_DOMAIN_ID', 'the domain inside the vault'),
  botId:    () => requireEnv('AE_BOT_ID',    'the registered bot identity (agent id)'),
  // The bot's OWN identity signing key — this is the bot's private key, not the
  // vault root. The vault registered its address as AE_BOT_ID. The bot must hold
  // its own key to sign a MintRequest; the hosted API never receives it.
  botKey:   () => requireEnv('AE_BOT_KEY',   "the bot's own identity signing key (0x hex) — not the vault root"),
  // Optional: 32-byte mint material (0x hex) the Avatar owner derives with
  // deriveMintMaterial() and issues out-of-band. When present, the bot derives
  // its action capability locally after a valid mint receipt.
  mintMaterial: () => process.env.AE_MINT_MATERIAL?.trim() || null,
};
