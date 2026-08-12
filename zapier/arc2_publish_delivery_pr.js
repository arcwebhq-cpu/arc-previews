// ARC2 Code step — publish one paid-delivery candidate to a deterministic branch and PR.
// This step never updates main and never authorizes or sends customer email.
const clean = value => String(value == null ? "" : value).trim();
const owner = clean(inputData.github_owner || "arcwebhq-cpu");
const repository = clean(inputData.github_repo || "arc-previews");
const baseBranch = clean(inputData.github_base_branch || "main");
const token = clean(inputData.github_token);
const previewFolder = clean(inputData.preview_folder).replace(/^\/+|\/+$/g, "").toLowerCase();
const sessionId = clean(inputData.checkout_session_id);
const customerEmail = clean(inputData.customer_email).toLowerCase();
const verifiedLeadNotificationEmail = clean(inputData.verified_lead_notification_email).toLowerCase();
const leadRouteEvidenceSecret = clean(inputData.lead_route_evidence_secret);
const leadRouteEvidenceSignature = clean(inputData.lead_route_evidence_hmac_sha256).toLowerCase();
const expectedNetlifyAccountId = clean(inputData.expected_netlify_account_id);
const netlifyToken = clean(inputData.netlify_access_token);
const productionPath = clean(inputData.production_file_path).replace(/^\/+/, "");
const netlifyPath = clean(inputData.netlify_config_path).replace(/^\/+/, "");
const usagePath = clean(inputData.usage_guide_path).replace(/^\/+/, "");
const bundleFingerprint = clean(inputData.bundle_fingerprint).toLowerCase();

if (!token) throw new Error("ARC_GITHUB_INVALID: github_token is required");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("ARC_GITHUB_INVALID: owner or repository");
}
if (baseBranch !== "main") throw new Error("ARC_DELIVERY_PR_INVALID: paid delivery PRs must target main");
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder)) {
  throw new Error("ARC_DELIVERY_PR_INVALID: preview folder");
}
if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("ARC_PAYMENT_INVALID: test checkout session id");
if (clean(inputData.payment_verification_status) !== "verified_test_payment") {
  throw new Error("ARC_PAYMENT_INVALID: verified test-payment attestation is required");
}
if (clean(inputData.livemode).toLowerCase() !== "false") throw new Error("ARC_PAYMENT_INVALID: livemode must be false");
if (clean(inputData.payment_status).toLowerCase() !== "paid") throw new Error("ARC_PAYMENT_INVALID: session is not paid");
if (clean(inputData.currency).toLowerCase() !== "usd") throw new Error("ARC_PAYMENT_INVALID: currency must be usd");
if (clean(inputData.amount_total_minor_units) !== "500000") {
  throw new Error("ARC_PAYMENT_INVALID: amount_total_minor_units must be exactly 500000 ($5,000.00)");
}
const paymentLinkId = clean(inputData.payment_link_id);
const expectedPaymentLinkId = clean(inputData.expected_payment_link_id);
if (!/^plink_[A-Za-z0-9]+$/.test(expectedPaymentLinkId) || paymentLinkId !== expectedPaymentLinkId) {
  throw new Error("ARC_PAYMENT_INVALID: Payment Link identity mismatch");
}
if (clean(inputData.terms_of_service_consent).toLowerCase() !== "accepted") {
  throw new Error("ARC_PAYMENT_INVALID: terms_of_service consent must be accepted");
}
const termsVersion = clean(inputData.terms_version);
const expectedTermsVersion = clean(inputData.expected_terms_version);
if (!expectedTermsVersion || termsVersion !== expectedTermsVersion) {
  throw new Error("ARC_PAYMENT_INVALID: terms version mismatch");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error("ARC_HANDOFF_INVALID: customer email");

if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: SHA-256 is required");
}
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const hmacKey = async (secret, usages) => globalThis.crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  usages
);
const hmacHex = async (key, value) => {
  const signatureBytes = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signatureBytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const rawClientReferenceId = clean(inputData.client_reference_id);
if (checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256) {
  throw new Error("ARC_PAYMENT_INVALID: checkout binding secret must be 32–256 characters");
}
const signedReference = rawClientReferenceId.match(/^((?:[a-z0-9][a-z0-9-]*-[a-f0-9]{8})|(?:[a-f0-9]{8}))\.([a-f0-9]{64})$/i);
const checkoutLookupReference = signedReference?.[1].toLowerCase() || "";
const checkoutLookupMatchesPreview = checkoutLookupReference === previewFolder ||
  (/^[a-f0-9]{8}$/.test(checkoutLookupReference) && previewFolder.endsWith(`-${checkoutLookupReference}`));
if (!signedReference || !checkoutLookupMatchesPreview) {
  throw new Error("ARC_PAYMENT_INVALID: signed checkout reference does not match preview folder");
}
const signature = Uint8Array.from(signedReference[2].match(/../g), byte => Number.parseInt(byte, 16));
const key = await hmacKey(checkoutBindingSecret, ["verify"]);
if (!(await globalThis.crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(checkoutLookupReference)))) {
  throw new Error("ARC_PAYMENT_INVALID: checkout reference signature mismatch");
}

