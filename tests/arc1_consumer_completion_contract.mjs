import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import {
  ARC1_CONSUMER_CLAIM_ENDPOINT,
  ARC1_CONSUMER_COMPLETION_ENDPOINT,
  ARC1_CONSUMER_PACKET_SCHEMA,
  canonicalJson,
  claimArc1ConsumerPacket,
  completeArc1ConsumerPacket,
  createArc1DurableResultReceipt,
  runArc1ConsumerJob,
  verifyArc1ConsumerPacket,
  verifyArc1MutationFence,
} from "../scripts/arc1_consumer_contract.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");
const nowMs = Date.parse("2030-01-02T03:04:05.000Z");
const clock = () => new Date(nowMs);
const deliveryId = "a".repeat(64);
const bridgeEvidenceSha256 = "b".repeat(64);
const ingressStateDigestSha256 = "c".repeat(64);
const ingressStateKey = `arc1-function-ingress-v1:${ingressStateDigestSha256}`;
const packetSecret = "packet-secret-unique-0123456789-abcdefghijklmnopqrstuvwxyz";
const consumerBearer = "consumer-bearer-unique-0123456789-abcdefghijklmnopqrstuvwxyz";
const receiptSecret = "consumer-receipt-unique-0123456789-abcdefghijklmnopqrstuvwxyz";
const durableResultSecret = "durable-result-unique-0123456789-abcdefghijklmnopqrstuvwxyz";
const stableAttemptId = "zap-workflow-attempt-0000000000000001";
const otherStableAttemptId = "zap-workflow-attempt-0000000000000002";

const env = {
  ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: "true",
  ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED: "true",
  ARC_INTAKE_ARC1_PACKET_SECRET: packetSecret,
  ARC_INTAKE_ARC1_CONSUMER_BEARER: consumerBearer,
  ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET: receiptSecret,
  ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET: durableResultSecret,
  ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS: "1000",
};

function makePacket({
  issuedAt = nowMs - 60_000,
  bridgeIssuedAtMs = issuedAt,
  expiresAt = nowMs + 60 * 60_000,
  ingressClaimedAtMs = issuedAt,
} = {}) {
  const packetIssuedAt = new Date(issuedAt).toISOString();
  const bridgeIssuedAt = new Date(bridgeIssuedAtMs).toISOString();
  const bridgeExpiresAt = new Date(expiresAt).toISOString();
  const bridgeEnvelope = canonicalJson({
    schema: "arc-intake-arc1-bridge-envelope-v1",
    evidence: { delivery_id: deliveryId },
    hmac_sha256: "d".repeat(64),
  });
  const assetReceipt = canonicalJson({ delivery_id: deliveryId, bridge_evidence_sha256: bridgeEvidenceSha256 });
  const unsigned = {
    schema: ARC1_CONSUMER_PACKET_SCHEMA,
    protocol_version: 2,
    packet_issued_at: packetIssuedAt,
    packet_expires_at: bridgeExpiresAt,
    claim_endpoint: ARC1_CONSUMER_CLAIM_ENDPOINT,
    completion_endpoint: ARC1_CONSUMER_COMPLETION_ENDPOINT,
    bridge_envelope_json: bridgeEnvelope,
    consumer_schema: "arc1-function-intake-adapter-v1",
    bridge_contract_sha256: "c4ab396bf04464629624dd19a37602755c8d429db0bf729b49bbfdfdba3ae20c",
    bridge_delivery_id: deliveryId,
    bridge_evidence_sha256: bridgeEvidenceSha256,
    bridge_evidence_expires_at: bridgeExpiresAt,
    bridge_evidence_issued_at: bridgeIssuedAt,
    asset_receipt_private: assetReceipt,
    asset_receipt_hmac_sha256: "e".repeat(64),
    asset_receipt_sha256: sha256(assetReceipt),
    ingress_state_key: ingressStateKey,
    ingress_state_digest_sha256: ingressStateDigestSha256,
    ingress_claim_mode: "CREATED",
    ingress_claim_status: "CLAIMED",
    ingress_claim_state_key: ingressStateKey,
    ingress_claim_state_digest_sha256: ingressStateDigestSha256,
    ingress_claim_bridge_delivery_id: deliveryId,
    ingress_claim_bridge_evidence_sha256: bridgeEvidenceSha256,
    ingress_claim_asset_receipt_sha256: sha256(assetReceipt),
    ingress_claim_created_at: new Date(ingressClaimedAtMs).toISOString(),
  };
  return canonicalJson({
    ...unsigned,
    packet_hmac_sha256: hmac(packetSecret, `arc-intake-arc1-downstream-packet-v2\n${canonicalJson(unsigned)}`),
  });
}

