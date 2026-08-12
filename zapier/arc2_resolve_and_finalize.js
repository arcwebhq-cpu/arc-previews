// ARC2 Code step — retrieve the authoritative Stripe test Checkout Session,
// resolve the exact approved preview, finalize it, and prepare a delivery candidate.
const clean = value => String(value == null ? "" : value).trim();
const sessionId = clean(inputData.checkout_session_id || inputData.session_id);
const stripeTestApiKey = clean(inputData.stripe_test_api_key);
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const expectedPaymentLinkId = clean(inputData.expected_payment_link_id);
const expectedTermsVersion = "2026-08-11";
const owner = clean(inputData.preview_source_github_owner || inputData.github_owner);
const repository = clean(inputData.preview_source_github_repo || inputData.github_repo);
const branch = clean(inputData.preview_source_github_branch || inputData.github_branch || "main");
const token = clean(inputData.github_token);
const deliveryOwner = clean(inputData.delivery_github_owner);
const deliveryRepository = clean(inputData.delivery_github_repo);
if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error("ARC_PAYMENT_INVALID: test checkout session id");
if (!/^(?:sk|rk)_test_[A-Za-z0-9_]{12,}$/.test(stripeTestApiKey)) {
  throw new Error("ARC_PAYMENT_INVALID: Stripe test API key is required");
}
if (!/^plink_[A-Za-z0-9]+$/.test(expectedPaymentLinkId)) throw new Error("ARC_PAYMENT_INVALID: expected Payment Link id");
if (clean(inputData.expected_terms_version) !== expectedTermsVersion) {
  throw new Error("ARC_PAYMENT_INVALID: configured terms version must match the static ARC checkout contract");
}
if (checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256) {
  throw new Error("ARC_PAYMENT_INVALID: checkout binding secret must be 32–256 characters");
}
if (!token) throw new Error("ARC_GITHUB_INVALID: preview-source github_token is required");
if (branch !== "main") throw new Error("ARC_GITHUB_INVALID: ARC2 must resolve an approved preview from main");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)) {
  throw new Error("ARC_GITHUB_INVALID: preview-source owner, repository, or branch");
}
if (!/^[A-Za-z0-9_.-]+$/.test(deliveryOwner) || !/^[A-Za-z0-9_.-]+$/.test(deliveryRepository) ||
    deliveryOwner.toLowerCase() === "arcwebhq-cpu" && deliveryRepository.toLowerCase() === "arc-previews" ||
    deliveryOwner.toLowerCase() === owner.toLowerCase() && deliveryRepository.toLowerCase() === repository.toLowerCase()) {
  throw new Error("ARC_DELIVERY_REPOSITORY_INVALID: an explicit private delivery repository separate from the preview source is required");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256 and SHA-256 are required");
}
const encoder = new TextEncoder();
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};

