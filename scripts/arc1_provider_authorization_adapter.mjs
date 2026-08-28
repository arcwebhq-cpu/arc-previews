import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

export const ARC1_PROVIDER_AUTHORIZATION_CONSUMPTION_SCHEMA =
  "arc1-preview-provider-authorization-consumption-v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const WORKFLOW_PATTERN = /^arc1preview_[a-f0-9]{40}$/;
const OPERATION_KEY_PATTERN = /^arc1op_[a-f0-9]{40}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_LEASE_MS = 60_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: canonical JSON value");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseCanonical(raw, label, maximum = 16_384) {
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw) > maximum) {
    throw new TypeError(`ARC1_AUTHORIZATION_ADAPTER_INVALID: ${label} size`);
  }
  let value;
  try { value = JSON.parse(raw); } catch { throw new TypeError(`ARC1_AUTHORIZATION_ADAPTER_INVALID: ${label} JSON`); }
  if (!isPlainObject(value) || canonicalJson(value) !== raw) {
    throw new TypeError(`ARC1_AUTHORIZATION_ADAPTER_INVALID: ${label} canonical JSON`);
  }
  return value;
}

function exactKeys(value, fields, label) {
  if (!isPlainObject(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new TypeError(`ARC1_AUTHORIZATION_ADAPTER_INVALID: ${label} fields`);
  }
}

function parseIso(value, label) {
  const milliseconds = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`ARC1_AUTHORIZATION_ADAPTER_INVALID: ${label}`);
  }
  return milliseconds;
}

const INTENT_FIELDS = Object.freeze([
  "action", "artifact_sha256", "expires_at", "idempotency_key", "prepared_at",
  "provider_request_sha256", "schema", "scope", "source_state_sha256", "workflow_id",
]);
const READBACK_FIELDS = Object.freeze([
  "authorization_lease_expires_at", "authorization_lease_id_sha256", "issuer", "issuer_key_id",
  "operation_intent_sha256", "provider_record_version", "purpose", "readback_at", "schema", "scope",
  "state_key", "state_sha256", "workflow_id",
]);

function validateKeyring(raw) {
  const keyring = parseCanonical(raw, "authorization readback public keyring", 32_768);
  const result = new Map();
  const entries = Object.entries(keyring);
  if (entries.length < 1 || entries.length > 16) {
    throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: authorization readback public keyring");
  }
  for (const [keyId, record] of entries) {
    exactKeys(record, ["issuer", "public_key_pem"], "authorization readback public key");
    if (!KEY_ID_PATTERN.test(keyId) || record.issuer !== "private-state" ||
        typeof record.public_key_pem !== "string" || /PRIVATE KEY/.test(record.public_key_pem)) {
      throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: authorization readback public key");
    }
    let key;
    try { key = createPublicKey(record.public_key_pem); } catch {
      throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: authorization readback public key");
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: authorization readback public key");
    }
    result.set(keyId, key);
  }
  return result;
}

export function providerAuthorizationConsumptionId({
  stateKey,
  authorizationLeaseIdSha256,
  operationIntentSha256,
  consumptionProviderRecordVersion,
}) {
  return sha256(`arc1-preview-provider-authorization-consumption-id-v1\n${stateKey}\n${authorizationLeaseIdSha256}\n${operationIntentSha256}\n${consumptionProviderRecordVersion}`);
}

