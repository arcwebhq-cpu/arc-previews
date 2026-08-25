import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import {
  createArc1ConsumerStateCommitReceipt,
  createArc1ConsumerStateCreateReceipt,
  runArc1PrivateStateConsumerJob,
} from "../scripts/arc1_consumer_runtime.mjs";
import {
  ARC1_CONSUMER_CLAIM_ENDPOINT,
  ARC1_CONSUMER_COMPLETION_ENDPOINT,
  ARC1_CONSUMER_PACKET_SCHEMA,
  canonicalJson,
} from "../scripts/arc1_consumer_contract.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const hmac = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");
const packetSecret = "runtime-packet-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const consumerBearer = "runtime-consumer-bearer-0123456789-abcdefghijklmnopqrstuvwxyz";
const receiptSecret = "runtime-receipt-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const durableResultSecret = "runtime-durable-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const deliveryId = "a".repeat(64);
const bridgeEvidenceSha256 = "b".repeat(64);
const ingressStateDigestSha256 = "c".repeat(64);
const claimToken = "f".repeat(64);
const piiMarker = "PRIVATE-CUSTOMER-NAME-NEVER-DURABLE";

const env = {
  ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: "true",
  ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED: "true",
  ARC_INTAKE_ARC1_PACKET_SECRET: packetSecret,
  ARC_INTAKE_ARC1_CONSUMER_BEARER: consumerBearer,
  ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET: receiptSecret,
  ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET: durableResultSecret,
  ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS: "1000",
  ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED: "true",
  ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED: "true",
  ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED: "true",
  ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED: "true",
};

function makePacket(nowMs, suffix = "") {
  const issuedAt = new Date(nowMs - 2_000).toISOString();
  const expiresAt = new Date(nowMs + 20 * 60_000).toISOString();
  const actualDeliveryId = suffix ? sha256(`${deliveryId}:${suffix}`) : deliveryId;
  const bridgeEnvelope = canonicalJson({
    schema: "arc-intake-arc1-bridge-envelope-v1",
    evidence: { business: piiMarker, delivery_id: actualDeliveryId },
    hmac_sha256: "d".repeat(64),
  });
  const assetReceipt = canonicalJson({ delivery_id: actualDeliveryId, bridge_evidence_sha256: bridgeEvidenceSha256 });
  const unsigned = {
    schema: ARC1_CONSUMER_PACKET_SCHEMA,
    protocol_version: 2,
    packet_issued_at: issuedAt,
    packet_expires_at: expiresAt,
    claim_endpoint: ARC1_CONSUMER_CLAIM_ENDPOINT,
    completion_endpoint: ARC1_CONSUMER_COMPLETION_ENDPOINT,
    bridge_envelope_json: bridgeEnvelope,
    consumer_schema: "arc1-function-intake-adapter-v1",
    bridge_contract_sha256: "e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841",
    bridge_delivery_id: actualDeliveryId,
    bridge_evidence_sha256: bridgeEvidenceSha256,
    bridge_evidence_expires_at: expiresAt,
    bridge_evidence_issued_at: issuedAt,
    asset_receipt_private: assetReceipt,
    asset_receipt_hmac_sha256: "e".repeat(64),
    asset_receipt_sha256: sha256(assetReceipt),
    ingress_state_key: `arc1-function-ingress-v1:${ingressStateDigestSha256}`,
    ingress_state_digest_sha256: ingressStateDigestSha256,
    ingress_claim_mode: "CREATED",
    ingress_claim_status: "CLAIMED",
    ingress_claim_state_key: `arc1-function-ingress-v1:${ingressStateDigestSha256}`,
    ingress_claim_state_digest_sha256: ingressStateDigestSha256,
    ingress_claim_bridge_delivery_id: actualDeliveryId,
    ingress_claim_bridge_evidence_sha256: bridgeEvidenceSha256,
    ingress_claim_asset_receipt_sha256: sha256(assetReceipt),
    ingress_claim_created_at: issuedAt,
  };
  return canonicalJson({
    ...unsigned,
    packet_hmac_sha256: hmac(packetSecret, `arc-intake-arc1-downstream-packet-v2\n${canonicalJson(unsigned)}`),
  });
}

