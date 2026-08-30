'use strict';

const BLOCKED_STATE = 'BLOCKED_UNVERIFIED';
const PLATFORM_VERSION = '19.1.0';
const APP_VERSION = '0.0.2';
const TARGET_ENVIRONMENT = 'sandbox';
const ORIGINS = Object.freeze({
  sandbox: 'https://arc2-sandbox.netlify.app',
  production: 'https://arcweb.onl'
});
const TARGET_ORIGIN = ORIGINS[TARGET_ENVIRONMENT];
const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_MAX_BYTES = 4_096;
const SECRET_MIN_LENGTH = 32;
const SECRET_MAX_LENGTH = 256;
const REVIEW_REVISION_ENABLED_ENV = 'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED';
const PAYMENT_ARC2_ENABLED_ENV = 'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED';

const ACTIONS = Object.freeze([
  Object.freeze({
    canonicalWorkflowId: 'arc1-review-revision',
    zapierActionKey: 'arc1_review_revision',
    noun: 'ARC Review Revision',
    label: 'ARC V11 Review Revision — OFF',
    description: 'Default-OFF dispatch to the pinned first-party review-revision run-one worker.',
    path: '/api/internal/review-revision/run-one',
    secretEnvironmentName: 'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET'
  }),
  Object.freeze({
    canonicalWorkflowId: 'arc2-payment-start',
    zapierActionKey: 'arc2_payment_start',
    noun: 'ARC Payment Start',
    label: 'ARC V11 Payment Start — OFF',
    description: 'Default-OFF dispatch to the pinned first-party payment run-one worker.',
    path: '/internal/payment-arc2/run-one',
    secretEnvironmentName: 'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET'
  })
]);

const FIRST_PARTY_ONLY_WORKFLOWS = Object.freeze([
  'arc1-review-email',
  'review-checkout-revocation'
]);

const BLOCKED_SAMPLE = Object.freeze({
  id: 'arc-private-dispatch-off',
  state: 'OFF',
  dispatched: false,
  retry_required: false,
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
  Object.freeze({ key: 'id', label: 'Redacted Dispatch ID' }),
  Object.freeze({ key: 'state', label: 'State' }),
  Object.freeze({ key: 'dispatched', label: 'Dispatched', type: 'boolean' }),
  Object.freeze({ key: 'retry_required', label: 'Retry Required', type: 'boolean' }),
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
  ORIGINS,
  OUTPUT_FIELDS,
  PLATFORM_VERSION,
  PAYMENT_ARC2_ENABLED_ENV,
  REQUEST_TIMEOUT_MS,
  REVIEW_REVISION_ENABLED_ENV,
  RESPONSE_MAX_BYTES,
  SECRET_MAX_LENGTH,
  SECRET_MIN_LENGTH,
  TARGET_ENVIRONMENT,
  TARGET_ORIGIN
});
