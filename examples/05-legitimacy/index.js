/**
 * legitimacy-demo.js
 *
 * Reads a portal-created legitimacy state and prints the legitimacyRef that
 * records or delegates can bind to. This script does not mutate the portal.
 */

import { config } from "../../shared/config.js";
import { getLegitimacyState, getStoredDelegate } from "../../shared/hosted.js";

const apiKey = config.apiKey();
const legitimacyId = config.legitimacyId();
const delegateId = config.delegateId();

function buildLegitimacyRef(state) {
  return {
    legitimacyId: state.legitimacyId,
    stateVersion: state.stateVersion,
    stateHash: state.stateHash,
    policyId: state.policyRef.policyId,
    required: true,
  };
}

function scopeLabel(scope) {
  return `${scope.kind}:${scope.id}${scope.domainHash ? ` @ ${scope.domainHash}` : ""}`;
}

function statusMeaning(state) {
  if (state.status === "legitimate") {
    return "This state allows matching scoped authority when the ref is attached.";
  }
  return `This state will fail legitimacy evaluation for matching scoped authority: ${state.status}.`;
}

function printJson(label, value) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}

const response = await getLegitimacyState(apiKey, legitimacyId, true);
const state = response.state;
const ref = buildLegitimacyRef(state);

console.log("\nLegitimacy state");
console.log(`  id       : ${state.legitimacyId}`);
console.log(`  status   : ${state.status}`);
console.log(`  scope    : ${scopeLabel(state.scope)}`);
console.log(`  version  : ${state.stateVersion}`);
console.log(`  hash     : ${state.stateHash}`);
console.log(`  policy   : ${state.policyRef.policyId} v${state.policyRef.policyVersion}`);
console.log(`  evidence : ${state.evidence.map((item) => item.label ?? item.kind).join(", ") || "none"}`);
console.log(`\n${statusMeaning(state)}`);

printJson("Copy this legitimacyRef into a new record or newly issued delegate:", ref);

if (state.scope.kind === "agent") {
  console.log(
    "\nThis is an agent-scoped state. It proves the hosted legitimacy store works, but current hosted enforcement expects delegate-scoped refs on delegates and record-scoped refs on records.",
  );
}

if (delegateId) {
  try {
    const delegate = await getStoredDelegate(apiKey, delegateId);
    const matchesDelegate =
      state.scope.kind === "delegate" && state.scope.id === delegate.delegateId;

    console.log(`\nDelegate check`);
    console.log(`  delegate : ${delegate.delegateId}`);
    console.log(`  scope    : ${matchesDelegate ? "matches" : "does not match this delegate"}`);
    console.log(`  attached : ${delegate.legitimacyRef?.legitimacyId ?? "not attached"}`);

    if (delegate.legitimacyRef?.legitimacyId === state.legitimacyId) {
      console.log("  result   : hosted mint/verify will evaluate this legitimacy state.");
    } else if (matchesDelegate) {
      console.log(
        "  result   : issue a new delegate with this legitimacyRef included before signing.",
      );
    }
  } catch (err) {
    console.log(`\nDelegate check skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (response.versions?.length) {
  console.log(`\nVersion history returned: ${response.versions.length}`);
}

console.log(
  "\nDemo idea: create a delegate- or record-scoped state, attach the ref, run the hosted support bot, then patch the state to suspended/compromised and rerun verification to show crypto still valid but governance no longer legitimate.",
);
