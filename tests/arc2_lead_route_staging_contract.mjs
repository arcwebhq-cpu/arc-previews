import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc2_verify_lead_route_staging.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runVerifier = new AsyncFunction("inputData", "fetch", "Buffer", source);
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const sha1 = value => createHash("sha1").update(value, "utf8").digest("hex");
const response = (status, body, url, headerValues = {}) => {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const result = new Response(bytes, {
    status,
    headers: { "content-length": String(bytes.length), ...headerValues }
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
};

const folder = "summit-roofing-a1b2c3d4";
const productionPath = "index.html";
const headersPath = "_headers";
const stagingName = "arc-lead-route-a1b2c3d4";
const stagingUrl = `https://${stagingName}.netlify.app/`;
const siteId = "123e4567-e89b-42d3-a456-426614174000";
const deployId = "223e4567-e89b-42d3-a456-426614174000";
const formId = "323e4567-e89b-42d3-a456-426614174000";
const hookId = "423e4567-e89b-42d3-a456-426614174000";
const submissionId = "523e4567-e89b-42d3-a456-426614174000";
const accountId = "arc_account_123456";
const immutableDeployUrl = `https://${deployId}--${stagingName}.netlify.app/`;
const formName = "summit-lead";
const recipientEmail = "verified-leads@example.com";
const netlifyToken = "mock-netlify-token-never-public";
const evidenceSecret = "arc2-static-lead-route-evidence-secret-v1";
const artifactEvidenceSecret = "arc2-static-handoff-artifact-evidence-secret-v1";
const inboxEvidenceSecret = "arc2-static-inbox-receipt-evidence-secret-v1";
const syntheticProbeToken = "ARC_SYNTHETIC_PROBE_1234567890abcdef";
const receiptTimestamp = new Date(Date.now() - 5 * 1000).toISOString();
const inboxReceivedTimestamp = new Date(Date.now() - 1 * 1000).toISOString();
const recipientHmac = createHmac("sha256", evidenceSecret)
  .update(`arc-lead-route-recipient-v1\n${recipientEmail}`)
  .digest("hex");
const productionHtml = `<!doctype html><html><head><meta name="arc-template-version" content="10.0"></head><body data-arc-site-mode="production"><form name="${formName}" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="/?submitted=1"><input type="hidden" name="form-name" value="${formName}"><p hidden><label>Leave blank<input name="bot-field"></label></p><label>Name<input type="text" name="name" required></label><label>Email<input type="email" name="email" required></label><label>Phone<input type="tel" name="phone"></label><label>Project details<textarea name="project_details" required></textarea></label><p class="form-status" role="note">By submitting this form, you agree that this business may contact you about your request. Do not include sensitive personal, medical, legal, or financial information.</p><button type="submit">Send</button></form></body></html>\n`;
const processedHtml = productionHtml
  .replace(' data-netlify="true"', "")
  .replace(' netlify-honeypot="bot-field"', "");
const contentSecurityPolicy = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const headersFile = `/*\n  Content-Security-Policy: ${contentSecurityPolicy}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
const preclaimHeadersFile = `${headersFile}  X-Robots-Tag: noindex, nofollow, noarchive\n`;
const artifacts = [
  { path: headersPath, content: headersFile },
  { path: productionPath, content: productionHtml }
];
const bundleFingerprint = sha256(artifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const deployArtifactsPrivate = canonicalJson(artifacts.map(artifact => ({
  content_base64: Buffer.from(artifact.content).toString("base64"),
  path: artifact.path
})));
const artifactManifest = artifacts.map(artifact => ({
  path: artifact.path,
  sha256: sha256(artifact.content),
  size: Buffer.byteLength(artifact.content)
}));
const artifactManifestSha256 = sha256(canonicalJson(artifactManifest));
const artifactEvidenceIssuedAt = new Date(Date.now() - 10 * 1000).toISOString();
const immutableSourceBindings = {
  approval_content_sha256: "1".repeat(64),
  asset_publication_receipt_sha256: "2".repeat(64),
  checkout_binding_key_id: "01",
  checkout_config_snapshot_sha256: "3".repeat(64),
  checkout_reference_sha256: "4".repeat(64),
  preview_source_commit_sha: "5".repeat(40),
  preview_source_repository: "arcwebhq-cpu/arc-previews",
  preview_source_tag_sha256: "6".repeat(64)
};
const artifactEvidence = canonicalJson({
  version: "arc2-handoff-artifact-evidence-v3",
  scope: "netlify-claimable-deploy-artifacts",
  ...immutableSourceBindings,
  preview_folder: folder,
  lead_route_mode: "netlify_form",
  lead_route_form_name: formName,
  lead_route_recipient_hmac_sha256: recipientHmac,
  production_content_sha256: sha256(productionHtml),
  artifact_manifest_sha256: artifactManifestSha256,
  bundle_fingerprint: bundleFingerprint,
  artifacts: artifactManifest,
  issued_at: artifactEvidenceIssuedAt
});
const artifactEvidenceSignature = createHmac("sha256", artifactEvidenceSecret)
  .update(`arc2-handoff-artifact-evidence-signature-v3\n${artifactEvidence}`)
  .digest("hex");
const rootManifest = [
  { path: "/index.html", sha: sha1(productionHtml), size: Buffer.byteLength(productionHtml), mime_type: "text/html" },
  { path: "/_headers", sha: sha1(preclaimHeadersFile), size: Buffer.byteLength(preclaimHeadersFile), mime_type: "text/plain" }
];
const deployFileManifestSha256 = sha256(JSON.stringify(rootManifest.slice().sort((first, second) => first.path.localeCompare(second.path))));
const stagingRobotsHeader = "noarchive,nofollow,noindex";
const inboxAccountHmac = createHmac("sha256", inboxEvidenceSecret)
  .update("authoritative-inbox-account-v1\nmock-account-123")
  .digest("hex");
const inboxMessageIdHmac = createHmac("sha256", inboxEvidenceSecret)
  .update("authoritative-inbox-message-id-v1\nmock-message-123")
  .digest("hex");
const inboxEvidenceFields = overrides => ({
  version: "arc-inbox-receipt-evidence-v1",
  scope: "authoritative-inbox-delivery",
  provider: "mock-inbox",
  account_hmac_sha256: inboxAccountHmac,
  recipient_hmac_sha256: recipientHmac,
  synthetic_submission_id: submissionId,
  synthetic_probe_sha256: sha256(syntheticProbeToken),
  message_id_hmac_sha256: inboxMessageIdHmac,
  inbox_received_timestamp: inboxReceivedTimestamp,
  ...overrides
});
const signInboxEvidence = (overrides = {}) => {
  const evidence = inboxEvidenceFields(overrides);
  const canonical = JSON.stringify(evidence);
  return {
    evidence,
    canonical,
    signature: createHmac("sha256", inboxEvidenceSecret)
      .update(`arc-inbox-receipt-evidence-signature-v1\n${canonical}`)
      .digest("hex")
  };
};
const signedInboxEvidence = signInboxEvidence();

class MockNetlify {
  constructor() {
    this.requests = [];
    this.site = {
      id: siteId,
      account_id: accountId,
      name: stagingName,
      state: "current",
      ssl_url: stagingUrl,
      published_deploy: { id: deployId }
    };
    this.deploy = {
      id: deployId,
      site_id: siteId,
      state: "ready",
      name: stagingName,
      ssl_url: stagingUrl,
      deploy_ssl_url: immutableDeployUrl,
      published_at: receiptTimestamp,
      required: [],
      required_functions: [],
      required_edge_functions: [],
      function_schedules: []
    };
    this.forms = [{ id: formId, site_id: siteId, name: formName, paths: ["/"] }];
    this.hooks = [{
      id: hookId,
      site_id: siteId,
      type: "email",
      event: "submission_created",
      disabled: false,
      data: { email: recipientEmail, form_id: formId, form_name: formName }
    }];
    this.submissions = [{
      id: submissionId,
      created_at: receiptTimestamp,
      site_url: stagingUrl,
      data: { project_details: syntheticProbeToken, "form-name": formName }
    }];
    this.files = rootManifest.map(file => ({ ...file, id: file.path }));
    this.rawFiles = new Map([
      ["/index.html", productionHtml],
      ["/_headers", preclaimHeadersFile]
    ]);
    this.snippets = [];
    this.liveFiles = new Map([
      [stagingUrl, processedHtml],
      [immutableDeployUrl, processedHtml]
    ]);
    this.liveHeaders = {
      "x-robots-tag": "noindex, nofollow, noarchive",
      "content-security-policy": contentSecurityPolicy,
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-type": "text/html; charset=UTF-8"
    };
  }

  async fetch(rawUrl, options = {}) {
    const method = options.method || "GET";
    this.requests.push({ rawUrl, method, headers: options.headers || {}, redirect: options.redirect });
    const url = new URL(rawUrl);
    if (url.hostname !== "api.netlify.com") {
      const body = this.liveFiles.get(rawUrl);
      const liveHeaders = /\/assets\//.test(url.pathname)
        ? { ...this.liveHeaders, "content-type": url.pathname.endsWith(".png") ? "image/png" : url.pathname.endsWith(".jpg") ? "image/jpeg" : "image/webp" }
        : this.liveHeaders;
      return body == null ? response(404, "", rawUrl) : response(200, body, rawUrl, liveHeaders);
    }
    if (method !== "GET") return response(405, { message: "read only" }, rawUrl);
    if (url.pathname === `/api/v1/sites/${siteId}`) return response(200, this.site, rawUrl);
    if (url.pathname === `/api/v1/sites/${siteId}/deploys/${deployId}`) return response(200, this.deploy, rawUrl);
    if (url.pathname === `/api/v1/sites/${siteId}/files`) return response(200, this.files, rawUrl);
    if (url.pathname.startsWith(`/api/v1/sites/${siteId}/files/`)) {
      const filePath = `/${decodeURIComponent(url.pathname.slice(`/api/v1/sites/${siteId}/files/`.length))}`;
      const body = this.rawFiles.get(filePath);
      return body == null ? response(404, "", rawUrl) : response(200, body, rawUrl);
    }
    if (url.pathname === `/api/v1/sites/${siteId}/snippets`) return response(200, this.snippets, rawUrl);
    if (url.pathname === `/api/v1/sites/${siteId}/forms`) return response(200, this.forms, rawUrl);
    if (url.pathname === "/api/v1/hooks" && url.searchParams.get("site_id") === siteId) return response(200, this.hooks, rawUrl);
    if (url.pathname === `/api/v1/forms/${formId}/submissions`) return response(200, this.submissions, rawUrl);
    return response(404, { message: `Unhandled ${method} ${rawUrl}` }, rawUrl);
  }
}

const input = {
  netlify_access_token: netlifyToken,
  lead_route_evidence_secret: evidenceSecret,
  handoff_artifact_evidence_secret: artifactEvidenceSecret,
  handoff_artifact_evidence_private: artifactEvidence,
  handoff_artifact_evidence_hmac_sha256: artifactEvidenceSignature,
  inbox_receipt_evidence_secret: inboxEvidenceSecret,
  inbox_receipt_evidence: JSON.stringify(signedInboxEvidence.evidence),
  inbox_receipt_evidence_hmac_sha256: signedInboxEvidence.signature,
  expected_netlify_account_id: accountId,
  preview_folder: folder,
  staging_site_id: siteId,
  staging_site_url: stagingUrl,
  staging_deploy_id: deployId,
  notification_hook_id: hookId,
  synthetic_submission_id: submissionId,
  synthetic_probe_token: syntheticProbeToken,
  lead_route_form_name: formName,
  verified_lead_notification_email: recipientEmail,
  lead_route_recipient_hmac_sha256: recipientHmac,
  production_file_path: productionPath,
  production_content_base64: Buffer.from(productionHtml).toString("base64"),
  production_content_sha256: sha256(productionHtml),
  headers_file_path: headersPath,
  headers_file_base64: Buffer.from(headersFile).toString("base64"),
  deploy_artifacts_private: deployArtifactsPrivate,
  artifact_manifest_sha256: artifactManifestSha256,
  bundle_fingerprint: bundleFingerprint
};

const mock = new MockNetlify();
const issued = await runVerifier(input, mock.fetch.bind(mock), Buffer);
assert.equal(issued.status, "LEAD_ROUTE_VERIFIED");
assert.equal(issued.claim_invitation_allowed_by_this_step, false);
assert.equal(issued.send_delivery_email, false);
assert.equal(issued.github_write_allowed_by_this_step, false);
assert.equal(issued.evidence_requires_downstream_reverification, true);
assert.equal(issued.lead_route_recipient_hmac_sha256, recipientHmac);
assert.match(issued.lead_route_evidence_sha256, /^[a-f0-9]{64}$/);
assert.match(issued.lead_route_evidence_hmac_sha256, /^[a-f0-9]{64}$/);
const evidence = JSON.parse(issued.lead_route_evidence);
assert.equal(evidence.preview_folder, folder);
assert.equal(evidence.production_content_sha256, sha256(productionHtml));
assert.equal(evidence.artifact_manifest_sha256, artifactManifestSha256);
assert.equal(evidence.handoff_artifact_evidence_sha256, sha256(artifactEvidence));
assert.equal(evidence.bundle_fingerprint, bundleFingerprint);
assert.equal(evidence.netlify_account_id, accountId);
assert.equal(evidence.staging_site_id, siteId);
assert.equal(evidence.staging_deploy_id, deployId);
assert.equal(evidence.staging_deploy_url, immutableDeployUrl);
assert.equal(evidence.deploy_file_manifest_sha256, deployFileManifestSha256);
assert.equal(evidence.served_html_sha256, sha256(processedHtml));
assert.equal(evidence.staging_robots_header_sha256, sha256(stagingRobotsHeader));
assert.equal(evidence.staging_form_id, formId);
assert.equal(evidence.notification_hook_id, hookId);
assert.equal(evidence.form_name, formName);
assert.equal(evidence.recipient_hmac_sha256, recipientHmac);
assert.equal(evidence.synthetic_submission_id, submissionId);
assert.equal(evidence.synthetic_probe_sha256, sha256(syntheticProbeToken));
assert.equal(evidence.netlify_submission_timestamp, receiptTimestamp);
assert.equal(evidence.inbox_provider, "mock-inbox");
assert.equal(evidence.inbox_account_hmac_sha256, inboxAccountHmac);
assert.equal(evidence.inbox_message_id_hmac_sha256, inboxMessageIdHmac);
assert.equal(evidence.inbox_received_timestamp, inboxReceivedTimestamp);
assert.equal(evidence.inbox_receipt_evidence_sha256, sha256(signedInboxEvidence.canonical));
assert.equal(
  createHmac("sha256", evidenceSecret)
    .update(`arc-lead-route-evidence-signature-v1\n${issued.lead_route_evidence}`)
    .digest("hex"),
  issued.lead_route_evidence_hmac_sha256
);
assert.equal(sha256(issued.lead_route_evidence), issued.lead_route_evidence_sha256);
assert.equal(mock.requests.every(request => request.method === "GET"), true);
assert.equal(mock.requests.filter(request => request.rawUrl.startsWith("https://api.netlify.com")).every(request =>
  request.headers.Authorization === `Bearer ${netlifyToken}`
), true);
const serializedOutput = JSON.stringify(issued);
assert.equal(serializedOutput.includes(recipientEmail), false);
assert.equal(serializedOutput.includes(syntheticProbeToken), false);
assert.equal(serializedOutput.includes(netlifyToken), false);
assert.equal(serializedOutput.includes(evidenceSecret), false);
assert.equal(serializedOutput.includes(inboxEvidenceSecret), false);
assert.equal(serializedOutput.includes("mock-account-123"), false);
assert.equal(serializedOutput.includes("mock-message-123"), false);

const assetBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const assetDigest = createHash("sha256").update(assetBytes).digest("hex");
const assetPath = `assets/${assetDigest}.png`;
const assetProductionHtml = productionHtml.replace("</form>", `</form><img src="${assetPath}" alt="Customer logo">`);
const assetProcessedHtml = assetProductionHtml.replace(' data-netlify="true"', "").replace(' netlify-honeypot="bot-field"', "");
const assetBundle = [
  { path: headersPath, bytes: Buffer.from(headersFile) },
  { path: assetPath, bytes: assetBytes },
  { path: productionPath, bytes: Buffer.from(assetProductionHtml) }
];
const assetBundleFingerprint = (() => {
  const hash = createHash("sha256");
  for (const artifact of assetBundle) hash.update(artifact.path).update("\0").update(artifact.bytes).update("\0");
  return hash.digest("hex");
})();
const assetManifest = assetBundle.map(artifact => ({ path: artifact.path, sha256: createHash("sha256").update(artifact.bytes).digest("hex"), size: artifact.bytes.length }));
const assetManifestSha256 = sha256(canonicalJson(assetManifest));
const assetEvidence = canonicalJson({
  version: "arc2-handoff-artifact-evidence-v3", scope: "netlify-claimable-deploy-artifacts", ...immutableSourceBindings, preview_folder: folder,
  lead_route_mode: "netlify_form", lead_route_form_name: formName, lead_route_recipient_hmac_sha256: recipientHmac,
  production_content_sha256: sha256(assetProductionHtml), artifact_manifest_sha256: assetManifestSha256,
  bundle_fingerprint: assetBundleFingerprint, artifacts: assetManifest, issued_at: artifactEvidenceIssuedAt
});
const assetInput = {
  ...input,
  production_content_base64: Buffer.from(assetProductionHtml).toString("base64"),
  production_content_sha256: sha256(assetProductionHtml),
  deploy_artifacts_private: canonicalJson(assetBundle.map(artifact => ({ content_base64: artifact.bytes.toString("base64"), path: artifact.path }))),
  artifact_manifest_sha256: assetManifestSha256,
  bundle_fingerprint: assetBundleFingerprint,
  handoff_artifact_evidence_private: assetEvidence,
  handoff_artifact_evidence_hmac_sha256: createHmac("sha256", artifactEvidenceSecret)
  .update(`arc2-handoff-artifact-evidence-signature-v3\n${assetEvidence}`).digest("hex")
};
const configureAssetMock = instance => {
  const deployedAssetBundle = assetBundle.map((artifact, index) => index === 0
    ? { path: artifact.path, bytes: Buffer.from(preclaimHeadersFile) }
    : artifact);
  instance.files = deployedAssetBundle.map(artifact => ({
    id: `/${artifact.path}`, path: `/${artifact.path}`, sha: createHash("sha1").update(artifact.bytes).digest("hex"), size: artifact.bytes.length,
    mime_type: artifact.path === "index.html" ? "text/html" : artifact.path === "_headers" ? "text/plain" : "image/png"
  }));
  instance.rawFiles = new Map(deployedAssetBundle.map(artifact => [`/${artifact.path}`, artifact.bytes]));
  instance.liveFiles.set(stagingUrl, assetProcessedHtml);
  instance.liveFiles.set(immutableDeployUrl, assetProcessedHtml);
  instance.liveFiles.set(new URL(assetPath, stagingUrl).toString(), assetBytes);
  instance.liveFiles.set(new URL(assetPath, immutableDeployUrl).toString(), assetBytes);
  return instance;
};
const assetMock = configureAssetMock(new MockNetlify());
const assetIssued = await runVerifier(assetInput, assetMock.fetch.bind(assetMock), Buffer);
assert.equal(assetIssued.status, "LEAD_ROUTE_VERIFIED");
assert.equal(JSON.stringify(assetIssued).includes(assetBytes.toString("base64")), false, "Signed lead evidence must not expose asset bytes.");
const tamperedLiveAsset = configureAssetMock(new MockNetlify());
tamperedLiveAsset.liveFiles.set(new URL(assetPath, stagingUrl).toString(), Buffer.concat([assetBytes, Buffer.from("tamper")]));
await assert.rejects(runVerifier(assetInput, tamperedLiveAsset.fetch.bind(tamperedLiveAsset), Buffer), /live asset bytes changed|response too large/);

const reusedSigningSecretMock = new MockNetlify();
await assert.rejects(
  runVerifier({ ...input, inbox_receipt_evidence_secret: evidenceSecret }, reusedSigningSecretMock.fetch.bind(reusedSigningSecretMock), Buffer),
  /signing secrets must be separate/
);
assert.equal(reusedSigningSecretMock.requests.length, 0);

const wrongInboxSignature = new MockNetlify();
await assert.rejects(
  runVerifier({ ...input, inbox_receipt_evidence_hmac_sha256: "0".repeat(64) }, wrongInboxSignature.fetch.bind(wrongInboxSignature), Buffer),
  /ARC_INBOX_RECEIPT_INVALID: evidence HMAC mismatch/
);

for (const [label, overrides] of [
  ["recipient", { recipient_hmac_sha256: "f".repeat(64) }],
  ["submission", { synthetic_submission_id: "623e4567-e89b-42d3-a456-426614174000" }],
  ["probe", { synthetic_probe_sha256: "e".repeat(64) }]
]) {
  const signed = signInboxEvidence(overrides);
  const inboxBindingMock = new MockNetlify();
  await assert.rejects(
    runVerifier({
      ...input,
      inbox_receipt_evidence: JSON.stringify(signed.evidence),
      inbox_receipt_evidence_hmac_sha256: signed.signature
    }, inboxBindingMock.fetch.bind(inboxBindingMock), Buffer),
    /not bound to the recipient, submission, and probe/,
    `signed inbox evidence with the wrong ${label} must fail closed`
  );
}

const staleInboxReceipt = signInboxEvidence({
  inbox_received_timestamp: new Date(Date.now() - 31 * 60 * 1000).toISOString()
});
const staleInboxMock = new MockNetlify();
await assert.rejects(
  runVerifier({
    ...input,
    inbox_receipt_evidence: JSON.stringify(staleInboxReceipt.evidence),
    inbox_receipt_evidence_hmac_sha256: staleInboxReceipt.signature
  }, staleInboxMock.fetch.bind(staleInboxMock), Buffer),
  /inbox receipt timestamp is stale/
);

const preSubmissionInboxReceipt = signInboxEvidence({
  inbox_received_timestamp: new Date(Date.parse(receiptTimestamp) - 1000).toISOString()
});
const preSubmissionMock = new MockNetlify();
await assert.rejects(
  runVerifier({
    ...input,
    inbox_receipt_evidence: JSON.stringify(preSubmissionInboxReceipt.evidence),
    inbox_receipt_evidence_hmac_sha256: preSubmissionInboxReceipt.signature
  }, preSubmissionMock.fetch.bind(preSubmissionMock), Buffer),
  /precedes the Netlify submission/
);

const badAccount = new MockNetlify();
badAccount.site.account_id = "another_account";
await assert.rejects(runVerifier(input, badAccount.fetch.bind(badAccount), Buffer), /site identity mismatch/);

const badDeploy = new MockNetlify();
badDeploy.deploy.site_id = "623e4567-e89b-42d3-a456-426614174000";
await assert.rejects(runVerifier(input, badDeploy.fetch.bind(badDeploy), Buffer), /deploy identity mismatch/);

const badArtifact = new MockNetlify();
badArtifact.liveFiles.set(stagingUrl, `${processedHtml}tampered`);
await assert.rejects(runVerifier(input, badArtifact.fetch.bind(badArtifact), Buffer), /processed staging HTML/);

const badSourceManifest = new MockNetlify();
badSourceManifest.files[0].sha = "0".repeat(40);
await assert.rejects(runVerifier(input, badSourceManifest.fetch.bind(badSourceManifest), Buffer), /source manifest mismatch/);

const extraDeployFile = new MockNetlify();
extraDeployFile.files.push({ id: "/USAGE.md", path: "/USAGE.md", sha: "0".repeat(40), size: 1, mime_type: "text/markdown" });
await assert.rejects(runVerifier(input, extraDeployFile.fetch.bind(extraDeployFile), Buffer), /exact claimable bundle/);

const changedRawSource = new MockNetlify();
changedRawSource.rawFiles.set("/index.html", `${productionHtml}tampered`);
await assert.rejects(runVerifier(input, changedRawSource.fetch.bind(changedRawSource), Buffer), /original uploaded bytes changed|response too large/);

const injectedSnippet = new MockNetlify();
injectedSnippet.snippets.push({ id: 1, site_id: siteId, general: "<script>alert(1)</script>" });
await assert.rejects(runVerifier(input, injectedSnippet.fetch.bind(injectedSnippet), Buffer), /injection snippets are forbidden/);

const indexableStaging = new MockNetlify();
indexableStaging.liveHeaders["x-robots-tag"] = "index, follow";
await assert.rejects(runVerifier(input, indexableStaging.fetch.bind(indexableStaging), Buffer), /staging-only response headers/);

const duplicateForm = new MockNetlify();
duplicateForm.forms.push({ ...duplicateForm.forms[0], id: "723e4567-e89b-42d3-a456-426614174000" });
await assert.rejects(runVerifier(input, duplicateForm.fetch.bind(duplicateForm), Buffer), /expected one exact Netlify form; found 2/);

const staleFormPath = new MockNetlify();
staleFormPath.forms[0].paths = ["/old.html"];
await assert.rejects(runVerifier(input, staleFormPath.fetch.bind(staleFormPath), Buffer), /expected one exact Netlify form; found 0/);

const wrongRecipient = new MockNetlify();
wrongRecipient.hooks[0].data.email = "wrong@example.com";
await assert.rejects(runVerifier(input, wrongRecipient.fetch.bind(wrongRecipient), Buffer), /recipient notification hook not found/);

const callerShapedHookBinding = new MockNetlify();
callerShapedHookBinding.hooks[0].form_id = formId;
callerShapedHookBinding.hooks[0].data.form_id = "723e4567-e89b-42d3-a456-426614174000";
await assert.rejects(runVerifier(input, callerShapedHookBinding.fetch.bind(callerShapedHookBinding), Buffer), /recipient notification hook not found/);

const duplicateSubmission = new MockNetlify();
duplicateSubmission.submissions.push({ ...duplicateSubmission.submissions[0] });
await assert.rejects(runVerifier(input, duplicateSubmission.fetch.bind(duplicateSubmission), Buffer), /synthetic submission; found 2/);

const wrongProbe = new MockNetlify();
wrongProbe.submissions[0].data.project_details = "WRONG_SYNTHETIC_PROBE_1234567890";
await assert.rejects(runVerifier(input, wrongProbe.fetch.bind(wrongProbe), Buffer), /not bound to this site and probe/);

const preDeployProbe = new MockNetlify();
preDeployProbe.deploy.published_at = new Date(Date.parse(receiptTimestamp) + 1000).toISOString();
await assert.rejects(runVerifier(input, preDeployProbe.fetch.bind(preDeployProbe), Buffer), /receipt is stale/);

const staleReceipt = new MockNetlify();
staleReceipt.submissions[0].created_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
await assert.rejects(runVerifier(input, staleReceipt.fetch.bind(staleReceipt), Buffer), /receipt is stale/);

const noReadOnChangedResolverBytes = new MockNetlify();
await assert.rejects(
  runVerifier({ ...input, production_content_sha256: "0".repeat(64) }, noReadOnChangedResolverBytes.fetch.bind(noReadOnChangedResolverBytes), Buffer),
  /resolver artifact bytes changed/
);
assert.equal(noReadOnChangedResolverBytes.requests.length, 0);

const inputForProductionHtml = html => {
  const nextArtifacts = [{ path: headersPath, content: headersFile }, { path: productionPath, content: html }];
  const nextManifest = nextArtifacts.map(artifact => ({
    path: artifact.path,
    sha256: sha256(artifact.content),
    size: Buffer.byteLength(artifact.content)
  }));
  const nextManifestSha256 = sha256(canonicalJson(nextManifest));
  const nextFingerprint = sha256(nextArtifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
  const nextEvidence = canonicalJson({
    version: "arc2-handoff-artifact-evidence-v3",
    scope: "netlify-claimable-deploy-artifacts",
    ...immutableSourceBindings,
    preview_folder: folder,
    lead_route_mode: "netlify_form",
    lead_route_form_name: formName,
    lead_route_recipient_hmac_sha256: recipientHmac,
    production_content_sha256: sha256(html),
    artifact_manifest_sha256: nextManifestSha256,
    bundle_fingerprint: nextFingerprint,
    artifacts: nextManifest,
    issued_at: artifactEvidenceIssuedAt
  });
  return {
    ...input,
    production_content_base64: Buffer.from(html).toString("base64"),
    deploy_artifacts_private: canonicalJson(nextArtifacts.map(artifact => ({
      content_base64: Buffer.from(artifact.content).toString("base64"),
      path: artifact.path
    }))),
    production_content_sha256: sha256(html),
    artifact_manifest_sha256: nextManifestSha256,
    bundle_fingerprint: nextFingerprint,
    handoff_artifact_evidence_private: nextEvidence,
    handoff_artifact_evidence_hmac_sha256: createHmac("sha256", artifactEvidenceSecret)
      .update(`arc2-handoff-artifact-evidence-signature-v3\n${nextEvidence}`).digest("hex")
  };
};
for (const [label, unsafeHtml, error] of [
  [
    "missing privacy disclosure",
    productionHtml.replace(/<p class="form-status" role="note">[\s\S]*?<\/p>/, ""),
    /exact visible lead privacy disclosure/
  ],
  [
    "conflicting hidden route",
    productionHtml.replace(`name="form-name" value="${formName}"`, 'name="form-name" value="wrong-lead"'),
    /lead control semantics/
  ],
  [
    "duplicate hidden route",
    productionHtml.replace(`<input type="hidden" name="form-name" value="${formName}">`, `<input type="hidden" name="form-name" value="wrong-lead"><input type="hidden" name="form-name" value="${formName}">`),
    /duplicate, unsupported, or missing lead control/
  ],
  [
    "DOM-clobbering control",
    productionHtml.replace('name="phone"', 'name="children"'),
    /duplicate, unsupported, or missing lead control/
  ]
]) {
  const noRead = new MockNetlify();
  await assert.rejects(runVerifier(inputForProductionHtml(unsafeHtml), noRead.fetch.bind(noRead), Buffer), error, label);
  assert.equal(noRead.requests.length, 0, `${label} must fail before Netlify reads`);
}

let timedOutReads = 0;
await assert.rejects(runVerifier({ ...input, provider_operation_timeout_ms: "25" }, async (_url, options = {}) => {
  timedOutReads += 1;
  return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(
    Object.assign(new Error("aborted"), { name: "AbortError" })
  ), { once: true }));
}, Buffer), /bounded timeout|operation deadline/i,
"Every active Netlify read must share a bounded cumulative operation deadline.");
assert.equal(timedOutReads, 1);
await assert.rejects(runVerifier(input, async url => response(200, {}, url, { "content-length": "256001" }), Buffer),
  /response too large/i, "Oversized provider JSON must be rejected before parsing or later reads.");

assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
assert.doesNotMatch(source, /lead_route_status\s*===?\s*["']verified/i);

console.log("PASS ARC2 authoritative read-only Netlify lead-route evidence issuer contract");
