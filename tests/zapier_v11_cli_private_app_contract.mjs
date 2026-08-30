import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import {
  buildZapierPrivateAppSourceReceipt,
  ZAPIER_PRIVATE_APP_SOURCE_ALLOWLIST
} from '../scripts/package_zapier_v11_cli_private_app.mjs';

const require = createRequire(import.meta.url);
const app = require('../zapier/private-integration/cli-app');
const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
const BLOCKED_STATE = 'BLOCKED_UNVERIFIED';

assert.equal(process.versions.node.split('.')[0], '22',
  `Node 22 runtime required; received ${process.versions.node}`);

const receipt = await buildZapierPrivateAppSourceReceipt();
assert.equal(receipt.state, BLOCKED_STATE);
assert.equal(receipt.provider_state, BLOCKED_STATE);
assert.equal(receipt.artifact_state, BLOCKED_STATE);
assert.equal(receipt.archive_state, BLOCKED_STATE);
assert.equal(receipt.validation_state, BLOCKED_STATE);
assert.equal(receipt.readback_state, BLOCKED_STATE);
assert.equal(receipt.source_archive_created, false);
assert.equal(receipt.provider_build_performed, false);
assert.equal(receipt.provider_validation_performed, false);
assert.equal(receipt.provider_readback_performed, false);
assert.equal(receipt.provider_mutation_allowed, false);
assert.deepEqual(receipt.source_receipts.map(({ path }) => path), [...ZAPIER_PRIVATE_APP_SOURCE_ALLOWLIST].sort());
assert.match(receipt.source_inventory_sha256, /^[a-f0-9]{64}$/);

assert.equal(Object.hasOwn(app, 'authentication'), false);
assert.deepEqual(Object.keys(app.triggers), []);
assert.deepEqual(Object.keys(app.searches), []);
assert.deepEqual(Object.keys(app.creates), ['arc1_review_revision', 'arc2_payment_start']);
const [config, appManifest] = await Promise.all([
  '../zapier/private-integration/cli-app/config-schema.json',
  '../zapier/private-integration/cli-app/paused-app-manifest.json'
].map(readJson));
assert.deepEqual(config.authentication_fields, []);
assert.deepEqual(config.activation_fields.map(({ name }) => name), [
  'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED',
  'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED',
]);
assert.ok(config.activation_fields.every(({ required_value, default_value, configured_value }) =>
  required_value === 'true' && default_value === 'false' && configured_value === 'false'));
assert.deepEqual(config.environment_fields.map(({ name }) => name), [
  'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET',
  'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET',
]);
assert.deepEqual(config.input_fields, []);
assert.deepEqual(appManifest.actions.map(({ canonical_workflow_id }) => canonical_workflow_id),
  ['arc1-review-revision', 'arc2-payment-start']);
assert.deepEqual(appManifest.actions.map(({ zapier_action_key }) => zapier_action_key),
  Object.keys(app.creates));
for (const [actionKey, action] of Object.entries(app.creates)) {
  assert.equal(action.key, actionKey);
  assert.deepEqual(action.operation.inputFields, []);
  assert.equal(action.operation.cleanInputData, false);
  assert.equal(action.operation.perform.length, 1);
  await assert.rejects(action.operation.perform({}, { inputData: { secret: 'must-not-leak' } }),
    (error) => error.message === 'ARC_PRIVATE_ACTION_OFF' &&
      !error.message.includes('must-not-leak'));
}
assert.deepEqual(appManifest.actions.map(({ input_fields }) => input_fields),
  Object.values(app.creates).map(({ operation }) => operation.inputFields));
assert.deepEqual(appManifest.actions.map(({ clean_input_data }) => clean_input_data),
  Object.values(app.creates).map(({ operation }) => operation.cleanInputData));
const secretBinding = await readJson('../zapier/private-integration/cli-app/secret-binding-contract.json');
assert.equal(secretBinding.secret_values_present, false);
assert.deepEqual(secretBinding.bindings.map(({ zapier_secret_environment_name,
  site_bearer_environment_name }) => [zapier_secret_environment_name, site_bearer_environment_name]), [
  ['ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET',
    'ARC_REVIEW_REVISION_RUN_ONE_INTERNAL_AUTH_SECRET'],
  ['ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET', 'ARC_PAYMENT_ARC2_RUN_ONE_SECRET'],
]);

