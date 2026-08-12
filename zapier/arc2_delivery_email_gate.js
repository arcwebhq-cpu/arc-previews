// ARC2 final-delivery email gate for the Netlify deploy-and-claim flow.
// The one-time ownership claim invitation is sent earlier by the claim service.
// This gate authorizes only the final delivery email, after signed evidence proves
// Netlify deploy-and-claim completion, destination-account control, a verified final
// deploy, and an already-claimed durable outbox record.
const clean = value => String(value == null ? "" : value).trim();
const paymentEvidencePrivate = clean(inputData.payment_evidence_private);
const paymentEvidenceHmacSha256 = clean(inputData.payment_evidence_hmac_sha256).toLowerCase();
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const artifactEvidencePrivate = clean(inputData.handoff_artifact_evidence_private);
const artifactEvidenceHmacSha256 = clean(inputData.handoff_artifact_evidence_hmac_sha256).toLowerCase();
const artifactEvidenceSecret = clean(inputData.handoff_artifact_evidence_secret);
const claimStateEvidencePrivate = clean(inputData.claim_state_evidence_private);
const claimStateEvidenceHmacSha256 = clean(inputData.claim_state_evidence_hmac_sha256).toLowerCase();
const claimStateEvidenceSecret = clean(inputData.claim_state_evidence_secret);
const emailClaimBindingSecret = clean(inputData.email_claim_binding_secret);
const recipientEmail = clean(inputData.recipient_email).toLowerCase();
const expectedPaymentLinkId = clean(inputData.expected_payment_link_id);
const expectedPriceId = clean(inputData.expected_price_id);
const expectedTermsVersion = clean(inputData.expected_terms_version);

