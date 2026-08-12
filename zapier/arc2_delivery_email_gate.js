// ARC2 polling/email gate — fail closed until CI, merge, main, and live Pages all prove exact.
// The durable email claim is keyed only by immutable delivery identity and binds a secret HMAC of the normalized recipient.
const clean = value => String(value == null ? "" : value).trim();
const owner = clean(inputData.github_owner || "arcwebhq-cpu");
const repository = clean(inputData.github_repo || "arc-previews");
const baseBranch = clean(inputData.github_base_branch || "main");
const token = clean(inputData.github_token);
const previewFolder = clean(inputData.preview_folder).replace(/^\/+|\/+$/g, "").toLowerCase();
const deliveryBranch = clean(inputData.delivery_branch);
const expectedHeadSha = clean(inputData.head_sha).toLowerCase();
const bundleFingerprint = clean(inputData.bundle_fingerprint).toLowerCase();
const prNumber = Number(inputData.pr_number);
const customerEmail = clean(inputData.customer_email).toLowerCase();
const emailClaimBindingSecret = clean(inputData.email_claim_binding_secret);
const verifiedLeadNotificationEmail = clean(inputData.verified_lead_notification_email).toLowerCase();
const leadRouteEvidenceSecret = clean(inputData.lead_route_evidence_secret);
const leadRouteEvidenceSignature = clean(inputData.lead_route_evidence_hmac_sha256).toLowerCase();
const expectedNetlifyAccountId = clean(inputData.expected_netlify_account_id);
const expectedLeadRouteEvidenceSha256 = clean(inputData.lead_route_evidence_sha256).toLowerCase();
const netlifyToken = clean(inputData.netlify_access_token);
const requiredCheckName = "ARC preview quality/preview-quality";
const requiredCheckAppSlug = "github-actions";
const requiredCheckAppId = 15368;

