import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc2_delivery_email_gate.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runGate = new AsyncFunction("inputData", source);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const hmac = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");
const sign = (secret, prefix, text) => hmac(secret, `${prefix}\n${text}`);
const framed = entries => {
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry.path).update("\0").update(entry.bytes).update("\0");
  return hash.digest("hex");
};
const HTML_PATHS = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"];
const currentSecret = "arc2-current-checkout-binding-secret-v4-012345";
const artifactSecret = "arc2-delivery-artifact-secret-v4-0123456789";
const claimSecret = "arc2-delivery-claim-state-secret-v3-012345";
const outboxSecret = "arc2-delivery-outbox-binding-secret-v1-0123";
const recipient = "reserved-recipient@example.test";
const payer = "stripe-payer@example.test";
const previewFolder = "summit-roofing-a1b2c3d4";
const productionUrl = "https://summit-roofing.netlify.app/";
const pages = HTML_PATHS.map(path => ({ path, bytes: Buffer.from(`<!doctype html><title>${path}</title>\n`) }));
const headers = { path: "_headers", bytes: Buffer.from("/* exact headers */\n") };
const artifactBytes = [headers, ...pages];
const artifactManifest = artifactBytes.map(item => ({ path: item.path, sha256: sha(item.bytes), size: item.bytes.length }));
const productionSha256 = framed(pages);
const bundleFingerprint = framed(artifactBytes);
const approvalSha256 = sha("approved five-page preview");
const assetReceiptSha256 = sha("asset publication receipt");
const sourceCommit = "a".repeat(40);
const sourceTree = "b".repeat(40);
const stripeAccountSha256 = "7".repeat(64);
const taxRegistrations = [{ country: "US", id: "taxreg_ArcWashington", state: "WA", type: "state_sales_tax" }];
const taxRegistrationsSha256 = sha(canonical(taxRegistrations));