function jsonResponse(url, status, value, { declaredLength } = {}) {
  const raw = canonicalJson(value);
  const response = new Response(raw, { status, headers: {
    "Content-Type": "application/json",
    "Content-Length": String(declaredLength ?? Buffer.byteLength(raw)),
  } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const packetRaw = makePacket();
const verified = verifyArc1ConsumerPacket(packetRaw, env, { clock });
assert.equal(verified.packet.schema, ARC1_CONSUMER_PACKET_SCHEMA);
assert.equal(verified.packetSha256, sha256(packetRaw));

const futureBridgeClockPacket = makePacket({ issuedAt: nowMs, bridgeIssuedAtMs: nowMs + 1_000, expiresAt: nowMs + 60 * 60_000 });
assert.equal(verifyArc1ConsumerPacket(futureBridgeClockPacket, env, { clock }).packet.bridge_evidence_issued_at,
  new Date(nowMs + 1_000).toISOString(), "The reviewed five-minute producer clock skew must remain interoperable.");

const calls = [];
let claimRequest;
let claimToken = "f".repeat(64);
const positiveFetch = async (url, options) => {
  calls.push({ url, options, raw: options.body });
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, `Bearer ${consumerBearer}`);
  if (url === ARC1_CONSUMER_CLAIM_ENDPOINT) {
    claimRequest = JSON.parse(options.body);
    assert.equal(options.headers["Idempotency-Key"], claimRequest.consumer_attempt_id);
    assert.match(claimRequest.consumer_attempt_id, /^arc1attempt_[a-f0-9]{40}$/);
    assert.deepEqual(Object.keys(claimRequest).sort(), [
      "consumer_attempt_id", "delivery_id", "packet_sha256", "requested_at", "schema",
    ].sort());
    assert.equal(claimRequest.requested_at, verified.packet.packet_issued_at,
      "The create/exact-replay claim body must remain byte-identical across lost responses.");
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1",
      status: "CLAIMED",
      delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw),
      consumer_attempt_id: claimRequest.consumer_attempt_id,
      claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(),
      claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: false,
    });
  }
  assert.equal(url, ARC1_CONSUMER_COMPLETION_ENDPOINT);
  const completion = JSON.parse(options.body);
  assert.equal(options.headers["Idempotency-Key"], `arc1complete_${completion.result_sha256.slice(0, 40)}`);
  assert.equal(options.headers["X-ARC-Completion-HMAC-SHA256"], hmac(receiptSecret,
    `arc-intake-arc1-consumer-completion-v1\n${options.body}`));
  assert.equal(completion.claim_token, claimToken);
  assert.equal(completion.consumer_attempt_id, claimRequest.consumer_attempt_id);
  return jsonResponse(url, 200, {
    schema: "arc-intake-arc1-consumer-completion-v1",
    status: "COMPLETED",
    delivery_id: deliveryId,
    packet_sha256: sha256(packetRaw),
    consumer_attempt_id: claimRequest.consumer_attempt_id,
    completed_at: completion.completed_at,
    result_sha256: completion.result_sha256,
    completion_receipt_sha256: sha256(options.body),
    idempotent_replay: false,
  });
};

