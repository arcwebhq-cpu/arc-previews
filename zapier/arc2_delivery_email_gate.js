// ARC2 final-delivery email authorization gate.
// The signed claim-state is issued only after the claim service re-reads the exact
// v4 artifact vector from the claimed destination and reserves the durable outbox.
// This step does not read providers, write state, send email, or accept claim credentials.
const clean = value => String(value == null ? "" : value).trim();
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const paymentPrivate = clean(inputData.payment_evidence_private);
const paymentSignature = clean(inputData.payment_evidence_hmac_sha256).toLowerCase();
const currentCheckoutSecret = clean(inputData.checkout_binding_secret);
const currentCheckoutKeyId = clean(inputData.checkout_binding_key_id).toLowerCase();
const retiredKeysRaw = clean(inputData.retired_checkout_binding_keys_json);
const artifactPrivate = clean(inputData.handoff_artifact_evidence_private);
const artifactSignature = clean(inputData.handoff_artifact_evidence_hmac_sha256).toLowerCase();
const artifactSecret = clean(inputData.handoff_artifact_evidence_secret);
const claimPrivate = clean(inputData.claim_state_evidence_private);
const claimSignature = clean(inputData.claim_state_evidence_hmac_sha256).toLowerCase();
const claimSecret = clean(inputData.claim_state_evidence_secret);
const outboxSecret = clean(inputData.email_claim_binding_secret);
const recipientEmail = clean(inputData.recipient_email).toLowerCase();
const liveModeFlag = clean(inputData.stripe_live_mode_enabled).toLowerCase();
if (!["false", "true"].includes(liveModeFlag)) throw new Error("ARC_STRIPE_MODE_INVALID: stripe_live_mode_enabled must be explicit true or false");
const stripeMode = liveModeFlag === "true" ? "live" : "test";
for (const [label, secret] of [["checkout binding", currentCheckoutSecret], ["handoff artifact evidence", artifactSecret],
  ["claim-state evidence", claimSecret], ["email claim binding", outboxSecret]]) {
  if (secret.length < 32 || secret.length > 256) throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} secret must be 32–256 characters`);
}
if (new Set([currentCheckoutSecret, artifactSecret, claimSecret, outboxSecret]).size !== 4 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: separate secrets and recipient are required");
}
if ([inputData.claim_url, inputData.ownership_handoff_url, inputData.netlify_oauth_token, inputData.netlify_access_token,
  inputData.github_token].some(value => clean(value))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim URLs and provider credentials are forbidden at the final-email gate");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256 and SHA-256 are required");
const encoder = new TextEncoder();
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const importHmacKey = (secret, usages) => globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
const signatureBytes = signature => {
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error("ARC_DELIVERY_EMAIL_INVALID: evidence HMAC");
  return Uint8Array.from(signature.match(/../g), byte => Number.parseInt(byte, 16));
};
const verifyEvidence = async (text, signature, secret, prefix, label) => {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== text) throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} must be canonical JSON`);
  if (!(await globalThis.crypto.subtle.verify("HMAC", await importHmacKey(secret, ["verify"]), signatureBytes(signature), encoder.encode(`${prefix}\n${text}`)))) {
    throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} HMAC mismatch`);
  }
  return value;
};
let retiredKeys;
try { retiredKeys = JSON.parse(retiredKeysRaw); } catch {}
if (!/^[a-f0-9]{2}$/.test(currentCheckoutKeyId) || !retiredKeys || typeof retiredKeys !== "object" || Array.isArray(retiredKeys) || canonicalJson(retiredKeys) !== retiredKeysRaw ||
    Object.entries(retiredKeys).some(([id, secret]) => !/^[a-f0-9]{2}$/.test(id) || id === currentCheckoutKeyId || typeof secret !== "string" || secret.length < 32 || secret.length > 256) ||
    new Set(Object.values(retiredKeys)).size !== Object.values(retiredKeys).length || Object.values(retiredKeys).includes(currentCheckoutSecret)) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: checkout binding key registry");
}

let unsignedPayment;
try { unsignedPayment = JSON.parse(paymentPrivate); } catch { throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment evidence JSON"); }
const checkoutReference = clean(unsignedPayment?.client_reference_id);
let referenceBytes;
try { referenceBytes = Buffer.from(checkoutReference.slice(3), "base64url"); } catch {}
if (!/^v4_[A-Za-z0-9_-]{135}$/.test(checkoutReference) || !referenceBytes || referenceBytes.length !== 101 || referenceBytes.toString("base64url") !== checkoutReference.slice(3)) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: canonical checkout reference v4");
}
const referencePayload = referenceBytes.subarray(0, 69);
const referenceKeyId = referencePayload.subarray(0, 1).toString("hex");
const selectedCheckoutSecret = referenceKeyId === currentCheckoutKeyId ? currentCheckoutSecret : retiredKeys[referenceKeyId];
if (!selectedCheckoutSecret) throw new Error("ARC_DELIVERY_EMAIL_INVALID: checkout reference key is not retained");
const payment = await verifyEvidence(paymentPrivate, paymentSignature, selectedCheckoutSecret, `arc2-payment-evidence-signature-v4\n${stripeMode}`, "payment evidence");
const referenceDomain = encoder.encode(`arc-checkout-reference-v4\narcwebhq-cpu/arc-previews\narc-production\nstripe-${stripeMode}\n`);
const referenceMessage = new Uint8Array(referenceDomain.length + referencePayload.length);
referenceMessage.set(referenceDomain); referenceMessage.set(referencePayload, referenceDomain.length);
if (!(await globalThis.crypto.subtle.verify("HMAC", await importHmacKey(selectedCheckoutSecret, ["verify"]), referenceBytes.subarray(69), referenceMessage))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: checkout reference v4 HMAC");
}
const paymentFields = [
  "adult_purchaser_acknowledgement", "approval_content_sha256", "amount_total_minor_units", "artifact_manifest_sha256", "automatic_tax_enabled",
  "automatic_tax_status", "asset_publication_receipt_sha256", "bundle_fingerprint", "checkout_session_id", "checkout_config_snapshot",
  "checkout_config_snapshot_sha256", "client_reference_id", "client_reference_id_observation", "client_reference_id_sha256",
  "client_reference_mismatch_review_hmac_sha256", "client_reference_mismatch_review_record_key_hmac_sha256", "client_reference_mismatch_review_required",
  "client_reference_mismatch_review_sha256", "client_reference_mismatch_review_state", "currency", "customer_address_country", "customer_address_sha256",
  "customer_address_state", "customer_address_status", "claim_recipient_email_sha256", "handoff_artifact_evidence_sha256", "livemode", "mode",
  "payment_link_id", "payment_intent_id", "payment_status", "payer_email_sha256", "preview_folder", "preview_source_commit_sha",
  "preview_source_repository", "preview_source_tag_sha256", "price_id", "price_tax_behavior", "product_tax_code", "product_id",
  "production_content_sha256", "quantity", "scope", "status", "charge_id", "stripe_account_id_sha256", "subtotal_amount_minor_units",
  "tax_amount_minor_units", "tax_contract_version", "tax_registrations_sha256", "tax_registration_status", "terms_of_service_consent", "terms_version", "version"
];
const hexFields = ["approval_content_sha256", "artifact_manifest_sha256", "asset_publication_receipt_sha256", "bundle_fingerprint", "checkout_config_snapshot_sha256",
  "client_reference_id_sha256", "claim_recipient_email_sha256", "handoff_artifact_evidence_sha256", "payer_email_sha256", "preview_source_tag_sha256",
  "production_content_sha256", "stripe_account_id_sha256", "tax_registrations_sha256", "customer_address_sha256"];
if (JSON.stringify(Object.keys(payment).sort()) !== JSON.stringify(paymentFields.slice().sort()) || payment.version !== "arc2-payment-evidence-v4" ||
    payment.scope !== "authoritative-stripe-checkout-session" || !new RegExp(`^cs_${stripeMode}_[A-Za-z0-9_]+$`).test(payment.checkout_session_id) ||
    payment.client_reference_id !== checkoutReference || payment.client_reference_id_sha256 !== await sha256Hex(checkoutReference) ||
    payment.checkout_config_snapshot_sha256 !== referencePayload.subarray(37, 69).toString("hex") || payment.approval_content_sha256 !== referencePayload.subarray(5, 37).toString("hex") ||
    payment.preview_source_tag_sha256 !== await sha256Hex(`refs/tags/arc-checkout-ready-v4/${payment.client_reference_id_sha256}`) ||
    !hexFields.every(field => /^[a-f0-9]{64}$/.test(clean(payment[field]))) || payment.livemode !== (stripeMode === "live") || payment.mode !== "payment" ||
    payment.status !== "complete" || payment.payment_status !== "paid" || payment.currency !== "usd" || payment.subtotal_amount_minor_units !== 500000 ||
    !Number.isSafeInteger(payment.tax_amount_minor_units) || payment.tax_amount_minor_units < 0 || payment.tax_amount_minor_units > 500000 ||
    !Number.isSafeInteger(payment.amount_total_minor_units) || payment.amount_total_minor_units !== 500000 + payment.tax_amount_minor_units || payment.quantity !== 1 ||
    !/^plink_[A-Za-z0-9]+$/.test(payment.payment_link_id) || !/^pi_[A-Za-z0-9]+$/.test(payment.payment_intent_id) || !/^ch_[A-Za-z0-9]+$/.test(payment.charge_id) ||
    !/^price_[A-Za-z0-9]+$/.test(payment.price_id) || !/^prod_[A-Za-z0-9]+$/.test(payment.product_id) || !/^txcd_[0-9]{8}$/.test(payment.product_tax_code) ||
    payment.price_tax_behavior !== "exclusive" || payment.automatic_tax_enabled !== true || payment.automatic_tax_status !== "complete" ||
    payment.customer_address_status !== "verified" || payment.tax_registration_status !== "historical_precheckout_snapshot" || payment.tax_contract_version !== "arc-tax-v1" ||
    !/^[A-Z]{2}$/.test(payment.customer_address_country) || !/^[A-Z0-9-]{0,10}$/.test(payment.customer_address_state) ||
    (payment.customer_address_country === "US" && !/^[A-Z]{2}$/.test(payment.customer_address_state)) ||
    (payment.customer_address_country === "US" && payment.customer_address_state === "WA" && payment.tax_amount_minor_units <= 0) ||
    payment.terms_of_service_consent !== "accepted" || payment.terms_version !== "2026-08-25" || payment.adult_purchaser_acknowledgement !== "accepted") {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment evidence v4 contract");
}
const mismatch = payment.client_reference_id_observation === "MISMATCH_REVIEW_REQUIRED";
if (!["ABSENT", "MATCHED", "MISMATCH_REVIEW_REQUIRED"].includes(payment.client_reference_id_observation) || payment.client_reference_mismatch_review_required !== mismatch ||
    (!mismatch && [payment.client_reference_mismatch_review_record_key_hmac_sha256, payment.client_reference_mismatch_review_state,
      payment.client_reference_mismatch_review_sha256, payment.client_reference_mismatch_review_hmac_sha256].some(Boolean))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: client-reference observation contract");
}
if (mismatch) {
  let review;
  try { review = JSON.parse(payment.client_reference_mismatch_review_state); } catch {
    throw new Error("ARC_DELIVERY_EMAIL_INVALID: client-reference mismatch review JSON");
  }
  const reviewFields = ["checkout_policy_sha256", "checkout_session_id_hmac_sha256", "expected_checkout_reference_sha256", "link_id_hmac_sha256",
    "link_receipt_sha256", "observed_client_reference_sha256", "record_key_hmac_sha256", "scope", "status", "stripe_account_id_sha256", "stripe_mode", "version"];
  const reviewCanonical = canonicalJson(review);
  if (!review || typeof review !== "object" || Array.isArray(review) || JSON.stringify(Object.keys(review).sort()) !== JSON.stringify(reviewFields) ||
      reviewCanonical !== payment.client_reference_mismatch_review_state || review.version !== "arc2-client-reference-mismatch-review-v1" ||
      review.scope !== "buyer-supplied-client-reference-anomaly" || review.status !== "REVIEW_REQUIRED" || review.stripe_mode !== stripeMode ||
      review.record_key_hmac_sha256 !== payment.client_reference_mismatch_review_record_key_hmac_sha256 ||
      review.checkout_policy_sha256 !== payment.checkout_config_snapshot_sha256 || review.expected_checkout_reference_sha256 !== payment.client_reference_id_sha256 ||
      review.stripe_account_id_sha256 !== payment.stripe_account_id_sha256 ||
      !["checkout_session_id_hmac_sha256", "link_id_hmac_sha256", "link_receipt_sha256", "observed_client_reference_sha256", "record_key_hmac_sha256"]
        .every(field => /^[a-f0-9]{64}$/.test(review[field])) || await sha256Hex(reviewCanonical) !== payment.client_reference_mismatch_review_sha256 ||
      !(await globalThis.crypto.subtle.verify("HMAC", await importHmacKey(selectedCheckoutSecret, ["verify"]),
        signatureBytes(payment.client_reference_mismatch_review_hmac_sha256),
        encoder.encode(`arc2-client-reference-mismatch-review-signature-v1\n${stripeMode}\n${reviewCanonical}`)))) {
    throw new Error("ARC_DELIVERY_EMAIL_INVALID: client-reference mismatch review binding");
  }
}
const paymentSha256 = await sha256Hex(paymentPrivate);
const recipientSha256 = await sha256Hex(recipientEmail);
if (recipientSha256 !== payment.claim_recipient_email_sha256) throw new Error("ARC_DELIVERY_EMAIL_INVALID: recipient is not the reserved claim recipient");

let policy;
try { policy = JSON.parse(payment.checkout_config_snapshot); } catch { throw new Error("ARC_DELIVERY_EMAIL_INVALID: private checkout policy JSON"); }
const policyFields = ["adult_acknowledgement_key", "amount_subtotal_minor_units", "approval_content_sha256", "asset_publication_receipt_sha256", "automatic_tax_enabled",
  "checkout_binding_key_id", "checkout_redirect_url", "claim_recipient_email_sha256", "completed_sessions_limit", "content_sha256", "currency", "customer_address_source",
  "deliverable", "lead_route_recipient_hmac_sha256", "name_collection_required", "offer_contract_id", "offer_snapshot_sha256", "page_count", "preview_folder",
  "preview_paths", "preview_source_repository", "price_id", "price_tax_behavior", "product_id", "product_tax_code", "published_site_sha256", "quantity",
  "readiness_core_sha256", "recipient_reservation_sha256", "scope", "source_commit_sha", "source_tree_sha", "stripe_account_id_sha256", "stripe_api_version",
  "stripe_mode", "tax_contract_version", "tax_registrations", "tax_registrations_sha256", "terms_document_sha256", "terms_version", "version"];
const expectedPreviewPaths = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"].map(path => `${payment.preview_folder}/${path}`);
if (!policy || typeof policy !== "object" || Array.isArray(policy) || JSON.stringify(Object.keys(policy).sort()) !== JSON.stringify(policyFields.slice().sort()) ||
    canonicalJson(policy) !== payment.checkout_config_snapshot || await sha256Hex(payment.checkout_config_snapshot) !== payment.checkout_config_snapshot_sha256 ||
    policy.version !== "arc-private-checkout-policy-v2" || policy.scope !== "one-approved-five-page-preview-one-private-payment-link" ||
    policy.checkout_binding_key_id !== referenceKeyId || policy.stripe_mode !== stripeMode || policy.preview_folder !== payment.preview_folder ||
    !payment.preview_folder.endsWith(`-${referencePayload.subarray(1,5).toString("hex")}`) || policy.offer_contract_id !== "arc-fixed-five-page-offer-v1" ||
    policy.deliverable !== "fixed-five-page-marketing-website-v1" || policy.page_count !== 5 || canonicalJson(policy.preview_paths) !== canonicalJson(expectedPreviewPaths) ||
    policy.preview_source_repository !== "arcwebhq-cpu/arc-previews" || policy.source_commit_sha !== payment.preview_source_commit_sha ||
    policy.approval_content_sha256 !== payment.approval_content_sha256 || policy.claim_recipient_email_sha256 !== recipientSha256 ||
    policy.price_id !== payment.price_id || policy.product_id !== payment.product_id || policy.product_tax_code !== payment.product_tax_code ||
    policy.stripe_account_id_sha256 !== payment.stripe_account_id_sha256 || policy.terms_version !== payment.terms_version ||
    policy.amount_subtotal_minor_units !== 500000 || policy.currency !== "usd" || policy.quantity !== 1 || policy.automatic_tax_enabled !== true ||
    policy.customer_address_source !== "stripe_checkout_customer_details.address" || policy.price_tax_behavior !== "exclusive" || policy.tax_contract_version !== "arc-tax-v1" ||
    policy.adult_acknowledgement_key !== "adultpurchaserack" || policy.name_collection_required !== true || policy.completed_sessions_limit !== 1 ||
    policy.checkout_redirect_url !== "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}" || policy.stripe_api_version !== "2026-07-29.dahlia" ||
    ![policy.content_sha256, policy.published_site_sha256, policy.readiness_core_sha256, policy.offer_snapshot_sha256, policy.recipient_reservation_sha256,
      policy.asset_publication_receipt_sha256, policy.terms_document_sha256].every(value => /^[a-f0-9]{64}$/.test(value)) ||
    !/^[a-f0-9]{40}$/.test(policy.source_commit_sha) || !/^[a-f0-9]{40}$/.test(policy.source_tree_sha) ||
    !/^(?:|[a-f0-9]{64})$/.test(policy.lead_route_recipient_hmac_sha256)) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: private checkout policy v2 binding");
}
const taxFields = ["country", "id", "state", "type"];
if (!Array.isArray(policy.tax_registrations) || policy.tax_registrations.length < 1 || policy.tax_registrations.length > 100 ||
    policy.tax_registrations.some(item => !item || typeof item !== "object" || Array.isArray(item) || JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(taxFields) ||
      !/^taxreg_[A-Za-z0-9]+$/.test(item.id) || !/^[A-Z]{2}$/.test(item.country) || !/^[A-Z0-9-]{1,10}$/.test(item.state) || !/^[a-z][a-z0-9_]{2,63}$/.test(item.type)) ||
    canonicalJson([...policy.tax_registrations].sort((a,b) => a.id.localeCompare(b.id))) !== canonicalJson(policy.tax_registrations) ||
    new Set(policy.tax_registrations.map(item => item.id)).size !== policy.tax_registrations.length ||
    await sha256Hex(canonicalJson(policy.tax_registrations)) !== policy.tax_registrations_sha256 ||
    !policy.tax_registrations.some(item => item.country === "US" && item.state === "WA" && item.type === "state_sales_tax")) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: checkout policy tax registry");
}

const artifact = await verifyEvidence(artifactPrivate, artifactSignature, artifactSecret, "arc2-handoff-artifact-evidence-signature-v4", "artifact evidence");
const artifactFields = ["approval_content_sha256", "artifact_manifest_sha256", "artifacts", "asset_publication_receipt_sha256", "bundle_fingerprint",
  "checkout_binding_key_id", "checkout_config_snapshot_sha256", "checkout_reference_sha256", "issued_at", "lead_route_form_name", "lead_route_mode",
  "lead_route_recipient_hmac_sha256", "preview_folder", "preview_source_commit_sha", "preview_source_repository", "preview_source_tag_sha256",
  "production_content_sha256", "scope", "version"];
const artifactIssuedAt = clean(artifact.issued_at); const artifactIssuedMs = Date.parse(artifactIssuedAt);
if (JSON.stringify(Object.keys(artifact).sort()) !== JSON.stringify(artifactFields) || artifact.version !== "arc2-handoff-artifact-evidence-v4" ||
    artifact.scope !== "netlify-claimable-deploy-artifacts" || !["netlify_form", "not_required"].includes(artifact.lead_route_mode) ||
    (artifact.lead_route_mode === "netlify_form" ? (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(artifact.lead_route_form_name) ||
      !/^[a-f0-9]{64}$/.test(artifact.lead_route_recipient_hmac_sha256)) : (artifact.lead_route_form_name !== "" || artifact.lead_route_recipient_hmac_sha256 !== "")) ||
    !Number.isFinite(artifactIssuedMs) || new Date(artifactIssuedMs).toISOString() !== artifactIssuedAt || artifactIssuedMs > Date.now() + 300_000 ||
    !/^[a-f0-9]{2}$/.test(artifact.checkout_binding_key_id) || !/^[a-f0-9]{40}$/.test(artifact.preview_source_commit_sha) ||
    artifact.preview_source_repository !== "arcwebhq-cpu/arc-previews" ||
    ["approval_content_sha256", "artifact_manifest_sha256", "asset_publication_receipt_sha256", "bundle_fingerprint", "checkout_config_snapshot_sha256",
      "checkout_reference_sha256", "preview_source_tag_sha256", "production_content_sha256"].some(field => !/^[a-f0-9]{64}$/.test(artifact[field]))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: artifact evidence v4 contract");
}
const htmlPaths = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"];
const paths = Array.isArray(artifact.artifacts) ? artifact.artifacts.map(item => clean(item?.path)) : [];
const htmlStart = paths.length - 5;
const assetPaths = paths.slice(1, htmlStart);
const assetPattern = /^assets\/([a-f0-9]{64})\.(?:png|jpg|webp)$/;
let totalBytes = 0; let assetBytes = 0; let htmlBytes = 0;
const itemFields = ["path", "sha256", "size"];
if (paths.length < 6 || paths.length > 9 || paths[0] !== "_headers" || JSON.stringify(paths.slice(htmlStart)) !== JSON.stringify(htmlPaths) ||
    new Set(paths).size !== paths.length || assetPaths.some(path => !assetPattern.test(path)) || JSON.stringify(assetPaths) !== JSON.stringify([...assetPaths].sort()) ||
    artifact.artifacts.some(item => !item || typeof item !== "object" || Array.isArray(item) || JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(itemFields) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 ||
      item.size > (item.path === "_headers" ? 10_000 : htmlPaths.includes(item.path) ? 150_000 : 1_250_000) ||
      (assetPattern.test(item.path) && item.sha256 !== item.path.match(assetPattern)[1]))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: unsafe exact five-page deploy artifact manifest");
}
for (const item of artifact.artifacts) {
  totalBytes += item.size;
  if (assetPattern.test(item.path)) assetBytes += item.size;
  if (htmlPaths.includes(item.path)) htmlBytes += item.size;
}
if (!Number.isSafeInteger(totalBytes) || totalBytes > 3_510_000 || assetBytes > 3_000_000 || htmlBytes > 500_000 ||
    await sha256Hex(canonicalJson(artifact.artifacts)) !== artifact.artifact_manifest_sha256) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: artifact manifest SHA-256 mismatch or unsafe aggregate");
}
const artifactSha256 = await sha256Hex(artifactPrivate);
if (artifactSha256 !== payment.handoff_artifact_evidence_sha256 || artifact.approval_content_sha256 !== payment.approval_content_sha256 ||
    artifact.asset_publication_receipt_sha256 !== payment.asset_publication_receipt_sha256 || artifact.checkout_binding_key_id !== referenceKeyId ||
    artifact.checkout_config_snapshot_sha256 !== payment.checkout_config_snapshot_sha256 || artifact.checkout_reference_sha256 !== payment.client_reference_id_sha256 ||
    artifact.preview_folder !== payment.preview_folder || artifact.preview_source_commit_sha !== payment.preview_source_commit_sha ||
    artifact.preview_source_repository !== payment.preview_source_repository || artifact.preview_source_tag_sha256 !== payment.preview_source_tag_sha256 ||
    artifact.production_content_sha256 !== payment.production_content_sha256 || artifact.artifact_manifest_sha256 !== payment.artifact_manifest_sha256 ||
    artifact.bundle_fingerprint !== payment.bundle_fingerprint || policy.published_site_sha256 !== artifact.production_content_sha256 ||
    policy.asset_publication_receipt_sha256 !== artifact.asset_publication_receipt_sha256 ||
    policy.lead_route_recipient_hmac_sha256 !== artifact.lead_route_recipient_hmac_sha256 ||
    payment.tax_registrations_sha256 !== policy.tax_registrations_sha256) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment, policy, and artifact evidence bindings disagree");
}

const claim = await verifyEvidence(claimPrivate, claimSignature, claimSecret, "arc2-claim-state-evidence-signature-v3", "claim-state evidence");
const claimFields = ["authorization_nonce_sha256", "bundle_fingerprint", "claim_callback_received_at", "claim_invitation_ready_at", "claimed_verified_at",
  "customer_email_sha256", "final_deploy_ready_at", "handoff_artifact_evidence_sha256", "issued_at", "netlify_deploy_id_sha256",
  "netlify_destination_account_id_sha256", "netlify_session_id", "netlify_site_id_sha256", "outbox_claim_key_hmac_sha256", "outbox_claim_status",
  "payment_evidence_sha256", "preview_folder", "production_url", "provider_observed_at", "scope", "status", "version"];
if (JSON.stringify(Object.keys(claim).sort()) !== JSON.stringify(claimFields) || claim.version !== "arc2-claim-state-evidence-v3" ||
    claim.scope !== "netlify-deploy-and-claim-final-deploy" || claim.status !== "FINAL_DEPLOY_READY" || claim.outbox_claim_status !== "CLAIMED" ||
    !/^[A-Za-z0-9_-]{24,128}$/.test(claim.netlify_session_id) ||
    ["payment_evidence_sha256", "handoff_artifact_evidence_sha256", "bundle_fingerprint", "customer_email_sha256", "netlify_site_id_sha256",
      "netlify_deploy_id_sha256", "netlify_destination_account_id_sha256", "outbox_claim_key_hmac_sha256", "authorization_nonce_sha256"]
      .some(field => !/^[a-f0-9]{64}$/.test(clean(claim[field])))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim-state final-deploy evidence contract");
}
if (claim.preview_folder !== payment.preview_folder || claim.payment_evidence_sha256 !== paymentSha256 ||
    claim.handoff_artifact_evidence_sha256 !== artifactSha256 || claim.bundle_fingerprint !== artifact.bundle_fingerprint || claim.customer_email_sha256 !== recipientSha256) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim state is not bound to payment, five-page artifacts, and recipient");
}
let productionUrl;
try { productionUrl = new URL(claim.production_url); } catch { throw new Error("ARC_DELIVERY_EMAIL_INVALID: production URL"); }
if (productionUrl.protocol !== "https:" || productionUrl.username || productionUrl.password || productionUrl.search || productionUrl.hash || productionUrl.pathname !== "/") {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: production URL must be a plain HTTPS root");
}
const timestamps = ["claim_invitation_ready_at", "claim_callback_received_at", "claimed_verified_at", "final_deploy_ready_at", "provider_observed_at", "issued_at"].map(field => {
  const milliseconds = Date.parse(claim[field]);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== claim[field]) throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${field}`);
  return milliseconds;
});
if (timestamps.some((value, index) => index && value < timestamps[index - 1]) || timestamps[5] > Date.now() + 300_000 || timestamps[5] < Date.now() - 300_000 ||
    timestamps[5] !== timestamps[4]) throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim-state timestamps are stale, future, or out of order");