function jsonResponse(url, status, value) {
  const raw = canonicalJson(value);
  const response = new Response(raw, {
    status,
    headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(raw)) },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function responseForRequest(url, options, nowMs, { replay = false } = {}) {
  const request = JSON.parse(options.body);
  if (url === ARC1_CONSUMER_CLAIM_ENDPOINT) {
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1",
      status: "CLAIMED",
      delivery_id: request.delivery_id,
      packet_sha256: request.packet_sha256,
      consumer_attempt_id: request.consumer_attempt_id,
      claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(),
      claim_expires_at: new Date(nowMs + 15 * 60_000).toISOString(),
      idempotent_replay: replay,
    });
  }
  assert.equal(url, ARC1_CONSUMER_COMPLETION_ENDPOINT);
  return jsonResponse(url, 200, {
    schema: "arc-intake-arc1-consumer-completion-v1",
    status: "COMPLETED",
    delivery_id: request.delivery_id,
    packet_sha256: request.packet_sha256,
    consumer_attempt_id: request.consumer_attempt_id,
    completed_at: request.completed_at,
    result_sha256: request.result_sha256,
    completion_receipt_sha256: sha256(options.body),
    idempotent_replay: replay,
  });
}

const bundleSource = await readFile(new URL("../zapier/arc1_consumer_runtime.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../zapier/arc1_consumer_runtime.manifest.json", import.meta.url), "utf8"));
assert.equal(sha256(bundleSource), manifest.bundle_sha256);
assert.equal(manifest.execution.external_calls_default_off, true);
assert.equal(Object.values(manifest.activation_flags).every(value => value === false), true);
assert.doesNotMatch(bundleSource, /console\.(?:log|info|debug|warn|error)/);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const executeBundle = new AsyncFunction("inputData", "fetch", "require", "process", bundleSource);
const nodeRequire = createRequire(import.meta.url);
const runtimeProcess = { env: {
  ...env,
  ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED: "false",
} };

const nowMs = Date.now();
const packetRaw = makePacket(nowMs);
let claimCalls = 0;
let firstClaimBody;
const claimFetch = async (url, options) => {
  claimCalls += 1;
  assert.equal(url, ARC1_CONSUMER_CLAIM_ENDPOINT);
  assert.equal(options.headers.Authorization, `Bearer ${consumerBearer}`);
  assert.equal(options.redirect, "error");
  if (claimCalls === 1) {
    firstClaimBody = options.body;
    throw new Error("ambiguous reset after claim commit");
  }
  assert.equal(options.body, firstClaimBody, "The distributable must retry a claim byte-for-byte.");
  return responseForRequest(url, options, nowMs, { replay: true });
};
const baseInput = { ARC1_PACKET_JSON: packetRaw };
const claimOutput = await executeBundle({
  ...baseInput,
  ARC1_CONSUMER_PHASE: "CLAIM",
  ARC1_STABLE_ATTEMPT_ID: "provider-run-attempt-000000000000000001",
}, claimFetch, nodeRequire, runtimeProcess);
assert.equal(claimOutput.status, "ARC1_CONSUMER_CLAIM_PREPARED");
assert.equal(claimOutput.private_state_operation, "CREATE_OR_EXACT");
assert.match(claimOutput.private_state_key, /^arc1-consumer-private-v1:[a-f0-9]{64}$/);
assert.match(claimOutput.private_state_idempotency_key, /^arc1state_[a-f0-9]{40}$/);
assert.equal(claimOutput.private_state_private_only, true);
assert.equal(claimOutput.private_state_history_logging_allowed, false);
assert.equal(claimCalls, 2);
assert.doesNotMatch(JSON.stringify(claimOutput), new RegExp(piiMarker));
assert.doesNotMatch(claimOutput.private_state_json, /bridge_envelope_json|asset_receipt_private|business|email|name/);
assert.match(claimOutput.private_state_json, new RegExp(claimToken), "The capability token is private state, not log output.");
assert.doesNotMatch(claimOutput.log_safe_json, new RegExp(claimToken));
assert.doesNotMatch(claimOutput.log_safe_json, new RegExp(packetSecret));
assert.doesNotMatch(claimOutput.log_safe_json, new RegExp(consumerBearer));
assert.equal(Object.hasOwn(claimOutput, "packet_json"), false);

