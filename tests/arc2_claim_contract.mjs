import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc2_delivery_email_gate.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runGate = new AsyncFunction("inputData", source);
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const sign = (prefix, value, secret) => createHmac("sha256", secret)
  .update(`${prefix}\n${value}`, "utf8")
  .digest("hex");

const checkoutBindingSecret = "arc2-test-checkout-binding-secret-32-bytes";
const artifactEvidenceSecret = "arc2-test-artifact-evidence-secret-32-bytes";
const claimStateEvidenceSecret = "arc2-test-claim-state-evidence-secret-32-bytes";
const emailClaimBindingSecret = "arc2-test-email-claim-binding-secret-32-bytes";
const recipientEmail = "reserved-claim-recipient@example.test";
const payerEmail = "adult-stripe-payer@example.test";
const checkoutBindingKeyId="01";
const expectedPaymentLinkId = "plink_1ArcV10Test5000";
const expectedPriceId = "price_1ArcV10Test5000";
const expectedProductTaxCode = "txcd_12345678";
const expectedStripeAccountIdSha256 = "7".repeat(64);
const expectedTermsVersion = "2026-08-12";
const previewFolder = "summit-roofing-a1b2c3d4";
const productionUrl = "https://summit-roofing.netlify.app/";
const productionHtml = "<!doctype html><title>Summit Roofing</title>\n";
const headersFile = "/*\n  X-Content-Type-Options: nosniff\n";
const artifacts = [
  { path: "_headers", sha256: sha256(headersFile), size: Buffer.byteLength(headersFile) },
  { path: "index.html", sha256: sha256(productionHtml), size: Buffer.byteLength(productionHtml) }
];
const artifactManifestSha256 = sha256(canonicalJson(artifacts));
const bundleFingerprint = sha256(`_headers\0${headersFile}\0index.html\0${productionHtml}\0`);
const issuedAt = new Date(Date.now() - 10_000).toISOString();
const approvalContentSha256=sha256("approved-preview"),assetReceiptSha256=sha256("no-public-assets"),sourceCommitSha="a".repeat(40),sourceTreeSha="b".repeat(40);
const taxRegistrations=[{country:"US",id:"taxreg_ArcWashington",state:"WA",type:"state_sales_tax"}];
const checkoutPolicy=canonicalJson({version:"arc-private-checkout-policy-v1",scope:"one-approved-preview-one-private-payment-link",checkout_binding_key_id:checkoutBindingKeyId,
  stripe_mode:"test",stripe_account_id_sha256:expectedStripeAccountIdSha256,price_id:expectedPriceId,product_id:"prod_ArcV10Test5000",amount_subtotal_minor_units:500000,
  currency:"usd",quantity:1,terms_version:expectedTermsVersion,terms_document_sha256:sha256("terms-v1"),automatic_tax_enabled:true,
  customer_address_source:"stripe_checkout_customer_details.address",price_tax_behavior:"exclusive",product_tax_code:expectedProductTaxCode,tax_contract_version:"arc-tax-v1",
  payment_method_selection:"dynamic",tax_registrations:taxRegistrations,tax_registrations_sha256:sha256(canonicalJson(taxRegistrations)),adult_acknowledgement_key:"adultpurchaserack",
  name_collection_required:true,checkout_redirect_url:"https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}",completed_sessions_limit:1,
  stripe_api_version:"2026-06-24.dahlia",preview_source_repository:"arcwebhq-cpu/arc-previews",preview_folder:previewFolder,preview_path:`${previewFolder}/index.html`,
  approval_content_sha256:approvalContentSha256,content_sha256:sha256("preview-content"),published_html_sha256:sha256("published-preview"),source_commit_sha:sourceCommitSha,
  source_tree_sha:sourceTreeSha,asset_publication_receipt_sha256:assetReceiptSha256,lead_route_recipient_hmac_sha256:"7".repeat(64),
  claim_recipient_email_sha256:sha256(recipientEmail),readiness_core_sha256:sha256("readiness"),offer_snapshot_sha256:sha256("offer"),recipient_reservation_sha256:sha256("recipient")});