let executed = 0;
let observedFence;
let observedFenceHmac;
const completed = await runArc1ConsumerJob(packetRaw, stableAttemptId, env, async (context) => {
  executed += 1;
  assert.equal(calls.length, 1, "The atomic site claim must finish before the executor can run.");
  assert.equal(context.assertActive(), true);
  assert.match(context.mutationIdempotencyKey, /^arc1mutation_[a-f0-9]{40}$/);
  assert.equal(context.mutationFence.consumer_attempt_id, claimRequest.consumer_attempt_id);
  assert.equal(context.mutationFence.claim_token_sha256, sha256(claimToken));
  assert.equal(context.mutationFence.ingress_state_digest_sha256, ingressStateDigestSha256);
  assert.equal(context.signal.aborted, false);
  observedFence = context.mutationFenceJson;
  observedFenceHmac = context.mutationFenceHmacSha256;
  return context.createDurableResultReceipt({
    immutableResultSha256: "1".repeat(64),
    durableStateReceiptSha256: "2".repeat(64),
    committedAt: new Date(nowMs).toISOString(),
  });
}, { clock, fetch: positiveFetch });
assert.equal(completed.status, "ARC1_CONSUMER_COMPLETED");
assert.equal(completed.terminalCleanupAllowed, true);
assert.equal(executed, 1);
assert.equal(calls.length, 2);
assert.match(observedFence, /arc-intake-arc1-consumer-mutation-fence-v1/);
assert.doesNotMatch(observedFence, new RegExp(claimToken), "The mutation fence must contain only the token digest.");
const verifiedFence = verifyArc1MutationFence(observedFence, observedFenceHmac, {
  deliveryId, packetSha256: sha256(packetRaw), consumerAttemptId: claimRequest.consumer_attempt_id,
  ingressStateDigestSha256,
}, env, { clock });
assert.match(verifiedFence.mutation_idempotency_key, /^arc1mutation_[a-f0-9]{40}$/);
await assert.rejects(Promise.resolve().then(() => verifyArc1MutationFence(observedFence, "0".repeat(64), {
  deliveryId, packetSha256: sha256(packetRaw), consumerAttemptId: claimRequest.consumer_attempt_id,
  ingressStateDigestSha256,
}, env, { clock })), /FENCE_INVALID: HMAC/);
const wrongIdempotencyFence = { ...JSON.parse(observedFence), mutation_idempotency_key: `arc1mutation_${"0".repeat(40)}` };
const wrongIdempotencyFenceRaw = canonicalJson(wrongIdempotencyFence);
await assert.rejects(Promise.resolve().then(() => verifyArc1MutationFence(wrongIdempotencyFenceRaw,
  hmac(receiptSecret, `arc-intake-arc1-consumer-mutation-fence-v1\n${wrongIdempotencyFenceRaw}`), {
    deliveryId, packetSha256: sha256(packetRaw), consumerAttemptId: claimRequest.consumer_attempt_id,
    ingressStateDigestSha256,
  }, env, { clock })), /mutation idempotency binding/);

// A lost response retries the byte-identical claim under the same workflow
// attempt. A separately scheduled workflow derives a different attempt id and
// must stop on the site's 409 before any generation or provider mutation.
let lostResponseCalls = 0;
let firstClaimRaw;
const recoveredClaim = await claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, {
  clock,
  fetch: async (url, options) => {
    lostResponseCalls += 1;
    if (lostResponseCalls === 1) {
      firstClaimRaw = options.body;
      throw new Error("ambiguous connection reset after server commit");
    }
    assert.equal(options.body, firstClaimRaw);
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw), consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(), claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: true,
    });
  },
});
assert.equal(lostResponseCalls, 2);
assert.equal(recoveredClaim.claim.idempotent_replay, true);
assert.equal(recoveredClaim.claim.consumer_attempt_id, claimRequest.consumer_attempt_id);
assert.equal(recoveredClaim.claim.fenceRaw, observedFence,
  "The transport-only replay marker must not change durable mutation-fence bytes after a crash.");

