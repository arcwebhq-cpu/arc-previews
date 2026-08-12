// ARC2 read-only lead-route verifier — issue signed evidence only after authoritative Netlify reads.
// A separate step must already have created the temporary site/deploy and submitted the synthetic probe.
// This step performs GET requests only; it never deploys, submits, emails, publishes, or deletes anything.
const clean = value => String(value == null ? "" : value).trim();
const netlifyToken = clean(inputData.netlify_access_token);
const leadRouteEvidenceSecret = clean(inputData.lead_route_evidence_secret);
const inboxReceiptEvidenceSecret = clean(inputData.inbox_receipt_evidence_secret);
const inboxReceiptEvidenceSignature = clean(inputData.inbox_receipt_evidence_hmac_sha256).toLowerCase();
const expectedNetlifyAccountId = clean(inputData.expected_netlify_account_id);
const previewFolder = clean(inputData.preview_folder).replace(/^\/+|\/+$/g, "").toLowerCase();
const siteId = clean(inputData.staging_site_id).toLowerCase();
const deployId = clean(inputData.staging_deploy_id).toLowerCase();
const notificationHookId = clean(inputData.notification_hook_id).toLowerCase();
const syntheticSubmissionId = clean(inputData.synthetic_submission_id).toLowerCase();
const syntheticProbeToken = clean(inputData.synthetic_probe_token);
const expectedFormName = clean(inputData.lead_route_form_name);
const verifiedLeadNotificationEmail = clean(inputData.verified_lead_notification_email).toLowerCase();
const expectedRecipientHmacSha256 = clean(inputData.lead_route_recipient_hmac_sha256).toLowerCase();
const productionPath = clean(inputData.production_file_path).replace(/^\/+/, "");
const netlifyPath = clean(inputData.netlify_config_path).replace(/^\/+/, "");
const usagePath = clean(inputData.usage_guide_path).replace(/^\/+/, "");
const expectedProductionSha256 = clean(inputData.production_content_sha256).toLowerCase();
const expectedBundleFingerprint = clean(inputData.bundle_fingerprint).toLowerCase();

