'use strict';

const ACTION_BLOCKED_MESSAGE = 'ARC_PRIVATE_ACTION_BLOCKED_UNVERIFIED';
const NETWORK_BLOCKED_MESSAGE = 'ARC_PRIVATE_NETWORK_DISABLED';

function fixedError(message) {
  const error = new Error(message);
  error.name = 'ARCBlockedError';
  return error;
}

function blockedActionError() {
  return fixedError(ACTION_BLOCKED_MESSAGE);
}

function blockedNetworkError() {
  return fixedError(NETWORK_BLOCKED_MESSAGE);
}

module.exports = Object.freeze({
  ACTION_BLOCKED_MESSAGE,
  NETWORK_BLOCKED_MESSAGE,
  blockedActionError,
  blockedNetworkError
});