function makeChain({ kid = "01", selectedSecret = currentSecret, currentKid = "01", configuredCurrentSecret = currentSecret,
  retiredKeys = {}, leadMode = "netlify_form", artifactVersion = "arc2-handoff-artifact-evidence-v4",
  paymentVersion = "arc2-payment-evidence-v4", policyVersion = "arc-private-checkout-policy-v2", policyScope = "one-approved-five-page-preview-one-private-payment-link",
  artifactMutator, policyMutator, paymentMutator, claimMutator, claimAgeMs = 10_000 } = {}) {
  let policy = {
    version: policyVersion, scope: policyScope, checkout_binding_key_id: kid, stripe_mode: "test", stripe_account_id_sha256: stripeAccountSha256,
    price_id: "price_ArcFivePage5000", product_id: "prod_ArcFivePage5000", amount_subtotal_minor_units: 500000, currency: "usd", quantity: 1,
    terms_version: "2026-08-25", terms_document_sha256: sha("terms 2026-08-25"), automatic_tax_enabled: true,
    customer_address_source: "stripe_checkout_customer_details.address", price_tax_behavior: "exclusive", product_tax_code: "txcd_12345678",
    tax_contract_version: "arc-tax-v1", tax_registrations: taxRegistrations, tax_registrations_sha256: taxRegistrationsSha256,
    adult_acknowledgement_key: "adultpurchaserack", name_collection_required: true,
    checkout_redirect_url: "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}", completed_sessions_limit: 1,
    stripe_api_version: "2026-07-29.dahlia", offer_contract_id: "arc-fixed-five-page-offer-v1",
    deliverable: "fixed-five-page-marketing-website-v1", page_count: 5, preview_source_repository: "arcwebhq-cpu/arc-previews",
    preview_folder: previewFolder, preview_paths: HTML_PATHS.map(path => `${previewFolder}/${path}`), approval_content_sha256: approvalSha256,
    content_sha256: sha("published preview bundle"), published_site_sha256: productionSha256, source_commit_sha: sourceCommit, source_tree_sha: sourceTree,
    asset_publication_receipt_sha256: assetReceiptSha256, lead_route_recipient_hmac_sha256: leadMode === "netlify_form" ? "6".repeat(64) : "",
    claim_recipient_email_sha256: sha(recipient), readiness_core_sha256: sha("readiness"), offer_snapshot_sha256: sha("offer"),
    recipient_reservation_sha256: sha("reservation")
  };
  if (policyMutator) policy = policyMutator(structuredClone(policy));
  const policyPrivate = canonical(policy);
  const referencePayload = Buffer.concat([Buffer.from(kid, "hex"), Buffer.from("a1b2c3d4", "hex"), Buffer.from(approvalSha256, "hex"), Buffer.from(sha(policyPrivate), "hex")]);
  const referenceMac = createHmac("sha256", selectedSecret).update("arc-checkout-reference-v4\narcwebhq-cpu/arc-previews\narc-production\nstripe-test\n").update(referencePayload).digest();
  const reference = `v4_${Buffer.concat([referencePayload, referenceMac]).toString("base64url")}`;
  let artifact = {
    version: artifactVersion, scope: "netlify-claimable-deploy-artifacts", approval_content_sha256: approvalSha256,
    asset_publication_receipt_sha256: assetReceiptSha256, checkout_binding_key_id: kid, checkout_config_snapshot_sha256: sha(policyPrivate),
    checkout_reference_sha256: sha(reference), preview_folder: previewFolder, preview_source_commit_sha: sourceCommit,
    preview_source_repository: "arcwebhq-cpu/arc-previews", preview_source_tag_sha256: sha(`refs/tags/arc-checkout-ready-v4/${sha(reference)}`),
    lead_route_mode: leadMode, lead_route_form_name: leadMode === "netlify_form" ? "summit-lead" : "",
    lead_route_recipient_hmac_sha256: leadMode === "netlify_form" ? "6".repeat(64) : "", production_content_sha256: productionSha256,
    artifact_manifest_sha256: sha(canonical(artifactManifest)), bundle_fingerprint: bundleFingerprint, artifacts: artifactManifest,
    issued_at: new Date(Date.now() - 60_000).toISOString()
  };
  if (artifactMutator) artifact = artifactMutator(structuredClone(artifact));
  const artifactPrivate = canonical(artifact);
  let payment = {
    version: paymentVersion, scope: "authoritative-stripe-checkout-session", checkout_session_id: "cs_test_arc_five_page_delivery",
    stripe_account_id_sha256: stripeAccountSha256, client_reference_id: reference, client_reference_id_sha256: sha(reference),
    client_reference_id_observation: "ABSENT", client_reference_mismatch_review_required: false,
    client_reference_mismatch_review_record_key_hmac_sha256: "", client_reference_mismatch_review_state: "",
    client_reference_mismatch_review_sha256: "", client_reference_mismatch_review_hmac_sha256: "", approval_content_sha256: approvalSha256,
    asset_publication_receipt_sha256: assetReceiptSha256, checkout_config_snapshot: policyPrivate, checkout_config_snapshot_sha256: sha(policyPrivate),
    preview_folder: previewFolder, preview_source_commit_sha: sourceCommit, preview_source_repository: "arcwebhq-cpu/arc-previews",
    preview_source_tag_sha256: artifact.preview_source_tag_sha256, production_content_sha256: artifact.production_content_sha256,
    artifact_manifest_sha256: artifact.artifact_manifest_sha256, handoff_artifact_evidence_sha256: sha(artifactPrivate),
    bundle_fingerprint: artifact.bundle_fingerprint, claim_recipient_email_sha256: sha(recipient), payer_email_sha256: sha(payer), livemode: false,
    mode: "payment", status: "complete", payment_status: "paid", currency: "usd", subtotal_amount_minor_units: 500000,
    tax_amount_minor_units: 50000, amount_total_minor_units: 550000, payment_link_id: "plink_ArcFivePage5000",
    payment_intent_id: "pi_ArcFivePageDelivery", charge_id: "ch_ArcFivePageDelivery", price_id: policy.price_id,
    product_id: policy.product_id, product_tax_code: policy.product_tax_code, price_tax_behavior: "exclusive", automatic_tax_enabled: true,
    automatic_tax_status: "complete", customer_address_status: "verified", tax_registration_status: "historical_precheckout_snapshot",
    tax_contract_version: "arc-tax-v1", tax_registrations_sha256: taxRegistrationsSha256, customer_address_sha256: sha("customer address"),
    customer_address_country: "US", customer_address_state: "WA", quantity: 1, terms_of_service_consent: "accepted",
    terms_version: "2026-08-25", adult_purchaser_acknowledgement: "accepted"
  };
  if (paymentMutator) payment = paymentMutator(structuredClone(payment));
  const paymentPrivate = canonical(payment);
  const observedAt = new Date(Date.now() - claimAgeMs).toISOString();
  const sessionId = "netlify_session_five_page_123456789";
  const outboxKey = canonical({ version: "arc2-final-delivery-outbox-v1", netlify_session_id: sessionId,
    payment_evidence_sha256: sha(paymentPrivate), handoff_artifact_evidence_sha256: sha(artifactPrivate),
    recipient_email_sha256: sha(recipient), production_url: productionUrl });
  let claim = {
    version: "arc2-claim-state-evidence-v3", scope: "netlify-deploy-and-claim-final-deploy", status: "FINAL_DEPLOY_READY",
    netlify_session_id: sessionId, preview_folder: previewFolder, payment_evidence_sha256: sha(paymentPrivate),
    handoff_artifact_evidence_sha256: sha(artifactPrivate), bundle_fingerprint: artifact.bundle_fingerprint, customer_email_sha256: sha(recipient),
    netlify_site_id_sha256: sha("site-id"), netlify_deploy_id_sha256: sha("final-deploy-id"),
    netlify_destination_account_id_sha256: sha("destination-account"), production_url: productionUrl,
    claim_invitation_ready_at: new Date(Date.now() - 50_000).toISOString(), claim_callback_received_at: new Date(Date.now() - 40_000).toISOString(),
    claimed_verified_at: new Date(Date.now() - 30_000).toISOString(), final_deploy_ready_at: new Date(Date.now() - 20_000).toISOString(),
    outbox_claim_status: "CLAIMED", outbox_claim_key_hmac_sha256: hmac(outboxSecret, outboxKey), provider_observed_at: observedAt,
    authorization_nonce_sha256: "", issued_at: observedAt
  };
  claim.authorization_nonce_sha256 = hmac(claimSecret, `arc2-final-delivery-authorization-v1\n${canonical({
    bundle_fingerprint: claim.bundle_fingerprint, netlify_site_id_sha256: claim.netlify_site_id_sha256,
    netlify_deploy_id_sha256: claim.netlify_deploy_id_sha256, netlify_destination_account_id_sha256: claim.netlify_destination_account_id_sha256,
    outbox_claim_key_hmac_sha256: claim.outbox_claim_key_hmac_sha256, provider_observed_at: claim.provider_observed_at
  })}`);
  if (claimMutator) claim = claimMutator(structuredClone(claim));
  const claimPrivate = canonical(claim);
  return {
    chain: { policy, artifact, payment, claim, reference },
    input: {
      payment_evidence_private: paymentPrivate, payment_evidence_hmac_sha256: sign(selectedSecret, "arc2-payment-evidence-signature-v4\ntest", paymentPrivate),
      checkout_binding_secret: configuredCurrentSecret, checkout_binding_key_id: currentKid, retired_checkout_binding_keys_json: canonical(retiredKeys),
      handoff_artifact_evidence_private: artifactPrivate,
      handoff_artifact_evidence_hmac_sha256: sign(artifactSecret, "arc2-handoff-artifact-evidence-signature-v4", artifactPrivate),
      handoff_artifact_evidence_secret: artifactSecret, claim_state_evidence_private: claimPrivate,
      claim_state_evidence_hmac_sha256: sign(claimSecret, "arc2-claim-state-evidence-signature-v3", claimPrivate),
      claim_state_evidence_secret: claimSecret, email_claim_binding_secret: outboxSecret, recipient_email: recipient, stripe_live_mode_enabled: "false"
    }
  };
}

