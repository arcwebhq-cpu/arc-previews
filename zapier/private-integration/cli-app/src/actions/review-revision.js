'use strict';

const { createBlockedAction } = require('./action-factory');
const { runReviewRevisionAdapter } = require('../provider-adapters');

module.exports = createBlockedAction({
  key: 'arc1_review_revision',
  noun: 'ARC Review Revision',
  label: 'ARC V11 Review Revision — BLOCKED',
  description: 'Fail-closed placeholder for the unpublished ARC review-revision worker.',
  perform: runReviewRevisionAdapter
});