const deliveryRoot = `deliveries/${previewFolder}`;
const expectedPaths = {
  production: `${deliveryRoot}/index.html`,
  netlify: `${deliveryRoot}/netlify.toml`,
  usage: `${deliveryRoot}/USAGE.md`,
  marker: `${deliveryRoot}/.arc-handoff.json`
};
if (productionPath !== expectedPaths.production || netlifyPath !== expectedPaths.netlify || usagePath !== expectedPaths.usage) {
  throw new Error("ARC_DELIVERY_PR_INVALID: artifact path escaped the resolved delivery folder");
}
const decodeBase64 = (value, label) => {
  const normalized = clean(value).replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`ARC_DELIVERY_PR_INVALID: ${label} base64`);
  }
  return Buffer.from(normalized, "base64").toString("utf8");
};
const productionHtml = decodeBase64(inputData.production_content_base64, "production HTML");
const netlifyConfig = decodeBase64(inputData.netlify_config_base64, "Netlify config");
const usageGuide = decodeBase64(inputData.usage_guide_base64, "usage guide");
if (!/<meta\s+name=["']robots["'][^>]*index/i.test(productionHtml) || /<meta\s+name=["']robots["'][^>]*noindex/i.test(productionHtml)) {
  throw new Error("ARC_DELIVERY_PR_INVALID: production indexing metadata");
}
if (!/data-arc-site-mode=["']production["']/i.test(productionHtml)) throw new Error("ARC_DELIVERY_PR_INVALID: production mode");
if (/<aside\b[^>]*arc-preview-toolbar|data-arc-checkout|buy\.stripe\.com/i.test(productionHtml)) {
  throw new Error("ARC_DELIVERY_PR_INVALID: preview payment control remained");
}
if (!/<meta\s+name=["']arc-template-version["'][^>]*content=["']10\.0["']/i.test(productionHtml)) {
  throw new Error("ARC_DELIVERY_PR_INVALID: verified ARC v10 marker required");
}
if (!/^\[build\]/m.test(netlifyConfig) || !/publish\s*=\s*["']\.["']/m.test(netlifyConfig)) {
  throw new Error("ARC_DELIVERY_PR_INVALID: Netlify config");
}
if (!/^# Launch checklist/m.test(usageGuide)) throw new Error("ARC_DELIVERY_PR_INVALID: usage guide");
const hasLeadForm = /<form\b/i.test(productionHtml);
const formTags = productionHtml.match(/<form\b[^>]*>/gi) || [];
const netlifyFormTags = formTags.filter(tag => /\bdata-netlify\s*=\s*["']true["']/i.test(tag) || /\snetlify(?:\s|=|>)/i.test(tag));
if (hasLeadForm && (formTags.length !== 1 || netlifyFormTags.length !== 1)) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: production must contain exactly one Netlify-managed form");
}
const leadRouteFormName = hasLeadForm
  ? clean(netlifyFormTags[0].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1])
  : "";
if (hasLeadForm && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(leadRouteFormName)) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: exact Netlify form name");
}
if (hasLeadForm && clean(inputData.lead_route_form_name) !== leadRouteFormName) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: resolver form name mismatch");
}
if (hasLeadForm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedLeadNotificationEmail)) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: verified lead notification email");
}
const productionSha256 = await sha256Hex(productionHtml);
if (clean(inputData.production_content_sha256).toLowerCase() !== productionSha256) {
  throw new Error("ARC_DELIVERY_PR_INVALID: production HTML SHA-256 mismatch");
}
const proofFolder = productionHtml.match(/<meta\s+name=["']arc-preview-folder["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] || "";
const proofSha = productionHtml.match(/<meta\s+name=["']arc-preview-source-sha256["'][^>]*content=["']([a-f0-9]{64})["'][^>]*>/i)?.[1] || "";
if (proofFolder !== previewFolder || !proofSha) throw new Error("ARC_DELIVERY_PR_INVALID: approved preview proof mismatch");

let pagesBaseUrl;
try {
  pagesBaseUrl = new URL(clean(inputData.pages_base_url || `https://${owner}.github.io/${repository}`));
} catch (error) {
  throw new Error("ARC_DELIVERY_PR_INVALID: Pages base URL");
}
if (
  pagesBaseUrl.protocol !== "https:" || pagesBaseUrl.username || pagesBaseUrl.password || pagesBaseUrl.search || pagesBaseUrl.hash ||
  pagesBaseUrl.origin.toLowerCase() !== `https://${owner.toLowerCase()}.github.io` ||
  decodeURIComponent(pagesBaseUrl.pathname).replace(/\/+$/, "").toLowerCase() !== `/${repository.toLowerCase()}`
) {
  throw new Error("ARC_DELIVERY_PR_INVALID: Pages base URL must match the GitHub repository");
}
pagesBaseUrl.pathname = `${pagesBaseUrl.pathname.replace(/\/+$/, "")}/${deliveryRoot}/`;
const productionUrl = pagesBaseUrl.toString();
const deployUrl = `https://app.netlify.com/start/deploy?repository=${encodeURIComponent(`https://github.com/${owner}/${repository}`)}&create_from_path=${encodeURIComponent(deliveryRoot)}`;
if (clean(inputData.production_url) !== productionUrl || clean(inputData.deploy_url) !== deployUrl) {
  throw new Error("ARC_DELIVERY_PR_INVALID: handoff URL mismatch");
}
if (!productionHtml.includes(`<link rel="canonical" href="${productionUrl}">`) ||
    !productionHtml.includes(`<meta property="og:url" content="${productionUrl}">`)) {
  throw new Error("ARC_DELIVERY_PR_INVALID: production canonical or Open Graph URL mismatch");
}

const artifacts = [
  { path: expectedPaths.production, content: productionHtml },
  { path: expectedPaths.netlify, content: netlifyConfig },
  { path: expectedPaths.usage, content: usageGuide }
];
for (const artifact of artifacts) {
  for (const privateValue of [
    sessionId,
    rawClientReferenceId,
    customerEmail,
    verifiedLeadNotificationEmail,
    leadRouteEvidenceSecret,
    leadRouteEvidenceSignature
  ].filter(Boolean)) {
    if (artifact.content.toLowerCase().includes(privateValue.toLowerCase())) {
      throw new Error(`ARC_PRIVACY_FAILED: ${artifact.path} contains private handoff data`);
    }
  }
}
const calculatedFingerprint = await sha256Hex(artifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
if (!/^[a-f0-9]{64}$/.test(bundleFingerprint) || calculatedFingerprint !== bundleFingerprint) {
  throw new Error("ARC_DELIVERY_PR_INVALID: resolver bundle SHA-256 mismatch");
}

let leadRouteEvidence = null;
let leadRouteEvidenceSha256 = "";
let leadRouteRecipientHmacSha256 = "";
if (hasLeadForm) {
  if (leadRouteEvidenceSecret.length < 32 || leadRouteEvidenceSecret.length > 256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: lead-route evidence secret must be 32–256 characters");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(expectedNetlifyAccountId)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: expected ARC Netlify account id");
  }
  try {
    leadRouteEvidence = typeof inputData.lead_route_evidence === "string"
      ? JSON.parse(inputData.lead_route_evidence)
      : inputData.lead_route_evidence;
  } catch (error) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence JSON");
  }
  if (!leadRouteEvidence || typeof leadRouteEvidence !== "object" || Array.isArray(leadRouteEvidence)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence object");
  }
  const evidenceFields = [
    "version", "scope", "preview_folder", "production_content_sha256", "bundle_fingerprint",
    "netlify_account_id", "staging_site_id", "staging_site_url", "staging_deploy_id", "staging_deploy_url",
    "deploy_file_manifest_sha256", "served_html_sha256", "staging_robots_header_sha256",
    "staging_form_id", "notification_hook_id", "form_name", "recipient_hmac_sha256",
    "synthetic_submission_id", "synthetic_probe_sha256", "netlify_submission_timestamp",
    "inbox_provider", "inbox_account_hmac_sha256", "inbox_message_id_hmac_sha256",
    "inbox_received_timestamp", "inbox_receipt_evidence_sha256"
  ];
  if (JSON.stringify(Object.keys(leadRouteEvidence).sort()) !== JSON.stringify(evidenceFields.slice().sort())) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence fields");
  }
  let stagingUrl;
  let stagingDeployUrl;
  try {
    stagingUrl = new URL(clean(leadRouteEvidence.staging_site_url));
    stagingDeployUrl = new URL(clean(leadRouteEvidence.staging_deploy_url));
  } catch (error) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: staging site URL");
  }
  const externalId = value => /^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
  const netlifySubmissionTimestamp = clean(leadRouteEvidence.netlify_submission_timestamp);
  const netlifySubmissionMs = Date.parse(netlifySubmissionTimestamp);
  const inboxReceivedTimestamp = clean(leadRouteEvidence.inbox_received_timestamp);
  const inboxReceivedMs = Date.parse(inboxReceivedTimestamp);
  if (!Number.isFinite(netlifySubmissionMs) || new Date(netlifySubmissionMs).toISOString() !== netlifySubmissionTimestamp ||
      !Number.isFinite(inboxReceivedMs) || new Date(inboxReceivedMs).toISOString() !== inboxReceivedTimestamp ||
      inboxReceivedMs > Date.now() + 5 * 60 * 1000 || inboxReceivedMs < Date.now() - 6 * 60 * 60 * 1000 ||
      netlifySubmissionMs > inboxReceivedMs) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence inbox receipt timestamp is stale, invalid, or precedes the Netlify submission");
  }
  if (
    stagingUrl.protocol !== "https:" || stagingUrl.username || stagingUrl.password || stagingUrl.search || stagingUrl.hash ||
    stagingUrl.pathname !== "/" || !/^arc-lead-route-[a-z0-9-]{1,40}\.netlify\.app$/i.test(stagingUrl.hostname) ||
    stagingDeployUrl.protocol !== "https:" || stagingDeployUrl.username || stagingDeployUrl.password || stagingDeployUrl.search || stagingDeployUrl.hash ||
    stagingDeployUrl.pathname !== "/" || stagingDeployUrl.hostname.toLowerCase() !== `${clean(leadRouteEvidence.staging_deploy_id).toLowerCase()}--${stagingUrl.hostname.toLowerCase()}` ||
    !externalId(leadRouteEvidence.staging_site_id) || !externalId(leadRouteEvidence.staging_deploy_id) ||
    !externalId(leadRouteEvidence.staging_form_id) || !externalId(leadRouteEvidence.notification_hook_id) ||
    !externalId(leadRouteEvidence.synthetic_submission_id) ||
    !/^[a-f0-9]{64}$/i.test(clean(leadRouteEvidence.deploy_file_manifest_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(leadRouteEvidence.served_html_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(leadRouteEvidence.staging_robots_header_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(leadRouteEvidence.synthetic_probe_sha256)) ||
    !/^[a-z0-9][a-z0-9_.-]{1,63}$/.test(clean(leadRouteEvidence.inbox_provider).toLowerCase()) ||
    !/^[a-f0-9]{64}$/i.test(clean(leadRouteEvidence.inbox_account_hmac_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(leadRouteEvidence.inbox_message_id_hmac_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(leadRouteEvidence.inbox_receipt_evidence_sha256))
  ) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: ARC-controlled temporary staging identity");
  }
  const evidenceKey = await hmacKey(leadRouteEvidenceSecret, ["sign", "verify"]);
  leadRouteRecipientHmacSha256 = await hmacHex(
    evidenceKey,
    `arc-lead-route-recipient-v1\n${verifiedLeadNotificationEmail}`
  );
  if (clean(inputData.lead_route_recipient_hmac_sha256).toLowerCase() !== leadRouteRecipientHmacSha256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: resolver recipient HMAC mismatch");
  }
  const canonicalEvidence = JSON.stringify({
    version: clean(leadRouteEvidence.version),
    scope: clean(leadRouteEvidence.scope),
    preview_folder: clean(leadRouteEvidence.preview_folder).toLowerCase(),
    production_content_sha256: clean(leadRouteEvidence.production_content_sha256).toLowerCase(),
    bundle_fingerprint: clean(leadRouteEvidence.bundle_fingerprint).toLowerCase(),
    netlify_account_id: clean(leadRouteEvidence.netlify_account_id),
    staging_site_id: clean(leadRouteEvidence.staging_site_id).toLowerCase(),
    staging_site_url: stagingUrl.toString(),
    staging_deploy_id: clean(leadRouteEvidence.staging_deploy_id).toLowerCase(),
    staging_deploy_url: stagingDeployUrl.toString(),
    deploy_file_manifest_sha256: clean(leadRouteEvidence.deploy_file_manifest_sha256).toLowerCase(),
    served_html_sha256: clean(leadRouteEvidence.served_html_sha256).toLowerCase(),
    staging_robots_header_sha256: clean(leadRouteEvidence.staging_robots_header_sha256).toLowerCase(),
    staging_form_id: clean(leadRouteEvidence.staging_form_id).toLowerCase(),
    notification_hook_id: clean(leadRouteEvidence.notification_hook_id).toLowerCase(),
    form_name: clean(leadRouteEvidence.form_name),
    recipient_hmac_sha256: clean(leadRouteEvidence.recipient_hmac_sha256).toLowerCase(),
    synthetic_submission_id: clean(leadRouteEvidence.synthetic_submission_id).toLowerCase(),
    synthetic_probe_sha256: clean(leadRouteEvidence.synthetic_probe_sha256).toLowerCase(),
    netlify_submission_timestamp: netlifySubmissionTimestamp,
    inbox_provider: clean(leadRouteEvidence.inbox_provider).toLowerCase(),
    inbox_account_hmac_sha256: clean(leadRouteEvidence.inbox_account_hmac_sha256).toLowerCase(),
    inbox_message_id_hmac_sha256: clean(leadRouteEvidence.inbox_message_id_hmac_sha256).toLowerCase(),
    inbox_received_timestamp: inboxReceivedTimestamp,
    inbox_receipt_evidence_sha256: clean(leadRouteEvidence.inbox_receipt_evidence_sha256).toLowerCase()
  });
  const canonicalObject = JSON.parse(canonicalEvidence);
  if (
    canonicalObject.version !== "arc-lead-route-evidence-v1" ||
    canonicalObject.scope !== "arc-controlled-netlify-staging" ||
    canonicalObject.preview_folder !== previewFolder ||
    canonicalObject.production_content_sha256 !== productionSha256 ||
    canonicalObject.bundle_fingerprint !== bundleFingerprint ||
    canonicalObject.netlify_account_id !== expectedNetlifyAccountId ||
    canonicalObject.form_name !== leadRouteFormName ||
    canonicalObject.recipient_hmac_sha256 !== leadRouteRecipientHmacSha256
  ) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence is not bound to the exact artifacts, form, account, and recipient");
  }
  if (!/^[a-f0-9]{64}$/.test(leadRouteEvidenceSignature)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence HMAC");
  }
  const evidenceSignatureBytes = Uint8Array.from(leadRouteEvidenceSignature.match(/../g), byte => Number.parseInt(byte, 16));
  if (!(await globalThis.crypto.subtle.verify(
    "HMAC",
    evidenceKey,
    evidenceSignatureBytes,
    new TextEncoder().encode(`arc-lead-route-evidence-signature-v1\n${canonicalEvidence}`)
  ))) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence HMAC mismatch");
  }
  leadRouteEvidenceSha256 = await sha256Hex(canonicalEvidence);
  if (!netlifyToken) throw new Error("ARC_LEAD_ROUTE_INVALID: Netlify access token is required for gate-time revalidation");
  const netlifyHeaders = { Accept: "application/json", Authorization: `Bearer ${netlifyToken}` };
  const netlifyRead = async path => {
    const response = await fetch(`https://api.netlify.com/api/v1${path}`, { method: "GET", headers: netlifyHeaders, redirect: "error" });
    if (!response.ok) throw new Error(`ARC_LEAD_ROUTE_INVALID: Netlify revalidation read failed (${response.status})`);
    return response.json();
  };
  const currentSite = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}`);
  const currentDeploy = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}/deploys/${encodeURIComponent(canonicalObject.staging_deploy_id)}`);
  if (clean(currentSite.id).toLowerCase() !== canonicalObject.staging_site_id ||
      clean(currentSite.account_id) !== expectedNetlifyAccountId ||
      clean(currentSite.published_deploy?.id).toLowerCase() !== canonicalObject.staging_deploy_id ||
      clean(currentDeploy.id).toLowerCase() !== canonicalObject.staging_deploy_id ||
      clean(currentDeploy.site_id).toLowerCase() !== canonicalObject.staging_site_id ||
      clean(currentDeploy.state).toLowerCase() !== "ready" ||
      clean(currentDeploy.deploy_ssl_url || currentDeploy.deploy_url) !== stagingDeployUrl.toString()) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: current staging site or published deploy changed");
  }
  const currentFiles = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}/files`);
  const normalizedFiles = (Array.isArray(currentFiles) ? currentFiles : []).map(file => ({
    path: clean(file.path || file.id),
    sha: clean(file.sha).toLowerCase(),
    size: Number(file.size),
    mime_type: clean(file.mime_type).toLowerCase()
  })).sort((first, second) => first.path.localeCompare(second.path));
  if (normalizedFiles.length !== 3 || await sha256Hex(JSON.stringify(normalizedFiles)) !== canonicalObject.deploy_file_manifest_sha256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: current staging source manifest changed");
  }
  const currentSnippets = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}/snippets`);
  if (!Array.isArray(currentSnippets) || currentSnippets.length) throw new Error("ARC_LEAD_ROUTE_INVALID: staging injection snippets changed");
  const currentForms = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}/forms`);
  const currentForm = (Array.isArray(currentForms) ? currentForms : []).filter(form =>
    clean(form.id).toLowerCase() === canonicalObject.staging_form_id && clean(form.site_id).toLowerCase() === canonicalObject.staging_site_id &&
    clean(form.name) === canonicalObject.form_name && Array.isArray(form.paths) && form.paths.length === 1 && clean(form.paths[0]) === "/"
  );
  const currentHooks = await netlifyRead(`/hooks?site_id=${encodeURIComponent(canonicalObject.staging_site_id)}&per_page=100`);
  const currentHook = (Array.isArray(currentHooks) ? currentHooks : []).filter(hook => {
    const data = hook && typeof hook.data === "object" && !Array.isArray(hook.data) ? hook.data : {};
    return clean(hook.id).toLowerCase() === canonicalObject.notification_hook_id && clean(hook.site_id).toLowerCase() === canonicalObject.staging_site_id &&
      clean(hook.type).toLowerCase() === "email" && clean(hook.event).toLowerCase() === "submission_created" && hook.disabled !== true &&
      clean(data.form_id).toLowerCase() === canonicalObject.staging_form_id && clean(data.email || data.recipient || data.email_to).toLowerCase() === verifiedLeadNotificationEmail;
  });
  const currentSubmissions = await netlifyRead(`/forms/${encodeURIComponent(canonicalObject.staging_form_id)}/submissions?per_page=100&page=1`);
  const currentSubmission = (Array.isArray(currentSubmissions) ? currentSubmissions : []).filter(submission =>
    clean(submission.id).toLowerCase() === canonicalObject.synthetic_submission_id
  );
  const currentSubmissionData = currentSubmission[0] && typeof currentSubmission[0].data === "object" && !Array.isArray(currentSubmission[0].data) ? currentSubmission[0].data : {};
  if (currentForm.length !== 1 || currentHook.length !== 1 || currentSubmission.length !== 1 ||
      clean(currentSubmission[0]?.created_at) !== canonicalObject.netlify_submission_timestamp ||
      clean(currentSubmission[0]?.site_url) !== stagingUrl.toString() || clean(currentSubmissionData["form-name"]) !== canonicalObject.form_name ||
      await sha256Hex(clean(currentSubmissionData.project_details)) !== canonicalObject.synthetic_probe_sha256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: current form, notification hook, or synthetic submission changed");
  }
  const stagingResponse = await fetch(stagingDeployUrl.toString(), {
    method: "GET",
    headers: { Accept: "text/html" },
    redirect: "manual"
  });
  if (stagingResponse.status !== 200) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: staging site is not live");
  }
  const stagingFinalUrl = new URL(stagingResponse.url || stagingDeployUrl.toString());
  const servedHtml = await stagingResponse.text();
  const robotsTokens = clean(stagingResponse.headers?.get?.("x-robots-tag")).toLowerCase().split(",").map(value => value.trim()).filter(Boolean).sort();
  if (stagingFinalUrl.toString() !== stagingDeployUrl.toString() ||
      await sha256Hex(servedHtml) !== canonicalObject.served_html_sha256 ||
      await sha256Hex(robotsTokens.join(",")) !== canonicalObject.staging_robots_header_sha256 ||
      !robotsTokens.includes("noindex") || !robotsTokens.includes("nofollow") || !robotsTokens.includes("noarchive") ||
      clean(stagingResponse.headers?.get?.("x-content-type-options")).toLowerCase() !== "nosniff" ||
      clean(stagingResponse.headers?.get?.("x-frame-options")).toUpperCase() !== "DENY") {
    throw new Error("ARC_LEAD_ROUTE_INVALID: immutable staging response or noindex headers changed");
  }
}
const marker = `${JSON.stringify({
  version: "arc-handoff-v2",
  preview_folder: previewFolder,
  fingerprint_algorithm: "sha256",
  bundle_fingerprint: bundleFingerprint,
  files: [...artifacts.map(item => item.path), expectedPaths.marker]
}, null, 2)}\n`;
const bundle = [...artifacts, { path: expectedPaths.marker, content: marker }];
for (const privateValue of [
  sessionId,
  rawClientReferenceId,
  customerEmail,
  verifiedLeadNotificationEmail,
  leadRouteEvidenceSecret,
  leadRouteEvidenceSignature
].filter(Boolean)) {
  if (marker.toLowerCase().includes(privateValue.toLowerCase())) {
    throw new Error("ARC_PRIVACY_FAILED: public handoff marker contains private handoff data");
  }
}

const deliveryBranch = `arc-delivery/${previewFolder}`;
const recipientSha256 = await sha256Hex(customerEmail);
const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28"
};
const responseBody = async response => response.status === 204 ? {} : response.json().catch(() => ({}));
const request = async (url, options = {}, allowed = []) => {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await responseBody(response);
  if (response.ok) return body;
  if (allowed.includes(response.status)) return { _status: response.status, _body: body };
  throw new Error(`ARC_GITHUB_FAILED: ${response.status} ${JSON.stringify(body).slice(0, 240)}`);
};
const validSha = value => /^[a-f0-9]{40}$/i.test(clean(value));
const refPath = branchName => encodeURIComponent(`heads/${branchName}`);
const contentUrl = (path, ref) => `${api}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
const readContent = async (path, ref) => {
  const response = await request(contentUrl(path, ref), {}, [404]);
  if (response._status) return null;
  return Buffer.from(clean(response.content).replace(/\s/g, ""), "base64").toString("utf8");
};
const verifyBundleAt = async ref => {
  const observed = await Promise.all(bundle.map(artifact => readContent(artifact.path, ref)));
  return bundle.every((artifact, index) => observed[index] === artifact.content);
};
const listMatchingPrs = async () => {
  const head = encodeURIComponent(`${owner}:${deliveryBranch}`);
  const pulls = await request(`${api}/pulls?state=all&head=${head}&base=${encodeURIComponent(baseBranch)}&per_page=100`);
  const exact = (Array.isArray(pulls) ? pulls : []).filter(pr =>
    clean(pr.base?.ref) === baseBranch && clean(pr.head?.ref) === deliveryBranch
  );
  if (exact.length > 1) throw new Error("ARC_DELIVERY_PR_CONFLICT: more than one matching PR exists");
  return exact[0] || null;
};

