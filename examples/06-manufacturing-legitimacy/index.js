/**
 * manufacturing-legitimacy.js
 *
 * Offline demo: a signed manufacturing command remains cryptographically valid,
 * but loses legitimacy when live sensor reality contradicts its assumptions.
 *
 * Run: node manufacturing-legitimacy.js
 */

import { contentHash, hexToBytes, seedAddress, signAction, verifyAction } from "agent-envelope-sdk";

const operatorSeed = hexToBytes(`0x${"42".repeat(32)}`);
const operatorAddress = seedAddress(operatorSeed);

const initialReality = {
  trolley4: {
    location: "bay4",
    free: true,
    observedBy: "robot2.sensor.location",
    observedAt: "2026-08-26T18:30:00.000Z",
  },
};

const authorityPolicy = {
  robotId: "robot2",
  operations: ["pickUp"],
  bays: ["bay4", "bay7"],
};

function issueCommand({ trolleyId, bayId, sequence }) {
  const command = {
    type: "agentenvelope.manufacturingCommand",
    version: 1,
    commandId: `cmd-${trolleyId}-${bayId}-${sequence}`,
    robotId: "robot2",
    operation: "pickUp",
    args: { trolleyId, bayId },
    issuedAt: new Date("2026-08-26T18:29:00.000Z").toISOString(),
  };
  const signature = signAction(operatorSeed, command);
  const recordId = `ae-action-${contentHash(command).slice(2, 22)}`;
  return { command, signature, recordId };
}

function createLegitimacyState({ command, recordId, expectedLocation }) {
  return withStateHash({
    type: "agentenvelope.legitimacyState",
    version: 1,
    legitimacyId: `ae-legit-${contentHash({ recordId, expectedLocation }).slice(2, 18)}`,
    ownerUserId: "demo-manufacturer",
    status: "legitimate",
    stateVersion: 1,
    scope: { kind: "record", id: recordId },
    policyRef: {
      policyId: "manufacturing-location-precondition",
      policyVersion: 1,
      policyHash: `0x${"00".repeat(32)}`,
    },
    assumptions: [
      {
        assumptionId: `${command.args.trolleyId}-location`,
        assumptionVersion: 1,
        assumptionHash: contentHash({
          trolleyId: command.args.trolleyId,
          expectedLocation,
        }),
        label: `${command.args.trolleyId} is at ${expectedLocation}`,
      },
    ],
    evidence: [
      {
        kind: "endpoint",
        label: `Warehouse feed reports ${command.args.trolleyId} at ${expectedLocation}`,
        metadata: {
          endpoint: "wms.trolley-location",
          trolleyId: command.args.trolleyId,
          expectedLocation,
          observedAt: "2026-08-26T18:28:45.000Z",
        },
      },
    ],
    createdAt: "2026-08-26T18:28:45.000Z",
    updatedAt: "2026-08-26T18:28:45.000Z",
    expiresAt: "2026-08-26T18:33:45.000Z",
  });
}

function withStateHash(state) {
  const { stateHash: _stateHash, ...hashable } = state;
  return { ...state, stateHash: contentHash(hashable) };
}

function verifySignedCommand(command, signature) {
  return verifyAction({
    message: command,
    signature,
    expectedAddress: operatorAddress,
  });
}

function evaluateLegitimacy({ command, recordId, state, reality, now }) {
  if (state.scope.kind !== "record" || state.scope.id !== recordId) {
    return denied("scope.mismatched", "legitimacy state is not scoped to this command record");
  }
  if (state.status !== "legitimate") {
    return denied(`state.${state.status}`, `legitimacy state is ${state.status}`);
  }
  if (state.expiresAt && Date.parse(state.expiresAt) <= now.getTime()) {
    return denied("state.expired", "location evidence expired");
  }

  const expectedLocation = state.evidence.find(
    (entry) => entry.metadata?.trolleyId === command.args.trolleyId,
  )?.metadata?.expectedLocation;

  if (expectedLocation !== command.args.bayId) {
    return denied("state.superseded", "evidence no longer supports the commanded bay");
  }

  const observed = reality[command.args.trolleyId];
  if (!observed) return denied("state.unobserved", "no live sensor observation for trolley");
  if (observed.location !== command.args.bayId) {
    return denied("state.mismatched", `${command.args.trolleyId} is at ${observed.location}, not ${command.args.bayId}`, {
      expectedLocation: command.args.bayId,
      observedLocation: observed.location,
      observedBy: observed.observedBy,
      observedAt: observed.observedAt,
    });
  }

  return {
    decision: "allowed",
    reasonCode: "state.current",
    checkedAt: now.toISOString(),
  };
}

function denied(reasonCode, reason, detail = {}) {
  return {
    decision: "denied",
    reasonCode,
    reason,
    checkedAt: "2026-08-26T18:30:05.000Z",
    ...detail,
  };
}

