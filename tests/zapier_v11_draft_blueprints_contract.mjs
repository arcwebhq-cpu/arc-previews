import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertNoCredentialValues,
  semanticOffControlEntries,
  validatePausedDraftIndex,
  validatePausedDraftWiringSection,
  validatePausedWorkflowDraft,
  validateZapierV11Drafts,
} from '../scripts/validate_zapier_v11_drafts.mjs';

function setAtPath(value, path, replacement) {
  let target = value;
  for (const part of path.slice(0, -1)) target = target[part];
  target[path.at(-1)] = replacement;
}

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const result = await validateZapierV11Drafts();
assert.equal(result.schema, 'arc-zapier-v11-paused-draft-validation-v1');
assert.equal(result.status, 'ARC_ZAPIER_V11_DRAFTS_VALIDATED');
assert.equal(result.configuration_state, 'blocked-paused');
assert.equal(result.provider_mutation_allowed, false);
assert.match(result.index_sha256, /^[a-f0-9]{64}$/);
assert.equal(result.workflow_receipts.length, 4);
for (const receipt of result.workflow_receipts) {
  assert.match(receipt.path, /^zapier\/drafts\/[a-z0-9-]+\.json$/);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
}
assert.deepEqual(result.credential_scan_receipts.map(({ path }) => path), [
  'zapier/drafts/index.json',
  'zapier/drafts/arc1-review-email.json',
  'zapier/drafts/arc1-review-revision.json',
  'zapier/drafts/arc2-payment-start.json',
  'zapier/drafts/review-checkout-revocation.json',
  'zapier/v11-paused-draft-runbook.md',
  'zapier/wiring-contract.json',
]);
assert.ok(result.credential_scan_receipts.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));

const wiring = JSON.parse(await readFile(new URL('../zapier/wiring-contract.json', import.meta.url), 'utf8'));
assert.deepEqual(wiring.paused_draft_blueprints.workflows, [
  'ARC V11 - Review Email Worker - PAUSED',
  'ARC V11 - Review Revision Worker - PAUSED',
  'ARC V11 - Payment to ARC2 Start Worker - PAUSED',
  'ARC V11 - Review Checkout Revocation Worker - PAUSED',
]);
assert.equal(wiring.paused_draft_blueprints.offline_recipe_complete, true);
assert.equal(wiring.paused_draft_blueprints.provider_installation_performed, false);
assert.equal(wiring.paused_draft_blueprints.provider_version_readback_verified, false);
assert.equal(wiring.paused_draft_blueprints.provider_contract_receipts_verified, false);
assert.equal(wiring.paused_draft_blueprints.published, false);
assert.equal(wiring.paused_draft_blueprints.enabled, false);
assert.equal(wiring.paused_draft_blueprints.activation_allowed, false);
assert.equal(wiring.paused_draft_blueprints.maximum_concurrency, 1);
assert.equal(wiring.paused_draft_blueprints.history_redaction_required, true);
assert.equal(wiring.paused_draft_blueprints.history_redaction_verified, false);
assert.equal(wiring.paused_draft_blueprints.first_party_synchronous_ack_adapter_required, true);
assert.equal(wiring.paused_draft_blueprints.zapier_catch_hook_is_synchronous_ack_authority, false);

const index = await json('../zapier/drafts/index.json');
const workflowDocuments = await Promise.all([
  ['arc1-review-email', '../zapier/drafts/arc1-review-email.json'],
  ['arc1-review-revision', '../zapier/drafts/arc1-review-revision.json'],
  ['arc2-payment-start', '../zapier/drafts/arc2-payment-start.json'],
  ['review-checkout-revocation', '../zapier/drafts/review-checkout-revocation.json'],
].map(async ([id, relativePath]) => [id, await json(relativePath)]));

