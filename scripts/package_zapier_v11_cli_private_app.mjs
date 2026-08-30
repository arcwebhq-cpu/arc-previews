import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const APP_PATH = 'zapier/private-integration/cli-app';
const APP_ROOT = path.join(REPOSITORY_ROOT, APP_PATH);
const BLOCKED_STATE = 'BLOCKED_UNVERIFIED';

export const ZAPIER_PRIVATE_APP_SOURCE_ALLOWLIST = Object.freeze([
  '.gitignore',
  'README.md',
  'config-schema.json',
  'index.js',
  'package-lock.json',
  'package.json',
  'paused-app-manifest.json',
  'provider-readback-contract.json',
  'secret-binding-contract.json',
  'scripts/validate-offline.js',
  'src/actions/action-factory.js',
  'src/actions/payment-start.js',
  'src/actions/review-revision.js',
  'src/app-definition.js',
  'src/network-barrier.js',
  'src/policy.js',
  'src/provider-adapters.js',
  'src/redaction.js',
  'test/contract.test.js'
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

function sha256(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

async function inventory(directory = APP_ROOT, prefix = '') {
  const names = await readdir(directory);
  const files = [];
  for (const name of names.sort()) {
    if (!prefix && (name === 'build' || name === 'node_modules')) continue;
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const absolutePath = path.join(directory, name);
    const stats = await lstat(absolutePath);
    assert.equal(stats.isSymbolicLink(), false, `symlink forbidden: ${relativePath}`);
    if (stats.isDirectory()) files.push(...await inventory(absolutePath, relativePath));
    else if (stats.isFile()) files.push(relativePath);
    else assert.fail(`unsupported source entry: ${relativePath}`);
  }
  return files.sort();
}

function assertBlockedStates(value, label) {
  for (const key of [
    'provider_state',
    'artifact_state',
    'archive_state',
    'validation_state',
    'readback_state'
  ]) assert.equal(value[key], BLOCKED_STATE, `${label}.${key}`);
}

export async function buildZapierPrivateAppSourceReceipt() {
  const files = await inventory();
  assert.deepEqual(files, [...ZAPIER_PRIVATE_APP_SOURCE_ALLOWLIST].sort(),
    'private app source inventory must match the exact allowlist');

  const receipts = [];
  for (const relativePath of files) {
    const raw = await readFile(path.join(APP_ROOT, relativePath));
    const text = raw.toString('utf8');
    for (const pattern of CREDENTIAL_PATTERNS) {
      assert.equal(pattern.test(text), false, `${relativePath} contains a credential-shaped value`);
    }
    receipts.push(Object.freeze({ path: relativePath, sha256: sha256(raw) }));
  }

  const manifest = JSON.parse(await readFile(path.join(APP_ROOT, 'paused-app-manifest.json'), 'utf8'));
  const readback = JSON.parse(await readFile(path.join(APP_ROOT, 'provider-readback-contract.json'), 'utf8'));
  assertBlockedStates(manifest, 'manifest');
  assertBlockedStates(readback, 'readback');
  assert.equal(manifest.provider_mutation_allowed, false);
  assert.equal(manifest.provider_actions_allowed, false);
  assert.equal(manifest.activation_allowed, false);
  assert.equal(manifest.publish_allowed, false);
  assert.equal(manifest.promotion_allowed, false);
  assert.equal(readback.provider_mutation_allowed, false);
  assert.equal(readback.activation_allowed, false);
  assert.equal(readback.publish_allowed, false);
  assert.equal(readback.promotion_allowed, false);

  for (const contract of manifest.preserved_contracts) {
    const raw = await readFile(path.join(REPOSITORY_ROOT, contract.path));
    assert.equal(sha256(raw), contract.sha256, `${contract.path} digest`);
  }

  const sourceInventorySha256 = sha256(receipts
    .map(({ path: relativePath, sha256: digest }) => `${relativePath}\0${digest}\n`)
    .join(''));

  return Object.freeze({
    schema: 'arc-zapier-v11-private-app-source-package-receipt-v1',
    app_path: APP_PATH,
    state: BLOCKED_STATE,
    provider_state: BLOCKED_STATE,
    artifact_state: BLOCKED_STATE,
    archive_state: BLOCKED_STATE,
    validation_state: BLOCKED_STATE,
    readback_state: BLOCKED_STATE,
    source_archive_created: false,
    provider_build_performed: false,
    provider_validation_performed: false,
    provider_readback_performed: false,
    provider_mutation_allowed: false,
    source_inventory_sha256: sourceInventorySha256,
    source_receipts: Object.freeze(receipts)
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const receipt = await buildZapierPrivateAppSourceReceipt();
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