let ordinaryInputSecretFetches = 0;
await assert.rejects(executeBundle({
  ...baseInput,
  ...env,
  ARC1_CONSUMER_PHASE: "CLAIM",
  ARC1_STABLE_ATTEMPT_ID: "provider-run-attempt-000000000000000001",
}, async () => { ordinaryInputSecretFetches += 1; }, nodeRequire, { env: {} }), /RUNTIME_DISABLED/);
assert.equal(ordinaryInputSecretFetches, 0,
  "Secrets and activation controls in ordinary inputData are ignored unless the host enables the compatibility path.");

const privateState = JSON.parse(claimOutput.private_state_json);
const createReceipt = createArc1ConsumerStateCreateReceipt({
  stateKey: claimOutput.private_state_key,
  stateSha256: claimOutput.private_state_sha256,
  consumerAttemptId: privateState.consumer_attempt_id,
  storedAt: new Date(nowMs).toISOString(),
  providerReceiptSha256: "1".repeat(64),
  idempotentReplay: false,
}, env);
let authorizeFetches = 0;
const authorizeOutput = await executeBundle({
  ...baseInput,
  ARC1_CONSUMER_PHASE: "AUTHORIZE",
  ARC1_PRIVATE_STATE_JSON: claimOutput.private_state_json,
  ARC1_PRIVATE_STATE_HMAC_SHA256: claimOutput.private_state_hmac_sha256,
  ARC1_STATE_CREATE_RECEIPT_JSON: createReceipt.raw,
  ARC1_STATE_CREATE_RECEIPT_HMAC_SHA256: createReceipt.hmacSha256,
}, async () => { authorizeFetches += 1; }, nodeRequire, runtimeProcess);
assert.equal(authorizeFetches, 0);
assert.equal(authorizeOutput.status, "ARC1_CONSUMER_MUTATION_AUTHORIZED");
assert.match(authorizeOutput.mutation_idempotency_key, /^arc1mutation_[a-f0-9]{40}$/);
assert.doesNotMatch(JSON.stringify(authorizeOutput), new RegExp(piiMarker));

const commitReceipt = createArc1ConsumerStateCommitReceipt({
  stateKey: claimOutput.private_state_key,
  stateSha256: claimOutput.private_state_sha256,
  consumerAttemptId: privateState.consumer_attempt_id,
  immutableResultSha256: "2".repeat(64),
  committedAt: new Date(nowMs + 1_000).toISOString(),
  providerReceiptSha256: "3".repeat(64),
}, env);
let completionCalls = 0;
let firstCompletionBody;
const completionFetch = async (url, options) => {
  completionCalls += 1;
  assert.equal(url, ARC1_CONSUMER_COMPLETION_ENDPOINT);
  assert.equal(options.headers.Authorization, `Bearer ${consumerBearer}`);
  if (completionCalls === 1) {
    firstCompletionBody = options.body;
    return jsonResponse(url, 503, { error: "temporary" });
  }
  assert.equal(options.body, firstCompletionBody, "The distributable must retry completion byte-for-byte.");
  assert.equal(options.headers["X-ARC-Completion-HMAC-SHA256"], hmac(receiptSecret,
    `arc-intake-arc1-consumer-completion-v1\n${options.body}`));
  return responseForRequest(url, options, nowMs, { replay: true });
};
const completionOutput = await executeBundle({
  ...baseInput,
  ARC1_CONSUMER_PHASE: "COMPLETE",
  ARC1_PRIVATE_STATE_JSON: claimOutput.private_state_json,
  ARC1_PRIVATE_STATE_HMAC_SHA256: claimOutput.private_state_hmac_sha256,
  ARC1_STATE_CREATE_RECEIPT_JSON: createReceipt.raw,
  ARC1_STATE_CREATE_RECEIPT_HMAC_SHA256: createReceipt.hmacSha256,
  ARC1_STATE_COMMIT_RECEIPT_JSON: commitReceipt.raw,
  ARC1_STATE_COMMIT_RECEIPT_HMAC_SHA256: commitReceipt.hmacSha256,
}, completionFetch, nodeRequire, runtimeProcess);
assert.equal(completionOutput.status, "ARC1_CONSUMER_COMPLETED");
assert.equal(completionOutput.terminal_cleanup_allowed, true);
assert.equal(completionCalls, 2);
assert.doesNotMatch(JSON.stringify(completionOutput), new RegExp(piiMarker));