const checkoutPolicySha256=sha256(checkoutPolicy),referencePayload=Buffer.concat([Buffer.from(checkoutBindingKeyId,"hex"),Buffer.from("a1b2c3d4","hex"),Buffer.from(approvalContentSha256,"hex"),Buffer.from(checkoutPolicySha256,"hex")]);
const referenceMac=createHmac("sha256",checkoutBindingSecret).update("arc-checkout-reference-v3\narcwebhq-cpu/arc-previews\narc-production\nstripe-test\n").update(referencePayload).digest();
const checkoutReference=`v3_${Buffer.concat([referencePayload,referenceMac]).toString("base64url")}`,checkoutReferenceSha256=sha256(checkoutReference);
const artifactEvidenceObject = {
  version: "arc2-handoff-artifact-evidence-v3",
  scope: "netlify-claimable-deploy-artifacts",
  approval_content_sha256:approvalContentSha256,asset_publication_receipt_sha256:assetReceiptSha256,checkout_binding_key_id:checkoutBindingKeyId,
  checkout_config_snapshot_sha256:checkoutPolicySha256,checkout_reference_sha256:checkoutReferenceSha256,
  preview_folder: previewFolder,
  preview_source_commit_sha:sourceCommitSha,preview_source_repository:"arcwebhq-cpu/arc-previews",
  preview_source_tag_sha256:sha256(`refs/tags/arc-checkout-ready-v3/${checkoutReferenceSha256}`),
  lead_route_mode: "netlify_form",
  lead_route_form_name: "summit-lead",
  lead_route_recipient_hmac_sha256: "7".repeat(64),
  production_content_sha256: sha256(productionHtml),
  artifact_manifest_sha256: artifactManifestSha256,
  bundle_fingerprint: bundleFingerprint,
  artifacts,
  issued_at: new Date(Date.now() - 30_000).toISOString()
};
const artifactEvidencePrivate = canonicalJson(artifactEvidenceObject);
const artifactEvidenceSha256 = sha256(artifactEvidencePrivate);
const paymentEvidenceObject = {
  version: "arc2-payment-evidence-v3",
  scope: "authoritative-stripe-checkout-session",
  checkout_session_id: "cs_test_arc_claim_contract",
  stripe_account_id_sha256: expectedStripeAccountIdSha256,
  client_reference_id:checkoutReference,client_reference_id_sha256:checkoutReferenceSha256,client_reference_id_observation:"ABSENT",
  client_reference_mismatch_review_required:false,client_reference_mismatch_review_record_key_hmac_sha256:"",client_reference_mismatch_review_state:"",
  client_reference_mismatch_review_sha256:"",client_reference_mismatch_review_hmac_sha256:"",approval_content_sha256:approvalContentSha256,
  asset_publication_receipt_sha256:assetReceiptSha256,checkout_config_snapshot:checkoutPolicy,checkout_config_snapshot_sha256:checkoutPolicySha256,
  preview_folder: previewFolder,
  preview_source_commit_sha:sourceCommitSha,preview_source_repository:"arcwebhq-cpu/arc-previews",preview_source_tag_sha256:artifactEvidenceObject.preview_source_tag_sha256,
  production_content_sha256: sha256(productionHtml),
  artifact_manifest_sha256: artifactManifestSha256,
  handoff_artifact_evidence_sha256: artifactEvidenceSha256,
  bundle_fingerprint: bundleFingerprint,
  claim_recipient_email_sha256: sha256(recipientEmail),payer_email_sha256:sha256(payerEmail),
  livemode: false,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: 50000,
  amount_total_minor_units: 550000,
  payment_link_id: expectedPaymentLinkId,
  payment_intent_id:"pi_ArcClaimContract",charge_id:"ch_ArcClaimContract",
  price_id: expectedPriceId,
  product_id:"prod_ArcV10Test5000",
  product_tax_code: expectedProductTaxCode,
  price_tax_behavior: "exclusive",
  automatic_tax_enabled: true,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "historical_precheckout_snapshot",
  tax_contract_version: "arc-tax-v1",
  tax_registrations_sha256: "8".repeat(64),
  customer_address_sha256: "9".repeat(64),
  customer_address_country: "US",
  customer_address_state: "WA",
  quantity: 1,
  terms_of_service_consent: "accepted",
  terms_version: expectedTermsVersion,
  adult_purchaser_acknowledgement: "accepted"
};
const paymentEvidencePrivate = canonicalJson(paymentEvidenceObject);
const paymentEvidenceSha256 = sha256(paymentEvidencePrivate);
const netlifySessionId = "netlify_session_contract_1234567890";
const emailClaimKey = canonicalJson({
  version: "arc2-final-delivery-outbox-v1",
  netlify_session_id: netlifySessionId,
  payment_evidence_sha256: paymentEvidenceSha256,
  handoff_artifact_evidence_sha256: artifactEvidenceSha256,
  recipient_email_sha256: sha256(recipientEmail),
  production_url: productionUrl
});
const claimStateEvidenceObject = {
  version: "arc2-claim-state-evidence-v3",
  scope: "netlify-deploy-and-claim-final-deploy",
  status: "FINAL_DEPLOY_READY",
  netlify_session_id: netlifySessionId,
  preview_folder: previewFolder,
  payment_evidence_sha256: paymentEvidenceSha256,
  handoff_artifact_evidence_sha256: artifactEvidenceSha256,
  bundle_fingerprint: bundleFingerprint,
  customer_email_sha256: sha256(recipientEmail),
  netlify_site_id_sha256: sha256("site-id"),
  netlify_deploy_id_sha256: sha256("deploy-id"),
  netlify_destination_account_id_sha256: sha256("destination-account-id"),
  production_url: productionUrl,
  claim_invitation_ready_at: new Date(Date.now() - 25_000).toISOString(),
  claim_callback_received_at: new Date(Date.now() - 20_000).toISOString(),
  claimed_verified_at: new Date(Date.now() - 15_000).toISOString(),
  final_deploy_ready_at: new Date(Date.now() - 12_000).toISOString(),
  outbox_claim_status: "CLAIMED",
  outbox_claim_key_hmac_sha256: createHmac("sha256", emailClaimBindingSecret).update(emailClaimKey).digest("hex"),
  provider_observed_at: issuedAt,
  authorization_nonce_sha256: "",
  issued_at: issuedAt
};
const authorizationNonce = claim => createHmac("sha256", claimStateEvidenceSecret)
  .update(`arc2-final-delivery-authorization-v1\n${canonicalJson({
    bundle_fingerprint: claim.bundle_fingerprint,
    netlify_site_id_sha256: claim.netlify_site_id_sha256,
    netlify_deploy_id_sha256: claim.netlify_deploy_id_sha256,
    netlify_destination_account_id_sha256: claim.netlify_destination_account_id_sha256,
    outbox_claim_key_hmac_sha256: claim.outbox_claim_key_hmac_sha256,
    provider_observed_at: claim.provider_observed_at,
  })}`).digest("hex");
