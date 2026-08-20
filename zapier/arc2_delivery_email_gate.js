// ARC2 final-delivery email gate for the Netlify deploy-and-claim flow.
// The claim service only reserves a READY invitation outbox and bearer. It does
// not prove email delivery. This final gate relies on verified claim/deploy state,
// not on a fabricated invitation-sent assertion.
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
const checkoutBindingKeyId = clean(inputData.checkout_binding_key_id).toLowerCase();
const retiredCheckoutBindingKeysRaw = clean(inputData.retired_checkout_binding_keys_json);
const stripeLiveModeFlag = clean(inputData.stripe_live_mode_enabled).toLowerCase();
if (!["false", "true"].includes(stripeLiveModeFlag)) throw new Error("ARC_STRIPE_MODE_INVALID: stripe_live_mode_enabled must be explicit true or false");
const stripeLiveModeEnabled = stripeLiveModeFlag === "true";
const stripeMode = stripeLiveModeEnabled ? "live" : "test";

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
if ([inputData.claim_url, inputData.ownership_handoff_url, inputData.netlify_oauth_token, inputData.netlify_access_token]
  .some(value => clean(value))) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim URLs and Netlify credentials are forbidden at the final-email gate");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
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
let retiredCheckoutBindingKeys;
try { retiredCheckoutBindingKeys = JSON.parse(retiredCheckoutBindingKeysRaw); } catch {}
if (!/^[a-f0-9]{2}$/.test(checkoutBindingKeyId) || !retiredCheckoutBindingKeys || typeof retiredCheckoutBindingKeys !== "object" || Array.isArray(retiredCheckoutBindingKeys) ||
    canonicalJson(retiredCheckoutBindingKeys) !== retiredCheckoutBindingKeysRaw || Object.entries(retiredCheckoutBindingKeys).some(([id,secret]) =>
      !/^[a-f0-9]{2}$/.test(id) || id === checkoutBindingKeyId || typeof secret !== "string" || secret.length < 32 || secret.length > 256) ||
    new Set(Object.values(retiredCheckoutBindingKeys)).size !== Object.values(retiredCheckoutBindingKeys).length || Object.values(retiredCheckoutBindingKeys).includes(checkoutBindingSecret)) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: checkout binding key registry");
}
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

