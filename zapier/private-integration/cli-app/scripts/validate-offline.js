'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');
const BLOCKED_STATE = 'BLOCKED_UNVERIFIED';
const RUNTIME_SOURCE_PATHS = Object.freeze([
  'index.js',
  'src/app-definition.js',
  'src/network-barrier.js',
  'src/policy.js',
  'src/provider-adapters.js',
  'src/redaction.js',
  'src/actions/action-factory.js',
  'src/actions/payment-start.js',
  'src/actions/review-revision.js'
]);

const CREDENTIAL_PATTERNS = Object.freeze([
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\bre_[A-Za-z0-9]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bnfp_[A-Za-z0-9]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
]);

const FORBIDDEN_RUNTIME_PATTERNS = Object.freeze([
  /\bfetch\s*\(/,
  /\bbundle\s*\.\s*inputData\b/,
  /\bbundle\s*\.\s*authData\b/,
  /require\(['"](?:node:)?(?:http|https|net|tls|dns)['"]\)/
]);
const EXPECTED_ENVIRONMENT_READ_NAMES = Object.freeze([
  'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED',
  'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED',
  'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET',
  'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET'
]);
const EXPECTED_SECRET_ENVIRONMENT_READ_NAMES = Object.freeze([
  'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET',
  'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET'
]);

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

async function read(relativePath) {
  return readFile(path.join(APP_ROOT, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

function assertBlockedStates(document, label) {
  for (const key of [
    'provider_state',
    'artifact_state',
    'archive_state',
    'validation_state',
    'readback_state'
  ]) assert.equal(document[key], BLOCKED_STATE, `${label}.${key}`);
}

function assertOffControls(value, label, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertOffControls(entry, label, [...pathParts, index]));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (
      key === 'enabled' || key === 'published' || key === 'provider_mutation_allowed' ||
      key === 'provider_actions_allowed' || key === 'activation_allowed' ||
      key === 'publish_allowed' || key === 'promotion_allowed' ||
      key === 'authentication_configured' || key === 'network_allowed' ||
      key === 'environment_reads_allowed' || key === 'secret_values_present'
    ) assert.equal(child, false, `${label}.${childPath.join('.')}`);
    assertOffControls(child, label, childPath);
  }
}

function resolveLockDependency(packages, fromPath, name) {
  let base = fromPath;
  while (true) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    const index = base.lastIndexOf('/node_modules/');
    if (index < 0) break;
    base = base.slice(0, index);
  }
  const root = `node_modules/${name}`;
  return packages[root] ? root : null;
}

function walkLockClosure(packages, rootPath) {
  const visited = new Set();
  const queue = [rootPath];
  while (queue.length > 0) {
    const packagePath = queue.shift();
    if (visited.has(packagePath)) continue;
    visited.add(packagePath);
    const entry = packages[packagePath];
    assert.ok(entry, `lock is missing ${packagePath}`);
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(entry[field] || {})) {
        if (field === 'peerDependencies' && entry.peerDependenciesMeta?.[name]?.optional) continue;
        const dependencyPath = resolveLockDependency(packages, packagePath, name);
        assert.ok(dependencyPath, `lock is missing ${packagePath} -> ${name}`);
        queue.push(dependencyPath);
      }
    }
  }
  return visited;
}

function assertCompleteRuntimeLock(lockDocument) {
  const packages = lockDocument.packages;
  const productionClosure = walkLockClosure(packages, 'node_modules/zapier-platform-core');
  const cliClosure = walkLockClosure(packages, 'node_modules/zapier-platform-cli');
  for (const packagePath of productionClosure) {
    assert.notEqual(packages[packagePath].dev, true,
      `${packagePath} must remain in the production runtime closure`);
  }
  const completeClosure = new Set([...productionClosure, ...cliClosure]);
  assert.equal(completeClosure.size, Object.keys(packages).length - 1,
    'lock must contain only the complete Zapier core and CLI closures');
  for (const [packagePath, entry] of Object.entries(packages)) {
    if (!packagePath) continue;
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//,
      `${packagePath} resolved registry URL`);
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/,
      `${packagePath} integrity`);
    if (packagePath.endsWith('/form-data') || packagePath === 'node_modules/form-data') {
      assert.equal(entry.version, '4.0.6', `${packagePath} override`);
    }
  }
}

