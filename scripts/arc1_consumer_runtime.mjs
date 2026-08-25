import {
  arc1ConsumerHmacHex,
  arc1ConsumerSafeEqualHex,
  arc1ConsumerSha256Hex,
  canonicalJson,
  claimArc1ConsumerPacket,
  completeArc1ConsumerPacket,
  createArc1DurableResultReceipt,
  resolveArc1ConsumerEnvironment,
  verifyArc1ConsumerPacket,
  verifyArc1MutationFence,
} from "./arc1_consumer_contract.mjs";

export const ARC1_CONSUMER_RUNTIME_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED";
export const ARC1_CONSUMER_PRIVATE_STATE_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED";
export const ARC1_CONSUMER_PROVIDER_WORK_ENABLED_ENV = "ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED";
export const ARC1_CONSUMER_HISTORY_REDACTION_ATTESTED_ENV = "ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED";
export const ARC1_CONSUMER_INPUTDATA_SECRET_COMPATIBILITY_ENV = "ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED";
export const ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_ENV = "ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS";

export const ARC1_CONSUMER_PRIVATE_STATE_SCHEMA = "arc-intake-arc1-consumer-private-state-v1";
export const ARC1_CONSUMER_STATE_CREATE_RECEIPT_SCHEMA = "arc-intake-arc1-consumer-state-create-receipt-v1";
export const ARC1_CONSUMER_STATE_COMMIT_RECEIPT_SCHEMA = "arc-intake-arc1-consumer-state-commit-receipt-v1";
export const ARC1_CONSUMER_CODE_STEP_SCHEMA = "arc-intake-arc1-consumer-code-step-v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ATTEMPT_PATTERN = /^arc1attempt_[a-f0-9]{40}$/;
const STATE_KEY_PATTERN = /^arc1-consumer-private-v1:[a-f0-9]{64}$/;
const MUTATION_KEY_PATTERN = /^arc1mutation_[a-f0-9]{40}$/;
const MAX_PRIVATE_EVIDENCE_BYTES = 32_768;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const PRIVATE_STATE_FIELDS = Object.freeze([
  "claim_expires_at", "claim_token", "claim_token_sha256", "claimed_at", "consumer_attempt_id", "created_at",
  "delivery_id", "ingress_state_digest_sha256", "mutation_fence_hmac_sha256", "mutation_fence_json",
  "mutation_idempotency_key", "packet_sha256", "schema", "state_key", "status",
]);
const CREATE_RECEIPT_FIELDS = Object.freeze([
  "consumer_attempt_id", "idempotent_replay", "provider_receipt_sha256", "schema", "state_key", "state_sha256",
  "status", "stored_at",
]);
const COMMIT_RECEIPT_FIELDS = Object.freeze([
  "committed_at", "consumer_attempt_id", "immutable_result_sha256", "provider_receipt_sha256", "schema", "state_key",
  "state_sha256", "status",
]);
const RUNTIME_ENV_NAMES = Object.freeze([
  "ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED",
  "ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED",
  "ARC_INTAKE_ARC1_PACKET_SECRET",
  "ARC_INTAKE_ARC1_CONSUMER_BEARER",
  "ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET",
  "ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET",
  "ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS",
  ARC1_CONSUMER_RUNTIME_ENABLED_ENV,
  ARC1_CONSUMER_PRIVATE_STATE_ENABLED_ENV,
  ARC1_CONSUMER_PROVIDER_WORK_ENABLED_ENV,
  ARC1_CONSUMER_HISTORY_REDACTION_ATTESTED_ENV,
  ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_ENV,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, fields) {
  return isPlainObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function requireSha(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new TypeError(`ARC1_RUNTIME_INVALID: ${label}`);
  return value;
}

function requireIso(value, label) {
  if (typeof value !== "string") throw new TypeError(`ARC1_RUNTIME_INVALID: ${label}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`ARC1_RUNTIME_INVALID: ${label}`);
  }
  return { value, milliseconds };
}

function clockMilliseconds(clock) {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError("ARC1_RUNTIME_INVALID: clock");
  return milliseconds;
}

function parseCanonicalObject(raw, label) {
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw, "utf8") > MAX_PRIVATE_EVIDENCE_BYTES) {
    throw new TypeError(`ARC1_RUNTIME_INVALID: ${label} size`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new TypeError(`ARC1_RUNTIME_INVALID: ${label} JSON`); }
  if (!isPlainObject(parsed) || canonicalJson(parsed) !== raw) throw new TypeError(`ARC1_RUNTIME_INVALID: ${label} canonical JSON`);
  return parsed;
}

function resolveRuntimeEnvironment(env) {
  // Check every activation control before parsing secrets or touching a
  // network/private-state/provider adapter. Partial activation is zero-touch.
  for (const [name, error] of [
    [ARC1_CONSUMER_RUNTIME_ENABLED_ENV, "ARC1_CONSUMER_RUNTIME_DISABLED"],
    [ARC1_CONSUMER_PRIVATE_STATE_ENABLED_ENV, "ARC1_CONSUMER_PRIVATE_STATE_DISABLED"],
    [ARC1_CONSUMER_PROVIDER_WORK_ENABLED_ENV, "ARC1_CONSUMER_PROVIDER_WORK_DISABLED"],
    [ARC1_CONSUMER_HISTORY_REDACTION_ATTESTED_ENV, "ARC1_CONSUMER_HISTORY_REDACTION_NOT_ATTESTED"],
  ]) {
    if (env?.[name] !== "true") throw new Error(error);
  }
  const resolved = resolveArc1ConsumerEnvironment(env, { requireClaim: true, requireCompletion: true });
  const rawTimeout = env?.[ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_ENV];
  const privateStateTimeoutMs = rawTimeout === undefined || rawTimeout === "" ? 5_000 : Number(rawTimeout);
  if (!Number.isSafeInteger(privateStateTimeoutMs) || privateStateTimeoutMs < 100 || privateStateTimeoutMs > 5_000) {
    throw new TypeError(`ARC1_RUNTIME_INVALID: ${ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_ENV}`);
  }
  return Object.freeze({ ...resolved, privateStateTimeoutMs });
}

async function runBoundedPrivateStateOperation(label, expiresMs, env, clock, invoke, parentSignal) {
  const resolved = resolveRuntimeEnvironment(env);
  const remainingMs = expiresMs - clockMilliseconds(clock);
  if (remainingMs <= 0 || parentSignal?.aborted) throw new Error("ARC1_CONSUMER_CLAIM_EXPIRED");
  const budgetMs = Math.min(remainingMs, resolved.privateStateTimeoutMs);
  const controller = new AbortController();
  let timer;
  let rejectParentAbort;
  const parentAborted = new Promise((_, reject) => { rejectParentAbort = reject; });
  const onParentAbort = () => {
    controller.abort();
    rejectParentAbort(new Error("ARC1_CONSUMER_CLAIM_EXPIRED"));
  };
  if (parentSignal) parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(remainingMs <= resolved.privateStateTimeoutMs ?
        "ARC1_CONSUMER_CLAIM_EXPIRED" : `ARC1_RUNTIME_PRIVATE_STATE_TIMEOUT: ${label}`));
    }, Math.max(1, budgetMs));
  });
  try {
    const operation = Promise.resolve().then(() => invoke(Object.freeze({ signal: controller.signal })));
    const value = await Promise.race(parentSignal ? [operation, timedOut, parentAborted] : [operation, timedOut]);
    if (parentSignal?.aborted || clockMilliseconds(clock) >= expiresMs) throw new Error("ARC1_CONSUMER_CLAIM_EXPIRED");
    return value;
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    controller.abort();
  }
}

function privateStateSignature(raw, resolved) {
  return arc1ConsumerHmacHex(resolved.durableResultSecret,
    `arc-intake-arc1-consumer-private-state-v1\n${raw}`);
}

function createReceiptSignature(raw, resolved) {
  return arc1ConsumerHmacHex(resolved.durableResultSecret,
    `arc-intake-arc1-consumer-state-create-receipt-v1\n${raw}`);
}

function commitReceiptSignature(raw, resolved) {
  return arc1ConsumerHmacHex(resolved.durableResultSecret,
    `arc-intake-arc1-consumer-state-commit-receipt-v1\n${raw}`);
}

function createPrivateStateBundle(claimBundle, env) {
  const resolved = resolveRuntimeEnvironment(env);
  const stateKey = `arc1-consumer-private-v1:${claimBundle.verified.packetSha256}`;
  const record = {
    schema: ARC1_CONSUMER_PRIVATE_STATE_SCHEMA,
    status: "CLAIMED",
    state_key: stateKey,
    delivery_id: claimBundle.verified.packet.bridge_delivery_id,
    packet_sha256: claimBundle.verified.packetSha256,
    consumer_attempt_id: claimBundle.claim.consumer_attempt_id,
    claim_token: claimBundle.claim.claimToken,
    claim_token_sha256: claimBundle.claim.claimTokenSha256,
    claimed_at: claimBundle.claim.claimed_at,
    claim_expires_at: claimBundle.claim.claim_expires_at,
    ingress_state_digest_sha256: claimBundle.verified.packet.ingress_state_digest_sha256,
    mutation_fence_json: claimBundle.claim.fenceRaw,
    mutation_fence_hmac_sha256: claimBundle.claim.fenceHmacSha256,
    mutation_idempotency_key: claimBundle.claim.mutationIdempotencyKey,
    created_at: claimBundle.claim.claimed_at,
  };
  if (!exactKeys(record, PRIVATE_STATE_FIELDS)) throw new Error("ARC1_RUNTIME_INVALID: internal private state contract");
  const raw = canonicalJson(record);
  const stateSha256 = arc1ConsumerSha256Hex(raw);
  return Object.freeze({
    record: Object.freeze(record), raw, stateSha256,
    hmacSha256: privateStateSignature(raw, resolved),
    stateKey,
    createIdempotencyKey: `arc1state_${stateSha256.slice(0, 40)}`,
  });
}

function restorePrivateState(packetRaw, stateRaw, stateHmacSha256, env, { clock = Date.now } = {}) {
  const resolved = resolveRuntimeEnvironment(env);
  const state = parseCanonicalObject(stateRaw, "private state");
  if (!exactKeys(state, PRIVATE_STATE_FIELDS) || state.schema !== ARC1_CONSUMER_PRIVATE_STATE_SCHEMA || state.status !== "CLAIMED" ||
      !STATE_KEY_PATTERN.test(state.state_key) || !SHA256_PATTERN.test(state.delivery_id) || !SHA256_PATTERN.test(state.packet_sha256) ||
      !ATTEMPT_PATTERN.test(state.consumer_attempt_id) || !SHA256_PATTERN.test(state.claim_token) ||
      !SHA256_PATTERN.test(state.claim_token_sha256) || !SHA256_PATTERN.test(state.ingress_state_digest_sha256) ||
      !SHA256_PATTERN.test(state.mutation_fence_hmac_sha256) || !MUTATION_KEY_PATTERN.test(state.mutation_idempotency_key)) {
    throw new TypeError("ARC1_RUNTIME_INVALID: private state contract");
  }
  if (!arc1ConsumerSafeEqualHex(stateHmacSha256, privateStateSignature(stateRaw, resolved))) {
    throw new TypeError("ARC1_RUNTIME_INVALID: private state HMAC");
  }
  if (state.claim_token_sha256 !== arc1ConsumerSha256Hex(state.claim_token) ||
      state.state_key !== `arc1-consumer-private-v1:${state.packet_sha256}`) {
    throw new TypeError("ARC1_RUNTIME_INVALID: private state binding");
  }
  const claimed = requireIso(state.claimed_at, "private state claimed_at");
  const expires = requireIso(state.claim_expires_at, "private state claim_expires_at");
  const created = requireIso(state.created_at, "private state created_at");
  const nowMs = clockMilliseconds(clock);
  if (created.milliseconds !== claimed.milliseconds || expires.milliseconds <= claimed.milliseconds || expires.milliseconds <= nowMs ||
      claimed.milliseconds > nowMs + MAX_CLOCK_SKEW_MS) throw new TypeError("ARC1_RUNTIME_INVALID: stale private state");
  const verified = verifyArc1ConsumerPacket(packetRaw, env, { clock, allowExpired: true });
  if (verified.packetSha256 !== state.packet_sha256 || verified.packet.bridge_delivery_id !== state.delivery_id ||
      verified.packet.ingress_state_digest_sha256 !== state.ingress_state_digest_sha256 ||
      expires.milliseconds > verified.expires.milliseconds) throw new TypeError("ARC1_RUNTIME_INVALID: packet/private state binding");
  const fence = verifyArc1MutationFence(state.mutation_fence_json, state.mutation_fence_hmac_sha256, {
    deliveryId: state.delivery_id,
    packetSha256: state.packet_sha256,
    consumerAttemptId: state.consumer_attempt_id,
    ingressStateDigestSha256: state.ingress_state_digest_sha256,
  }, env, { clock });
  if (fence.claimed_at !== state.claimed_at || fence.claim_expires_at !== state.claim_expires_at ||
      fence.claim_token_sha256 !== state.claim_token_sha256 || fence.mutation_idempotency_key !== state.mutation_idempotency_key) {
    throw new TypeError("ARC1_RUNTIME_INVALID: fence/private state binding");
  }
  const claim = Object.freeze({
    consumer_attempt_id: state.consumer_attempt_id,
    claimed_at: state.claimed_at,
    claim_expires_at: state.claim_expires_at,
    claimToken: state.claim_token,
    claimTokenSha256: state.claim_token_sha256,
    fence,
    fenceRaw: state.mutation_fence_json,
    fenceHmacSha256: state.mutation_fence_hmac_sha256,
    mutationIdempotencyKey: state.mutation_idempotency_key,
  });
  return Object.freeze({
    state: Object.freeze(state), raw: stateRaw, stateSha256: arc1ConsumerSha256Hex(stateRaw),
    stateHmacSha256, stateKey: state.state_key, claimBundle: Object.freeze({ verified, claim }),
  });
}

export function createArc1ConsumerStateCreateReceipt({
  stateKey, stateSha256, consumerAttemptId, storedAt, providerReceiptSha256, idempotentReplay,
}, env) {
  const resolved = resolveRuntimeEnvironment(env);
  if (!STATE_KEY_PATTERN.test(stateKey) || !SHA256_PATTERN.test(stateSha256) || !ATTEMPT_PATTERN.test(consumerAttemptId) ||
      !SHA256_PATTERN.test(providerReceiptSha256) || typeof idempotentReplay !== "boolean") {
    throw new TypeError("ARC1_RUNTIME_INVALID: state create receipt input");
  }
  requireIso(storedAt, "state create stored_at");
  const receipt = {
    schema: ARC1_CONSUMER_STATE_CREATE_RECEIPT_SCHEMA,
    status: "STORED",
    state_key: stateKey,
    state_sha256: stateSha256,
    consumer_attempt_id: consumerAttemptId,
    stored_at: storedAt,
    provider_receipt_sha256: providerReceiptSha256,
    idempotent_replay: idempotentReplay,
  };
  const raw = canonicalJson(receipt);
  return Object.freeze({ receipt: Object.freeze(receipt), raw, hmacSha256: createReceiptSignature(raw, resolved) });
}

export function createArc1ConsumerStateCommitReceipt({
  stateKey, stateSha256, consumerAttemptId, immutableResultSha256, committedAt, providerReceiptSha256,
}, env) {
  const resolved = resolveRuntimeEnvironment(env);
  if (!STATE_KEY_PATTERN.test(stateKey) || !SHA256_PATTERN.test(stateSha256) || !ATTEMPT_PATTERN.test(consumerAttemptId) ||
      !SHA256_PATTERN.test(immutableResultSha256) || !SHA256_PATTERN.test(providerReceiptSha256)) {
    throw new TypeError("ARC1_RUNTIME_INVALID: state commit receipt input");
  }
  requireIso(committedAt, "state commit committed_at");
  const receipt = {
    schema: ARC1_CONSUMER_STATE_COMMIT_RECEIPT_SCHEMA,
    status: "COMMITTED",
    state_key: stateKey,
    state_sha256: stateSha256,
    consumer_attempt_id: consumerAttemptId,
    immutable_result_sha256: immutableResultSha256,
    committed_at: committedAt,
    provider_receipt_sha256: providerReceiptSha256,
  };
  const raw = canonicalJson(receipt);
  return Object.freeze({ receipt: Object.freeze(receipt), raw, hmacSha256: commitReceiptSignature(raw, resolved) });
}

function verifyCreateReceipt(bundle, restored, env, { clock = Date.now } = {}) {
  const resolved = resolveRuntimeEnvironment(env);
  if (!isPlainObject(bundle)) throw new TypeError("ARC1_RUNTIME_DURABILITY_REQUIRED: create receipt");
  const receipt = parseCanonicalObject(bundle.raw, "state create receipt");
  if (!exactKeys(receipt, CREATE_RECEIPT_FIELDS) || receipt.schema !== ARC1_CONSUMER_STATE_CREATE_RECEIPT_SCHEMA ||
      receipt.status !== "STORED" || receipt.state_key !== restored.stateKey || receipt.state_sha256 !== restored.stateSha256 ||
      receipt.consumer_attempt_id !== restored.state.consumer_attempt_id || !SHA256_PATTERN.test(receipt.provider_receipt_sha256) ||
      typeof receipt.idempotent_replay !== "boolean" ||
      !arc1ConsumerSafeEqualHex(bundle.hmacSha256, createReceiptSignature(bundle.raw, resolved))) {
    throw new TypeError("ARC1_RUNTIME_DURABILITY_REQUIRED: invalid create receipt");
  }
  const stored = requireIso(receipt.stored_at, "state create stored_at");
  const claimedMs = Date.parse(restored.state.claimed_at);
  const expiresMs = Date.parse(restored.state.claim_expires_at);
  const nowMs = clockMilliseconds(clock);
  if (stored.milliseconds < claimedMs || stored.milliseconds >= expiresMs || stored.milliseconds > nowMs + MAX_CLOCK_SKEW_MS) {
    throw new TypeError("ARC1_RUNTIME_DURABILITY_REQUIRED: create receipt deadline");
  }
  return Object.freeze({ receipt: Object.freeze(receipt), raw: bundle.raw, hmacSha256: bundle.hmacSha256 });
}

function verifyCommitReceipt(bundle, restored, createReceipt, env, { clock = Date.now } = {}) {
  const resolved = resolveRuntimeEnvironment(env);
  if (!isPlainObject(bundle)) throw new TypeError("ARC1_RUNTIME_DURABILITY_REQUIRED: commit receipt");
  const receipt = parseCanonicalObject(bundle.raw, "state commit receipt");
  if (!exactKeys(receipt, COMMIT_RECEIPT_FIELDS) || receipt.schema !== ARC1_CONSUMER_STATE_COMMIT_RECEIPT_SCHEMA ||
      receipt.status !== "COMMITTED" || receipt.state_key !== restored.stateKey || receipt.state_sha256 !== restored.stateSha256 ||
      receipt.consumer_attempt_id !== restored.state.consumer_attempt_id || !SHA256_PATTERN.test(receipt.immutable_result_sha256) ||
      !SHA256_PATTERN.test(receipt.provider_receipt_sha256) ||
      !arc1ConsumerSafeEqualHex(bundle.hmacSha256, commitReceiptSignature(bundle.raw, resolved))) {
    throw new TypeError("ARC1_RUNTIME_DURABILITY_REQUIRED: invalid commit receipt");
  }
  const committed = requireIso(receipt.committed_at, "state commit committed_at");
  const storedMs = Date.parse(createReceipt.receipt.stored_at);
  const expiresMs = Date.parse(restored.state.claim_expires_at);
  const nowMs = clockMilliseconds(clock);
  if (committed.milliseconds < storedMs || committed.milliseconds >= expiresMs ||
      committed.milliseconds > nowMs + MAX_CLOCK_SKEW_MS || nowMs >= expiresMs) {
    throw new TypeError("ARC1_RUNTIME_DURABILITY_REQUIRED: commit receipt deadline");
  }
  return Object.freeze({ receipt: Object.freeze(receipt), raw: bundle.raw, hmacSha256: bundle.hmacSha256 });
}

function logSafeEvidence(status, restored, extra = {}) {
  return canonicalJson({
    schema: "arc-intake-arc1-consumer-log-safe-v1",
    status,
    state_key: restored.stateKey,
    state_sha256: restored.stateSha256,
    delivery_id: restored.state.delivery_id,
    packet_sha256: restored.state.packet_sha256,
    consumer_attempt_id: restored.state.consumer_attempt_id,
    ...extra,
  });
}

export async function prepareArc1ConsumerClaim(packetRaw, stableAttemptId, env, { clock = Date.now, fetch = globalThis.fetch } = {}) {
  resolveRuntimeEnvironment(env);
  const claimBundle = await claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, { clock, fetch });
  const privateState = createPrivateStateBundle(claimBundle, env);
  const restored = restorePrivateState(packetRaw, privateState.raw, privateState.hmacSha256, env, { clock });
  return Object.freeze({
    status: "ARC1_CONSUMER_CLAIM_PREPARED",
    privateState,
    createOperation: Object.freeze({
      operation: "CREATE_OR_EXACT",
      stateKey: privateState.stateKey,
      stateRaw: privateState.raw,
      stateSha256: privateState.stateSha256,
      stateHmacSha256: privateState.hmacSha256,
      idempotencyKey: privateState.createIdempotencyKey,
    }),
    logSafeJson: logSafeEvidence("CLAIM_PREPARED", restored),
  });
}

export function authorizeArc1ConsumerMutation(packetRaw, stateRaw, stateHmacSha256, createReceiptBundle, env,
  { clock = Date.now } = {}) {
  resolveRuntimeEnvironment(env);
  const restored = restorePrivateState(packetRaw, stateRaw, stateHmacSha256, env, { clock });
  const createReceipt = verifyCreateReceipt(createReceiptBundle, restored, env, { clock });
  return Object.freeze({
    status: "ARC1_CONSUMER_MUTATION_AUTHORIZED",
    restored,
    createReceipt,
    mutationFenceJson: restored.state.mutation_fence_json,
    mutationFenceHmacSha256: restored.state.mutation_fence_hmac_sha256,
    mutationIdempotencyKey: restored.state.mutation_idempotency_key,
    logSafeJson: logSafeEvidence("MUTATION_AUTHORIZED", restored, {
      create_receipt_sha256: arc1ConsumerSha256Hex(createReceipt.raw),
    }),
  });
}

export async function completeArc1ConsumerFromPrivateState({
  packetRaw, stateRaw, stateHmacSha256, createReceiptBundle, commitReceiptBundle,
}, env, { clock = Date.now, fetch = globalThis.fetch } = {}) {
  resolveRuntimeEnvironment(env);
  const authorized = authorizeArc1ConsumerMutation(packetRaw, stateRaw, stateHmacSha256, createReceiptBundle, env, { clock });
  const commitReceipt = verifyCommitReceipt(commitReceiptBundle, authorized.restored, authorized.createReceipt, env, { clock });
  const durableResult = createArc1DurableResultReceipt({
    deliveryId: authorized.restored.state.delivery_id,
    packetSha256: authorized.restored.state.packet_sha256,
    consumerAttemptId: authorized.restored.state.consumer_attempt_id,
    claimToken: authorized.restored.state.claim_token,
    ingressStateDigestSha256: authorized.restored.state.ingress_state_digest_sha256,
    immutableResultSha256: commitReceipt.receipt.immutable_result_sha256,
    durableStateReceiptSha256: arc1ConsumerSha256Hex(commitReceipt.raw),
    committedAt: commitReceipt.receipt.committed_at,
  }, env);
  const completion = await completeArc1ConsumerPacket(authorized.restored.claimBundle, durableResult, env, { clock, fetch });
  return Object.freeze({
    status: completion.status,
    terminalCleanupAllowed: completion.terminalCleanupAllowed,
    completionReceiptSha256: completion.response.completion_receipt_sha256,
    durableResultSha256: completion.durableResultSha256,
    logSafeJson: logSafeEvidence("COMPLETED", authorized.restored, {
      completion_receipt_sha256: completion.response.completion_receipt_sha256,
      immutable_result_sha256: commitReceipt.receipt.immutable_result_sha256,
    }),
  });
}

export async function runArc1PrivateStateConsumerJob(packetRaw, stableAttemptId, env, {
  privateState, execute, clock = Date.now, fetch = globalThis.fetch,
} = {}) {
  resolveRuntimeEnvironment(env);
  if (!privateState || typeof privateState.createOrExact !== "function" || typeof privateState.commitResult !== "function" ||
      typeof execute !== "function") throw new TypeError("ARC1_RUNTIME_INVALID: adapters");
  const prepared = await prepareArc1ConsumerClaim(packetRaw, stableAttemptId, env, { clock, fetch });
  const expiresMs = Date.parse(prepared.privateState.record.claim_expires_at);
  const createReceiptBundle = await runBoundedPrivateStateOperation("CREATE_OR_EXACT", expiresMs, env, clock,
    ({ signal }) => privateState.createOrExact(prepared.createOperation, { signal }));
  const authorized = authorizeArc1ConsumerMutation(packetRaw, prepared.privateState.raw, prepared.privateState.hmacSha256,
    createReceiptBundle, env, { clock });
  const controller = new AbortController();
  let timer;
  const assertActive = () => {
    if (controller.signal.aborted || clockMilliseconds(clock) >= expiresMs) throw new Error("ARC1_CONSUMER_CLAIM_EXPIRED");
    return true;
  };
  try {
    const execution = Promise.resolve().then(() => execute(Object.freeze({
      mutationFenceJson: authorized.mutationFenceJson,
      mutationFenceHmacSha256: authorized.mutationFenceHmacSha256,
      mutationIdempotencyKey: authorized.mutationIdempotencyKey,
      consumerAttemptId: authorized.restored.state.consumer_attempt_id,
      packetSha256: authorized.restored.state.packet_sha256,
      signal: controller.signal,
      assertActive,
    })));
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("ARC1_CONSUMER_CLAIM_EXPIRED")); },
        Math.max(1, expiresMs - clockMilliseconds(clock)));
    });
    const result = await Promise.race([execution, expired]);
    assertActive();
    if (!exactKeys(result, ["immutableResultSha256"]) || !SHA256_PATTERN.test(result.immutableResultSha256)) {
      throw new TypeError("ARC1_RUNTIME_INVALID: provider result must be one immutable digest");
    }
    const commitOperation = Object.freeze({
      operation: "COMMIT_RESULT_EXACT",
      stateKey: authorized.restored.stateKey,
      stateSha256: authorized.restored.stateSha256,
      consumerAttemptId: authorized.restored.state.consumer_attempt_id,
      immutableResultSha256: result.immutableResultSha256,
      mutationIdempotencyKey: authorized.mutationIdempotencyKey,
      commitIdempotencyKey: `arc1commit_${arc1ConsumerSha256Hex(
        `${authorized.restored.stateSha256}\n${result.immutableResultSha256}`).slice(0, 40)}`,
    });
    const commitReceiptBundle = await runBoundedPrivateStateOperation("COMMIT_RESULT_EXACT", expiresMs, env, clock,
      ({ signal }) => privateState.commitResult(commitOperation, { signal }), controller.signal);
    return completeArc1ConsumerFromPrivateState({
      packetRaw,
      stateRaw: prepared.privateState.raw,
      stateHmacSha256: prepared.privateState.hmacSha256,
      createReceiptBundle,
      commitReceiptBundle,
    }, env, { clock, fetch });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function inputText(input, name) {
  const value = input?.[name];
  if (typeof value !== "string" || value === "") throw new TypeError(`ARC1_RUNTIME_INVALID: ${name}`);
  return value;
}

function codeStepEnvironment(input, runtimeEnv) {
  const injected = isPlainObject(runtimeEnv) || (runtimeEnv && typeof runtimeEnv === "object") ? runtimeEnv : {};
  // Production secrets and activation controls belong in an encrypted host
  // environment/private integration. Mapping them through inputData is a
  // compatibility path only, and the host must enable that path outside of
  // inputData after proving its input/output history is private and redacted.
  const allowInputCompatibility = injected[ARC1_CONSUMER_INPUTDATA_SECRET_COMPATIBILITY_ENV] === "true";
  return Object.fromEntries(RUNTIME_ENV_NAMES.map((name) => {
    if (typeof injected[name] === "string" && injected[name] !== "") return [name, injected[name]];
    return [name, allowInputCompatibility ? input?.[name] : undefined];
  }));
}

function receiptBundleFromInput(input, prefix) {
  return {
    raw: inputText(input, `${prefix}_JSON`),
    hmacSha256: inputText(input, `${prefix}_HMAC_SHA256`),
  };
}

export async function runArc1ConsumerCodeStep(input, {
  clock = Date.now, fetch = globalThis.fetch, runtimeEnv = undefined,
} = {}) {
  if (!isPlainObject(input)) throw new TypeError("ARC1_RUNTIME_INVALID: inputData");
  const env = codeStepEnvironment(input, runtimeEnv);
  resolveRuntimeEnvironment(env);
  const phase = inputText(input, "ARC1_CONSUMER_PHASE");
  if (phase === "CLAIM") {
    const prepared = await prepareArc1ConsumerClaim(
      inputText(input, "ARC1_PACKET_JSON"), inputText(input, "ARC1_STABLE_ATTEMPT_ID"), env, { clock, fetch });
    return {
      schema: ARC1_CONSUMER_CODE_STEP_SCHEMA,
      status: prepared.status,
      private_state_operation: prepared.createOperation.operation,
      private_state_key: prepared.createOperation.stateKey,
      private_state_json: prepared.createOperation.stateRaw,
      private_state_sha256: prepared.createOperation.stateSha256,
      private_state_hmac_sha256: prepared.createOperation.stateHmacSha256,
      private_state_idempotency_key: prepared.createOperation.idempotencyKey,
      private_state_private_only: true,
      private_state_history_logging_allowed: false,
      log_safe_json: prepared.logSafeJson,
    };
  }
  if (phase === "AUTHORIZE") {
    const authorized = authorizeArc1ConsumerMutation(
      inputText(input, "ARC1_PACKET_JSON"),
      inputText(input, "ARC1_PRIVATE_STATE_JSON"),
      inputText(input, "ARC1_PRIVATE_STATE_HMAC_SHA256"),
      receiptBundleFromInput(input, "ARC1_STATE_CREATE_RECEIPT"), env, { clock });
    return {
      schema: ARC1_CONSUMER_CODE_STEP_SCHEMA,
      status: authorized.status,
      mutation_fence_json: authorized.mutationFenceJson,
      mutation_fence_hmac_sha256: authorized.mutationFenceHmacSha256,
      mutation_idempotency_key: authorized.mutationIdempotencyKey,
      log_safe_json: authorized.logSafeJson,
    };
  }
  if (phase === "COMPLETE") {
    const completed = await completeArc1ConsumerFromPrivateState({
      packetRaw: inputText(input, "ARC1_PACKET_JSON"),
      stateRaw: inputText(input, "ARC1_PRIVATE_STATE_JSON"),
      stateHmacSha256: inputText(input, "ARC1_PRIVATE_STATE_HMAC_SHA256"),
      createReceiptBundle: receiptBundleFromInput(input, "ARC1_STATE_CREATE_RECEIPT"),
      commitReceiptBundle: receiptBundleFromInput(input, "ARC1_STATE_COMMIT_RECEIPT"),
    }, env, { clock, fetch });
    return {
      schema: ARC1_CONSUMER_CODE_STEP_SCHEMA,
      status: completed.status,
      terminal_cleanup_allowed: completed.terminalCleanupAllowed,
      completion_receipt_sha256: completed.completionReceiptSha256,
      durable_result_sha256: completed.durableResultSha256,
      log_safe_json: completed.logSafeJson,
    };
  }
  throw new TypeError("ARC1_RUNTIME_INVALID: ARC1_CONSUMER_PHASE");
}