function patchStateForSensorMismatch(state, decision, command) {
  const event = {
    type: "agentenvelope.legitimacyEvent",
    version: 1,
    eventId: `ae-legit-event-${contentHash({ state: state.legitimacyId, decision }).slice(2, 18)}`,
    eventType: "evidence.invalidation",
    legitimacyId: state.legitimacyId,
    occurredAt: decision.checkedAt,
    effectiveAt: decision.checkedAt,
    scope: state.scope,
    patch: {
      status: "suspended",
      reasonCode: decision.reasonCode,
      metadata: {
        commandId: command.commandId,
        expectedLocation: decision.expectedLocation,
        observedLocation: decision.observedLocation,
      },
    },
    evidence: [
      {
        kind: "endpoint",
        label: `${command.args.trolleyId} was not present at ${command.args.bayId}`,
        metadata: {
          observedBy: decision.observedBy,
          observedAt: decision.observedAt,
          observedLocation: decision.observedLocation,
        },
      },
    ],
    producer: { authorityId: "robot2", keyId: "robot2.sensor.location" },
    signature: {
      alg: "secp256k1-keccak256",
      signerAddress: operatorAddress,
      value: "<sensor-event-signature>",
    },
  };

  const updated = withStateHash({
    ...state,
    status: "suspended",
    stateVersion: state.stateVersion + 1,
    reasonCode: decision.reasonCode,
    evidence: [...state.evidence, ...event.evidence],
    updatedAt: event.effectiveAt,
  });

  return { event, updated };
}

function canReissue({ trolleyId, bayId, reality, policy }) {
  const observed = reality[trolleyId];
  if (!observed) return { ok: false, reason: "trolley location unknown" };
  if (observed.location !== bayId) return { ok: false, reason: `trolley is not in ${bayId}` };
  if (!observed.free) return { ok: false, reason: "trolley is not free" };
  if (!policy.operations.includes("pickUp")) return { ok: false, reason: "pickUp is not delegated" };
  if (!policy.bays.includes(bayId)) return { ok: false, reason: `${bayId} is outside delegated bay scope` };
  return { ok: true };
}

function printStep(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

const original = issueCommand({ trolleyId: "trolley4", bayId: "bay7", sequence: "v1" });
const originalState = createLegitimacyState({
  command: original.command,
  recordId: original.recordId,
  expectedLocation: "bay7",
});

printStep("1. Operator issues signed command");
console.log(`${original.command.robotId}.${original.command.operation}(${original.command.args.trolleyId}, ${original.command.args.bayId})`);
console.log(`recordId: ${original.recordId}`);
console.log(`operator: ${operatorAddress}`);

printStep("2. AE verifies signature and hosted legitimacy");
const signatureCheck = verifySignedCommand(original.command, original.signature);
const legitimacyDecision = evaluateLegitimacy({
  command: original.command,
  recordId: original.recordId,
  state: originalState,
  reality: initialReality,
  now: new Date("2026-08-26T18:30:05.000Z"),
});
console.log(`signature.valid: ${signatureCheck.valid}`);
console.log(`legitimacy.decision: ${legitimacyDecision.decision}`);
console.log(`reasonCode: ${legitimacyDecision.reasonCode}`);
console.log(`reason: ${legitimacyDecision.reason}`);

printStep("3. Robot gathers fresh evidence");
console.log(`request trolley4 location -> ${initialReality.trolley4.location}`);
console.log(`check trolley4 free -> ${initialReality.trolley4.free}`);

printStep("4. AE patches the old legitimacy state");
const { event, updated } = patchStateForSensorMismatch(originalState, legitimacyDecision, original.command);
console.log("PATCH /sovereign/legitimacy");
console.log(JSON.stringify({ legitimacyId: originalState.legitimacyId, event }, null, 2));
console.log(`updated status: ${updated.status}`);
console.log(`updated reasonCode: ${updated.reasonCode}`);

printStep("5. Bot proposes corrected command");
const reissueCheck = canReissue({
  trolleyId: "trolley4",
  bayId: initialReality.trolley4.location,
  reality: initialReality,
  policy: authorityPolicy,
});

if (!reissueCheck.ok) {
  console.log(`cannot reissue: ${reissueCheck.reason}`);
  process.exit(1);
}

const corrected = issueCommand({ trolleyId: "trolley4", bayId: initialReality.trolley4.location, sequence: "v2" });
const correctedState = createLegitimacyState({
  command: corrected.command,
  recordId: corrected.recordId,
  expectedLocation: initialReality.trolley4.location,
});
const correctedSignature = verifySignedCommand(corrected.command, corrected.signature);
const correctedDecision = evaluateLegitimacy({
  command: corrected.command,
  recordId: corrected.recordId,
  state: correctedState,
  reality: initialReality,
  now: new Date("2026-08-26T18:30:10.000Z"),
});

console.log(`${corrected.command.robotId}.${corrected.command.operation}(${corrected.command.args.trolleyId}, ${corrected.command.args.bayId})`);
console.log(`signature.valid: ${correctedSignature.valid}`);
console.log(`legitimacy.decision: ${correctedDecision.decision}`);

if (!signatureCheck.valid || legitimacyDecision.decision !== "denied" || !correctedSignature.valid || correctedDecision.decision !== "allowed") {
  process.exit(1);
}

printStep("Result");
console.log("The old command stayed signed, but was no longer legitimate.");
console.log("The bot gathered evidence and issued a new command under a fresh legitimacy state.");
