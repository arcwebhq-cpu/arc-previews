import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_SCHEMA,
  ARC1_PREVIEW_ASYNC_READBACK_SCHEMA,
  arc1PreviewCanonicalJson,
  authorizeArc1PreviewAsyncOperation,
  deriveArc1PreviewAsyncWorkflowId,
  prepareArc1PreviewAsyncOperation,
  resumeArc1PreviewAsyncOrchestration,
  startArc1PreviewAsyncOrchestration,
} from "../scripts/arc1_preview_async_orchestrator.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const baseMs = Date.now();
const iso = offset => new Date(baseMs + offset).toISOString();
const clockAt = offset => () => baseMs + offset;
const secretMarker = "PRIVATE-ASYNC-SECRET-MUST-NEVER-ENTER-LOGS";
const readbackKeys = generateKeyPairSync("ed25519");
const stageReceiptKeys = Object.freeze({
  github: generateKeyPairSync("ed25519"),
  pages: generateKeyPairSync("ed25519"),
  email: generateKeyPairSync("ed25519"),
  review: generateKeyPairSync("ed25519"),
  checkout: generateKeyPairSync("ed25519"),
});
const publicPem = key => key.export({ type: "spki", format: "pem" });
const signRaw = (key, raw) => sign(null, Buffer.from(raw, "utf8"), key).toString("base64url");
const stageSigner = Object.freeze({
  PR_CREATED: Object.freeze({ issuer: "github", keyId: "gh01" }),
  PR_CHECK_PASSED: Object.freeze({ issuer: "github", keyId: "gh01" }),
  MERGE_CONFIRMED: Object.freeze({ issuer: "github", keyId: "gh01" }),
  PAGES_EXACT_BYTES_VERIFIED: Object.freeze({ issuer: "pages", keyId: "pg01" }),
  PREVIEW_EMAIL_DELIVERED: Object.freeze({ issuer: "email", keyId: "em01" }),
  CUSTOMER_APPROVAL_VERIFIED: Object.freeze({ issuer: "review", keyId: "rv01" }),
  PRIVATE_CHECKOUT_AUTHORIZED: Object.freeze({ issuer: "checkout", keyId: "co01" }),
});
const stateSecret = `${secretMarker}-state-0123456789`;
const env = {
  ARC1_PREVIEW_ASYNC_ORCHESTRATOR_ENABLED: "true",
  ARC1_PREVIEW_ASYNC_PRIVATE_STATE_ENABLED: "true",
  ARC1_PREVIEW_ASYNC_PROVIDER_ACTIONS_ENABLED: "true",
  ARC1_PREVIEW_ASYNC_HISTORY_REDACTION_ATTESTED: "true",
  ARC1_PREVIEW_ASYNC_STATE_CURRENT_KEY_ID: "sk01",
  ARC1_PREVIEW_ASYNC_STATE_KEYRING_JSON: arc1PreviewCanonicalJson({ sk01: stateSecret }),
  ARC1_PREVIEW_ASYNC_READBACK_PUBLIC_KEYRING_JSON: arc1PreviewCanonicalJson({
    rb01: { issuer: "private-state", public_key_pem: publicPem(readbackKeys.publicKey) },
  }),
  ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_PUBLIC_KEYRING_JSON: arc1PreviewCanonicalJson({
    co01: { issuer: "checkout", public_key_pem: publicPem(stageReceiptKeys.checkout.publicKey) },
    em01: { issuer: "email", public_key_pem: publicPem(stageReceiptKeys.email.publicKey) },
    gh01: { issuer: "github", public_key_pem: publicPem(stageReceiptKeys.github.publicKey) },
    pg01: { issuer: "pages", public_key_pem: publicPem(stageReceiptKeys.pages.publicKey) },
    rv01: { issuer: "review", public_key_pem: publicPem(stageReceiptKeys.review.publicKey) },
  }),
};
const disabledProviderEnv = { ...env, ARC1_PREVIEW_ASYNC_PROVIDER_ACTIONS_ENABLED: "false" };
const artifactSha256 = "b".repeat(64);
const validationReceiptSha256 = "c".repeat(64);
const workflowId = deriveArc1PreviewAsyncWorkflowId({ artifactSha256, validationReceiptSha256 }, env);

