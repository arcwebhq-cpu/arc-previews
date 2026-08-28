import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createArc1ConsumerStateCommitReceipt,
  createArc1ConsumerStateCreateReceipt,
} from "../scripts/arc1_consumer_runtime.mjs";

const configuredSiteRoot = path.resolve(process.env.ARC_SITE_DIR || "../arc-site");
const configuredBuildIdentity = await readFile(path.join(configuredSiteRoot, "netlify/lib/activation-build-identity.mjs"), "utf8");
let activationDeploymentSha = configuredBuildIdentity.match(/"deployment_sha"\s*:\s*"([a-f0-9]{40})"/)?.[1] || "";
let temporarySiteRoot = "";
let siteRoot = configuredSiteRoot;
if (!activationDeploymentSha) {
  temporarySiteRoot = await mkdtemp(path.join(os.tmpdir(), "arc-site-contract-"));
  await cp(path.join(configuredSiteRoot, "netlify/lib"), path.join(temporarySiteRoot, "netlify/lib"), { recursive: true });
  await symlink(path.join(configuredSiteRoot, "node_modules"), path.join(temporarySiteRoot, "node_modules"), "dir");
  activationDeploymentSha = "9".repeat(40);
  await writeFile(path.join(temporarySiteRoot, "netlify/lib/activation-build-identity.mjs"),
    `// Test-only copy; production source remains untouched and default-off.\nexport const ACTIVATION_BUILD_IDENTITY = Object.freeze({\n  "schema": "arc-activation-build-identity-v1",\n  "version": 1,\n  "deployment_sha": "${activationDeploymentSha}"\n});\n`);
  siteRoot = temporarySiteRoot;
}
const siteModule = relative => import(pathToFileURL(path.join(siteRoot, relative)).href);
const [activationCore, adapterCore, bridgeCore, submissionCore, verificationCore] = await Promise.all([
  siteModule("netlify/lib/activation-manifest-core.mjs"),
  siteModule("netlify/lib/intake-arc1-adapter-core.mjs"),
  siteModule("netlify/lib/intake-arc1-bridge-core.mjs"),
  siteModule("netlify/lib/intake-submission-core.mjs"),
  siteModule("netlify/lib/intake-email-verification-core.mjs"),
]);
const {
  acceptArc1AdapterEnvelope,
  claimArc1AdapterConsumer,
  completeArc1AdapterConsumer,
  dispatchArc1AdapterRecord,
  validateArc1AdapterRecord,
} = adapterCore;
const {
  INTAKE_ARC1_CONSUMER_SCHEMA,
  INTAKE_ARC1_CONTRACT_SHA256,
  createAdapterAttestation,
  deliverIntakeToArc1,
} = bridgeCore;
const { BUDGET_CONFIRMATION, OFFER_CONTRACT_ID, TERMS_CONFIRMATION, normalizeIntakeForm } = submissionCore;
const { consumeIntakeEmailVerificationToken, reserveIntakeEmailVerification } = verificationCore;
const { ACTIVATION_EVIDENCE_BY_STAGE, ACTIVATION_MANIFEST_SCHEMA, ACTIVATION_MANIFEST_VERSION, signActivationManifest } = activationCore;

class FakeStore {
  constructor() { this.values = new Map(); this.sequence = 0; }
  async getWithMetadata(key) {
    const current = this.values.get(key);
    return current ? { data: structuredClone(current.data), etag: current.etag } : null;
  }
  async setJSON(key, data, options = {}) {
    const current = this.values.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    if (options.onlyIfMatch && !current) return { modified: false };
    const etag = `etag-${++this.sequence}`;
    this.values.set(key, { data: structuredClone(data), etag });
    return { modified: true, etag };
  }
  async delete(key) { this.values.delete(key); }
  list({ prefix }) {
    const keys = [...this.values.keys()].filter(key => key.startsWith(prefix)).sort();
    return { async *[Symbol.asyncIterator]() { yield { blobs: keys.map(key => ({ key })) }; } };
  }
}

