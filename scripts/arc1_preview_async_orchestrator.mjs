import { createHash, createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";

// Provider-neutral ARC1 coordinator. It performs no network or provider calls.
// Its private persistence and action payloads must be routed only through a
// history-redacted adapter. Only logSafeJson is suitable for ordinary logs.
export const ARC1_PREVIEW_ASYNC_STATE_SCHEMA = "arc1-preview-async-orchestration-state-v1";
export const ARC1_PREVIEW_ASYNC_READBACK_SCHEMA = "arc1-preview-async-state-readback-v1";
export const ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_SCHEMA = "arc1-preview-async-stage-receipt-v1";
export const ARC1_PREVIEW_ASYNC_OPERATION_INTENT_SCHEMA = "arc1-preview-async-operation-intent-v1";

export const ARC1_PREVIEW_ASYNC_ENV = Object.freeze({
  orchestratorEnabled: "ARC1_PREVIEW_ASYNC_ORCHESTRATOR_ENABLED",
  privateStateEnabled: "ARC1_PREVIEW_ASYNC_PRIVATE_STATE_ENABLED",
  providerActionsEnabled: "ARC1_PREVIEW_ASYNC_PROVIDER_ACTIONS_ENABLED",
  historyRedactionAttested: "ARC1_PREVIEW_ASYNC_HISTORY_REDACTION_ATTESTED",
  stateCurrentKeyId: "ARC1_PREVIEW_ASYNC_STATE_CURRENT_KEY_ID",
  stateKeyringJson: "ARC1_PREVIEW_ASYNC_STATE_KEYRING_JSON",
  readbackPublicKeyringJson: "ARC1_PREVIEW_ASYNC_READBACK_PUBLIC_KEYRING_JSON",
  stageReceiptPublicKeyringJson: "ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_PUBLIC_KEYRING_JSON",
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const WORKFLOW_PATTERN = /^arc1preview_[a-f0-9]{40}$/;
const OPERATION_KEY_PATTERN = /^arc1op_[a-f0-9]{40}$/;
const MAX_STATE_BYTES = 32_768;
const MAX_EVIDENCE_BYTES = 16_384;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_READBACK_AGE_MS = 5 * 60_000;
const MAX_AUTHORIZATION_LEASE_MS = 60_000;
const MAX_WORKFLOW_AGE_MS = 14 * 24 * 60 * 60_000;
const OPERATION_TTL_MS = 15 * 60_000;

const STAGES = Object.freeze({
  PR_CREATED: Object.freeze({
    waiting: "PR_CREATE_INTENT_PERSISTED",
    next: "WAITING_PR_CHECK",
    count: 1,
    action: "CREATE_IMMUTABLE_PREVIEW_PR",
    issuer: "github",
  }),
  PR_CHECK_PASSED: Object.freeze({
    waiting: "WAITING_PR_CHECK",
    next: "READY_MERGE",
    count: 2,
    action: null,
    issuer: "github",
  }),
  MERGE_CONFIRMED: Object.freeze({
    waiting: "MERGE_INTENT_PERSISTED",
    next: "WAITING_PAGES_EXACT_BYTES",
    count: 3,
    action: "MERGE_IMMUTABLE_PREVIEW_PR",
    issuer: "github",
  }),
  PAGES_EXACT_BYTES_VERIFIED: Object.freeze({
    waiting: "WAITING_PAGES_EXACT_BYTES",
    next: "READY_PREVIEW_EMAIL_DELIVERY",
    count: 4,
    action: null,
    issuer: "pages",
  }),
  PREVIEW_EMAIL_DELIVERED: Object.freeze({
    waiting: "PREVIEW_EMAIL_DELIVERY_INTENT_PERSISTED",
    next: "WAITING_CUSTOMER_APPROVAL",
    count: 5,
    action: "SEND_PRIVATE_PREVIEW_EMAIL",
    issuer: "email",
  }),
  CUSTOMER_APPROVAL_VERIFIED: Object.freeze({
    waiting: "WAITING_CUSTOMER_APPROVAL",
    next: "READY_PRIVATE_CHECKOUT_AUTHORIZATION",
    count: 6,
    action: null,
    issuer: "review",
  }),
  PRIVATE_CHECKOUT_AUTHORIZED: Object.freeze({
    waiting: "PRIVATE_CHECKOUT_AUTHORIZATION_INTENT_PERSISTED",
    next: "COMPLETE",
    count: 7,
    action: "AUTHORIZE_PRIVATE_CHECKOUT_FOR_APPROVED_PREVIEW",
    issuer: "checkout",
  }),
});

const OPERATIONS = Object.freeze({
  READY_PR_CREATE: Object.freeze({
    action: "CREATE_IMMUTABLE_PREVIEW_PR",
    intent: "PR_CREATE_INTENT_PERSISTED",
    receiptStage: "PR_CREATED",
  }),
  READY_MERGE: Object.freeze({
    action: "MERGE_IMMUTABLE_PREVIEW_PR",
    intent: "MERGE_INTENT_PERSISTED",
    receiptStage: "MERGE_CONFIRMED",
  }),
  READY_PREVIEW_EMAIL_DELIVERY: Object.freeze({
    action: "SEND_PRIVATE_PREVIEW_EMAIL",
    intent: "PREVIEW_EMAIL_DELIVERY_INTENT_PERSISTED",
    receiptStage: "PREVIEW_EMAIL_DELIVERED",
  }),
  READY_PRIVATE_CHECKOUT_AUTHORIZATION: Object.freeze({
    action: "AUTHORIZE_PRIVATE_CHECKOUT_FOR_APPROVED_PREVIEW",
    intent: "PRIVATE_CHECKOUT_AUTHORIZATION_INTENT_PERSISTED",
    receiptStage: "PRIVATE_CHECKOUT_AUTHORIZED",
  }),
});

const INTENT_STATUS = new Map(Object.values(OPERATIONS).map(value => [value.intent, value]));
const STATUS_POSITION = Object.freeze({
  READY_PR_CREATE: Object.freeze({ count: 0, revision: 0 }),
  PR_CREATE_INTENT_PERSISTED: Object.freeze({ count: 0, revision: 1 }),
  WAITING_PR_CHECK: Object.freeze({ count: 1, revision: 2 }),
  READY_MERGE: Object.freeze({ count: 2, revision: 3 }),
  MERGE_INTENT_PERSISTED: Object.freeze({ count: 2, revision: 4 }),
  WAITING_PAGES_EXACT_BYTES: Object.freeze({ count: 3, revision: 5 }),
  READY_PREVIEW_EMAIL_DELIVERY: Object.freeze({ count: 4, revision: 6 }),
  PREVIEW_EMAIL_DELIVERY_INTENT_PERSISTED: Object.freeze({ count: 4, revision: 7 }),
  WAITING_CUSTOMER_APPROVAL: Object.freeze({ count: 5, revision: 8 }),
  READY_PRIVATE_CHECKOUT_AUTHORIZATION: Object.freeze({ count: 6, revision: 9 }),
  PRIVATE_CHECKOUT_AUTHORIZATION_INTENT_PERSISTED: Object.freeze({ count: 6, revision: 10 }),
  COMPLETE: Object.freeze({ count: 7, revision: 11 }),
});
const STATE_FIELDS = Object.freeze([
  "artifact_sha256",
  "completed_stage_count",
  "created_at",
  "expires_at",
  "last_stage_receipt_sha256",
  "operation_action",
  "operation_expires_at",
  "operation_idempotency_key",
  "operation_intent_sha256",
  "operation_prepared_at",
  "operation_request_sha256",
  "prior_state_sha256",
  "revision",
  "schema",
  "state_key_id",
  "status",
  "updated_at",
  "validation_receipt_sha256",
  "workflow_id",
]);
const READBACK_FIELDS = Object.freeze([
  "authorization_lease_expires_at",
  "authorization_lease_id_sha256",
  "issuer",
  "issuer_key_id",
  "operation_intent_sha256",
  "provider_record_version",
  "purpose",
  "readback_at",
  "schema",
  "scope",
  "state_key",
  "state_sha256",
  "workflow_id",
]);
const STAGE_RECEIPT_FIELDS = Object.freeze([
  "artifact_sha256",
  "issuer",
  "issuer_key_id",
  "observed_at",
  "operation_intent_sha256",
  "outcome",
  "prior_state_sha256",
  "provider_receipt_sha256",
  "schema",
  "scope",
  "stage",
  "workflow_id",
]);
const OPERATION_INTENT_FIELDS = Object.freeze([
  "action",
  "artifact_sha256",
  "expires_at",
  "idempotency_key",
  "prepared_at",
  "provider_request_sha256",
  "schema",
  "scope",
  "source_state_sha256",
  "workflow_id",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

export function arc1PreviewCanonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(arc1PreviewCanonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${arc1PreviewCanonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("ARC1_ASYNC_INVALID: canonical JSON value");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(secret, domain, raw) {
  return createHmac("sha256", secret).update(`${domain}\n${raw}`).digest("hex");
}

function safeEqualHex(left, right) {
  if (!SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function exactKeys(value, fields, label) {
  if (!isPlainObject(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new TypeError(`ARC1_ASYNC_INVALID: ${label} fields`);
  }
}

function parseCanonicalObject(raw, label, maximum = MAX_EVIDENCE_BYTES) {
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw, "utf8") > maximum) {
    throw new TypeError(`ARC1_ASYNC_INVALID: ${label} size`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new TypeError(`ARC1_ASYNC_INVALID: ${label} JSON`); }
  if (!isPlainObject(parsed) || arc1PreviewCanonicalJson(parsed) !== raw) {
    throw new TypeError(`ARC1_ASYNC_INVALID: ${label} canonical JSON`);
  }
  return parsed;
}

function parseEnvironmentObject(env, name, maximum) {
  const raw = env?.[name];
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw, "utf8") > maximum) {
    throw new TypeError(`ARC1_ASYNC_INVALID: ${name}`);
  }
  let value;
  try { value = JSON.parse(raw); } catch { throw new TypeError(`ARC1_ASYNC_INVALID: ${name}`); }
  if (!isPlainObject(value) || arc1PreviewCanonicalJson(value) !== raw) {
    throw new TypeError(`ARC1_ASYNC_INVALID: ${name}`);
  }
  return value;
}

function resolveStateKeyring(env) {
  const currentKeyId = env?.[ARC1_PREVIEW_ASYNC_ENV.stateCurrentKeyId];
  const value = parseEnvironmentObject(env, ARC1_PREVIEW_ASYNC_ENV.stateKeyringJson, 8_192);
  const entries = Object.entries(value);
  if (!KEY_ID_PATTERN.test(currentKeyId) || entries.length < 1 || entries.length > 8) {
    throw new TypeError(`ARC1_ASYNC_INVALID: ${ARC1_PREVIEW_ASYNC_ENV.stateKeyringJson}`);
  }
  const keys = new Map();
  for (const [keyId, secret] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof secret !== "string" || secret.length < 32 || secret.length > 512) {
      throw new TypeError(`ARC1_ASYNC_INVALID: ${ARC1_PREVIEW_ASYNC_ENV.stateKeyringJson}`);
    }
    keys.set(keyId, secret);
  }
  if (!keys.has(currentKeyId)) throw new TypeError(`ARC1_ASYNC_INVALID: ${ARC1_PREVIEW_ASYNC_ENV.stateCurrentKeyId}`);
  return Object.freeze({ currentKeyId, keys });
}

function resolvePublicKeyring(env, name, allowedIssuers) {
  const value = parseEnvironmentObject(env, name, 32_768);
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 16) throw new TypeError(`ARC1_ASYNC_INVALID: ${name}`);
  const keys = new Map();
  for (const [keyId, record] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || !isPlainObject(record) ||
        JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["issuer", "public_key_pem"]) ||
        !allowedIssuers.has(record.issuer) || typeof record.public_key_pem !== "string" ||
        record.public_key_pem.length < 80 || record.public_key_pem.length > 2_048) {
      throw new TypeError(`ARC1_ASYNC_INVALID: ${name}`);
    }
    let key;
    try { key = createPublicKey(record.public_key_pem); } catch { throw new TypeError(`ARC1_ASYNC_INVALID: ${name}`); }
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError(`ARC1_ASYNC_INVALID: ${name}`);
    keys.set(keyId, Object.freeze({ issuer: record.issuer, key }));
  }
  return keys;
}

function verifyEd25519(raw, signatureBase64url, key) {
  if (typeof signatureBase64url !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signatureBase64url)) return false;
  try { return verifySignature(null, Buffer.from(raw, "utf8"), key, Buffer.from(signatureBase64url, "base64url")); } catch { return false; }
}

function resolveEnvironment(env, { authorizeProvider = false } = {}) {
  for (const [name, error] of [
    [ARC1_PREVIEW_ASYNC_ENV.orchestratorEnabled, "ARC1_ASYNC_ORCHESTRATOR_DISABLED"],
    [ARC1_PREVIEW_ASYNC_ENV.privateStateEnabled, "ARC1_ASYNC_PRIVATE_STATE_DISABLED"],
    [ARC1_PREVIEW_ASYNC_ENV.historyRedactionAttested, "ARC1_ASYNC_HISTORY_REDACTION_NOT_ATTESTED"],
  ]) {
    if (env?.[name] !== "true") throw new Error(error);
  }
  if (authorizeProvider && env?.[ARC1_PREVIEW_ASYNC_ENV.providerActionsEnabled] !== "true") {
    throw new Error("ARC1_ASYNC_PROVIDER_ACTIONS_DISABLED");
  }
  const state = resolveStateKeyring(env);
  return Object.freeze({
    stateCurrentKeyId: state.currentKeyId,
    stateKeys: state.keys,
    readbackPublicKeys: resolvePublicKeyring(env, ARC1_PREVIEW_ASYNC_ENV.readbackPublicKeyringJson, new Set(["private-state"])),
    stageReceiptPublicKeys: resolvePublicKeyring(env, ARC1_PREVIEW_ASYNC_ENV.stageReceiptPublicKeyringJson,
      new Set(["github", "pages", "email", "review", "checkout"])),
  });
}

function clockMs(clock) {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError("ARC1_ASYNC_INVALID: clock");
  return milliseconds;
}

function parseIso(value, label) {
  if (typeof value !== "string") throw new TypeError(`ARC1_ASYNC_INVALID: ${label}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`ARC1_ASYNC_INVALID: ${label}`);
  }
  return milliseconds;
}

function stateKey(workflowId) {
  return `arc1-preview-async-v1:${workflowId}`;
}

function stateSignature(raw, secret) {
  return hmac(secret, ARC1_PREVIEW_ASYNC_STATE_SCHEMA, raw);
}

function validateStateSemantics(state, nowMs) {
  exactKeys(state, STATE_FIELDS, "state");
  if (state.schema !== ARC1_PREVIEW_ASYNC_STATE_SCHEMA || !WORKFLOW_PATTERN.test(state.workflow_id) ||
      !KEY_ID_PATTERN.test(state.state_key_id) ||
      !SHA256_PATTERN.test(state.artifact_sha256) || !SHA256_PATTERN.test(state.validation_receipt_sha256) ||
      !Number.isSafeInteger(state.completed_stage_count) || state.completed_stage_count < 0 || state.completed_stage_count > 7 ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      (state.prior_state_sha256 !== null && !SHA256_PATTERN.test(state.prior_state_sha256)) ||
      (state.last_stage_receipt_sha256 !== null && !SHA256_PATTERN.test(state.last_stage_receipt_sha256))) {
    throw new TypeError("ARC1_ASYNC_INVALID: state contract");
  }
  const position = STATUS_POSITION[state.status];
  if (!position || state.completed_stage_count !== position.count || state.revision !== position.revision ||
      (state.status === "READY_PR_CREATE" ?
        (state.prior_state_sha256 !== null || state.last_stage_receipt_sha256 !== null) :
        state.status === "PR_CREATE_INTENT_PERSISTED" ?
          (state.prior_state_sha256 === null || state.last_stage_receipt_sha256 !== null) :
          (state.prior_state_sha256 === null || state.last_stage_receipt_sha256 === null))) {
    throw new TypeError("ARC1_ASYNC_INVALID: state position");
  }
  const createdMs = parseIso(state.created_at, "state created_at");
  const updatedMs = parseIso(state.updated_at, "state updated_at");
  const expiresMs = parseIso(state.expires_at, "state expires_at");
  if (updatedMs < createdMs || updatedMs > nowMs + MAX_CLOCK_SKEW_MS || expiresMs <= createdMs ||
      expiresMs - createdMs > MAX_WORKFLOW_AGE_MS) {
    throw new TypeError("ARC1_ASYNC_INVALID: state timestamps");
  }
  if (expiresMs <= nowMs) throw new Error("ARC1_ASYNC_REVIEW_REQUIRED: orchestration expired");

  const operation = INTENT_STATUS.get(state.status);
  if (operation) {
    if (state.operation_action !== operation.action || !SHA256_PATTERN.test(state.operation_intent_sha256) ||
        !OPERATION_KEY_PATTERN.test(state.operation_idempotency_key) || !SHA256_PATTERN.test(state.operation_request_sha256) ||
        state.prior_state_sha256 === null) {
      throw new TypeError("ARC1_ASYNC_INVALID: operation state");
    }
    const preparedMs = parseIso(state.operation_prepared_at, "operation prepared_at");
    const operationExpiresMs = parseIso(state.operation_expires_at, "operation expires_at");
    if (preparedMs !== updatedMs || operationExpiresMs <= preparedMs || operationExpiresMs > expiresMs ||
        operationExpiresMs - preparedMs > OPERATION_TTL_MS) {
      throw new TypeError("ARC1_ASYNC_INVALID: operation timestamps");
    }
  } else if ([state.operation_action, state.operation_expires_at, state.operation_idempotency_key,
      state.operation_intent_sha256, state.operation_prepared_at, state.operation_request_sha256].some(value => value !== null)) {
    throw new TypeError("ARC1_ASYNC_INVALID: unexpected operation fields");
  }
  if (state.status === "READY_PR_CREATE" && updatedMs !== createdMs) {
    throw new TypeError("ARC1_ASYNC_INVALID: initial state");
  }
  if (state.status === "COMPLETE" && state.completed_stage_count !== 7) {
    throw new TypeError("ARC1_ASYNC_INVALID: terminal stage count");
  }
  return Object.freeze({ createdMs, updatedMs, expiresMs });
}

function restoreState(stateRaw, stateHmacSha256, env, { clock = Date.now } = {}) {
  const resolved = resolveEnvironment(env);
  const state = parseCanonicalObject(stateRaw, "state", MAX_STATE_BYTES);
  const stateSecret = resolved.stateKeys.get(state.state_key_id);
  if (!stateSecret || !safeEqualHex(stateHmacSha256, stateSignature(stateRaw, stateSecret))) {
    throw new TypeError("ARC1_ASYNC_INVALID: state HMAC");
  }
  const nowMs = clockMs(clock);
  const times = validateStateSemantics(state, nowMs);
  return Object.freeze({ state: Object.freeze(state), stateRaw, stateSha256: sha256(stateRaw), times, resolved, stateSecret, nowMs });
}

function operationIntentFromState(state) {
  const operation = INTENT_STATUS.get(state.status);
  if (!operation) throw new TypeError("ARC1_ASYNC_INVALID: operation intent state required");
  const intent = {
    schema: ARC1_PREVIEW_ASYNC_OPERATION_INTENT_SCHEMA,
    scope: "one-durable-idempotent-provider-operation",
    workflow_id: state.workflow_id,
    artifact_sha256: state.artifact_sha256,
    action: operation.action,
    source_state_sha256: state.prior_state_sha256,
    idempotency_key: state.operation_idempotency_key,
    provider_request_sha256: state.operation_request_sha256,
    prepared_at: state.operation_prepared_at,
    expires_at: state.operation_expires_at,
  };
  exactKeys(intent, OPERATION_INTENT_FIELDS, "operation intent");
  const raw = arc1PreviewCanonicalJson(intent);
  if (sha256(raw) !== state.operation_intent_sha256) {
    throw new TypeError("ARC1_ASYNC_INVALID: operation intent digest");
  }
  return Object.freeze({ intent: Object.freeze(intent), raw, sha256: state.operation_intent_sha256, operation });
}

function verifyReadback(restored, readbackRaw, readbackSignatureBase64url, env, {
  clock = Date.now,
  purpose = "STATE_READBACK",
} = {}) {
  const resolved = resolveEnvironment(env);
  const readback = parseCanonicalObject(readbackRaw, "state readback");
  exactKeys(readback, READBACK_FIELDS, "state readback");
  const readbackKey = resolved.readbackPublicKeys.get(readback.issuer_key_id);
  const readbackMs = parseIso(readback.readback_at, "state readback_at");
  const nowMs = clockMs(clock);
  let purposeValid = false;
  if (purpose === "STATE_READBACK") {
    purposeValid = readback.purpose === "STATE_READBACK" && readback.operation_intent_sha256 === null &&
      readback.authorization_lease_id_sha256 === null && readback.authorization_lease_expires_at === null;
  } else if (purpose === "AUTHORIZE_OPERATION") {
    const leaseExpiresMs = parseIso(readback.authorization_lease_expires_at, "authorization lease expires_at");
    purposeValid = readback.purpose === "AUTHORIZE_OPERATION" &&
      readback.operation_intent_sha256 === restored.state.operation_intent_sha256 &&
      SHA256_PATTERN.test(readback.authorization_lease_id_sha256) && leaseExpiresMs > nowMs &&
      leaseExpiresMs > readbackMs && leaseExpiresMs - readbackMs <= MAX_AUTHORIZATION_LEASE_MS;
  }
  if (readback.schema !== ARC1_PREVIEW_ASYNC_READBACK_SCHEMA ||
      readback.scope !== "authoritative-private-state-exact-readback" ||
      readback.issuer !== "private-state" || !KEY_ID_PATTERN.test(readback.issuer_key_id) ||
      !readbackKey || readbackKey.issuer !== readback.issuer ||
      readback.state_key !== stateKey(restored.state.workflow_id) ||
      readback.workflow_id !== restored.state.workflow_id ||
      !purposeValid ||
      readback.state_sha256 !== restored.stateSha256 ||
      !Number.isSafeInteger(readback.provider_record_version) || readback.provider_record_version < 1 ||
      readbackMs < restored.times.updatedMs || readbackMs > nowMs + MAX_CLOCK_SKEW_MS ||
      nowMs - readbackMs > MAX_READBACK_AGE_MS ||
      !verifyEd25519(readbackRaw, readbackSignatureBase64url, readbackKey.key)) {
    throw new TypeError("ARC1_ASYNC_DURABILITY_REQUIRED: exact state readback");
  }
  return Object.freeze(readback);
}

function persistenceResult(status, state, previousStateSha256, resolved) {
  const raw = arc1PreviewCanonicalJson(state);
  const stateSha256 = sha256(raw);
  const persistence = Object.freeze({
    mode: previousStateSha256 === null ? "CREATE_OR_EXACT" : "COMPARE_AND_SET_OR_EXACT",
    stateKey: stateKey(state.workflow_id),
    expectedPreviousStateSha256: previousStateSha256,
    stateRaw: raw,
    stateSha256,
    stateHmacSha256: stateSignature(raw, resolved.stateKeys.get(state.state_key_id)),
  });
  const logSafe = Object.freeze({
    schema: "arc1-preview-async-log-safe-v1",
    status,
    workflow_id: state.workflow_id,
    artifact_sha256: state.artifact_sha256,
    orchestration_status: state.status,
    completed_stage_count: state.completed_stage_count,
    revision: state.revision,
    state_sha256: stateSha256,
    persistence_required: true,
    provider_action_allowed: false,
  });
  return Object.freeze({ status, logSafe, logSafeJson: arc1PreviewCanonicalJson(logSafe), persistence, privateAuthorization: null });
}

export function deriveArc1PreviewAsyncWorkflowId({ artifactSha256, validationReceiptSha256 }, env) {
  resolveEnvironment(env);
  if (!SHA256_PATTERN.test(artifactSha256) || !SHA256_PATTERN.test(validationReceiptSha256)) {
    throw new TypeError("ARC1_ASYNC_INVALID: workflow identity inputs");
  }
  return `arc1preview_${sha256(`arc1-preview-async-workflow-key-v1\n${artifactSha256}\n${validationReceiptSha256}`).slice(0, 40)}`;
}

export function startArc1PreviewAsyncOrchestration({
  workflowId: suppliedWorkflowId,
  artifactSha256,
  validationReceiptSha256,
  createdAt,
  expiresAt,
}, env, { clock = Date.now } = {}) {
  const resolved = resolveEnvironment(env);
  const workflowId = deriveArc1PreviewAsyncWorkflowId({ artifactSha256, validationReceiptSha256 }, env);
  const nowMs = clockMs(clock);
  const createdMs = parseIso(createdAt, "created_at");
  const expiresMs = parseIso(expiresAt, "expires_at");
  if ((suppliedWorkflowId !== undefined && suppliedWorkflowId !== workflowId) || !WORKFLOW_PATTERN.test(workflowId) || !SHA256_PATTERN.test(artifactSha256) ||
      !SHA256_PATTERN.test(validationReceiptSha256) || createdMs > nowMs + MAX_CLOCK_SKEW_MS ||
      expiresMs <= createdMs || expiresMs - createdMs > MAX_WORKFLOW_AGE_MS || expiresMs <= nowMs) {
    throw new TypeError("ARC1_ASYNC_INVALID: start contract");
  }
  const state = {
    schema: ARC1_PREVIEW_ASYNC_STATE_SCHEMA,
    state_key_id: resolved.stateCurrentKeyId,
    workflow_id: workflowId,
    artifact_sha256: artifactSha256,
    validation_receipt_sha256: validationReceiptSha256,
    status: "READY_PR_CREATE",
    completed_stage_count: 0,
    revision: 0,
    prior_state_sha256: null,
    last_stage_receipt_sha256: null,
    operation_action: null,
    operation_intent_sha256: null,
    operation_idempotency_key: null,
    operation_prepared_at: null,
    operation_request_sha256: null,
    operation_expires_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: expiresAt,
  };
  validateStateSemantics(state, nowMs);
  return persistenceResult("ARC1_ASYNC_STATE_PREPARED", state, null, resolved);
}

export function prepareArc1PreviewAsyncOperation({
  stateRaw,
  stateHmacSha256,
  stateReadbackRaw,
  stateReadbackSignatureBase64url,
  preparedAt,
  providerRequestSha256,
}, env, { clock = Date.now } = {}) {
  const restored = restoreState(stateRaw, stateHmacSha256, env, { clock });
  verifyReadback(restored, stateReadbackRaw, stateReadbackSignatureBase64url, env, { clock });

  if (INTENT_STATUS.has(restored.state.status)) {
    const recovered = operationIntentFromState(restored.state);
    const logSafe = Object.freeze({
      schema: "arc1-preview-async-log-safe-v1",
      status: "ARC1_ASYNC_OPERATION_INTENT_ALREADY_PERSISTED",
      workflow_id: restored.state.workflow_id,
      artifact_sha256: restored.state.artifact_sha256,
      orchestration_status: restored.state.status,
      completed_stage_count: restored.state.completed_stage_count,
      revision: restored.state.revision,
      state_sha256: restored.stateSha256,
      operation_action: recovered.intent.action,
      operation_intent_sha256: recovered.sha256,
      persistence_required: false,
      provider_action_allowed: false,
    });
    return Object.freeze({
      status: logSafe.status,
      logSafe,
      logSafeJson: arc1PreviewCanonicalJson(logSafe),
      persistence: null,
      privateAuthorization: null,
      privateOperationIntent: recovered,
    });
  }

  const operation = OPERATIONS[restored.state.status];
  if (!operation) throw new Error("ARC1_ASYNC_WAIT: no provider operation is ready");
  if (!SHA256_PATTERN.test(providerRequestSha256)) throw new TypeError("ARC1_ASYNC_INVALID: provider request digest");
  const preparedMs = parseIso(preparedAt, "operation prepared_at");
  const nowMs = clockMs(clock);
  if (preparedMs < restored.times.updatedMs || preparedMs > nowMs + MAX_CLOCK_SKEW_MS ||
      nowMs - preparedMs > MAX_READBACK_AGE_MS) {
    throw new TypeError("ARC1_ASYNC_INVALID: operation prepared_at");
  }
  const operationExpiresMs = Math.min(restored.times.expiresMs, preparedMs + OPERATION_TTL_MS);
  if (operationExpiresMs <= preparedMs || operationExpiresMs <= nowMs) {
    throw new Error("ARC1_ASYNC_REVIEW_REQUIRED: operation window expired");
  }
  const idempotencyKey = `arc1op_${hmac(restored.stateSecret, "arc1-preview-async-operation-key-v1",
    `${restored.state.workflow_id}\n${restored.state.artifact_sha256}\n${operation.action}\n${providerRequestSha256}`).slice(0, 40)}`;
  const intent = {
    schema: ARC1_PREVIEW_ASYNC_OPERATION_INTENT_SCHEMA,
    scope: "one-durable-idempotent-provider-operation",
    workflow_id: restored.state.workflow_id,
    artifact_sha256: restored.state.artifact_sha256,
    action: operation.action,
    source_state_sha256: restored.stateSha256,
    idempotency_key: idempotencyKey,
    provider_request_sha256: providerRequestSha256,
    prepared_at: preparedAt,
    expires_at: new Date(operationExpiresMs).toISOString(),
  };
  const intentRaw = arc1PreviewCanonicalJson(intent);
  const intentSha256 = sha256(intentRaw);
  const next = {
    ...restored.state,
    status: operation.intent,
    revision: restored.state.revision + 1,
    prior_state_sha256: restored.stateSha256,
    operation_action: operation.action,
    operation_intent_sha256: intentSha256,
    operation_idempotency_key: idempotencyKey,
    operation_prepared_at: preparedAt,
    operation_request_sha256: providerRequestSha256,
    operation_expires_at: intent.expires_at,
    updated_at: preparedAt,
  };
  validateStateSemantics(next, nowMs);
  const result = persistenceResult("ARC1_ASYNC_OPERATION_INTENT_PREPARED", next, restored.stateSha256, restored.resolved);
  return Object.freeze({ ...result, privateOperationIntent: Object.freeze({ intent: Object.freeze(intent), raw: intentRaw, sha256: intentSha256, operation }) });
}

export function authorizeArc1PreviewAsyncOperation({
  stateRaw,
  stateHmacSha256,
  stateReadbackRaw,
  stateReadbackSignatureBase64url,
}, env, { clock = Date.now } = {}) {
  const restored = restoreState(stateRaw, stateHmacSha256, env, { clock });
  const authorizationReadback = verifyReadback(restored, stateReadbackRaw, stateReadbackSignatureBase64url, env,
    { clock, purpose: "AUTHORIZE_OPERATION" });
  const resolved = resolveEnvironment(env, { authorizeProvider: true });
  const recovered = operationIntentFromState(restored.state);
  const authorizationNowMs = clockMs(clock);
  if (Date.parse(recovered.intent.prepared_at) > authorizationNowMs) {
    throw new Error("ARC1_ASYNC_WAIT: operation intent is not active yet");
  }
  if (Date.parse(recovered.intent.expires_at) <= authorizationNowMs) {
    throw new Error("ARC1_ASYNC_REVIEW_REQUIRED: persisted operation intent expired");
  }
  const logSafe = Object.freeze({
    schema: "arc1-preview-async-log-safe-v1",
    status: "ARC1_ASYNC_PROVIDER_AUTHORIZATION_LEASE_ISSUED",
    workflow_id: restored.state.workflow_id,
    artifact_sha256: restored.state.artifact_sha256,
    orchestration_status: restored.state.status,
    completed_stage_count: restored.state.completed_stage_count,
    revision: restored.state.revision,
    state_sha256: restored.stateSha256,
    operation_action: recovered.intent.action,
    operation_intent_sha256: recovered.sha256,
    persistence_required: false,
    provider_action_allowed: false,
    atomic_authorization_consumption_required: true,
  });
  const privateAuthorization = Object.freeze({
    action: recovered.intent.action,
    operationIntentRaw: recovered.raw,
    operationIntentSha256: recovered.sha256,
    idempotencyKey: recovered.intent.idempotency_key,
    providerRequestSha256: recovered.intent.provider_request_sha256,
    authorizationLeaseIdSha256: authorizationReadback.authorization_lease_id_sha256,
    authorizationLeaseExpiresAt: authorizationReadback.authorization_lease_expires_at,
    authorizationReadbackRaw: stateReadbackRaw,
    authorizationReadbackSignatureBase64url: stateReadbackSignatureBase64url,
    stateSha256: restored.stateSha256,
    receiptStage: recovered.operation.receiptStage,
    providerActionAllowed: false,
    atomicAuthorizationConsumptionRequired: true,
  });
  // Resolve all secrets/gates before producing authorization, but never expose
  // any resolved secret in either the private or log-safe result.
  void resolved;
  return Object.freeze({
    status: logSafe.status,
    logSafe,
    logSafeJson: arc1PreviewCanonicalJson(logSafe),
    persistence: null,
    privateAuthorization,
  });
}

export function resumeArc1PreviewAsyncOrchestration({
  stateRaw,
  stateHmacSha256,
  stateReadbackRaw,
  stateReadbackSignatureBase64url,
  stageReceiptRaw,
  stageReceiptSignatureBase64url,
}, env, { clock = Date.now } = {}) {
  const restored = restoreState(stateRaw, stateHmacSha256, env, { clock });
  verifyReadback(restored, stateReadbackRaw, stateReadbackSignatureBase64url, env, { clock });
  const receipt = parseCanonicalObject(stageReceiptRaw, "stage receipt");
  exactKeys(receipt, STAGE_RECEIPT_FIELDS, "stage receipt");
  const receiptSha256 = sha256(stageReceiptRaw);
  const transition = STAGES[receipt.stage];
  const stageReceiptKey = restored.resolved.stageReceiptPublicKeys.get(receipt.issuer_key_id);
  const observedMs = parseIso(receipt.observed_at, "stage observed_at");
  const nowMs = clockMs(clock);
  if (!transition || receipt.schema !== ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_SCHEMA ||
      receipt.scope !== "authenticated-provider-stage-success" || receipt.outcome !== "SUCCEEDED" ||
      receipt.issuer !== transition?.issuer || !KEY_ID_PATTERN.test(receipt.issuer_key_id) ||
      !stageReceiptKey || stageReceiptKey.issuer !== receipt.issuer ||
      receipt.workflow_id !== restored.state.workflow_id || receipt.artifact_sha256 !== restored.state.artifact_sha256 ||
      !SHA256_PATTERN.test(receipt.provider_receipt_sha256) ||
      observedMs > nowMs + MAX_CLOCK_SKEW_MS || observedMs >= restored.times.expiresMs ||
      !verifyEd25519(stageReceiptRaw, stageReceiptSignatureBase64url, stageReceiptKey.key)) {
    throw new TypeError("ARC1_ASYNC_INVALID: stage receipt");
  }

  if (restored.state.status === transition.next && restored.state.last_stage_receipt_sha256 === receiptSha256 &&
      restored.state.completed_stage_count === transition.count) {
    const logSafe = Object.freeze({
      schema: "arc1-preview-async-log-safe-v1",
      status: "ARC1_ASYNC_STAGE_ALREADY_APPLIED",
      workflow_id: restored.state.workflow_id,
      artifact_sha256: restored.state.artifact_sha256,
      orchestration_status: restored.state.status,
      completed_stage_count: restored.state.completed_stage_count,
      revision: restored.state.revision,
      state_sha256: restored.stateSha256,
      stage: receipt.stage,
      persistence_required: false,
      provider_action_allowed: false,
    });
    return Object.freeze({ status: logSafe.status, logSafe, logSafeJson: arc1PreviewCanonicalJson(logSafe), persistence: null, privateAuthorization: null });
  }

  if (restored.state.status !== transition.waiting || receipt.prior_state_sha256 !== restored.stateSha256 ||
      receipt.observed_at < restored.state.updated_at ||
      (transition.action ? (receipt.operation_intent_sha256 !== restored.state.operation_intent_sha256 ||
        restored.state.operation_action !== transition.action) : receipt.operation_intent_sha256 !== null) ||
      restored.state.completed_stage_count !== transition.count - 1) {
    throw new Error("ARC1_ASYNC_CONFLICT: stage order or state binding");
  }

  const next = {
    ...restored.state,
    status: transition.next,
    completed_stage_count: transition.count,
    revision: restored.state.revision + 1,
    prior_state_sha256: restored.stateSha256,
    last_stage_receipt_sha256: receiptSha256,
    operation_action: null,
    operation_intent_sha256: null,
    operation_idempotency_key: null,
    operation_prepared_at: null,
    operation_expires_at: null,
    operation_request_sha256: null,
    updated_at: receipt.observed_at,
  };
  validateStateSemantics(next, nowMs);
  return persistenceResult(
    next.status === "COMPLETE" ? "ARC1_ASYNC_ORCHESTRATION_COMPLETED" : "ARC1_ASYNC_STAGE_APPLIED",
    next,
    restored.stateSha256,
    restored.resolved,
  );
}