const base = makeChain();
const authorized = await runGate(base.input);
assert.equal(authorized.status, "HANDOFF_EMAIL_AUTHORIZED");
assert.equal(authorized.send_delivery_email, true);
assert.equal(authorized.final_deploy_readback_authority_verified, true);
assert.equal(authorized.exact_five_page_artifact_vector_verified, true);
assert.equal(authorized.provider_send_performed_by_this_step, false);
assert.equal(authorized.provider_mutation_allowed_by_this_step, false);
assert.equal(authorized.state_write_allowed_by_this_step, false);
assert.equal(authorized.sent_state_write_required_after_provider_ack, true);
assert.equal(authorized.production_content_sha256, productionSha256);
assert.equal(authorized.artifact_manifest_sha256, sha(canonical(artifactManifest)));
assert.equal(authorized.claim_url_included, false);
for (const secret of [currentSecret, artifactSecret, claimSecret, outboxSecret, payer, base.chain.reference]) assert.equal(JSON.stringify(authorized).includes(secret), false);

const noForm = makeChain({ leadMode: "not_required" });
assert.equal((await runGate(noForm.input)).send_delivery_email, true, "signed no-form handoffs remain deliverable");
const retiredSecret = "arc2-retired-checkout-binding-secret-v4-012345";
const retired = makeChain({ kid: "01", selectedSecret: retiredSecret, currentKid: "02", configuredCurrentSecret: currentSecret, retiredKeys: { "01": retiredSecret } });
assert.equal((await runGate(retired.input)).send_delivery_email, true, "retained v4 checkout keys must remain replay-verifiable");

