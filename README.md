# agent-envelope-example

Integration examples for [`agent-envelope-sdk`](https://www.npmjs.com/package/agent-envelope-sdk),
showing the two layers of the product.

AgentEnvelope is not only an AI-agent demo. In these examples, an "agent" is a
bounded action identity: a named actor, operation, resources, decay policy, and
verifiable address. That actor can be a chatbot, backend worker, workflow step,
hotel key, device command, drone dispatch, or any other system trusted to act.

## Two layers, one substrate

The sovereign crypto layer is **free, offline, and requires no account**. The
hosted governance layer is **optional, but it is the product layer you usually
want in production**: it adds API-keyed operation control, public records, mint
receipts, verification events, and audit trails on top of the same deterministic core.

| | Sovereign | Portal-governed |
|---|---|---|
| Authority source | A self-held root | A MintDelegate issued from the portal |
| Credential | None | Portal-issued `AE_API_KEY` |
| Network | None — fully offline | Hosted mint / verify / lookup |
| Governance | None | Public records, receipts, events, audit |
| Revocation | Decay + time windows only | + API key rotation and hosted enforcement |
| Example | `sovereign.js` | `bot.js` + `verifier.js` |

Sovereign mode is the free, unstoppable substrate. Portal governance is the
optional layer on top and neither replaces the other. Offline verification
always works regardless of which layer is used.

```bash
npm install
node sovereign.js          # works immediately — no account, no key, no network
node use-cases.js          # offline examples beyond AI: support, access, fleet
# — or —
node bot.js                # portal-governed — mint through the hosted API
node verifier.js           # portal-governed — verify through the hosted API
```
---

## Sovereign mode (`sovereign.js`)
Pure offline authority. No account, no API key, no server, no issuer.
```
root → domain → action envelope → capability → sign → verify
```

`sovereign.js` generates an ephemeral root, derives a scoped capability with
`deriveAgentActionCapability`, signs an action with `signAction`, and verifies it
with `verifyAction` — proving, and then rejecting, a tampered action. Everything
comes from the published SDK; nothing touches the network.

---

## Use-case scope (`use-cases.js`)

Same primitive, different actors. This script runs offline and derives scoped
capabilities for:

- `support-sender` performing `send-message`
- `room-407-key` performing `unlock-door`
- `drone-dispatch` performing `dispatch-flight`

Each example produces an agent address, signs a matching action, and verifies it
locally. This is the broader point: AI agents triggered the design, but the
primitive secures any bounded actor.

```bash
npm run use:cases
```

---

## Portal-governed mode (`bot.js` + `verifier.js`)

A bot that proves membership by signature and mints scoped action capabilities
through the hosted API. The bot holds **no vault root, no passphrase, and no
domain seed** — only its own identity key and a MintDelegate the portal issued.

The portal (browser console at [agentenvelope.io](https://agentenvelope.io)) is
where you create the vault, derive domains, issue MintDelegates, register public
records, and manage API keys. The vault root is browser-held and never sent to
any server. The portal is the governance surface; the SDK is the crypto surface.
The hosted governance layer is available at [agentenvelope.io](https://agentenvelope.io) -
no separate "portal" button exists.

### Setup — step by step

**Step 1 — install and generate a bot key**

```bash
npm install
cp .env.example .env.local
```

Add your portal API key to `.env.local` (`AE_API_KEY`), then run:

```bash
npm run portal:setup
```

This checks the API key reaches the hosted API and generates `AE_BOT_KEY`
locally if it is missing. It prints the bot's **public address** — copy it, you
will need it in the portal. The private key stays in `.env.local` and is never
printed.

**Step 2 — portal: vault and domain** *(one-time)*

1. Sign up at [agentenvelope.io/signup](https://agentenvelope.io/signup). Free
   tier provisions immediately.
2. On **Vault**: create a vault with a strong passphrase. The root is generated
   in your browser and never leaves it.
3. On **Vault**: create a domain — namespace, domain id, and kind.
4. On **Account → API keys**: rotate and copy your API key once. Store it in
   your secrets manager; it is shown only once.

**Step 3 — portal: configure a delegate on Agents**

1. On **Agents**: select the domain you created.
2. Click **Configure delegate** and fill in the bounds:
   - Allowed operations (e.g. `send-message`)
   - Allowed resources (e.g. `thread:*`)
   - Max mints, max uses per action, action index range, expiry
3. Enter your vault passphrase and click **Issue**.
4. From the issued delegate panel, copy:
   - `AE_DELEGATE_ID` — the active delegate id
   - `AE_MINT_MATERIAL` — the one-time mint material (enables local signing)
   - Optionally save the delegate JSON as `mint-delegate.json` for a local fallback

**Step 4 — set the remaining env values**

| Variable | Where it comes from |
|---|---|
| `AE_API_KEY` | Account → API keys in the portal |
| `AE_BOT_ID` | Stable public agent id label (e.g. `support-agent` or `support-sender`) — not the bot key/address |
| `AE_DELEGATE_ID` | Active Delegates row on the Agents page |
| `AE_BOT_KEY` | Generated locally by `portal:setup` — do not change it |
| `AE_MINT_MATERIAL` | Copied from the issued delegate panel — enables local capability derivation |

**Step 5 — run**

```bash
node bot.js       # mint → derive → sign → verify
node verifier.js  # look up the public record and verify the signed action
```

Or both in sequence:

```bash
npm run demo
```

### What each script does

**`bot.js`** — fetches the active delegate by `AE_DELEGATE_ID` (or falls back to
`mint-delegate.json`), verifies it locally, signs a `MintRequest` with its own
key (`AE_BOT_KEY`), and mints through `POST /sovereign/mint` (API-key gated).
The hosted API verifies both signatures and every policy constraint, then returns
a signed receipt. With `AE_MINT_MATERIAL` set, the bot then derives its action
capability locally, signs an action, and verifies it offline — no signing
material ever leaves the bot.

**`verifier.js`** — holds only the API key. Looks up the bot's registered public
record via the hosted API, and — if a `signed-payload.json` is present —
verifies the signed action through `POST /sovereign/verify`. Offline
verification against the same public record is always available via the SDK
without any API call.

**`portal-setup.js`** — checks `AE_API_KEY` reaches the hosted API, generates
`AE_BOT_KEY` locally if missing, and prints the bot's public address. Run this
before configuring a delegate in the portal.

---

## LLM tool workflows (`multi-agent.js` + `hosted-multi-agent.js`)

`multi-agent.js` runs the three-bot support workflow locally with sovereign
delegates. It requires AWS Bedrock credentials for the LLM loop, but no
AgentEnvelope account or hosted API key.

```bash
npm run multi:agent
```

`hosted-multi-agent.js` runs the same support workflow through hosted minting
and verification. It uses one portal-issued delegate for the tool calls; for
strict three-bot separation, issue one hosted delegate per bot address.

```bash
npm run hosted:multi
```

This hosted script requires `AE_API_KEY`, `AE_BOT_ID`, `AE_DELEGATE_ID`,
`AE_BOT_KEY`, and `AE_MINT_MATERIAL`. If `mint-delegate.json` includes
`domainSummary`, the script also writes seedless public record manifests to
`hosted-records.json`.

Hosted mint uses API-key authentication because authority is derived from the
delegate and bot signatures. Record registration remains account-owned and
requires Cognito authentication. The hosted example demonstrates mint receipts;
record-backed hosted verification works once the record is registered via the
portal.

### Portal tests with no ambiguity

Use the portal for account-governed tests, not as an API-key publishing shortcut:

1. Go to [agentenvelope.io](https://agentenvelope.io) and sign in.
2. On **Vault**, create or unlock your vault, then create the domain used by the
   test.
3. On **Agents**, select that domain and configure a delegate. For
   `npm run hosted:multi`, use operations `read-thread`, `send-message`, and
   `issue-refund`; use resource `*` or matching `thread:*` / `order:*` bounds;
   set `maxMints` high enough for the run.
4. Copy the delegate id, mint material, and delegate JSON. Save the JSON as
   `mint-delegate.json` beside the example so the script can read
   `domainSummary`.
5. Run `npm run hosted:multi`. The script mints through the hosted API and, when
   `domainSummary` is present, writes `hosted-records.json` with seedless public
   record manifests.
6. Record registration is still an owner-account action. The current portal
   supports publishing records it creates from the signed-in workspace on
   **Records** and **Records → Playground**; it does not treat a bot API key as
   permission to publish records under your identity.
7. After the matching public record is registered by the portal/account owner,
   hosted verification can check the signed payload with `POST /sovereign/verify`.

---

## Escape incident demo (`escape-incidents.js`)

This workspace also contains `../agent-escape-incidents`, a third-party register
of disclosed agent escape techniques. `escape-incidents.js` uses that register's
TTP ids as labels and demonstrates AgentEnvelope as an approval-gateway layer:

Note: `npm run escape:incidents` requires a vault-derived TTP register from
[agentenvelope.io](https://agentenvelope.io). This part is not reproducible cold
from GitHub. The sovereign and portal-governed examples are fully public.

```bash
npm run escape:incidents
```

The demo publishes a small set of action envelopes for a sealed cyber eval:
`http:get` to the declared lab target, `artifact:read` for workdir artefacts,
`workspace:write` inside the workdir, and `tool:execute` inside the sealed range.
Representative incident attempts such as off-range target substitution (`D01`),
answer-store reads (`A07`), package publication (`B01`), phishing (`C04`), public
credential publication (`F01`), reverse tunnels (`E01`), and force-push history
rewrites (`G01`) are refused because no matching operation/resource envelope
exists.

One row, `E14/Z04`, is deliberately marked `network-layer`: if egress happens
inside a library or subprocess and no destination-bearing request reaches the
approval seam, AgentEnvelope must be paired with network isolation or a watchdog.
That boundary is the honest story: AgentEnvelope fixes authority ambiguity; it
does not replace sandbox hygiene.

---

## MCP server (`agent-envelope-mcp`)

The example consumes the published [`agent-envelope-mcp`](https://www.npmjs.com/package/agent-envelope-mcp)
package. `mcp-server.js` is only a tiny wrapper that loads `.env.local` and starts
that package over stdio.

`agent-envelope-mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io)
over stdio. Any MCP client — Claude, an OpenAI agent, LangChain, CrewAI, a
custom runtime — can call AgentEnvelope to check and issue authority without
building its own policy engine, audit log, or verification stack.

```bash
npm run mcp        # local wrapper, loads .env.local
npx agent-envelope-mcp
```

Four tools across the two layers:

| Tool | Layer | Credential |
|---|---|---|
| `ae_verify_sovereign` | Sovereign | none — offline, always free |
| `ae_get_agent` | Portal-governed | `AE_API_KEY` |
| `ae_verify_action` | Portal-governed | `AE_API_KEY` |
| `ae_mint` | Portal-governed | `AE_API_KEY` |

`ae_verify_sovereign` needs no account and no key — sovereign verification is
always free. The portal-governed tools are the surface a framework offloads
rather than rebuilds.

To use it from an MCP client:

```jsonc
{
  "mcpServers": {
    "agent-envelope": {
      "command": "node",
      "args": ["mcp-server.js"],
      "env": { "AE_API_KEY": "your-portal-issued-key" }
    }
  }
}
```

Or point the client at the published package directly:

```jsonc
{
  "mcpServers": {
    "agent-envelope": {
      "command": "npx",
      "args": ["-y", "agent-envelope-mcp"],
      "env": { "AE_API_KEY": "your-portal-issued-key" }
    }
  }
}
```

---

## Tests

The example uses Node's built-in test runner, so no test framework dependency is
needed.

```bash
npm test
```

Current coverage:

| Suite | What it proves |
|---|---|
| Sovereign flow | Domain derivation, capability derivation, sign/verify, tamper rejection, full `sovereign.js` mirror |
| Canonical signing | Stable canonical JSON, stable content hashes, reordered object verification |
| Public record verification | Seedless public records, valid hosted-style verification, hash/index/status/time-window rejection |
| Portal-governed local layer | MintDelegate and MintRequest verification, address-set bots, wildcard/exact resources, policy bounds, full `bot.js` local mirror |
| `deriveMintMaterial` | Shape, determinism, domain isolation, root isolation |
| Hosted client route contracts | API-key headers and request bodies for lookup, verify, and mint without making network calls |
| Receipt attestations | Hosted receipt signing, attester pinning, tamper rejection |
| Cross-prefix isolation | Delegate signatures cannot pass as action signatures and vice versa |
| Custody boundary | Private capability material stays private, public projections stay seedless, consumed seeds are zeroed |
| Serialization and constants | `DECAY_MODES` enum, `serializeAgentActionCapability`, `serializePublicActionRecord` |

---

## License

[Apache-2.0](LICENSE) — see [NOTICE](NOTICE) for attribution.