let matchingPr = await listMatchingPrs();
const baseExisting = await Promise.all(bundle.map(artifact => readContent(artifact.path, baseBranch)));
const baseHasAny = baseExisting.some(content => content !== null);
const baseIsExact = bundle.every((artifact, index) => baseExisting[index] === artifact.content);
if (baseHasAny && !baseIsExact) throw new Error("ARC_DELIVERY_PR_CONFLICT: main contains a conflicting delivery bundle");
if (baseIsExact && !matchingPr?.merged_at) {
  throw new Error("ARC_DELIVERY_PR_CONFLICT: main delivery has no matching merged PR proof");
}

let branchRef = await request(`${api}/git/ref/${refPath(deliveryBranch)}`, {}, [404]);
let headSha = branchRef._status ? "" : clean(branchRef.object?.sha).toLowerCase();
if (headSha && !validSha(headSha)) throw new Error("ARC_GITHUB_FAILED: delivery branch SHA");
if (!headSha && matchingPr?.merged_at) {
  headSha = clean(matchingPr.head?.sha).toLowerCase();
  if (!validSha(headSha) || !(await verifyBundleAt(headSha)) || !baseIsExact) {
    throw new Error("ARC_DELIVERY_PR_CONFLICT: merged/deleted delivery branch cannot be verified");
  }
}
let commitCreated = false;
if (headSha) {
  if (!(await verifyBundleAt(headSha))) {
    throw new Error("ARC_DELIVERY_PR_CONFLICT: deterministic delivery branch contains different content");
  }
} else {
  const baseRef = await request(`${api}/git/ref/${refPath(baseBranch)}`);
  const parentSha = clean(baseRef.object?.sha).toLowerCase();
  if (!validSha(parentSha)) throw new Error("ARC_GITHUB_FAILED: main ref SHA");
  const parentCommit = await request(`${api}/git/commits/${parentSha}`);
  const baseTree = clean(parentCommit.tree?.sha).toLowerCase();
  if (!validSha(baseTree)) throw new Error("ARC_GITHUB_FAILED: main tree SHA");
  const treeEntries = [];
  for (const artifact of bundle) {
    const blob = await request(`${api}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: Buffer.from(artifact.content, "utf8").toString("base64"), encoding: "base64" })
    });
    if (!validSha(blob.sha)) throw new Error(`ARC_GITHUB_FAILED: blob ${artifact.path}`);
    treeEntries.push({ path: artifact.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await request(`${api}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: treeEntries })
  });
  if (!validSha(tree.sha)) throw new Error("ARC_GITHUB_FAILED: delivery tree SHA");
  const commit = await request(`${api}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Prepare paid ARC delivery for ${previewFolder}`,
      tree: tree.sha,
      parents: [parentSha]
    })
  });
  const candidateSha = clean(commit.sha).toLowerCase();
  if (!validSha(candidateSha)) throw new Error("ARC_GITHUB_FAILED: delivery commit SHA");
  const createdRef = await request(`${api}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${deliveryBranch}`, sha: candidateSha })
  }, [422]);
  if (createdRef._status) {
    branchRef = await request(`${api}/git/ref/${refPath(deliveryBranch)}`);
    headSha = clean(branchRef.object?.sha).toLowerCase();
    if (!validSha(headSha) || !(await verifyBundleAt(headSha))) {
      throw new Error("ARC_DELIVERY_PR_CONFLICT: deterministic delivery branch was claimed with different content");
    }
  } else {
    headSha = candidateSha;
    commitCreated = true;
  }
}
if (!validSha(headSha)) throw new Error("ARC_GITHUB_FAILED: final delivery head SHA");