await assert.rejects(runGate(makeChain({ paymentVersion: "arc2-payment-evidence-v3" }).input), /payment evidence v4 contract/);
await assert.rejects(runGate(makeChain({ artifactVersion: "arc2-handoff-artifact-evidence-v3" }).input), /artifact evidence v4 contract/);
await assert.rejects(runGate(makeChain({ policyVersion: "arc-private-checkout-policy-v1", policyScope: "one-approved-preview-one-private-payment-link" }).input), /policy v2 binding/);
await assert.rejects(runGate(makeChain({ paymentMutator: payment => ({ ...payment,
  client_reference_id_observation: "MISMATCH_REVIEW_REQUIRED", client_reference_mismatch_review_required: true,
  client_reference_mismatch_review_record_key_hmac_sha256: "1".repeat(64), client_reference_mismatch_review_state: "{}",
  client_reference_mismatch_review_sha256: sha("{}"), client_reference_mismatch_review_hmac_sha256: "2".repeat(64)
}) }).input), /mismatch review binding/);

for (const artifactMutator of [
  artifact => { artifact.artifacts = artifact.artifacts.filter(item => item.path !== "about/index.html"); artifact.artifact_manifest_sha256 = sha(canonical(artifact.artifacts)); return artifact; },
  artifact => { artifact.artifacts.splice(-1, 0, { path: "extra/index.html", sha256: sha("extra"), size: 5 }); artifact.artifact_manifest_sha256 = sha(canonical(artifact.artifacts)); return artifact; },
  artifact => { [artifact.artifacts[1], artifact.artifacts[2]] = [artifact.artifacts[2], artifact.artifacts[1]]; artifact.artifact_manifest_sha256 = sha(canonical(artifact.artifacts)); return artifact; }
]) await assert.rejects(runGate(makeChain({ artifactMutator }).input), /exact five-page deploy artifact manifest/);

await assert.rejects(runGate(makeChain({ artifactMutator: artifact => ({ ...artifact, artifact_manifest_sha256: "0".repeat(64) }) }).input), /manifest SHA-256|bindings disagree/);
await assert.rejects(runGate(makeChain({ policyMutator: policy => ({ ...policy, published_site_sha256: "0".repeat(64) }) }).input), /bindings disagree/);
await assert.rejects(runGate(makeChain({ claimAgeMs: 6 * 60_000 }).input), /timestamps are stale/);
await assert.rejects(runGate({ ...base.input, recipient_email: "other@example.test" }), /reserved claim recipient/);
await assert.rejects(runGate({ ...base.input, claim_url: "https://claim.example.test/?token=secret" }), /claim URLs and provider credentials/);
await assert.rejects(runGate(makeChain({ claimMutator: claim => ({ ...claim, status: "CLAIMED_VERIFIED" }) }).input), /final-deploy evidence contract/);
await assert.rejects(runGate(makeChain({ claimMutator: claim => ({ ...claim, outbox_claim_status: "PENDING" }) }).input), /final-deploy evidence contract/);

console.log("ARC2 v4 five-page final-delivery email gate contract passed");