if (!netlifyToken) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: Netlify access token is required");
if (leadRouteEvidenceSecret.length < 32 || leadRouteEvidenceSecret.length > 256) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: evidence secret must be 32–256 characters");
}
if (inboxReceiptEvidenceSecret.length < 32 || inboxReceiptEvidenceSecret.length > 256) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence secret must be 32–256 characters");
}
if (inboxReceiptEvidenceSecret === leadRouteEvidenceSecret) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: inbox and lead-route signing secrets must be separate");
}
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(expectedNetlifyAccountId)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: expected ARC Netlify account id");
}
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: preview folder");
}
const externalId = value => /^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
for (const [label, value] of [
  ["staging site id", siteId],
  ["staging deploy id", deployId],
  ["notification hook id", notificationHookId],
  ["synthetic submission id", syntheticSubmissionId]
]) {
  if (!externalId(value)) throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label}`);
}
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(expectedFormName)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exact Netlify form name");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedLeadNotificationEmail)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: verified notification recipient");
}
if (syntheticProbeToken.length < 32 || syntheticProbeToken.length > 128 || !/^[A-Za-z0-9_-]+$/.test(syntheticProbeToken)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: synthetic probe token");
}
if (!/^[a-f0-9]{64}$/.test(expectedProductionSha256) || !/^[a-f0-9]{64}$/.test(expectedBundleFingerprint)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: artifact SHA-256");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256 and SHA-256 are required");
}
const encoder = new TextEncoder();
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const sha1Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-1", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const evidenceKey = await globalThis.crypto.subtle.importKey(
  "raw",
  encoder.encode(leadRouteEvidenceSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const inboxEvidenceKey = await globalThis.crypto.subtle.importKey(
  "raw",
  encoder.encode(inboxReceiptEvidenceSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["verify"]
);
const hmacHex = async value => {
  const bytes = await globalThis.crypto.subtle.sign("HMAC", evidenceKey, encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const decodeBase64 = (value, label) => {
  const normalized = clean(value).replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label} base64`);
  }
  return Buffer.from(normalized, "base64").toString("utf8");
};
const productionHtml = decodeBase64(inputData.production_content_base64, "production HTML");
const netlifyConfig = decodeBase64(inputData.netlify_config_base64, "Netlify config");
const usageGuide = decodeBase64(inputData.usage_guide_base64, "usage guide");
const deliveryRoot = `deliveries/${previewFolder}`;
const expectedPaths = [
  `${deliveryRoot}/index.html`,
  `${deliveryRoot}/netlify.toml`,
  `${deliveryRoot}/USAGE.md`
];
if (JSON.stringify([productionPath, netlifyPath, usagePath]) !== JSON.stringify(expectedPaths)) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: artifact paths escaped the exact delivery folder");
}
const artifacts = [
  { path: productionPath, content: productionHtml },
  { path: netlifyPath, content: netlifyConfig },
  { path: usagePath, content: usageGuide }
];
const productionSha256 = await sha256Hex(productionHtml);
const bundleFingerprint = await sha256Hex(artifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
if (productionSha256 !== expectedProductionSha256 || bundleFingerprint !== expectedBundleFingerprint) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: resolver artifact bytes changed");
}
const canonicalAttributes = (tag, tagName) => {
  const match = tag.match(new RegExp(`^<${tagName}\\b([\\s\\S]*?)>$`, "i"));
  if (!match) return null;
  const attributes = new Map();
  let remaining = match[1].trim();
  while (remaining) {
    const nameMatch = remaining.match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)/);
    if (!nameMatch || attributes.has(nameMatch[1].toLowerCase())) return null;
    const name = nameMatch[1].toLowerCase();
    remaining = remaining.slice(nameMatch[0].length).trimStart();
    let value = name;
    if (remaining.startsWith("=")) {
      remaining = remaining.slice(1).trimStart();
      if (remaining[0] !== '"') return null;
      const end = remaining.indexOf('"', 1);
      if (end < 0) return null;
      value = remaining.slice(1, end);
      remaining = remaining.slice(end + 1).trimStart();
    }
    attributes.set(name, value);
  }
  return attributes;
};
const supportedLeadControlNames = new Set(["form-name", "bot-field", "name", "email", "phone", "project_details"]);
const sourceFormBlocks = productionHtml.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
const sourceFormTags = productionHtml.match(/<form\b[^>]*>/gi) || [];
if (sourceFormBlocks.length !== 1 || sourceFormTags.length !== 1) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: production must contain exactly one Netlify-managed form");
}
const sourceFormAttributes = canonicalAttributes(sourceFormTags[0], "form");
const artifactFormName = clean(sourceFormAttributes?.get("name"));
const artifactHoneypot = clean(sourceFormAttributes?.get("netlify-honeypot"));
if (artifactFormName !== expectedFormName || !/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(artifactFormName) ||
    sourceFormAttributes?.get("method") !== "POST" || sourceFormAttributes?.get("data-netlify") !== "true" || artifactHoneypot !== "bot-field") {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: production form attributes mismatch");
}
const sourceControls = [];
for (const tag of sourceFormBlocks[0].match(/<(?:input|textarea|select|button)\b[^>]*>/gi) || []) {
  const tagName = tag.match(/^<([a-z]+)/i)?.[1].toLowerCase();
  const attributes = canonicalAttributes(tag, tagName);
  if (!attributes) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: malformed canonical lead control");
  const name = clean(attributes.get("name"));
  if (name) sourceControls.push({ tagName, name, attributes });
}
const sourceControlNames = sourceControls.map(control => control.name);
if (new Set(sourceControlNames).size !== sourceControlNames.length ||
    sourceControlNames.some(name => !supportedLeadControlNames.has(name)) ||
    [...supportedLeadControlNames].some(name => !sourceControlNames.includes(name))) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: duplicate, unsupported, or missing lead control");
}
const sourceControl = name => sourceControls.find(item => item.name === name);
const sourceType = name => clean(sourceControl(name)?.attributes.get("type")).toLowerCase();
const sourceRequired = name => sourceControl(name)?.attributes.has("required");
if (sourceControl("form-name")?.tagName !== "input" || sourceType("form-name") !== "hidden" ||
    clean(sourceControl("form-name")?.attributes.get("value")) !== artifactFormName ||
    sourceControl(artifactHoneypot)?.tagName !== "input" || !new Set(["", "text"]).has(sourceType(artifactHoneypot)) ||
    sourceControl("name")?.tagName !== "input" || sourceType("name") !== "text" || !sourceRequired("name") ||
    sourceControl("email")?.tagName !== "input" || sourceType("email") !== "email" || !sourceRequired("email") ||
    sourceControl("phone")?.tagName !== "input" || sourceType("phone") !== "tel" ||
    sourceControl("project_details")?.tagName !== "textarea" || !sourceRequired("project_details") ||
    (sourceFormBlocks[0].match(/<button\b[^>]*type="submit"[^>]*>/gi) || []).length !== 1) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: lead control semantics do not match the supported schema");
}
const recipientHmacSha256 = await hmacHex(`arc-lead-route-recipient-v1\n${verifiedLeadNotificationEmail}`);
if (recipientHmacSha256 !== expectedRecipientHmacSha256) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: resolver recipient HMAC mismatch");
}