let unsignedPaymentEvidence;
try { unsignedPaymentEvidence = JSON.parse(paymentEvidencePrivate); } catch { throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment evidence JSON"); }
if (!unsignedPaymentEvidence || typeof unsignedPaymentEvidence !== "object" || Array.isArray(unsignedPaymentEvidence) || canonicalJson(unsignedPaymentEvidence) !== paymentEvidencePrivate) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment evidence must be canonical JSON");
}
const resolvedReference=clean(unsignedPaymentEvidence.client_reference_id);
let referenceBytes;
try { referenceBytes=Buffer.from(resolvedReference.slice(3),"base64url"); } catch {}
if(!/^v3_[A-Za-z0-9_-]{135}$/.test(resolvedReference)||!referenceBytes||referenceBytes.length!==101||referenceBytes.toString("base64url")!==resolvedReference.slice(3))
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: canonical checkout reference v3");
const referencePayload=referenceBytes.subarray(0,69),referenceKid=referencePayload.subarray(0,1).toString("hex"),selectedCheckoutBindingSecret=referenceKid===checkoutBindingKeyId?checkoutBindingSecret:retiredCheckoutBindingKeys[referenceKid];
if(!selectedCheckoutBindingSecret)throw new Error("ARC_DELIVERY_EMAIL_INVALID: checkout reference key is not retained");
const paymentEvidence = await verifyEvidence({
  text: paymentEvidencePrivate,
  signature: paymentEvidenceHmacSha256,
  secret: selectedCheckoutBindingSecret,
  prefix: `arc2-payment-evidence-signature-v3\n${stripeMode}`,
  label: "payment evidence"
});
const referenceKey=await importHmacKey(selectedCheckoutBindingSecret,["verify"]),referenceDomain=encoder.encode(`arc-checkout-reference-v3\narcwebhq-cpu/arc-previews\narc-production\nstripe-${stripeMode}\n`),referenceMessage=new Uint8Array(referenceDomain.length+69);
referenceMessage.set(referenceDomain);referenceMessage.set(referencePayload,referenceDomain.length);
if(!await globalThis.crypto.subtle.verify("HMAC",referenceKey,referenceBytes.subarray(69),referenceMessage))throw new Error("ARC_DELIVERY_EMAIL_INVALID: checkout reference HMAC");
const paymentFields = [
  "version", "scope", "checkout_session_id", "stripe_account_id_sha256", "client_reference_id", "client_reference_id_sha256", "client_reference_id_observation",
  "client_reference_mismatch_review_required","client_reference_mismatch_review_record_key_hmac_sha256","client_reference_mismatch_review_state",
  "client_reference_mismatch_review_sha256","client_reference_mismatch_review_hmac_sha256","approval_content_sha256","asset_publication_receipt_sha256",
  "checkout_config_snapshot","checkout_config_snapshot_sha256","preview_folder","preview_source_commit_sha","preview_source_repository","preview_source_tag_sha256",
  "production_content_sha256", "artifact_manifest_sha256", "handoff_artifact_evidence_sha256",
  "bundle_fingerprint", "claim_recipient_email_sha256", "payer_email_sha256", "livemode", "mode", "status", "payment_status",
  "currency", "amount_total_minor_units", "subtotal_amount_minor_units", "tax_amount_minor_units",
  "payment_link_id", "payment_intent_id", "charge_id", "price_id", "product_id", "product_tax_code", "price_tax_behavior", "automatic_tax_enabled",
  "automatic_tax_status", "customer_address_status", "tax_registration_status", "tax_contract_version",
  "tax_registrations_sha256", "customer_address_sha256",
  "customer_address_country", "customer_address_state",
  "quantity", "terms_of_service_consent", "terms_version",
  "adult_purchaser_acknowledgement"
];
if (JSON.stringify(Object.keys(paymentEvidence).sort()) !== JSON.stringify(paymentFields.slice().sort()) ||
    clean(paymentEvidence.version) !== "arc2-payment-evidence-v3" ||
    clean(paymentEvidence.scope) !== "authoritative-stripe-checkout-session" ||
    !new RegExp(`^cs_${stripeMode}_[A-Za-z0-9_]+$`).test(clean(paymentEvidence.checkout_session_id)) ||
    clean(paymentEvidence.client_reference_id)!==resolvedReference||clean(paymentEvidence.client_reference_id_sha256)!==await sha256Hex(resolvedReference)||
    clean(paymentEvidence.checkout_config_snapshot_sha256)!==referencePayload.subarray(37,69).toString("hex")||clean(paymentEvidence.approval_content_sha256)!==referencePayload.subarray(5,37).toString("hex")||
    !/^[a-f0-9]{64}$/.test(clean(paymentEvidence.stripe_account_id_sha256).toLowerCase()) ||
    paymentEvidence.livemode !== stripeLiveModeEnabled || clean(paymentEvidence.mode) !== "payment" ||
    clean(paymentEvidence.status) !== "complete" || clean(paymentEvidence.payment_status) !== "paid" ||
    clean(paymentEvidence.currency) !== "usd" || paymentEvidence.subtotal_amount_minor_units !== 500000 ||
    !Number.isSafeInteger(paymentEvidence.tax_amount_minor_units) || paymentEvidence.tax_amount_minor_units < 0 ||
    !Number.isSafeInteger(paymentEvidence.amount_total_minor_units) ||
    paymentEvidence.amount_total_minor_units !== paymentEvidence.subtotal_amount_minor_units + paymentEvidence.tax_amount_minor_units ||
    paymentEvidence.quantity !== 1 ||
    !/^plink_[A-Za-z0-9]+$/.test(clean(paymentEvidence.payment_link_id)) || !/^pi_[A-Za-z0-9]+$/.test(clean(paymentEvidence.payment_intent_id)) ||
    !/^ch_[A-Za-z0-9]+$/.test(clean(paymentEvidence.charge_id)) || !/^price_[A-Za-z0-9]+$/.test(clean(paymentEvidence.price_id)) ||
    !/^prod_[A-Za-z0-9]+$/.test(clean(paymentEvidence.product_id)) || !/^txcd_[0-9]{8}$/.test(clean(paymentEvidence.product_tax_code)) ||
    clean(paymentEvidence.price_tax_behavior) !== "exclusive" || paymentEvidence.automatic_tax_enabled !== true ||
    clean(paymentEvidence.automatic_tax_status) !== "complete" ||
    clean(paymentEvidence.customer_address_status) !== "verified" ||
    clean(paymentEvidence.tax_registration_status) !== "historical_precheckout_snapshot" || clean(paymentEvidence.tax_contract_version) !== "arc-tax-v1" ||
    !/^[a-f0-9]{64}$/.test(clean(paymentEvidence.tax_registrations_sha256).toLowerCase()) ||
    !/^[a-f0-9]{64}$/.test(clean(paymentEvidence.customer_address_sha256).toLowerCase()) ||
    !/^[A-Z]{2}$/.test(clean(paymentEvidence.customer_address_country)) ||
    !/^[A-Z0-9-]{0,10}$/.test(clean(paymentEvidence.customer_address_state)) ||
    (clean(paymentEvidence.customer_address_country) === "US" && !/^[A-Z]{2}$/.test(clean(paymentEvidence.customer_address_state))) ||
    (clean(paymentEvidence.customer_address_country) === "US" && clean(paymentEvidence.customer_address_state) === "WA" &&
      paymentEvidence.tax_amount_minor_units <= 0) ||
    clean(paymentEvidence.terms_of_service_consent) !== "accepted" ||
    !/^20\d\d-\d\d-\d\d$/.test(clean(paymentEvidence.terms_version)) ||
    clean(paymentEvidence.adult_purchaser_acknowledgement) !== "accepted") {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment evidence contract");
}
const paymentEvidenceSha256 = await sha256Hex(paymentEvidencePrivate);
const recipientEmailSha256 = await sha256Hex(recipientEmail);
if (recipientEmailSha256 !== clean(paymentEvidence.claim_recipient_email_sha256).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: recipient is not the reserved claim recipient");
}
let checkoutPolicy;try{checkoutPolicy=JSON.parse(clean(paymentEvidence.checkout_config_snapshot));}catch{throw new Error("ARC_DELIVERY_EMAIL_INVALID: private checkout policy JSON");}
if(!checkoutPolicy||typeof checkoutPolicy!=="object"||Array.isArray(checkoutPolicy)||canonicalJson(checkoutPolicy)!==clean(paymentEvidence.checkout_config_snapshot)||
  checkoutPolicy.version!=="arc-private-checkout-policy-v1"||checkoutPolicy.scope!=="one-approved-preview-one-private-payment-link"||checkoutPolicy.checkout_binding_key_id!==referenceKid||
  checkoutPolicy.stripe_mode!==stripeMode||checkoutPolicy.claim_recipient_email_sha256!==recipientEmailSha256||checkoutPolicy.price_id!==paymentEvidence.price_id||
  checkoutPolicy.product_id!==paymentEvidence.product_id||checkoutPolicy.product_tax_code!==paymentEvidence.product_tax_code||checkoutPolicy.terms_version!==paymentEvidence.terms_version||
  checkoutPolicy.stripe_account_id_sha256!==paymentEvidence.stripe_account_id_sha256||await sha256Hex(clean(paymentEvidence.checkout_config_snapshot))!==paymentEvidence.checkout_config_snapshot_sha256)
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: private checkout policy binding");

