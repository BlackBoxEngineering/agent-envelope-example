# agent-envelope-example

Integration examples for `agent-envelope-sdk`, showing the two official modes.

## Two modes, one substrate

AgentEnvelope is **decentralised at the crypto layer** and **governed at the
custody layer**. The same deterministic core powers both; only the authority
surface differs.

| | Sovereign mode | Custody mode |
|---|---|---|
| Authority | A self-held root | A vault-issued delegate |
| Credential | None | Vault-issued `AE_API_KEY` |
| Network | None — fully offline | Hosted mint / verify |
| Governance | None | Policy, membership, audit, decay |
| Revocation | Decay + time windows only | + key rotation, membership, policy |
| Example | `sovereign.js` | `bot.js` + `verifier.js` |

Sovereign mode is the free, unstoppable substrate. Custody mode is the optional
governed surface on top of it — neither replaces the other.

```bash
npm install
node sovereign.js          # sovereign mode — no vault, no key, no network
# — or —
node bot.js                # custody mode — mint through the vault API
node verifier.js           # custody mode — verify through the vault API
```

---

## Sovereign mode (`sovereign.js`)

Pure decentralised authority. Runs entirely offline:

```
root → domain → action envelope → capability → sign → verify
```

No vault, no API key, no server, no issuer, no revocation list. The holder of
the root is the only authority. `sovereign.js` generates an ephemeral root,
derives a scoped capability with `deriveAgentActionCapability`, signs an action
with `signAction`, and verifies it with `verifyAction` — proving, and then
rejecting, a tampered action. Everything comes from the published SDK; nothing
touches the network.

---

## Custody mode

A **vault-anchored** surface for governed, auditable authority.

Authority is anchored to an authenticated vault, not to a local seed. This part
holds **no passphrase, no vault file, no local root, and no local encryption**.
The only credential it carries is a vault-issued **API key**, and every hosted
call is gated by it.

> Custody mode replaces the earlier browser-held-vault prototype. There is no
> `VAULT_PASSPHRASE`, no `vault.json`, and no client-side root derivation.

## The custody model

| Where authority lives | What the SDK holds |
|---|---|
| Vault root — server-side, encrypted under the authenticated user | Nothing |
| Domain keys — derived **inside** the vault | Nothing |
| Bot registration — inside the vault | An `AE_BOT_ID` reference |
| Mint delegate — signed inside the vault | A `mint-delegate.json` export (no secrets) |
| API key — issued by the vault | `AE_API_KEY` (gates every call) |

The cryptographic core stays deterministic — the same inputs produce the same
addresses — but the **authority** is anchored to the vault, and the API key is
what proves you are allowed to exercise it.

## Configuration

Copy `.env.example` to `.env.local` and fill in the values from the console:

| Variable | Meaning |
|---|---|
| `AE_API_KEY` | Vault-issued API key — gates every hosted call |
| `AE_VAULT_ID` | The authenticated vault this bot belongs to |
| `AE_DOMAIN_ID` | The domain inside the vault |
| `AE_BOT_ID` | The registered bot identity (agent id) |
| `AE_BOT_KEY` | The bot's **own** identity signing key (`0x` hex) — not the vault root |
| `AE_MINT_MATERIAL` | *(optional)* 32-byte mint material (`0x` hex) issued out-of-band by the Avatar owner — enables local action-capability derivation |

`AE_BOT_KEY` is the bot's private key, used only to sign its own `MintRequest`.
It is never the vault root and never leaves this process — the hosted API only
ever receives the resulting signature.

## What happens in the console first

These steps require the authenticated console (Cognito) and produce the
artifacts this example consumes:

1. Authenticate and create a vault. The vault root is stored server-side,
   encrypted under your account.
2. Create a domain inside the vault (`AE_DOMAIN_ID`).
3. Register your bot (`AE_BOT_ID`) — the vault records the bot's public address.
4. Issue a **MintDelegate** for the bot and export it as `mint-delegate.json`.
5. Obtain your **API key** (`AE_API_KEY`).
6. *(Optional)* Issue the bot's **mint material** (`AE_MINT_MATERIAL`) out-of-band
   so it can derive its action capability locally after a valid receipt.

## Run

```bash
npm install
cp .env.example .env.local   # then fill in the values
node bot.js                  # mint through the vault API
node verifier.js             # verify authority through the vault API
```

Or both in sequence:

```bash
npm run demo
```

## What each script does

### bot.js

The registered bot. It loads the vault-issued `mint-delegate.json`, verifies it
locally, then signs a `MintRequest` with its **own** key (`AE_BOT_KEY`) and mints
through `POST /sovereign/mint` (API-key gated). The vault verifies both
signatures and every policy bound server-side and returns a signed receipt.

The bot never sees the vault root, a passphrase, or any domain seed. It proves
membership by signature and is authorised by the vault.

> With `AE_MINT_MATERIAL` set (issued out-of-band by the Avatar owner), the bot
> then derives its action capability locally with `mintActionCapability` from
> `agent-envelope-sdk`, signs an action, and verifies it — no signing material
> ever leaves the bot. Without it, the example stops at the vault receipt.

### verifier.js

Holds only the API key. It looks up the bot's registered public record via the
API, and — if a `signed-payload.json` is present — verifies the signed action
through `POST /sovereign/verify` (API-key gated). There is no offline fallback:
the vault is the source of truth.

## What this process never holds

- No vault passphrase
- No vault root
- No local vault file
- No local encryption or unwrapping
- No domain seed

Authority is fetched, minted, and verified through the vault API, gated by the
vault-issued API key.

---

## MCP server (`mcp-server.js`)

The neutral authority layer for agent runtimes. `mcp-server.js` speaks the
[Model Context Protocol](https://modelcontextprotocol.io) over stdio, so **any**
MCP client — Claude, an OpenAI agent, LangChain, CrewAI, a custom runtime — can
call AgentEnvelope to check and issue authority without building its own policy
engine, audit log, or verification stack. AgentEnvelope is owned by no framework,
so every framework can embed it.

```bash
node mcp-server.js        # speaks MCP over stdio
```

It exposes four tools across the two modes:

| Tool | Mode | Credential |
|---|---|---|
| `ae_verify_sovereign` | Sovereign | none — offline, always free |
| `ae_get_agent` | Custody | `AE_API_KEY` |
| `ae_verify_action` | Custody | `AE_API_KEY` |
| `ae_mint` | Custody | `AE_API_KEY` |

`ae_verify_sovereign` needs no vault and no key — verification is always free.
The vault-gated tools are the governed surface a framework offloads rather than
rebuilds.

To use it from an MCP client, point the client at this command and pass the
vault-issued key in the environment:

```jsonc
{
  "mcpServers": {
    "agent-envelope": {
      "command": "node",
      "args": ["mcp-server.js"],
      "env": { "AE_API_KEY": "your-vault-issued-key" }
    }
  }
}
```

---

## License

[Apache-2.0](LICENSE) — see [NOTICE](NOTICE) for attribution.