const apiBase = "https://api.netlify.com/api/v1";
const apiHeaders = {
  Accept: "application/json",
  Authorization: `Bearer ${netlifyToken}`
};
const readJson = async path => {
  const response = await fetch(`${apiBase}${path}`, { method: "GET", headers: apiHeaders, redirect: "error" });
  if (!response.ok) throw new Error(`ARC_NETLIFY_READ_FAILED: ${response.status} ${path}`);
  return response.json();
};
const readRaw = async path => {
  const response = await fetch(`${apiBase}${path}`, {
    method: "GET",
    headers: {
      ...apiHeaders,
      Accept: "application/vnd.bitballoon.v1.raw",
      "Content-Type": "application/vnd.bitballoon.v1.raw"
    },
    redirect: "error"
  });
  if (!response.ok) throw new Error(`ARC_NETLIFY_READ_FAILED: ${response.status} ${path}`);
  return response.text();
};
const plainHttpsRoot = (value, label) => {
  let url;
  try {
    url = new URL(clean(value));
  } catch (error) {
    throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label} URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: ${label} must be a plain HTTPS root URL`);
  }
  return url;
};

const site = await readJson(`/sites/${encodeURIComponent(siteId)}`);
const siteName = clean(site.name).toLowerCase();
const siteUrl = plainHttpsRoot(site.ssl_url || site.url, "staging site");
if (
  clean(site.id).toLowerCase() !== siteId || clean(site.account_id) !== expectedNetlifyAccountId ||
  !/^arc-lead-route-[a-z0-9-]{1,40}$/.test(siteName) ||
  siteUrl.hostname.toLowerCase() !== `${siteName}.netlify.app` ||
  clean(site.state).toLowerCase() === "disabled"
) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: ARC-controlled site identity mismatch");
}
const inputStagingUrl = plainHttpsRoot(inputData.staging_site_url, "requested staging site");
if (inputStagingUrl.toString() !== siteUrl.toString()) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: requested staging URL mismatch");
}

const deploy = await readJson(`/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}`);
const publishedDeployId = clean(site.published_deploy?.id).toLowerCase();
const deployUrl = plainHttpsRoot(deploy.ssl_url || deploy.url, "staging deploy");
const immutableDeployUrl = plainHttpsRoot(deploy.deploy_ssl_url || deploy.deploy_url, "immutable staging deploy");
const deployPublishedTimestamp = clean(deploy.published_at);
const deployPublishedMs = Date.parse(deployPublishedTimestamp);
if (
  clean(deploy.id).toLowerCase() !== deployId || clean(deploy.site_id).toLowerCase() !== siteId ||
  clean(deploy.state).toLowerCase() !== "ready" || clean(deploy.name).toLowerCase() !== siteName ||
  deployUrl.toString() !== siteUrl.toString() || publishedDeployId !== deployId ||
  immutableDeployUrl.hostname.toLowerCase() !== `${deployId}--${siteName}.netlify.app` ||
  !Number.isFinite(deployPublishedMs) || new Date(deployPublishedMs).toISOString() !== deployPublishedTimestamp ||
  !Array.isArray(deploy.required) || deploy.required.length ||
  !Array.isArray(deploy.required_functions) || deploy.required_functions.length ||
  !Array.isArray(deploy.required_edge_functions) || deploy.required_edge_functions.length ||
  !Array.isArray(deploy.function_schedules) || deploy.function_schedules.length
) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exact published deploy identity mismatch");
}

const rootArtifacts = await Promise.all(artifacts.map(async artifact => ({
  source_path: artifact.path,
  path: `/${artifact.path.split("/").pop()}`,
  content: artifact.content,
  sha: await sha1Hex(artifact.content),
  size: encoder.encode(artifact.content).length
})));
const deployFiles = await readJson(`/sites/${encodeURIComponent(siteId)}/files`);
if (!Array.isArray(deployFiles) || deployFiles.length !== rootArtifacts.length) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: current deploy file manifest is not the exact three-file static bundle");
}
const normalizedManifest = [];
for (const expected of rootArtifacts) {
  const matches = deployFiles.filter(file => clean(file.path || file.id) === expected.path);
  if (matches.length !== 1 || clean(matches[0].sha).toLowerCase() !== expected.sha || Number(matches[0].size) !== expected.size) {
    throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: source manifest mismatch for ${expected.path}`);
  }
  if (expected.path === "/index.html" && clean(matches[0].mime_type).toLowerCase() !== "text/html") {
    throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: source index MIME type mismatch");
  }
  const rawPath = `/sites/${encodeURIComponent(siteId)}/files/${expected.path.slice(1).split("/").map(encodeURIComponent).join("/")}`;
  if (await readRaw(rawPath) !== expected.content) {
    throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: original uploaded bytes changed for ${expected.path}`);
  }
  normalizedManifest.push({
    path: expected.path,
    sha: expected.sha,
    size: expected.size,
    mime_type: clean(matches[0].mime_type).toLowerCase()
  });
}
normalizedManifest.sort((first, second) => first.path.localeCompare(second.path));
const deployFileManifestSha256 = await sha256Hex(JSON.stringify(normalizedManifest));
const snippets = await readJson(`/sites/${encodeURIComponent(siteId)}/snippets`);
if (!Array.isArray(snippets) || snippets.length) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: staging site HTML injection snippets are forbidden");
}

const expectedProcessedHtml = productionHtml
  .replace(/\sdata-netlify="true"/i, "")
  .replace(/\snetlify-honeypot="bot-field"/i, "");
let servedHtml = "";
let stagingRobotsHeader = "";
for (const liveUrl of [immutableDeployUrl, siteUrl]) {
  const response = await fetch(liveUrl.toString(), {
    method: "GET",
    headers: { Accept: "text/html" },
    redirect: "manual"
  });
  if (response.status !== 200) throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: live processed index is unavailable");
  const finalUrl = new URL(response.url || liveUrl.toString());
  const responseHtml = await response.text();
  const robotsHeader = clean(response.headers?.get?.("x-robots-tag")).toLowerCase();
  const robotsTokens = robotsHeader.split(",").map(value => value.trim()).filter(Boolean);
  if (finalUrl.toString() !== liveUrl.toString() || responseHtml !== expectedProcessedHtml ||
      !robotsTokens.includes("noindex") || !robotsTokens.includes("nofollow") || !robotsTokens.includes("noarchive") ||
      clean(response.headers?.get?.("x-content-type-options")).toLowerCase() !== "nosniff" ||
      clean(response.headers?.get?.("x-frame-options")).toUpperCase() !== "DENY") {
    throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: processed staging HTML or staging-only response headers changed");
  }
  if (!servedHtml) {
    servedHtml = responseHtml;
    stagingRobotsHeader = robotsTokens.sort().join(",");
  } else if (responseHtml !== servedHtml || robotsTokens.sort().join(",") !== stagingRobotsHeader) {
    throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: mutable and immutable staging responses disagree");
  }
}
const servedHtmlSha256 = await sha256Hex(servedHtml);
const stagingRobotsHeaderSha256 = await sha256Hex(stagingRobotsHeader);

const forms = await readJson(`/sites/${encodeURIComponent(siteId)}/forms`);
const matchingForms = (Array.isArray(forms) ? forms : []).filter(form =>
  clean(form.site_id).toLowerCase() === siteId && clean(form.name) === expectedFormName && externalId(form.id) &&
  Array.isArray(form.paths) && form.paths.length === 1 && clean(form.paths[0]) === "/"
);
if (matchingForms.length !== 1) {
  throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: expected one exact Netlify form; found ${matchingForms.length}`);
}
const form = matchingForms[0];
const formId = clean(form.id).toLowerCase();

