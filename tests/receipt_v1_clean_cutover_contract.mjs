import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { fixtures } from "../fixtures/v11_industries.mjs";
import { createTestIntakeEvidence, canonicalJson } from "./fixtures/intake_evidence.mjs";
import { createTestPaymentLinkEvidence } from "./fixtures/payment_link_evidence.mjs";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");
const [contractRaw, document, wiringRaw, injectorSource, assetPublisherSource, linkSource, resolverSource, deliveryGateSource, template] = await Promise.all([
  "../zapier/receipt-v1-clean-cutover.json",
  "../zapier/receipt-v1-clean-cutover.md",
  "../zapier/wiring-contract.json",
  "../zapier/arc1_inject.js",
  "../zapier/arc1_publish_function_assets.js",
  "../zapier/arc1_private_checkout_link.js",
  "../zapier/arc2_resolve_and_finalize.js",
  "../zapier/arc2_delivery_email_gate.js",
  "../ARC_MASTER_TEMPLATE_V11.html"
].map(read));
const contract = JSON.parse(contractRaw);
const wiring = JSON.parse(wiringRaw);
const contractSha256 = createHash("sha256").update(contractRaw).digest("hex");

assert.deepEqual(contract, {
  version: "arc-receipt-v1-clean-cutover-v1",
  scope: "frozen-zero-live-customer-receipt-cutover",
  frozen_at: "2026-08-26T00:00:00.000Z",
  mutable: false,
  repository: "arcwebhq-cpu/arc-previews",
  inventory: {
    customer_image_publication_receipts: 0,
    live_private_payment_link_receipts: 0,
    in_flight_customer_image_publication_jobs: 0,
    in_flight_live_private_payment_link_jobs: 0,
    pending_function_intake_evidence: 0,
    pending_function_intake_submissions: 0,
    provider_zero_state_verified: false,
    inventory_is_cryptographic_proof: false,
    basis: "operator-declared-zero-customer-and-zero-live-receipt-inventory-at-freeze"
  },
  asset_publication_receipt_v1: {
    version: "arc1-public-asset-publication-receipt-v1",
    cutover_mode: "clean-cutover-no-dual-read",
    legacy_nonempty_status: "VERIFIED_CONTENT_ADDRESSED",
    current_nonempty_status: "HUMAN_REVIEWED_CONTENT_ADDRESSED",
    legacy_receipts_accepted: false,
    legacy_intake_evidence_accepted_by_injector: false,
    legacy_asset_permission: "Confirmed",
    current_asset_permission: "Confirmed rights and no visible watermark v1",
    bridge_contract_version: "arc-intake-to-arc1-contract-v2",
    bridge_contract_sha256: "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2",
    legacy_bridge_contract_accepted: false,
    image_review_protocol: "arc1-asset-visual-review-v1",
    automated_screening_protocol: "arc-deterministic-image-screen-v1",
    animated_webp_accepted: false,
    required_authority_gate: "asset_visual_review_authority_verified",
    required_new_receipt_fields: [
      "asset_visual_review_authority_verified",
      "asset_visual_review_key_id",
      "asset_visual_review_reviewer_id_sha256",
      "asset_visual_review_sha256"
    ],
    review_signature_frame: "arc1-asset-visual-review-signature-v1\\n{asset_visual_review_key_id}\\n{canonical_review_json}",
    regeneration_required: true
  },
  private_payment_link_receipt_v1: {
    version: "arc-private-checkout-link-receipt-v1",
    cutover_mode: "clean-cutover-no-dual-read",
    legacy_readback_preimage_included_product_tax_code: false,
    current_readback_preimage_includes_product_tax_code: true,
    required_readback_contract: "product-tax-code-bound-v1",
    legacy_receipts_accepted: false,
    regeneration_required: true
  },
  arc2_payment_evidence_v4: {
    version: "arc2-payment-evidence-v4",
    cutover_mode: "clean-cutover-no-dual-read",
    required_tax_audit_fields: ["line_item_taxes_sha256", "taxability_reasons"],
    legacy_signed_evidence_without_tax_audit_fields_accepted: false,
    regeneration_required: true
  },
  deployment: {
    atomic_producer_consumer_deploy_required: true,
    drain_or_discard_pre_cutover_queues_required: true,
    regenerate_all_receipts_before_activation: true,
    rollback_may_reenable_legacy_receipts: false,
    provider_authority_verified: false,
    provider_authority_enabled: false,
    provider_zero_state_verified: false,
    private_integration_or_secret_broker_verified: false,
    provider_history_redaction_verified: false,
    code_step_input_data_secret_custody_allowed: false,
    live_activation_allowed: false
  },
  assurance_limits: {
    operator_configuration_cryptographically_proves_a_human_reviewed_pixels: false,
    review_secret_and_key_custody_verified: false,
    private_integration_or_secret_broker_required: true,
    review_provider_identity_and_authority_verified: false,
    pixel_level_watermark_certainty: false,
    watermark_free_guarantee: false
  }
});
assert.equal(wiring.arc1.function_intake_bridge.public_asset_publication.clean_cutover_contract_sha256, contractSha256);
assert.equal(wiring.arc1.receipt_v1_clean_cutover.contract_sha256, contractSha256);

