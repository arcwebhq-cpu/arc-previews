import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "./fixtures/intake_evidence.mjs";

const source = await readFile(new URL("../zapier/arc1_verify_intake_and_assets.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runVerifier = new AsyncFunction("inputData", "fetch", "Buffer", source);
const sha256Text = value => createHash("sha256").update(value, "utf8").digest("hex");
const sha256Bytes = value => createHash("sha256").update(value).digest("hex");
const toArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==", "base64");
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89", "base64");

const siteId = "123e4567-e89b-42d3-a456-426614174000";
const formId = "223e4567-e89b-42d3-a456-426614174000";
const submissionId = "323e4567-e89b-42d3-a456-426614174000";
const otherSubmissionId = "423e4567-e89b-42d3-a456-426614174000";
const formName = "arc-intake";
const siteUrl = "https://arc-intake-test.netlify.app/";
const uploadOrigin = "https://uploads.arc-netlify.test";
const urls = {
  logo_file: `${uploadOrigin}/forms/logo.png`,
  hero_image_file: `${uploadOrigin}/forms/hero.jpg`,
  supporting_image_file: `${uploadOrigin}/forms/support.webp`
};
const netlifyToken = "mock-netlify-token-private";
const evidenceSecret = "arc1-intake-evidence-secret-32-bytes-minimum";
const serverCreatedAt = new Date().toISOString();
const otherServerCreatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const clientSpoofId = otherSubmissionId;
const clientSpoofReceivedAt = "2099-01-01T00:00:00.000Z";
const clientSpoofStartedAt = "1999-01-01T00:00:00.000Z";
const privateEmail = "private-owner@example.test";
const requiredBudgetConfirmation = "Yes, understands the finished ARC website subtotal is $5,000 plus applicable sales tax only after preview approval";
const requiredTermsAcceptance = "Accepted ARC preview terms, privacy policy, refund policy, and service scope dated 2026-08-12; separate adult checkout acceptance required";
const typeByRole = {
  logo_file: "image/png",
  hero_image_file: "image/jpeg",
  supporting_image_file: "image/webp"
};
const bytesByRole = { logo_file: png, hero_image_file: jpeg, supporting_image_file: webp };

const makeHeaders = values => ({
  get(name) {
    return values[String(name).toLowerCase()] ?? null;
  }
});
const jsonResponse = (status, body, url) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  headers: makeHeaders({ "content-type": "application/json" }),
  json: async () => body,
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => toArrayBuffer(Buffer.from(JSON.stringify(body)))
});
const assetResponse = ({ status = 200, body, type, url, responseUrl = url, declaredSize = body.length, headers = {} }) => ({
  ok: status >= 200 && status < 300,
  status,
  url: responseUrl,
  headers: makeHeaders({
    "content-type": type,
    "content-length": String(declaredSize),
    ...headers
  }),
  json: async () => ({}),
  text: async () => body.toString("utf8"),
  arrayBuffer: async () => toArrayBuffer(body)
});

class MockNetlify {
  constructor() {
    this.requests = [];
    this.site = { id: siteId, name: "arc-intake-test", state: "current", ssl_url: siteUrl };
    this.forms = [{ id: formId, site_id: siteId, name: formName }];
    const selectedSubmission = {
      id: submissionId,
      site_id: siteId,
      form_id: formId,
      form_name: formName,
      site_url: siteUrl,
      created_at: serverCreatedAt,
      data: {
        "form-name": formName,
        intake_version: "arc-intake-v7",
        budget_confirmed: requiredBudgetConfirmation,
        terms_accepted: requiredTermsAcceptance,
        business_name: "Private Test Business",
        email: privateEmail,
        lead_route_status: "verified",
        submission_id: clientSpoofId,
        received_at: clientSpoofReceivedAt,
        form_started_at: clientSpoofStartedAt,
        ...urls
      }
    };
    const otherLegitimateSubmission = structuredClone(selectedSubmission);
    otherLegitimateSubmission.id = otherSubmissionId;
    otherLegitimateSubmission.created_at = otherServerCreatedAt;
    otherLegitimateSubmission.data.submission_id = submissionId;
    otherLegitimateSubmission.data.received_at = "2077-01-01T00:00:00.000Z";
    this.submissions = [selectedSubmission, otherLegitimateSubmission];
    this.assets = new Map(Object.entries(urls).map(([role, url]) => [url, {
      status: 200,
      body: Buffer.from(bytesByRole[role]),
      type: typeByRole[role],
      url
    }]));
  }

