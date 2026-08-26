// ARC2 read-only five-page lead-route verifier.
// The handoff service owns deploy/state mutations; this step performs GETs only.
const clean = value => String(value == null ? "" : value).trim();
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const HTML_PATHS = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"];
const HTML_PATH_SET = new Set(HTML_PATHS);
const ASSET_PATH = /^assets\/([a-f0-9]{64})\.(png|jpg|webp)$/;
const netlifyToken = clean(inputData.netlify_access_token);
const artifactSecret = clean(inputData.handoff_artifact_evidence_secret);
const artifactEvidencePrivate = clean(inputData.handoff_artifact_evidence_private);
const artifactSignature = clean(inputData.handoff_artifact_evidence_hmac_sha256).toLowerCase();
const accountId = clean(inputData.expected_netlify_account_id);
const previewFolder = clean(inputData.preview_folder).replace(/^\/+|\/+$/g, "").toLowerCase();
const siteId = clean(inputData.staging_site_id).toLowerCase();
const deployId = clean(inputData.staging_deploy_id).toLowerCase();
const expectedProductionSha256 = clean(inputData.production_content_sha256).toLowerCase();
const expectedManifestSha256 = clean(inputData.artifact_manifest_sha256).toLowerCase();
const expectedBundleFingerprint = clean(inputData.bundle_fingerprint).toLowerCase();
const externalId = value => /^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
if (!netlifyToken || artifactSecret.length < 32 || artifactSecret.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(accountId) || !/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder) ||
    !externalId(siteId) || !externalId(deployId)) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: immutable site inputs");
if (![expectedProductionSha256, expectedManifestSha256, expectedBundleFingerprint].every(value => /^[a-f0-9]{64}$/.test(value))) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: artifact SHA-256");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof TextDecoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256 and SHA-256 are required");
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const digestBytes = async (algorithm, value) => {
  const digest = await globalThis.crypto.subtle.digest(algorithm, value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const sha256Bytes = value => digestBytes("SHA-256", value);
const sha256Hex = value => sha256Bytes(encoder.encode(value));
const sha1Bytes = value => digestBytes("SHA-1", value);
const importHmacKey = (secret, usages) => globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
const signatureBytes = (signature, label) => {
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error(`${label}: evidence HMAC`);
  return Uint8Array.from(signature.match(/../g), byte => Number.parseInt(byte, 16));
};
const decodeBase64 = (value, label) => {
  const normalized = clean(value).replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label} base64`);
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label} base64`);
  return bytes;
};
const framedDigest = entries => sha256Bytes(Buffer.concat(entries.flatMap(entry => [Buffer.from(`${entry.path}\0`), entry.bytes, Buffer.from("\0")])));