const hooks = await readJson(`/hooks?site_id=${encodeURIComponent(siteId)}&per_page=100`);
const matchingHooks = (Array.isArray(hooks) ? hooks : []).filter(hook => {
  const data = hook && typeof hook.data === "object" && !Array.isArray(hook.data) ? hook.data : {};
  const hookRecipient = clean(data.email || data.recipient || data.email_to).toLowerCase();
  // Netlify's documented Hook model places provider-specific bindings in
  // `data`; top-level caller-shaped form fields are not authoritative.
  const formBound = clean(data.form_id).toLowerCase() === formId &&
    (!clean(data.form_name) || clean(data.form_name) === expectedFormName);
  return clean(hook.id).toLowerCase() === notificationHookId && clean(hook.site_id).toLowerCase() === siteId &&
    clean(hook.type).toLowerCase() === "email" && hook.disabled !== true &&
    clean(hook.event).toLowerCase() === "submission_created" &&
    hookRecipient === verifiedLeadNotificationEmail && formBound;
});
if (matchingHooks.length !== 1) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: exact enabled recipient notification hook not found");
}

const submissions = await readJson(`/forms/${encodeURIComponent(formId)}/submissions?per_page=100&page=1`);
const matchingSubmissions = (Array.isArray(submissions) ? submissions : []).filter(submission =>
  clean(submission.id).toLowerCase() === syntheticSubmissionId
);
if (matchingSubmissions.length !== 1) {
  throw new Error(`ARC_LEAD_ROUTE_VERIFY_INVALID: expected one synthetic submission; found ${matchingSubmissions.length}`);
}
const submission = matchingSubmissions[0];
const submissionData = submission && typeof submission.data === "object" && !Array.isArray(submission.data) ? submission.data : {};
const submissionSiteUrl = plainHttpsRoot(submission.site_url, "submission site");
if (clean(submissionData.project_details) !== syntheticProbeToken || clean(submissionData["form-name"]) !== expectedFormName ||
    submissionSiteUrl.toString() !== siteUrl.toString()) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: synthetic submission is not bound to this site and probe");
}
const netlifySubmissionTimestamp = clean(submission.created_at);
const netlifySubmissionMs = Date.parse(netlifySubmissionTimestamp);
if (!Number.isFinite(netlifySubmissionMs) || new Date(netlifySubmissionMs).toISOString() !== netlifySubmissionTimestamp ||
    netlifySubmissionMs > Date.now() + 5 * 60 * 1000 || netlifySubmissionMs < Date.now() - 30 * 60 * 1000 ||
    netlifySubmissionMs < deployPublishedMs) {
  throw new Error("ARC_LEAD_ROUTE_VERIFY_INVALID: synthetic submission receipt is stale or invalid");
}