// Every independent switch is a pre-network gate in the actual pasteable
// artifact, including the provider-history redaction attestation.
for (const switchName of [
  "ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED",
  "ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED",
  "ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED",
  "ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED",
  "ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED",
  "ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED",
]) {
  let disabledFetches = 0;
  const disabledProcess = { env: { ...runtimeProcess.env, [switchName]: "false" } };
  await assert.rejects(executeBundle({
    ...baseInput,
    ARC1_CONSUMER_PHASE: "CLAIM",
    ARC1_STABLE_ATTEMPT_ID: "provider-run-attempt-000000000000000001",
  }, async () => { disabledFetches += 1; }, nodeRequire, disabledProcess), /DISABLED|NOT_ATTESTED/);
  assert.equal(disabledFetches, 0, `${switchName} must fail before fetch.`);
}

await assert.rejects(executeBundle({
  ...baseInput,
  ARC1_CONSUMER_PHASE: "AUTHORIZE",
  ARC1_PRIVATE_STATE_JSON: claimOutput.private_state_json,
  ARC1_PRIVATE_STATE_HMAC_SHA256: "0".repeat(64),
  ARC1_STATE_CREATE_RECEIPT_JSON: createReceipt.raw,
  ARC1_STATE_CREATE_RECEIPT_HMAC_SHA256: createReceipt.hmacSha256,
}, async () => { throw new Error("must not fetch"); }, nodeRequire, runtimeProcess), /private state HMAC/);