const deployArtifactsRaw = clean(inputData.deploy_artifacts_private);
let deployArtifactValues;
if (deployArtifactsRaw.length > 4_700_000) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: deploy artifacts exceed bounded envelope");
try { deployArtifactValues = JSON.parse(deployArtifactsRaw); } catch { throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: deploy artifacts JSON"); }
if (!Array.isArray(deployArtifactValues) || deployArtifactValues.length < 6 || deployArtifactValues.length > 9 || canonicalJson(deployArtifactValues) !== deployArtifactsRaw) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: deploy artifact set");
}
const paths = deployArtifactValues.map(item => item?.path);
const htmlStart = paths.length - 5;
const assetPaths = paths.slice(1, htmlStart);
if (paths[0] !== "_headers" || JSON.stringify(paths.slice(htmlStart)) !== JSON.stringify(HTML_PATHS) || new Set(paths).size !== paths.length ||
    assetPaths.some(path => !ASSET_PATH.test(path)) || JSON.stringify(assetPaths) !== JSON.stringify([...assetPaths].sort())) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: deploy artifact paths");
}
const artifacts = deployArtifactValues.map(item => {
  if (!item || typeof item !== "object" || Array.isArray(item) || JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(["content_base64", "path"]) ||
      clean(item.content_base64).length > 1_700_000) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: deploy artifact fields");
  return { path: item.path, bytes: decodeBase64(item.content_base64, item.path) };
});
const headersArtifact = artifacts[0];
const assetArtifacts = artifacts.slice(1, htmlStart);
const pageArtifacts = artifacts.slice(htmlStart);
const totalBytes = artifacts.reduce((sum, item) => sum + item.bytes.length, 0);
const totalAssetBytes = assetArtifacts.reduce((sum, item) => sum + item.bytes.length, 0);
const totalHtmlBytes = pageArtifacts.reduce((sum, item) => sum + item.bytes.length, 0);
if (totalBytes > 3_510_000 || totalAssetBytes > 3_000_000 || totalHtmlBytes > 500_000 || headersArtifact.bytes.length < 1 || headersArtifact.bytes.length > 10_000 ||
    pageArtifacts.some(page => page.bytes.length < 1 || page.bytes.length > 150_000) || assetArtifacts.some(asset => asset.bytes.length < 1 || asset.bytes.length > 1_250_000)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: deploy artifact aggregate");
}
const pages = pageArtifacts.map(page => {
  try { return { ...page, html: decoder.decode(page.bytes) }; } catch { throw new Error("ARC_ARTIFACT_INVALID: production HTML must be valid UTF-8"); }
});
const csp = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const productionHeaders = `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
const preclaimHeaders = `${productionHeaders}  X-Robots-Tag: noindex, nofollow, noarchive\n`;
if (headersArtifact.bytes.toString("utf8") !== productionHeaders) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: signed production headers are not the exact indexable security policy");
const manifest = [];
for (const artifact of artifacts) manifest.push({ path: artifact.path, sha256: await sha256Bytes(artifact.bytes), size: artifact.bytes.length });
const manifestPrivate = canonicalJson(manifest);
const manifestSha256 = await sha256Hex(manifestPrivate);
const productionSha256 = await framedDigest(pageArtifacts);
const bundleFingerprint = await framedDigest(artifacts);
if (productionSha256 !== expectedProductionSha256 || manifestSha256 !== expectedManifestSha256 || bundleFingerprint !== expectedBundleFingerprint) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: resolver artifact bytes changed");
}

let artifactEvidence;
try { artifactEvidence = JSON.parse(artifactEvidencePrivate); } catch { throw new Error("ARC_ARTIFACT_INVALID: evidence JSON"); }
const artifactFields = ["approval_content_sha256", "artifact_manifest_sha256", "artifacts", "asset_publication_receipt_sha256", "bundle_fingerprint",
  "checkout_binding_key_id", "checkout_config_snapshot_sha256", "checkout_reference_sha256", "issued_at", "lead_route_form_name", "lead_route_mode",
  "lead_route_recipient_hmac_sha256", "preview_folder", "preview_source_commit_sha", "preview_source_repository", "preview_source_tag_sha256",
  "production_content_sha256", "scope", "version"];
const issuedAt = clean(artifactEvidence?.issued_at);
const issuedMs = Date.parse(issuedAt);
const leadRouteMode = clean(artifactEvidence?.lead_route_mode);
if (!artifactEvidence || typeof artifactEvidence !== "object" || Array.isArray(artifactEvidence) || JSON.stringify(Object.keys(artifactEvidence).sort()) !== JSON.stringify(artifactFields) ||
    canonicalJson(artifactEvidence) !== artifactEvidencePrivate || artifactEvidence.version !== "arc2-handoff-artifact-evidence-v4" ||
    artifactEvidence.scope !== "netlify-claimable-deploy-artifacts" || artifactEvidence.preview_folder !== previewFolder ||
    !/^[a-f0-9]{2}$/.test(artifactEvidence.checkout_binding_key_id) || !/^[a-f0-9]{40}$/.test(artifactEvidence.preview_source_commit_sha) ||
    artifactEvidence.preview_source_repository !== "arcwebhq-cpu/arc-previews" ||
    ["approval_content_sha256", "asset_publication_receipt_sha256", "checkout_config_snapshot_sha256", "checkout_reference_sha256", "preview_source_tag_sha256"]
      .some(field => !/^[a-f0-9]{64}$/.test(clean(artifactEvidence[field]))) || !["netlify_form", "not_required"].includes(leadRouteMode) ||
    artifactEvidence.production_content_sha256 !== productionSha256 || artifactEvidence.artifact_manifest_sha256 !== manifestSha256 ||
    artifactEvidence.bundle_fingerprint !== bundleFingerprint || canonicalJson(artifactEvidence.artifacts) !== manifestPrivate ||
    !Number.isFinite(issuedMs) || new Date(issuedMs).toISOString() !== issuedAt || issuedMs > Date.now() + 300_000) {
  throw new Error("ARC_ARTIFACT_INVALID: evidence bindings");
}
if (!(await globalThis.crypto.subtle.verify("HMAC", await importHmacKey(artifactSecret, ["verify"]), signatureBytes(artifactSignature, "ARC_ARTIFACT_INVALID"),
  encoder.encode(`arc2-handoff-artifact-evidence-signature-v4\n${artifactEvidencePrivate}`)))) throw new Error("ARC_ARTIFACT_INVALID: evidence HMAC mismatch");
const artifactEvidenceSha256 = await sha256Hex(artifactEvidencePrivate);
for (const asset of assetArtifacts) {
  const match = asset.path.match(ASSET_PATH); const extension = match?.[2];
  const magic = extension === "png" ? asset.bytes.length >= 8 && asset.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : extension === "jpg" ? asset.bytes.length >= 4 && asset.bytes[0] === 255 && asset.bytes[1] === 216 && asset.bytes.at(-2) === 255 && asset.bytes.at(-1) === 217
      : asset.bytes.length >= 20 && asset.bytes.subarray(0,4).toString("ascii") === "RIFF" && asset.bytes.subarray(8,12).toString("ascii") === "WEBP" && asset.bytes.readUInt32LE(4) + 8 === asset.bytes.length;
  if (!match || await sha256Bytes(asset.bytes) !== match[1] || !magic) throw new Error("ARC_ARTIFACT_INVALID: content-addressed asset bytes");
}
const referencedAssets = new Set();
for (const page of pages) {
  if (/https:\/\/arcwebhq-cpu\.github\.io\/arc-previews(?:\/|["'?#]|$)/i.test(page.html) || /<base\b/i.test(page.html)) throw new Error("ARC_ARTIFACT_INVALID: production retains preview-host or base dependency");
  for (const match of page.html.matchAll(/assets\/[^"'()\s<>]*/gi)) {
    const slash = match.index - 1; const preceding = slash > 0 ? page.html[slash - 1] : "";
    const candidate = slash >= 0 && page.html[slash] === "/" ? `/${match[0]}` : match[0];
    if (slash < 0 || page.html[slash] !== "/" || (slash > 0 && !/["'(=,\s]/.test(preceding)) || !/^\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(candidate)) {
      throw new Error("ARC_ARTIFACT_INVALID: non-root-relative or unbound local asset reference");
    }
    referencedAssets.add(candidate.slice(1));
  }
}
const includedAssets = new Set(assetArtifacts.map(item => item.path));
if (referencedAssets.size !== includedAssets.size || [...referencedAssets].some(path => !includedAssets.has(path)) || [...includedAssets].some(path => !referencedAssets.has(path))) {
  throw new Error("ARC_ARTIFACT_INVALID: production asset references");
}

const formName = clean(inputData.lead_route_form_name);
const recipientHmac = clean(inputData.lead_route_recipient_hmac_sha256).toLowerCase();
const contact = pages.find(page => page.path === "contact/index.html");
const leadDisclosureHtml = '<p class="form-status" role="note">By submitting this form, you agree that this business may contact you about your request. Do not include sensitive personal, medical, legal, or financial information.</p>';
if (pages.some(page => page.path !== "contact/index.html" && /<form\b|\bformaction\b/i.test(page.html))) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: lead forms and formaction are permitted only on Contact");
}
const exactAttribute = (attributes, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentions = [...attributes.matchAll(new RegExp(`(?:^|\\s)${escaped}(?=\\s|=|$)`, "gi"))];
  const values = [...attributes.matchAll(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([^"']*)\\1`, "gi"))];
  if (mentions.length !== 1 || values.length !== 1) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: Contact form attributes");
  return values[0][2];
};
const expectedProcessed = new Map(pages.map(page => [page.path, page.html]));
if (leadRouteMode === "netlify_form") {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(formName) || formName !== artifactEvidence.lead_route_form_name ||
      !/^[a-f0-9]{64}$/.test(recipientHmac) || recipientHmac !== artifactEvidence.lead_route_recipient_hmac_sha256) {
    throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exact signed form or recipient HMAC");
  }
  const forms = [...contact.html.matchAll(/<form\b([^>]*)>[\s\S]*?<\/form\s*>/gi)];
  if (forms.length !== 1 || /\bformaction\b/i.test(contact.html)) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exactly one Contact form without formaction is required");
  const attrs = forms[0][1];
  if (exactAttribute(attrs, "name") !== formName || exactAttribute(attrs, "method").toUpperCase() !== "POST" || exactAttribute(attrs, "data-netlify").toLowerCase() !== "true" ||
      exactAttribute(attrs, "netlify-honeypot") !== "bot-field" || exactAttribute(attrs, "action") !== "/contact/?submitted=1") {
    throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: Contact form attributes mismatch");
  }
  const hidden = [...contact.html.matchAll(/<input\b([^>]*)>/gi)].filter(match => /(?:^|\s)name\s*=\s*(?:"form-name"|'form-name'|form-name)(?=\s|\/|$)/i.test(match[1]));
  if (hidden.length !== 1 || exactAttribute(hidden[0][1], "name") !== "form-name" || exactAttribute(hidden[0][1], "type").toLowerCase() !== "hidden" ||
      exactAttribute(hidden[0][1], "value") !== formName) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: hidden Contact form binding");
  if (!forms[0][0].includes(leadDisclosureHtml)) {
    throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exact visible lead privacy disclosure is required");
  }
  expectedProcessed.set("contact/index.html", contact.html.replace(/\sdata-netlify=(?:"true"|'true')/i, "").replace(/\snetlify-honeypot=(?:"bot-field"|'bot-field')/i, ""));
} else if (formName || recipientHmac || artifactEvidence.lead_route_form_name || artifactEvidence.lead_route_recipient_hmac_sha256 || pages.some(page => /<form\b/i.test(page.html))) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: no-form bypass contains unexpected lead-route data");
}