const syntheticProbeSha256 = await sha256Hex(syntheticProbeToken);
let inboxReceiptEvidence;
try {
  inboxReceiptEvidence = typeof inputData.inbox_receipt_evidence === "string"
    ? JSON.parse(inputData.inbox_receipt_evidence)
    : inputData.inbox_receipt_evidence;
} catch (error) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence JSON");
}
if (!inboxReceiptEvidence || typeof inboxReceiptEvidence !== "object" || Array.isArray(inboxReceiptEvidence)) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence object");
}
const inboxEvidenceFields = [
  "version", "scope", "provider", "account_hmac_sha256", "recipient_hmac_sha256",
  "synthetic_submission_id", "synthetic_probe_sha256", "message_id_hmac_sha256",
  "inbox_received_timestamp"
];
if (JSON.stringify(Object.keys(inboxReceiptEvidence).sort()) !== JSON.stringify(inboxEvidenceFields.slice().sort())) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence fields");
}
const inboxProvider = clean(inboxReceiptEvidence.provider).toLowerCase();
const inboxAccountHmacSha256 = clean(inboxReceiptEvidence.account_hmac_sha256).toLowerCase();
const inboxMessageIdHmacSha256 = clean(inboxReceiptEvidence.message_id_hmac_sha256).toLowerCase();
const inboxReceivedTimestamp = clean(inboxReceiptEvidence.inbox_received_timestamp);
const inboxReceivedMs = Date.parse(inboxReceivedTimestamp);
const canonicalInboxReceiptEvidence = JSON.stringify({
  version: clean(inboxReceiptEvidence.version),
  scope: clean(inboxReceiptEvidence.scope),
  provider: inboxProvider,
  account_hmac_sha256: inboxAccountHmacSha256,
  recipient_hmac_sha256: clean(inboxReceiptEvidence.recipient_hmac_sha256).toLowerCase(),
  synthetic_submission_id: clean(inboxReceiptEvidence.synthetic_submission_id).toLowerCase(),
  synthetic_probe_sha256: clean(inboxReceiptEvidence.synthetic_probe_sha256).toLowerCase(),
  message_id_hmac_sha256: inboxMessageIdHmacSha256,
  inbox_received_timestamp: inboxReceivedTimestamp
});
const canonicalInboxObject = JSON.parse(canonicalInboxReceiptEvidence);
if (
  canonicalInboxObject.version !== "arc-inbox-receipt-evidence-v1" ||
  canonicalInboxObject.scope !== "authoritative-inbox-delivery" ||
  !/^[a-z0-9][a-z0-9_.-]{1,63}$/.test(inboxProvider) ||
  !/^[a-f0-9]{64}$/.test(inboxAccountHmacSha256) ||
  !/^[a-f0-9]{64}$/.test(inboxMessageIdHmacSha256) ||
  canonicalInboxObject.recipient_hmac_sha256 !== recipientHmacSha256 ||
  canonicalInboxObject.synthetic_submission_id !== syntheticSubmissionId ||
  canonicalInboxObject.synthetic_probe_sha256 !== syntheticProbeSha256
) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence is not bound to the recipient, submission, and probe");
}
if (!Number.isFinite(inboxReceivedMs) || new Date(inboxReceivedMs).toISOString() !== inboxReceivedTimestamp ||
    inboxReceivedMs > Date.now() + 5 * 60 * 1000 || inboxReceivedMs < Date.now() - 30 * 60 * 1000 ||
    inboxReceivedMs < netlifySubmissionMs) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: inbox receipt timestamp is stale, invalid, or precedes the Netlify submission");
}
if (!/^[a-f0-9]{64}$/.test(inboxReceiptEvidenceSignature)) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence HMAC");
}
const inboxSignatureBytes = Uint8Array.from(
  inboxReceiptEvidenceSignature.match(/../g),
  byte => Number.parseInt(byte, 16)
);
if (!(await globalThis.crypto.subtle.verify(
  "HMAC",
  inboxEvidenceKey,
  inboxSignatureBytes,
  encoder.encode(`arc-inbox-receipt-evidence-signature-v1\n${canonicalInboxReceiptEvidence}`)
))) {
  throw new Error("ARC_INBOX_RECEIPT_INVALID: evidence HMAC mismatch");
}
const inboxReceiptEvidenceSha256 = await sha256Hex(canonicalInboxReceiptEvidence);
const evidence = {
  version: "arc-lead-route-evidence-v1",
  scope: "arc-controlled-netlify-staging",
  preview_folder: previewFolder,
  production_content_sha256: productionSha256,
  bundle_fingerprint: bundleFingerprint,
  netlify_account_id: expectedNetlifyAccountId,
  staging_site_id: siteId,
  staging_site_url: siteUrl.toString(),
  staging_deploy_id: deployId,
  staging_deploy_url: immutableDeployUrl.toString(),
  deploy_file_manifest_sha256: deployFileManifestSha256,
  served_html_sha256: servedHtmlSha256,
  staging_robots_header_sha256: stagingRobotsHeaderSha256,
  staging_form_id: formId,
  notification_hook_id: notificationHookId,
  form_name: expectedFormName,
  recipient_hmac_sha256: recipientHmacSha256,
  synthetic_submission_id: syntheticSubmissionId,
  synthetic_probe_sha256: syntheticProbeSha256,
  netlify_submission_timestamp: netlifySubmissionTimestamp,
  inbox_provider: inboxProvider,
  inbox_account_hmac_sha256: inboxAccountHmacSha256,
  inbox_message_id_hmac_sha256: inboxMessageIdHmacSha256,
  inbox_received_timestamp: inboxReceivedTimestamp,
  inbox_receipt_evidence_sha256: inboxReceiptEvidenceSha256
};
const canonicalEvidence = JSON.stringify(evidence);
const evidenceSignatureHmacSha256 = await hmacHex(`arc-lead-route-evidence-signature-v1\n${canonicalEvidence}`);
const evidenceSha256 = await sha256Hex(canonicalEvidence);