const artifactEvidence = await verifyEvidence({
  text: artifactEvidencePrivate,
  signature: artifactEvidenceHmacSha256,
  secret: artifactEvidenceSecret,
  prefix: "arc2-handoff-artifact-evidence-signature-v3",
  label: "artifact evidence"
});
const artifactFields = [
  "version", "scope","approval_content_sha256","asset_publication_receipt_sha256","checkout_binding_key_id","checkout_config_snapshot_sha256",
  "checkout_reference_sha256", "preview_folder","preview_source_commit_sha","preview_source_repository","preview_source_tag_sha256", "production_content_sha256", "artifact_manifest_sha256",
  "bundle_fingerprint", "artifacts", "issued_at", "lead_route_mode", "lead_route_form_name",
  "lead_route_recipient_hmac_sha256"
];
if (JSON.stringify(Object.keys(artifactEvidence).sort()) !== JSON.stringify(artifactFields.slice().sort()) ||
    clean(artifactEvidence.version) !== "arc2-handoff-artifact-evidence-v3" ||
    clean(artifactEvidence.scope) !== "netlify-claimable-deploy-artifacts" ||
    !["netlify_form", "not_required"].includes(clean(artifactEvidence.lead_route_mode)) ||
    (clean(artifactEvidence.lead_route_mode) === "netlify_form"
      ? (!/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(clean(artifactEvidence.lead_route_form_name)) ||
        !/^[a-f0-9]{64}$/.test(clean(artifactEvidence.lead_route_recipient_hmac_sha256).toLowerCase()))
      : (clean(artifactEvidence.lead_route_form_name) !== "" || clean(artifactEvidence.lead_route_recipient_hmac_sha256) !== "")) ||
    !Array.isArray(artifactEvidence.artifacts) || artifactEvidence.artifacts.length < 2 || artifactEvidence.artifacts.length > 5 ||
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
const assetPathPattern = /^assets\/([a-f0-9]{64})\.(?:png|jpg|webp)$/;
const assetPaths = artifactPaths.slice(1, -1);
if (artifactPaths[0] !== "_headers" || artifactPaths.at(-1) !== "index.html" ||
    assetPaths.some(path => !assetPathPattern.test(path)) ||
    JSON.stringify(assetPaths) !== JSON.stringify(assetPaths.slice().sort()) ||
    new Set(artifactPaths).size !== artifactPaths.length ||
    artifactEvidence.artifacts.some(item => !item || typeof item !== "object" || Array.isArray(item) ||
      JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(artifactItemFields.slice().sort())) ||
    !Number.isSafeInteger(artifactTotalBytes) || artifactTotalBytes < 1 || artifactTotalBytes > 3510000 ||
    artifactEvidence.artifacts.some(item => !/^[a-f0-9]{64}$/.test(clean(item.sha256).toLowerCase()) ||
      !Number.isSafeInteger(item.size) || item.size < 1 ||
      item.size > (item.path === "_headers" ? 10000 : item.path === "index.html" ? 500000 : 1250000)) ||
    artifactEvidence.artifacts.some(item => {
      const match = clean(item.path).match(assetPathPattern);
      return match && clean(item.sha256).toLowerCase() !== match[1];
    })) {
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
    clean(artifactEvidence.approval_content_sha256)!==clean(paymentEvidence.approval_content_sha256)||
    clean(artifactEvidence.asset_publication_receipt_sha256)!==clean(paymentEvidence.asset_publication_receipt_sha256)||
    clean(artifactEvidence.checkout_binding_key_id)!==referenceKid||clean(artifactEvidence.checkout_config_snapshot_sha256)!==clean(paymentEvidence.checkout_config_snapshot_sha256)||
    clean(artifactEvidence.checkout_reference_sha256)!==clean(paymentEvidence.client_reference_id_sha256)||
    clean(artifactEvidence.preview_folder) !== clean(paymentEvidence.preview_folder) ||
    clean(artifactEvidence.preview_source_commit_sha)!==clean(paymentEvidence.preview_source_commit_sha)||clean(artifactEvidence.preview_source_repository)!=="arcwebhq-cpu/arc-previews"||
    clean(artifactEvidence.preview_source_tag_sha256)!==clean(paymentEvidence.preview_source_tag_sha256)||
    clean(artifactEvidence.production_content_sha256).toLowerCase() !== clean(paymentEvidence.production_content_sha256).toLowerCase() ||
    clean(artifactEvidence.artifact_manifest_sha256).toLowerCase() !== clean(paymentEvidence.artifact_manifest_sha256).toLowerCase() ||
    clean(artifactEvidence.bundle_fingerprint).toLowerCase() !== clean(paymentEvidence.bundle_fingerprint).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: payment and artifact evidence bindings disagree");
}

const claimStateEvidence = await verifyEvidence({
  text: claimStateEvidencePrivate,
  signature: claimStateEvidenceHmacSha256,
  secret: claimStateEvidenceSecret,
  prefix: "arc2-claim-state-evidence-signature-v3",
  label: "claim-state evidence"
});
const claimFields = [
  "version", "scope", "status", "netlify_session_id", "preview_folder", "payment_evidence_sha256",
  "handoff_artifact_evidence_sha256", "bundle_fingerprint", "customer_email_sha256",
  "netlify_site_id_sha256", "netlify_deploy_id_sha256", "netlify_destination_account_id_sha256",
  "production_url", "claim_invitation_ready_at", "claim_callback_received_at", "claimed_verified_at",
  "final_deploy_ready_at", "outbox_claim_status", "outbox_claim_key_hmac_sha256", "provider_observed_at",
  "authorization_nonce_sha256", "issued_at"
];
if (JSON.stringify(Object.keys(claimStateEvidence).sort()) !== JSON.stringify(claimFields.slice().sort()) ||
    clean(claimStateEvidence.version) !== "arc2-claim-state-evidence-v3" ||
    clean(claimStateEvidence.scope) !== "netlify-deploy-and-claim-final-deploy" ||
    clean(claimStateEvidence.status) !== "FINAL_DEPLOY_READY" ||
    clean(claimStateEvidence.outbox_claim_status) !== "CLAIMED" ||
    !/^[A-Za-z0-9_-]{24,128}$/.test(clean(claimStateEvidence.netlify_session_id)) ||
    ["payment_evidence_sha256", "handoff_artifact_evidence_sha256", "bundle_fingerprint", "customer_email_sha256",
      "netlify_site_id_sha256", "netlify_deploy_id_sha256", "netlify_destination_account_id_sha256",
      "outbox_claim_key_hmac_sha256", "authorization_nonce_sha256"].some(field => !/^[a-f0-9]{64}$/.test(clean(claimStateEvidence[field]).toLowerCase()))) {
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
  "claim_invitation_ready_at", "claim_callback_received_at", "claimed_verified_at", "final_deploy_ready_at",
  "provider_observed_at", "issued_at"
].map(field => {
  const value = clean(claimStateEvidence[field]);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`ARC_DELIVERY_EMAIL_INVALID: ${field}`);
  }
  return milliseconds;
});
if (timestamps.some((value, index) => index && value < timestamps[index - 1]) ||
    timestamps[5] > Date.now() + 5 * 60 * 1000 || timestamps[5] < Date.now() - 5 * 60 * 1000 ||
    timestamps[5] !== timestamps[4]) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: claim-state timestamps are stale, future, or out of order");
}
const authorizationBinding = canonicalJson({
  bundle_fingerprint: clean(claimStateEvidence.bundle_fingerprint).toLowerCase(),
  netlify_site_id_sha256: clean(claimStateEvidence.netlify_site_id_sha256).toLowerCase(),
  netlify_deploy_id_sha256: clean(claimStateEvidence.netlify_deploy_id_sha256).toLowerCase(),
  netlify_destination_account_id_sha256: clean(claimStateEvidence.netlify_destination_account_id_sha256).toLowerCase(),
  outbox_claim_key_hmac_sha256: clean(claimStateEvidence.outbox_claim_key_hmac_sha256).toLowerCase(),
  provider_observed_at: clean(claimStateEvidence.provider_observed_at)
});
const authorizationBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  await importHmacKey(claimStateEvidenceSecret, ["sign"]),
  encoder.encode(`arc2-final-delivery-authorization-v1\n${authorizationBinding}`)
);
const authorizationDigest = [...new Uint8Array(authorizationBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");
if (authorizationDigest !== clean(claimStateEvidence.authorization_nonce_sha256).toLowerCase()) {
  throw new Error("ARC_DELIVERY_EMAIL_INVALID: final delivery authorization binding mismatch");
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
  state_write_required_before_email: false,
  sent_state_write_required_after_provider_ack: true,
  outbox_claim_key_hmac_sha256: emailClaimKeyHmacSha256,
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
