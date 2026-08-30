'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const app = require('..');
const {
  BLOCKED_STATE,
  FIRST_PARTY_ONLY_WORKFLOWS,
  PLATFORM_VERSION
} = require('../src/policy');
const { assertNode22Runtime, validateOfflineSource } = require('../scripts/validate-offline');

const APP_ROOT = path.resolve(__dirname, '..');
const json = async (name) => JSON.parse(await readFile(path.join(APP_ROOT, name), 'utf8'));

test('contract suite executes only on Node 22', () => {
  assertNode22Runtime();
});

test('app definition is exactly two zero-input fail-closed actions', async () => {
  assert.equal(app.version, '0.0.1');
  assert.equal(app.platformVersion, PLATFORM_VERSION);
  assert.equal(Object.hasOwn(app, 'authentication'), false);
  assert.deepEqual(app.triggers, {});
  assert.deepEqual(app.searches, {});
  assert.deepEqual(Object.keys(app.creates), ['arc1_review_revision', 'arc2_payment_start']);
  assert.equal(app.beforeRequest.length, 1);
  assert.deepEqual(app.afterResponse, []);

  for (const [actionKey, action] of Object.entries(app.creates)) {
    assert.equal(action.key, actionKey);
    assert.deepEqual(action.operation.inputFields, []);
    assert.equal(action.operation.cleanInputData, false);
    assert.equal(action.operation.perform.length, 0);
    for (const key of [
      'state', 'provider_state', 'artifact_state', 'archive_state',
      'validation_state', 'readback_state'
    ]) assert.equal(action.operation.sample[key], BLOCKED_STATE);
    for (const key of [
      'provider_mutation_allowed', 'activation_allowed', 'publish_allowed',
      'promotion_allowed', 'published', 'enabled'
    ]) assert.equal(action.operation.sample[key], false);
  }
});

test('actions and request hook emit only fixed redacted failures', async () => {
  const hostile = {
    inputData: {
      recipient: 'private@example.invalid',
      secret: 'never-log-this-value'
    }
  };
  for (const action of Object.values(app.creates)) {
    await assert.rejects(action.operation.perform({}, hostile), (error) => {
      assert.equal(error.name, 'ARCBlockedError');
      assert.equal(error.message, 'ARC_PRIVATE_ACTION_BLOCKED_UNVERIFIED');
      assert.equal(error.message.includes(hostile.inputData.recipient), false);
      assert.equal(error.message.includes(hostile.inputData.secret), false);
      return true;
    });
  }
  assert.throws(
    () => app.beforeRequest[0]({ url: 'https://private.invalid/never-log-this-value' }, {}, hostile),
    (error) => {
      assert.equal(error.name, 'ARCBlockedError');
      assert.equal(error.message, 'ARC_PRIVATE_NETWORK_DISABLED');
      assert.equal(error.message.includes('never-log-this-value'), false);
      return true;
    }
  );
});

test('manifests remain blocked and first-party workers are excluded', async () => {
  const config = await json('config-schema.json');
  const manifest = await json('paused-app-manifest.json');
  const readback = await json('provider-readback-contract.json');
  assert.deepEqual(config.authentication_fields, []);
  assert.deepEqual(config.environment_fields, []);
  assert.deepEqual(config.input_fields, []);
  assert.deepEqual(manifest.actions.map(({ canonical_workflow_id }) => canonical_workflow_id), [
    'arc1-review-revision',
    'arc2-payment-start'
  ]);
  assert.deepEqual(manifest.actions.map(({ zapier_action_key }) => zapier_action_key), [
    'arc1_review_revision',
    'arc2_payment_start'
  ]);
  assert.deepEqual(manifest.actions.map(({ input_fields }) => input_fields), [[], []]);
  assert.deepEqual(manifest.actions.map(({ clean_input_data }) => clean_input_data), [false, false]);
  assert.deepEqual(Object.entries(app.creates).map(([zapierActionKey, action], index) => ({
    canonical_workflow_id: manifest.actions[index].canonical_workflow_id,
    zapier_action_key: zapierActionKey,
    input_fields: action.operation.inputFields,
    clean_input_data: action.operation.cleanInputData
  })), manifest.actions.map(({ canonical_workflow_id, zapier_action_key, input_fields,
    clean_input_data }) => ({
    canonical_workflow_id,
    zapier_action_key,
    input_fields,
    clean_input_data
  })));
  assert.deepEqual(manifest.first_party_only_workflows, FIRST_PARTY_ONLY_WORKFLOWS);
  for (const document of [manifest, readback]) {
    for (const key of [
      'provider_state', 'artifact_state', 'archive_state',
      'validation_state', 'readback_state'
    ]) assert.equal(document[key], BLOCKED_STATE);
    assert.equal(document.provider_app_id, null);
    assert.equal(document.provider_version, null);
    assert.equal(document.provider_mutation_allowed, false);
    assert.equal(document.activation_allowed, false);
    assert.equal(document.publish_allowed, false);
    assert.equal(document.promotion_allowed, false);
    assert.equal(document.published, false);
    assert.equal(document.enabled, false);
  }
});

test('offline validation remains source-only and blocked', async () => {
  const receipt = await validateOfflineSource();
  assert.equal(receipt.state, BLOCKED_STATE);
  assert.equal(receipt.provider_state, BLOCKED_STATE);
  assert.equal(receipt.artifact_state, BLOCKED_STATE);
  assert.equal(receipt.archive_state, BLOCKED_STATE);
  assert.equal(receipt.validation_state, BLOCKED_STATE);
  assert.equal(receipt.readback_state, BLOCKED_STATE);
  assert.equal(receipt.provider_mutation_allowed, false);
  assert.equal(receipt.provider_actions_performed, false);
  assert.equal(receipt.target_node, '22.x');
  assert.equal(typeof receipt.target_node_runtime_executed, 'boolean');
  assert.equal(receipt.action_count, 2);
  assert.ok(receipt.source_receipts.length >= 9);
});
