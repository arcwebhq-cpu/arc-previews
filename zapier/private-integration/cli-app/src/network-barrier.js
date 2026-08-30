'use strict';

const {
  ACTIONS,
  ORIGINS,
  REQUEST_TIMEOUT_MS,
  RESPONSE_MAX_BYTES,
  TARGET_ORIGIN
} = require('./policy');
const { blockedNetworkError } = require('./redaction');

const ALLOWED_ORIGINS = new Set(Object.values(ORIGINS));
const ALLOWED_PATHS = new Set(ACTIONS.map(({ path }) => path));
const REQUIRED_HEADER_NAMES = new Set(['accept', 'authorization', 'content-type']);
const ALLOWED_HEADER_NAMES = new Set([...REQUIRED_HEADER_NAMES, 'user-agent']);

function normalizedHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw blockedNetworkError();
  const normalized = new Map();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = String(rawName).toLowerCase();
    if (!ALLOWED_HEADER_NAMES.has(name) || normalized.has(name) || typeof rawValue !== 'string') {
      throw blockedNetworkError();
    }
    normalized.set(name, rawValue);
  }
  if ([...REQUIRED_HEADER_NAMES].some((name) => !normalized.has(name)) ||
      normalized.size < REQUIRED_HEADER_NAMES.size || normalized.size > ALLOWED_HEADER_NAMES.size ||
      normalized.has('user-agent') && normalized.get('user-agent') !== 'Zapier') throw blockedNetworkError();
  return normalized;
}

function expectedAuthorization(pathname) {
  const review = pathname === '/api/internal/review-revision/run-one';
  const payment = pathname === '/internal/payment-arc2/run-one';
  const enabled = review
    ? process.env.ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED
    : payment ? process.env.ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED : null;
  if (enabled !== 'true') return null;
  const secret = review
    ? process.env.ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET
    : payment ? process.env.ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET : null;
  return typeof secret === 'string' ? `Bearer ${secret}` : null;
}

function enforceFirstPartyDispatchRequest(request) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw blockedNetworkError();
    const url = new URL(String(request.url || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
        !ALLOWED_ORIGINS.has(url.origin) || url.origin !== TARGET_ORIGIN || !ALLOWED_PATHS.has(url.pathname) ||
        url.toString() !== `${TARGET_ORIGIN}${url.pathname}`) throw blockedNetworkError();
    if (request.method !== 'POST' || request.body !== '{}' || request.timeout !== REQUEST_TIMEOUT_MS ||
        request.size !== RESPONSE_MAX_BYTES || request.redirect !== 'error' || request.follow !== 0 ||
        request.compress !== false || request.skipThrowForStatus !== true ||
        request.auth !== undefined || request.form !== undefined || request.json !== undefined ||
        !(request.params === undefined || request.params && typeof request.params === 'object' &&
          !Array.isArray(request.params) && Object.keys(request.params).length === 0)) throw blockedNetworkError();
    const headers = normalizedHeaders(request.headers);
    if (headers.get('accept') !== 'application/json' || headers.get('content-type') !== 'application/json' ||
        !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(headers.get('authorization')) ||
        headers.get('authorization') !== expectedAuthorization(url.pathname)) throw blockedNetworkError();
    return request;
  } catch (error) {
    if (error?.name === 'ARCBlockedError') throw error;
    throw blockedNetworkError();
  }
}

module.exports = Object.freeze({ enforceFirstPartyDispatchRequest });