const authorizationBinding = canonicalJson({
  bundle_fingerprint: claim.bundle_fingerprint, netlify_site_id_sha256: claim.netlify_site_id_sha256,
  netlify_deploy_id_sha256: claim.netlify_deploy_id_sha256, netlify_destination_account_id_sha256: claim.netlify_destination_account_id_sha256,
  outbox_claim_key_hmac_sha256: claim.outbox_claim_key_hmac_sha256, provider_observed_at: claim.provider_observed_at
});
const authorization = await globalThis.crypto.subtle.sign("HMAC", await importHmacKey(claimSecret, ["sign"]),
  encoder.encode(`arc2-final-delivery-authorization-v1\n${authorizationBinding}`));
const authorizationHex = [...new Uint8Array(authorization)].map(byte => byte.toString(16).padStart(2, "0")).join("");
if (authorizationHex !== claim.authorization_nonce_sha256) throw new Error("ARC_DELIVERY_EMAIL_INVALID: final delivery authorization binding mismatch");
const outboxKey = canonicalJson({
  version: "arc2-final-delivery-outbox-v1", netlify_session_id: claim.netlify_session_id, payment_evidence_sha256: paymentSha256,
  handoff_artifact_evidence_sha256: artifactSha256, recipient_email_sha256: recipientSha256, production_url: productionUrl.toString()
});
const outboxMac = await globalThis.crypto.subtle.sign("HMAC", await importHmacKey(outboxSecret, ["sign"]), encoder.encode(outboxKey));
const emailClaimKeyHmacSha256 = [...new Uint8Array(outboxMac)].map(byte => byte.toString(16).padStart(2, "0")).join("");
if (emailClaimKeyHmacSha256 !== claim.outbox_claim_key_hmac_sha256) throw new Error("ARC_DELIVERY_EMAIL_INVALID: durable outbox claim binding mismatch");