claimStateEvidenceObject.authorization_nonce_sha256 = authorizationNonce(claimStateEvidenceObject);

const signedInput = ({
  payment = paymentEvidenceObject,
  artifact = artifactEvidenceObject,
  claim = claimStateEvidenceObject,
  overrides = {}
} = {}) => {
  const paymentPrivate = canonicalJson(payment);
  const artifactPrivate = canonicalJson(artifact);
  const claimPrivate = canonicalJson(claim);
  return {
    payment_evidence_private: paymentPrivate,
    payment_evidence_hmac_sha256: sign("arc2-payment-evidence-signature-v3\ntest", paymentPrivate, checkoutBindingSecret),
    checkout_binding_secret: checkoutBindingSecret,
    checkout_binding_key_id:checkoutBindingKeyId,
    retired_checkout_binding_keys_json:"{}",
    handoff_artifact_evidence_private: artifactPrivate,
    handoff_artifact_evidence_hmac_sha256: sign("arc2-handoff-artifact-evidence-signature-v3", artifactPrivate, artifactEvidenceSecret),
    handoff_artifact_evidence_secret: artifactEvidenceSecret,
    claim_state_evidence_private: claimPrivate,
    claim_state_evidence_hmac_sha256: sign("arc2-claim-state-evidence-signature-v3", claimPrivate, claimStateEvidenceSecret),
    claim_state_evidence_secret: claimStateEvidenceSecret,
    email_claim_binding_secret: emailClaimBindingSecret,
    recipient_email: recipientEmail,
    stripe_live_mode_enabled: "false",
    ...overrides
  };
};

