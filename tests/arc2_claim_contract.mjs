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
const recipientEmail = "stripe-customer@example.test";
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
const artifactEvidenceObject = {
  version: "arc2-handoff-artifact-evidence-v1",
  scope: "netlify-claimable-deploy-artifacts",
  preview_folder: previewFolder,
  production_content_sha256: sha256(productionHtml),
  artifact_manifest_sha256: artifactManifestSha256,
  bundle_fingerprint: bundleFingerprint,
  artifacts,
  issued_at: new Date(Date.now() - 30_000).toISOString()
};
const artifactEvidencePrivate = canonicalJson(artifactEvidenceObject);
const artifactEvidenceSha256 = sha256(artifactEvidencePrivate);
const paymentEvidenceObject = {
  version: "arc2-payment-evidence-v2",
  scope: "authoritative-stripe-checkout-session",
  checkout_session_id: "cs_test_arc_claim_contract",
  stripe_account_id_sha256: expectedStripeAccountIdSha256,
  client_reference_id_sha256: sha256(`${previewFolder}_${"a".repeat(64)}`),
  preview_folder: previewFolder,
  production_content_sha256: sha256(productionHtml),
  artifact_manifest_sha256: artifactManifestSha256,
  handoff_artifact_evidence_sha256: artifactEvidenceSha256,
  bundle_fingerprint: bundleFingerprint,
  customer_email_sha256: sha256(recipientEmail),
  livemode: false,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: 50000,
  amount_total_minor_units: 550000,
  payment_link_id: expectedPaymentLinkId,
  price_id: expectedPriceId,
  product_tax_code: expectedProductTaxCode,
  price_tax_behavior: "exclusive",
  automatic_tax_enabled: true,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "verified",
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
  version: "arc2-claim-state-evidence-v2",
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
  issued_at: issuedAt
};

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
    payment_evidence_hmac_sha256: sign("arc2-payment-evidence-signature-v2", paymentPrivate, checkoutBindingSecret),
    checkout_binding_secret: checkoutBindingSecret,
    handoff_artifact_evidence_private: artifactPrivate,
    handoff_artifact_evidence_hmac_sha256: sign("arc2-handoff-artifact-evidence-signature-v1", artifactPrivate, artifactEvidenceSecret),
    handoff_artifact_evidence_secret: artifactEvidenceSecret,
    claim_state_evidence_private: claimPrivate,
    claim_state_evidence_hmac_sha256: sign("arc2-claim-state-evidence-signature-v2", claimPrivate, claimStateEvidenceSecret),
    claim_state_evidence_secret: claimStateEvidenceSecret,
    email_claim_binding_secret: emailClaimBindingSecret,
    recipient_email: recipientEmail,
    expected_payment_link_id: expectedPaymentLinkId,
    expected_price_id: expectedPriceId,
    expected_product_tax_code: expectedProductTaxCode,
    expected_stripe_account_id_sha256: expectedStripeAccountIdSha256,
    stripe_live_mode_enabled: "false",
    expected_terms_version: expectedTermsVersion,
    ...overrides
  };
};

const authorized = await runGate(signedInput());
assert.equal(authorized.status, "HANDOFF_EMAIL_AUTHORIZED");
assert.equal(authorized.send_delivery_email, true);
assert.equal(authorized.durable_outbox_claim_verified, true);
assert.equal(authorized.claim_url_included, false);
assert.equal(authorized.oauth_credential_included, false);
assert.match(authorized.body_text, /not a claim that the site is fully launch-ready/i);
assert.match(authorized.body_text, /privacy policy/i);

await assert.rejects(runGate(signedInput({ overrides: { expected_payment_link_id: "plink_1Wrong" } })), /payment evidence contract/);
await assert.rejects(runGate(signedInput({ overrides: { expected_price_id: "price_1Wrong" } })), /payment evidence contract/);
await assert.rejects(runGate(signedInput({ overrides: { expected_terms_version: "2026-08-10" } })), /exact Payment Link, Price/);
await assert.rejects(runGate(signedInput({ overrides: { recipient_email: "other@example.test" } })), /recipient is not the Stripe customer/);
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
await assert.rejects(runGate(signedInput({ artifact: forbiddenArtifact })), /artifact evidence contract/);
const addedAsset = structuredClone(artifactEvidenceObject);
addedAsset.artifacts.push({ path: "assets/logo.webp", sha256: sha256("asset"), size: 5 });
addedAsset.artifacts.sort((first, second) => first.path.localeCompare(second.path));
addedAsset.artifact_manifest_sha256 = sha256(canonicalJson(addedAsset.artifacts));
await assert.rejects(runGate(signedInput({ artifact: addedAsset })), /artifact evidence contract/);
await assert.rejects(runGate(signedInput({ claim: { ...claimStateEvidenceObject, status: "CLAIMED_VERIFIED" } })), /claim-state evidence contract/);
await assert.rejects(runGate(signedInput({ claim: { ...claimStateEvidenceObject, outbox_claim_status: "PENDING" } })), /claim-state evidence contract/);

console.log("ARC2 claimable-deploy final-email gate contract passed");