const recoveredDurableResult = createArc1DurableResultReceipt({
  deliveryId, packetSha256: sha256(packetRaw), consumerAttemptId: recoveredClaim.claim.consumer_attempt_id,
  claimToken, ingressStateDigestSha256, immutableResultSha256: "5".repeat(64),
  durableStateReceiptSha256: "6".repeat(64), committedAt: new Date(nowMs).toISOString(),
}, env);
let completionRetryCalls = 0;
let exactCompletionRaw;
await completeArc1ConsumerPacket(recoveredClaim, recoveredDurableResult, env, {
  clock,
  fetch: async (url, options) => {
    completionRetryCalls += 1;
    if (completionRetryCalls === 1) {
      exactCompletionRaw = options.body;
      return jsonResponse(url, 503, { error: "temporary" });
    }
    assert.equal(options.body, exactCompletionRaw,
      "An ambiguous completion retry must preserve the signed body byte for byte.");
    assert.equal(options.headers["X-ARC-Completion-HMAC-SHA256"], hmac(receiptSecret,
      `arc-intake-arc1-consumer-completion-v1\n${exactCompletionRaw}`));
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-completion-v1", status: "COMPLETED", delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw), consumer_attempt_id: request.consumer_attempt_id,
      completed_at: request.completed_at, result_sha256: request.result_sha256,
      completion_receipt_sha256: sha256(options.body), idempotent_replay: true,
    });
  },
});
assert.equal(completionRetryCalls, 2);

const otherClaimBodies = [];
let competingExecutorCalls = 0;
await assert.rejects(runArc1ConsumerJob(packetRaw, otherStableAttemptId, env, async () => {
  competingExecutorCalls += 1;
}, {
  clock,
  fetch: async (url, options) => {
    otherClaimBodies.push(options.body);
    return jsonResponse(url, 409, { error: "consumer_claim_conflict" });
  },
}), /ARC1_CONSUMER_CONFLICT/);
assert.equal(competingExecutorCalls, 0, "A competing attempt must stop before generation or mutation.");
assert.notEqual(JSON.parse(otherClaimBodies[0]).consumer_attempt_id, claimRequest.consumer_attempt_id);

// Default-off switches and packet authentication fail before network or work.
for (const disabledEnv of [
  { ...env, ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: "false" },
  { ...env, ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: "TRUE" },
  { ...env, ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: "" },
]) {
  let providerCalls = 0;
  await assert.rejects(claimArc1ConsumerPacket(packetRaw, stableAttemptId, disabledEnv, {
    clock, fetch: async () => { providerCalls += 1; },
  }), /ARC1_CONSUMER_CLAIM_DISABLED/);
  assert.equal(providerCalls, 0);
}

let completionDisabledFetches = 0;
let completionDisabledWork = 0;
await assert.rejects(runArc1ConsumerJob(packetRaw, stableAttemptId, {
  ...env, ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED: "false",
}, async () => { completionDisabledWork += 1; }, {
  clock, fetch: async () => { completionDisabledFetches += 1; },
}), /ARC1_CONSUMER_COMPLETION_DISABLED/);
assert.equal(completionDisabledFetches, 0, "A worker without completion authority must not claim.");
assert.equal(completionDisabledWork, 0, "A worker without completion authority must not mutate.");

let halfWiredFetches = 0;
await assert.rejects(claimArc1ConsumerPacket(packetRaw, stableAttemptId, {
  ...env, ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED: "false",
}, {
  clock, fetch: async () => { halfWiredFetches += 1; },
}), /ARC1_CONSUMER_COMPLETION_DISABLED/);
await assert.rejects(completeArc1ConsumerPacket(recoveredClaim, recoveredDurableResult, {
  ...env, ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: "false",
}, {
  clock, fetch: async () => { halfWiredFetches += 1; },
}), /ARC1_CONSUMER_CLAIM_DISABLED/);
await assert.rejects(Promise.resolve().then(() => verifyArc1MutationFence(observedFence, observedFenceHmac, {
  deliveryId, packetSha256: sha256(packetRaw), consumerAttemptId: claimRequest.consumer_attempt_id,
  ingressStateDigestSha256,
}, {
  ...env, ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED: "false",
}, { clock })), /ARC1_CONSUMER_COMPLETION_DISABLED/);
assert.equal(halfWiredFetches, 0, "Half-wired public APIs must fail before every network call.");