let prCreated = false;
if (!matchingPr) {
  const createdPr = await request(`${api}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `ARC paid delivery: ${previewFolder}`,
      head: deliveryBranch,
      base: baseBranch,
      draft: true,
      body: [
        "Automated paid-delivery candidate.",
        "",
        `Delivery folder: \`${deliveryRoot}\``,
        `Bundle SHA-256: \`${bundleFingerprint}\``,
        "",
        "Customer email remains blocked until the exact CI check, squash merge, current-main readback, and live Pages proof all pass."
      ].join("\n")
    })
  }, [422]);
  if (createdPr._status) {
    matchingPr = await listMatchingPrs();
    if (!matchingPr) throw new Error("ARC_DELIVERY_PR_CONFLICT: PR creation failed and no reusable PR exists");
  } else {
    matchingPr = createdPr;
    prCreated = true;
  }
}
if (clean(matchingPr.state) === "closed" && !matchingPr.merged_at) {
  throw new Error("ARC_DELIVERY_PR_CONFLICT: matching delivery PR was closed without merge");
}
const prNumber = Number(matchingPr.number);
if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("ARC_GITHUB_FAILED: PR number");
if (clean(matchingPr.base?.ref) !== baseBranch || clean(matchingPr.head?.ref) !== deliveryBranch ||
    clean(matchingPr.head?.sha).toLowerCase() !== headSha) {
  throw new Error("ARC_DELIVERY_PR_CONFLICT: PR identity or head changed");
}

return {
  status: matchingPr.merged_at ? "ALREADY_MERGED" : prCreated ? "PR_CREATED" : commitCreated ? "PR_PREPARED" : "PR_REUSED",
  send_delivery_email: false,
  email_gate_required: true,
  preview_folder: previewFolder,
  delivery_root: deliveryRoot,
  delivery_branch: deliveryBranch,
  base_branch: baseBranch,
  head_sha: headSha,
  bundle_fingerprint: bundleFingerprint,
  lead_route_evidence_sha256: leadRouteEvidenceSha256,
  lead_route_form_name: leadRouteFormName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
  recipient_sha256: recipientSha256,
  production_url: productionUrl,
  deploy_url: deployUrl,
  pr_number: prNumber,
  pr_url: clean(matchingPr.html_url),
  pr_state: clean(matchingPr.state),
  pr_draft: Boolean(matchingPr.draft),
  pr_merged: Boolean(matchingPr.merged_at)
};