const apiBase = "https://api.netlify.com/api/v1";
const apiHeaders = { Accept: "application/json", Authorization: `Bearer ${netlifyToken}` };
const timeoutInput = clean(inputData.provider_operation_timeout_ms);
const operationTimeoutMs = timeoutInput ? Number(timeoutInput) : 20_000;
if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 25 || operationTimeoutMs > 25_000) throw new Error("ARC_NETLIFY_READ_FAILED: operation timeout is invalid");
const deadlineMs = Date.now() + operationTimeoutMs;
const fetchBounded = async (url, options, maximumBytes, validate) => {
  const remaining = Math.min(10_000, Math.floor(deadlineMs - Date.now()));
  if (remaining <= 0) throw new Error("ARC_NETLIFY_READ_FAILED: operation deadline exceeded");
  const controller = new AbortController(); let timedOut = false; let reader;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, remaining);
  try {
    const response = await fetch(url, { ...options, redirect: "error", signal: controller.signal });
    validate(response);
    const declared = response.headers?.get?.("content-length");
    if (declared && (!/^\d{1,9}$/.test(declared) || Number(declared) > maximumBytes)) throw new Error("ARC_NETLIFY_READ_FAILED: response too large");
    reader = response.body?.getReader?.();
    if (!reader) throw new Error("ARC_NETLIFY_READ_FAILED: streaming response body required");
    const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("ARC_NETLIFY_READ_FAILED: invalid response chunk");
      total += value.byteLength;
      if (total > maximumBytes) { try { await reader.cancel(); } catch {} throw new Error("ARC_NETLIFY_READ_FAILED: response too large"); }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
    return { response, bytes: Buffer.concat(chunks, total) };
  } catch (error) {
    if (timedOut || error?.name === "AbortError") throw new Error("ARC_NETLIFY_READ_FAILED: bounded timeout exceeded");
    throw error;
  } finally { clearTimeout(timer); try { reader?.releaseLock?.(); } catch {} }
};
const readJson = async (path, maximumBytes) => {
  const { bytes } = await fetchBounded(`${apiBase}${path}`, { method: "GET", headers: apiHeaders }, maximumBytes,
    response => { if (!response.ok) throw new Error(`ARC_NETLIFY_READ_FAILED: ${response.status} ${path}`); });
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error("ARC_NETLIFY_READ_FAILED: response JSON invalid"); }
};
const readRaw = async (path, maximumBytes) => (await fetchBounded(`${apiBase}${path}`, { method: "GET", headers: {
  ...apiHeaders, Accept: "application/vnd.bitballoon.v1.raw", "Content-Type": "application/vnd.bitballoon.v1.raw"
}}, maximumBytes, response => { if (!response.ok) throw new Error(`ARC_NETLIFY_READ_FAILED: ${response.status} ${path}`); })).bytes;
const plainHttpsRoot = (value, label) => {
  let url; try { url = new URL(clean(value)); } catch { throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label} URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label} must be a plain HTTPS root URL`);
  return url;
};

const site = await readJson(`/sites/${encodeURIComponent(siteId)}`, 256_000);
const siteName = clean(site.name).toLowerCase();
const siteUrl = plainHttpsRoot(site.ssl_url || site.url, "staging site");
if (clean(site.id).toLowerCase() !== siteId || clean(site.account_id) !== accountId || !/^arc-lead-route-[a-z0-9-]{1,40}$/.test(siteName) ||
    siteUrl.hostname.toLowerCase() !== `${siteName}.netlify.app` || clean(site.state).toLowerCase() === "disabled" ||
    plainHttpsRoot(inputData.staging_site_url, "requested staging site").toString() !== siteUrl.toString()) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: ARC-controlled site identity mismatch");
}
const deploy = await readJson(`/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}`, 256_000);
const immutableDeployUrl = plainHttpsRoot(deploy.deploy_ssl_url || deploy.deploy_url, "immutable staging deploy");
const deployPublishedAt = clean(deploy.published_at);
const deployPublishedMs = Date.parse(deployPublishedAt);
if (clean(deploy.id).toLowerCase() !== deployId || clean(deploy.site_id).toLowerCase() !== siteId || clean(deploy.state).toLowerCase() !== "ready" ||
    clean(deploy.name).toLowerCase() !== siteName || plainHttpsRoot(deploy.ssl_url || deploy.url, "staging deploy").toString() !== siteUrl.toString() ||
    clean(site.published_deploy?.id).toLowerCase() !== deployId || immutableDeployUrl.hostname.toLowerCase() !== `${deployId}--${siteName}.netlify.app` ||
    !Number.isFinite(deployPublishedMs) || new Date(deployPublishedMs).toISOString() !== deployPublishedAt ||
    !Array.isArray(deploy.required) || deploy.required.length || !Array.isArray(deploy.required_functions) || deploy.required_functions.length ||
    !Array.isArray(deploy.required_edge_functions) || deploy.required_edge_functions.length || !Array.isArray(deploy.function_schedules) || deploy.function_schedules.length) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exact published deploy identity mismatch");
}

const stagingArtifacts = artifacts.map((artifact, index) => index === 0 ? { ...artifact, bytes: Buffer.from(preclaimHeaders) } : artifact);
const expectedFiles = [];
for (const artifact of stagingArtifacts) expectedFiles.push({
  path: `/${artifact.path}`, bytes: artifact.bytes, sha: await sha1Bytes(artifact.bytes), size: artifact.bytes.length,
  mime_type: HTML_PATH_SET.has(artifact.path) ? "text/html" : artifact.path === "_headers" ? "text/plain"
    : artifact.path.endsWith(".png") ? "image/png" : artifact.path.endsWith(".jpg") ? "image/jpeg" : "image/webp"
});
const deployFiles = await readJson(`/sites/${encodeURIComponent(siteId)}/files`, 2_000_000);
if (!Array.isArray(deployFiles) || deployFiles.length !== expectedFiles.length) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: current deploy file manifest is not the exact claimable bundle");
const normalizedManifest = [];
for (const expected of expectedFiles) {
  const matches = deployFiles.filter(file => clean(file.path || file.id) === expected.path);
  if (matches.length !== 1 || clean(matches[0].sha).toLowerCase() !== expected.sha || Number(matches[0].size) !== expected.size ||
      clean(matches[0].mime_type).toLowerCase() !== expected.mime_type) throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: source manifest mismatch for ${expected.path}`);
  const rawPath = `/sites/${encodeURIComponent(siteId)}/files/${expected.path.slice(1).split("/").map(encodeURIComponent).join("/")}`;
  if (!(await readRaw(rawPath, expected.size)).equals(expected.bytes)) throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: original uploaded bytes changed for ${expected.path}`);
  normalizedManifest.push({ path: expected.path, sha: expected.sha, size: expected.size, mime_type: expected.mime_type });
}
normalizedManifest.sort((first, second) => first.path.localeCompare(second.path));
const deployFileManifestSha256 = await sha256Hex(JSON.stringify(normalizedManifest));
const snippets = await readJson(`/sites/${encodeURIComponent(siteId)}/snippets`, 512_000);
if (!Array.isArray(snippets) || snippets.length) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: staging site HTML injection snippets are forbidden");

const pageUrl = (root, path) => new URL(path === "index.html" ? "/" : `/${path.replace(/index\.html$/, "")}`, root).toString();
const servedPages = [];
let robotsHeader = "";
for (const root of [immutableDeployUrl, siteUrl]) {
  for (const page of pages) {
    const liveUrl = pageUrl(root, page.path);
    const { response, bytes } = await fetchBounded(liveUrl, { method: "GET", headers: { Accept: "text/html" } }, page.bytes.length + 4096,
      observed => { if (observed.status !== 200) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: live processed page is unavailable"); });
    const robots = clean(response.headers?.get?.("x-robots-tag")).toLowerCase().split(",").map(value => value.trim()).filter(Boolean).sort();
    if ((response.url && response.url !== liveUrl) || bytes.toString("utf8") !== expectedProcessed.get(page.path) ||
        !["noarchive", "nofollow", "noindex"].every(token => robots.includes(token)) || clean(response.headers?.get?.("content-security-policy")) !== csp ||
        clean(response.headers?.get?.("x-content-type-options")).toLowerCase() !== "nosniff" || clean(response.headers?.get?.("x-frame-options")).toUpperCase() !== "DENY") {
      throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: processed staging HTML or staging-only response headers changed");
    }
    if (root === immutableDeployUrl) servedPages.push({ path: page.path, bytes });
    else if (!bytes.equals(servedPages.find(item => item.path === page.path)?.bytes)) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: mutable and immutable staging responses disagree");
    const normalizedRobots = robots.join(",");
    if (!robotsHeader) robotsHeader = normalizedRobots;
    else if (robotsHeader !== normalizedRobots) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: staging page robots headers disagree");
  }
  for (const asset of assetArtifacts) {
    const liveUrl = new URL(`/${asset.path}`, root).toString();
    const expectedType = asset.path.endsWith(".png") ? "image/png" : asset.path.endsWith(".jpg") ? "image/jpeg" : "image/webp";
    const { response, bytes } = await fetchBounded(liveUrl, { method: "GET" }, asset.bytes.length, observed => {
      if (observed.status !== 200 || clean(observed.headers?.get?.("content-type")).toLowerCase().split(";", 1)[0] !== expectedType) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: live asset bytes changed");
    });
    if ((response.url && response.url !== liveUrl) || !bytes.equals(asset.bytes)) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: live asset bytes changed");
  }
}
const servedHtmlSha256 = await framedDigest(servedPages);
const robotsHeaderSha256 = await sha256Hex(robotsHeader);

if (leadRouteMode === "not_required") {
  return {
    status: "LEAD_ROUTE_NOT_REQUIRED", lead_route_mode: "not_required", claim_invitation_allowed_by_this_step: false,
    send_delivery_email: false, github_write_allowed_by_this_step: false, state_write_allowed_by_this_step: false,
    evidence_requires_downstream_reverification: true, preview_folder: previewFolder, production_content_sha256: productionSha256,
    artifact_manifest_sha256: manifestSha256, handoff_artifact_evidence_sha256: artifactEvidenceSha256,
    bundle_fingerprint: bundleFingerprint, staging_site_id: siteId, staging_deploy_id: deployId,
    deploy_file_manifest_sha256: deployFileManifestSha256, served_html_sha256: servedHtmlSha256,
    staging_robots_header_sha256: robotsHeaderSha256, lead_route_evidence: "", lead_route_evidence_hmac_sha256: ""
  };
}

const leadSecret = clean(inputData.lead_route_evidence_secret);
const inboxSecret = clean(inputData.inbox_receipt_evidence_secret);
const inboxSignature = clean(inputData.inbox_receipt_evidence_hmac_sha256).toLowerCase();
const hookId = clean(inputData.notification_hook_id).toLowerCase();
const submissionId = clean(inputData.synthetic_submission_id).toLowerCase();
const probe = clean(inputData.synthetic_probe_token);
const recipientEmail = clean(inputData.verified_lead_notification_email).toLowerCase();
if (leadSecret.length < 32 || leadSecret.length > 256 || inboxSecret.length < 32 || inboxSecret.length > 256 ||
    new Set([leadSecret, inboxSecret, artifactSecret]).size !== 3 || !externalId(hookId) || !externalId(submissionId) ||
    probe.length < 32 || probe.length > 128 || !/^[A-Za-z0-9_-]+$/.test(probe) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: form-mode private verification inputs");
}
const forms = await readJson(`/sites/${encodeURIComponent(siteId)}/forms`, 1_000_000);
const matchingForms = (Array.isArray(forms) ? forms : []).filter(item => clean(item.site_id).toLowerCase() === siteId && clean(item.name) === formName &&
  externalId(item.id) && Array.isArray(item.paths) && item.paths.length === 1 && clean(item.paths[0]) === "/contact/");
if (matchingForms.length !== 1) throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: expected one exact Contact form; found ${matchingForms.length}`);
const formId = clean(matchingForms[0].id).toLowerCase();
const hooks = await readJson(`/hooks?site_id=${encodeURIComponent(siteId)}&per_page=100`, 1_000_000);
const matchingHooks = (Array.isArray(hooks) ? hooks : []).filter(hook => {
  const data = hook && typeof hook.data === "object" && !Array.isArray(hook.data) ? hook.data : {};
  return clean(hook.id).toLowerCase() === hookId && clean(hook.site_id).toLowerCase() === siteId && clean(hook.type).toLowerCase() === "email" && hook.disabled !== true &&
    clean(hook.event).toLowerCase() === "submission_created" && clean(data.email || data.recipient || data.email_to).toLowerCase() === recipientEmail &&
    clean(data.form_id).toLowerCase() === formId && (!clean(data.form_name) || clean(data.form_name) === formName);
});
if (matchingHooks.length !== 1) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exact enabled recipient notification hook not found");
const submissions = await readJson(`/forms/${encodeURIComponent(formId)}/submissions?per_page=100&page=1`, 2_000_000);
const matches = (Array.isArray(submissions) ? submissions : []).filter(item => clean(item.id).toLowerCase() === submissionId);
if (matches.length !== 1) throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: expected one synthetic submission; found ${matches.length}`);
const submission = matches[0];
const submissionData = submission && typeof submission.data === "object" && !Array.isArray(submission.data) ? submission.data : {};
if (clean(submissionData.project_details) !== probe || clean(submissionData["form-name"]) !== formName || plainHttpsRoot(submission.site_url, "submission site").toString() !== siteUrl.toString()) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: synthetic submission is not bound to this site and probe");
}
const submittedAt = clean(submission.created_at); const submittedMs = Date.parse(submittedAt);
if (!Number.isFinite(submittedMs) || new Date(submittedMs).toISOString() !== submittedAt || submittedMs > Date.now() + 300_000 || submittedMs < Date.now() - 1_800_000 || submittedMs < deployPublishedMs) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: synthetic submission receipt is stale or invalid");
}
const probeSha256 = await sha256Hex(probe);
const inboxRaw = clean(inputData.inbox_receipt_evidence);
let inbox;
try { inbox = JSON.parse(inboxRaw); } catch { throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence JSON"); }
const inboxFields = ["account_hmac_sha256", "inbox_received_timestamp", "message_id_hmac_sha256", "provider", "recipient_hmac_sha256", "scope", "synthetic_probe_sha256", "synthetic_submission_id", "version"];
const inboxAt = clean(inbox?.inbox_received_timestamp); const inboxMs = Date.parse(inboxAt);
if (!inbox || typeof inbox !== "object" || Array.isArray(inbox) || JSON.stringify(Object.keys(inbox).sort()) !== JSON.stringify(inboxFields) || canonicalJson(inbox) !== inboxRaw ||
    inbox.version !== "arc-inbox-receipt-evidence-v1" || inbox.scope !== "authoritative-inbox-delivery" || !/^[a-z0-9][a-z0-9_.-]{1,63}$/.test(inbox.provider) ||
    ![inbox.account_hmac_sha256, inbox.message_id_hmac_sha256].every(value => /^[a-f0-9]{64}$/.test(value)) || inbox.recipient_hmac_sha256 !== recipientHmac ||
    inbox.synthetic_submission_id !== submissionId || inbox.synthetic_probe_sha256 !== probeSha256 || !Number.isFinite(inboxMs) || new Date(inboxMs).toISOString() !== inboxAt ||
    inboxMs < submittedMs || inboxMs > Date.now() + 300_000 || inboxMs < Date.now() - 1_800_000) throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence is stale or not exactly bound");
if (!(await globalThis.crypto.subtle.verify("HMAC", await importHmacKey(inboxSecret, ["verify"]), signatureBytes(inboxSignature, "ARC_INBOX_RECEIPT_INVALID"),
  encoder.encode(`arc-inbox-receipt-evidence-signature-v1\n${inboxRaw}`)))) throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence HMAC mismatch");
const inboxSha256 = await sha256Hex(inboxRaw);
const evidence = {
  version: "arc-lead-route-evidence-v1", scope: "arc-controlled-netlify-staging", preview_folder: previewFolder,
  production_content_sha256: productionSha256, artifact_manifest_sha256: manifestSha256, handoff_artifact_evidence_sha256: artifactEvidenceSha256,
  bundle_fingerprint: bundleFingerprint, netlify_account_id: accountId, staging_site_id: siteId, staging_site_url: siteUrl.toString(),
  staging_deploy_id: deployId, staging_deploy_url: immutableDeployUrl.toString(), deploy_file_manifest_sha256: deployFileManifestSha256,
  served_html_sha256: servedHtmlSha256, staging_robots_header_sha256: robotsHeaderSha256, staging_form_id: formId,
  notification_hook_id: hookId, form_name: formName, recipient_hmac_sha256: recipientHmac, synthetic_submission_id: submissionId,
  synthetic_probe_sha256: probeSha256, netlify_submission_timestamp: submittedAt, inbox_provider: inbox.provider,
  inbox_account_hmac_sha256: inbox.account_hmac_sha256, inbox_message_id_hmac_sha256: inbox.message_id_hmac_sha256,
  inbox_received_timestamp: inboxAt, inbox_receipt_evidence_sha256: inboxSha256
};
const evidencePrivate = JSON.stringify(evidence);
const signed = await globalThis.crypto.subtle.sign("HMAC", await importHmacKey(leadSecret, ["sign"]), encoder.encode(`arc-lead-route-evidence-signature-v1\n${evidencePrivate}`));
const evidenceHmac = [...new Uint8Array(signed)].map(byte => byte.toString(16).padStart(2, "0")).join("");
return {
  status: "LEAD_ROUTE_VERIFIED", lead_route_mode: "netlify_form", claim_invitation_allowed_by_this_step: false,
  send_delivery_email: false, github_write_allowed_by_this_step: false, state_write_allowed_by_this_step: false,
  evidence_requires_downstream_reverification: true, preview_folder: previewFolder, lead_route_form_name: formName,
  lead_route_recipient_hmac_sha256: recipientHmac, lead_route_evidence: evidencePrivate, lead_route_evidence_hmac_sha256: evidenceHmac,
  lead_route_evidence_sha256: await sha256Hex(evidencePrivate), artifact_manifest_sha256: manifestSha256,
  handoff_artifact_evidence_sha256: artifactEvidenceSha256, staging_site_id: siteId, staging_deploy_id: deployId,
  staging_deploy_url: immutableDeployUrl.toString(), deploy_file_manifest_sha256: deployFileManifestSha256,
  served_html_sha256: servedHtmlSha256, staging_robots_header_sha256: robotsHeaderSha256, staging_form_id: formId,
  synthetic_submission_id: submissionId, netlify_submission_timestamp: submittedAt, inbox_provider: inbox.provider,
  inbox_account_hmac_sha256: inbox.account_hmac_sha256, inbox_message_id_hmac_sha256: inbox.message_id_hmac_sha256,
  inbox_received_timestamp: inboxAt, inbox_receipt_evidence_sha256: inboxSha256
};