export async function consumeArc1ProviderAuthorizationLease({
  operationIntentRaw,
  authorizationReadbackRaw,
  authorizationReadbackSignatureBase64url,
  expectedAction,
  expectedArtifactSha256,
  expectedProviderRequestSha256,
}, adapter, {
  clock = Date.now,
  signer,
  issuerKeyId,
  authorizationReadbackPublicKeyringJson,
} = {}) {
  if (!adapter || typeof adapter.consumeExact !== "function" || typeof signer !== "function" ||
      !KEY_ID_PATTERN.test(issuerKeyId)) {
    throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: trusted adapter dependencies");
  }
  const intent = parseCanonical(operationIntentRaw, "operation intent");
  const readback = parseCanonical(authorizationReadbackRaw, "authorization readback");
  exactKeys(intent, INTENT_FIELDS, "operation intent");
  exactKeys(readback, READBACK_FIELDS, "authorization readback");
  const now = Number(clock());
  if (!Number.isFinite(now)) throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: clock");
  const preparedMs = parseIso(intent.prepared_at, "intent prepared_at");
  const intentExpiresMs = parseIso(intent.expires_at, "intent expires_at");
  const readbackMs = parseIso(readback.readback_at, "readback_at");
  const leaseExpiresMs = parseIso(readback.authorization_lease_expires_at, "lease expires_at");
  const intentSha256 = sha256(operationIntentRaw);
  if (intent.schema !== "arc1-preview-async-operation-intent-v1" ||
      intent.scope !== "one-durable-idempotent-provider-operation" ||
      intent.action !== expectedAction || intent.artifact_sha256 !== expectedArtifactSha256 ||
      intent.provider_request_sha256 !== expectedProviderRequestSha256 ||
      !WORKFLOW_PATTERN.test(intent.workflow_id) || !OPERATION_KEY_PATTERN.test(intent.idempotency_key) ||
      !SHA256_PATTERN.test(intent.artifact_sha256) || !SHA256_PATTERN.test(intent.source_state_sha256) ||
      !SHA256_PATTERN.test(intent.provider_request_sha256) || preparedMs > now + MAX_CLOCK_SKEW_MS ||
      intentExpiresMs <= now || intentExpiresMs <= preparedMs) {
    throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: operation intent binding");
  }
  const readbackKeys = validateKeyring(authorizationReadbackPublicKeyringJson);
  const readbackKey = readbackKeys.get(readback.issuer_key_id);
  const signature = Buffer.from(String(authorizationReadbackSignatureBase64url || ""), "base64url");
  if (readback.schema !== "arc1-preview-async-state-readback-v1" ||
      readback.scope !== "authoritative-private-state-exact-readback" || readback.issuer !== "private-state" ||
      readback.purpose !== "AUTHORIZE_OPERATION" || !readbackKey || signature.length !== 64 ||
      readback.operation_intent_sha256 !== intentSha256 || readback.workflow_id !== intent.workflow_id ||
      readback.state_key !== `arc1-preview-async-v1:${intent.workflow_id}` ||
      !SHA256_PATTERN.test(readback.state_sha256) ||
      !SHA256_PATTERN.test(readback.authorization_lease_id_sha256) ||
      !Number.isSafeInteger(readback.provider_record_version) || readback.provider_record_version < 1 ||
      readbackMs < preparedMs || readbackMs > now + MAX_CLOCK_SKEW_MS ||
      leaseExpiresMs <= now || leaseExpiresMs <= readbackMs || leaseExpiresMs > intentExpiresMs ||
      leaseExpiresMs - readbackMs > MAX_LEASE_MS ||
      !verifySignature(null, Buffer.from(authorizationReadbackRaw), readbackKey, signature)) {
    throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: authorization readback binding");
  }

  const consumedAt = new Date(now).toISOString();
  const consumptionProviderRecordVersion = readback.provider_record_version + 1;
  const consumptionIdSha256 = providerAuthorizationConsumptionId({
    stateKey: readback.state_key,
    authorizationLeaseIdSha256: readback.authorization_lease_id_sha256,
    operationIntentSha256: intentSha256,
    consumptionProviderRecordVersion,
  });
  const consumption = {
    schema: ARC1_PROVIDER_AUTHORIZATION_CONSUMPTION_SCHEMA,
    scope: "atomic-one-use-provider-authorization-consumption",
    issuer: "private-state-authorization-adapter",
    issuer_key_id: issuerKeyId,
    purpose: "CONSUME_OPERATION_AUTHORIZATION",
    workflow_id: intent.workflow_id,
    state_key: readback.state_key,
    state_sha256: readback.state_sha256,
    action: intent.action,
    artifact_sha256: intent.artifact_sha256,
    provider_request_sha256: intent.provider_request_sha256,
    idempotency_key: intent.idempotency_key,
    operation_intent_sha256: intentSha256,
    authorization_readback_sha256: sha256(authorizationReadbackRaw),
    authorization_lease_id_sha256: readback.authorization_lease_id_sha256,
    authorization_lease_expires_at: readback.authorization_lease_expires_at,
    authorization_provider_record_version: readback.provider_record_version,
    consumption_provider_record_version: consumptionProviderRecordVersion,
    consumption_id_sha256: consumptionIdSha256,
    consumed_at: consumedAt,
  };
  const raw = canonicalJson(consumption);
  const target = Object.freeze({
    authorizationLeaseIdSha256: readback.authorization_lease_id_sha256,
    authorizationReadbackSha256: consumption.authorization_readback_sha256,
    expectedProviderRecordVersion: readback.provider_record_version,
    expectedStateSha256: readback.state_sha256,
    operationIntentSha256: intentSha256,
    targetConsumptionIdSha256: consumptionIdSha256,
    targetConsumptionRaw: raw,
    targetConsumptionSha256: sha256(raw),
  });
  const persisted = await adapter.consumeExact(readback.state_key, target);
  if (!persisted || typeof persisted.consumptionRaw !== "string" ||
      persisted.consumptionSha256 !== sha256(persisted.consumptionRaw) ||
      persisted.providerRecordVersion !== consumptionProviderRecordVersion) {
    throw new Error("ARC1_AUTHORIZATION_ADAPTER_DURABILITY_REQUIRED: atomic exact consumption readback");
  }
  const persistedParsed = parseCanonical(persisted.consumptionRaw, "persisted consumption");
  const persistedConsumedMs = parseIso(persistedParsed.consumed_at, "persisted consumed_at");
  const expectedExceptTime = { ...consumption };
  const actualExceptTime = { ...persistedParsed };
  delete expectedExceptTime.consumed_at;
  delete actualExceptTime.consumed_at;
  if (canonicalJson(actualExceptTime) !== canonicalJson(expectedExceptTime) ||
      persistedParsed.consumption_id_sha256 !== consumptionIdSha256 ||
      persistedConsumedMs < preparedMs || persistedConsumedMs > now + MAX_CLOCK_SKEW_MS ||
      persistedConsumedMs >= leaseExpiresMs) {
    throw new Error("ARC1_AUTHORIZATION_ADAPTER_DURABILITY_REQUIRED: persisted consumption identity");
  }
  const signed = await signer(persisted.consumptionRaw);
  if (typeof signed !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signed)) {
    throw new TypeError("ARC1_AUTHORIZATION_ADAPTER_INVALID: consumption signature");
  }
  return Object.freeze({
    privateOutput: Object.freeze({
      async_authorization_consumption_private: persisted.consumptionRaw,
      async_authorization_consumption_signature_base64url: signed,
    }),
    logSafe: Object.freeze({
      schema: "arc1-preview-provider-authorization-consumption-log-safe-v1",
      status: "ARC1_PROVIDER_AUTHORIZATION_ATOMICALLY_CONSUMED",
      workflow_id: persistedParsed.workflow_id,
      operation_intent_sha256: persistedParsed.operation_intent_sha256,
      provider_request_sha256: persistedParsed.provider_request_sha256,
      authorization_consumption_id_sha256: persistedParsed.consumption_id_sha256,
      authorization_consumption_sha256: persisted.consumptionSha256,
      provider_record_version: persisted.providerRecordVersion,
      provider_action_allowed: false,
      packaged_provider_verification_required: true,
    }),
  });
}