function assertNode22Runtime() {
  assert.equal(process.versions.node.split('.')[0], '22',
    `Node 22 runtime required; received ${process.versions.node}`);
}

async function inspectOfflineSource() {
  const packageDocument = await readJson('package.json');
  const lockDocument = await readJson('package-lock.json');
  const config = await readJson('config-schema.json');
  const manifest = await readJson('paused-app-manifest.json');
  const readback = await readJson('provider-readback-contract.json');
  const secretBindings = await readJson('secret-binding-contract.json');
  const app = require(path.join(APP_ROOT, 'index.js'));

  assert.equal(packageDocument.engines.node, '22.x');
  assert.equal(packageDocument.dependencies['zapier-platform-core'], '19.1.0');
  assert.equal(packageDocument.devDependencies['zapier-platform-cli'], '19.1.0');
  assert.equal(packageDocument.overrides['form-data'], '4.0.6');
  assert.equal(packageDocument.scripts['audit:production'], 'npm audit --omit=dev');
  assert.equal(lockDocument.lockfileVersion, 3);
  assert.equal(lockDocument.packages[''].dependencies['zapier-platform-core'], '19.1.0');
  assert.equal(lockDocument.packages[''].devDependencies['zapier-platform-cli'], '19.1.0');
  assert.equal(lockDocument.packages[''].engines.node, '22.x');
  assert.equal(lockDocument.packages['node_modules/zapier-platform-core'].version, '19.1.0');
  assert.equal(lockDocument.packages['node_modules/zapier-platform-cli'].version, '19.1.0');
  assert.equal(lockDocument.packages['node_modules/zapier-platform-cli'].dev, true);
  assert.equal(lockDocument.packages['node_modules/zapier-platform-cli'].resolved,
    'https://registry.npmjs.org/zapier-platform-cli/-/zapier-platform-cli-19.1.0.tgz');
  assert.equal(lockDocument.packages['node_modules/zapier-platform-cli'].integrity,
    'sha512-E2tPBqRymyC8AT8NyZlTkuNqUZL1EKX1oh/fqsUQKYSYYolcDHiorwW7OtNfDbW4AJWIcNd2BZMLIQ4gNsw6pw==');
  assert.equal(lockDocument.packages['node_modules/form-data'].version, '4.0.6');
  assertCompleteRuntimeLock(lockDocument);

  assert.deepEqual(config.authentication_fields, []);
  assert.deepEqual(config.environment_fields.map(({ name }) => name), EXPECTED_SECRET_ENVIRONMENT_READ_NAMES);
  assert.deepEqual(config.activation_fields.map(({ name }) => name), [
    'ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED',
    'ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED'
  ]);
  assert.ok(config.activation_fields.every(({ required_value, default_value, configured_value }) =>
    required_value === 'true' && default_value === 'false' && configured_value === 'false'));
  assert.equal(secretBindings.secret_values_present, false);
  assert.deepEqual(secretBindings.bindings.map(({ zapier_secret_environment_name,
    site_bearer_environment_name }) => [zapier_secret_environment_name, site_bearer_environment_name]), [
    ['ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET',
      'ARC_REVIEW_REVISION_RUN_ONE_INTERNAL_AUTH_SECRET'],
    ['ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET', 'ARC_PAYMENT_ARC2_RUN_ONE_SECRET']
  ]);
  assert.deepEqual(config.input_fields, []);
  assert.deepEqual(manifest.actions.map(({ canonical_workflow_id }) => canonical_workflow_id),
    ['arc1-review-revision', 'arc2-payment-start']);
  assert.deepEqual(manifest.actions.map(({ zapier_action_key }) => zapier_action_key),
    ['arc1_review_revision', 'arc2_payment_start']);

  for (const [label, document] of [
    ['config', config],
    ['manifest', manifest],
    ['readback', readback]
  ]) {
    assertBlockedStates(document, label);
    assertOffControls(document, label);
  }

  assert.equal(Object.hasOwn(app, 'authentication'), false);
  assert.deepEqual(Object.keys(app.triggers), []);
  assert.deepEqual(Object.keys(app.searches), []);
  assert.deepEqual(Object.keys(app.creates), ['arc1_review_revision', 'arc2_payment_start']);
  assert.equal(app.beforeRequest.length, 1);
  assert.equal(app.afterResponse.length, 0);

  for (const [index, [actionKey, action]] of Object.entries(app.creates).entries()) {
    assert.equal(action.key, actionKey);
    assert.deepEqual(action.operation.inputFields, []);
    assert.equal(action.operation.cleanInputData, false);
    assert.deepEqual(manifest.actions[index].input_fields, []);
    assert.equal(manifest.actions[index].clean_input_data, false);
    assertBlockedStates(action.operation.sample, 'action.sample');
    assertOffControls(action.operation.sample, 'action.sample');
    assert.equal(action.operation.perform.length, 1);
  }

  assert.throws(
    () => app.beforeRequest[0]({ url: 'https://invalid.example/private-value' }, {}, {}),
    (error) => error.name === 'ARCBlockedError' &&
      error.message === 'ARC_PRIVATE_NETWORK_BLOCKED' &&
      !error.message.includes('private-value')
  );

  const sourceReceipts = [];
  const environmentReadNames = new Set();
  for (const relativePath of RUNTIME_SOURCE_PATHS) {
    const raw = await read(relativePath);
    for (const pattern of CREDENTIAL_PATTERNS) {
      assert.equal(pattern.test(raw), false, `${relativePath} contains a credential-shaped value`);
    }
    for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
      assert.equal(pattern.test(raw), false, `${relativePath} contains forbidden runtime access`);
    }
    for (const match of raw.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) environmentReadNames.add(match[1]);
    sourceReceipts.push(Object.freeze({ path: relativePath, sha256: sha256(raw) }));
  }

  assert.deepEqual([...environmentReadNames].sort(), [...EXPECTED_ENVIRONMENT_READ_NAMES].sort(),
    'runtime must read exactly the two per-version Zapier secrets');
  return Object.freeze({
    schema: 'arc-zapier-v11-private-app-offline-source-receipt-v1',
    state: BLOCKED_STATE,
    provider_state: BLOCKED_STATE,
    artifact_state: BLOCKED_STATE,
    archive_state: BLOCKED_STATE,
    validation_state: BLOCKED_STATE,
    readback_state: BLOCKED_STATE,
    provider_mutation_allowed: false,
    provider_actions_performed: false,
    target_node: '22.x',
    host_node: process.versions.node,
    target_node_runtime_executed: process.versions.node.split('.')[0] === '22',
    action_count: 2,
    environment_read_names: Object.freeze([...EXPECTED_ENVIRONMENT_READ_NAMES]),
    secret_environment_read_names: Object.freeze([...EXPECTED_SECRET_ENVIRONMENT_READ_NAMES]),
    source_receipts: Object.freeze(sourceReceipts)
  });
}

async function validateOfflineSource() {
  assertNode22Runtime();
  return inspectOfflineSource();
}

module.exports = Object.freeze({
  BLOCKED_STATE,
  RUNTIME_SOURCE_PATHS,
  assertBlockedStates,
  assertNode22Runtime,
  assertOffControls,
  inspectOfflineSource,
  validateOfflineSource
});

if (require.main === module) {
  validateOfflineSource().then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
