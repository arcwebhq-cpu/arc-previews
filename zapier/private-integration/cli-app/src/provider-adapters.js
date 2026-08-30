'use strict';

const {
  ACTIONS,
  BLOCKED_STATE,
  REQUEST_TIMEOUT_MS,
  RESPONSE_MAX_BYTES,
  SECRET_MAX_LENGTH,
  SECRET_MIN_LENGTH,
  TARGET_ORIGIN
} = require('./policy');
const {
  actionOffError,
  configurationInvalidError,
  dispatchFailedError
} = require('./redaction');

const ACTION_BY_KEY = new Map(ACTIONS.map((action) => [action.zapierActionKey, action]));
const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const SECRET = new RegExp(`^[A-Za-z0-9_-]{${SECRET_MIN_LENGTH},${SECRET_MAX_LENGTH}}$`);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function readReviewRevisionSecret() {
  return process.env.ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET;
}

function reviewRevisionEnabled() {
  return process.env.ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED === 'true';
}

function paymentArc2Enabled() {
  return process.env.ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED === 'true';
}

function readPaymentArc2Secret() {
  return process.env.ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET;
}

function requiredSecret(value) {
  if (value === undefined || value === '') throw actionOffError();
  if (typeof value !== 'string' || !SECRET.test(value)) throw configurationInvalidError();
  return value;
}

function requestFor(action, secret) {
  return Object.freeze({
    url: `${TARGET_ORIGIN}${action.path}`,
    method: 'POST',
    headers: Object.freeze({
      Accept: 'application/json',
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json'
    }),
    body: '{}',
    timeout: REQUEST_TIMEOUT_MS,
    size: RESPONSE_MAX_BYTES,
    redirect: 'error',
    follow: 0,
    compress: false,
    skipThrowForStatus: true
  });
}

function responseContentType(response) {
  const headers = response?.headers;
  if (headers && typeof headers.get === 'function') return headers.get('content-type');
  if (response && typeof response.getHeader === 'function') return response.getHeader('content-type');
  return null;
}

function parsedResponse(response, expectedUrl) {
  if (!response || typeof response !== 'object' || response.url !== expectedUrl ||
      response.redirected !== false || typeof response.content !== 'string' ||
      Buffer.byteLength(response.content, 'utf8') > RESPONSE_MAX_BYTES ||
      !/^application\/json(?:; charset=utf-8)?$/i.test(responseContentType(response) || '')) {
    throw dispatchFailedError();
  }
  try {
    const value = JSON.parse(response.content);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) throw dispatchFailedError();
    return value;
  } catch (error) {
    if (error?.name === 'ARCBlockedError') throw error;
    throw dispatchFailedError();
  }
}

function revisionState(response, expectedUrl) {
  if (response.status !== 200) throw dispatchFailedError();
  const value = parsedResponse(response, expectedUrl);
  const fields = [
    'empty', 'idempotent_replay', 'next_cursor', 'processed', 'schema', 'state',
    'successor_commit_sha', 'successor_manifest_sha256', 'work_hmac_sha256'
  ];
  if (!exactKeys(value, fields) || value.schema !== 'arc-review-revision-run-one-result-v1' ||
      !new Set(['EMPTY', 'LEASE_ACTIVE', 'COMPLETED']).has(value.state) ||
      !Number.isInteger(value.processed) || value.processed < 0 || value.processed > 1 ||
      typeof value.empty !== 'boolean' || typeof value.idempotent_replay !== 'boolean' ||
      !(value.next_cursor === null || HEX_64.test(value.next_cursor)) ||
      !(value.work_hmac_sha256 === null || HEX_64.test(value.work_hmac_sha256)) ||
      !(value.successor_commit_sha === null || HEX_40.test(value.successor_commit_sha)) ||
      !(value.successor_manifest_sha256 === null || HEX_64.test(value.successor_manifest_sha256)) ||
      (value.state === 'EMPTY' && (value.empty !== true || value.processed !== 0 ||
        value.idempotent_replay !== false || value.work_hmac_sha256 !== null ||
        value.successor_commit_sha !== null || value.successor_manifest_sha256 !== null)) ||
      (value.state === 'LEASE_ACTIVE' && (value.empty !== false || value.idempotent_replay !== true ||
        value.processed !== 0 || !HEX_64.test(value.work_hmac_sha256) ||
        value.successor_commit_sha !== null || value.successor_manifest_sha256 !== null)) ||
      (value.state === 'COMPLETED' && (value.empty !== false || value.processed !== 1 ||
        !HEX_64.test(value.work_hmac_sha256) || !HEX_40.test(value.successor_commit_sha) ||
        !HEX_64.test(value.successor_manifest_sha256)))) throw dispatchFailedError();
  return value.state;
}