  async fetch(rawUrl, options = {}) {
    const method = options.method || "GET";
    this.requests.push({ rawUrl, method, headers: options.headers || {}, redirect: options.redirect });
    const url = new URL(rawUrl);
    if (url.hostname === "api.netlify.com") {
      if (method !== "GET") return jsonResponse(405, { message: "read only" }, rawUrl);
      if (url.pathname === `/api/v1/sites/${siteId}`) return jsonResponse(200, this.site, rawUrl);
      if (url.pathname === `/api/v1/sites/${siteId}/forms`) return jsonResponse(200, this.forms, rawUrl);
      if (url.pathname === `/api/v1/forms/${formId}/submissions`) return jsonResponse(200, this.submissions, rawUrl);
      return jsonResponse(404, { message: `unhandled ${rawUrl}` }, rawUrl);
    }
    const fixture = this.assets.get(rawUrl);
    if (!fixture) return assetResponse({ status: 404, body: Buffer.alloc(0), type: "text/plain", url: rawUrl });
    return assetResponse(fixture);
  }
}

const input = {
  netlify_access_token: netlifyToken,
  intake_evidence_secret: evidenceSecret,
  expected_netlify_site_id: siteId,
  expected_netlify_form_id: formId,
  expected_netlify_form_name: formName,
  trigger_submission_id: submissionId,
  asset_upload_origin_allowlist_json: JSON.stringify([uploadOrigin]),
  // These browser/client values are deliberately spoofed and must never be authoritative.
  lead_route_status: "verified",
  submission_id: otherSubmissionId,
  received_at: "2088-01-01T00:00:00.000Z",
  form_started_at: "1988-01-01T00:00:00.000Z"
};

const positiveMock = new MockNetlify();
const issued = await runVerifier(input, positiveMock.fetch.bind(positiveMock), Buffer);
assert.equal(issued.status, "ARC1_INTAKE_EVIDENCE_ISSUED");
assert.equal(issued.build_allowed_by_this_step, false);
assert.equal(issued.github_write_allowed_by_this_step, false);
assert.equal(issued.claim_required_before_build, true);
assert.equal(issued.trusted_netlify_submission_id, submissionId);
assert.equal(issued.trusted_received_at, serverCreatedAt);
assert.match(issued.public_folder_prefix, /^[a-f0-9]{8}$/);
assert.equal(
  issued.public_folder_prefix,
  sha256Text(["arc-preview-folder-v1", siteId, formId, submissionId, serverCreatedAt].join("\n")).slice(0, 8)
);
assert.match(issued.state_key, /^arc1-intake-claim-v1:[a-f0-9]{64}$/);
assert.match(issued.state_digest_sha256, /^[a-f0-9]{64}$/);
assert.equal(issued.asset_manifest.length, 3);
for (const item of issued.asset_manifest) {
  assert.equal(item.source_url_sha256, sha256Text(urls[item.role]));
  assert.equal(item.sha256, sha256Bytes(bytesByRole[item.role]));
  assert.equal(item.content_type, typeByRole[item.role]);
  assert.equal(item.size_bytes, bytesByRole[item.role].length);
  assert.equal("url" in item, false);
}
const evidence = JSON.parse(issued.intake_evidence_private);
assert.deepEqual(Object.keys(evidence).sort(), [
  "version", "scope", "site_id", "site_url", "form_id", "form_name", "submission_id", "received_at",
  "intake_version", "budget_confirmed", "terms_accepted", "public_folder_prefix", "submission_data_sha256",
  "asset_manifest", "asset_manifest_sha256", "total_asset_bytes", "state_key", "state_digest_sha256",
  "claim_required_before_build", "issued_at"
].sort());
assert.equal(evidence.site_id, siteId);
assert.equal(evidence.form_id, formId);
assert.equal(evidence.form_name, formName);
assert.equal(evidence.submission_id, submissionId);
assert.equal(evidence.received_at, serverCreatedAt);
assert.equal(evidence.intake_version, "arc-intake-v7");
assert.equal(evidence.budget_confirmed, requiredBudgetConfirmation);
assert.equal(evidence.terms_accepted, requiredTermsAcceptance);
assert.equal(evidence.claim_required_before_build, true);
assert.equal(evidence.state_key, issued.state_key);
assert.equal(evidence.state_digest_sha256, issued.state_digest_sha256);
assert.equal(evidence.submission_data_sha256, issued.submission_data_sha256);
assert.equal(evidence.total_asset_bytes, png.length + jpeg.length + webp.length);
assert.equal(evidence.asset_manifest_sha256, sha256Text(canonicalJson(evidence.asset_manifest)));
assert.equal(issued.asset_manifest_sha256, evidence.asset_manifest_sha256);
assert.equal(sha256Text(issued.intake_evidence_private), issued.intake_evidence_sha256);
assert.equal(
  createHmac("sha256", evidenceSecret)
    .update(`arc1-intake-evidence-signature-v1\n${issued.intake_evidence_private}`)
    .digest("hex"),
  issued.intake_evidence_hmac_sha256
);
assert.equal(positiveMock.requests.every(request => request.method === "GET"), true);
assert.equal(positiveMock.requests.filter(request => request.rawUrl.startsWith("https://api.netlify.com/")).every(request =>
  request.headers.Authorization === `Bearer ${netlifyToken}` && request.redirect === "error"
), true);
assert.equal(positiveMock.requests.filter(request => request.rawUrl.startsWith(uploadOrigin)).every(request =>
  request.headers.Authorization == null && request.redirect === "manual"
), true);
const serialized = JSON.stringify(issued);
for (const forbidden of [
  netlifyToken,
  evidenceSecret,
  privateEmail,
  "Private Test Business",
  clientSpoofId,
  clientSpoofReceivedAt,
  clientSpoofStartedAt,
  "2088-01-01T00:00:00.000Z",
  "1988-01-01T00:00:00.000Z",
  ...Object.values(urls)
]) {
  assert.equal(serialized.includes(forbidden), false, `private/client value leaked: ${forbidden}`);
}