return {
  status: "LEAD_ROUTE_EVIDENCE_ISSUED",
  send_delivery_email: false,
  github_write_allowed_by_this_step: false,
  evidence_requires_downstream_reverification: true,
  preview_folder: previewFolder,
  lead_route_form_name: expectedFormName,
  lead_route_recipient_hmac_sha256: recipientHmacSha256,
  lead_route_evidence: canonicalEvidence,
  lead_route_evidence_hmac_sha256: evidenceSignatureHmacSha256,
  lead_route_evidence_sha256: evidenceSha256,
  staging_site_id: siteId,
  staging_deploy_id: deployId,
  staging_deploy_url: immutableDeployUrl.toString(),
  deploy_file_manifest_sha256: deployFileManifestSha256,
  served_html_sha256: servedHtmlSha256,
  staging_robots_header_sha256: stagingRobotsHeaderSha256,
  staging_form_id: formId,
  synthetic_submission_id: syntheticSubmissionId,
  netlify_submission_timestamp: netlifySubmissionTimestamp,
  inbox_provider: inboxProvider,
  inbox_account_hmac_sha256: inboxAccountHmacSha256,
  inbox_message_id_hmac_sha256: inboxMessageIdHmacSha256,
  inbox_received_timestamp: inboxReceivedTimestamp,
  inbox_receipt_evidence_sha256: inboxReceiptEvidenceSha256
};