if (!token) throw new Error("ARC_GITHUB_INVALID: github_token is required");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("ARC_GITHUB_INVALID: owner or repository");
}
if (baseBranch !== "main") throw new Error("ARC_DELIVERY_GATE_INVALID: base branch must be main");
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder) || deliveryBranch !== `arc-delivery/${previewFolder}`) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: deterministic delivery branch mismatch");
}
if (!/^[a-f0-9]{40}$/.test(expectedHeadSha)) throw new Error("ARC_DELIVERY_GATE_INVALID: head SHA");
if (!/^[a-f0-9]{64}$/.test(bundleFingerprint)) throw new Error("ARC_DELIVERY_GATE_INVALID: bundle SHA-256");
if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("ARC_DELIVERY_GATE_INVALID: PR number");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error("ARC_DELIVERY_GATE_INVALID: customer email");
if (emailClaimBindingSecret.length < 32 || emailClaimBindingSecret.length > 256) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: email claim binding secret must be 32–256 characters");
}
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
const emailClaimBindingKey = await hmacKey(emailClaimBindingSecret, ["sign"]);
const recipientBindingBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  emailClaimBindingKey,
  new TextEncoder().encode(customerEmail)
);
const recipientBindingHmacSha256 = [...new Uint8Array(recipientBindingBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");

const deliveryRoot = `deliveries/${previewFolder}`;
const expectedPaths = [
  `${deliveryRoot}/index.html`,
  `${deliveryRoot}/netlify.toml`,
  `${deliveryRoot}/USAGE.md`,
  `${deliveryRoot}/.arc-handoff.json`
];
const productionPath = clean(inputData.production_file_path).replace(/^\/+/, "");
const netlifyPath = clean(inputData.netlify_config_path).replace(/^\/+/, "");
const usagePath = clean(inputData.usage_guide_path).replace(/^\/+/, "");
if (productionPath !== expectedPaths[0] || netlifyPath !== expectedPaths[1] || usagePath !== expectedPaths[2]) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: artifact path mismatch");
}
const decodeBase64 = (value, label) => {
  const normalized = clean(value).replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`ARC_DELIVERY_GATE_INVALID: ${label} base64`);
  }
  return Buffer.from(normalized, "base64").toString("utf8");
};
const productionHtml = decodeBase64(inputData.production_content_base64, "production HTML");
const netlifyConfig = decodeBase64(inputData.netlify_config_base64, "Netlify config");
const usageGuide = decodeBase64(inputData.usage_guide_base64, "usage guide");
const artifacts = [
  { path: expectedPaths[0], content: productionHtml },
  { path: expectedPaths[1], content: netlifyConfig },
  { path: expectedPaths[2], content: usageGuide }
];
const calculatedFingerprint = await sha256Hex(artifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
if (calculatedFingerprint !== bundleFingerprint) throw new Error("ARC_DELIVERY_GATE_INVALID: expected bundle bytes changed");
for (const artifact of artifacts) {
  for (const privateValue of [
    clean(inputData.checkout_session_id),
    customerEmail,
    verifiedLeadNotificationEmail,
    emailClaimBindingSecret,
    leadRouteEvidenceSecret,
    leadRouteEvidenceSignature
  ].filter(Boolean)) {
    if (artifact.content.toLowerCase().includes(privateValue.toLowerCase())) {
      throw new Error(`ARC_PRIVACY_FAILED: ${artifact.path} contains private handoff data`);
    }
  }
}

const validateLeadRouteEvidence = async () => {
  const formTags = productionHtml.match(/<form\b[^>]*>/gi) || [];
  if (!formTags.length) {
    if (expectedLeadRouteEvidenceSha256 || clean(inputData.lead_route_evidence) || leadRouteEvidenceSignature) {
      throw new Error("ARC_LEAD_ROUTE_INVALID: evidence supplied for an artifact without a form");
    }
    return { sha256: "", formName: "", recipientHmacSha256: "", stagingUrl: "" };
  }
  const netlifyFormTags = formTags.filter(tag => /\bdata-netlify\s*=\s*["']true["']/i.test(tag) || /\snetlify(?:\s|=|>)/i.test(tag));
  if (formTags.length !== 1 || netlifyFormTags.length !== 1) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: production must contain exactly one Netlify-managed form");
  }
  const formName = clean(netlifyFormTags[0].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1]);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(formName) || clean(inputData.lead_route_form_name) !== formName) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: exact Netlify form name mismatch");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedLeadNotificationEmail)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: verified lead notification email");
  }
  if (leadRouteEvidenceSecret.length < 32 || leadRouteEvidenceSecret.length > 256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: lead-route evidence secret must be 32–256 characters");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(expectedNetlifyAccountId)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: expected ARC Netlify account id");
  }
  let evidence;
  try {
    evidence = typeof inputData.lead_route_evidence === "string"
      ? JSON.parse(inputData.lead_route_evidence)
      : inputData.lead_route_evidence;
  } catch (error) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence JSON");
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
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
  if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(evidenceFields.slice().sort())) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence fields");
  }
  let stagingUrl;
  let stagingDeployUrl;
  try {
    stagingUrl = new URL(clean(evidence.staging_site_url));
    stagingDeployUrl = new URL(clean(evidence.staging_deploy_url));
  } catch (error) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: staging site URL");
  }
  const externalId = value => /^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
  const netlifySubmissionTimestamp = clean(evidence.netlify_submission_timestamp);
  const netlifySubmissionMs = Date.parse(netlifySubmissionTimestamp);
  const inboxReceivedTimestamp = clean(evidence.inbox_received_timestamp);
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
    stagingDeployUrl.pathname !== "/" || stagingDeployUrl.hostname.toLowerCase() !== `${clean(evidence.staging_deploy_id).toLowerCase()}--${stagingUrl.hostname.toLowerCase()}` ||
    !externalId(evidence.staging_site_id) || !externalId(evidence.staging_deploy_id) ||
    !externalId(evidence.staging_form_id) || !externalId(evidence.notification_hook_id) ||
    !externalId(evidence.synthetic_submission_id) ||
    !/^[a-f0-9]{64}$/i.test(clean(evidence.deploy_file_manifest_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(evidence.served_html_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(evidence.staging_robots_header_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(evidence.synthetic_probe_sha256)) ||
    !/^[a-z0-9][a-z0-9_.-]{1,63}$/.test(clean(evidence.inbox_provider).toLowerCase()) ||
    !/^[a-f0-9]{64}$/i.test(clean(evidence.inbox_account_hmac_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(evidence.inbox_message_id_hmac_sha256)) ||
    !/^[a-f0-9]{64}$/i.test(clean(evidence.inbox_receipt_evidence_sha256))
  ) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: ARC-controlled temporary staging identity");
  }
  const evidenceKey = await hmacKey(leadRouteEvidenceSecret, ["sign", "verify"]);
  const recipientHmacSha256 = await hmacHex(
    evidenceKey,
    `arc-lead-route-recipient-v1\n${verifiedLeadNotificationEmail}`
  );
  if (clean(inputData.lead_route_recipient_hmac_sha256).toLowerCase() !== recipientHmacSha256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: resolver recipient HMAC mismatch");
  }
  const productionSha256 = await sha256Hex(productionHtml);
  const canonicalEvidence = JSON.stringify({
    version: clean(evidence.version),
    scope: clean(evidence.scope),
    preview_folder: clean(evidence.preview_folder).toLowerCase(),
    production_content_sha256: clean(evidence.production_content_sha256).toLowerCase(),
    bundle_fingerprint: clean(evidence.bundle_fingerprint).toLowerCase(),
    netlify_account_id: clean(evidence.netlify_account_id),
    staging_site_id: clean(evidence.staging_site_id).toLowerCase(),
    staging_site_url: stagingUrl.toString(),
    staging_deploy_id: clean(evidence.staging_deploy_id).toLowerCase(),
    staging_deploy_url: stagingDeployUrl.toString(),
    deploy_file_manifest_sha256: clean(evidence.deploy_file_manifest_sha256).toLowerCase(),
    served_html_sha256: clean(evidence.served_html_sha256).toLowerCase(),
    staging_robots_header_sha256: clean(evidence.staging_robots_header_sha256).toLowerCase(),
    staging_form_id: clean(evidence.staging_form_id).toLowerCase(),
    notification_hook_id: clean(evidence.notification_hook_id).toLowerCase(),
    form_name: clean(evidence.form_name),
    recipient_hmac_sha256: clean(evidence.recipient_hmac_sha256).toLowerCase(),
    synthetic_submission_id: clean(evidence.synthetic_submission_id).toLowerCase(),
    synthetic_probe_sha256: clean(evidence.synthetic_probe_sha256).toLowerCase(),
    netlify_submission_timestamp: netlifySubmissionTimestamp,
    inbox_provider: clean(evidence.inbox_provider).toLowerCase(),
    inbox_account_hmac_sha256: clean(evidence.inbox_account_hmac_sha256).toLowerCase(),
    inbox_message_id_hmac_sha256: clean(evidence.inbox_message_id_hmac_sha256).toLowerCase(),
    inbox_received_timestamp: inboxReceivedTimestamp,
    inbox_receipt_evidence_sha256: clean(evidence.inbox_receipt_evidence_sha256).toLowerCase()
  });
  const canonicalObject = JSON.parse(canonicalEvidence);
  if (
    canonicalObject.version !== "arc-lead-route-evidence-v1" ||
    canonicalObject.scope !== "arc-controlled-netlify-staging" ||
    canonicalObject.preview_folder !== previewFolder ||
    canonicalObject.production_content_sha256 !== productionSha256 ||
    canonicalObject.bundle_fingerprint !== bundleFingerprint ||
    canonicalObject.netlify_account_id !== expectedNetlifyAccountId ||
    canonicalObject.form_name !== formName ||
    canonicalObject.recipient_hmac_sha256 !== recipientHmacSha256
  ) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence is not bound to the exact artifacts, form, account, and recipient");
  }
  if (!/^[a-f0-9]{64}$/.test(leadRouteEvidenceSignature)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence HMAC");
  }
  const signatureBytes = Uint8Array.from(leadRouteEvidenceSignature.match(/../g), byte => Number.parseInt(byte, 16));
  if (!(await globalThis.crypto.subtle.verify(
    "HMAC",
    evidenceKey,
    signatureBytes,
    new TextEncoder().encode(`arc-lead-route-evidence-signature-v1\n${canonicalEvidence}`)
  ))) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: evidence HMAC mismatch");
  }
  const evidenceSha256 = await sha256Hex(canonicalEvidence);
  if (expectedLeadRouteEvidenceSha256 !== evidenceSha256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: publisher evidence digest mismatch");
  }
  if (!netlifyToken) throw new Error("ARC_LEAD_ROUTE_INVALID: Netlify access token is required for gate-time revalidation");
  const netlifyHeaders = { Accept: "application/json", Authorization: `Bearer ${netlifyToken}` };
  const netlifyRead = async path => {
    const response = await fetch(`https://api.netlify.com/api/v1${path}`, { method: "GET", headers: netlifyHeaders, redirect: "error" });
    if (!response.ok) throw new Error(`ARC_LEAD_ROUTE_INVALID: Netlify revalidation read failed (${response.status})`);
    return response.json();
  };
  const currentSite = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}`);
  const currentDeploy = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}/deploys/${encodeURIComponent(canonicalObject.staging_deploy_id)}`);
  if (clean(currentSite.id).toLowerCase() !== canonicalObject.staging_site_id || clean(currentSite.account_id) !== expectedNetlifyAccountId ||
      clean(currentSite.published_deploy?.id).toLowerCase() !== canonicalObject.staging_deploy_id ||
      clean(currentDeploy.id).toLowerCase() !== canonicalObject.staging_deploy_id || clean(currentDeploy.site_id).toLowerCase() !== canonicalObject.staging_site_id ||
      clean(currentDeploy.state).toLowerCase() !== "ready" || clean(currentDeploy.deploy_ssl_url || currentDeploy.deploy_url) !== stagingDeployUrl.toString()) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: current staging site or published deploy changed");
  }
  const currentFiles = await netlifyRead(`/sites/${encodeURIComponent(canonicalObject.staging_site_id)}/files`);
  const normalizedFiles = (Array.isArray(currentFiles) ? currentFiles : []).map(file => ({
    path: clean(file.path || file.id), sha: clean(file.sha).toLowerCase(), size: Number(file.size), mime_type: clean(file.mime_type).toLowerCase()
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
  const currentSubmission = (Array.isArray(currentSubmissions) ? currentSubmissions : []).filter(submission => clean(submission.id).toLowerCase() === canonicalObject.synthetic_submission_id);
  const currentSubmissionData = currentSubmission[0] && typeof currentSubmission[0].data === "object" && !Array.isArray(currentSubmission[0].data) ? currentSubmission[0].data : {};
  if (currentForm.length !== 1 || currentHook.length !== 1 || currentSubmission.length !== 1 ||
      clean(currentSubmission[0]?.created_at) !== canonicalObject.netlify_submission_timestamp || clean(currentSubmission[0]?.site_url) !== stagingUrl.toString() ||
      clean(currentSubmissionData["form-name"]) !== canonicalObject.form_name || await sha256Hex(clean(currentSubmissionData.project_details)) !== canonicalObject.synthetic_probe_sha256) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: current form, notification hook, or synthetic submission changed");
  }
  return {
    sha256: evidenceSha256,
    formName,
    recipientHmacSha256,
    stagingUrl: stagingUrl.toString(),
    stagingDeployUrl: stagingDeployUrl.toString(),
    servedHtmlSha256: canonicalObject.served_html_sha256,
    stagingRobotsHeaderSha256: canonicalObject.staging_robots_header_sha256
  };
};
const leadRouteProof = await validateLeadRouteEvidence();
const marker = `${JSON.stringify({
  version: "arc-handoff-v2",
  preview_folder: previewFolder,
  fingerprint_algorithm: "sha256",
  bundle_fingerprint: bundleFingerprint,
  files: expectedPaths
}, null, 2)}\n`;
const bundle = [...artifacts, { path: expectedPaths[3], content: marker }];

let pagesBaseUrl;
let productionUrl;
try {
  pagesBaseUrl = new URL(clean(inputData.pages_base_url || `https://${owner}.github.io/${repository}`));
  productionUrl = new URL(clean(inputData.production_url));
} catch (error) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: Pages URL");
}
if (
  pagesBaseUrl.protocol !== "https:" || pagesBaseUrl.username || pagesBaseUrl.password || pagesBaseUrl.search || pagesBaseUrl.hash ||
  pagesBaseUrl.origin.toLowerCase() !== `https://${owner.toLowerCase()}.github.io` ||
  decodeURIComponent(pagesBaseUrl.pathname).replace(/\/+$/, "").toLowerCase() !== `/${repository.toLowerCase()}` ||
  productionUrl.protocol !== "https:" || productionUrl.username || productionUrl.password || productionUrl.search || productionUrl.hash ||
  productionUrl.origin !== pagesBaseUrl.origin
) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: Pages URL must match the GitHub repository");
}
const expectedProductionPath = `${decodeURIComponent(pagesBaseUrl.pathname).replace(/\/+$/, "")}/${deliveryRoot}/`;
if (decodeURIComponent(productionUrl.pathname) !== expectedProductionPath) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: production URL path mismatch");
}
productionUrl.search = "";
productionUrl.hash = "";
const deployUrl = `https://app.netlify.com/start/deploy?repository=${encodeURIComponent(`https://github.com/${owner}/${repository}`)}&create_from_path=${encodeURIComponent(deliveryRoot)}`;
if (clean(inputData.deploy_url) !== deployUrl) throw new Error("ARC_DELIVERY_GATE_INVALID: deploy URL mismatch");