const sha256 = value => createHash("sha256").update(value).digest("hex");
const baseTime = new Date(Date.now() - 60_000);
const submissionId = "33333333-3333-4333-8333-333333333333";
const form = new FormData();
for (const [field, value] of Object.entries({
  intake_version: "arc-intake-v8",
  offer_contract_id: OFFER_CONTRACT_ID,
  name: "Cross Repo Private Owner",
  email: "cross-repo-owner@example.test",
  business: "Cross Repo Roofing",
  industry: "Roofing",
  city: "Everett, WA",
  main_services: "Roof replacement",
  main_call_to_action: "Request Estimate",
  budget_confirmed: BUDGET_CONFIRMATION,
  terms_accepted: TERMS_CONFIRMATION,
  lead_form_needed: "Yes",
  lead_notification_email: "cross-repo-owner@example.test",
  primary_style: "Modern",
  asset_permission: "Confirmed rights and no visible watermark v1",
  "bot-field": "",
})) form.append(field, value);
form.append("goals", "More calls");
form.append("lead_form_fields", "Email");
form.append("sections", "Contact or quote form");
const normalized = await normalizeIntakeForm(form, baseTime, () => submissionId);

const env = {
  ARC_INTAKE_ARC1_ADAPTER_ENABLED: "true",
  ARC_INTAKE_ARC1_BRIDGE_ENABLED: "true",
  ARC_INTAKE_ARC1_DOWNSTREAM_ENABLED: "true",
  ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: "true",
  ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED: "true",
  ARC_INTAKE_ARC1_LEGACY_MIGRATION_ENABLED: "false",
  ARC_INTAKE_ASSET_RETRIEVAL_ENABLED: "true",
  ARC_INTAKE_ARC1_ENDPOINT: "https://arcweb.onl/internal/intake/arc1/adapter",
  ARC_INTAKE_ARC1_DOWNSTREAM_ENDPOINT: "https://hooks.zapier.com/hooks/catch/123456/abcde_12345/",
  ARC_INTAKE_ARC1_RUN_SECRET: "cross-run-secret-unique-0123456789-abcdefgh",
  ARC_INTAKE_ARC1_DESTINATION_BEARER: "cross-destination-bearer-unique-0123456789",
  ARC_INTAKE_ARC1_EVIDENCE_SECRET: "cross-evidence-secret-unique-0123456789-abcdef",
  ARC_INTAKE_ARC1_ACK_SECRET: "cross-ack-secret-unique-0123456789-abcdefghij",
  ARC_INTAKE_ARC1_STATE_SECRET: "cross-state-secret-unique-0123456789-abcdefgh",
  ARC_INTAKE_ARC1_ADAPTER_PROOF_SECRET: "cross-proof-secret-unique-0123456789-abcdefgh",
  ARC_INTAKE_ASSET_RETRIEVAL_SECRET: "cross-asset-retrieval-secret-unique-0123456789",
  ARC1_ASSET_RECEIPT_SECRET: "cross-asset-receipt-secret-unique-0123456789-ab",
  ARC1_INTAKE_EVIDENCE_SECRET: "cross-intake-evidence-secret-unique-0123456789",
  ARC_INTAKE_ARC1_DOWNSTREAM_BEARER: "cross-downstream-bearer-unique-0123456789-ab",
  ARC_INTAKE_ARC1_DISPATCH_SECRET: "cross-adapter-dispatch-secret-unique-0123456789",
  ARC_INTAKE_ARC1_PACKET_SECRET: "cross-packet-secret-unique-0123456789-abcdefgh",
  ARC_INTAKE_ARC1_CONSUMER_BEARER: "cross-consumer-bearer-unique-0123456789-abcdef",
  ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET: "cross-consumer-receipt-secret-unique-0123456789",
  ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET: "cross-durable-result-secret-unique-0123456789",
  ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS: "1000",
  ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED: "true",
  ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED: "true",
  ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED: "true",
  ARC_INTAKE_EMAIL_VERIFICATION_ENABLED: "true",
  ARC_INTAKE_EMAIL_VERIFICATION_STATE_SECRET: "cross-verification-state-secret-unique-0123456789",
  ARC_INTAKE_EMAIL_VERIFICATION_TOKEN_SECRET: "cross-verification-token-secret-unique-0123456789",
  ARC_INTAKE_EMAIL_VERIFICATION_RECIPIENT_SECRET: "cross-verification-recipient-secret-unique-012345",
  ARC_INTAKE_EMAIL_VERIFICATION_ARC1_RELEASE_SECRET: "cross-verification-release-secret-unique-01234567",
  ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED: "true",
  ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED: "false",
  SITE_ID: "8f9d462c-952f-42fc-a3a0-50a2529e8f5d",
  ARC_EXPECTED_NETLIFY_SITE_ID: "8f9d462c-952f-42fc-a3a0-50a2529e8f5d",
  SITE_NAME: "arcsites",
  URL: "https://arcweb.onl",
};
const activationManifestSecret = "cross-activation-manifest-secret-unique-0123456789";
const activationManifest = signActivationManifest({
  schema: ACTIVATION_MANIFEST_SCHEMA,
  version: ACTIVATION_MANIFEST_VERSION,
  stage: "PUBLIC_INTAKE",
  authority_mode: "ROLLOUT",
  issued_at: new Date(baseTime.getTime() - 60_000).toISOString(),
  expires_at: new Date(baseTime.getTime() + 60 * 60_000).toISOString(),
  deployment_sha: activationDeploymentSha,
  evidence: ACTIVATION_EVIDENCE_BY_STAGE.PUBLIC_INTAKE.map(kind => ({
    kind,
    receipt_ref: `audit:${sha256(`receipt:${kind}`).slice(0, 24)}`,
    sha256: sha256(`evidence:${kind}`),
  })),
}, activationManifestSecret);
Object.assign(env, {
  ARC_ACTIVATION_MANIFEST_HMAC_SECRET: activationManifestSecret,
  ARC_ACTIVATION_MANIFEST: activationManifest,
});
const assetEndpoint = "https://arcweb.onl/internal/intake/arc1/assets/retrieve";
env.ARC_INTAKE_ARC1_ADAPTER_ATTESTATION = createAdapterAttestation({
  schema: "arc-intake-arc1-adapter-attestation-v1",
  version: 1,
  source_schema: "arc-intake-function-submission-v1",
  bridge_schema: "arc-intake-arc1-bridge-evidence-v1",
  consumer_schema: INTAKE_ARC1_CONSUMER_SCHEMA,
  bridge_contract_sha256: INTAKE_ARC1_CONTRACT_SHA256,
  endpoint_sha256: sha256(env.ARC_INTAKE_ARC1_ENDPOINT),
  asset_retrieval_endpoint_sha256: sha256(assetEndpoint),
  site_id_sha256: sha256(env.SITE_ID),
  asset_producer_consumer_tests_sha256: "d".repeat(64),
  asset_pipeline_verified: true,
  tests_passed: true,
  default_off_verified: true,
  verified_at: baseTime.toISOString(),
  expires_at: new Date(baseTime.getTime() + 24 * 60 * 60_000).toISOString(),
}, env.ARC_INTAKE_ARC1_ADAPTER_PROOF_SECRET);

