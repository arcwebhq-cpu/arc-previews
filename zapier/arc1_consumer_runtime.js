// GENERATED FILE. Do not edit; run `node scripts/build_arc1_consumer_runtime.mjs`.
// NOT PROVIDER-READY: use only in a private Node 18+ integration after the deployment contract passes.
// The provider must redact raw step inputs/outputs and must not retain packet JSON in run history.

const arc1ConsumerCore = (() => {
const { createHash, createHmac, timingSafeEqual } = require("crypto");

const ARC1_CONSUMER_PACKET_SCHEMA = "arc-intake-arc1-downstream-dispatch-v2";
const ARC1_CONSUMER_CLAIM_REQUEST_SCHEMA = "arc-intake-arc1-consumer-claim-request-v1";
const ARC1_CONSUMER_CLAIM_SCHEMA = "arc-intake-arc1-consumer-claim-v1";
const ARC1_CONSUMER_COMPLETION_REQUEST_SCHEMA = "arc-intake-arc1-consumer-completion-request-v1";
const ARC1_CONSUMER_COMPLETION_SCHEMA = "arc-intake-arc1-consumer-completion-v1";
const ARC1_CONSUMER_FENCE_SCHEMA = "arc-intake-arc1-consumer-mutation-fence-v1";
const ARC1_CONSUMER_DURABLE_RESULT_SCHEMA = "arc-intake-arc1-consumer-durable-result-v1";

const ARC1_CONSUMER_CLAIM_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED";
const ARC1_CONSUMER_COMPLETION_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED";
const ARC1_CONSUMER_PACKET_SECRET_ENV = "ARC_INTAKE_ARC1_PACKET_SECRET";
const ARC1_CONSUMER_BEARER_ENV = "ARC_INTAKE_ARC1_CONSUMER_BEARER";
const ARC1_CONSUMER_RECEIPT_SECRET_ENV = "ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET";
const ARC1_CONSUMER_DURABLE_RESULT_SECRET_ENV = "ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET";
const ARC1_CONSUMER_TIMEOUT_ENV = "ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS";

const ARC1_CONSUMER_CLAIM_ENDPOINT = "https://arcweb.onl/internal/intake/arc1/adapter/claim";
const ARC1_CONSUMER_COMPLETION_ENDPOINT = "https://arcweb.onl/internal/intake/arc1/adapter/complete";
const ARC1_CONSUMER_MAX_PACKET_BYTES = 1_000_000;
const ARC1_CONSUMER_MAX_RESPONSE_BYTES = 16_384;
// The first-party packet never outlives its signed bridge evidence (24 hours).
// A separate 15-minute site-side AWAITING_CLAIM deadline starts only after the
// downstream hook accepts the packet.
const ARC1_CONSUMER_MAX_PACKET_LIFETIME_MS = 24 * 60 * 60_000;
const ARC1_CONSUMER_MAX_CLAIM_LIFETIME_MS = 30 * 60_000;
const ARC1_CONSUMER_MAX_CLOCK_SKEW_MS = 5 * 60_000;

const BRIDGE_CONTRACT_SHA256 = "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2";
const CONSUMER_SCHEMA = "arc1-function-intake-adapter-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ATTEMPT_PATTERN = /^arc1attempt_[a-f0-9]{40}$/;
const PACKET_FIELDS = Object.freeze([
  "asset_receipt_hmac_sha256", "asset_receipt_private", "asset_receipt_sha256", "bridge_contract_sha256",
  "bridge_delivery_id", "bridge_envelope_json", "bridge_evidence_expires_at", "bridge_evidence_issued_at",
  "bridge_evidence_sha256", "claim_endpoint", "completion_endpoint", "consumer_schema",
  "ingress_claim_asset_receipt_sha256", "ingress_claim_bridge_delivery_id", "ingress_claim_bridge_evidence_sha256",
  "ingress_claim_created_at", "ingress_claim_mode", "ingress_claim_state_digest_sha256", "ingress_claim_state_key",
  "ingress_claim_status", "ingress_state_digest_sha256", "ingress_state_key", "packet_expires_at",
  "packet_hmac_sha256", "packet_issued_at", "protocol_version", "schema",
]);
const CLAIM_REQUEST_FIELDS = Object.freeze([
  "consumer_attempt_id", "delivery_id", "packet_sha256", "requested_at", "schema",
]);
const CLAIM_FIELDS = Object.freeze([
  "claim_expires_at", "claim_token", "claimed_at", "consumer_attempt_id", "delivery_id", "idempotent_replay",
  "packet_sha256", "schema", "status",
]);
const COMPLETION_REQUEST_FIELDS = Object.freeze([
  "claim_token", "completed_at", "consumer_attempt_id", "delivery_id", "packet_sha256", "result_sha256", "schema",
]);
const COMPLETION_FIELDS = Object.freeze([
  "completed_at", "completion_receipt_sha256", "consumer_attempt_id", "delivery_id", "idempotent_replay",
  "packet_sha256", "result_sha256", "schema", "status",
]);
const FENCE_FIELDS = Object.freeze([
  "claim_expires_at", "claim_request_sha256", "claim_response_sha256", "claim_token_sha256", "claimed_at",
  "consumer_attempt_id", "delivery_id", "ingress_state_digest_sha256", "mutation_idempotency_key", "packet_sha256",
  "schema",
]);
const DURABLE_RESULT_FIELDS = Object.freeze([
  "claim_token_sha256", "committed_at", "consumer_attempt_id", "delivery_id", "durable_state_receipt_sha256",
  "immutable_result_sha256", "ingress_state_digest_sha256", "packet_sha256", "schema", "status",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, fields) {
  return isPlainObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("ARC1_CONSUMER_INVALID: non-finite JSON value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("ARC1_CONSUMER_INVALID: plain JSON values required");
}

const arc1ConsumerSha256Hex = (value) => createHash("sha256").update(value).digest("hex");
const arc1ConsumerHmacHex = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");
const arc1ConsumerSafeEqualHex = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string" || !SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};
const sha256 = arc1ConsumerSha256Hex;
const hmac = arc1ConsumerHmacHex;
const safeEqualHex = arc1ConsumerSafeEqualHex;
const requireSha = (value, label) => {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new TypeError(`ARC1_CONSUMER_INVALID: ${label}`);
  return value;
};
const requireSecret = (value, label) => {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32 || Buffer.byteLength(value, "utf8") > 256) {
    throw new TypeError(`ARC1_CONSUMER_INVALID: ${label} must be 32-256 UTF-8 bytes`);
  }
  return value;
};
const requireIso = (value, label) => {
  if (typeof value !== "string") throw new TypeError(`ARC1_CONSUMER_INVALID: ${label}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`ARC1_CONSUMER_INVALID: ${label}`);
  }
  return { value, milliseconds };
};
const clockMilliseconds = (clock) => {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError("ARC1_CONSUMER_INVALID: clock");
  return milliseconds;
};

function resolveTimeout(env) {
  const raw = env[ARC1_CONSUMER_TIMEOUT_ENV];
  const timeoutMs = raw === undefined || raw === "" ? 10_000 : Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new TypeError(`ARC1_CONSUMER_INVALID: ${ARC1_CONSUMER_TIMEOUT_ENV}`);
  }
  return timeoutMs;
}

function resolveArc1ConsumerEnvironment(env, { requireClaim = false, requireCompletion = false } = {}) {
  if (!isPlainObject(env) && typeof env !== "object") throw new TypeError("ARC1_CONSUMER_INVALID: environment");
  if (requireClaim && env[ARC1_CONSUMER_CLAIM_ENABLED_ENV] !== "true") throw new Error("ARC1_CONSUMER_CLAIM_DISABLED");
  if (requireCompletion && env[ARC1_CONSUMER_COMPLETION_ENABLED_ENV] !== "true") throw new Error("ARC1_CONSUMER_COMPLETION_DISABLED");
  const packetSecret = requireSecret(env[ARC1_CONSUMER_PACKET_SECRET_ENV], ARC1_CONSUMER_PACKET_SECRET_ENV);
  const consumerBearer = requireSecret(env[ARC1_CONSUMER_BEARER_ENV], ARC1_CONSUMER_BEARER_ENV);
  const receiptSecret = requireSecret(env[ARC1_CONSUMER_RECEIPT_SECRET_ENV], ARC1_CONSUMER_RECEIPT_SECRET_ENV);
  const durableResultSecret = requireSecret(env[ARC1_CONSUMER_DURABLE_RESULT_SECRET_ENV], ARC1_CONSUMER_DURABLE_RESULT_SECRET_ENV);
  if (new Set([packetSecret, consumerBearer, receiptSecret, durableResultSecret]).size !== 4) {
    throw new TypeError("ARC1_CONSUMER_INVALID: consumer secrets must be distinct");
  }
  return { packetSecret, consumerBearer, receiptSecret, durableResultSecret, timeoutMs: resolveTimeout(env) };
}

function parseCanonicalObject(raw, maximumBytes, label) {
  if (typeof raw !== "string" || !raw || Buffer.byteLength(raw, "utf8") > maximumBytes) {
    throw new TypeError(`ARC1_CONSUMER_INVALID: ${label} size`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new TypeError(`ARC1_CONSUMER_INVALID: ${label} JSON`); }
  if (!isPlainObject(parsed) || canonicalJson(parsed) !== raw) throw new TypeError(`ARC1_CONSUMER_INVALID: ${label} canonical JSON`);
  return parsed;
}

function verifyArc1ConsumerPacket(packetRaw, env, { clock = Date.now, allowExpired = false } = {}) {
  const resolved = resolveArc1ConsumerEnvironment(env);
  const packet = parseCanonicalObject(packetRaw, ARC1_CONSUMER_MAX_PACKET_BYTES, "packet");
  if (!exactKeys(packet, PACKET_FIELDS) || packet.schema !== ARC1_CONSUMER_PACKET_SCHEMA || packet.protocol_version !== 2 ||
      packet.consumer_schema !== CONSUMER_SCHEMA || packet.bridge_contract_sha256 !== BRIDGE_CONTRACT_SHA256 ||
      packet.claim_endpoint !== ARC1_CONSUMER_CLAIM_ENDPOINT || packet.completion_endpoint !== ARC1_CONSUMER_COMPLETION_ENDPOINT ||
      packet.ingress_claim_status !== "CLAIMED" || !["CREATED", "EXACT_REPLAY"].includes(packet.ingress_claim_mode)) {
    throw new TypeError("ARC1_CONSUMER_INVALID: packet contract");
  }
  for (const [value, label] of [
    [packet.bridge_delivery_id, "bridge_delivery_id"], [packet.bridge_evidence_sha256, "bridge_evidence_sha256"],
    [packet.asset_receipt_sha256, "asset_receipt_sha256"], [packet.asset_receipt_hmac_sha256, "asset_receipt_hmac_sha256"],
    [packet.ingress_state_digest_sha256, "ingress_state_digest_sha256"],
    [packet.ingress_claim_state_digest_sha256, "ingress_claim_state_digest_sha256"],
    [packet.ingress_claim_bridge_delivery_id, "ingress_claim_bridge_delivery_id"],
    [packet.ingress_claim_bridge_evidence_sha256, "ingress_claim_bridge_evidence_sha256"],
    [packet.ingress_claim_asset_receipt_sha256, "ingress_claim_asset_receipt_sha256"],
    [packet.packet_hmac_sha256, "packet_hmac_sha256"],
  ]) requireSha(value, label);
  if (!/^arc1-function-ingress-v1:[a-f0-9]{64}$/.test(packet.ingress_state_key) ||
      packet.ingress_state_key !== `arc1-function-ingress-v1:${packet.ingress_state_digest_sha256}` ||
      packet.ingress_claim_state_key !== packet.ingress_state_key ||
      packet.ingress_claim_state_digest_sha256 !== packet.ingress_state_digest_sha256 ||
      packet.ingress_claim_bridge_delivery_id !== packet.bridge_delivery_id ||
      packet.ingress_claim_bridge_evidence_sha256 !== packet.bridge_evidence_sha256 ||
      packet.ingress_claim_asset_receipt_sha256 !== packet.asset_receipt_sha256) {
    throw new TypeError("ARC1_CONSUMER_INVALID: packet duplicate binding");
  }
  const envelope = parseCanonicalObject(packet.bridge_envelope_json, 900_000, "bridge envelope");
  if (!exactKeys(envelope, ["evidence", "hmac_sha256", "schema"]) || envelope.schema !== "arc-intake-arc1-bridge-envelope-v1" ||
      !isPlainObject(envelope.evidence) || envelope.evidence.delivery_id !== packet.bridge_delivery_id ||
      !SHA256_PATTERN.test(envelope.hmac_sha256)) throw new TypeError("ARC1_CONSUMER_INVALID: bridge envelope binding");
  const receipt = parseCanonicalObject(packet.asset_receipt_private, 16_384, "asset receipt");
  if (sha256(packet.asset_receipt_private) !== packet.asset_receipt_sha256 ||
      receipt.delivery_id !== packet.bridge_delivery_id || receipt.bridge_evidence_sha256 !== packet.bridge_evidence_sha256) {
    throw new TypeError("ARC1_CONSUMER_INVALID: asset receipt binding");
  }
  const issued = requireIso(packet.packet_issued_at, "packet_issued_at");
  const expires = requireIso(packet.packet_expires_at, "packet_expires_at");
  const bridgeIssued = requireIso(packet.bridge_evidence_issued_at, "bridge_evidence_issued_at");
  const bridgeExpires = requireIso(packet.bridge_evidence_expires_at, "bridge_evidence_expires_at");
  const ingressClaimed = requireIso(packet.ingress_claim_created_at, "ingress_claim_created_at");
  const nowMs = clockMilliseconds(clock);
  if (expires.milliseconds <= issued.milliseconds ||
      expires.milliseconds > issued.milliseconds + ARC1_CONSUMER_MAX_PACKET_LIFETIME_MS + ARC1_CONSUMER_MAX_CLOCK_SKEW_MS ||
      bridgeExpires.milliseconds > bridgeIssued.milliseconds + ARC1_CONSUMER_MAX_PACKET_LIFETIME_MS ||
      expires.milliseconds > bridgeExpires.milliseconds ||
      issued.milliseconds < bridgeIssued.milliseconds - ARC1_CONSUMER_MAX_CLOCK_SKEW_MS ||
      ingressClaimed.milliseconds !== issued.milliseconds || issued.milliseconds > nowMs + ARC1_CONSUMER_MAX_CLOCK_SKEW_MS ||
      (!allowExpired && expires.milliseconds <= nowMs)) throw new TypeError("ARC1_CONSUMER_INVALID: packet deadline");
  const unsigned = { ...packet };
  delete unsigned.packet_hmac_sha256;
  const expectedHmac = hmac(resolved.packetSecret, `arc-intake-arc1-downstream-packet-v2\n${canonicalJson(unsigned)}`);
  if (!safeEqualHex(packet.packet_hmac_sha256, expectedHmac)) throw new TypeError("ARC1_CONSUMER_INVALID: packet HMAC");
  return Object.freeze({ packet: Object.freeze(packet), packetRaw, packetSha256: sha256(packetRaw), issued, expires });
}

function deriveConsumerAttemptId(packetSha256, stableAttemptId, receiptSecret) {
  if (typeof stableAttemptId !== "string" || Buffer.byteLength(stableAttemptId, "utf8") < 16 ||
      Buffer.byteLength(stableAttemptId, "utf8") > 256 || /[\u0000-\u001f\u007f]/u.test(stableAttemptId)) {
    throw new TypeError("ARC1_CONSUMER_INVALID: stable per-workflow attempt id");
  }
  return `arc1attempt_${hmac(receiptSecret, `arc-intake-arc1-consumer-attempt-v1\n${packetSha256}\n${stableAttemptId}`).slice(0, 40)}`;
}

function deriveMutationIdempotencyKey(packetSha256, consumerAttemptId, receiptSecret) {
  return `arc1mutation_${hmac(receiptSecret,
    `arc-intake-arc1-consumer-mutation-idempotency-v1\n${packetSha256}\n${consumerAttemptId}`).slice(0, 40)}`;
}

function verifyArc1MutationFence(fenceRaw, fenceHmacSha256, expected, env, { clock = Date.now } = {}) {
  const resolved = resolveArc1ConsumerEnvironment(env, { requireClaim: true, requireCompletion: true });
  const fence = parseCanonicalObject(fenceRaw, 16_384, "mutation fence");
  if (!exactKeys(fence, FENCE_FIELDS) || fence.schema !== ARC1_CONSUMER_FENCE_SCHEMA ||
      !SHA256_PATTERN.test(fence.delivery_id) || !SHA256_PATTERN.test(fence.packet_sha256) ||
      !ATTEMPT_PATTERN.test(fence.consumer_attempt_id) || !SHA256_PATTERN.test(fence.claim_token_sha256) ||
      !SHA256_PATTERN.test(fence.ingress_state_digest_sha256) || !SHA256_PATTERN.test(fence.claim_request_sha256) ||
      !SHA256_PATTERN.test(fence.claim_response_sha256) || !/^arc1mutation_[a-f0-9]{40}$/.test(fence.mutation_idempotency_key)) {
    throw new TypeError("ARC1_CONSUMER_FENCE_INVALID: contract");
  }
  if (!isPlainObject(expected) || fence.delivery_id !== expected.deliveryId ||
      fence.packet_sha256 !== expected.packetSha256 || fence.consumer_attempt_id !== expected.consumerAttemptId ||
      fence.ingress_state_digest_sha256 !== expected.ingressStateDigestSha256) {
    throw new TypeError("ARC1_CONSUMER_FENCE_INVALID: job binding");
  }
  const expectedHmac = hmac(resolved.receiptSecret, `arc-intake-arc1-consumer-mutation-fence-v1\n${fenceRaw}`);
  if (!safeEqualHex(fenceHmacSha256, expectedHmac)) throw new TypeError("ARC1_CONSUMER_FENCE_INVALID: HMAC");
  if (fence.mutation_idempotency_key !== deriveMutationIdempotencyKey(
    fence.packet_sha256, fence.consumer_attempt_id, resolved.receiptSecret)) {
    throw new TypeError("ARC1_CONSUMER_FENCE_INVALID: mutation idempotency binding");
  }
  const claimed = requireIso(fence.claimed_at, "fence claimed_at");
  const expires = requireIso(fence.claim_expires_at, "fence claim_expires_at");
  const nowMs = clockMilliseconds(clock);
  if (claimed.milliseconds > nowMs + ARC1_CONSUMER_MAX_CLOCK_SKEW_MS || expires.milliseconds <= nowMs ||
      expires.milliseconds <= claimed.milliseconds || expires.milliseconds > claimed.milliseconds + ARC1_CONSUMER_MAX_CLAIM_LIFETIME_MS) {
    throw new TypeError("ARC1_CONSUMER_FENCE_INVALID: stale claim");
  }
  return Object.freeze(fence);
}

async function readBoundedResponse(response, controller, deadlineMs, maximumBytes, { parseJson = true } = {}) {
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      try { await response.body?.cancel?.(); } catch {}
      throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: declared response exceeds limit");
    }
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: streaming response required");
  const chunks = [];
  let total = 0;
  const remaining = () => Math.max(0, deadlineMs - Date.now());
  try {
    while (true) {
      if (remaining() <= 0) throw new Error("ARC1_CONSUMER_NETWORK_TIMEOUT");
      const read = reader.read();
      const timeout = new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("ARC1_CONSUMER_NETWORK_TIMEOUT")), remaining());
        read.finally(() => clearTimeout(timer)).catch(() => {});
      });
      const { done, value } = await Promise.race([read, timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: response body");
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: streamed response exceeds limit");
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } catch (error) {
    controller.abort();
    try { await reader.cancel(); } catch {}
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  let raw;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)); }
  catch { throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: response encoding"); }
  if (!parseJson) return { raw };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: malformed JSON response"); }
  if (!isPlainObject(parsed)) throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: response object");
  return { parsed, raw };
}

async function postCanonicalWithReplay(url, raw, headers, resolved, fetchImpl) {
  const operationDeadline = Date.now() + resolved.timeoutMs;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const remaining = operationDeadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const requestDeadline = Date.now() + Math.min(5_000, remaining);
    let retryBackoffMs = 25;
    let timer;
    try {
      const requestPromise = fetchImpl(url, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { ...headers, "Content-Type": "application/json" }, body: raw,
      });
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("ARC1_CONSUMER_NETWORK_TIMEOUT")); },
          Math.max(1, requestDeadline - Date.now()));
      });
      const response = await Promise.race([requestPromise, timeoutPromise]);
      if (!response || typeof response.status !== "number" || response.url !== url) {
        throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: response URL changed");
      }
      const retryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
      if (retryableStatus) {
        // A trusted network/proxy failure can legitimately be HTML or empty.
        // Bound/cancel it under the same deadline, then preserve the exact
        // request bytes for the one retry. Never treat that body as authority.
        try {
          await readBoundedResponse(response, controller, requestDeadline, ARC1_CONSUMER_MAX_RESPONSE_BYTES,
            { parseJson: false });
          lastError = new Error(`ARC1_CONSUMER_RETRYABLE: HTTP ${response.status}`);
        } catch (error) {
          lastError = error;
        }
        if (response.status === 425) retryBackoffMs = 50;
      } else {
        const responseMediaType = response.headers?.get?.("content-type")?.trim().toLowerCase();
        if (!["application/json", "application/json; charset=utf-8"].includes(responseMediaType)) {
          throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: response media type");
        }
        const body = await readBoundedResponse(response, controller, requestDeadline, ARC1_CONSUMER_MAX_RESPONSE_BYTES);
        if (response.status === 200) return body.parsed;
        if (response.status === 409) throw new Error("ARC1_CONSUMER_CONFLICT");
        throw new Error(`ARC1_CONSUMER_RESPONSE_INVALID: HTTP ${response.status}`);
      }
    } catch (error) {
      if (error?.message === "ARC1_CONSUMER_CONFLICT" ||
          String(error?.message || "").startsWith("ARC1_CONSUMER_RESPONSE_INVALID:")) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    if (attempt < 2) {
      const delayMs = Math.min(retryBackoffMs, Math.max(0, operationDeadline - Date.now() - 1));
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error("ARC1_CONSUMER_NETWORK_TIMEOUT");
}

function validateClaimResponse(response, verified, consumerAttemptId, requestSha256, resolved, nowMs) {
  if (!exactKeys(response, CLAIM_FIELDS) || response.schema !== ARC1_CONSUMER_CLAIM_SCHEMA || response.status !== "CLAIMED" ||
      response.delivery_id !== verified.packet.bridge_delivery_id || response.packet_sha256 !== verified.packetSha256 ||
      response.consumer_attempt_id !== consumerAttemptId || !SHA256_PATTERN.test(response.claim_token) ||
      typeof response.idempotent_replay !== "boolean") throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: claim contract");
  const claimed = requireIso(response.claimed_at, "claim claimed_at");
  const expires = requireIso(response.claim_expires_at, "claim claim_expires_at");
  if (claimed.milliseconds < verified.issued.milliseconds || claimed.milliseconds > verified.expires.milliseconds ||
      claimed.milliseconds > nowMs + ARC1_CONSUMER_MAX_CLOCK_SKEW_MS || expires.milliseconds <= nowMs ||
      expires.milliseconds <= claimed.milliseconds || expires.milliseconds > claimed.milliseconds + ARC1_CONSUMER_MAX_CLAIM_LIFETIME_MS ||
      expires.milliseconds > verified.expires.milliseconds) {
    throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: claim deadline");
  }
  // The authority changes only this transport replay marker after a lost
  // response. Normalize it so crash recovery reproduces the exact same
  // durable fence/state bytes for the same claim identity.
  const responseIdentityRaw = canonicalJson({ ...response, idempotent_replay: false });
  const fence = {
    schema: ARC1_CONSUMER_FENCE_SCHEMA, delivery_id: response.delivery_id, packet_sha256: response.packet_sha256,
    consumer_attempt_id: consumerAttemptId, claim_token_sha256: sha256(response.claim_token), claimed_at: response.claimed_at,
    claim_expires_at: response.claim_expires_at, ingress_state_digest_sha256: verified.packet.ingress_state_digest_sha256,
    claim_request_sha256: requestSha256, claim_response_sha256: sha256(responseIdentityRaw),
    mutation_idempotency_key: deriveMutationIdempotencyKey(verified.packetSha256, consumerAttemptId, resolved.receiptSecret),
  };
  if (!exactKeys(fence, FENCE_FIELDS)) throw new Error("ARC1_CONSUMER_INVALID: internal fence contract");
  const fenceRaw = canonicalJson(fence);
  return Object.freeze({
    ...response, claimToken: response.claim_token, claimTokenSha256: fence.claim_token_sha256,
    fence: Object.freeze(fence), fenceRaw, fenceSha256: sha256(fenceRaw),
    fenceHmacSha256: hmac(resolved.receiptSecret, `arc-intake-arc1-consumer-mutation-fence-v1\n${fenceRaw}`),
    mutationIdempotencyKey: fence.mutation_idempotency_key,
  });
}

async function claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, {
  clock = Date.now, fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const resolved = resolveArc1ConsumerEnvironment(env, { requireClaim: true, requireCompletion: true });
  if (typeof fetchImpl !== "function") throw new TypeError("ARC1_CONSUMER_INVALID: fetch adapter");
  const verified = verifyArc1ConsumerPacket(packetRaw, env, { clock });
  const consumerAttemptId = deriveConsumerAttemptId(verified.packetSha256, stableAttemptId, resolved.receiptSecret);
  if (!ATTEMPT_PATTERN.test(consumerAttemptId)) throw new TypeError("ARC1_CONSUMER_INVALID: consumer attempt id");
  const request = {
    schema: ARC1_CONSUMER_CLAIM_REQUEST_SCHEMA, delivery_id: verified.packet.bridge_delivery_id,
    packet_sha256: verified.packetSha256, consumer_attempt_id: consumerAttemptId,
    requested_at: verified.packet.packet_issued_at,
  };
  if (!exactKeys(request, CLAIM_REQUEST_FIELDS)) throw new Error("ARC1_CONSUMER_INVALID: internal claim request contract");
  const requestRaw = canonicalJson(request);
  const response = await postCanonicalWithReplay(verified.packet.claim_endpoint, requestRaw, {
    Authorization: `Bearer ${resolved.consumerBearer}`, "Idempotency-Key": consumerAttemptId,
  }, resolved, fetchImpl);
  const claim = validateClaimResponse(response, verified, consumerAttemptId, sha256(requestRaw), resolved, clockMilliseconds(clock));
  return Object.freeze({ verified, request: Object.freeze(request), requestRaw, requestSha256: sha256(requestRaw), claim });
}

function createArc1DurableResultReceipt({
  deliveryId, packetSha256, consumerAttemptId, claimToken, ingressStateDigestSha256,
  immutableResultSha256, durableStateReceiptSha256, committedAt,
}, env) {
  const resolved = resolveArc1ConsumerEnvironment(env);
  for (const [value, label] of [[deliveryId, "delivery id"], [packetSha256, "packet sha256"],
    [claimToken, "claim token"], [ingressStateDigestSha256, "ingress state digest"],
    [immutableResultSha256, "immutable result digest"], [durableStateReceiptSha256, "durable state receipt digest"]]) {
    requireSha(value, label);
  }
  if (!ATTEMPT_PATTERN.test(consumerAttemptId)) throw new TypeError("ARC1_CONSUMER_INVALID: consumer attempt id");
  requireIso(committedAt, "durable result committed_at");
  const receipt = {
    schema: ARC1_CONSUMER_DURABLE_RESULT_SCHEMA, status: "DURABLY_COMMITTED", delivery_id: deliveryId,
    packet_sha256: packetSha256, consumer_attempt_id: consumerAttemptId, claim_token_sha256: sha256(claimToken),
    ingress_state_digest_sha256: ingressStateDigestSha256, immutable_result_sha256: immutableResultSha256,
    durable_state_receipt_sha256: durableStateReceiptSha256, committed_at: committedAt,
  };
  if (!exactKeys(receipt, DURABLE_RESULT_FIELDS)) throw new Error("ARC1_CONSUMER_INVALID: internal durable result contract");
  const raw = canonicalJson(receipt);
  return Object.freeze({ receipt: Object.freeze(receipt), raw, sha256: sha256(raw), hmacSha256: hmac(resolved.durableResultSecret,
    `arc-intake-arc1-consumer-durable-result-v1\n${raw}`) });
}

function verifyDurableResult(durableResult, claimBundle, resolved, nowMs) {
  if (!isPlainObject(durableResult) || typeof durableResult.raw !== "string" || typeof durableResult.hmacSha256 !== "string") {
    throw new TypeError("ARC1_CONSUMER_DURABILITY_REQUIRED");
  }
  const receipt = parseCanonicalObject(durableResult.raw, 16_384, "durable result receipt");
  if (!exactKeys(receipt, DURABLE_RESULT_FIELDS) || receipt.schema !== ARC1_CONSUMER_DURABLE_RESULT_SCHEMA ||
      receipt.status !== "DURABLY_COMMITTED" || receipt.delivery_id !== claimBundle.verified.packet.bridge_delivery_id ||
      receipt.packet_sha256 !== claimBundle.verified.packetSha256 ||
      receipt.consumer_attempt_id !== claimBundle.claim.consumer_attempt_id ||
      receipt.claim_token_sha256 !== claimBundle.claim.claimTokenSha256 ||
      receipt.ingress_state_digest_sha256 !== claimBundle.verified.packet.ingress_state_digest_sha256 ||
      !SHA256_PATTERN.test(receipt.immutable_result_sha256) || !SHA256_PATTERN.test(receipt.durable_state_receipt_sha256)) {
    throw new TypeError("ARC1_CONSUMER_DURABILITY_REQUIRED");
  }
  const expected = hmac(resolved.durableResultSecret, `arc-intake-arc1-consumer-durable-result-v1\n${durableResult.raw}`);
  if (!safeEqualHex(durableResult.hmacSha256, expected)) throw new TypeError("ARC1_CONSUMER_DURABILITY_REQUIRED");
  const committed = requireIso(receipt.committed_at, "durable result committed_at");
  const claimedMs = Date.parse(claimBundle.claim.claimed_at);
  const claimExpiresMs = Date.parse(claimBundle.claim.claim_expires_at);
  if (committed.milliseconds < claimedMs || committed.milliseconds >= claimExpiresMs ||
      committed.milliseconds > nowMs + ARC1_CONSUMER_MAX_CLOCK_SKEW_MS || nowMs >= claimExpiresMs) {
    throw new TypeError("ARC1_CONSUMER_DURABILITY_REQUIRED: stale claim");
  }
  return Object.freeze({ receipt: Object.freeze(receipt), raw: durableResult.raw, resultSha256: sha256(durableResult.raw) });
}

async function completeArc1ConsumerPacket(claimBundle, durableResult, env, {
  clock = Date.now, fetch: fetchImpl = globalThis.fetch,
} = {}) {
  const resolved = resolveArc1ConsumerEnvironment(env, { requireClaim: true, requireCompletion: true });
  if (typeof fetchImpl !== "function" || !isPlainObject(claimBundle) || !isPlainObject(claimBundle.claim) ||
      !isPlainObject(claimBundle.verified)) throw new TypeError("ARC1_CONSUMER_INVALID: completion inputs");
  const verifiedAgain = verifyArc1ConsumerPacket(claimBundle.verified.packetRaw, env, { clock, allowExpired: true });
  if (verifiedAgain.packetSha256 !== claimBundle.verified.packetSha256) throw new TypeError("ARC1_CONSUMER_INVALID: packet replay binding");
  const nowMs = clockMilliseconds(clock);
  const result = verifyDurableResult(durableResult, claimBundle, resolved, nowMs);
  const request = {
    schema: ARC1_CONSUMER_COMPLETION_REQUEST_SCHEMA, delivery_id: verifiedAgain.packet.bridge_delivery_id,
    packet_sha256: verifiedAgain.packetSha256, consumer_attempt_id: claimBundle.claim.consumer_attempt_id,
    claim_token: claimBundle.claim.claimToken, completed_at: result.receipt.committed_at, result_sha256: result.resultSha256,
  };
  if (!exactKeys(request, COMPLETION_REQUEST_FIELDS)) throw new Error("ARC1_CONSUMER_INVALID: internal completion request contract");
  const requestRaw = canonicalJson(request);
  const requestSha256 = sha256(requestRaw);
  const response = await postCanonicalWithReplay(verifiedAgain.packet.completion_endpoint, requestRaw, {
    Authorization: `Bearer ${resolved.consumerBearer}`,
    "Idempotency-Key": `arc1complete_${result.resultSha256.slice(0, 40)}`,
    "X-ARC-Completion-HMAC-SHA256": hmac(resolved.receiptSecret,
      `arc-intake-arc1-consumer-completion-v1\n${requestRaw}`),
  }, resolved, fetchImpl);
  if (!exactKeys(response, COMPLETION_FIELDS) || response.schema !== ARC1_CONSUMER_COMPLETION_SCHEMA ||
      response.status !== "COMPLETED" || response.delivery_id !== request.delivery_id ||
      response.packet_sha256 !== request.packet_sha256 || response.consumer_attempt_id !== request.consumer_attempt_id ||
      response.completed_at !== request.completed_at || response.result_sha256 !== request.result_sha256 ||
      response.completion_receipt_sha256 !== requestSha256 || typeof response.idempotent_replay !== "boolean") {
    throw new Error("ARC1_CONSUMER_RESPONSE_INVALID: completion contract");
  }
  return Object.freeze({
    status: "ARC1_CONSUMER_COMPLETED", terminalCleanupAllowed: true, response: Object.freeze(response),
    completionRequestSha256: requestSha256, durableResultSha256: result.resultSha256,
  });
}

async function runArc1ConsumerJob(packetRaw, stableAttemptId, env, execute, adapters = {}) {
  if (typeof execute !== "function") throw new TypeError("ARC1_CONSUMER_INVALID: execute callback");
  // A worker must never claim and mutate when it cannot also produce the only
  // receipt that lets the first-party adapter retain/release recovery state.
  resolveArc1ConsumerEnvironment(env, { requireClaim: true, requireCompletion: true });
  const clock = adapters.clock || Date.now;
  const claimBundle = await claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, { clock, fetch: adapters.fetch });
  const expiresMs = Date.parse(claimBundle.claim.claim_expires_at);
  const remainingMs = expiresMs - clockMilliseconds(clock);
  if (remainingMs <= 0) throw new Error("ARC1_CONSUMER_CLAIM_EXPIRED");
  const controller = new AbortController();
  let timer;
  const assertActive = () => {
    if (controller.signal.aborted || clockMilliseconds(clock) >= expiresMs) throw new Error("ARC1_CONSUMER_CLAIM_EXPIRED");
    return true;
  };
  try {
    const execution = Promise.resolve().then(() => execute(Object.freeze({
      packet: claimBundle.verified.packet, packetSha256: claimBundle.verified.packetSha256,
      consumerAttemptId: claimBundle.claim.consumer_attempt_id, mutationFence: claimBundle.claim.fence,
      mutationFenceJson: claimBundle.claim.fenceRaw, mutationFenceHmacSha256: claimBundle.claim.fenceHmacSha256,
      mutationIdempotencyKey: claimBundle.claim.mutationIdempotencyKey, signal: controller.signal, assertActive,
      createDurableResultReceipt: ({ immutableResultSha256, durableStateReceiptSha256, committedAt }) => {
        assertActive();
        return createArc1DurableResultReceipt({
          deliveryId: claimBundle.verified.packet.bridge_delivery_id,
          packetSha256: claimBundle.verified.packetSha256,
          consumerAttemptId: claimBundle.claim.consumer_attempt_id,
          claimToken: claimBundle.claim.claimToken,
          ingressStateDigestSha256: claimBundle.verified.packet.ingress_state_digest_sha256,
          immutableResultSha256, durableStateReceiptSha256, committedAt,
        }, env);
      },
    })));
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("ARC1_CONSUMER_CLAIM_EXPIRED")); }, remainingMs);
    });
    const durableResult = await Promise.race([execution, expired]);
    assertActive();
    return completeArc1ConsumerPacket(claimBundle, durableResult, env, { clock, fetch: adapters.fetch });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
return Object.freeze({ arc1ConsumerHmacHex, arc1ConsumerSafeEqualHex, arc1ConsumerSha256Hex, canonicalJson, claimArc1ConsumerPacket, completeArc1ConsumerPacket, createArc1DurableResultReceipt, resolveArc1ConsumerEnvironment, verifyArc1ConsumerPacket, verifyArc1MutationFence });
})();
const { arc1ConsumerHmacHex, arc1ConsumerSafeEqualHex, arc1ConsumerSha256Hex, canonicalJson, claimArc1ConsumerPacket, completeArc1ConsumerPacket, createArc1DurableResultReceipt, resolveArc1ConsumerEnvironment, verifyArc1ConsumerPacket, verifyArc1MutationFence } = arc1ConsumerCore;

const ARC1_CONSUMER_RUNTIME_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED";
const ARC1_CONSUMER_PRIVATE_STATE_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED";
const ARC1_CONSUMER_PROVIDER_WORK_ENABLED_ENV = "ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED";
const ARC1_CONSUMER_HISTORY_REDACTION_ATTESTED_ENV = "ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED";
const ARC1_CONSUMER_INPUTDATA_SECRET_COMPATIBILITY_ENV = "ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED";
const ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_ENV = "ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS";

const ARC1_CONSUMER_PRIVATE_STATE_SCHEMA = "arc-intake-arc1-consumer-private-state-v1";
const ARC1_CONSUMER_STATE_CREATE_RECEIPT_SCHEMA = "arc-intake-arc1-consumer-state-create-receipt-v1";
const ARC1_CONSUMER_STATE_COMMIT_RECEIPT_SCHEMA = "arc-intake-arc1-consumer-state-commit-receipt-v1";
const ARC1_CONSUMER_CODE_STEP_SCHEMA = "arc-intake-arc1-consumer-code-step-v1";

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

function createArc1ConsumerStateCreateReceipt({
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

function createArc1ConsumerStateCommitReceipt({
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

async function prepareArc1ConsumerClaim(packetRaw, stableAttemptId, env, { clock = Date.now, fetch = globalThis.fetch } = {}) {
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

function authorizeArc1ConsumerMutation(packetRaw, stateRaw, stateHmacSha256, createReceiptBundle, env,
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

async function completeArc1ConsumerFromPrivateState({
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

async function runArc1PrivateStateConsumerJob(packetRaw, stableAttemptId, env, {
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

async function runArc1ConsumerCodeStep(input, {
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

if (typeof inputData === "undefined") throw new Error("ARC1_RUNTIME_INVALID: inputData unavailable");
const arc1CodeStepFetch = typeof fetch === "function" ? fetch : globalThis.fetch;
const arc1CodeStepRuntimeEnv = typeof process === "object" && process && process.env ? process.env : undefined;
return await runArc1ConsumerCodeStep(inputData, { fetch: arc1CodeStepFetch, runtimeEnv: arc1CodeStepRuntimeEnv });
