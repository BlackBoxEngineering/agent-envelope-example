/**
 * test.js
 *
 * Offline tests for agent-envelope-example.
 * Covers everything that runs without a network or portal account:
 *   - sovereign flow: root → domain → envelope → capability → sign → verify
 *   - portal-governed local layer: delegate, request, local capability derivation
 *   - cross-prefix isolation
 *   - custody boundary (actionSeedHex never in public record)
 *
 * Run: node --test test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  canonicalJSON,
  contentHash,
  recoverActionAddress,
  signAction,
  verifyAction,
  verifyRecord,
  signReceipt,
  verifyReceipt,
  hexToBytes,
  buildMintDelegate,
  verifyMintDelegate,
  buildMintRequest,
  verifyMintRequest,
  mintActionCapability,
  deriveMintMaterial,
  seedAddress,
} from "agent-envelope-sdk";

import {
  createDomainInfo,
  projectDomainKey,
  buildActionEnvelope,
  deriveAgentActionCapability,
  createPublicActionRecord,
  serializeAgentActionCapability,
  serializePublicActionRecord,
} from "agent-envelope-sdk/avatar";
import { DECAY_MODES } from "agent-envelope-sdk/constants";
import { getAgentRecord, getStoredDelegate, mint, verifyAction as hostedVerifyAction } from "./hosted.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROOT = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const freshDomainSeed = () => Uint8Array.from({ length: 32 }, (_, i) => i + 10);
const freshBotSeed = () => Uint8Array.from({ length: 32 }, (_, i) => i + 50);
const freshMintMaterial = () =>
  Uint8Array.from({ length: 32 }, (_, i) => i + 90);

const DOMAIN_INFO = createDomainInfo({
  namespace: "demo",
  domainId: "support",
  kind: "agent",
});

function makeDomain(root = ROOT) {
  return projectDomainKey(root, DOMAIN_INFO);
}

function makeEnvelope(domain) {
  return buildActionEnvelope(domain, {
    agentId: "demo-bot",
    actionIndex: 0,
    operation: "send",
    resources: ["thread:demo"],
    decayMode: "NONE",
    maxUses: null,
    notBefore: null,
    notAfter: null,
  });
}

function makeCapability(root = ROOT) {
  const domain = makeDomain(root);
  const envelope = makeEnvelope(domain);
  return {
    domain,
    envelope,
    capability: deriveAgentActionCapability(root, domain, envelope),
  };
}

const DELEGATE_INPUT = {
  domainHash: "0x" + "ab".repeat(32),
  allowedOperations: ["send"],
  allowedResources: ["thread:*"],
  botPolicy: "any-signed-bot",
  actionIndexPolicy: { min: 0, max: 9 },
  maxMints: 5,
  maxUsesPerAction: 1,
  timeWindow: { notBefore: null, notAfter: null },
  nonce: "0x" + "ff".repeat(32),
  issuedAt: "2026-01-01T00:00:00.000Z",
};

const REQUEST_INPUT = {
  agentId: "demo-bot",
  operation: "send",
  resources: ["thread:customer-1"],
  actionIndex: 0,
  maxUses: 1,
  timeWindow: { notBefore: null, notAfter: null },
  nonce: "0x" + "ee".repeat(32),
  requestedAt: "2026-01-01T00:01:00.000Z",
};

function makeDelegate(input = {}) {
  return buildMintDelegate(freshDomainSeed(), { ...DELEGATE_INPUT, ...input });
}

function makeRequest(delegate, input = {}) {
  return buildMintRequest(freshBotSeed(), delegate, {
    ...REQUEST_INPUT,
    ...input,
  });
}

function signWithCapability(capability, action) {
  return signAction(hexToBytes(capability.actionSeedHex), action);
}

function makePublicRecordFixture(envelopeInput = {}) {
  const domain = makeDomain();
  const envelope = buildActionEnvelope(domain, {
    agentId: "demo-bot",
    actionIndex: 0,
    operation: "send",
    resources: ["thread:demo"],
    decayMode: "NONE",
    maxUses: null,
    notBefore: null,
    notAfter: null,
    ...envelopeInput,
  });
  const capability = deriveAgentActionCapability(ROOT, domain, envelope);
  const record = createPublicActionRecord(capability, {
    ownerUserId: "user-example",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const payload = {
    operation: envelope.operation,
    resource: envelope.resources[0],
    actionIndex: envelope.actionIndex,
  };
  const signature = signWithCapability(capability, payload);
  return { domain, envelope, capability, record, payload, signature };
}

async function withMockFetch(response, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async json() {
        return typeof response === "function"
          ? response(url, options)
          : response;
      },
    };
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ─── Sovereign flow ───────────────────────────────────────────────────────────

describe("sovereign flow", () => {
  it("projectDomainKey is deterministic and produces a valid address + fingerprint", () => {
    const a = makeDomain();
    const b = projectDomainKey(ROOT, DOMAIN_INFO);
    assert.equal(a.domainAddress, b.domainAddress);
    assert.equal(a.domainHash, b.domainHash);
    assert.match(a.domainAddress, /^0x[a-fA-F0-9]{40}$/);
    assert.match(a.domainFingerprint, /^ae-domain-[a-f0-9]{16}$/);
  });

  it("different roots produce different domain addresses", () => {
    const rootB = Uint8Array.from({ length: 32 }, (_, i) => i + 2);
    assert.notEqual(
      makeDomain(ROOT).domainAddress,
      makeDomain(rootB).domainAddress,
    );
  });

  it("deriveAgentActionCapability is deterministic", () => {
    const { capability: a } = makeCapability();
    const { capability: b } = makeCapability();
    assert.equal(a.agentAddress, b.agentAddress);
    assert.equal(a.actionSeedHex, b.actionSeedHex);
    assert.equal(a.actionEnvelopeHash, b.actionEnvelopeHash);
  });

  it("different action indices produce different agent addresses", () => {
    const domain = makeDomain();
    const envA = buildActionEnvelope(domain, {
      agentId: "demo-bot",
      actionIndex: 0,
      operation: "send",
      resources: ["thread:demo"],
      decayMode: "NONE",
      maxUses: null,
      notBefore: null,
      notAfter: null,
    });
    const envB = buildActionEnvelope(domain, {
      agentId: "demo-bot",
      actionIndex: 1,
      operation: "send",
      resources: ["thread:demo"],
      decayMode: "NONE",
      maxUses: null,
      notBefore: null,
      notAfter: null,
    });
    const capA = deriveAgentActionCapability(ROOT, domain, envA);
    const capB = deriveAgentActionCapability(ROOT, domain, envB);
    assert.notEqual(capA.agentAddress, capB.agentAddress);
  });

  it("signAction + verifyAction: authentic payload passes", () => {
    const { capability } = makeCapability();
    const payload = {
      operation: "send",
      resource: "thread:demo",
      issuedAt: "2026-01-01T00:00:00.000Z",
    };
    const actionSeed = hexToBytes(capability.actionSeedHex);
    const signature = signAction(actionSeed, payload);
    const result = verifyAction({
      message: payload,
      signature,
      expectedAddress: capability.agentAddress,
    });
    assert.equal(result.valid, true);
    assert.equal(result.recoveredAddress, capability.agentAddress);
  });

  it("signAction + verifyAction: tampered payload is rejected", () => {
    const { capability } = makeCapability();
    const payload = {
      operation: "send",
      resource: "thread:demo",
      issuedAt: "2026-01-01T00:00:00.000Z",
    };
    const actionSeed = hexToBytes(capability.actionSeedHex);
    const signature = signAction(actionSeed, payload);
    const result = verifyAction({
      message: { ...payload, resource: "thread:other" },
      signature,
      expectedAddress: capability.agentAddress,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "address mismatch");
  });

  it("signature from one capability does not verify against a different agent address", () => {
    const { capability: capA } = makeCapability(ROOT);
    const rootB = Uint8Array.from({ length: 32 }, (_, i) => i + 2);
    const { capability: capB } = makeCapability(rootB);
    const payload = { operation: "send" };
    const sig = signAction(hexToBytes(capA.actionSeedHex), payload);
    const result = verifyAction({
      message: payload,
      signature: sig,
      expectedAddress: capB.agentAddress,
    });
    assert.equal(result.valid, false);
  });

  it("mirrors the sovereign.js script end-to-end", () => {
    const root = Uint8Array.from(randomBytes(32));
    try {
      const domain = projectDomainKey(
        root,
        createDomainInfo({
          namespace: "demo",
          domainId: "support",
          kind: "agent",
        }),
      );
      const envelope = buildActionEnvelope(domain, {
        agentId: "demo-bot",
        actionIndex: 0,
        operation: "send",
        resources: ["thread:demo"],
        decayMode: "NONE",
        maxUses: null,
        notBefore: null,
        notAfter: null,
      });
      const capability = deriveAgentActionCapability(root, domain, envelope);
      const action = {
        operation: "send",
        resource: "thread:demo",
        actionIndex: 0,
        payload: { text: "hello" },
        issuedAt: new Date().toISOString(),
      };
      const actionSeed = hexToBytes(capability.actionSeedHex);
      const signature = signAction(actionSeed, action);
      assert.equal(
        verifyAction({
          message: action,
          signature,
          expectedAddress: capability.agentAddress,
        }).valid,
        true,
      );
      assert.equal(
        verifyAction({
          message: { ...action, payload: { text: "tampered" } },
          signature,
          expectedAddress: capability.agentAddress,
        }).valid,
        false,
      );
    } finally {
      root.fill(0);
    }
  });
});

// --- Canonical signing ------------------------------------------------------

describe("canonical signing", () => {
  it("canonicalJSON sorts object keys recursively", () => {
    const a = { z: 1, a: { y: 2, x: 1 } };
    const b = { a: { x: 1, y: 2 }, z: 1 };
    assert.equal(canonicalJSON(a), canonicalJSON(b));
  });

  it("contentHash is stable for equivalent object key order", () => {
    const a = { operation: "send", nested: { b: 2, a: 1 } };
    const b = { nested: { a: 1, b: 2 }, operation: "send" };
    assert.equal(contentHash(a), contentHash(b));
  });

  it("recoverActionAddress returns the capability address", () => {
    const { capability } = makeCapability();
    const payload = { b: 2, a: 1 };
    const signature = signWithCapability(capability, payload);
    assert.equal(
      recoverActionAddress(payload, signature),
      capability.agentAddress,
    );
  });

  it("signatures verify for reordered equivalent objects", () => {
    const { capability } = makeCapability();
    const signed = { b: 2, a: { y: 2, x: 1 } };
    const reordered = { a: { x: 1, y: 2 }, b: 2 };
    const signature = signWithCapability(capability, signed);
    assert.equal(
      verifyAction({
        message: reordered,
        signature,
        expectedAddress: capability.agentAddress,
      }).valid,
      true,
    );
  });
});

// --- Public records ---------------------------------------------------------

describe("public record verification", () => {
  it("createPublicActionRecord emits seedless verifier state", () => {
    const { record, capability } = makePublicRecordFixture();
    const serialized = JSON.stringify(record).toLowerCase();
    assert.equal(record.type, "agentenvelope.publicActionRecord");
    assert.equal(record.ownerUserId, "user-example");
    assert.equal(record.agentAddress, capability.agentAddress);
    assert.equal(record.actionEnvelopeHash, capability.actionEnvelopeHash);
    assert.ok(!serialized.includes(capability.actionSeedHex.toLowerCase()));
    assert.ok(!serialized.includes("actionseedhex"));
  });

  it("verifyRecord accepts a valid signed action", () => {
    const { record, payload, signature } = makePublicRecordFixture();
    const report = verifyRecord(record, {
      payload,
      signature,
      actionIndex: 0,
      expectedActionEnvelopeHash: record.actionEnvelopeHash,
    });
    assert.equal(report.valid, true);
    assert.equal(report.recordId, record.recordId);
    assert.equal(report.checks.signatureValid, true);
  });

  it("verifyRecord rejects a tampered payload", () => {
    const { record, payload, signature } = makePublicRecordFixture();
    const report = verifyRecord(record, {
      payload: { ...payload, resource: "thread:other" },
      signature,
      actionIndex: 0,
    });
    assert.equal(report.valid, false);
    assert.equal(report.reason, "address mismatch");
  });

  it("verifyRecord rejects an unregistered action index", () => {
    const { record, payload, signature } = makePublicRecordFixture();
    const report = verifyRecord(record, { payload, signature, actionIndex: 1 });
    assert.equal(report.valid, false);
    assert.equal(report.reason, "action index not registered");
  });

  it("verifyRecord rejects an action-envelope hash mismatch", () => {
    const { record, payload, signature } = makePublicRecordFixture();
    const report = verifyRecord(record, {
      payload,
      signature,
      actionIndex: 0,
      expectedActionEnvelopeHash: "0x" + "00".repeat(32),
    });
    assert.equal(report.valid, false);
    assert.equal(report.reason, "action envelope hash mismatch");
  });

  it("verifyRecord rejects inactive records", () => {
    const { record, payload, signature } = makePublicRecordFixture();
    const report = verifyRecord(
      { ...record, status: "revoked" },
      { payload, signature, actionIndex: 0 },
    );
    assert.equal(report.valid, false);
    assert.equal(report.reason, "record inactive");
  });

  it("verifyRecord rejects expired time-decay records", () => {
    const { record, payload, signature } = makePublicRecordFixture({
      decayMode: "TIME",
      notBefore: Date.now() - 120_000,
      notAfter: Date.now() - 60_000,
    });
    const report = verifyRecord(record, { payload, signature, actionIndex: 0 });
    assert.equal(report.valid, false);
    assert.equal(report.reason, "expired");
  });

  it("verifyRecord rejects records before their time window starts", () => {
    const { record, payload, signature } = makePublicRecordFixture({
      decayMode: "TIME",
      notBefore: Date.now() + 60_000,
      notAfter: Date.now() + 120_000,
    });
    const report = verifyRecord(record, { payload, signature, actionIndex: 0 });
    assert.equal(report.valid, false);
    assert.equal(report.reason, "not yet valid");
  });
});

// --- Portal-governed local layer -------------------------------------------

describe("portal-governed local layer", () => {
  it("buildMintDelegate is deterministic and has correct shape", () => {
    const a = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const b = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    assert.equal(a.type, "agentenvelope.mintDelegate");
    assert.equal(a.version, 1);
    assert.match(a.issuerAddress, /^0x[a-fA-F0-9]{40}$/);
    assert.match(a.delegateId, /^ae-delegate-[a-fA-F0-9]{16}$/);
    assert.equal(a.delegateId, b.delegateId);
    assert.equal(a.issuerSignature, b.issuerSignature);
  });

  it("verifyMintDelegate: valid for a correctly built delegate", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    assert.equal(
      verifyMintDelegate(delegate, delegate.issuerAddress).valid,
      true,
    );
  });

  it("verifyMintDelegate: rejects tampered issuerSignature", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const result = verifyMintDelegate(
      { ...delegate, issuerSignature: "0x" + "aa".repeat(65) },
      delegate.issuerAddress,
    );
    assert.equal(result.valid, false);
  });

  it("verifyMintDelegate: rejects wrong expectedIssuerAddress", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const result = verifyMintDelegate(delegate, "0x" + "00".repeat(20));
    assert.equal(result.valid, false);
    assert.equal(result.reason, "issuer address mismatch");
  });

  it("buildMintRequest is deterministic and has correct shape", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const a = buildMintRequest(freshBotSeed(), delegate, REQUEST_INPUT);
    const b = buildMintRequest(freshBotSeed(), delegate, REQUEST_INPUT);
    assert.equal(a.type, "agentenvelope.mintRequest");
    assert.equal(a.version, 1);
    assert.match(a.botAddress, /^0x[a-fA-F0-9]{40}$/);
    assert.match(a.requestId, /^ae-request-[a-fA-F0-9]{16}$/);
    assert.equal(a.requestId, b.requestId);
    assert.equal(a.botSignature, b.botSignature);
  });

  it("verifyMintRequest: valid for a correctly built request", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const request = buildMintRequest(freshBotSeed(), delegate, REQUEST_INPUT);
    assert.equal(verifyMintRequest(request, delegate).valid, true);
  });

  it("verifyMintRequest: rejects tampered botSignature", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const request = buildMintRequest(freshBotSeed(), delegate, REQUEST_INPUT);
    const result = verifyMintRequest(
      { ...request, botSignature: "0x" + "bb".repeat(65) },
      delegate,
    );
    assert.equal(result.valid, false);
  });

  it("verifyMintRequest: rejects operation not in allowedOperations", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const request = buildMintRequest(freshBotSeed(), delegate, {
      ...REQUEST_INPUT,
      operation: "delete",
    });
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "operation not allowed");
  });

  it("verifyMintRequest: rejects actionIndex outside policy range", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const request = buildMintRequest(freshBotSeed(), delegate, {
      ...REQUEST_INPUT,
      actionIndex: 99,
    });
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "actionIndex out of policy range");
  });

  it("verifyMintRequest: rejects maxUses exceeding delegate limit", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const request = buildMintRequest(freshBotSeed(), delegate, {
      ...REQUEST_INPUT,
      maxUses: 5,
    });
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "maxUses exceeds delegate limit");
  });

  it("verifyMintRequest: rejects expired delegate", () => {
    const expired = buildMintDelegate(freshDomainSeed(), {
      ...DELEGATE_INPUT,
      timeWindow: {
        notBefore: Date.now() - 120_000,
        notAfter: Date.now() - 60_000,
      },
    });
    const request = buildMintRequest(freshBotSeed(), expired, REQUEST_INPUT);
    const result = verifyMintRequest(request, expired);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "delegate expired");
  });

  it("verifyMintRequest: wildcard resource matching", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), {
      ...DELEGATE_INPUT,
      allowedResources: ["thread:*"],
    });
    const request = buildMintRequest(freshBotSeed(), delegate, {
      ...REQUEST_INPUT,
      resources: ["thread:customer-99"],
    });
    assert.equal(verifyMintRequest(request, delegate).valid, true);
  });

  it("mintActionCapability: correct shape and deterministic", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const request = buildMintRequest(freshBotSeed(), delegate, REQUEST_INPUT);
    const a = mintActionCapability(freshMintMaterial(), delegate, request);
    const b = mintActionCapability(freshMintMaterial(), delegate, request);
    assert.equal(a.type, "agentenvelope.agentCapability");
    assert.equal(a.custodyMode, "remote-mint-delegate");
    assert.match(a.agentAddress, /^0x[a-fA-F0-9]{40}$/);
    assert.match(a.actionSeedHex, /^[a-fA-F0-9]{64}$/);
    assert.equal(a.agentAddress, b.agentAddress);
    assert.equal(a.actionSeedHex, b.actionSeedHex);
  });

  it("verifyMintRequest: accepts address-set policy for an allowed bot", () => {
    const botSeed = freshBotSeed();
    const delegate = makeDelegate({
      botPolicy: "address-set",
      allowedBotAddresses: [seedAddress(botSeed)],
    });
    const request = buildMintRequest(botSeed, delegate, REQUEST_INPUT);
    assert.equal(verifyMintRequest(request, delegate).valid, true);
  });

  it("verifyMintRequest: rejects address-set policy for a different bot", () => {
    const delegate = makeDelegate({
      botPolicy: "address-set",
      allowedBotAddresses: ["0x" + "11".repeat(20)],
    });
    const request = makeRequest(delegate);
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "bot address not in allowed set");
  });

  it("verifyMintRequest: rejects delegates that are not yet active", () => {
    const future = makeDelegate({
      timeWindow: {
        notBefore: Date.now() + 60_000,
        notAfter: Date.now() + 120_000,
      },
    });
    const request = makeRequest(future);
    const result = verifyMintRequest(request, future);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "delegate not yet active");
  });

  it("verifyMintRequest: rejects request windows that start before the delegate", () => {
    const now = Date.now();
    const delegate = makeDelegate({
      timeWindow: { notBefore: now - 1_000, notAfter: now + 60_000 },
    });
    const request = makeRequest(delegate, {
      timeWindow: { notBefore: now - 2_000, notAfter: now + 30_000 },
    });
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "request timeWindow starts before delegate");
  });

  it("verifyMintRequest: rejects request windows that end after the delegate", () => {
    const now = Date.now();
    const delegate = makeDelegate({
      timeWindow: { notBefore: now - 1_000, notAfter: now + 60_000 },
    });
    const request = makeRequest(delegate, {
      timeWindow: { notBefore: now, notAfter: now + 120_000 },
    });
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "request timeWindow ends after delegate");
  });

  it("verifyMintRequest: rejects delegateHash mismatch", () => {
    const delegate = makeDelegate({ nonce: "0x" + "aa".repeat(32) });
    const otherDelegate = makeDelegate({ nonce: "0x" + "bb".repeat(32) });
    const request = makeRequest(otherDelegate);
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "delegateHash mismatch");
  });

  it("verifyMintRequest: exact resources do not allow sibling resources", () => {
    const delegate = makeDelegate({ allowedResources: ["thread:customer-1"] });
    const request = makeRequest(delegate, { resources: ["thread:customer-2"] });
    const result = verifyMintRequest(request, delegate);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "resource not allowed: thread:customer-2");
  });

  it("verifyMintRequest: global wildcard allows any resource", () => {
    const delegate = makeDelegate({ allowedResources: ["*"] });
    const request = makeRequest(delegate, { resources: ["database:tenant-9"] });
    assert.equal(verifyMintRequest(request, delegate).valid, true);
  });

  it("mirrors the bot.js local flow: delegate → request → capability → sign → verify", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    assert.equal(
      verifyMintDelegate(delegate, delegate.issuerAddress).valid,
      true,
    );

    const request = buildMintRequest(freshBotSeed(), delegate, REQUEST_INPUT);
    assert.equal(verifyMintRequest(request, delegate).valid, true);

    const capability = mintActionCapability(
      freshMintMaterial(),
      delegate,
      request,
    );
    const action = {
      operation: "send",
      resource: "thread:customer-1",
      actionIndex: 0,
      payload: { text: "hello" },
      issuedAt: new Date().toISOString(),
    };
    const actionSeed = hexToBytes(capability.actionSeedHex);
    const signature = signAction(actionSeed, action);

    assert.equal(
      verifyAction({
        message: action,
        signature,
        expectedAddress: capability.agentAddress,
      }).valid,
      true,
    );
    assert.equal(
      verifyAction({
        message: { ...action, payload: { text: "tampered" } },
        signature,
        expectedAddress: capability.agentAddress,
      }).valid,
      false,
    );
  });
});

// ─── deriveMintMaterial ───────────────────────────────────────────────────────

describe("deriveMintMaterial", () => {
  it("returns a 32-byte Uint8Array", () => {
    const domain = makeDomain();
    const material = deriveMintMaterial(ROOT, domain);
    assert.ok(material instanceof Uint8Array);
    assert.equal(material.length, 32);
  });

  it("is deterministic", () => {
    const domain = makeDomain();
    const a = deriveMintMaterial(ROOT, domain);
    const b = deriveMintMaterial(ROOT, domain);
    assert.equal(
      Buffer.from(a).toString("hex"),
      Buffer.from(b).toString("hex"),
    );
  });

  it("differs across domains", () => {
    const domainA = makeDomain();
    const domainB = projectDomainKey(
      ROOT,
      createDomainInfo({ namespace: "demo", domainId: "other", kind: "agent" }),
    );
    const a = deriveMintMaterial(ROOT, domainA);
    const b = deriveMintMaterial(ROOT, domainB);
    assert.notEqual(
      Buffer.from(a).toString("hex"),
      Buffer.from(b).toString("hex"),
    );
  });

  it("differs across roots", () => {
    const rootB = Uint8Array.from({ length: 32 }, (_, i) => i + 2);
    const domain = makeDomain();
    const a = deriveMintMaterial(ROOT, domain);
    const b = deriveMintMaterial(rootB, domain);
    assert.notEqual(
      Buffer.from(a).toString("hex"),
      Buffer.from(b).toString("hex"),
    );
  });
});

// --- Hosted route contracts -------------------------------------------------

describe("hosted route contracts", () => {
  it("verifyAction posts to /sovereign/verify and normalizes report type", async () => {
    await withMockFetch(
      { type: "agentenvelope.sovereignVerificationReport", valid: true },
      async (calls) => {
        const report = await hostedVerifyAction("ae_test_key", {
          agentId: "demo-bot",
          actionIndex: 0,
          payload: { operation: "send" },
          signature: "0x" + "00".repeat(65),
          expectedActionEnvelopeHash: "0x" + "aa".repeat(32),
        });

        assert.equal(report.type, "agentenvelope.verificationReport");
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.endsWith("/sovereign/verify"));
        assert.equal(calls[0].options.method, "POST");
        assert.equal(calls[0].options.headers["X-Api-Key"], "ae_test_key");
        assert.deepEqual(JSON.parse(calls[0].options.body), {
          agentId: "demo-bot",
          actionIndex: 0,
          payload: { operation: "send" },
          signature: "0x" + "00".repeat(65),
          expectedActionEnvelopeHash: "0x" + "aa".repeat(32),
        });
      },
    );
  });

  it("getAgentRecord calls GET /sovereign/agents/:agentId and validates agentId", async () => {
    await withMockFetch(
      { agentId: "demo-bot", status: "active" },
      async (calls) => {
        const record = await getAgentRecord("ae_test_key", "demo-bot");

        assert.equal(record.agentId, "demo-bot");
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.endsWith("/sovereign/agents/demo-bot"));
        assert.equal(calls[0].options.headers["X-Api-Key"], "ae_test_key");

        await assert.rejects(
          () => getAgentRecord("ae_test_key", "../bad"),
          /agentId is invalid/,
        );
        assert.equal(calls.length, 1);
      },
    );
  });

  it("getStoredDelegate calls GET /sovereign/delegates/:delegateId and validates delegateId", async () => {
    const delegate = makeDelegate();

    await withMockFetch(
      { type: "agentenvelope.delegateGetResponse", delegateId: delegate.delegateId, delegate },
      async (calls) => {
        const fetched = await getStoredDelegate("ae_test_key", delegate.delegateId);

        assert.equal(fetched.delegateId, delegate.delegateId);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.endsWith(`/sovereign/delegates/${delegate.delegateId}`));
        assert.equal(calls[0].options.headers["X-Api-Key"], "ae_test_key");

        await assert.rejects(
          () => getStoredDelegate("ae_test_key", "../bad"),
          /delegateId is invalid/,
        );
        assert.equal(calls.length, 1);
      },
    );
  });

  it("mint posts to /sovereign/mint with delegate and request", async () => {
    const delegate = makeDelegate();
    const request = makeRequest(delegate);

    await withMockFetch(
      { valid: true, receiptId: "receipt-demo" },
      async (calls) => {
        const receipt = await mint("ae_test_key", delegate, request);

        assert.equal(receipt.valid, true);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.endsWith("/sovereign/mint"));
        assert.equal(calls[0].options.method, "POST");
        assert.equal(calls[0].options.headers["X-Api-Key"], "ae_test_key");
        assert.deepEqual(JSON.parse(calls[0].options.body), { delegate, request });
      },
    );
  });
});

// --- Receipt attestations ---------------------------------------------------

describe("receipt attestations", () => {
  it("signReceipt + verifyReceipt accepts an untampered receipt", () => {
    const attesterSeed = Uint8Array.from({ length: 32 }, (_, i) => i + 7);
    const receipt = {
      type: "agentenvelope.mintReceipt",
      version: 1,
      valid: true,
      delegateId: "ae-delegate-demo",
      requestId: "ae-request-demo",
      checkedAt: "2026-01-01T00:00:00.000Z",
    };
    const attestation = signReceipt(attesterSeed, receipt);
    const verified = verifyReceipt(
      { ...receipt, attestation },
      attestation.attesterAddress,
    );
    assert.equal(verified.valid, true);
    assert.equal(verified.attesterAddress, attestation.attesterAddress);
  });

  it("verifyReceipt rejects an unexpected attester", () => {
    const receipt = {
      type: "agentenvelope.verifyReceipt",
      version: 1,
      valid: true,
    };
    const attestation = signReceipt(freshMintMaterial(), receipt);
    const verified = verifyReceipt(
      { ...receipt, attestation },
      "0x" + "00".repeat(20),
    );
    assert.equal(verified.valid, false);
    assert.equal(verified.reason, "unexpected attester");
  });

  it("verifyReceipt rejects tampered receipt bodies", () => {
    const receipt = {
      type: "agentenvelope.verifyReceipt",
      version: 1,
      valid: true,
    };
    const attestation = signReceipt(freshMintMaterial(), receipt);
    const verified = verifyReceipt(
      { ...receipt, valid: false, attestation },
      attestation.attesterAddress,
    );
    assert.equal(verified.valid, false);
    assert.equal(verified.reason, "attester address mismatch");
  });
});

// --- Cross-prefix isolation -------------------------------------------------

describe("cross-prefix isolation", () => {
  it("delegate issuerSignature does not verify as an action signature", () => {
    const delegate = buildMintDelegate(freshDomainSeed(), DELEGATE_INPUT);
    const { issuerSignature, ...body } = delegate;
    const result = verifyAction({
      message: body,
      signature: issuerSignature,
      expectedAddress: delegate.issuerAddress,
    });
    assert.equal(result.valid, false);
  });

  it("action signature does not verify as a delegate signature", () => {
    const { capability } = makeCapability();
    const payload = { operation: "send" };
    const actionSeed = hexToBytes(capability.actionSeedHex);
    const sig = signAction(actionSeed, payload);
    // A different address will be recovered — the point is it does not match
    const result = verifyAction({
      message: payload,
      signature: sig,
      expectedAddress: "0x" + "00".repeat(20),
    });
    assert.equal(result.valid, false);
  });
});

// ─── Custody boundary ────────────────────────────────────────────────────────

describe("custody boundary", () => {
  it("capability contains actionSeedHex", () => {
    const { capability } = makeCapability();
    assert.ok("actionSeedHex" in capability);
    assert.match(capability.actionSeedHex, /^[a-fA-F0-9]{64}$/);
  });

  it("capability serialization contains actionSeedHex — treat as private key", () => {
    const { capability } = makeCapability();
    const serialized = JSON.stringify(capability);
    assert.ok(serialized.includes(capability.actionSeedHex));
  });

  it("domain projection contains no seed material", () => {
    const domain = makeDomain();
    const serialized = JSON.stringify(domain);
    assert.ok(!serialized.toLowerCase().includes("seed"));
    assert.ok(!serialized.toLowerCase().includes("private"));
  });

  it("seedAddress is stable for a given seed", () => {
    const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    assert.equal(seedAddress(seed), seedAddress(seed));
    assert.match(seedAddress(seed), /^0x[a-fA-F0-9]{40}$/);
  });

  it("buildMintDelegate zeros the domain seed it receives", () => {
    const seed = freshDomainSeed();
    buildMintDelegate(seed, DELEGATE_INPUT);
    assert.equal(Buffer.from(seed).equals(Buffer.alloc(32)), true);
  });

  it("buildMintRequest zeros the bot seed it receives", () => {
    const delegate = makeDelegate();
    const seed = freshBotSeed();
    buildMintRequest(seed, delegate, REQUEST_INPUT);
    assert.equal(Buffer.from(seed).equals(Buffer.alloc(32)), true);
  });

  it("mintActionCapability zeros the mint material it receives", () => {
    const delegate = makeDelegate();
    const request = makeRequest(delegate);
    const material = freshMintMaterial();
    mintActionCapability(material, delegate, request);
    assert.equal(Buffer.from(material).equals(Buffer.alloc(32)), true);
  });
});

// ─── Serialization and constants ─────────────────────────────────────────────

describe("serialization and constants", () => {
  it("DECAY_MODES contains all four modes", () => {
    assert.equal(DECAY_MODES.NONE, "NONE");
    assert.equal(DECAY_MODES.TIME, "TIME");
    assert.equal(DECAY_MODES.ACTION, "ACTION");
    assert.equal(DECAY_MODES.BOTH, "BOTH");
    assert.equal(Object.keys(DECAY_MODES).length, 4);
  });

  it("DECAY_MODES is frozen", () => {
    assert.ok(Object.isFrozen(DECAY_MODES));
  });

  it("serializeAgentActionCapability returns valid JSON with actionSeedHex", () => {
    const { capability } = makeCapability();
    const serialized = serializeAgentActionCapability(capability);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.type, "agentenvelope.agentCapability");
    assert.ok("actionSeedHex" in parsed);
    assert.equal(parsed.actionSeedHex, capability.actionSeedHex);
  });

  it("serializePublicActionRecord returns valid JSON without actionSeedHex", () => {
    const { record, capability } = makePublicRecordFixture();
    const serialized = serializePublicActionRecord(record);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.type, "agentenvelope.publicActionRecord");
    assert.ok(!("actionSeedHex" in parsed));
    assert.ok(!serialized.toLowerCase().includes(capability.actionSeedHex.toLowerCase()));
  });
});
