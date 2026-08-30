'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const app = require('..');
const { BLOCKED_STATE, FIRST_PARTY_ONLY_WORKFLOWS, ORIGINS, PLATFORM_VERSION,
  REQUEST_TIMEOUT_MS, RESPONSE_MAX_BYTES, TARGET_ENVIRONMENT, TARGET_ORIGIN } = require('../src/policy');
const { assertNode22Runtime, validateOfflineSource } = require('../scripts/validate-offline');

const APP_ROOT = path.resolve(__dirname, '..');
const REVIEW_SECRET_NAME = 'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET';
const PAYMENT_SECRET_NAME = 'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET';
const REVIEW_ENABLED_NAME = 'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED';
const PAYMENT_ENABLED_NAME = 'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED';
const SECRET_NAMES = [REVIEW_SECRET_NAME, PAYMENT_SECRET_NAME];
const ENVIRONMENT_NAMES = [REVIEW_ENABLED_NAME, PAYMENT_ENABLED_NAME, ...SECRET_NAMES];
const json = async (name) => JSON.parse(await readFile(path.join(APP_ROOT, name), 'utf8'));
const headers = { get: (name) => name.toLowerCase() === 'content-type'
  ? 'application/json; charset=utf-8' : null };
const response = (url, status, value) => ({
  url, status, redirected: false, content: JSON.stringify(value), headers
});
const revisionEmpty = () => ({
  schema: 'arc-review-revision-run-one-result-v1', state: 'EMPTY', processed: 0, empty: true,
  idempotent_replay: false, next_cursor: null, work_hmac_sha256: null,
  successor_commit_sha: null, successor_manifest_sha256: null
});
const paymentIdle = () => ({
  schema: 'arc-payment-arc2-run-one-result-v1', state: 'IDLE', processed: 0, retry_required: false
});
const hex = (character, length = 64) => character.repeat(length);
const revisionLeaseActive = () => ({
  ...revisionEmpty(), state: 'LEASE_ACTIVE', empty: false, idempotent_replay: true,
  next_cursor: hex('1'), work_hmac_sha256: hex('2')
});
const revisionCompleted = () => ({
  ...revisionEmpty(), state: 'COMPLETED', processed: 1, empty: false,
  work_hmac_sha256: hex('3'), successor_commit_sha: hex('a', 40),
  successor_manifest_sha256: hex('4')
});
const paymentDurable = (state, overrides = {}) => ({
  schema: 'arc-payment-arc2-run-one-result-v1', state,
  processed: state === 'COMPLETED' ? 1 : 0,
  retry_required: state === 'RETRY_REQUIRED',
  idempotent_replay: false,
  outbox_key_sha256: hex('5'), immutable_binding_sha256: hex('6'),
  start_request_sha256: hex('7'), artifact_evidence_sha256: hex('8'),
  handoff_id_sha256: hex('9'), handoff_state: 'REVERSAL_CONTROL_READY',
  reversal_control_ready: true,
  completion_receipt_sha256: state === 'COMPLETED' ? hex('a') : null,
  ...overrides
});
const paymentReviewRequired = () => ({
  schema: 'arc-payment-arc2-run-one-result-v1', state: 'REVIEW_REQUIRED', processed: 0,
  retry_required: false, outbox_key_sha256: hex('b'), immutable_binding_sha256: hex('c'),
  manual_review_evidence_sha256: hex('d')
});

async function withSecrets(run) {
  const saved = Object.fromEntries(ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]));
  process.env[REVIEW_ENABLED_NAME] = 'true';
  process.env[PAYMENT_ENABLED_NAME] = 'true';
  process.env[REVIEW_SECRET_NAME] = 'r'.repeat(43);
  process.env[PAYMENT_SECRET_NAME] = 'p'.repeat(43);
  try { return await run(); } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('contract suite executes only on Node 22', () => assertNode22Runtime());

