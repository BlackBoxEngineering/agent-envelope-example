/**
 * hosted.js
 *
 * Thin fetch wrappers for the four API-key-gated routes a bot can call.
 * No crypto, no SDK imports — just validated HTTP calls to the hosted API.
 *
 *   getAgentRecord(apiKey, agentId)          GET  /sovereign/agents/:agentId
 *   getStoredDelegate(apiKey, delegateId)    GET  /sovereign/delegates/:delegateId
 *   getLegitimacyState(apiKey, legitimacyId) GET  /sovereign/legitimacy
 *   registerDelegatedRecord(apiKey, input)    POST /sovereign/agents/register-delegated
 *   mint(apiKey, delegate, request)          POST /sovereign/mint
 *   verifyAction(apiKey, input)              POST /sovereign/verify
 */

export const HOSTED_API_BASE =
  "https://jemdjwteae.execute-api.us-east-1.amazonaws.com/v1";

export async function getAgentRecord(apiKey, agentId) {
  if (typeof agentId !== "string" || !/^[a-zA-Z0-9_:-]{1,128}$/.test(agentId))
    throw new Error("agentId is invalid");

  const response = await fetch(
    `${HOSTED_API_BASE}/sovereign/agents/${encodeURIComponent(agentId)}`,
    { headers: { "X-Api-Key": apiKey } },
  );
  const body = await response.json();
  if (!response.ok && !body?.error)
    throw new Error(`lookup failed with status ${response.status}`);
  return body;
}

export async function getStoredDelegate(apiKey, delegateId) {
  if (
    typeof delegateId !== "string" ||
    !/^ae-delegate-[a-fA-F0-9]{16}$/.test(delegateId)
  )
    throw new Error("delegateId is invalid");

  const response = await fetch(
    `${HOSTED_API_BASE}/sovereign/delegates/${encodeURIComponent(delegateId)}`,
    { headers: { "X-Api-Key": apiKey } },
  );
  const body = await response.json();
  if (response.ok && body?.delegate) return body.delegate;
  throw new Error(
    body?.error ?? body?.message ?? `delegate fetch failed with status ${response.status}`,
  );
}

export async function getLegitimacyState(apiKey, legitimacyId, includeVersions = false) {
  if (
    typeof legitimacyId !== "string" ||
    !/^ae-legit-[a-fA-F0-9]{16}$/.test(legitimacyId)
  )
    throw new Error("legitimacyId is invalid");

  const params = new URLSearchParams({ legitimacyId });
  if (includeVersions) params.set("includeVersions", "true");

  const response = await fetch(
    `${HOSTED_API_BASE}/sovereign/legitimacy?${params.toString()}`,
    { headers: { "X-Api-Key": apiKey } },
  );
  const body = await response.json();
  if (response.ok && body?.state) return body;
  throw new Error(
    body?.error ?? body?.message ?? `legitimacy fetch failed with status ${response.status}`,
  );
}

export async function registerDelegatedRecord(apiKey, { record, request, delegateId }) {
  if (!record || typeof record !== "object") throw new Error("record is required");
  if (!request || typeof request !== "object") throw new Error("request is required");
  if (delegateId !== undefined && typeof delegateId !== "string")
    throw new Error("delegateId is invalid");

  const response = await fetch(`${HOSTED_API_BASE}/sovereign/agents/register-delegated`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ record, request, ...(delegateId ? { delegateId } : {}) }),
  });
  const body = await response.json();
  if (response.ok) return body;
  throw new Error(
    body?.error ?? body?.message ?? `delegated record registration failed with status ${response.status}`,
  );
}

export async function mint(apiKey, delegate, request) {
  const response = await fetch(`${HOSTED_API_BASE}/sovereign/mint`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ delegate, request }),
  });
  return response.json();
}

export async function verifyAction(apiKey, { agentId, actionIndex, payload, signature, expectedActionEnvelopeHash }) {
  const response = await fetch(`${HOSTED_API_BASE}/sovereign/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({ agentId, actionIndex, payload, signature, expectedActionEnvelopeHash }),
  });
  const report = await response.json();
  if (report?.type === "agentenvelope.sovereignVerificationReport")
    report.type = "agentenvelope.verificationReport";
  return report;
}