const tampered = JSON.parse(packetRaw);
tampered.bridge_delivery_id = "9".repeat(64);
let tamperedCalls = 0;
await assert.rejects(claimArc1ConsumerPacket(canonicalJson(tampered), stableAttemptId, env, {
  clock, fetch: async () => { tamperedCalls += 1; },
}), /packet duplicate binding|packet HMAC/);
assert.equal(tamperedCalls, 0);

const expiredPacket = makePacket({ issuedAt: nowMs - 2 * 60 * 60_000, expiresAt: nowMs - 1 });
await assert.rejects(claimArc1ConsumerPacket(expiredPacket, stableAttemptId, env, {
  clock, fetch: async () => { throw new Error("must not fetch"); },
}), /packet deadline/);

const mismatchedIngressTimePacket = makePacket({ ingressClaimedAtMs: nowMs - 61_000 });
await assert.rejects(Promise.resolve().then(() => verifyArc1ConsumerPacket(mismatchedIngressTimePacket, env, { clock })),
  /packet deadline/, "The claim request timestamp must exactly match the site's immutable ingress claim time.");

const shortPacket = makePacket({ expiresAt: nowMs + 5 * 60_000 });
await assert.rejects(claimArc1ConsumerPacket(shortPacket, stableAttemptId, env, {
  clock,
  fetch: async (url, options) => {
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: deliveryId,
      packet_sha256: sha256(shortPacket), consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(), claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: false,
    });
  },
}), /claim deadline/, "A claim lease must never outlive its signed packet evidence.");

const longLivedPacket = makePacket({ issuedAt: nowMs - 1_000, expiresAt: nowMs + 24 * 60 * 60_000 });
await assert.rejects(Promise.resolve().then(() => verifyArc1ConsumerPacket(longLivedPacket, env, { clock })), /packet deadline/,
  "The packet must not exceed the bridge's reviewed 24-hour lifetime.");

await assert.rejects(claimArc1ConsumerPacket(packetRaw, "short", env, {
  clock, fetch: async () => { throw new Error("must not fetch"); },
}), /stable per-workflow attempt id/);

// HTTP retry is exact and bounded. Malformed, redirected, and oversized
// responses never produce a claim.
let retryCalls = 0;
let retryRaw;
await claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, {
  clock,
  fetch: async (url, options) => {
    retryCalls += 1;
    if (retryCalls === 1) {
      retryRaw = options.body;
      return jsonResponse(url, 503, { error: "temporary" });
    }
    assert.equal(options.body, retryRaw);
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw), consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(), claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: true,
    });
  },
});
assert.equal(retryCalls, 2);

let claimRaceCalls = 0;
const claimRaceCallTimes = [];
await claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, {
  clock,
  fetch: async (url, options) => {
    claimRaceCalls += 1;
    claimRaceCallTimes.push(Date.now());
    if (claimRaceCalls === 1) return jsonResponse(url, 425, { error: "consumer_not_ready" });
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw), consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(), claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: false,
    });
  },
});
assert.equal(claimRaceCalls, 2);
assert.ok(claimRaceCallTimes[1] - claimRaceCallTimes[0] >= 40,
  "A 425 claim race must wait briefly for the site Hook-accepted CAS before its one bounded replay.");

let htmlProxyCalls = 0;
let htmlProxyFirstBody;
await claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, {
  clock,
  fetch: async (url, options) => {
    htmlProxyCalls += 1;
    if (htmlProxyCalls === 1) {
      htmlProxyFirstBody = options.body;
      const response = new Response("<html>temporary proxy failure</html>", {
        status: 503,
        headers: { "Content-Type": "text/html", "Content-Length": "36" },
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    assert.equal(options.body, htmlProxyFirstBody,
      "A proxy-generated non-JSON 5xx must still receive one byte-identical bounded retry.");
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw), consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(), claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: true,
    });
  },
});
assert.equal(htmlProxyCalls, 2);