const authorized = await runGate(signedInput());
assert.equal(authorized.status, "HANDOFF_EMAIL_AUTHORIZED");
assert.equal(authorized.send_delivery_email, true);
assert.equal(authorized.durable_outbox_claim_verified, true);
assert.equal(authorized.state_write_required_before_email, false, "The signed claim evidence already proves the durable CLAIMED outbox state.");
assert.equal(authorized.sent_state_write_required_after_provider_ack, true);
assert.equal(authorized.outbox_claim_key_hmac_sha256, claimStateEvidenceObject.outbox_claim_key_hmac_sha256);
assert.equal(authorized.claim_url_included, false);
assert.equal(authorized.oauth_credential_included, false);
assert.match(authorized.body_text, /not a claim that the site is fully launch-ready/i);
assert.match(authorized.body_text, /privacy policy/i);
const rotatedCheckoutSecret="arc2-new-current-checkout-secret-after-rotation-0123456789";
const retiredKeyAuthorized=await runGate(signedInput({overrides:{checkout_binding_key_id:"02",checkout_binding_secret:rotatedCheckoutSecret,
  retired_checkout_binding_keys_json:canonicalJson({"01":checkoutBindingSecret})}}));
assert.equal(retiredKeyAuthorized.recipient_email,recipientEmail,"A retained v3 checkout key must preserve the reserved claim recipient after rotation.");
const staleSendAuthorityAt=new Date(Date.now()-6*60*1000).toISOString();
const staleSendClaim={...claimStateEvidenceObject,provider_observed_at:staleSendAuthorityAt,issued_at:staleSendAuthorityAt};
staleSendClaim.authorization_nonce_sha256=authorizationNonce(staleSendClaim);
await assert.rejects(runGate(signedInput({claim:staleSendClaim})),/timestamps are stale/,
  "Final delivery email authority must expire within five minutes of the reversal/provider observation.");

const deliveryAssetDigest = "a".repeat(64);
const deliveryAssetPath = `assets/${deliveryAssetDigest}.png`;
const assetArtifacts = [artifacts[0], { path: deliveryAssetPath, sha256: deliveryAssetDigest, size: 68 }, artifacts[1]];
const assetArtifactObject = {
  ...artifactEvidenceObject,
  artifacts: assetArtifacts,
  artifact_manifest_sha256: sha256(canonicalJson(assetArtifacts)),
  bundle_fingerprint: "b".repeat(64),
};
const assetArtifactPrivate = canonicalJson(assetArtifactObject);
const assetPaymentObject = {
  ...paymentEvidenceObject,
  artifact_manifest_sha256: assetArtifactObject.artifact_manifest_sha256,
  handoff_artifact_evidence_sha256: sha256(assetArtifactPrivate),
  bundle_fingerprint: assetArtifactObject.bundle_fingerprint,
};
const assetPaymentPrivate = canonicalJson(assetPaymentObject);
const assetEmailClaimKey = canonicalJson({
  version: "arc2-final-delivery-outbox-v1",
  netlify_session_id: netlifySessionId,
  payment_evidence_sha256: sha256(assetPaymentPrivate),
  handoff_artifact_evidence_sha256: sha256(assetArtifactPrivate),
  recipient_email_sha256: sha256(recipientEmail),
  production_url: productionUrl
});
const assetClaimObject = {
  ...claimStateEvidenceObject,
  payment_evidence_sha256: sha256(assetPaymentPrivate),
  handoff_artifact_evidence_sha256: sha256(assetArtifactPrivate),
  bundle_fingerprint: assetArtifactObject.bundle_fingerprint,
  outbox_claim_key_hmac_sha256: createHmac("sha256", emailClaimBindingSecret).update(assetEmailClaimKey).digest("hex"),
};
assetClaimObject.authorization_nonce_sha256 = authorizationNonce(assetClaimObject);
const assetAuthorized = await runGate(signedInput({ payment: assetPaymentObject, artifact: assetArtifactObject, claim: assetClaimObject }));
assert.equal(assetAuthorized.send_delivery_email, true, "Final email gate must accept an exact signed self-contained asset manifest.");

