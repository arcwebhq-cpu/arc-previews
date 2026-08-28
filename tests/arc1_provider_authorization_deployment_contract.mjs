import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ARC1_PROVIDER_STEP_CONFIG_SCHEMA,
  ARC1_PROVIDER_STEP_TRUST_ROOT_SENTINEL,
  canonicalJson as packageCanonicalJson,
  packageArc1GithubProviderStepSource,
  validateArc1ProviderStepDeploymentConfig,
} from "../scripts/package_arc1_github_provider_steps.mjs";
import {
  canonicalJson,
  consumeArc1ProviderAuthorizationLease,
} from "../scripts/arc1_provider_authorization_adapter.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const readbackKeys = generateKeyPairSync("ed25519");
const consumptionKeys = generateKeyPairSync("ed25519");
const attackerKeys = generateKeyPairSync("ed25519");
const publicPem = key => key.export({ type: "spki", format: "pem" });
const privatePem = key => key.export({ type: "pkcs8", format: "pem" });

const deploymentConfig = {
  schema: ARC1_PROVIDER_STEP_CONFIG_SCHEMA,
  trust_root_id: "arc1-trust-provider-authorization-v1",
  authorization_public_keyring: {
    consume01: {
      issuer: "private-state-authorization-adapter",
      public_key_pem: publicPem(consumptionKeys.publicKey),
    },
  },
};
const validated = validateArc1ProviderStepDeploymentConfig(deploymentConfig);
assert.match(validated.keyringSha256, /^[a-f0-9]{64}$/);
assert.equal(validated.keyringJson, packageCanonicalJson(deploymentConfig.authorization_public_keyring));

for (const name of ["arc1_publish_preview_pr.js", "arc1_merge_preview_pr.js"]) {
  const template = await readFile(new URL(`../zapier/${name}`, import.meta.url), "utf8");
  assert.equal(template.split(JSON.stringify(ARC1_PROVIDER_STEP_TRUST_ROOT_SENTINEL)).length - 1, 1,
    `${name} must have exactly one packaging sentinel.`);
  const packaged = packageArc1GithubProviderStepSource(template, deploymentConfig);
  assert.doesNotMatch(packaged.source, new RegExp(ARC1_PROVIDER_STEP_TRUST_ROOT_SENTINEL));
  assert.doesNotMatch(packaged.source, /inputData\.async_(?:readback|authorization)[a-z0-9_]*public_keyring/i);
  assert.doesNotMatch(packaged.source, /-----BEGIN (?:ED25519 )?PRIVATE KEY-----/);
  assert.match(packaged.source, /async_authorization_consumption_private/);
  assert.match(packaged.source, /atomic-one-use-provider-authorization-consumption/);
  assert.match(packaged.sourceSha256, /^[a-f0-9]{64}$/);
}

assert.throws(() => validateArc1ProviderStepDeploymentConfig({
  ...deploymentConfig,
  authorization_public_keyring: {
    consume01: {
      issuer: "private-state-authorization-adapter",
      public_key_pem: privatePem(consumptionKeys.privateKey),
    },
  },
}), /public key record/);

const workflowId = `arc1preview_${sha256("workflow").slice(0, 40)}`;
const artifactSha256 = sha256("artifact");
const providerRequestSha256 = sha256("provider-request");
const stateSha256 = sha256("persisted-intent-state");
const intent = canonicalJson({
  schema: "arc1-preview-async-operation-intent-v1",
  scope: "one-durable-idempotent-provider-operation",
  workflow_id: workflowId,
  artifact_sha256: artifactSha256,
  action: "CREATE_IMMUTABLE_PREVIEW_PR",
  source_state_sha256: sha256("prior-state"),
  idempotency_key: `arc1op_${sha256("operation").slice(0, 40)}`,
  provider_request_sha256: providerRequestSha256,
  prepared_at: iso(-2_000),
  expires_at: iso(10 * 60_000),
});
const intentSha256 = sha256(intent);
const leaseIdSha256 = sha256("authorization-lease");
const readback = canonicalJson({
  schema: "arc1-preview-async-state-readback-v1",
  scope: "authoritative-private-state-exact-readback",
  issuer: "private-state",
  issuer_key_id: "readback01",
  purpose: "AUTHORIZE_OPERATION",
  operation_intent_sha256: intentSha256,
  authorization_lease_id_sha256: leaseIdSha256,
  authorization_lease_expires_at: iso(30_000),
  state_key: `arc1-preview-async-v1:${workflowId}`,
  workflow_id: workflowId,
  state_sha256: stateSha256,
  provider_record_version: 4,
  readback_at: iso(-1_000),
});
const readbackSignature = sign(null, Buffer.from(readback), readbackKeys.privateKey).toString("base64url");
const readbackKeyring = canonicalJson({
  readback01: { issuer: "private-state", public_key_pem: publicPem(readbackKeys.publicKey) },
});