const [index, revision, payment, email, revocation, wiring] = await Promise.all([
  '../zapier/drafts/index.json',
  '../zapier/drafts/arc1-review-revision.json',
  '../zapier/drafts/arc2-payment-start.json',
  '../zapier/drafts/arc1-review-email.json',
  '../zapier/drafts/review-checkout-revocation.json',
  '../zapier/wiring-contract.json'
].map(readJson));

const scaffold = index.private_integration_scaffold;
for (const key of [
  'provider_state', 'artifact_state', 'archive_state', 'validation_state', 'readback_state'
]) assert.equal(scaffold[key], BLOCKED_STATE);
assert.deepEqual(scaffold.action_workflows, ['arc1-review-revision', 'arc2-payment-start']);
assert.deepEqual(scaffold.first_party_only_workflows, ['arc1-review-email', 'review-checkout-revocation']);
for (const key of [
  'provider_installation_performed', 'provider_mutation_allowed', 'provider_actions_allowed',
  'activation_allowed', 'publish_allowed', 'promotion_allowed', 'published', 'enabled'
]) assert.equal(scaffold[key], false);

for (const [document, canonicalId, actionKey] of [
  [revision, 'arc1-review-revision', 'arc1_review_revision'],
  [payment, 'arc2-payment-start', 'arc2_payment_start']
]) {
  const binding = document.private_integration_action;
  assert.equal(binding.canonical_action_id, canonicalId);
  assert.equal(binding.zapier_action_key, actionKey);
  assert.equal(binding.zero_input_fields, true);
  assert.equal(binding.clean_input_data, false);
  for (const key of [
    'provider_state', 'artifact_state', 'archive_state', 'validation_state', 'readback_state'
  ]) assert.equal(binding[key], BLOCKED_STATE);
  for (const key of [
    'authentication_configured', 'network_allowed', 'environment_reads_allowed',
    'provider_installation_performed', 'provider_mutation_allowed', 'provider_actions_allowed',
    'activation_allowed', 'publish_allowed', 'promotion_allowed'
  ]) assert.equal(binding[key], false);
}

assert.equal(payment.retry_contract.binding_evidence_exact_canonical_bytes_replay_required, true);
assert.equal(payment.retry_contract.binding_signature_exact_replay_required, true);
assert.equal(payment.retry_contract.binding_retry_may_regenerate_issued_at, false);
assert.equal(payment.retry_contract.binding_retry_may_resign, false);
assert.equal(payment.retry_contract
  .authoritative_stripe_session_to_payment_intent_validation_required_before_signing, true);

for (const [document, canonicalId] of [
  [email, 'arc1-review-email'],
  [revocation, 'review-checkout-revocation']
]) {
  const exclusion = document.private_integration_exclusion;
  assert.equal(exclusion.canonical_workflow_id, canonicalId);
  assert.equal(exclusion.first_party_only, true);
  assert.equal(exclusion.zapier_action_created, false);
  assert.equal(Object.values(app.creates).some(({ noun }) => noun.includes(canonicalId)), false);
}

const wiringPrivateApp = wiring.paused_draft_blueprints;
for (const key of [
  'provider_state', 'artifact_state', 'archive_state', 'validation_state', 'readback_state'
]) assert.equal(wiringPrivateApp[key], BLOCKED_STATE);
assert.deepEqual(wiringPrivateApp.private_app_action_workflows,
  ['arc1-review-revision', 'arc2-payment-start']);
assert.deepEqual(wiringPrivateApp.private_app_first_party_only_workflows,
  ['arc1-review-email', 'review-checkout-revocation']);
for (const key of [
  'private_app_provider_mutation_allowed', 'private_app_provider_actions_allowed',
  'private_app_publish_allowed', 'private_app_promotion_allowed'
]) assert.equal(wiringPrivateApp[key], false);

console.log('ARC V11 Zapier private app source remains BLOCKED_UNVERIFIED with exactly two default-OFF first-party run-one actions.');