return {
  status: "HANDOFF_EMAIL_AUTHORIZED", send_delivery_email: true, durable_outbox_claim_verified: true,
  final_deploy_readback_authority_verified: true, exact_five_page_artifact_vector_verified: true,
  provider_send_performed_by_this_step: false, provider_mutation_allowed_by_this_step: false,
  state_write_allowed_by_this_step: false, state_write_required_before_email: false, sent_state_write_required_after_provider_ack: true,
  outbox_claim_key_hmac_sha256: emailClaimKeyHmacSha256, recipient_email: recipientEmail, email_provider_idempotency_key: `arc-final-${emailClaimKeyHmacSha256}`,
  subject: "Your ARC website ownership handoff is ready",
  body_text: `Netlify ownership and the exact five-page handoff deploy were verified.\n\nHandoff site: ${productionUrl.toString()}\n\nThis is not a claim that the site is fully launch-ready. Before advertising it, connect and verify the final domain, add the client-supplied privacy policy, configure the real lead inbox, and submit one real lead-form test if the site uses a lead form. Your 30-day launch-bug support period begins when this ownership handoff is completed.`,
  production_url: productionUrl.toString(), payment_evidence_sha256: paymentSha256, handoff_artifact_evidence_sha256: artifactSha256,
  artifact_manifest_sha256: artifact.artifact_manifest_sha256, production_content_sha256: artifact.production_content_sha256,
  bundle_fingerprint: artifact.bundle_fingerprint, customer_email_sha256: recipientSha256, netlify_session_id: claim.netlify_session_id,
  claim_url_included: false, oauth_credential_included: false
};