// The Stripe trigger payload and caller-mapped fields are notification hints only.
// Every payment, consent, customer, and preview-binding fact below comes from this
// authenticated read of the exact test-mode Checkout Session.
const stripeSessionUrl = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`;
const stripeResponse = await fetch(stripeSessionUrl, {
  method: "GET",
  headers: {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${stripeTestApiKey}:`, "utf8").toString("base64")}`
  },
  redirect: "error"
});
if (stripeResponse.url && stripeResponse.url !== stripeSessionUrl) {
  throw new Error("ARC_PAYMENT_INVALID: Stripe API redirect rejected");
}
if (!stripeResponse.ok) {
  throw new Error(`ARC_PAYMENT_INVALID: Stripe Checkout Session retrieval failed (${stripeResponse.status})`);
}
const session = await stripeResponse.json();
if (!session || typeof session !== "object" || Array.isArray(session) || session.object !== "checkout.session" || clean(session.id) !== sessionId) {
  throw new Error("ARC_PAYMENT_INVALID: Stripe Checkout Session identity mismatch");
}
const rawClientReferenceId = clean(session.client_reference_id);
const paymentLinkId = clean(typeof session.payment_link === "object" ? session.payment_link?.id : session.payment_link);
const termsConsent = clean(session.consent?.terms_of_service).toLowerCase();
const termsVersion = clean(session.metadata?.terms_version);
const sessionCustomerDetailsEmail = clean(session.customer_details?.email).toLowerCase();
const sessionCustomerEmail = clean(session.customer_email).toLowerCase();
if (sessionCustomerDetailsEmail && sessionCustomerEmail && sessionCustomerDetailsEmail !== sessionCustomerEmail) {
  throw new Error("ARC_HANDOFF_INVALID: Stripe customer email fields disagree");
}
const customerEmail = sessionCustomerDetailsEmail || sessionCustomerEmail;
const adultAcknowledgements = (Array.isArray(session.custom_fields) ? session.custom_fields : []).filter(field =>
  field && typeof field === "object" && clean(field.key) === "adult_purchaser_ack"
);
const adultAcknowledgement = clean(
  adultAcknowledgements[0]?.dropdown?.value ||
  adultAcknowledgements[0]?.text?.value ||
  adultAcknowledgements[0]?.numeric?.value
).toLowerCase();
if (!rawClientReferenceId) throw new Error("ARC_FOLDER_NOT_FOUND: client_reference_id is empty");
if (session.livemode !== false) throw new Error("ARC_PAYMENT_INVALID: livemode must be false");
if (clean(session.mode).toLowerCase() !== "payment" || clean(session.status).toLowerCase() !== "complete") {
  throw new Error("ARC_PAYMENT_INVALID: Checkout Session must be a completed one-time payment");
}
if (clean(session.payment_status).toLowerCase() !== "paid") throw new Error("ARC_PAYMENT_INVALID: session is not paid");
if (clean(session.currency).toLowerCase() !== "usd") throw new Error("ARC_PAYMENT_INVALID: currency must be usd");
if (!Number.isSafeInteger(session.amount_total) || session.amount_total !== 500000) {
  throw new Error("ARC_PAYMENT_INVALID: amount_total must be exactly 500000 minor units ($5,000.00)");
}
if (paymentLinkId !== expectedPaymentLinkId) throw new Error("ARC_PAYMENT_INVALID: Payment Link identity mismatch");
if (termsConsent !== "accepted") throw new Error("ARC_PAYMENT_INVALID: terms_of_service consent must be accepted");
if (termsVersion !== expectedTermsVersion) throw new Error("ARC_PAYMENT_INVALID: terms version mismatch");
if (adultAcknowledgements.length !== 1 || adultAcknowledgement !== "accepted") {
  throw new Error("ARC_PAYMENT_INVALID: adult purchaser acknowledgement must be accepted");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
  throw new Error("ARC_HANDOFF_INVALID: Stripe customer email");
}
const signedReference = rawClientReferenceId.match(/^((?:[a-z0-9][a-z0-9-]*-[a-f0-9]{8})|(?:[a-f0-9]{8}))\.([a-f0-9]{64})$/i);
if (!signedReference) throw new Error("ARC_PAYMENT_INVALID: signed checkout reference");
const clientReferenceId = signedReference[1].toLowerCase();
const checkoutSignature = Uint8Array.from(signedReference[2].match(/../g), byte => Number.parseInt(byte, 16));
const checkoutBindingKey = await globalThis.crypto.subtle.importKey(
  "raw",
  encoder.encode(checkoutBindingSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);
if (!(await globalThis.crypto.subtle.verify("HMAC", checkoutBindingKey, checkoutSignature, encoder.encode(clientReferenceId)))) {
  throw new Error("ARC_PAYMENT_INVALID: checkout reference signature mismatch");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28"
};
const github = async url => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`ARC_GITHUB_FAILED: ${response.status} ${response.statusText}`);
  return response.json();
};
const tree = await github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
if (tree.truncated) throw new Error("ARC_FOLDER_LOOKUP_FAILED: repository tree was truncated");
const folders = [...new Set((tree.tree || [])
  .filter(item => item.type === "blob" && /(?:^|\/)index\.html$/i.test(item.path || ""))
  .map(item => item.path.replace(/\/index\.html$/i, ""))
  .filter(folder => !/^deliveries\//i.test(folder)))];
let previewFolder = folders.includes(clientReferenceId) ? clientReferenceId : "";
if (!previewFolder) {
  if (!/^[a-f0-9]{8}$/i.test(clientReferenceId)) {
    throw new Error("ARC_FOLDER_NOT_FOUND: reference must be an exact folder or exactly eight hexadecimal characters");
  }
  const prefix = clientReferenceId.toLowerCase();
  const matches = folders.filter(folder => {
    const leaf = folder.split("/").pop().toLowerCase();
    return leaf === `arc-${prefix}` || leaf.endsWith(`-${prefix}`);
  });
  if (matches.length !== 1) throw new Error(`ARC_FOLDER_NOT_FOUND: expected one match for ${prefix}; found ${matches.length}`);
  previewFolder = matches[0];
}
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/i.test(previewFolder)) {
  throw new Error("ARC_FOLDER_NOT_FOUND: resolved preview must be one root folder ending in eight hexadecimal characters");
}
const previewPath = `${previewFolder}/index.html`;
const content = await github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${previewPath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`);
let html = Buffer.from(clean(content.content).replace(/\s/g, ""), "base64").toString("utf8").trim();
if (!/<!doctype html>/i.test(html) || !/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) {
  throw new Error("ARC_FINALIZE_INVALID: source is not a complete private preview");
}
if (!/<meta\s+name=["']arc-template-version["']\s+content=["']10\.0["']/i.test(html)) throw new Error("ARC_FINALIZE_INVALID: only verified ARC v10 previews can be delivered");
const proofBlocks = html.match(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/gi) || [];
const proofFolder = html.match(/<meta\s+name=["']arc-preview-folder["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] || "";
const proofSourceSha256 = html.match(/<meta\s+name=["']arc-preview-source-sha256["'][^>]*content=["']([a-f0-9]{64})["'][^>]*>/i)?.[1] || "";
if (proofBlocks.length !== 1 || proofFolder !== previewFolder || !proofSourceSha256) {
  throw new Error("ARC_FINALIZE_INVALID: approved preview proof is missing or mismatched");
}
const proofSourceHtml = html.replace(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/i, "");
if (await sha256Hex(proofSourceHtml) !== proofSourceSha256.toLowerCase()) {
  throw new Error("ARC_FINALIZE_INVALID: approved preview proof hash mismatch");
}
if (!/class=["'][^"']*arc-preview-toolbar/i.test(html)) throw new Error("ARC_FINALIZE_INVALID: preview purchase toolbar is missing");
html = html.replace(/<aside\b[^>]*class=["'][^"']*arc-preview-toolbar[^"']*["'][^>]*>[\s\S]*?<\/aside>\s*/gi, "");
const replaceOrInsertHead = (expression, markup) => {
  html = expression.test(html) ? html.replace(expression, markup) : html.replace(/<\/head>/i, `  ${markup}\n</head>`);
};
replaceOrInsertHead(/<meta\s+name=["']robots["'][^>]*>/i, '<meta name="robots" content="index,follow,max-image-preview:large">');
replaceOrInsertHead(/<meta\s+name=["']arc-site-mode["'][^>]*>/i, '<meta name="arc-site-mode" content="production">');
html = html.replace(/<body\b([^>]*?)\sdata-arc-site-mode=["'][^"']*["']([^>]*)>/i, '<body$1 data-arc-site-mode="production"$2>');
if (!/data-arc-site-mode=["']production["']/i.test(html)) html = html.replace(/<body\b/i, '<body data-arc-site-mode="production"');
html = html.replace(/\[ARC TEST\]\s*/gi, "").trim() + "\n";
if (/noindex/i.test(html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "")) throw new Error("ARC_FINALIZE_FAILED: noindex remained");
if (/\[\[[A-Z0-9_]+\]\]/.test(html)) throw new Error("ARC_FINALIZE_FAILED: unresolved placeholder");
if (/<aside\b[^>]*arc-preview-toolbar|data-arc-checkout|buy\.stripe\.com/i.test(html)) throw new Error("ARC_FINALIZE_FAILED: preview payment controls remained in production");

const verifiedLeadNotificationEmail = clean(inputData.verified_lead_notification_email).toLowerCase();
const leadRouteEvidenceSecret = clean(inputData.lead_route_evidence_secret);
const productionFolder = `deliveries/${previewFolder}`;
const productionPath = `${productionFolder}/index.html`;
// The final customer URL is unknowable until the customer-controlled Netlify
// site exists. Remove any source-preview URL instead of publishing a false
// canonical or coupling paid delivery to ARC Pages.
html = html
  .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "")
  .replace(/<meta\s+property=["']og:url["'][^>]*>\s*/gi, "");
const netlifyConfig = `[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n    X-Frame-Options = "DENY"\n    X-Robots-Tag = "noindex, nofollow, noarchive"\n    Referrer-Policy = "strict-origin-when-cross-origin"\n    Permissions-Policy = "camera=(), microphone=(), geolocation=()"\n`;
const usageGuide = `# Launch checklist\n\nThis is a private pre-launch handoff bundle. It is not proof of repository ownership, Netlify ownership, transfer, or launch readiness.\n\nARC must place these exact four files into a customer-approved repository and Netlify site through a separate secure handoff. There is no one-click transfer promise. The delivery email remains blocked until ARC's read-only verifier proves that the authenticated customer controls both destinations and that their bytes match this paid bundle.\n\n1. Complete the separately approved secure repository and Netlify setup.\n2. Confirm the new GitHub repository and Netlify site are in accounts the customer controls.\n3. In Netlify, enable **Forms > Form detection**, then redeploy once.\n4. In **Project configuration > Notifications > Form submission notifications**, add the separately verified lead-notification address.\n5. Submit one test lead and confirm it arrives before connecting the final domain.\n6. Connect the business domain and add its final HTTPS URL as the canonical and Open Graph URL.\n7. Only after the final domain and lead route are verified, remove the staging-only \`X-Robots-Tag\` noindex header from \`netlify.toml\` and redeploy.\n\nDo not publish unverified claims, reviews, licenses, prices, or results.\n`;
const supportedLeadControlNames = new Set(["form-name", "bot-field", "name", "email", "phone", "project_details"]);
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
const resolveLeadForm = markup => {
  const formBlocks = markup.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const formOpenings = markup.match(/<form\b[^>]*>/gi) || [];
  if (!formOpenings.length) return { hasLeadForm: false, formName: "" };
  if (formBlocks.length !== 1 || formOpenings.length !== 1) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: production must contain exactly one Netlify-managed form");
  }
  const formAttributes = canonicalAttributes(formOpenings[0], "form");
  const formName = clean(formAttributes?.get("name"));
  const honeypotName = clean(formAttributes?.get("netlify-honeypot"));
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(formName) ||
      formAttributes?.get("method") !== "POST" || formAttributes?.get("data-netlify") !== "true" || honeypotName !== "bot-field") {
    throw new Error("ARC_LEAD_ROUTE_INVALID: exact Netlify form attributes are required");
  }
  const controls = [];
  for (const tag of formBlocks[0].match(/<(?:input|textarea|select|button)\b[^>]*>/gi) || []) {
    const tagName = tag.match(/^<([a-z]+)/i)?.[1].toLowerCase();
    const attributes = canonicalAttributes(tag, tagName);
    if (!attributes) throw new Error("ARC_LEAD_ROUTE_INVALID: malformed canonical lead control");
    const name = clean(attributes.get("name"));
    if (name) controls.push({ tagName, name, attributes });
  }
  const names = controls.map(control => control.name);
  if (new Set(names).size !== names.length || names.some(name => !supportedLeadControlNames.has(name)) ||
      [...supportedLeadControlNames].some(name => !names.includes(name))) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: duplicate, unsupported, or missing lead control");
  }
  const control = name => controls.find(item => item.name === name);
  const type = name => clean(control(name)?.attributes.get("type")).toLowerCase();
  const required = name => control(name)?.attributes.has("required");
  if (control("form-name")?.tagName !== "input" || type("form-name") !== "hidden" || clean(control("form-name")?.attributes.get("value")) !== formName ||
      control(honeypotName)?.tagName !== "input" || !new Set(["", "text"]).has(type(honeypotName)) ||
      control("name")?.tagName !== "input" || type("name") !== "text" || !required("name") ||
      control("email")?.tagName !== "input" || type("email") !== "email" || !required("email") ||
      control("phone")?.tagName !== "input" || type("phone") !== "tel" ||
      control("project_details")?.tagName !== "textarea" || !required("project_details") ||
      (formBlocks[0].match(/<button\b[^>]*type="submit"[^>]*>/gi) || []).length !== 1) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: lead control semantics do not match the supported schema");
  }
  return { hasLeadForm: true, formName };
};
const leadForm = resolveLeadForm(html);
const hasLeadForm = leadForm.hasLeadForm;
const leadRouteFormName = leadForm.formName;
if (hasLeadForm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedLeadNotificationEmail)) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: verified lead notification email");
}
if (hasLeadForm && (leadRouteEvidenceSecret.length < 32 || leadRouteEvidenceSecret.length > 256)) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: lead-route evidence secret must be 32–256 characters");
}
let leadRouteRecipientHmacSha256 = "";
if (hasLeadForm) {
  const leadRouteKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(leadRouteEvidenceSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const recipientBinding = await globalThis.crypto.subtle.sign(
    "HMAC",
    leadRouteKey,
    encoder.encode(`arc-lead-route-recipient-v1\n${verifiedLeadNotificationEmail}`)
  );
  leadRouteRecipientHmacSha256 = [...new Uint8Array(recipientBinding)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
for (const [label, publicContent] of [["production HTML", html], ["Netlify config", netlifyConfig], ["usage guide", usageGuide]]) {
  for (const privateValue of [sessionId, customerEmail, verifiedLeadNotificationEmail, leadRouteEvidenceSecret].filter(Boolean)) {
    if (publicContent.toLowerCase().includes(privateValue.toLowerCase())) {
      throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private handoff data`);
    }
  }
}
const productionSha256 = await sha256Hex(html);
const bundleArtifacts = [
  { path: productionPath, content: html },
  { path: `${productionFolder}/netlify.toml`, content: netlifyConfig },
  { path: `${productionFolder}/USAGE.md`, content: usageGuide }
];
const bundleFingerprint = await sha256Hex(bundleArtifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
const paymentEvidence = JSON.stringify({
  version: "arc2-payment-evidence-v1",
  scope: "authoritative-stripe-test-checkout-session",
  checkout_session_id: sessionId,
  client_reference_id_sha256: await sha256Hex(rawClientReferenceId),
  preview_folder: previewFolder,
  production_content_sha256: productionSha256,
  bundle_fingerprint: bundleFingerprint,
  customer_email_sha256: await sha256Hex(customerEmail),
  livemode: false,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  amount_total_minor_units: 500000,
  payment_link_id: paymentLinkId,
  terms_version: termsVersion,
  adult_purchaser_acknowledgement: "accepted"
});
const paymentEvidenceSignatureBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  checkoutBindingKey,
  encoder.encode(`arc2-payment-evidence-signature-v1\n${paymentEvidence}`)
);
const paymentEvidenceHmacSha256 = [...new Uint8Array(paymentEvidenceSignatureBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");
return {
  status: hasLeadForm ? "PENDING_LIVE_STAGING_EVIDENCE" : "READY_FOR_DELIVERY_PR",
  delivery_pr_write_unlocked: !hasLeadForm,
  payment_verification_status: "verified_test_payment_from_stripe_api",
  stripe_session_retrieved: true,
  checkout_session_id: sessionId,
  client_reference_id: rawClientReferenceId,
  livemode: false,
  payment_status: "paid",
  currency: "usd",
  amount_total_minor_units: 500000,
  payment_link_id: paymentLinkId,
  terms_of_service_consent: "accepted",
  terms_version: termsVersion,
  adult_purchaser_acknowledgement: "accepted",
  payment_evidence_private: paymentEvidence,
  payment_evidence_hmac_sha256: paymentEvidenceHmacSha256,
  dedupe_key: `arc2:${sessionId}`,
  preview_folder: previewFolder,
  preview_file_path: previewPath,
  preview_blob_sha: content.sha,
  production_folder: productionFolder,
  production_file_path: productionPath,
  production_content_base64: Buffer.from(html, "utf8").toString("base64"),
  netlify_config_path: `${productionFolder}/netlify.toml`,
  netlify_config_base64: Buffer.from(netlifyConfig, "utf8").toString("base64"),
  usage_guide_path: `${productionFolder}/USAGE.md`,
  usage_guide_base64: Buffer.from(usageGuide, "utf8").toString("base64"),
  production_html_character_count: html.length,
  production_content_sha256: productionSha256,
  bundle_fingerprint: bundleFingerprint,
  secure_customer_setup_required: true,
  preview_source_repository: `${owner}/${repository}`,
  private_delivery_repository: `${deliveryOwner}/${deliveryRepository}`,
  customer_email: customerEmail,
  lead_route_status: hasLeadForm ? "pending_live_staging_evidence" : "not_required",
  lead_route_evidence_required: hasLeadForm,
  lead_route_evidence_version: hasLeadForm ? "arc-lead-route-evidence-v1" : "",
  lead_route_form_name: leadRouteFormName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
  verified_lead_notification_email: hasLeadForm ? verifiedLeadNotificationEmail : "",
  commit_message: `Publish paid ARC site for ${previewFolder}`
};