const sourceStore = new FakeStore();
const adapterStore = new FakeStore();
await sourceStore.setJSON(normalized.key, normalized.record, { onlyIfNew: true });
const verification = await reserveIntakeEmailVerification(normalized.record, env, sourceStore, {
  clock: () => new Date(baseTime),
});
await consumeIntakeEmailVerificationToken(new URL(verification.verification_url).hash.slice(1), env, sourceStore, {
  clock: () => new Date(baseTime.getTime() + 1_000),
});
let accepted;
const delivered = await deliverIntakeToArc1(submissionId, env, {
  store: sourceStore,
  clock: () => new Date(baseTime.getTime() + 2_000),
  uuid: () => "44444444-4444-4444-8444-444444444444",
  fetch: async (url, options) => {
    accepted = await acceptArc1AdapterEnvelope(options.body, new Request(url, options), env, {
      source: sourceStore,
      adapter: adapterStore,
    }, { clock: () => new Date(baseTime.getTime() + 2_000) });
    const response = new Response(accepted.acknowledgementJson, {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(accepted.acknowledgementJson)) },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  },
});
assert.equal(delivered.state, "ACKED");
assert.equal(accepted.created, true);

let sitePacketRaw;
const dispatched = await dispatchArc1AdapterRecord(delivered.deliveryId, env, {
  source: sourceStore,
  adapter: adapterStore,
}, {
  clock: () => new Date(baseTime.getTime() + 30_000),
  fetch: async (url, options) => {
    sitePacketRaw = options.body;
    return { status: 200, url };
  },
});
assert.equal(dispatched.state, "HOOK_ACCEPTED");
assert.match(sitePacketRaw, /arc-intake-arc1-downstream-dispatch-v2/);
assert.match(sitePacketRaw, /cross-repo-owner@example\.test/,
  "The test must feed the actual private site-produced packet, not a reduced fixture.");

