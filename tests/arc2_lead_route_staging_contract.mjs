import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc2_verify_lead_route_staging.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runVerifier = new AsyncFunction("inputData", "fetch", "Buffer", source);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const sha1 = value => createHash("sha1").update(value).digest("hex");
const framed = entries => {
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry.path).update("\0").update(entry.bytes).update("\0");
  return hash.digest("hex");
};
const response = (status, body, url, headers = {}) => {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const result = new Response(bytes, { status, headers: { "content-length": String(bytes.length), ...headers } });
  Object.defineProperty(result, "url", { value: url });
  return result;
};
const HTML_PATHS = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"];
const folder = "summit-roofing-a1b2c3d4";
const siteName = "arc-lead-route-a1b2c3d4";
const siteUrl = `https://${siteName}.netlify.app/`;
const siteId = "123e4567-e89b-42d3-a456-426614174000";
const deployId = "223e4567-e89b-42d3-a456-426614174000";
const formId = "323e4567-e89b-42d3-a456-426614174000";
const hookId = "423e4567-e89b-42d3-a456-426614174000";
const submissionId = "523e4567-e89b-42d3-a456-426614174000";
const immutableUrl = `https://${deployId}--${siteName}.netlify.app/`;
const accountId = "arc_account_123456";
const formName = "summit-lead";
const recipientEmail = "verified-leads@example.test";
const recipientHmac = "7".repeat(64);
const probe = "ARC_SYNTHETIC_PROBE_1234567890abcdef";
const netlifyToken = "mock-netlify-token-never-public";
const artifactSecret = "arc2-five-page-artifact-evidence-secret-v4";
const leadSecret = "arc2-five-page-lead-route-evidence-secret-v1";
const inboxSecret = "arc2-five-page-inbox-receipt-evidence-secret";
const publishedAt = new Date(Date.now() - 10_000).toISOString();
const receivedAt = new Date(Date.now() - 2_000).toISOString();
const csp = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const headersFile = `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
const preclaimHeaders = `${headersFile}  X-Robots-Tag: noindex, nofollow, noarchive\n`;
const disclosure = "By submitting this form, you agree that this business may contact you about your request. Do not include sensitive personal, medical, legal, or financial information.";
const contactForm = `<form name="${formName}" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="/contact/?submitted=1"><input type="hidden" name="form-name" value="${formName}"><p class="form-status" role="note">${disclosure}</p><textarea name="project_details"></textarea><button type="submit">Send</button></form>`;
const pageHtml = (path, content = "") => `<!doctype html><html><head><title>${path}</title></head><body data-page="${path}">${content}</body></html>\n`;
const basePages = HTML_PATHS.map(path => ({ path, bytes: Buffer.from(pageHtml(path, path === "contact/index.html" ? contactForm : `<main>${path}</main>`)) }));

function buildFixture({ pages = basePages, mode = "netlify_form", artifactVersion = "arc2-handoff-artifact-evidence-v4", mutateArtifacts } = {}) {
  let bundle = [{ path: "_headers", bytes: Buffer.from(headersFile) }, ...pages.map(page => ({ path: page.path, bytes: Buffer.from(page.bytes) }))];
  if (mutateArtifacts) bundle = mutateArtifacts(bundle);
  const manifest = bundle.map(item => ({ path: item.path, sha256: sha(item.bytes), size: item.bytes.length }));
  const pageEntries = bundle.filter(item => HTML_PATHS.includes(item.path));
  const artifact = {
    version: artifactVersion, scope: "netlify-claimable-deploy-artifacts", approval_content_sha256: "1".repeat(64),
    asset_publication_receipt_sha256: "2".repeat(64), checkout_binding_key_id: "01", checkout_config_snapshot_sha256: "3".repeat(64),
    checkout_reference_sha256: "4".repeat(64), preview_folder: folder, preview_source_commit_sha: "5".repeat(40),
    preview_source_repository: "arcwebhq-cpu/arc-previews", preview_source_tag_sha256: "6".repeat(64), lead_route_mode: mode,
    lead_route_form_name: mode === "netlify_form" ? formName : "", lead_route_recipient_hmac_sha256: mode === "netlify_form" ? recipientHmac : "",
    production_content_sha256: framed(pageEntries), artifact_manifest_sha256: sha(canonical(manifest)), bundle_fingerprint: framed(bundle),
    artifacts: manifest, issued_at: new Date(Date.now() - 20_000).toISOString()
  };
  const artifactPrivate = canonical(artifact);
  const inbox = {
    version: "arc-inbox-receipt-evidence-v1", scope: "authoritative-inbox-delivery", provider: "mock-inbox",
    account_hmac_sha256: "8".repeat(64), recipient_hmac_sha256: recipientHmac, synthetic_submission_id: submissionId,
    synthetic_probe_sha256: sha(probe), message_id_hmac_sha256: "9".repeat(64), inbox_received_timestamp: receivedAt
  };
  const inboxPrivate = canonical(inbox);
  const input = {
    netlify_access_token: netlifyToken, handoff_artifact_evidence_secret: artifactSecret, handoff_artifact_evidence_private: artifactPrivate,
    handoff_artifact_evidence_hmac_sha256: createHmac("sha256", artifactSecret).update(`arc2-handoff-artifact-evidence-signature-v4\n${artifactPrivate}`).digest("hex"),
    expected_netlify_account_id: accountId, preview_folder: folder, staging_site_id: siteId, staging_site_url: siteUrl, staging_deploy_id: deployId,
    production_content_sha256: artifact.production_content_sha256, artifact_manifest_sha256: artifact.artifact_manifest_sha256,
    bundle_fingerprint: artifact.bundle_fingerprint, deploy_artifacts_private: canonical(bundle.map(item => ({ content_base64: item.bytes.toString("base64"), path: item.path }))),
    lead_route_form_name: artifact.lead_route_form_name, lead_route_recipient_hmac_sha256: artifact.lead_route_recipient_hmac_sha256,
    lead_route_evidence_secret: mode === "netlify_form" ? leadSecret : "", inbox_receipt_evidence_secret: mode === "netlify_form" ? inboxSecret : "",
    inbox_receipt_evidence: mode === "netlify_form" ? inboxPrivate : "", inbox_receipt_evidence_hmac_sha256: mode === "netlify_form"
      ? createHmac("sha256", inboxSecret).update(`arc-inbox-receipt-evidence-signature-v1\n${inboxPrivate}`).digest("hex") : "",
    notification_hook_id: mode === "netlify_form" ? hookId : "", synthetic_submission_id: mode === "netlify_form" ? submissionId : "",
    synthetic_probe_token: mode === "netlify_form" ? probe : "", verified_lead_notification_email: mode === "netlify_form" ? recipientEmail : ""
  };
  return { input, artifact, artifactPrivate, bundle, pages: pageEntries, inbox };
}

class MockNetlify {
  constructor(fixture) {
    this.fixture = fixture; this.requests = []; this.snippets = [];
    this.site = { id: siteId, account_id: accountId, name: siteName, state: "current", ssl_url: siteUrl, published_deploy: { id: deployId } };
    this.deploy = { id: deployId, site_id: siteId, name: siteName, state: "ready", ssl_url: siteUrl, deploy_ssl_url: immutableUrl,
      published_at: publishedAt, required: [], required_functions: [], required_edge_functions: [], function_schedules: [] };
    const staged = fixture.bundle.map((item, index) => index === 0 ? { ...item, bytes: Buffer.from(preclaimHeaders) } : item);
    this.files = staged.map(item => ({ path: `/${item.path}`, id: `/${item.path}`, sha: sha1(item.bytes), size: item.bytes.length,
      mime_type: HTML_PATHS.includes(item.path) ? "text/html" : item.path === "_headers" ? "text/plain" : "image/png" }));
    this.raw = new Map(staged.map(item => [`/${item.path}`, item.bytes]));
    this.live = new Map();
    for (const root of [siteUrl, immutableUrl]) for (const page of fixture.pages) {
      const url = new URL(page.path === "index.html" ? "/" : `/${page.path.replace(/index\.html$/, "")}`, root).toString();
      let bytes = Buffer.from(page.bytes);
      if (fixture.artifact.lead_route_mode === "netlify_form" && page.path === "contact/index.html") {
        bytes = Buffer.from(bytes.toString().replace(' data-netlify="true"', "").replace(' netlify-honeypot="bot-field"', ""));
      }
      this.live.set(url, bytes);
    }
    for (const root of [siteUrl, immutableUrl]) for (const asset of fixture.bundle.filter(item => item.path.startsWith("assets/"))) {
      this.live.set(new URL(`/${asset.path}`, root).toString(), Buffer.from(asset.bytes));
    }
  }
  async fetch(rawUrl, options = {}) {
    const method = options.method || "GET"; this.requests.push({ rawUrl, method, headers: options.headers || {} });
    const url = new URL(rawUrl);
    if (url.hostname !== "api.netlify.com") {
      const body = this.live.get(rawUrl);
      const contentType = url.pathname.startsWith("/assets/") ? (url.pathname.endsWith(".png") ? "image/png" : url.pathname.endsWith(".jpg") ? "image/jpeg" : "image/webp") : "text/html";
      return body == null ? response(404, "", rawUrl) : response(200, body, rawUrl, { "x-robots-tag": "noindex, nofollow, noarchive",
        "content-security-policy": csp, "x-content-type-options": "nosniff", "x-frame-options": "DENY", "content-type": contentType });
    }
    assert.equal(method, "GET", "verifier must stay read-only");
    if (url.pathname === `/api/v1/sites/${siteId}`) return response(200, this.site, rawUrl);
    if (url.pathname === `/api/v1/sites/${siteId}/deploys/${deployId}`) return response(200, this.deploy, rawUrl);
    if (url.pathname === `/api/v1/sites/${siteId}/files`) return response(200, this.files, rawUrl);
    if (url.pathname.startsWith(`/api/v1/sites/${siteId}/files/`)) {
      const key = `/${url.pathname.slice(`/api/v1/sites/${siteId}/files/`.length).split("/").map(decodeURIComponent).join("/")}`;
      return this.raw.has(key) ? response(200, this.raw.get(key), rawUrl) : response(404, "", rawUrl);
    }
    if (url.pathname === `/api/v1/sites/${siteId}/snippets`) return response(200, this.snippets, rawUrl);
    if (url.pathname === `/api/v1/sites/${siteId}/forms`) return response(200, [{ id: formId, site_id: siteId, name: formName, paths: ["/contact/"] }], rawUrl);
    if (url.pathname === "/api/v1/hooks") return response(200, [{ id: hookId, site_id: siteId, type: "email", event: "submission_created", disabled: false,
      data: { email: recipientEmail, form_id: formId, form_name: formName } }], rawUrl);
    if (url.pathname === `/api/v1/forms/${formId}/submissions`) return response(200, [{ id: submissionId, created_at: publishedAt,
      site_url: siteUrl, data: { project_details: probe, "form-name": formName } }], rawUrl);
    return response(404, { error: rawUrl }, rawUrl);
  }
}

const fixture = buildFixture();
const mock = new MockNetlify(fixture);
const output = await runVerifier(fixture.input, mock.fetch.bind(mock), Buffer);
assert.equal(output.status, "LEAD_ROUTE_VERIFIED");
assert.equal(output.send_delivery_email, false);
assert.equal(output.state_write_allowed_by_this_step, false);
assert.equal(output.claim_invitation_allowed_by_this_step, false);
assert.equal(JSON.parse(output.lead_route_evidence).production_content_sha256, framed(fixture.pages));
assert.equal(mock.requests.every(item => item.method === "GET"), true);
assert.equal(mock.requests.filter(item => /\/files\//.test(item.rawUrl)).length, 6, "all original raw artifacts must be read");
for (const secret of [netlifyToken, recipientEmail, probe, artifactSecret, leadSecret, inboxSecret]) assert.equal(JSON.stringify(output).includes(secret), false);

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const assetPath = `assets/${sha(png)}.png`;
const assetPages = basePages.map(page => page.path === "about/index.html"
  ? { ...page, bytes: Buffer.from(page.bytes.toString().replace("</body>", `<img src="/${assetPath}" alt="logo"></body>`)) } : page);
const withAsset = buildFixture({ pages: assetPages, mutateArtifacts: bundle => [bundle[0], { path: assetPath, bytes: png }, ...bundle.slice(1)] });
assert.equal((await runVerifier(withAsset.input, new MockNetlify(withAsset).fetch.bind(new MockNetlify(withAsset)), Buffer)).status, "LEAD_ROUTE_VERIFIED");
const assetTamper = new MockNetlify(withAsset);
assetTamper.live.set(new URL(`/${assetPath}`, siteUrl).toString(), Buffer.concat([png, Buffer.from("tamper")]));
await assert.rejects(runVerifier(withAsset.input, assetTamper.fetch.bind(assetTamper), Buffer), /live asset bytes changed|response too large/);

const liveTamperMock = new MockNetlify(fixture);
liveTamperMock.live.set(new URL("/about/", siteUrl).toString(), Buffer.from("tampered secondary page"));
await assert.rejects(runVerifier(fixture.input, liveTamperMock.fetch.bind(liveTamperMock), Buffer), /processed staging HTML|response too large/);
const rawTamperMock = new MockNetlify(fixture);
rawTamperMock.raw.set("/process/index.html", Buffer.from("tampered original"));
await assert.rejects(runVerifier(fixture.input, rawTamperMock.fetch.bind(rawTamperMock), Buffer), /original uploaded bytes changed|response too large/);
const snippetsMock = new MockNetlify(fixture); snippetsMock.snippets = [{ id: "injection" }];
await assert.rejects(runVerifier(fixture.input, snippetsMock.fetch.bind(snippetsMock), Buffer), /injection snippets are forbidden/);
await assert.rejects(runVerifier({ ...fixture.input, lead_route_recipient_hmac_sha256: "0".repeat(64) }, new MockNetlify(fixture).fetch.bind(new MockNetlify(fixture)), Buffer), /exact signed form or recipient HMAC/);

for (const mutateArtifacts of [
  bundle => bundle.filter(item => item.path !== "about/index.html"),
  bundle => [...bundle, { path: "extra/index.html", bytes: Buffer.from("extra") }],
  bundle => { const copy = [...bundle]; [copy[1], copy[2]] = [copy[2], copy[1]]; return copy; }
]) {
  const changed = buildFixture({ mutateArtifacts });
  let reads = 0;
  await assert.rejects(runVerifier(changed.input, async () => { reads += 1; throw new Error("unexpected read"); }, Buffer), /deploy artifact paths|deploy artifact set/);
  assert.equal(reads, 0);
}
const mixed = buildFixture({ artifactVersion: "arc2-handoff-artifact-evidence-v3" });
await assert.rejects(runVerifier(mixed.input, async () => { throw new Error("unexpected read"); }, Buffer), /evidence bindings|HMAC/);
await assert.rejects(runVerifier({ ...fixture.input, artifact_manifest_sha256: "0".repeat(64) }, async () => { throw new Error("unexpected read"); }, Buffer), /resolver artifact bytes changed/);

const wrongActionPages = basePages.map(page => page.path === "contact/index.html"
  ? { ...page, bytes: Buffer.from(page.bytes.toString().replace("/contact/?submitted=1", "/?submitted=1")) } : page);
const wrongAction = buildFixture({ pages: wrongActionPages });
await assert.rejects(runVerifier(wrongAction.input, async () => { throw new Error("unexpected read"); }, Buffer), /Contact form attributes mismatch/);
const extraFormPages = basePages.map(page => page.path === "about/index.html" ? { ...page, bytes: Buffer.from(page.bytes.toString().replace("</body>", "<form></form></body>")) } : page);
const extraForm = buildFixture({ pages: extraFormPages });
await assert.rejects(runVerifier(extraForm.input, async () => { throw new Error("unexpected read"); }, Buffer), /only on Contact/);
const missingDisclosurePages = basePages.map(page => page.path === "contact/index.html"
  ? { ...page, bytes: Buffer.from(page.bytes.toString().replace(`<p class="form-status" role="note">${disclosure}</p>`, "")) } : page);
const missingDisclosure = buildFixture({ pages: missingDisclosurePages });
await assert.rejects(runVerifier(missingDisclosure.input, async () => { throw new Error("unexpected read"); }, Buffer), /exact visible lead privacy disclosure/);

const staleInbox = { ...fixture.inbox, inbox_received_timestamp: new Date(Date.now() - 31 * 60_000).toISOString() };
const staleRaw = canonical(staleInbox);
await assert.rejects(runVerifier({ ...fixture.input, inbox_receipt_evidence: staleRaw,
  inbox_receipt_evidence_hmac_sha256: createHmac("sha256", inboxSecret).update(`arc-inbox-receipt-evidence-signature-v1\n${staleRaw}`).digest("hex") },
new MockNetlify(fixture).fetch.bind(new MockNetlify(fixture)), Buffer), /stale or not exactly bound/);

const noFormPages = basePages.map(page => page.path === "contact/index.html" ? { ...page, bytes: Buffer.from(pageHtml(page.path, "<main>Call us</main>")) } : page);
const noForm = buildFixture({ pages: noFormPages, mode: "not_required" });
const noFormMock = new MockNetlify(noForm);
const bypass = await runVerifier(noForm.input, noFormMock.fetch.bind(noFormMock), Buffer);
assert.equal(bypass.status, "LEAD_ROUTE_NOT_REQUIRED");
assert.equal(bypass.lead_route_evidence, "");
assert.equal(bypass.send_delivery_email, false);
assert.equal(noFormMock.requests.some(item => /\/forms|\/hooks|\/submissions/.test(item.rawUrl)), false, "no-form mode must bypass form/inbox APIs");
assert.equal(noFormMock.requests.filter(item => /\/files\//.test(item.rawUrl)).length, 6, "no-form bypass still verifies all uploaded bytes");

console.log("ARC2 five-page read-only lead-route staging contract passed");