// Execute the importable provider-neutral runtime, including create-or-exact
// durability, mutation authorization, provider work, result commit, and signed
// terminal completion. The adapters below are in-memory fakes; no live call is
// made by this test.
const orchestrationNowMs = Date.now();
const orchestrationPacket = makePacket(orchestrationNowMs, "orchestration");
let stateCreated = false;
let providerExecuted = false;
let stateCommitted = false;
const authoritativePrivateState = new Map();
const orchestrationFetch = async (url, options) => responseForRequest(url, options, orchestrationNowMs);
const orchestrationResult = await runArc1PrivateStateConsumerJob(
  orchestrationPacket,
  "provider-run-attempt-000000000000000002",
  env,
  {
    fetch: orchestrationFetch,
    privateState: {
      async createOrExact(operation, { signal }) {
        assert.equal(signal instanceof AbortSignal, true);
        assert.equal(signal.aborted, false);
        const record = JSON.parse(operation.stateRaw);
        const existing = authoritativePrivateState.get(operation.stateKey);
        if (existing && existing.stateRaw !== operation.stateRaw) throw new Error("synthetic create conflict");
        if (!existing) authoritativePrivateState.set(operation.stateKey, {
          stateRaw: operation.stateRaw,
          stateSha256: operation.stateSha256,
        });
        const readback = authoritativePrivateState.get(operation.stateKey);
        assert.equal(readback.stateRaw, operation.stateRaw);
        assert.equal(readback.stateSha256, operation.stateSha256);
        stateCreated = true;
        return createArc1ConsumerStateCreateReceipt({
          stateKey: operation.stateKey,
          stateSha256: operation.stateSha256,
          consumerAttemptId: record.consumer_attempt_id,
          storedAt: new Date(orchestrationNowMs).toISOString(),
          providerReceiptSha256: sha256(canonicalJson(readback)),
          idempotentReplay: Boolean(existing),
        }, env);
      },
      async commitResult(operation, { signal }) {
        assert.equal(signal instanceof AbortSignal, true);
        assert.equal(signal.aborted, false);
        assert.equal(stateCreated, true);
        assert.equal(providerExecuted, true);
        const stored = authoritativePrivateState.get(operation.stateKey);
        assert.equal(stored.stateSha256, operation.stateSha256);
        stored.immutableResultSha256 = operation.immutableResultSha256;
        stored.commitIdempotencyKey = operation.commitIdempotencyKey;
        const readback = authoritativePrivateState.get(operation.stateKey);
        assert.equal(readback.immutableResultSha256, operation.immutableResultSha256);
        stateCommitted = true;
        return createArc1ConsumerStateCommitReceipt({
          stateKey: operation.stateKey,
          stateSha256: operation.stateSha256,
          consumerAttemptId: operation.consumerAttemptId,
          immutableResultSha256: operation.immutableResultSha256,
          committedAt: new Date(orchestrationNowMs + 1_000).toISOString(),
          providerReceiptSha256: sha256(canonicalJson(readback)),
        }, env);
      },
    },
    async execute(context) {
      assert.equal(stateCreated, true, "Durable state must exist before provider work.");
      assert.equal(stateCommitted, false);
      context.assertActive();
      assert.match(context.mutationIdempotencyKey, /^arc1mutation_[a-f0-9]{40}$/);
      assert.doesNotMatch(JSON.stringify(context), new RegExp(piiMarker));
      providerExecuted = true;
      return { immutableResultSha256: "6".repeat(64) };
    },
  },
);
assert.equal(orchestrationResult.status, "ARC1_CONSUMER_COMPLETED");
assert.equal(stateCreated && providerExecuted && stateCommitted, true);

const shortPrivateStateEnv = {
  ...env,
  ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS: "100",
};
let invalidPrivateStateTimeoutFetches = 0;
await assert.rejects(runArc1PrivateStateConsumerJob(
  makePacket(Date.now(), "invalid-private-state-timeout"),
  "provider-run-attempt-invalid-timeout-00001",
  { ...env, ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS: "5001" },
  {
    fetch: async () => { invalidPrivateStateTimeoutFetches += 1; },
    privateState: { createOrExact() {}, commitResult() {} },
    execute() {},
  },
), /ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS/);
assert.equal(invalidPrivateStateTimeoutFetches, 0, "An invalid adapter ceiling must fail before claim/network work.");

// A private-state create that ignores cancellation is still bounded locally.
// Provider work and completion must never start, and the adapter receives an
// AbortSignal so a cooperative implementation can cancel its own request.
const hungCreateNowMs = Date.now();
const hungCreatePacket = makePacket(hungCreateNowMs, "hung-create");
let hungCreateSignal;
let hungCreateSignalAborted = false;
let hungCreateProviderCalls = 0;
const hungCreateFetchUrls = [];
const hungCreateStartedAt = Date.now();
await assert.rejects(runArc1PrivateStateConsumerJob(
  hungCreatePacket,
  "provider-run-attempt-hung-create-000000001",
  shortPrivateStateEnv,
  {
    fetch: async (url, options) => {
      hungCreateFetchUrls.push(url);
      return responseForRequest(url, options, hungCreateNowMs);
    },
    privateState: {
      async createOrExact(_operation, { signal }) {
        hungCreateSignal = signal;
        signal.addEventListener("abort", () => { hungCreateSignalAborted = true; }, { once: true });
        return new Promise(() => {});
      },
      async commitResult() { throw new Error("hung create must not reach commit"); },
    },
    async execute() { hungCreateProviderCalls += 1; },
  },
), /ARC1_RUNTIME_PRIVATE_STATE_TIMEOUT: CREATE_OR_EXACT/);
assert.ok(Date.now() - hungCreateStartedAt < 1_000);
assert.equal(hungCreateSignal instanceof AbortSignal, true);
assert.equal(hungCreateSignal.aborted, true);
assert.equal(hungCreateSignalAborted, true);
assert.equal(hungCreateProviderCalls, 0);
assert.deepEqual(hungCreateFetchUrls, [ARC1_CONSUMER_CLAIM_ENDPOINT]);

