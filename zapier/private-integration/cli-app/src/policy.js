'use strict';

const BLOCKED_STATE = 'BLOCKED_UNVERIFIED';
const PLATFORM_VERSION = '19.1.0';
const APP_VERSION = '0.0.1';

const ACTIONS = Object.freeze([
  Object.freeze({
    canonicalWorkflowId: 'arc1-review-revision',
    zapierActionKey: 'arc1_review_revision',
    noun: 'ARC Review Revision',
    label: 'ARC V11 Review Revision — BLOCKED',
    description: 'Fail-closed placeholder for the unpublished ARC review-revision worker.'
  }),
  Object.freeze({
    canonicalWorkflowId: 'arc2-payment-start',
    zapierActionKey: 'arc2_payment_start',
    noun: 'ARC Payment Start',
    label: 'ARC V11 Payment Start — BLOCKED',
    description: 'Fail-closed placeholder for the unpublished ARC payment-start worker.'
  })
]);

const FIRST_PARTY_ONLY_WORKFLOWS = Object.freeze([
  'arc1-review-email',
  'review-checkout-revocation'
]);

const BLOCKED_SAMPLE = Object.freeze({
  state: BLOCKED_STATE,
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

const OUTPUT_FIELDS = Object.freeze([
  Object.freeze({ key: 'state', label: 'State' }),
  Object.freeze({ key: 'provider_state', label: 'Provider State' }),
  Object.freeze({ key: 'artifact_state', label: 'Artifact State' }),
  Object.freeze({ key: 'archive_state', label: 'Archive State' }),
  Object.freeze({ key: 'validation_state', label: 'Validation State' }),
  Object.freeze({ key: 'readback_state', label: 'Readback State' }),
  Object.freeze({ key: 'provider_mutation_allowed', label: 'Provider Mutation Allowed', type: 'boolean' }),
  Object.freeze({ key: 'activation_allowed', label: 'Activation Allowed', type: 'boolean' }),
  Object.freeze({ key: 'publish_allowed', label: 'Publish Allowed', type: 'boolean' }),
  Object.freeze({ key: 'promotion_allowed', label: 'Promotion Allowed', type: 'boolean' }),
  Object.freeze({ key: 'published', label: 'Published', type: 'boolean' }),
  Object.freeze({ key: 'enabled', label: 'Enabled', type: 'boolean' })
]);

module.exports = Object.freeze({
  ACTIONS,
  APP_VERSION,
  BLOCKED_SAMPLE,
  BLOCKED_STATE,
  FIRST_PARTY_ONLY_WORKFLOWS,
  OUTPUT_FIELDS,
  PLATFORM_VERSION
});