const bundleSource = await readFile(new URL("../zapier/arc1_consumer_runtime.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const executeBundle = new AsyncFunction("inputData", "fetch", "require", "process", bundleSource);
const runtimeProcess = { env };
const nodeRequire = createRequire(import.meta.url);
const siteJsonResponse = (url, value) => {
  const body = bridgeCore.canonicalJson(value);
  const response = new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
};
const siteControlFetch = async (url, options) => {
  const request = new Request(url, options);
  if (url.endsWith("/claim")) {
    const value = await claimArc1AdapterConsumer(options.body, request, env, adapterStore, {
      clock: () => new Date(baseTime.getTime() + 31_000),
    });
    return siteJsonResponse(url, value);
  }
  const value = await completeArc1AdapterConsumer(options.body, request, env, adapterStore, {
    clock: () => new Date(baseTime.getTime() + 34_000),
  });
  return siteJsonResponse(url, value);
};

const claimOutput = await executeBundle({
  ARC1_CONSUMER_PHASE: "CLAIM",
  ARC1_PACKET_JSON: sitePacketRaw,
  ARC1_STABLE_ATTEMPT_ID: "cross-repo-provider-attempt-000000000001",
}, siteControlFetch, nodeRequire, runtimeProcess);
assert.equal(claimOutput.status, "ARC1_CONSUMER_CLAIM_PREPARED");
assert.doesNotMatch(claimOutput.private_state_json, /Cross Repo|cross-repo-owner|Everett/);
const privateState = JSON.parse(claimOutput.private_state_json);
const createReceipt = createArc1ConsumerStateCreateReceipt({
  stateKey: claimOutput.private_state_key,
  stateSha256: claimOutput.private_state_sha256,
  consumerAttemptId: privateState.consumer_attempt_id,
  storedAt: new Date(baseTime.getTime() + 32_000).toISOString(),
  providerReceiptSha256: "7".repeat(64),
  idempotentReplay: false,
}, env);
const authorizeOutput = await executeBundle({
  ARC1_CONSUMER_PHASE: "AUTHORIZE",
  ARC1_PACKET_JSON: sitePacketRaw,
  ARC1_PRIVATE_STATE_JSON: claimOutput.private_state_json,
  ARC1_PRIVATE_STATE_HMAC_SHA256: claimOutput.private_state_hmac_sha256,
  ARC1_STATE_CREATE_RECEIPT_JSON: createReceipt.raw,
  ARC1_STATE_CREATE_RECEIPT_HMAC_SHA256: createReceipt.hmacSha256,
}, siteControlFetch, nodeRequire, runtimeProcess);
assert.equal(authorizeOutput.status, "ARC1_CONSUMER_MUTATION_AUTHORIZED");
const commitReceipt = createArc1ConsumerStateCommitReceipt({
  stateKey: claimOutput.private_state_key,
  stateSha256: claimOutput.private_state_sha256,
  consumerAttemptId: privateState.consumer_attempt_id,
  immutableResultSha256: "8".repeat(64),
  committedAt: new Date(baseTime.getTime() + 33_000).toISOString(),
  providerReceiptSha256: "9".repeat(64),
}, env);
const completeOutput = await executeBundle({
  ARC1_CONSUMER_PHASE: "COMPLETE",
  ARC1_PACKET_JSON: sitePacketRaw,
  ARC1_PRIVATE_STATE_JSON: claimOutput.private_state_json,
  ARC1_PRIVATE_STATE_HMAC_SHA256: claimOutput.private_state_hmac_sha256,
  ARC1_STATE_CREATE_RECEIPT_JSON: createReceipt.raw,
  ARC1_STATE_CREATE_RECEIPT_HMAC_SHA256: createReceipt.hmacSha256,
  ARC1_STATE_COMMIT_RECEIPT_JSON: commitReceipt.raw,
  ARC1_STATE_COMMIT_RECEIPT_HMAC_SHA256: commitReceipt.hmacSha256,
}, siteControlFetch, nodeRequire, runtimeProcess);
assert.equal(completeOutput.status, "ARC1_CONSUMER_COMPLETED");
assert.equal(completeOutput.terminal_cleanup_allowed, true);
const ingressKey = [...adapterStore.values.keys()].find(key => key.startsWith("ingress/"));
assert.equal(validateArc1AdapterRecord(adapterStore.values.get(ingressKey).data).consumer.status, "COMPLETED");
assert.equal([...adapterStore.values.keys()].some(key => key.startsWith("pending/")), false);

console.log("ARC1 cross-repo runtime passed: the pinned arc-site producer packet completed through the generated consumer bundle and actual site claim/completion authority.");
if (temporarySiteRoot) await rm(temporarySiteRoot, { recursive: true, force: true });