const claimCappedNowMs = Date.now();
const claimCappedPacket = makePacket(claimCappedNowMs, "claim-deadline-cap");
let claimCappedSignalAborted = false;
let claimCappedProviderCalls = 0;
const claimCappedStartedAt = Date.now();
await assert.rejects(runArc1PrivateStateConsumerJob(
  claimCappedPacket,
  "provider-run-attempt-claim-cap-000000001",
  env,
  {
    fetch: async (url, options) => {
      const request = JSON.parse(options.body);
      return jsonResponse(url, 200, {
        schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: request.delivery_id,
        packet_sha256: request.packet_sha256, consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
        claimed_at: new Date(claimCappedNowMs - 1_000).toISOString(),
        claim_expires_at: new Date(claimCappedNowMs + 2_000).toISOString(), idempotent_replay: false,
      });
    },
    privateState: {
      async createOrExact(_operation, { signal }) {
        signal.addEventListener("abort", () => { claimCappedSignalAborted = true; }, { once: true });
        return new Promise(() => {});
      },
      async commitResult() { throw new Error("claim-capped create must not reach commit"); },
    },
    async execute() { claimCappedProviderCalls += 1; },
  },
), /ARC1_CONSUMER_CLAIM_EXPIRED/);
assert.ok(Date.now() - claimCappedStartedAt < 3_500,
  "The claim deadline must cap a longer private-state adapter ceiling.");
assert.equal(claimCappedSignalAborted, true);
assert.equal(claimCappedProviderCalls, 0);

// A hung result commit is independently bounded under the same active claim.
// It must not post completion even after provider work has returned.
const hungCommitNowMs = Date.now();
const hungCommitPacket = makePacket(hungCommitNowMs, "hung-commit");
let hungCommitSignal;
let hungCommitSignalAborted = false;
let hungCommitProviderCalls = 0;
const hungCommitFetchUrls = [];
await assert.rejects(runArc1PrivateStateConsumerJob(
  hungCommitPacket,
  "provider-run-attempt-hung-commit-00000001",
  shortPrivateStateEnv,
  {
    fetch: async (url, options) => {
      hungCommitFetchUrls.push(url);
      return responseForRequest(url, options, hungCommitNowMs);
    },
    privateState: {
      async createOrExact(operation, { signal }) {
        assert.equal(signal.aborted, false);
        const record = JSON.parse(operation.stateRaw);
        return createArc1ConsumerStateCreateReceipt({
          stateKey: operation.stateKey,
          stateSha256: operation.stateSha256,
          consumerAttemptId: record.consumer_attempt_id,
          storedAt: new Date(hungCommitNowMs).toISOString(),
          providerReceiptSha256: "a".repeat(64),
          idempotentReplay: false,
        }, shortPrivateStateEnv);
      },
      async commitResult(_operation, { signal }) {
        hungCommitSignal = signal;
        signal.addEventListener("abort", () => { hungCommitSignalAborted = true; }, { once: true });
        return new Promise(() => {});
      },
    },
    async execute(context) {
      hungCommitProviderCalls += 1;
      context.assertActive();
      return { immutableResultSha256: "b".repeat(64) };
    },
  },
), /ARC1_RUNTIME_PRIVATE_STATE_TIMEOUT: COMMIT_RESULT_EXACT/);
assert.equal(hungCommitSignal instanceof AbortSignal, true);
assert.equal(hungCommitSignal.aborted, true);
assert.equal(hungCommitSignalAborted, true);
assert.equal(hungCommitProviderCalls, 1);
assert.deepEqual(hungCommitFetchUrls, [ARC1_CONSUMER_CLAIM_ENDPOINT],
  "A commit timeout must not post terminal completion.");