function paymentState(response, expectedUrl) {
  if (![200, 202, 409].includes(response.status)) throw dispatchFailedError();
  const value = parsedResponse(response, expectedUrl);
  if (value.schema !== 'arc-payment-arc2-run-one-result-v1') throw dispatchFailedError();
  const expected = new Map([
    [200, new Set(['IDLE', 'COMPLETED'])],
    [202, new Set(['RETRY_REQUIRED'])],
    [409, new Set(['REVIEW_REQUIRED'])]
  ]);
  if (!expected.get(response.status).has(value.state)) throw dispatchFailedError();
  const idleFields = ['processed', 'retry_required', 'schema', 'state'];
  const reviewClaimFields = [
    ...idleFields, 'immutable_binding_sha256', 'manual_review_evidence_sha256', 'outbox_key_sha256'
  ];
  const reviewHaltFields = [
    ...idleFields, 'artifact_evidence_sha256', 'handoff_id_sha256', 'immutable_binding_sha256',
    'manual_review_evidence_sha256', 'outbox_key_sha256', 'start_request_sha256'
  ];
  const completionFields = [
    ...idleFields, 'artifact_evidence_sha256', 'completion_receipt_sha256', 'handoff_id_sha256',
    'handoff_state', 'idempotent_replay', 'immutable_binding_sha256', 'outbox_key_sha256',
    'reversal_control_ready', 'start_request_sha256'
  ];
  const shapeValid = value.state === 'IDLE' ? exactKeys(value, idleFields) :
    value.state === 'REVIEW_REQUIRED' ?
      (exactKeys(value, reviewClaimFields) || exactKeys(value, reviewHaltFields)) :
      exactKeys(value, completionFields);
  if (!shapeValid || !Number.isInteger(value.processed) || value.processed < 0 || value.processed > 1 ||
      typeof value.retry_required !== 'boolean' ||
      (value.state === 'IDLE' && (value.processed !== 0 || value.retry_required !== false)) ||
      (value.state === 'REVIEW_REQUIRED' && (value.processed !== 0 || value.retry_required !== false)) ||
      (value.state === 'RETRY_REQUIRED' && (value.processed !== 0 || value.retry_required !== true)) ||
      (value.state === 'COMPLETED' && (value.processed !== 1 || value.retry_required !== false))) {
    throw dispatchFailedError();
  }
  for (const key of [
    'artifact_evidence_sha256', 'completion_receipt_sha256', 'handoff_id_sha256',
    'immutable_binding_sha256', 'manual_review_evidence_sha256', 'outbox_key_sha256',
    'start_request_sha256'
  ]) {
    if (Object.hasOwn(value, key) && !(value[key] === null && key === 'completion_receipt_sha256') &&
        !HEX_64.test(value[key])) throw dispatchFailedError();
  }
  if (Object.hasOwn(value, 'idempotent_replay') && typeof value.idempotent_replay !== 'boolean') {
    throw dispatchFailedError();
  }
  if (Object.hasOwn(value, 'reversal_control_ready') && typeof value.reversal_control_ready !== 'boolean') {
    throw dispatchFailedError();
  }
  if (Object.hasOwn(value, 'handoff_state') && !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.handoff_state)) {
    throw dispatchFailedError();
  }
  if ((value.state === 'COMPLETED' && !HEX_64.test(value.completion_receipt_sha256)) ||
      (value.state === 'RETRY_REQUIRED' && value.completion_receipt_sha256 !== null)) {
    throw dispatchFailedError();
  }
  return value.state;
}

function safeOutput(actionKey, state) {
  return Object.freeze({
    id: actionKey,
    state,
    dispatched: true,
    retry_required: state === 'LEASE_ACTIVE' || state === 'RETRY_REQUIRED',
    provider_state: BLOCKED_STATE,
    artifact_state: BLOCKED_STATE,
    archive_state: BLOCKED_STATE,
    validation_state: BLOCKED_STATE,
    readback_state: BLOCKED_STATE,
    provider_mutation_allowed: false,
    activation_allowed: false,
    publish_allowed: false,
    promotion_allowed: false,
    published: false,
    enabled: false
  });
}

async function dispatch(z, actionKey, enabled, secret, validateResponse) {
  const action = ACTION_BY_KEY.get(actionKey);
  if (enabled !== true) throw actionOffError();
  const bearer = requiredSecret(secret);
  if (!action || !z || typeof z.request !== 'function') throw configurationInvalidError();
  const request = requestFor(action, bearer);
  let response;
  try {
    response = await z.request(request);
  } catch {
    throw dispatchFailedError();
  }
  const state = validateResponse(response, request.url);
  return safeOutput(actionKey, state);
}

async function runReviewRevisionAdapter(z) {
  return dispatch(z, 'arc1_review_revision', reviewRevisionEnabled(),
    readReviewRevisionSecret(), revisionState);
}

async function runPaymentStartAdapter(z) {
  return dispatch(z, 'arc2_payment_start', paymentArc2Enabled(),
    readPaymentArc2Secret(), paymentState);
}

module.exports = Object.freeze({
  readPaymentArc2Secret,
  readReviewRevisionSecret,
  paymentArc2Enabled,
  reviewRevisionEnabled,
  runPaymentStartAdapter,
  runReviewRevisionAdapter,
  safeOutput
});
