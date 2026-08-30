'use strict';

const { blockedActionError } = require('./redaction');

async function runReviewRevisionAdapter() {
  throw blockedActionError();
}

async function runPaymentStartAdapter() {
  throw blockedActionError();
}

module.exports = Object.freeze({
  runPaymentStartAdapter,
  runReviewRevisionAdapter
});
