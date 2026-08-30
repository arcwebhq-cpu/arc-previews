'use strict';

const { blockedNetworkError } = require('./redaction');

function denyAllNetworkRequests() {
  throw blockedNetworkError();
}

module.exports = Object.freeze({ denyAllNetworkRequests });
