import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const INDEX_PATH = 'zapier/drafts/index.json';
const WORKFLOW_SCHEMA = 'arc-zapier-v11-paused-workflow-draft-v1';
const HEX_64 = /^[a-f0-9]{64}$/;
const ARTIFACT_PATHS = Object.freeze([
  INDEX_PATH,
  'zapier/drafts/arc1-review-email.json',
  'zapier/drafts/arc1-review-revision.json',
  'zapier/drafts/arc2-payment-start.json',
  'zapier/drafts/review-checkout-revocation.json',
  'zapier/v11-paused-draft-runbook.md',
  'zapier/wiring-contract.json',
]);
const CREDENTIAL_PATTERNS = Object.freeze([
  Object.freeze({ label: 'Stripe secret key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ }),
  Object.freeze({ label: 'Stripe webhook secret', pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/ }),
  Object.freeze({ label: 'Resend API key', pattern: /\bre_[A-Za-z0-9]{20,}\b/ }),
  Object.freeze({ label: 'GitHub classic token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/ }),
  Object.freeze({ label: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ }),
  Object.freeze({ label: 'Netlify token', pattern: /\bnfp_[A-Za-z0-9]{16,}\b/ }),
  Object.freeze({ label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ }),
  Object.freeze({ label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }),
]);
const SAFE_TRUE_ALLOWED_PATHS = new Set(['retry_contract.exact_completion_replay_allowed']);

function invariant(condition, message) {
  if (!condition) throw new Error(`ARC_ZAPIER_V11_DRAFT_INVALID: ${message}`);
}

export function assertNoCredentialValues(raw, label = 'artifact') {
  invariant(typeof raw === 'string', `${label} credential scan input`);
  for (const credential of CREDENTIAL_PATTERNS) {
    invariant(!credential.pattern.test(raw), `${label} contains ${credential.label}`);
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function semanticOffKey(key, parent, pathParts) {
  if (SAFE_TRUE_ALLOWED_PATHS.has(pathParts.join('.'))) return false;
  return key === 'enabled' || key === 'published' || key === 'activation_allowed' ||
    key === 'provider_action' || key === 'provider_mutation_allowed' ||
    key === 'legacy_hook_replay_allowed' || key === 'auto_replay' ||
    key === 'invoked_by_zapier' || key === 'accepted_send_response_is_delivery_proof' ||
    key === 'http_202_means_complete' || key === 'timeout_marks_complete' ||
    key === 'secret_values_present' ||
    key === 'configured_value' && parent?.id === 'off_guard' ||
    /_enabled$/.test(key) || /_gate_default$/.test(key) || /_actions_default$/.test(key) ||
    /_allowed$/.test(key) || /_verified$/.test(key) || /_installation_performed$/.test(key);
}

export function semanticOffControlEntries(value) {
  const entries = [];
  const visit = (current, pathParts, parent) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, [...pathParts, index], current));
      return;
    }
    if (!plainObject(current)) return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = [...pathParts, key];
      if (semanticOffKey(key, current, childPath)) {
        entries.push(Object.freeze({ path: Object.freeze(childPath), value: child }));
      }
      visit(child, childPath, current);
    }
  };
  visit(value, [], null);
  return Object.freeze(entries);
}

export function validateSemanticOffControls(value, label = 'artifact') {
  const entries = semanticOffControlEntries(value);
  invariant(entries.length > 0, `${label} has no semantic OFF controls`);
  for (const entry of entries) {
    invariant(entry.value === false,
      `${label} semantic OFF control ${entry.path.join('.')} must be false`);
  }
  return entries;
}

function exactArray(value, expected, label) {
  invariant(Array.isArray(value), `${label} must be an array`);
  invariant(JSON.stringify(value) === JSON.stringify(expected), `${label} changed`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(relativePath) {
  const absolutePath = path.join(REPOSITORY_ROOT, relativePath);
  const raw = await readFile(absolutePath, 'utf8');
  let value;
  try { value = JSON.parse(raw); } catch (cause) {
    throw new Error(`ARC_ZAPIER_V11_DRAFT_INVALID: ${relativePath} is not JSON`, { cause });
  }
  invariant(plainObject(value), `${relativePath} must be a JSON object`);
  return { raw, value };
}

function step(workflow, id) {
  const selected = workflow.steps.find((candidate) => candidate.id === id);
  invariant(selected, `${workflow.workflow_id} is missing ${id}`);
  return selected;
}

function validateCommon(workflow, expectedId) {
  invariant(workflow.schema === WORKFLOW_SCHEMA, `${expectedId} schema`);
  invariant(workflow.release === 'ARC V11', `${expectedId} release`);
  invariant(workflow.workflow_id === expectedId, `${expectedId} identity`);
  invariant(workflow.provider_state === 'DRAFT_UNPUBLISHED_OFF', `${expectedId} state`);
  invariant(workflow.published === false, `${expectedId} published`);
  invariant(workflow.enabled === false, `${expectedId} enabled`);
  invariant(workflow.activation_allowed === false, `${expectedId} activation`);
  invariant(workflow.maximum_concurrency === 1, `${expectedId} concurrency`);
  invariant(workflow.auto_replay === false, `${expectedId} replay`);
  invariant(workflow.history_policy?.mode === 'private-integration-redacted', `${expectedId} history mode`);
  invariant(workflow.history_policy?.ordinary_input_data_allowed === false, `${expectedId} ordinary inputs`);
  invariant(workflow.history_policy?.ordinary_output_data_allowed === false, `${expectedId} ordinary outputs`);
  invariant(workflow.history_policy?.secret_field_mapping_allowed === false, `${expectedId} secret mapping`);
  invariant(workflow.history_policy?.private_recipient_mapping_allowed === false, `${expectedId} recipient mapping`);
  invariant(workflow.trigger?.catch_hook_allowed === false, `${expectedId} Catch Hook`);
  invariant(Array.isArray(workflow.steps) && workflow.steps.length >= 3, `${expectedId} steps`);
  exactArray(workflow.steps.map(({ order }) => order),
    workflow.steps.map((_, index) => index + 1), `${expectedId} step order`);
  invariant(step(workflow, 'off_guard').configured_value === false, `${expectedId} OFF guard`);
  invariant(workflow.steps.every(({ provider_action }) => provider_action === false),
    `${expectedId} provider action must stay false`);
  invariant(Array.isArray(workflow.secret_environment_names) && workflow.secret_environment_names.length > 0,
    `${expectedId} secret environment names`);
  invariant(workflow.secret_environment_names.every((name) =>
    typeof name === 'string' && /^[A-Z][A-Z0-9_]{7,127}$/.test(name)), `${expectedId} secret names`);
  invariant(Array.isArray(workflow.source_contracts) && workflow.source_contracts.length > 0,
    `${expectedId} source contracts`);
  invariant(Array.isArray(workflow.activation_evidence_required) && workflow.activation_evidence_required.length > 0,
    `${expectedId} activation evidence`);
  invariant(Array.isArray(workflow.blocking_reasons) && workflow.blocking_reasons.length > 0,
    `${expectedId} blockers`);
  assertNoCredentialValues(JSON.stringify(workflow), expectedId);
  validateSemanticOffControls(workflow, expectedId);
}

function validateEmail(workflow) {
  const claim = step(workflow, 'claim_next');
  invariant(claim.request.path === '/api/internal/review-email/reserve', 'email claim path');
  invariant(JSON.stringify(claim.request.body) === JSON.stringify({ claim_next: true }), 'email claim body');
  invariant(claim.request.authentication === 'arc-preview-review-email-internal-request-signature-v1',
    'email claim signature');
  const send = step(workflow, 'send_boundary');
  invariant(send.invoked_by_zapier === false, 'email send boundary');
  invariant(send.component === 'arc-site/netlify/functions/transactional-email-worker.mjs',
    'email first-party sender');
  const ack = step(workflow, 'delivery_ack');
  invariant(ack.request.path === '/api/internal/review-email/ack', 'email ack path');
  exactArray(ack.request.exact_body_fields,
    ['delivery_receipt_evidence', 'delivery_receipt_evidence_hmac_sha256'], 'email ack fields');
  invariant(ack.accepted_send_response_is_delivery_proof === false, 'email delivery proof');
  invariant(workflow.forbidden_components.includes('Gmail send'), 'email Gmail prohibition');
}

function validateRevision(workflow) {
  const claim = step(workflow, 'claim_next');
  invariant(claim.request.path === '/api/internal/review-revision/claim', 'revision claim path');
  invariant(JSON.stringify(claim.request.body) === JSON.stringify({ cursor: null }), 'revision claim body');
  const pipeline = step(workflow, 'immutable_revision_pipeline');
  invariant(pipeline.direct_main_publish_allowed === false, 'revision direct main push');
  const complete = step(workflow, 'complete');
  invariant(complete.request.path === '/api/internal/review-revision/complete', 'revision complete path');
  exactArray(complete.request.exact_body_fields, [
    'artifact_evidence', 'invite_reservation', 'lease_token', 'successor_commit_sha',
    'successor_manifest_sha256', 'successor_repository', 'work_hmac_sha256',
  ], 'revision complete fields');
  invariant(workflow.retry_contract.timeout_marks_complete === false, 'revision timeout completion');
  invariant(workflow.retry_contract.changed_replay_allowed === false, 'revision changed replay');
}

function validatePayment(workflow) {
  invariant(workflow.controls.arc2_checkout_session_adapter_enabled === false, 'ARC2 adapter gate');
  invariant(workflow.controls.payment_arc2_start_enabled === false, 'ARC2 start gate');
  invariant(workflow.controls.stripe_live_mode_enabled === false, 'ARC2 live gate');
  const claim = step(workflow, 'claim_next');
  invariant(claim.request.path === '/internal/payment-arc2/claim', 'ARC2 claim path');
  exactArray(claim.request.exact_body_fields, ['claim_token'], 'ARC2 claim fields');
  invariant(claim.claim_token.minimum_bytes >= 32 && claim.claim_token.visibility === 'private',
    'ARC2 claim token');
  const adapter = step(workflow, 'artifact_adapter');
  invariant(adapter.component === 'zapier/arc2_checkout_session_artifact_adapter.js', 'ARC2 adapter source');
  invariant(adapter.start_request.path === '/internal/payment-arc2/start', 'ARC2 start path');
  exactArray(adapter.start_request.exact_body_fields, [
    'artifact_evidence', 'artifact_evidence_hmac_sha256', 'checkout_session_id', 'claim_token',
    'deploy_artifacts', 'lead_notification_email', 'lead_route_recipient_hmac_sha256', 'outbox_key',
  ], 'ARC2 start fields');
  const reversal = step(workflow, 'reversal_control');
  invariant(reversal.first_start_expected_status === 202, 'ARC2 first start status');
  invariant(reversal.identical_start_replay_required === true, 'ARC2 identical start replay');
  invariant(workflow.retry_contract.http_202_means_complete === false, 'ARC2 202 completion');
  invariant(workflow.retry_contract.automatic_provider_replay_allowed === false, 'ARC2 provider replay');
  const complete = step(workflow, 'complete');
  invariant(complete.request.path === '/internal/payment-arc2/complete', 'ARC2 complete path');
  exactArray(complete.request.exact_body_fields, ['claim_token', 'completion', 'outbox_key'],
    'ARC2 complete fields');
  exactArray(complete.request.exact_completion_fields, [
    'accepted', 'arc2_start_receipt', 'arc2_start_receipt_hmac_sha256',
    'immutable_binding_sha256', 'schema',
  ], 'ARC2 completion receipt fields');
}

function validateRevocation(workflow) {
  invariant(workflow.controls.ARC_STRIPE_REVIEW_REVOCATION_ENABLED === false, 'revocation runtime gate');
  invariant(workflow.controls.automatic_refund_enabled === false, 'automatic refund');
  invariant(workflow.controls.automatic_dispute_action_enabled === false, 'automatic dispute action');
  const revoke = step(workflow, 'revoke_bound_open_sessions');
  invariant(revoke.claim_next_path === null, 'revocation claim path must remain explicit gap');
  invariant(revoke.external_worker_endpoint === null, 'revocation endpoint must remain explicit gap');
  invariant(revoke.action === 'first_party_only', 'revocation authority');
  invariant(workflow.revocation_contract.automatic_refund_allowed === false, 'revocation refund contract');
  invariant(workflow.revocation_contract.suppression_ack_before_revocation_complete_allowed === false,
    'revocation acknowledgement ordering');
}

export function validatePausedWorkflowDraft(workflow, expectedId) {
  validateCommon(workflow, expectedId);
  if (expectedId === 'arc1-review-email') validateEmail(workflow);
  else if (expectedId === 'arc1-review-revision') validateRevision(workflow);
  else if (expectedId === 'arc2-payment-start') validatePayment(workflow);
  else if (expectedId === 'review-checkout-revocation') validateRevocation(workflow);
  else invariant(false, `${expectedId} is not an expected workflow`);
  return true;
}

export function validatePausedDraftIndex(value) {
  invariant(value.schema === 'arc-zapier-v11-paused-draft-index-v1', 'index schema');
  invariant(value.configuration_state === 'blocked-paused', 'index state');
  invariant(value.published === false && value.enabled === false, 'index OFF state');
  invariant(value.provider_mutation_allowed === false, 'index provider mutation');
  invariant(value.legacy_hook_replay_allowed === false, 'index legacy replay');
  invariant(value.secret_values_present === false, 'index secret values');
  invariant(value.global_requirements?.maximum_concurrency_per_workflow === 1, 'index concurrency');
  invariant(value.global_requirements?.task_history_policy === 'private-integration-redacted',
    'index history policy');
  invariant(value.global_requirements?.ordinary_field_secret_mapping_allowed === false,
    'index ordinary secret mapping');
  invariant(value.global_requirements?.ordinary_task_history_private_payload_allowed === false,
    'index ordinary payload history');
  invariant(value.global_requirements?.automatic_replay_allowed === false, 'index replay');
  invariant(value.global_requirements?.gmail_customer_delivery_allowed === false, 'index Gmail');
  invariant(value.global_requirements?.stripe_payment_link_allowed === false, 'index Payment Link');
  invariant(Array.isArray(value.activation_blockers) && value.activation_blockers.length >= 6,
    'index blockers');
  assertNoCredentialValues(JSON.stringify(value), 'index');
  validateSemanticOffControls(value, 'index');
  return true;
}

export function validatePausedDraftWiringSection(value) {
  invariant(plainObject(value), 'wiring paused draft section');
  invariant(value.index === INDEX_PATH, 'wiring index');
  invariant(value.validator === 'scripts/validate_zapier_v11_drafts.mjs', 'wiring validator');
  invariant(value.test === 'tests/zapier_v11_draft_blueprints_contract.mjs', 'wiring test');
  invariant(value.runbook === 'zapier/v11-paused-draft-runbook.md', 'wiring runbook');
  invariant(value.offline_recipe_complete === true, 'wiring offline recipe');
  invariant(value.maximum_concurrency === 1, 'wiring concurrency');
  invariant(value.history_redaction_required === true, 'wiring history redaction requirement');
  invariant(value.first_party_synchronous_ack_adapter_required === true,
    'wiring first-party synchronous ACK boundary');
  invariant(value.zapier_catch_hook_is_synchronous_ack_authority === false,
    'wiring Catch Hook authority');
  validateSemanticOffControls(value, 'wiring.paused_draft_blueprints');
  return true;
}

export async function validateZapierV11Drafts() {
  const index = await readJson(INDEX_PATH);
  const value = index.value;
  validatePausedDraftIndex(value);

  const expectedIds = [
    'arc1-review-email',
    'arc1-review-revision',
    'arc2-payment-start',
    'review-checkout-revocation',
  ];
  exactArray(value.workflows.map(({ id }) => id), expectedIds, 'workflow index');

  const receipts = [];
  for (const entry of value.workflows) {
    invariant(entry.path === `zapier/drafts/${entry.id}.json`, `${entry.id} path`);
    const document = await readJson(entry.path);
    validatePausedWorkflowDraft(document.value, entry.id);
    for (const source of document.value.source_contracts) {
      invariant(typeof source === 'string' && !path.isAbsolute(source) && !source.includes('..'),
        `${entry.id} source path`);
      await access(path.join(REPOSITORY_ROOT, source));
    }
    receipts.push(Object.freeze({ path: entry.path, sha256: sha256(document.raw) }));
  }

  const wiring = await readJson('zapier/wiring-contract.json');
  validatePausedDraftWiringSection(wiring.value.paused_draft_blueprints);

  const credentialScanReceipts = [];
  for (const artifactPath of ARTIFACT_PATHS) {
    const raw = await readFile(path.join(REPOSITORY_ROOT, artifactPath), 'utf8');
    assertNoCredentialValues(raw, artifactPath);
    credentialScanReceipts.push(Object.freeze({ path: artifactPath, sha256: sha256(raw) }));
  }

  const indexSha256 = sha256(index.raw);
  invariant(HEX_64.test(indexSha256) && receipts.every(({ sha256: digest }) => HEX_64.test(digest)),
    'draft digest');
  return Object.freeze({
    schema: 'arc-zapier-v11-paused-draft-validation-v1',
    status: 'ARC_ZAPIER_V11_DRAFTS_VALIDATED',
    configuration_state: 'blocked-paused',
    provider_mutation_allowed: false,
    index_sha256: indexSha256,
    workflow_receipts: Object.freeze(receipts),
    credential_scan_receipts: Object.freeze(credentialScanReceipts),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const result = await validateZapierV11Drafts();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