const expectReject = async (mutateMock, expected, inputOverride = {}) => {
  const mock = new MockNetlify();
  mutateMock(mock);
  await assert.rejects(runVerifier({ ...input, ...inputOverride }, mock.fetch.bind(mock), Buffer), expected);
  return mock;
};

await expectReject(mock => mock.submissions.push(structuredClone(mock.submissions[0])), /server submission matching trigger id; found 2/);
await expectReject(mock => { delete mock.submissions[0].id; }, /server submission matching trigger id; found 0/);
await expectReject(() => {}, /trigger submission id is required/, { trigger_submission_id: "" });
await expectReject(mock => { mock.site.id = "423e4567-e89b-42d3-a456-426614174000"; }, /site identity mismatch/);
await expectReject(mock => { mock.forms[0].name = "wrong-form"; }, /exact Netlify form; found 0/);
await expectReject(mock => { mock.submissions[0].data["form-name"] = "wrong-form"; }, /form binding mismatch/);
await expectReject(mock => { mock.submissions[0].created_at = new Date(Date.now() - 24 * 60 * 60 * 1000 - 60_000).toISOString(); }, /stale/);
await expectReject(mock => { mock.submissions[0].created_at = new Date(Date.now() + 5 * 60 * 1000 + 60_000).toISOString(); }, /future/);
for (const [field, badValue] of [
  ["intake_version", "arc-intake-v6"],
  ["budget_confirmed", "$5000"],
  ["terms_accepted", "2026-08-10"]
]) {
  await expectReject(mock => { mock.submissions[0].data[field] = badValue; }, new RegExp(field));
}
await expectReject(() => {}, /existing claim or folder collision/, { state_claim_exists: "true" });
await expectReject(() => {}, /existing claim or folder collision/, { folder_collision: 1 });

await expectReject(mock => {
  mock.submissions[0].data.logo_file = "https://evil-upload.example/logo.png";
}, /outside the exact HTTPS upload-origin allowlist/);
await expectReject(() => {}, /exact public HTTPS origins/, {
  asset_upload_origin_allowlist_json: JSON.stringify(["https://127.0.0.1"])
});
await expectReject(() => {}, /exact public HTTPS origins/, {
  asset_upload_origin_allowlist_json: JSON.stringify(["https://localhost"])
});
await expectReject(mock => {
  mock.submissions[0].data.logo_file = `https://user:password@${new URL(uploadOrigin).hostname}/logo.png`;
}, /outside the exact HTTPS upload-origin allowlist/);
await expectReject(mock => {
  mock.submissions[0].data.logo_file = `https://${new URL(uploadOrigin).hostname}:8443/logo.png`;
}, /outside the exact HTTPS upload-origin allowlist/);
await expectReject(mock => {
  mock.submissions[0].data.logo_file = `${urls.logo_file}#client-fragment`;
}, /outside the exact HTTPS upload-origin allowlist/);
await expectReject(mock => {
  mock.submissions[0].data.logo_file = `${urls.logo_file}?token=must-not-publish`;
}, /outside the exact HTTPS upload-origin allowlist/);

