/**
 * use-cases.js
 *
 * One primitive, many actors. This runs fully offline and shows that an
 * AgentEnvelope "agent" is a bounded action identity, not necessarily an LLM.
 *
 * Run: node use-cases.js
 */

import { randomBytes } from "node:crypto";
import { signAction, verifyAction, hexToBytes } from "agent-envelope-sdk";
import {
  createDomainInfo,
  projectDomainKey,
  buildActionEnvelope,
  deriveAgentActionCapability,
} from "agent-envelope-sdk/avatar";

const cases = [
  {
    domainId: "support",
    kind: "agent",
    agentId: "support-sender",
    operation: "send-message",
    resources: ["thread:customer-123"],
    payload: { threadId: "customer-123", bodyHash: "0x" + "ab".repeat(32) },
  },
  {
    domainId: "hospitality",
    kind: "access",
    agentId: "room-407-key",
    operation: "unlock-door",
    resources: ["hotel:manchester:room:407"],
    payload: { doorId: "hotel:manchester:room:407", stayId: "stay-demo" },
  },
  {
    domainId: "fleet",
    kind: "operations",
    agentId: "drone-dispatch",
    operation: "dispatch-flight",
    resources: ["airspace:yard-7", "drone:alpha-3"],
    payload: { droneId: "alpha-3", routeHash: "0x" + "cd".repeat(32) },
  },
];

const identityRoot = Uint8Array.from(randomBytes(32));

try {
  for (const [index, scenario] of cases.entries()) {
    const domain = projectDomainKey(
      identityRoot,
      createDomainInfo({
        namespace: "example",
        domainId: scenario.domainId,
        kind: scenario.kind,
      }),
    );

    const envelope = buildActionEnvelope(domain, {
      agentId: scenario.agentId,
      actionIndex: index,
      operation: scenario.operation,
      resources: scenario.resources,
      decayMode: "TIME",
      maxUses: 1,
      notBefore: null,
      notAfter: Date.now() + 60 * 60 * 1000,
    });

    const capability = deriveAgentActionCapability(
      identityRoot,
      domain,
      envelope,
    );

    const action = {
      operation: scenario.operation,
      resources: scenario.resources,
      actionIndex: index,
      payload: scenario.payload,
      issuedAt: new Date().toISOString(),
    };

    const actionSeed = hexToBytes(capability.actionSeedHex);
    const signature = signAction(actionSeed, action);
    const verified = verifyAction({
      message: action,
      signature,
      expectedAddress: capability.agentAddress,
    });

    if (!verified.valid) {
      throw new Error(`${scenario.agentId} did not verify: ${verified.reason}`);
    }

    console.log(`${scenario.agentId}`);
    console.log(`  operation     : ${scenario.operation}`);
    console.log(`  resources     : ${scenario.resources.join(", ")}`);
    console.log(`  agent address : ${capability.agentAddress}`);
    console.log("  verified      : yes\n");
  }

  console.log("Every example used the same derive -> sign -> verify primitive.");
} finally {
  identityRoot.fill(0);
}