for (const [label, secret] of [
  ["checkout binding", checkoutBindingSecret],
  ["handoff artifact evidence", artifactEvidenceSecret],
  ["claim-state evidence", claimStateEvidenceSecret],
  ["email claim binding", emailClaimBindingSecret]
]) {
  if (secret.length < 32 || secret.length > 256) {
    throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} secret must be 32–256 characters`);
  }
}
if (new Set([checkoutBindingSecret, artifactEvidenceSecret, claimStateEvidenceSecret, emailClaimBindingSecret]).size !== 4) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment, artifact, claim-state, and email secrets must be separate");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: recipient email");
}
if (!/^plink_[A-Za-z0-9]+$/.test(expectedPaymentLinkId) || !/^price_[A-Za-z0-9]+$/.test(expectedPriceId) ||
    expectedTermsVersion !== "2026-08-11") {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: exact Payment Link, Price, and static terms version are required");
}
if ([inputData.claim_url, inputData.ownership_handoff_url, inputData.netlify_oauth_token, inputData.netlify_access_token]
  .some(value => clean(value))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim URLs and Netlify credentials are forbidden at the final-email gate");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256 and SHA-256 are required");
}
const encoder = new TextEncoder();
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const importHmacKey = (secret, usages) => globalThis.crypto.subtle.importKey(
  "raw",
  encoder.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  usages
);
const signatureBytes = signature => {
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error("ARC_DELIVERY_EMAIL_INVALID: evidence HMAC");
  return Uint8Array.from(signature.match(/../g), byte => Number.parseInt(byte, 16));
};
const verifyEvidence = async ({ text, signature, secret, prefix, label }) => {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== text) {
    throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} must be canonical JSON`);
  }
  const key = await importHmacKey(secret, ["verify"]);
  if (!(await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes(signature),
    encoder.encode(`${prefix}\n${text}`)
  ))) {
    throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${label} HMAC mismatch`);
  }
  return value;
};

const paymentEvidence = await verifyEvidence({
  text: paymentEvidencePrivate,
  signature: paymentEvidenceHmacSha256,
  secret: checkoutBindingSecret,
  prefix: "arc2-payment-evidence-signature-v1",
  label: "payment evidence"
});
const paymentFields = [
  "version", "scope", "checkout_session_id", "client_reference_id_sha256", "preview_folder",
  "production_content_sha256", "artifact_manifest_sha256", "handoff_artifact_evidence_sha256",
  "bundle_fingerprint", "customer_email_sha256", "livemode", "mode", "status", "payment_status",
  "currency", "amount_total_minor_units", "amount_subtotal_minor_units", "payment_link_id", "price_id",
  "quantity", "terms_of_service_consent", "terms_version",
  "adult_purchaser_acknowledgement"
];
if (JSON.stringify(Object.keys(paymentEvidence).sort()) !== JSON.stringify(paymentFields.slice().sort()) ||
    clean(paymentEvidence.version) !== "arc2-payment-evidence-v1" ||
    clean(paymentEvidence.scope) !== "authoritative-stripe-test-checkout-session" ||
    !/^cs_test_[A-Za-z0-9_]+$/.test(clean(paymentEvidence.checkout_session_id)) ||
    paymentEvidence.livemode !== false || clean(paymentEvidence.mode) !== "payment" ||
    clean(paymentEvidence.status) !== "complete" || clean(paymentEvidence.payment_status) !== "paid" ||
    clean(paymentEvidence.currency) !== "usd" || paymentEvidence.amount_total_minor_units !== 500000 ||
    paymentEvidence.amount_subtotal_minor_units !== 500000 || paymentEvidence.quantity !== 1 ||
    clean(paymentEvidence.payment_link_id) !== expectedPaymentLinkId ||
    clean(paymentEvidence.price_id) !== expectedPriceId ||
    clean(paymentEvidence.terms_of_service_consent) !== "accepted" ||
    clean(paymentEvidence.terms_version) !== expectedTermsVersion ||
    clean(paymentEvidence.adult_purchaser_acknowledgement) !== "accepted") {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment evidence contract");
}
const paymentEvidenceSha256 = await sha256Hex(paymentEvidencePrivate);
const recipientEmailSha256 = await sha256Hex(recipientEmail);
if (recipientEmailSha256 !== clean(paymentEvidence.customer_email_sha256).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: recipient is not the Stripe customer");
}

const artifactEvidence = await verifyEvidence({
  text: artifactEvidencePrivate,
  signature: artifactEvidenceHmacSha256,
  secret: artifactEvidenceSecret,
  prefix: "arc2-handoff-artifact-evidence-signature-v1",
  label: "artifact evidence"
});
const artifactFields = [
  "version", "scope", "preview_folder", "production_content_sha256", "artifact_manifest_sha256",
  "bundle_fingerprint", "artifacts", "issued_at"
];
if (JSON.stringify(Object.keys(artifactEvidence).sort()) !== JSON.stringify(artifactFields.slice().sort()) ||
    clean(artifactEvidence.version) !== "arc2-handoff-artifact-evidence-v1" ||
    clean(artifactEvidence.scope) !== "netlify-claimable-deploy-artifacts" ||
    !Array.isArray(artifactEvidence.artifacts) || artifactEvidence.artifacts.length !== 2 ||
    canonicalJson(artifactEvidence.artifacts) !== canonicalJson([
      ...artifactEvidence.artifacts
    ].sort((first, second) => clean(first?.path).localeCompare(clean(second?.path))))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: artifact evidence contract");
}
const artifactEvidenceIssuedAt = clean(artifactEvidence.issued_at);
const artifactEvidenceIssuedMs = Date.parse(artifactEvidenceIssuedAt);
if (!Number.isFinite(artifactEvidenceIssuedMs) || new Date(artifactEvidenceIssuedMs).toISOString() !== artifactEvidenceIssuedAt ||
    artifactEvidenceIssuedMs > Date.now() + 5 * 60 * 1000) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: artifact evidence issued_at");
}
const artifactPaths = artifactEvidence.artifacts.map(item => clean(item?.path));
const artifactItemFields = ["path", "sha256", "size"];
const artifactTotalBytes = artifactEvidence.artifacts.reduce((total, item) => total + Number(item?.size || 0), 0);
if (JSON.stringify(artifactPaths) !== JSON.stringify(["_headers", "index.html"]) ||
    new Set(artifactPaths).size !== artifactPaths.length ||
    artifactEvidence.artifacts.some(item => !item || typeof item !== "object" || Array.isArray(item) ||
      JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(artifactItemFields.slice().sort())) ||
    !Number.isSafeInteger(artifactTotalBytes) || artifactTotalBytes < 1 || artifactTotalBytes > 25 * 1024 * 1024 ||
    artifactEvidence.artifacts.some(item => !/^[a-f0-9]{64}$/.test(clean(item.sha256).toLowerCase()) ||
      !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 10 * 1024 * 1024)) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: unsafe deploy artifact manifest");
}
const artifactManifestPrivate = canonicalJson(artifactEvidence.artifacts);
if (await sha256Hex(artifactManifestPrivate) !== clean(artifactEvidence.artifact_manifest_sha256).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: artifact manifest SHA-256 mismatch");
}
const productionArtifact = artifactEvidence.artifacts.find(item => clean(item.path) === "index.html");
if (clean(productionArtifact?.sha256).toLowerCase() !== clean(artifactEvidence.production_content_sha256).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: production content SHA-256 mismatch");
}
const artifactEvidenceSha256 = await sha256Hex(artifactEvidencePrivate);
if (artifactEvidenceSha256 !== clean(paymentEvidence.handoff_artifact_evidence_sha256).toLowerCase() ||
    clean(artifactEvidence.preview_folder) !== clean(paymentEvidence.preview_folder) ||
    clean(artifactEvidence.production_content_sha256).toLowerCase() !== clean(paymentEvidence.production_content_sha256).toLowerCase() ||
    clean(artifactEvidence.artifact_manifest_sha256).toLowerCase() !== clean(paymentEvidence.artifact_manifest_sha256).toLowerCase() ||
    clean(artifactEvidence.bundle_fingerprint).toLowerCase() !== clean(paymentEvidence.bundle_fingerprint).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment and artifact evidence bindings disagree");
}

const claimStateEvidence = await verifyEvidence({
  text: claimStateEvidencePrivate,
  signature: claimStateEvidenceHmacSha256,
  secret: claimStateEvidenceSecret,
  prefix: "arc2-claim-state-evidence-signature-v1",
  label: "claim-state evidence"
});
const claimFields = [
  "version", "scope", "status", "netlify_session_id", "preview_folder", "payment_evidence_sha256",
  "handoff_artifact_evidence_sha256", "bundle_fingerprint", "customer_email_sha256",
  "netlify_site_id_sha256", "netlify_deploy_id_sha256", "netlify_destination_account_id_sha256",
  "production_url", "claim_invitation_sent_at", "claim_callback_received_at", "claimed_verified_at",
  "final_deploy_ready_at", "outbox_claim_status", "outbox_claim_key_hmac_sha256", "issued_at"
];
if (JSON.stringify(Object.keys(claimStateEvidence).sort()) !== JSON.stringify(claimFields.slice().sort()) ||
    clean(claimStateEvidence.version) !== "arc2-claim-state-evidence-v1" ||
    clean(claimStateEvidence.scope) !== "netlify-deploy-and-claim-final-deploy" ||
    clean(claimStateEvidence.status) !== "FINAL_DEPLOY_READY" ||
    clean(claimStateEvidence.outbox_claim_status) !== "CLAIMED" ||
    !/^[A-Za-z0-9_-]{24,128}$/.test(clean(claimStateEvidence.netlify_session_id)) ||
    ["payment_evidence_sha256", "handoff_artifact_evidence_sha256", "bundle_fingerprint", "customer_email_sha256",
      "netlify_site_id_sha256", "netlify_deploy_id_sha256", "netlify_destination_account_id_sha256",
      "outbox_claim_key_hmac_sha256"].some(field => !/^[a-f0-9]{64}$/.test(clean(claimStateEvidence[field]).toLowerCase()))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim-state evidence contract");
}
if (clean(claimStateEvidence.preview_folder) !== clean(paymentEvidence.preview_folder) ||
    clean(claimStateEvidence.payment_evidence_sha256).toLowerCase() !== paymentEvidenceSha256 ||
    clean(claimStateEvidence.handoff_artifact_evidence_sha256).toLowerCase() !== artifactEvidenceSha256 ||
    clean(claimStateEvidence.bundle_fingerprint).toLowerCase() !== clean(paymentEvidence.bundle_fingerprint).toLowerCase() ||
    clean(claimStateEvidence.customer_email_sha256).toLowerCase() !== recipientEmailSha256) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim state is not bound to payment, artifacts, and recipient");
}
let productionUrl;
try {
  productionUrl = new URL(clean(claimStateEvidence.production_url));
} catch (error) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: production URL");
}
if (productionUrl.protocol !== "https:" || productionUrl.username || productionUrl.password ||
    productionUrl.search || productionUrl.hash || productionUrl.pathname !== "/") {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: production URL must be a plain HTTPS root");
}
const timestamps = [
  "claim_invitation_sent_at", "claim_callback_received_at", "claimed_verified_at", "final_deploy_ready_at", "issued_at"
].map(field => {
  const value = clean(claimStateEvidence[field]);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${field}`);
  }
  return milliseconds;
});
if (timestamps.some((value, index) => index && value < timestamps[index - 1]) ||
    timestamps[4] > Date.now() + 5 * 60 * 1000 || timestamps[4] < Date.now() - 30 * 60 * 1000) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim-state timestamps are stale, future, or out of order");
}
const emailClaimKey = canonicalJson({
  version: "arc2-final-delivery-outbox-v1",
  netlify_session_id: clean(claimStateEvidence.netlify_session_id),
  payment_evidence_sha256: paymentEvidenceSha256,
  handoff_artifact_evidence_sha256: artifactEvidenceSha256,
  recipient_email_sha256: recipientEmailSha256,
  production_url: productionUrl.toString()
});
const emailClaimKeyBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  await importHmacKey(emailClaimBindingSecret, ["sign"]),
  encoder.encode(emailClaimKey)
);
const emailClaimKeyHmacSha256 = [...new Uint8Array(emailClaimKeyBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");
if (emailClaimKeyHmacSha256 !== clean(claimStateEvidence.outbox_claim_key_hmac_sha256).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: durable outbox claim binding mismatch");
}

return {
  status: "HANDOFF_EMAIL_AUTHORIZED",
  send_delivery_email: true,
  durable_outbox_claim_verified: true,
  state_write_required_before_email: true,
  recipient_email: recipientEmail,
  email_provider_idempotency_key: `arc-final-${emailClaimKeyHmacSha256}`,
  subject: "Your ARC website ownership handoff is ready",
  body_text: `Netlify ownership and the handoff deploy were verified.\n\nHandoff site: ${productionUrl.toString()}\n\nThis is not a claim that the site is fully launch-ready. Before advertising it, connect and verify the final domain, add the client-supplied privacy policy, configure the real lead inbox, and submit one real lead-form test. Your 30-day launch-bug support period begins when this ownership handoff is completed.`,
  production_url: productionUrl.toString(),
  payment_evidence_sha256: paymentEvidenceSha256,
  handoff_artifact_evidence_sha256: artifactEvidenceSha256,
  bundle_fingerprint: clean(paymentEvidence.bundle_fingerprint).toLowerCase(),
  customer_email_sha256: recipientEmailSha256,
  netlify_session_id: clean(claimStateEvidence.netlify_session_id),
  claim_url_included: false,
  oauth_credential_included: false
};
