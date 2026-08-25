import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ARC1_CONSUMER_PACKET_SCHEMA = "arc-intake-arc1-downstream-dispatch-v2";
export const ARC1_CONSUMER_CLAIM_REQUEST_SCHEMA = "arc-intake-arc1-consumer-claim-request-v1";
export const ARC1_CONSUMER_CLAIM_SCHEMA = "arc-intake-arc1-consumer-claim-v1";
export const ARC1_CONSUMER_COMPLETION_REQUEST_SCHEMA = "arc-intake-arc1-consumer-completion-request-v1";
export const ARC1_CONSUMER_COMPLETION_SCHEMA = "arc-intake-arc1-consumer-completion-v1";
export const ARC1_CONSUMER_FENCE_SCHEMA = "arc-intake-arc1-consumer-mutation-fence-v1";
export const ARC1_CONSUMER_DURABLE_RESULT_SCHEMA = "arc-intake-arc1-consumer-durable-result-v1";

export const ARC1_CONSUMER_CLAIM_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED";
export const ARC1_CONSUMER_COMPLETION_ENABLED_ENV = "ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED";
export const ARC1_CONSUMER_PACKET_SECRET_ENV = "ARC_INTAKE_ARC1_PACKET_SECRET";
export const ARC1_CONSUMER_BEARER_ENV = "ARC_INTAKE_ARC1_CONSUMER_BEARER";
export const ARC1_CONSUMER_RECEIPT_SECRET_ENV = "ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET";
export const ARC1_CONSUMER_DURABLE_RESULT_SECRET_ENV = "ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET";
export const ARC1_CONSUMER_TIMEOUT_ENV = "ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS";

export const ARC1_CONSUMER_CLAIM_ENDPOINT = "https://arcweb.onl/internal/intake/arc1/adapter/claim";
export const ARC1_CONSUMER_COMPLETION_ENDPOINT = "https://arcweb.onl/internal/intake/arc1/adapter/complete";
export const ARC1_CONSUMER_MAX_PACKET_BYTES = 1_000_000;
export const ARC1_CONSUMER_MAX_RESPONSE_BYTES = 16_384;
// The first-party packet never outlives its signed bridge evidence (24 hours).
// A separate 15-minute site-side AWAITING_CLAIM deadline starts only after the
// downstream hook accepts the packet.
export const ARC1_CONSUMER_MAX_PACKET_LIFETIME_MS = 24 * 60 * 60_000;
export const ARC1_CONSUMER_MAX_CLAIM_LIFETIME_MS = 30 * 60_000;
export const ARC1_CONSUMER_MAX_CLOCK_SKEW_MS = 5 * 60_000;

const BRIDGE_CONTRACT_SHA256 = "e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841";
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

export function canonicalJson(value) {
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

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");
const safeEqualHex = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string" || !SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
};
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

export function resolveArc1ConsumerEnvironment(env, { requireClaim = false, requireCompletion = false } = {}) {
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

export function verifyArc1ConsumerPacket(packetRaw, env, { clock = Date.now, allowExpired = false } = {}) {
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

export function verifyArc1MutationFence(fenceRaw, fenceHmacSha256, expected, env, { clock = Date.now } = {}) {
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

async function readBoundedResponse(response, controller, deadlineMs, maximumBytes) {
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
      const body = await readBoundedResponse(response, controller, requestDeadline, ARC1_CONSUMER_MAX_RESPONSE_BYTES);
      if (response.status === 200) return body.parsed;
      if (response.status === 409) throw new Error("ARC1_CONSUMER_CONFLICT");
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`ARC1_CONSUMER_RESPONSE_INVALID: HTTP ${response.status}`);
      }
      if (response.status === 425) retryBackoffMs = 50;
      lastError = new Error(`ARC1_CONSUMER_RETRYABLE: HTTP ${response.status}`);
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
  const responseRaw = canonicalJson(response);
  const fence = {
    schema: ARC1_CONSUMER_FENCE_SCHEMA, delivery_id: response.delivery_id, packet_sha256: response.packet_sha256,
    consumer_attempt_id: consumerAttemptId, claim_token_sha256: sha256(response.claim_token), claimed_at: response.claimed_at,
    claim_expires_at: response.claim_expires_at, ingress_state_digest_sha256: verified.packet.ingress_state_digest_sha256,
    claim_request_sha256: requestSha256, claim_response_sha256: sha256(responseRaw),
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

export async function claimArc1ConsumerPacket(packetRaw, stableAttemptId, env, {
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

export function createArc1DurableResultReceipt({
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

export async function completeArc1ConsumerPacket(claimBundle, durableResult, env, {
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

export async function runArc1ConsumerJob(packetRaw, stableAttemptId, env, execute, adapters = {}) {
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