assert.match(document, /zero\s+customer image-publication receipts/i);
assert.match(document, /external provider zero-state has not been\s+verified/i);
assert.match(document, /no dual reader/i);
assert.match(document, /deploy each changed producer with every exact-key consumer atomically/i);
assert.match(document, /does not\s+cryptographically prove that a human inspected the pixels/i);
assert.match(document, /Code by Zapier Input Data is not accepted as secret custody/i);
assert.match(document, /live activation remains prohibited/i);
assert.match(assetPublisherSource, /configuredTrue\(inputData\.asset_visual_review_authority_verified\)/);
assert.match(assetPublisherSource, /asset_visual_review_private_secret_broker_verified/);
assert.match(assetPublisherSource, /asset_visual_review_provider_history_redaction_verified/);
assert.match(assetPublisherSource, /authorized_image_reviewer_id_sha256/);
assert.match(assetPublisherSource, /arc1-asset-visual-review-signature-v1\\n\$\{assetVisualReviewKeyId\}\\n/);
assert.match(injectorSource, /ARC1_LEGACY_INTAKE_DISABLED/);
assert.match(injectorSource, /Confirmed rights and no visible watermark v1/);
assert.match(linkSource, /readback_contract!=="product-tax-code-bound-v1"/);
assert.match(linkSource, /readback_contract:"product-tax-code-bound-v1"/);
assert.match(linkSource, /product_tax_code:offer\.product_tax_code/);
assert.match(resolverSource, /"readback_contract"/);
assert.match(resolverSource, /linkReceipt\.readback_contract !== "product-tax-code-bound-v1"/);
assert.match(deliveryGateSource, /"tax_amount_minor_units", "taxability_reasons", "line_item_taxes_sha256"/);
assert.match(deliveryGateSource, /payment\.taxability_reasons/);

const fixture = fixtures[0];
const intake = createTestIntakeEvidence({
  businessName: fixture.content.BUSINESS_NAME,
  submissionDataSha256: "4".repeat(64)
});
const payment = createTestPaymentLinkEvidence();
const legacyEvidence = canonicalJson({
  version: "arc1-intake-evidence-v1",
  scope: "authoritative-netlify-intake-and-assets"
});
let legacyNetworkCalls = 0;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runInjector = new AsyncFunction("inputData", "fetch", injectorSource);
await assert.rejects(runInjector({
  template_content: template,
  raw_json: JSON.stringify(fixture.content),
  customer_email: fixture.customerEmail,
  private_claim_recipient_email: fixture.customerEmail,
  private_lead_notification_email: "leads@example.test",
  checkout_binding_secret: "checkout-binding-secret-unique-0123456789",
  checkout_binding_key_id: "01",
  logo_file_url: "",
  hero_image_url: "",
  supporting_image_url: "",
  ...payment.privateInputs,
  ...intake.privateInputs,
  intake_evidence_private: legacyEvidence
}, async () => {
  legacyNetworkCalls += 1;
  throw new Error("legacy evidence must fail before network access");
}), /ARC1_LEGACY_INTAKE_DISABLED/);
assert.equal(legacyNetworkCalls, 0, "legacy intake evidence must be non-activatable before every provider call");

for (const relative of ["./arc2_claim_contract.mjs", "./arc2_delivery_email_gate_contract.mjs"]) {
  execFileSync(process.execPath, [fileURLToPath(new URL(relative, import.meta.url))], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "pipe"
  });
}

console.log("ARC frozen receipt-v1 clean-cutover contract passed: no dual-read compatibility, legacy intake disabled, authority-bound image reviews, tax-code-bound Link readback, and exact Payment Evidence V4 tax audit shape.");