let mergeProof;
try {
  mergeProof = typeof inputData.merge_proof === "string" ? JSON.parse(inputData.merge_proof) : inputData.merge_proof;
} catch (error) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: merge proof JSON");
}
if (!mergeProof || typeof mergeProof !== "object" || Array.isArray(mergeProof)) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: merge proof object");
}
if (
  clean(mergeProof.version) !== "arc-delivery-merge-proof-v1" ||
  clean(mergeProof.preview_folder).toLowerCase() !== previewFolder ||
  clean(mergeProof.delivery_branch) !== deliveryBranch ||
  JSON.stringify(mergeProof.paths) !== JSON.stringify(expectedPaths) ||
  clean(mergeProof.bundle_fingerprint).toLowerCase() !== bundleFingerprint ||
  clean(mergeProof.head_sha).toLowerCase() !== expectedHeadSha ||
  Number(mergeProof.pr_number) !== prNumber ||
  clean(mergeProof.check_name) !== requiredCheckName ||
  clean(mergeProof.check_app_slug) !== requiredCheckAppSlug ||
  Number(mergeProof.check_app_id) !== requiredCheckAppId ||
  clean(mergeProof.lead_route_evidence_sha256).toLowerCase() !== leadRouteProof.sha256
) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: merge proof is not bound to this exact delivery");
}
const mergeCommitSha = clean(mergeProof.merge_commit_sha).toLowerCase();
if (!/^[a-f0-9]{40}$/.test(mergeCommitSha) || !clean(mergeProof.merged_at)) {
  throw new Error("ARC_DELIVERY_GATE_INVALID: merge proof completion fields");
}

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
const wait = (status, proof = {}) => ({
  status,
  send_delivery_email: false,
  preview_folder: previewFolder,
  delivery_branch: deliveryBranch,
  head_sha: expectedHeadSha,
  bundle_fingerprint: bundleFingerprint,
  lead_route_evidence_sha256: leadRouteProof.sha256,
  pr_number: prNumber,
  proof
});
const validateFiles = files => {
  if (!Array.isArray(files) || files.length !== expectedPaths.length) {
    throw new Error("ARC_DELIVERY_GATE_MISMATCH: PR must change exactly four files");
  }
  const byName = new Map(files.map(file => [clean(file.filename), file]));
  if (byName.size !== expectedPaths.length || expectedPaths.some(path => !byName.has(path))) {
    throw new Error("ARC_DELIVERY_GATE_MISMATCH: PR file scope changed");
  }
  for (const path of expectedPaths) {
    const file = byName.get(path);
    if (clean(file.status) !== "added" || file.previous_filename) {
      throw new Error("ARC_DELIVERY_GATE_MISMATCH: delivery files must be new and unrenamed");
    }
  }
};
const contentUrl = (path, ref) => `${api}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
const readContent = async (path, ref) => {
  const content = await request(contentUrl(path, ref));
  const encoded = clean(content.content).replace(/\s/g, "");
  if (!encoded) throw new Error(`ARC_DELIVERY_GATE_MISMATCH: empty ${path}`);
  return Buffer.from(encoded, "base64").toString("utf8");
};
const verifyExactBundle = async (ref, label) => {
  const observed = await Promise.all(bundle.map(artifact => readContent(artifact.path, ref)));
  const mismatch = bundle.findIndex((artifact, index) => observed[index] !== artifact.content);
  if (mismatch !== -1) throw new Error(`ARC_DELIVERY_GATE_MISMATCH: ${label} ${bundle[mismatch].path} bytes changed`);
};

const pull = await request(`${api}/pulls/${prNumber}`);
if (
  clean(pull.base?.ref) !== baseBranch || clean(pull.head?.ref) !== deliveryBranch ||
  clean(pull.head?.sha).toLowerCase() !== expectedHeadSha || clean(pull.state) !== "closed" ||
  !pull.merged_at || clean(pull.merged_at) !== clean(mergeProof.merged_at) ||
  clean(pull.merge_commit_sha).toLowerCase() !== mergeCommitSha
) {
  throw new Error("ARC_DELIVERY_GATE_MISMATCH: merged PR identity changed");
}
const files = await request(`${api}/pulls/${prNumber}/files?per_page=100`);
validateFiles(files);
const checks = await request(
  `${api}/commits/${expectedHeadSha}/check-runs?check_name=${encodeURIComponent(requiredCheckName)}&filter=latest&per_page=100`
);
const matchingChecks = (Array.isArray(checks.check_runs) ? checks.check_runs : [])
  .filter(check =>
    clean(check.name) === requiredCheckName && clean(check.head_sha).toLowerCase() === expectedHeadSha &&
    clean(check.app?.slug) === requiredCheckAppSlug && Number(check.app?.id) === requiredCheckAppId &&
    Number.isInteger(Number(check.id)) && Number(check.id) > 0
  )
  .sort((left, right) => Number(right.id) - Number(left.id));
const latestCheck = matchingChecks[0];
if (!latestCheck || clean(latestCheck.status) !== "completed" || clean(latestCheck.conclusion) !== "success") {
  const failed = latestCheck && clean(latestCheck.status) === "completed" &&
    !["", "neutral", "skipped", "success"].includes(clean(latestCheck.conclusion));
  return wait(failed ? "BLOCKED_BY_DELIVERY_QUALITY" : "WAITING_FOR_DELIVERY_QUALITY", {
    quality_check: failed ? clean(latestCheck.conclusion) : "pending"
  });
}
await verifyExactBundle(mergeCommitSha, "merge commit");
await verifyExactBundle(baseBranch, "current main");

for (const [index, artifact] of bundle.entries()) {
  const liveUrl = index === 0 ? new URL(productionUrl.toString()) : new URL(artifact.path.split("/").pop(), productionUrl);
  const response = await fetch(liveUrl.toString(), { method: "GET", headers: { Accept: index === 0 ? "text/html" : "*/*" }, redirect: "follow" });
  if (response.status !== 200) {
    return wait("WAITING_FOR_PAGES", { live_path: artifact.path, live_status: response.status });
  }
  const finalUrl = new URL(response.url || liveUrl.toString());
  if (finalUrl.origin !== liveUrl.origin || decodeURIComponent(finalUrl.pathname) !== decodeURIComponent(liveUrl.pathname)) {
    throw new Error(`ARC_DELIVERY_GATE_MISMATCH: Pages redirected ${artifact.path} away from the exact delivery path`);
  }
  const liveBytes = await response.text();
  if (liveBytes !== artifact.content) {
    return wait("WAITING_FOR_PAGES", { live_path: artifact.path, live_status: 200, live_proof: "bytes" });
  }
}

if (leadRouteProof.stagingDeployUrl) {
  const stagingResponse = await fetch(leadRouteProof.stagingDeployUrl, {
    method: "GET",
    headers: { Accept: "text/html" },
    redirect: "manual"
  });
  if (stagingResponse.status !== 200) throw new Error("ARC_LEAD_ROUTE_INVALID: staging site is not live");
  const stagingFinalUrl = new URL(stagingResponse.url || leadRouteProof.stagingDeployUrl);
  const servedHtml = await stagingResponse.text();
  const robotsTokens = clean(stagingResponse.headers?.get?.("x-robots-tag")).toLowerCase().split(",").map(value => value.trim()).filter(Boolean).sort();
  if (stagingFinalUrl.toString() !== leadRouteProof.stagingDeployUrl ||
      await sha256Hex(servedHtml) !== leadRouteProof.servedHtmlSha256 ||
      await sha256Hex(robotsTokens.join(",")) !== leadRouteProof.stagingRobotsHeaderSha256 ||
      !robotsTokens.includes("noindex") || !robotsTokens.includes("nofollow") || !robotsTokens.includes("noarchive") ||
      clean(stagingResponse.headers?.get?.("x-content-type-options")).toLowerCase() !== "nosniff" ||
      clean(stagingResponse.headers?.get?.("x-frame-options")).toUpperCase() !== "DENY") {
    throw new Error("ARC_LEAD_ROUTE_INVALID: immutable staging response or noindex headers changed");
  }
}

// The ref name is a digest of immutable delivery identity only. It excludes caller tokens,
// Stripe sessions, recipient data, and the binding secret. The claim commit stores only a
// secret HMAC of the normalized recipient, so raw email or raw sha256(email) is never public.
const identitySha256 = await sha256Hex([
  "arc-delivery-email-v1",
  `${owner.toLowerCase()}/${repository.toLowerCase()}`,
  previewFolder,
  bundleFingerprint,
  expectedHeadSha,
  String(prNumber),
  mergeCommitSha,
  leadRouteProof.sha256
].join("\n"));
const claimRef = `refs/tags/arc-delivery-email/${identitySha256}`;
const claimMessage = `${JSON.stringify({
  version: "arc-delivery-email-claim-v1",
  identity_sha256: identitySha256,
  recipient_hmac_sha256: recipientBindingHmacSha256,
  preview_folder: previewFolder,
  bundle_fingerprint: bundleFingerprint,
  head_sha: expectedHeadSha,
  pr_number: prNumber,
  merge_commit_sha: mergeCommitSha,
  lead_route_evidence_sha256: leadRouteProof.sha256
}, null, 2)}\n`;
const verifyClaim = async claimSha => {
  if (!/^[a-f0-9]{40}$/i.test(clean(claimSha))) throw new Error("ARC_DELIVERY_GATE_MISMATCH: email claim SHA");
  const claimCommit = await request(`${api}/git/commits/${clean(claimSha)}`);
  if (
    clean(claimCommit.message) !== claimMessage.trimEnd() ||
    clean(claimCommit.tree?.sha).toLowerCase() !== clean(mergeCommit.tree?.sha).toLowerCase() ||
    !Array.isArray(claimCommit.parents) || claimCommit.parents.length !== 1 ||
    clean(claimCommit.parents[0]?.sha).toLowerCase() !== mergeCommitSha
  ) {
    throw new Error("ARC_DELIVERY_GATE_MISMATCH: email claim is bound to another recipient or delivery");
  }
};
const mergeCommit = await request(`${api}/git/commits/${mergeCommitSha}`);
if (!/^[a-f0-9]{40}$/i.test(clean(mergeCommit.tree?.sha))) {
  throw new Error("ARC_DELIVERY_GATE_MISMATCH: merge tree SHA");
}
const existingClaim = await request(
  `${api}/git/ref/${encodeURIComponent(claimRef.replace(/^refs\//, ""))}`,
  {},
  [404]
);
if (!existingClaim._status) {
  await verifyClaim(clean(existingClaim.object?.sha).toLowerCase());
  return {
    status: "DELIVERY_EMAIL_ALREADY_CLAIMED",
    send_delivery_email: false,
    preview_folder: previewFolder,
    delivery_branch: deliveryBranch,
    head_sha: expectedHeadSha,
    bundle_fingerprint: bundleFingerprint,
    lead_route_evidence_sha256: leadRouteProof.sha256,
    pr_number: prNumber,
    email_claim_identity_sha256: identitySha256,
    recipient_hmac_sha256: recipientBindingHmacSha256
  };
}
const claimCommit = await request(`${api}/git/commits`, {
  method: "POST",
  body: JSON.stringify({
    message: claimMessage,
    tree: clean(mergeCommit.tree.sha),
    parents: [mergeCommitSha]
  })
});
const claimCommitSha = clean(claimCommit.sha).toLowerCase();
if (!/^[a-f0-9]{40}$/.test(claimCommitSha)) throw new Error("ARC_GITHUB_FAILED: email claim commit SHA");
const claim = await request(`${api}/git/refs`, {
  method: "POST",
  body: JSON.stringify({ ref: claimRef, sha: claimCommitSha })
}, [422]);
if (claim._status) {
  const existing = await request(`${api}/git/ref/${encodeURIComponent(claimRef.replace(/^refs\//, ""))}`);
  const existingClaimSha = clean(existing.object?.sha).toLowerCase();
  await verifyClaim(existingClaimSha);
  return {
    status: "DELIVERY_EMAIL_ALREADY_CLAIMED",
    send_delivery_email: false,
    preview_folder: previewFolder,
    delivery_branch: deliveryBranch,
    head_sha: expectedHeadSha,
    bundle_fingerprint: bundleFingerprint,
    lead_route_evidence_sha256: leadRouteProof.sha256,
    pr_number: prNumber,
    email_claim_identity_sha256: identitySha256,
    recipient_hmac_sha256: recipientBindingHmacSha256
  };
}
await verifyClaim(claimCommitSha);

return {
  status: "READY_TO_SEND_DELIVERY_EMAIL",
  send_delivery_email: true,
  email_claim_committed: true,
  state_write_required_before_email: true,
  customer_email: customerEmail,
  preview_folder: previewFolder,
  delivery_branch: deliveryBranch,
  head_sha: expectedHeadSha,
  bundle_fingerprint: bundleFingerprint,
  lead_route_evidence_sha256: leadRouteProof.sha256,
  lead_route_form_name: leadRouteProof.formName,
  lead_route_recipient_hmac_sha256: leadRouteProof.recipientHmacSha256,
  pr_number: prNumber,
  production_url: productionUrl.toString(),
  deploy_url: deployUrl,
  email_claim_identity_sha256: identitySha256,
  recipient_hmac_sha256: recipientBindingHmacSha256,
  required_check: requiredCheckName
};