await expectReject(mock => {
  mock.assets.set(urls.logo_file, { status: 302, body: Buffer.alloc(0), type: "text/plain", url: urls.logo_file });
}, /redirect rejected/);
await expectReject(mock => {
  mock.assets.get(urls.logo_file).declaredSize = Math.floor(2.5 * 1024 * 1024) + 1;
}, /declared size exceeds 2.5 MiB/);
await expectReject(mock => {
  mock.assets.get(urls.logo_file).declaredSize = png.length + 1;
}, /declared\/actual size mismatch/);
await expectReject(mock => {
  mock.assets.get(urls.logo_file).type = "image/svg+xml";
}, /Content-Type must be exactly PNG\/JPEG\/WEBP/);
await expectReject(mock => {
  mock.assets.get(urls.logo_file).body = Buffer.from(jpeg);
  mock.assets.get(urls.logo_file).declaredSize = jpeg.length;
}, /PNG signature/);
for (const active of ["<svg xmlns='http://www.w3.org/2000/svg'></svg>", "<!doctype html><script>alert(1)</script>"]) {
  await expectReject(mock => {
    const body = Buffer.from(active);
    mock.assets.set(urls.logo_file, { status: 200, body, type: "image/png", url: urls.logo_file });
  }, /active-content or polyglot signature/);
}
await expectReject(mock => {
  const body = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from("<script>alert(1)</script>"), Buffer.from([0xff, 0xd9])]);
  mock.assets.set(urls.hero_image_file, { status: 200, body, type: "image/jpeg", url: urls.hero_image_file });
}, /active-content or polyglot signature/);
await expectReject(mock => {
  const body = Buffer.from(webp);
  body.writeUInt32LE(body.length - 9, 4);
  mock.assets.set(urls.supporting_image_file, { status: 200, body, type: "image/webp", url: urls.supporting_image_file });
}, /WEBP RIFF envelope/);

// Three individually valid maximum-size JPEG bodies exercise the exact 7.5 MiB aggregate boundary.
const maxEach = Math.floor(2.5 * 1024 * 1024);
const maxJpeg = Buffer.alloc(maxEach);
maxJpeg[0] = 0xff;
maxJpeg[1] = 0xd8;
maxJpeg[maxJpeg.length - 2] = 0xff;
maxJpeg[maxJpeg.length - 1] = 0xd9;
const totalLimitMock = new MockNetlify();
for (const role of Object.keys(urls)) {
  totalLimitMock.assets.set(urls[role], { status: 200, body: maxJpeg, type: "image/jpeg", url: urls[role] });
}
const atTotalLimit = await runVerifier(input, totalLimitMock.fetch.bind(totalLimitMock), Buffer);
assert.equal(atTotalLimit.total_asset_bytes, Math.floor(7.5 * 1024 * 1024));

// Asset-byte changes are bound into the manifest, state digest, evidence hash, and HMAC.
const changedAssetMock = new MockNetlify();
const changedJpeg = Buffer.from(jpeg);
changedJpeg[10] ^= 1;
changedAssetMock.assets.set(urls.hero_image_file, {
  status: 200,
  body: changedJpeg,
  type: "image/jpeg",
  url: urls.hero_image_file
});
const changed = await runVerifier(input, changedAssetMock.fetch.bind(changedAssetMock), Buffer);
assert.notEqual(changed.asset_manifest.find(item => item.role === "hero_image_file").sha256, issued.asset_manifest.find(item => item.role === "hero_image_file").sha256);
assert.notEqual(changed.state_digest_sha256, issued.state_digest_sha256);
assert.notEqual(changed.intake_evidence_sha256, issued.intake_evidence_sha256);
assert.notEqual(changed.intake_evidence_hmac_sha256, issued.intake_evidence_hmac_sha256);
const tamperedEvidence = issued.intake_evidence_private.replace(requiredBudgetConfirmation, "tampered budget disclosure");
assert.notEqual(
  createHmac("sha256", evidenceSecret).update(`arc1-intake-evidence-signature-v1\n${tamperedEvidence}`).digest("hex"),
  issued.intake_evidence_hmac_sha256
);

assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
for (const clientField of ["lead_route_status", "submission_id", "received_at", "form_started_at"]) {
  assert.doesNotMatch(source, new RegExp(`inputData\\.${clientField}\\b`));
}

console.log("PASS ARC1 authoritative intake and upload-asset evidence contract");
