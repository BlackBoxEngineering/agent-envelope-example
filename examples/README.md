# Examples Pack

Each folder is one runnable AgentEnvelope scenario with a small abstract, the command to run, and the expected result.

The root still holds runtime handoff files such as `.env.local`, `mint-delegate.json`, `hosted-records.json`, and `signed-payload.json`. The examples read those files from the repo root when run through `npm`.

## Index

| Folder | Command | Purpose |
|---|---|---|
| `01-sovereign-offline` | `npm run sovereign` | Offline root to signed action verification |
| `02-use-cases` | `npm run use:cases` | Support, access, and fleet examples using the same primitive |
| `03-vault-delegate` | `npm run vault:delegate` | Local vault head issues a bounded bot delegate |
| `04-portal-hosted-bot` | `npm run portal:setup`, `npm run bot`, `npm run verifier`, `npm run demo` | Portal-governed mint and verify path |
| `05-legitimacy` | `npm run legitimacy` | Hosted legitimacy state lookup and delegate scope check |
| `06-manufacturing-legitimacy` | `npm run manufacturing:legitimacy` | Reality mismatch changes legitimacy without breaking signatures |
| `07-llm-drift` | `npm run llm:drift`, `npm run llm:drift:portal` | LLM tool intent constrained by delegated authority |
| `08-multi-agent` | `npm run multi:agent` | Three local bots with separated authorities |
| `09-hosted-multi-flow` | `npm run hosted:multi` | Hosted mint, delegated record publication, and hosted verify |
| `10-hosted-escalation` | `npm run hosted:escalation` | Explicit escalation pressure blocked by delegate bounds |
| `11-hosted-overreach` | `npm run hosted:overreach` | Helpful overreach partially allowed and partially blocked |
| `12-escape-incidents` | `npm run escape:incidents` | Known unsafe operation/resource attempts blocked before execution |
| `13-mcp` | `npm run mcp` | MCP integration server |

Run the full completing sweep with:

```bash
npm run test:all
```

`npm run mcp` is intentionally not included in `test:all` because it starts a server.