await assert.rejects(runGate(signedInput({ payment:{...paymentEvidenceObject,payment_link_id:"plink_1Wrong"} })), /claim state is not bound/);
await assert.rejects(runGate(signedInput({ payment:{...paymentEvidenceObject,price_id:"price_1Wrong"} })), /private checkout policy binding/);
await assert.rejects(runGate(signedInput({ overrides: { recipient_email: "other@example.test" } })), /reserved claim recipient/);
await assert.rejects(runGate(signedInput({ overrides: { claim_url: "https://claim.example.test/?token=secret" } })), /claim URLs and Netlify credentials are forbidden/);

const extraArtifactKey = structuredClone(artifactEvidenceObject);
extraArtifactKey.artifacts[0].content = headersFile;
await assert.rejects(runGate(signedInput({ artifact: extraArtifactKey })), /unsafe deploy artifact manifest/);
const duplicateArtifactPath = structuredClone(artifactEvidenceObject);
duplicateArtifactPath.artifacts[1].path = "_headers";
duplicateArtifactPath.artifact_manifest_sha256 = sha256(canonicalJson(duplicateArtifactPath.artifacts));
await assert.rejects(runGate(signedInput({ artifact: duplicateArtifactPath })), /unsafe deploy artifact manifest/);
const tamperedManifestHash = { ...artifactEvidenceObject, artifact_manifest_sha256: "0".repeat(64) };
await assert.rejects(runGate(signedInput({ artifact: tamperedManifestHash })), /artifact manifest SHA-256 mismatch/);
const mismatchedProduction = { ...artifactEvidenceObject, production_content_sha256: "0".repeat(64) };
await assert.rejects(runGate(signedInput({ artifact: mismatchedProduction })), /production content SHA-256 mismatch/);
const forbiddenArtifact = structuredClone(artifactEvidenceObject);
forbiddenArtifact.artifacts.push({ path: "USAGE.md", sha256: sha256("private"), size: 7 });
forbiddenArtifact.artifacts.sort((first, second) => first.path.localeCompare(second.path));
forbiddenArtifact.artifact_manifest_sha256 = sha256(canonicalJson(forbiddenArtifact.artifacts));
await assert.rejects(runGate(signedInput({ artifact: forbiddenArtifact })), /unsafe deploy artifact manifest/);
const addedAsset = structuredClone(artifactEvidenceObject);
addedAsset.artifacts.push({ path: "assets/logo.webp", sha256: sha256("asset"), size: 5 });
addedAsset.artifacts.sort((first, second) => first.path.localeCompare(second.path));
addedAsset.artifact_manifest_sha256 = sha256(canonicalJson(addedAsset.artifacts));
await assert.rejects(runGate(signedInput({ artifact: addedAsset })), /unsafe deploy artifact manifest/);
await assert.rejects(runGate(signedInput({ claim: { ...claimStateEvidenceObject, status: "CLAIMED_VERIFIED" } })), /claim-state evidence contract/);
await assert.rejects(runGate(signedInput({ claim: { ...claimStateEvidenceObject, outbox_claim_status: "PENDING" } })), /claim-state evidence contract/);

console.log("ARC2 claimable-deploy final-email gate contract passed");