test('app defines exactly two zero-input default-OFF actions', async () => {
  assert.equal(app.version, '0.0.2');
  assert.equal(app.platformVersion, PLATFORM_VERSION);
  assert.equal(Object.hasOwn(app, 'authentication'), false);
  assert.deepEqual(app.triggers, {});
  assert.deepEqual(app.searches, {});
  assert.deepEqual(Object.keys(app.creates), ['arc1_review_revision', 'arc2_payment_start']);
  assert.equal(app.beforeRequest.length, 1);
  assert.deepEqual(app.afterResponse, []);
  assert.equal(TARGET_ENVIRONMENT, 'sandbox');
  assert.equal(TARGET_ORIGIN, ORIGINS.sandbox);
  for (const [actionKey, action] of Object.entries(app.creates)) {
    assert.equal(action.key, actionKey);
    assert.deepEqual(action.operation.inputFields, []);
    assert.equal(action.operation.cleanInputData, false);
    assert.equal(action.operation.perform.length, 1);
    assert.equal(action.operation.sample.state, 'OFF');
    assert.equal(action.operation.sample.dispatched, false);
    assert.equal(action.operation.sample.provider_state, BLOCKED_STATE);
  }
  for (const name of ENVIRONMENT_NAMES) delete process.env[name];
  for (const action of Object.values(app.creates)) {
    await assert.rejects(action.operation.perform({ request: async () => assert.fail('network called') }),
      (error) => error.name === 'ARCBlockedError' && error.message === 'ARC_PRIVATE_ACTION_OFF');
  }
});