let persisted = null;
let atomicWrites = 0;
const adapter = {
  async consumeExact(stateKey, target) {
    assert.equal(stateKey, `arc1-preview-async-v1:${workflowId}`);
    assert.equal(target.expectedProviderRecordVersion, 4);
    assert.equal(target.expectedStateSha256, stateSha256);
    assert.equal(target.operationIntentSha256, intentSha256);
    assert.equal(target.authorizationLeaseIdSha256, leaseIdSha256);
    if (persisted) {
      if (persisted.consumptionIdSha256 !== target.targetConsumptionIdSha256) {
        throw new Error("atomic consumption conflict");
      }
      return persisted.result;
    }
    atomicWrites += 1;
    persisted = {
      consumptionIdSha256: target.targetConsumptionIdSha256,
      result: {
        consumptionRaw: target.targetConsumptionRaw,
        consumptionSha256: target.targetConsumptionSha256,
        providerRecordVersion: 5,
      },
    };
    return persisted.result;
  },
};
const consume = clock => consumeArc1ProviderAuthorizationLease({
  operationIntentRaw: intent,
  authorizationReadbackRaw: readback,
  authorizationReadbackSignatureBase64url: readbackSignature,
  expectedAction: "CREATE_IMMUTABLE_PREVIEW_PR",
  expectedArtifactSha256: artifactSha256,
  expectedProviderRequestSha256: providerRequestSha256,
}, adapter, {
  clock,
  issuerKeyId: "consume01",
  authorizationReadbackPublicKeyringJson: readbackKeyring,
  signer: async raw => sign(null, Buffer.from(raw), consumptionKeys.privateKey).toString("base64url"),
});

const [first, racedReplay] = await Promise.all([consume(() => now), consume(() => now + 1)]);
assert.equal(atomicWrites, 1, "Concurrent exact retries must consume the lease once.");
assert.deepEqual(first.privateOutput, racedReplay.privateOutput);
assert.equal(first.logSafe.provider_action_allowed, false);
assert.equal(first.logSafe.packaged_provider_verification_required, true);
assert.doesNotMatch(JSON.stringify(first.logSafe), /authorization_consumption_private|signature/i);
assert.equal(verify(null, Buffer.from(first.privateOutput.async_authorization_consumption_private), consumptionKeys.publicKey,
  Buffer.from(first.privateOutput.async_authorization_consumption_signature_base64url, "base64url")), true);
const consumption = JSON.parse(first.privateOutput.async_authorization_consumption_private);
assert.equal(consumption.scope, "atomic-one-use-provider-authorization-consumption");
assert.equal(consumption.operation_intent_sha256, intentSha256);
assert.equal(consumption.provider_request_sha256, providerRequestSha256);
assert.equal(consumption.authorization_provider_record_version, 4);
assert.equal(consumption.consumption_provider_record_version, 5);

let forgedAdapterCalls = 0;
const forgedReadbackSignature = sign(null, Buffer.from(readback), attackerKeys.privateKey).toString("base64url");
await assert.rejects(consumeArc1ProviderAuthorizationLease({
  operationIntentRaw: intent,
  authorizationReadbackRaw: readback,
  authorizationReadbackSignatureBase64url: forgedReadbackSignature,
  expectedAction: "CREATE_IMMUTABLE_PREVIEW_PR",
  expectedArtifactSha256: artifactSha256,
  expectedProviderRequestSha256: providerRequestSha256,
}, { consumeExact: async () => { forgedAdapterCalls += 1; } }, {
  clock: () => now,
  issuerKeyId: "consume01",
  authorizationReadbackPublicKeyringJson: readbackKeyring,
  signer: async () => "A".repeat(86),
}), /authorization readback binding/);
assert.equal(forgedAdapterCalls, 0, "A forged readback must fail before durable state access.");

console.log("ARC1 provider authorization deployment contract passed: trust roots are deployment-pinned and atomic lease consumption is signed, one-use, and exact-replay safe.");