const source = await readFile(new URL("../scripts/arc1_preview_async_orchestrator.mjs", import.meta.url), "utf8");
const staticImports = [...source.matchAll(/(?:^|\n)\s*import[\s\S]*?from\s+["']([^"']+)["'];/g)].map(match => match[1]).sort();
assert.deepEqual(staticImports, ["node:crypto"], "The coordinator may import only the cryptographic standard library.");
assert.doesNotMatch(source,
  /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b|\bimport\s*\(|\brequire\s*\(|node:(?:http|https|http2|net|tls|dns|dgram|worker_threads)|https?:\/\//i,
  "The coordinator must remain provider-neutral and zero-network.");
assert.doesNotMatch(source, /inputData|process\.env/, "Secrets and switches must be injected by the host, not ordinary task fields.");
assert.doesNotMatch(source, /export function createArc1PreviewAsync(?:StateReadback|StageReceipt)/,
  "The runtime must verify provider evidence but cannot mint its own durability or stage receipts.");

await assert.rejects(async () => startArc1PreviewAsyncOrchestration({
  workflowId,
  artifactSha256,
  validationReceiptSha256,
  createdAt: iso(-1_000),
  expiresAt: iso(2 * 24 * 60 * 60_000),
}, {}, { clock: clockAt(0) }), /ORCHESTRATOR_DISABLED/);

for (const switchName of [
  "ARC1_PREVIEW_ASYNC_ORCHESTRATOR_ENABLED",
  "ARC1_PREVIEW_ASYNC_PRIVATE_STATE_ENABLED",
  "ARC1_PREVIEW_ASYNC_HISTORY_REDACTION_ATTESTED",
]) {
  await assert.rejects(async () => startArc1PreviewAsyncOrchestration({
    workflowId,
    artifactSha256,
    validationReceiptSha256,
    createdAt: iso(-1_000),
    expiresAt: iso(2 * 24 * 60 * 60_000),
  }, { ...env, [switchName]: "false" }, { clock: clockAt(0) }), /DISABLED|NOT_ATTESTED/);
}

const durableStore = new Map();
let providerRecordVersion = 0;
let nowOffset = 0;

function persist(result) {
  assert.equal(result.logSafe.provider_action_allowed, false);
  assert.equal(result.logSafe.persistence_required, true);
  assert.doesNotMatch(result.logSafeJson, new RegExp(secretMarker));
  const operation = result.persistence;
  const existing = durableStore.get(operation.stateKey);
  if (operation.mode === "CREATE_OR_EXACT") {
    if (existing) {
      assert.equal(existing.stateSha256, operation.stateSha256);
      assert.equal(existing.stateRaw, operation.stateRaw);
    }
  } else if (existing?.stateSha256 !== operation.stateSha256) {
    assert.ok(existing, "CAS requires a durable predecessor");
    assert.equal(existing.stateSha256, operation.expectedPreviousStateSha256);
  }
  providerRecordVersion += 1;
  durableStore.set(operation.stateKey, {
    stateRaw: operation.stateRaw,
    stateSha256: operation.stateSha256,
    stateHmacSha256: operation.stateHmacSha256,
    providerRecordVersion,
  });
  return durableStore.get(operation.stateKey);
}

function current() {
  const value = durableStore.get(`arc1-preview-async-v1:${workflowId}`);
  assert.ok(value);
  return value;
}

function signedReadbackFor(value, offset = nowOffset, { authorize = false } = {}) {
  const state = JSON.parse(value.stateRaw);
  const leaseId = authorize ? sha256(`authorization-lease:${value.stateSha256}:${value.providerRecordVersion}`) : null;
  const receipt = {
    schema: ARC1_PREVIEW_ASYNC_READBACK_SCHEMA,
    scope: "authoritative-private-state-exact-readback",
    issuer: "private-state",
    issuer_key_id: "rb01",
    purpose: authorize ? "AUTHORIZE_OPERATION" : "STATE_READBACK",
    operation_intent_sha256: authorize ? state.operation_intent_sha256 : null,
    authorization_lease_id_sha256: leaseId,
    authorization_lease_expires_at: authorize ? iso(offset + 30_000) : null,
    state_key: `arc1-preview-async-v1:${state.workflow_id}`,
    workflow_id: state.workflow_id,
    state_sha256: value.stateSha256,
    providerRecordVersion: value.providerRecordVersion,
    readback_at: iso(offset),
  };
  receipt.provider_record_version = receipt.providerRecordVersion;
  delete receipt.providerRecordVersion;
  const raw = arc1PreviewCanonicalJson(receipt);
  return { receipt, raw, signatureBase64url: signRaw(readbackKeys.privateKey, raw) };
}

function readback(offset = nowOffset) {
  return signedReadbackFor(current(), offset);
}

function applyStage(stage, providerLabel, offset) {
  nowOffset = offset;
  const before = current();
  const durableReadback = readback(offset);
  const state = JSON.parse(before.stateRaw);
  const signer = stageSigner[stage] || { issuer: "pages", keyId: "pg01" };
  const mutatingStage = new Set(["PR_CREATED", "MERGE_CONFIRMED", "PRIVATE_CHECKOUT_AUTHORIZED", "PREVIEW_EMAIL_DELIVERED"]).has(stage);
  const receiptObject = {
    schema: ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_SCHEMA,
    scope: "authenticated-provider-stage-success",
    issuer: signer.issuer,
    issuer_key_id: signer.keyId,
    workflow_id: state.workflow_id,
    artifact_sha256: state.artifact_sha256,
    stage,
    outcome: "SUCCEEDED",
    prior_state_sha256: before.stateSha256,
    operation_intent_sha256: mutatingStage ? state.operation_intent_sha256 : null,
    providerReceiptSha256: sha256(providerLabel),
    observed_at: iso(offset),
  };
  receiptObject.provider_receipt_sha256 = receiptObject.providerReceiptSha256;
  delete receiptObject.providerReceiptSha256;
  const receiptRaw = arc1PreviewCanonicalJson(receiptObject);
  const receipt = {
    receipt: receiptObject,
    raw: receiptRaw,
    sha256: sha256(receiptRaw),
    signatureBase64url: signRaw(stageReceiptKeys[signer.issuer].privateKey, receiptRaw),
  };
  const advanced = resumeArc1PreviewAsyncOrchestration({
    stateRaw: before.stateRaw,
    stateHmacSha256: before.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    stageReceiptRaw: receipt.raw,
    stageReceiptSignatureBase64url: receipt.signatureBase64url,
  }, env, { clock: clockAt(offset) });
  persist(advanced);
  return { before, receipt, advanced };
}

function prepareOperation(offset) {
  nowOffset = offset;
  const before = current();
  const durableReadback = readback(offset);
  const prepared = prepareArc1PreviewAsyncOperation({
    stateRaw: before.stateRaw,
    stateHmacSha256: before.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    preparedAt: iso(offset),
    providerRequestSha256: sha256(`provider-request:${JSON.parse(before.stateRaw).status}`),
  }, env, { clock: clockAt(offset) });
  assert.equal(prepared.logSafe.provider_action_allowed, false, "Persistence must precede provider authorization.");
  assert.ok(prepared.privateOperationIntent);
  persist(prepared);
  return prepared;
}

function authorizeOperation(offset, selectedEnv = env) {
  nowOffset = offset;
  const value = current();
  const durableReadback = signedReadbackFor(value, offset, { authorize: true });
  return authorizeArc1PreviewAsyncOperation({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
  }, selectedEnv, { clock: clockAt(offset) });
}

const started = startArc1PreviewAsyncOrchestration({
  workflowId,
  artifactSha256,
  validationReceiptSha256,
  createdAt: iso(-1_000),
  expiresAt: iso(2 * 24 * 60 * 60_000),
}, env, { clock: clockAt(0) });
assert.equal(started.status, "ARC1_ASYNC_STATE_PREPARED");
assert.equal(JSON.parse(started.persistence.stateRaw).status, "READY_PR_CREATE");
persist(started);

const prCreatePrepared = prepareOperation(100);
assert.equal(JSON.parse(current().stateRaw).status, "PR_CREATE_INTENT_PERSISTED");
const prCreateAuthorization = authorizeOperation(200);
assert.equal(prCreateAuthorization.privateAuthorization.action, "CREATE_IMMUTABLE_PREVIEW_PR");
assert.equal(prCreateAuthorization.status, "ARC1_ASYNC_PROVIDER_AUTHORIZATION_LEASE_ISSUED");
assert.equal(prCreateAuthorization.logSafe.provider_action_allowed, false);
assert.equal(prCreateAuthorization.logSafe.atomic_authorization_consumption_required, true);
assert.equal(prCreateAuthorization.privateAuthorization.providerActionAllowed, false);
assert.equal(prCreateAuthorization.privateAuthorization.atomicAuthorizationConsumptionRequired, true);
assert.equal(prCreateAuthorization.privateAuthorization.providerRequestSha256,
  prCreatePrepared.privateOperationIntent.intent.provider_request_sha256);
assert.match(prCreateAuthorization.privateAuthorization.authorizationReadbackSignatureBase64url, /^[A-Za-z0-9_-]{86}$/);
applyStage("PR_CREATED", "github-preview-pr-create-readback", 300);
assert.equal(JSON.parse(current().stateRaw).status, "WAITING_PR_CHECK");

// Stages cannot be skipped or reordered, even with a valid adapter signature.
assert.throws(() => applyStage("PAGES_EXACT_BYTES_VERIFIED", "early-pages", 500), /stage order or state binding/);

const prCheck = applyStage("PR_CHECK_PASSED", "github-check-run-success", 1_000);
assert.equal(JSON.parse(current().stateRaw).status, "READY_MERGE");

// A lost write acknowledgement is safely recoverable as exact-target success;
// a competing target from the same predecessor still conflicts.
persist(prCheck.advanced);
{
  const conflicting = {
    ...prCheck.advanced,
    persistence: {
      ...prCheck.advanced.persistence,
      stateRaw: `${prCheck.advanced.persistence.stateRaw} `,
      stateSha256: sha256(`${prCheck.advanced.persistence.stateRaw} `),
    },
  };
  assert.throws(() => persist(conflicting));
}

// Possession of coordinator state is not persistence evidence: the runtime has
// only the adapter's public key and rejects a self-asserted readback.
{
  const value = current();
  const unsigned = signedReadbackFor(value, 1_050);
  await assert.rejects(async () => prepareArc1PreviewAsyncOperation({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: unsigned.raw,
    stateReadbackSignatureBase64url: "A".repeat(86),
    preparedAt: iso(1_050),
  }, env, { clock: clockAt(1_050) }), /DURABILITY_REQUIRED/);
}

// An old timestamp cannot mint an already-expired intent after a long async
// pause, even when the state readback itself is fresh.
{
  const value = current();
  const resumedAt = 1_000 + 6 * 60_000;
  const durableReadback = signedReadbackFor(value, resumedAt);
  await assert.rejects(async () => prepareArc1PreviewAsyncOperation({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    preparedAt: iso(1_000),
    providerRequestSha256: sha256("stale-provider-request"),
  }, env, { clock: clockAt(resumedAt) }), /operation prepared_at/);
}

// Key rotation retains old state keys for in-flight verification, while the
// workflow identity stays stable because it is content-derived.
{
  const rotatedSecret = `${secretMarker}-rotated-state-0123456789`;
  const rotatedEnv = {
    ...env,
    ARC1_PREVIEW_ASYNC_STATE_CURRENT_KEY_ID: "sk02",
    ARC1_PREVIEW_ASYNC_STATE_KEYRING_JSON: arc1PreviewCanonicalJson({ sk01: stateSecret, sk02: rotatedSecret }),
  };
  assert.equal(deriveArc1PreviewAsyncWorkflowId({ artifactSha256, validationReceiptSha256 }, rotatedEnv), workflowId);
  const value = current();
  const durableReadback = signedReadbackFor(value, 1_900);
  const preparedAcrossRotation = prepareArc1PreviewAsyncOperation({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    preparedAt: iso(1_900),
    providerRequestSha256: sha256("rotation-provider-request"),
  }, rotatedEnv, { clock: clockAt(1_900) });
  assert.equal(JSON.parse(preparedAcrossRotation.persistence.stateRaw).state_key_id, "sk01");
}

// Small clock skew may allow a future-dated intent to be persisted, but it can
// never authorize provider work before its prepared_at instant.
{
  const value = current();
  const durableReadback = signedReadbackFor(value, 2_000);
  const futureIntent = prepareArc1PreviewAsyncOperation({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    preparedAt: iso(2_500),
    providerRequestSha256: sha256("future-provider-request"),
  }, env, { clock: clockAt(2_000) });
  const mockPersisted = {
    stateRaw: futureIntent.persistence.stateRaw,
    stateSha256: futureIntent.persistence.stateSha256,
    stateHmacSha256: futureIntent.persistence.stateHmacSha256,
    providerRecordVersion: 99,
  };
  const futureReadback = signedReadbackFor(mockPersisted, 2_500, { authorize: true });
  await assert.rejects(async () => authorizeArc1PreviewAsyncOperation({
    stateRaw: mockPersisted.stateRaw,
    stateHmacSha256: mockPersisted.stateHmacSha256,
    stateReadbackRaw: futureReadback.raw,
    stateReadbackSignatureBase64url: futureReadback.signatureBase64url,
  }, env, { clock: clockAt(2_200) }), /not active yet/);
}

// The exact same signed receipt is idempotent after its state was persisted.
{
  const value = current();
  const durableReadback = readback(1_100);
  const replay = resumeArc1PreviewAsyncOrchestration({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    stageReceiptRaw: prCheck.receipt.raw,
    stageReceiptSignatureBase64url: prCheck.receipt.signatureBase64url,
  }, env, { clock: clockAt(1_100) });
  assert.equal(replay.status, "ARC1_ASYNC_STAGE_ALREADY_APPLIED");
  assert.equal(replay.persistence, null);
}

const mergePrepared = prepareOperation(2_000);
assert.equal(JSON.parse(current().stateRaw).status, "MERGE_INTENT_PERSISTED");
assert.match(mergePrepared.privateOperationIntent.intent.idempotency_key, /^arc1op_[a-f0-9]{40}$/);

// Replaying preparation recovers the same durable intent rather than creating
// a second mutation key.
{
  const value = current();
  const durableReadback = readback(2_100);
  const replay = prepareArc1PreviewAsyncOperation({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    preparedAt: iso(2_100),
  }, env, { clock: clockAt(2_100) });
  assert.equal(replay.status, "ARC1_ASYNC_OPERATION_INTENT_ALREADY_PERSISTED");
  assert.equal(replay.privateOperationIntent.raw, mergePrepared.privateOperationIntent.raw);
}

await assert.rejects(async () => authorizeOperation(2_200, disabledProviderEnv), /PROVIDER_ACTIONS_DISABLED/);
{
  const value = current();
  const ordinaryReadback = readback(2_200);
  await assert.rejects(async () => authorizeArc1PreviewAsyncOperation({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: ordinaryReadback.raw,
    stateReadbackSignatureBase64url: ordinaryReadback.signatureBase64url,
  }, env, { clock: clockAt(2_200) }), /authorization lease|DURABILITY_REQUIRED/);
}
const mergeAuthorization = authorizeOperation(2_200);
assert.equal(mergeAuthorization.privateAuthorization.action, "MERGE_IMMUTABLE_PREVIEW_PR");
assert.equal(mergeAuthorization.privateAuthorization.idempotencyKey, mergePrepared.privateOperationIntent.intent.idempotency_key);
assert.match(mergeAuthorization.privateAuthorization.authorizationLeaseIdSha256, /^[a-f0-9]{64}$/);
assert.doesNotMatch(mergeAuthorization.logSafeJson, new RegExp(secretMarker));
assert.doesNotMatch(mergeAuthorization.logSafeJson, /idempotencyKey|stateRaw|Hmac/i);

applyStage("MERGE_CONFIRMED", "github-merge-readback", 3_000);
assert.equal(JSON.parse(current().stateRaw).status, "WAITING_PAGES_EXACT_BYTES");
applyStage("PAGES_EXACT_BYTES_VERIFIED", "pages-five-route-byte-readback", 4_000);
assert.equal(JSON.parse(current().stateRaw).status, "READY_PREVIEW_EMAIL_DELIVERY");

const emailPrepared = prepareOperation(5_000);
const emailAuthorization = authorizeOperation(5_100);
assert.equal(emailAuthorization.privateAuthorization.action, "SEND_PRIVATE_PREVIEW_EMAIL");
assert.equal(emailAuthorization.privateAuthorization.providerRequestSha256,
  emailPrepared.privateOperationIntent.intent.provider_request_sha256);
assert.notEqual(emailAuthorization.privateAuthorization.idempotencyKey, mergeAuthorization.privateAuthorization.idempotencyKey);
assert.equal(emailPrepared.logSafe.provider_action_allowed, false);
const emailDelivery = applyStage("PREVIEW_EMAIL_DELIVERED", "authenticated-provider-delivered-webhook", 6_000);
assert.equal(JSON.parse(current().stateRaw).status, "WAITING_CUSTOMER_APPROVAL");

// Email delivery never creates or exposes checkout. A separately authenticated
// APPROVE_AND_PAY decision is mandatory first.
await assert.rejects(async () => prepareOperation(6_100), /no provider operation is ready/);

// The GitHub attestor cannot mint a customer approval; issuers and key IDs are
// stage-specific even though all receipts share one structural schema.
{
  const value = current();
  const state = JSON.parse(value.stateRaw);
  const wrongIssuerReceipt = arc1PreviewCanonicalJson({
    schema: ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_SCHEMA,
    scope: "authenticated-provider-stage-success",
    issuer: "review",
    issuer_key_id: "gh01",
    workflow_id: state.workflow_id,
    artifact_sha256: state.artifact_sha256,
    stage: "CUSTOMER_APPROVAL_VERIFIED",
    outcome: "SUCCEEDED",
    prior_state_sha256: value.stateSha256,
    operation_intent_sha256: null,
    provider_receipt_sha256: sha256("forged-approval"),
    observed_at: iso(6_500),
  });
  const durableReadback = signedReadbackFor(value, 6_500);
  await assert.rejects(async () => resumeArc1PreviewAsyncOrchestration({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    stageReceiptRaw: wrongIssuerReceipt,
    stageReceiptSignatureBase64url: signRaw(stageReceiptKeys.github.privateKey, wrongIssuerReceipt),
  }, env, { clock: clockAt(6_500) }), /stage receipt/);
}
applyStage("CUSTOMER_APPROVAL_VERIFIED", "private-review-approve-and-pay-decision", 7_000);
assert.equal(JSON.parse(current().stateRaw).status, "READY_PRIVATE_CHECKOUT_AUTHORIZATION");

const checkoutPrepared = prepareOperation(8_000);
const checkoutAuthorization = authorizeOperation(8_100);
assert.equal(checkoutAuthorization.privateAuthorization.action, "AUTHORIZE_PRIVATE_CHECKOUT_FOR_APPROVED_PREVIEW");
assert.notEqual(checkoutAuthorization.privateAuthorization.idempotencyKey, emailAuthorization.privateAuthorization.idempotencyKey);
assert.doesNotMatch(checkoutPrepared.privateOperationIntent.raw, /buy\.stripe\.com|plink_|client_reference_id/i);
const checkoutCompletion = applyStage("PRIVATE_CHECKOUT_AUTHORIZED", "private-checkout-readiness-authorization", 9_000);
assert.equal(checkoutCompletion.advanced.status, "ARC1_ASYNC_ORCHESTRATION_COMPLETED");
const terminal = JSON.parse(current().stateRaw);
assert.equal(terminal.status, "COMPLETE");
assert.equal(terminal.completed_stage_count, 7);
assert.equal(terminal.revision, 11);
assert.equal(terminal.operation_intent_sha256, null);

// A signed receipt still cannot bind to the wrong current state digest.
{
  const value = current();
  const durableReadback = readback(9_100);
  const parsed = JSON.parse(checkoutCompletion.receipt.raw);
  parsed.prior_state_sha256 = "d".repeat(64);
  const raw = arc1PreviewCanonicalJson(parsed);
  const signatureBase64url = signRaw(stageReceiptKeys.checkout.privateKey, raw);
  await assert.rejects(async () => resumeArc1PreviewAsyncOrchestration({
    stateRaw: value.stateRaw,
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: durableReadback.raw,
    stateReadbackSignatureBase64url: durableReadback.signatureBase64url,
    stageReceiptRaw: raw,
    stageReceiptSignatureBase64url: signatureBase64url,
  }, env, { clock: clockAt(9_100) }), /stage order or state binding/);
}

// Tampering and a readback for any state other than the exact current bytes
// both stop before provider authorization.
{
  const value = current();
  const tampered = JSON.parse(value.stateRaw);
  tampered.artifact_sha256 = "e".repeat(64);
  await assert.rejects(async () => authorizeArc1PreviewAsyncOperation({
    stateRaw: arc1PreviewCanonicalJson(tampered),
    stateHmacSha256: value.stateHmacSha256,
    stateReadbackRaw: readback(9_200).raw,
    stateReadbackSignatureBase64url: readback(9_200).signatureBase64url,
  }, env, { clock: clockAt(9_200) }), /state HMAC/);
}

// Expiration becomes manual review; it is never silently reset or reassigned.
{
  const expiringWorkflow = `arc1preview_${"f".repeat(40)}`;
  const expiring = startArc1PreviewAsyncOrchestration({
    artifactSha256,
    validationReceiptSha256: "f".repeat(64),
    createdAt: iso(0),
    expiresAt: iso(10_000),
  }, env, { clock: clockAt(0) });
  assert.notEqual(JSON.parse(expiring.persistence.stateRaw).workflow_id, expiringWorkflow);
  await assert.rejects(async () => prepareArc1PreviewAsyncOperation({
    stateRaw: expiring.persistence.stateRaw,
    stateHmacSha256: expiring.persistence.stateHmacSha256,
    stateReadbackRaw: "{}",
    stateReadbackSignatureBase64url: "A".repeat(86),
    preparedAt: iso(11_000),
  }, env, { clock: clockAt(11_000) }), /REVIEW_REQUIRED/);
}

assert.doesNotMatch(JSON.stringify({
  started: started.logSafe,
  terminal: checkoutCompletion.advanced.logSafe,
  prCreate: prCreateAuthorization.logSafe,
  merge: mergeAuthorization.logSafe,
  checkout: checkoutAuthorization.logSafe,
  email: emailAuthorization.logSafe,
}), new RegExp(secretMarker));

console.log("ARC1 async preview orchestrator contract passed: durable CAS state authorizes PR creation, then resumes through check, merge, Pages bytes, delivered preview email, customer approval, and private checkout with all provider actions default-OFF.");