const semanticDocuments = [
  ['index', index, validatePausedDraftIndex],
  ['wiring.paused_draft_blueprints', wiring.paused_draft_blueprints, validatePausedDraftWiringSection],
  ...workflowDocuments.map(([id, value]) =>
    [id, value, (candidate) => validatePausedWorkflowDraft(candidate, id)]),
];
let mutatedSemanticControls = 0;
for (const [label, document, validate] of semanticDocuments) {
  const entries = semanticOffControlEntries(document);
  assert.ok(entries.length > 0, `${label} must expose semantic OFF controls`);
  for (const entry of entries) {
    assert.equal(entry.value, false, `${label}.${entry.path.join('.')} baseline`);
    const mutated = structuredClone(document);
    setAtPath(mutated, entry.path, true);
    assert.throws(() => validate(mutated), /ARC_ZAPIER_V11_DRAFT_INVALID/,
      `${label}.${entry.path.join('.')} must reject true`);
    mutatedSemanticControls += 1;
  }
}
assert.ok(mutatedSemanticControls >= 100,
  `expected broad semantic OFF mutation coverage, observed ${mutatedSemanticControls}`);

const futureIndexControl = structuredClone(index);
futureIndexControl.global_requirements.future_provider_gate_default = true;
assert.throws(() => validatePausedDraftIndex(futureIndexControl),
  /semantic OFF control .* must be false/);
const futureWiringControl = structuredClone(wiring.paused_draft_blueprints);
futureWiringControl.future_provider_actions_default = true;
assert.throws(() => validatePausedDraftWiringSection(futureWiringControl),
  /semantic OFF control .* must be false/);

for (const [id, workflow] of workflowDocuments) {
  for (const key of ['future_provider_gate_default', 'future_provider_actions_default',
    'future_provider_action_enabled', 'exact_completion_replay_allowed']) {
    const mutated = structuredClone(workflow);
    mutated.controls[key] = true;
    assert.throws(() => validatePausedWorkflowDraft(mutated, id),
      /semantic OFF control .* must be false/);
  }
  const mutatedAction = structuredClone(workflow);
  mutatedAction.steps[1].provider_action = true;
  assert.throws(() => validatePausedWorkflowDraft(mutatedAction, id),
    /provider action must stay false|semantic OFF control/);
  const stringGate = structuredClone(workflow);
  stringGate.controls.future_provider_gate_default = 'true';
  assert.throws(() => validatePausedWorkflowDraft(stringGate, id),
    /semantic OFF control .* must be false/);
}

for (const sample of [
  ['sk', 'live', '1234567890abcdef'].join('_'),
  ['rk', 'test', '1234567890abcdef'].join('_'),
  ['whsec', '1234567890abcdef'].join('_'),
  ['re', '1234567890abcdefghij'].join('_'),
  ['ghp', '1234567890abcdef'].join('_'),
  ['github', 'pat', '1234567890abcdefghij'].join('_'),
  ['nfp', '1234567890abcdef'].join('_'),
  ['AKIA', '1234567890ABCDEF'].join(''),
  ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
]) {
  assert.throws(() => assertNoCredentialValues(`candidate=${sample}`, 'negative fixture'),
    /contains .*key|contains .*secret|contains .*token|contains private key/);
}
const credentialMutation = structuredClone(workflowDocuments[0][1]);
credentialMutation.title = ['sk', 'live', '1234567890abcdef'].join('_');
assert.throws(() => validatePausedWorkflowDraft(credentialMutation, workflowDocuments[0][0]),
  /contains Stripe secret key/);

const runbook = await readFile(new URL('../zapier/v11-paused-draft-runbook.md', import.meta.url), 'utf8');
assert.match(runbook, /unpublished and OFF/i);
assert.match(runbook, /never replay/i);
assert.match(runbook, /Catch Hook.*cannot.*synchronous/i);
assert.match(runbook, /history redaction/i);
assert.match(runbook, /atomic.*CAS/i);
assert.match(runbook, /HTTP 202.*not.*complete/i);
assert.match(runbook, /no separate checkout-revocation claim/i);
assert.match(runbook, /Resend-native/i);
assert.match(runbook, /Payment Link.*forbidden/i);

console.log('ARC V11 Zapier paused draft blueprints passed: four workflows remain unpublished, OFF, private-history-only, and activation-blocked.');
