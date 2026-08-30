'use strict';

const ACTION_OFF_MESSAGE = 'ARC_PRIVATE_ACTION_OFF';
const CONFIGURATION_INVALID_MESSAGE = 'ARC_PRIVATE_CONFIGURATION_INVALID';
const DISPATCH_FAILED_MESSAGE = 'ARC_PRIVATE_DISPATCH_FAILED';
const NETWORK_BLOCKED_MESSAGE = 'ARC_PRIVATE_NETWORK_BLOCKED';

function fixedError(message) {
  const error = new Error(message);
  error.name = 'ARCBlockedError';
  return error;
}

function actionOffError() {
  return fixedError(ACTION_OFF_MESSAGE);
}

function configurationInvalidError() {
  return fixedError(CONFIGURATION_INVALID_MESSAGE);
}

function dispatchFailedError() {
  return fixedError(DISPATCH_FAILED_MESSAGE);
}

function blockedNetworkError() {
  return fixedError(NETWORK_BLOCKED_MESSAGE);
}

module.exports = Object.freeze({
  ACTION_OFF_MESSAGE,
  CONFIGURATION_INVALID_MESSAGE,
  DISPATCH_FAILED_MESSAGE,
  NETWORK_BLOCKED_MESSAGE,
  actionOffError,
  blockedNetworkError,
  configurationInvalidError,
  dispatchFailedError
});
