'use strict';

const { createDispatchAction } = require('./action-factory');
const { runReviewRevisionAdapter } = require('../provider-adapters');

module.exports = createDispatchAction({
  key: 'arc1_review_revision',
  noun: 'ARC Review Revision',
  label: 'ARC V11 Review Revision — OFF',
  description: 'Default-OFF dispatch to the pinned first-party review-revision run-one worker.',
  perform: runReviewRevisionAdapter
});