for (const [name, fetchImpl, expected] of [
  ["redirect", async () => jsonResponse("https://attacker.example/claim", 200, {}), /response URL changed/],
  ["oversized", async (url) => jsonResponse(url, 200, {}, { declaredLength: 16_385 }), /declared response exceeds limit/],
  ["media", async (url) => {
    const response = new Response("{}", { status: 200, headers: { "Content-Type": "text/plain", "Content-Length": "2" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }, /response media type/],
  ["malformed", async (url) => {
    const response = new Response("not json", { status: 200, headers: { "Content-Type": "application/json", "Content-Length": "8" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }, /malformed JSON response/],
]) {
  await assert.rejects(claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, { clock, fetch: fetchImpl }), expected, name);
}

let hangingReads = 0;
let hangingCancelled = 0;
const timeoutStartedAt = Date.now();
await assert.rejects(claimArc1ConsumerPacket(packetRaw, stableAttemptId, {
  ...env, ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS: "100",
}, {
  clock,
  fetch: async (url) => {
    hangingReads += 1;
    const response = new Response(new ReadableStream({ start() {}, cancel() { hangingCancelled += 1; } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  },
}), /ARC1_CONSUMER_NETWORK_TIMEOUT/);
assert.ok(hangingReads >= 1 && hangingReads <= 2);
assert.equal(hangingCancelled, hangingReads, "Every timed-out response stream must be cancelled.");
assert.ok(Date.now() - timeoutStartedAt < 1_000, "The total operation timeout must bound all exact retries.");

// A claim without signed durable result evidence never posts completion. A
// failed executor likewise leaves the site record pending for recovery/review.
let noDurabilityCalls = 0;
await assert.rejects(runArc1ConsumerJob(packetRaw, stableAttemptId, env, async () => ({ status: "looks done" }), {
  clock,
  fetch: async (url, options) => {
    noDurabilityCalls += 1;
    assert.equal(url, ARC1_CONSUMER_CLAIM_ENDPOINT);
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw), consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(), claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: true,
    });
  },
}), /ARC1_CONSUMER_DURABILITY_REQUIRED/);
assert.equal(noDurabilityCalls, 1);

let failedWorkCalls = 0;
await assert.rejects(runArc1ConsumerJob(packetRaw, stableAttemptId, env, async () => {
  throw new Error("durable commit failed");
}, {
  clock,
  fetch: async (url, options) => {
    failedWorkCalls += 1;
    assert.equal(url, ARC1_CONSUMER_CLAIM_ENDPOINT);
    const request = JSON.parse(options.body);
    return jsonResponse(url, 200, {
      schema: "arc-intake-arc1-consumer-claim-v1", status: "CLAIMED", delivery_id: deliveryId,
      packet_sha256: sha256(packetRaw), consumer_attempt_id: request.consumer_attempt_id, claim_token: claimToken,
      claimed_at: new Date(nowMs - 1_000).toISOString(), claim_expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
      idempotent_replay: true,
    });
  },
}), /durable commit failed/);
assert.equal(failedWorkCalls, 1);

// Standalone durable receipts bind the immutable result, state receipt,
// packet, attempt, original ingress digest, and claim token digest.
const standalone = createArc1DurableResultReceipt({
  deliveryId, packetSha256: sha256(packetRaw), consumerAttemptId: claimRequest.consumer_attempt_id,
  claimToken, ingressStateDigestSha256, immutableResultSha256: "3".repeat(64),
  durableStateReceiptSha256: "4".repeat(64), committedAt: new Date(nowMs).toISOString(),
}, env);
assert.equal(standalone.receipt.claim_token_sha256, sha256(claimToken));
assert.equal(standalone.sha256, sha256(standalone.raw));
assert.equal(standalone.hmacSha256, hmac(durableResultSecret,
  `arc-intake-arc1-consumer-durable-result-v1\n${standalone.raw}`));

console.log("ARC1 consumer completion contract passed: packet HMAC/deadlines, atomic claims, attempt fencing, bounded exact retries, durable-result evidence, and signed terminal completion are fail-closed.");