test('each exact-true action gate is independent from secret presence', async () => {
  const saved = Object.fromEntries(ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]));
  process.env[REVIEW_SECRET_NAME] = 'r'.repeat(43);
  process.env[PAYMENT_SECRET_NAME] = 'p'.repeat(43);
  try {
    for (const invalid of [undefined, '', 'false', 'TRUE', '1', ' true']) {
      if (invalid === undefined) delete process.env[REVIEW_ENABLED_NAME];
      else process.env[REVIEW_ENABLED_NAME] = invalid;
      let calls = 0;
      await assert.rejects(app.creates.arc1_review_revision.operation.perform({
        request: async () => { calls += 1; }
      }), (error) => error.message === 'ARC_PRIVATE_ACTION_OFF');
      assert.equal(calls, 0);
    }
    process.env[REVIEW_ENABLED_NAME] = 'true';
    delete process.env[REVIEW_SECRET_NAME];
    await assert.rejects(app.creates.arc1_review_revision.operation.perform({
      request: async () => assert.fail('network called')
    }), (error) => error.message === 'ARC_PRIVATE_ACTION_OFF');

    process.env[REVIEW_SECRET_NAME] = 'r'.repeat(43);
    process.env[PAYMENT_ENABLED_NAME] = 'false';
    await assert.rejects(app.creates.arc2_payment_start.operation.perform({
      request: async () => assert.fail('network called')
    }), (error) => error.message === 'ARC_PRIVATE_ACTION_OFF');
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('actions ignore bundle input and dispatch only exact bounded first-party requests', async () => {
  await withSecrets(async () => {
    const hostile = { inputData: { secret: 'must-not-leak', url: 'https://attacker.invalid' } };
    const seen = [];
    const z = { request: async (request) => {
      seen.push(request);
      assert.equal(app.beforeRequest[0](request, {}, hostile), request);
      return response(request.url, 200,
        request.url.endsWith('/review-revision/run-one') ? revisionEmpty() : paymentIdle());
    } };
    const revision = await app.creates.arc1_review_revision.operation.perform(z, hostile);
    const payment = await app.creates.arc2_payment_start.operation.perform(z, hostile);
    assert.deepEqual([revision.state, payment.state], ['EMPTY', 'IDLE']);
    assert.equal(revision.dispatched, true);
    assert.equal(payment.dispatched, true);
    assert.deepEqual(seen.map(({ url }) => url), [
      `${TARGET_ORIGIN}/api/internal/review-revision/run-one`,
      `${TARGET_ORIGIN}/internal/payment-arc2/run-one`
    ]);
    for (const request of seen) {
      assert.equal(request.method, 'POST');
      assert.equal(request.body, '{}');
      assert.equal(request.timeout, REQUEST_TIMEOUT_MS);
      assert.equal(request.size, RESPONSE_MAX_BYTES);
      assert.equal(request.redirect, 'error');
      assert.equal(request.follow, 0);
      assert.equal(request.compress, false);
      assert.equal(request.skipThrowForStatus, true);
      assert.equal(Object.keys(request.headers).some((name) => name.toLowerCase() === 'origin'), false);
      assert.equal(JSON.stringify(request).includes(hostile.inputData.secret), false);
      assert.equal(JSON.stringify(request).includes(hostile.inputData.url), false);
    }
    const output = JSON.stringify([revision, payment]);
    assert.equal(output.includes(process.env[REVIEW_SECRET_NAME]), false);
    assert.equal(output.includes(process.env[PAYMENT_SECRET_NAME]), false);
  });
});

test('positive state matrix emits only fixed redacted action output', async () => {
  await withSecrets(async () => {
    const cases = [
      ['arc1_review_revision', 200, revisionEmpty(), 'EMPTY', false],
      ['arc1_review_revision', 200, revisionLeaseActive(), 'LEASE_ACTIVE', true],
      ['arc1_review_revision', 200, revisionCompleted(), 'COMPLETED', false],
      ['arc2_payment_start', 200, paymentIdle(), 'IDLE', false],
      ['arc2_payment_start', 200, paymentDurable('COMPLETED'), 'COMPLETED', false],
      ['arc2_payment_start', 202, paymentDurable('RETRY_REQUIRED'), 'RETRY_REQUIRED', true],
      ['arc2_payment_start', 409, paymentReviewRequired(), 'REVIEW_REQUIRED', false]
    ];
    for (const [actionKey, status, body, expectedState, retryRequired] of cases) {
      const output = await app.creates[actionKey].operation.perform({ request: async (request) => {
        app.beforeRequest[0](request, {}, { inputData: { private: 'ignored' } });
        return response(request.url, status, body);
      } }, { inputData: { private: 'ignored' } });
      assert.deepEqual(Object.keys(output), [
        'id', 'state', 'dispatched', 'retry_required', 'provider_state', 'artifact_state',
        'archive_state', 'validation_state', 'readback_state', 'provider_mutation_allowed',
        'activation_allowed', 'publish_allowed', 'promotion_allowed', 'published', 'enabled'
      ]);
      assert.equal(output.state, expectedState);
      assert.equal(output.retry_required, retryRequired);
      assert.equal(JSON.stringify(output).includes('ignored'), false);
      assert.equal(JSON.stringify(output).includes(hex('5')), false);
    }
  });
});

test('Zapier action tester exercises the positive bounded transport matrix locally', async () => {
  const coreEntry = require.resolve('zapier-platform-core');
  const requestClientPath = path.join(path.dirname(coreEntry), 'src', 'tools', 'request-client.js');
  const transport = [];
  const queued = [];
  require.cache[requestClientPath] = {
    id: requestClientPath,
    filename: requestClientPath,
    loaded: true,
    exports: async (options) => {
      transport.push(options);
      const next = queued.shift();
      assert.ok(next, 'unexpected Zapier transport call');
      const { Response } = require('node-fetch');
      const value = new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
      Object.defineProperty(value, 'url', { value: options.url });
      Object.defineProperty(value, 'redirected', { value: false });
      return value;
    }
  };
  const { createAppTester } = require('zapier-platform-core');
  const beforeSnapshots = [];
  const testApp = { ...app, beforeRequest: [(request, z, bundle) => {
    beforeSnapshots.push({
      keys: Object.keys(request), url: request.url, method: request.method,
      body: String(request.body), timeout: request.timeout, size: request.size,
      redirect: request.redirect, follow: request.follow, compress: request.compress,
      skipThrowForStatus: request.skipThrowForStatus,
      headerNames: Object.keys(request.headers || {}),
      userAgent: request.headers?.['user-agent'], params: request.params
    });
    return app.beforeRequest[0](request, z, bundle);
  }] };
  const tester = createAppTester(testApp);
  await withSecrets(async () => {
    queued.push(
      { status: 200, body: revisionCompleted() },
      { status: 202, body: paymentDurable('RETRY_REQUIRED') }
    );
    const revision = await tester(testApp.creates.arc1_review_revision.operation.perform,
      { inputData: { private: 'must-not-enter-request' } });
    const payment = await tester(testApp.creates.arc2_payment_start.operation.perform,
      { inputData: { private: 'must-not-enter-request' } });
    assert.equal(revision.state, 'COMPLETED');
    assert.equal(payment.state, 'RETRY_REQUIRED');
    assert.equal(queued.length, 0);
    assert.equal(transport.length, 2);
    assert.equal(beforeSnapshots.length, 2);
    assert.ok(beforeSnapshots.every(({ userAgent, params }) =>
      userAgent === 'Zapier' && Object.keys(params).length === 0));
    assert.deepEqual(transport.map(({ url }) => url), [
      `${TARGET_ORIGIN}/api/internal/review-revision/run-one`,
      `${TARGET_ORIGIN}/internal/payment-arc2/run-one`
    ]);
    for (const request of transport) {
      assert.equal(request.method, 'POST');
      assert.equal(request.body.toString(), '{}');
      assert.equal(request.timeout, REQUEST_TIMEOUT_MS);
      assert.equal(request.size, RESPONSE_MAX_BYTES);
      assert.equal(request.redirect, 'error');
      assert.equal(request.follow, 0);
      assert.equal(request.compress, false);
      assert.equal(String(request.body).includes('must-not-enter-request'), false);
    }
  });
});

test('state-specific durable evidence and status bindings fail closed', async () => {
  await withSecrets(async () => {
    const cases = [
      ['arc1_review_revision', 200, { ...revisionLeaseActive(), work_hmac_sha256: null }],
      ['arc1_review_revision', 200, { ...revisionCompleted(), successor_commit_sha: null }],
      ['arc1_review_revision', 200, { ...revisionEmpty(), work_hmac_sha256: hex('1') }],
      ['arc2_payment_start', 200, { ...paymentDurable('COMPLETED'), completion_receipt_sha256: null }],
      ['arc2_payment_start', 202, { ...paymentDurable('RETRY_REQUIRED'),
        completion_receipt_sha256: hex('1') }],
      ['arc2_payment_start', 409, { ...paymentReviewRequired(), manual_review_evidence_sha256: null }],
      ['arc2_payment_start', 409, {
        schema: 'arc-payment-arc2-run-one-result-v1', error: 'payment_arc2_run_one_conflict'
      }],
      ['arc2_payment_start', 202, paymentIdle()]
    ];
    for (const [actionKey, status, body] of cases) {
      await assert.rejects(app.creates[actionKey].operation.perform({ request: async (request) =>
        response(request.url, status, body) }),
      (error) => error.name === 'ARCBlockedError' && error.message === 'ARC_PRIVATE_DISPATCH_FAILED');
    }
  });
});

test('middleware rejects every origin, path, method, body, or bound mutation', async () => {
  await withSecrets(async () => {
    let baseline;
    await app.creates.arc1_review_revision.operation.perform({ request: async (request) => {
      baseline = request;
      return response(request.url, 200, revisionEmpty());
    } }, {});
    const mutations = [
      { url: `${ORIGINS.production}/api/internal/review-revision/run-one` },
      { url: `${TARGET_ORIGIN}/api/internal/review-revision/run-one?next=1` },
      { url: `${TARGET_ORIGIN}/api/internal/review-revision/claim` },
      { method: 'GET' }, { body: '{"cursor":null}' }, { timeout: REQUEST_TIMEOUT_MS + 1 },
      { size: RESPONSE_MAX_BYTES + 1 }, { redirect: 'follow' }, { follow: 1 },
      { compress: true }, { skipThrowForStatus: false }, { params: { next: '1' } },
      { headers: { ...baseline.headers, Origin: TARGET_ORIGIN } },
      { headers: { ...baseline.headers, Authorization: `Bearer ${'x'.repeat(43)}` } }
    ];
    for (const mutation of mutations) {
      assert.throws(() => app.beforeRequest[0]({ ...baseline, ...mutation }, {}, {}),
        (error) => error.name === 'ARCBlockedError' && error.message === 'ARC_PRIVATE_NETWORK_BLOCKED');
    }
  });
});

test('responses and transport failures collapse to fixed redacted errors', async () => {
  await withSecrets(async () => {
    const action = app.creates.arc1_review_revision.operation;
    const hostileError = new Error(`private ${process.env[REVIEW_SECRET_NAME]}`);
    for (const request of [
      async () => { throw hostileError; },
      async ({ url }) => response(url, 503, { error: hostileError.message }),
      async ({ url }) => response(url, 200, { ...revisionEmpty(), recipient: 'private@example.test' }),
      async ({ url }) => ({ ...response(url, 200, revisionEmpty()), redirected: true }),
      async ({ url }) => ({ ...response(url, 200, revisionEmpty()), url: `${url}/redirected` }),
      async ({ url }) => ({ ...response(url, 200, revisionEmpty()),
        content: 'x'.repeat(RESPONSE_MAX_BYTES + 1) })
    ]) {
      await assert.rejects(action.perform({ request }, { inputData: hostileError.message }), (error) => {
        assert.equal(error.name, 'ARCBlockedError');
        assert.equal(error.message, 'ARC_PRIVATE_DISPATCH_FAILED');
        assert.equal(error.message.includes(process.env[REVIEW_SECRET_NAME]), false);
        return true;
      });
    }
  });
});

test('manifests stay uninstalled and first-party-only workflows stay excluded', async () => {
  const config = await json('config-schema.json');
  const manifest = await json('paused-app-manifest.json');
  const readback = await json('provider-readback-contract.json');
  const secretBinding = await json('secret-binding-contract.json');
  assert.deepEqual(config.authentication_fields, []);
  assert.deepEqual(config.input_fields, []);
  assert.deepEqual(config.activation_fields.map(({ name }) => name),
    [REVIEW_ENABLED_NAME, PAYMENT_ENABLED_NAME]);
  assert.deepEqual(config.environment_fields.map(({ name }) => name), SECRET_NAMES);
  assert.deepEqual(manifest.activation_environment_names, [REVIEW_ENABLED_NAME, PAYMENT_ENABLED_NAME]);
  assert.deepEqual(manifest.secret_environment_names, SECRET_NAMES);
  assert.deepEqual(manifest.first_party_only_workflows, FIRST_PARTY_ONLY_WORKFLOWS);
  assert.equal(secretBinding.secret_values_present, false);
  assert.deepEqual(secretBinding.bindings.map(({ zapier_secret_environment_name,
    site_bearer_environment_name }) => [zapier_secret_environment_name, site_bearer_environment_name]), [
    [REVIEW_SECRET_NAME, 'ARC_REVIEW_REVISION_RUN_ONE_INTERNAL_AUTH_SECRET'],
    [PAYMENT_SECRET_NAME, 'ARC_PAYMENT_ARC2_RUN_ONE_SECRET']
  ]);
  assert.equal(secretBinding.bindings.every(({ zapier_secret_environment_name,
    site_bearer_environment_name }) => zapier_secret_environment_name !== site_bearer_environment_name), true);
  for (const document of [manifest, readback]) {
    for (const key of ['provider_state', 'artifact_state', 'archive_state', 'validation_state', 'readback_state']) {
      assert.equal(document[key], BLOCKED_STATE);
    }
    assert.equal(document.provider_app_id, null);
    assert.equal(document.provider_version, null);
    for (const key of ['provider_mutation_allowed', 'activation_allowed', 'publish_allowed',
      'promotion_allowed', 'published', 'enabled']) assert.equal(document[key], false);
  }
});

test('offline validation remains source-only and blocked', async () => {
  const receipt = await validateOfflineSource();
  assert.equal(receipt.state, BLOCKED_STATE);
  assert.equal(receipt.provider_state, BLOCKED_STATE);
  assert.equal(receipt.provider_mutation_allowed, false);
  assert.equal(receipt.provider_actions_performed, false);
  assert.equal(receipt.target_node, '22.x');
  assert.equal(receipt.action_count, 2);
  assert.deepEqual(receipt.environment_read_names, ENVIRONMENT_NAMES);
  assert.deepEqual(receipt.secret_environment_read_names, SECRET_NAMES);
  assert.ok(receipt.source_receipts.length >= 9);
});