// Crash after an authoritative create, then replay the same workflow attempt.
// The second run must exact-replay the identical CAS record instead of creating
// changed attempt state, and only the recovered run may commit and complete.
const replayNowMs = Date.now();
const replayPacket = makePacket(replayNowMs, "crash-replay");
const replayState = new Map();
let replayCreates = 0;
let replayExactCreates = 0;
let replayCommits = 0;
let replayClaims = 0;
const replayFetch = async (url, options) => {
  if (url === ARC1_CONSUMER_CLAIM_ENDPOINT) replayClaims += 1;
  return responseForRequest(url, options, replayNowMs, { replay: replayClaims > 1 });
};
const replayPrivateState = {
  async createOrExact(operation, { signal }) {
    assert.equal(signal instanceof AbortSignal, true);
    assert.equal(signal.aborted, false);
    replayCreates += 1;
    const existing = replayState.get(operation.stateKey);
    if (existing && existing.raw !== operation.stateRaw) throw new Error("ARC1_TEST_PRIVATE_STATE_CONFLICT");
    if (!existing) replayState.set(operation.stateKey, { raw: operation.stateRaw, sha256: operation.stateSha256 });
    else replayExactCreates += 1;
    const readback = replayState.get(operation.stateKey);
    const record = JSON.parse(readback.raw);
    return createArc1ConsumerStateCreateReceipt({
      stateKey: operation.stateKey,
      stateSha256: readback.sha256,
      consumerAttemptId: record.consumer_attempt_id,
      storedAt: new Date(replayNowMs).toISOString(),
      providerReceiptSha256: sha256(canonicalJson(readback)),
      idempotentReplay: Boolean(existing),
    }, env);
  },
  async commitResult(operation, { signal }) {
    assert.equal(signal instanceof AbortSignal, true);
    assert.equal(signal.aborted, false);
    const stored = replayState.get(operation.stateKey);
    assert.equal(stored.sha256, operation.stateSha256);
    replayCommits += 1;
    return createArc1ConsumerStateCommitReceipt({
      stateKey: operation.stateKey,
      stateSha256: operation.stateSha256,
      consumerAttemptId: operation.consumerAttemptId,
      immutableResultSha256: operation.immutableResultSha256,
      committedAt: new Date(replayNowMs + 1_000).toISOString(),
      providerReceiptSha256: sha256(canonicalJson({ ...stored, result: operation.immutableResultSha256 })),
    }, env);
  },
};
await assert.rejects(runArc1PrivateStateConsumerJob(
  replayPacket,
  "provider-run-attempt-crash-replay-0000001",
  env,
  {
    fetch: replayFetch,
    privateState: replayPrivateState,
    async execute() { throw new Error("synthetic crash after durable create"); },
  },
), /synthetic crash after durable create/);
const recoveredReplay = await runArc1PrivateStateConsumerJob(
  replayPacket,
  "provider-run-attempt-crash-replay-0000001",
  env,
  {
    fetch: replayFetch,
    privateState: replayPrivateState,
    async execute(context) {
      context.assertActive();
      return { immutableResultSha256: "c".repeat(64) };
    },
  },
);
assert.equal(recoveredReplay.status, "ARC1_CONSUMER_COMPLETED");
assert.equal(replayCreates, 2);
assert.equal(replayExactCreates, 1);
assert.equal(replayState.size, 1);
assert.equal(replayCommits, 1);

console.log("ARC1 runnable consumer passed: signed claims, durable PII-free state, mutation fencing, bounded adapter signals/deadlines, crash-exact replay, exact network retries, and signed completion remain default-off.");
