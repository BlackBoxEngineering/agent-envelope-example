/**
 * MCP server wrapper.
 *
 * The actual neutral AgentEnvelope MCP server is published as
 * `agent-envelope-mcp`. This wrapper keeps the example's local command working
 * while loading `.env.local` first, so AE_API_KEY behaves like the other example
 * scripts.
 *
 * Run:
 *   npm run mcp
 *   node mcp-server.js
 */

import "../../shared/config.js";
import { start } from "agent-envelope-mcp";

await start();
