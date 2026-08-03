/**
 * mcp-server.js
 *
 * AgentEnvelope MCP server — the neutral authority layer for agent runtimes.
 *
 * Any MCP client (Claude, an OpenAI agent, LangChain, CrewAI, a custom runtime)
 * can call these tools to check and issue authority without building its own
 * policy engine, audit log, or verification stack. AgentEnvelope is owned by no
 * framework, so every framework can embed it.
 *
 * Two tiers of tools, matching the two product layers:
 *
 *   Sovereign (free, offline, no credential):
 *     - ae_verify_sovereign   verify a signature against a known agent address
 *
 *   Portal-governed (requires AE_API_KEY from the AgentEnvelope portal):
 *     - ae_get_agent          look up a registered agent's public record
 *     - ae_verify_action      verify a signed action through hosted governance
 *     - ae_mint               mint a capability through hosted governance
 *
 * Verification in sovereign mode is always free. The portal-governed tools are
 * what a framework offloads rather than rebuilds.
 *
 * Run: node mcp-server.js   (speaks MCP over stdio)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { verifyAction as verifyActionSovereign } from "agent-envelope-sdk";
import { getAgentRecord, verifyAction, mint } from "./hosted.js";
import "./config.js"; // side effect: loads .env.local into process.env

// ─── Credential handling (fail-closed, never process.exit inside a server) ────

function governanceApiKey() {
  return process.env.AE_API_KEY?.trim() || null;
}

const ok = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});
const fail = (message) => ({
  content: [{ type: "text", text: message }],
  isError: true,
});
const NEEDS_KEY =
  "AE_API_KEY is not set. This is a portal-governed tool; set the portal-issued API key to use it. (Sovereign verification needs no key — use ae_verify_sovereign.)";

// ─── Server ───────────────────────────────────────────────────────────────

const server = new McpServer({ name: "agent-envelope", version: "1.0.0" });

// Sovereign — free, offline, no credential.
server.registerTool(
  "ae_verify_sovereign",
  {
    title: "Verify (sovereign, offline)",
    description:
      "Verify a signed message against a known agent address. Pure crypto, no vault, no API key, no network. Verification is always free.",
    inputSchema: {
      message: z
        .record(z.string(), z.unknown())
        .describe("The exact signed message object"),
      signature: z.string().describe("0x-prefixed 65-byte signature"),
      expectedAddress: z
        .string()
        .describe("The agent's 0x address to check against"),
    },
  },
  async ({ message, signature, expectedAddress }) => {
    try {
      return ok(verifyActionSovereign({ message, signature, expectedAddress }));
    } catch (err) {
      return fail(err instanceof Error ? err.message : "verification failed");
    }
  },
);

// Portal-governed, requires AE_API_KEY.
server.registerTool(
  "ae_get_agent",
  {
    title: "Look up registered agent",
    description:
      "Fetch the portal-registered public record for an agent id. Requires a portal-issued API key.",
    inputSchema: {
      agentId: z.string().describe("The registered agent id"),
    },
  },
  async ({ agentId }) => {
    const apiKey = governanceApiKey();
    if (!apiKey) return fail(NEEDS_KEY);
    try {
      return ok(await getAgentRecord(apiKey, agentId));
    } catch (err) {
      return fail(err instanceof Error ? err.message : "lookup failed");
    }
  },
);

server.registerTool(
  "ae_verify_action",
  {
    title: "Verify action (portal-governed)",
    description:
      "Verify a signed action against the portal-registered record for an agent. Requires a portal-issued API key.",
    inputSchema: {
      agentId: z.string().describe("The registered agent id"),
      actionIndex: z.number().int().nonnegative().describe("The action index"),
      payload: z
        .record(z.string(), z.unknown())
        .describe("The signed action payload"),
      signature: z.string().describe("0x-prefixed 65-byte signature"),
      expectedActionEnvelopeHash: z
        .string()
        .optional()
        .describe("Optional expected action-envelope hash"),
    },
  },
  async ({ agentId, actionIndex, payload, signature, expectedActionEnvelopeHash }) => {
    const apiKey = governanceApiKey();
    if (!apiKey) return fail(NEEDS_KEY);
    try {
      return ok(await verifyAction(apiKey, { agentId, actionIndex, payload, signature, expectedActionEnvelopeHash }));
    } catch (err) {
      return fail(err instanceof Error ? err.message : "verification failed");
    }
  },
);

server.registerTool(
  "ae_mint",
  {
    title: "Mint capability (governance event)",
    description:
      "Mint a capability through hosted governance from a MintDelegate and a signed MintRequest. Returns a mint receipt. Requires a portal-issued API key. This is a governed action.",
    inputSchema: {
      delegate: z
        .record(z.string(), z.unknown())
        .describe("The portal-issued MintDelegate"),
      request: z
        .record(z.string(), z.unknown())
        .describe("The bot-signed MintRequest"),
    },
  },
  async ({ delegate, request }) => {
    const apiKey = governanceApiKey();
    if (!apiKey) return fail(NEEDS_KEY);
    try {
      return ok(await mint(apiKey, delegate, request));
    } catch (err) {
      return fail(err instanceof Error ? err.message : "mint failed");
    }
  },
);

// ─── Start ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("AgentEnvelope MCP server ready on stdio.");
