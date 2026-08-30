'use strict';

const reviewRevision = require('./actions/review-revision');
const paymentStart = require('./actions/payment-start');
const { enforceFirstPartyDispatchRequest } = require('./network-barrier');
const { APP_VERSION, PLATFORM_VERSION } = require('./policy');

module.exports = Object.freeze({
  version: APP_VERSION,
  platformVersion: PLATFORM_VERSION,
  beforeRequest: Object.freeze([enforceFirstPartyDispatchRequest]),
  afterResponse: Object.freeze([]),
  triggers: Object.freeze({}),
  searches: Object.freeze({}),
  creates: Object.freeze({
    arc1_review_revision: reviewRevision,
    arc2_payment_start: paymentStart
  })
});
