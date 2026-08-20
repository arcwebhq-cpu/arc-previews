import { createHash, createHmac } from "node:crypto";

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const sha256 = value => createHash("sha256").update(value).digest("hex");

export const testPaymentLinkEvidenceSecret = "arc-test-payment-link-evidence-secret-32-bytes-minimum";
// Retained only for legacy negative fixtures. Current public artifacts and offer
// evidence intentionally contain neither a Payment Link ID nor its URL.
export const testPaymentLinkId = "plink_1ArcV10LegacyDisabled";
export const testPaymentLinkUrl = "https://buy.stripe.com/test_LegacyDisabled";
export const testPriceId = "price_1ArcV10Test5000";
export const testProductId = "prod_ArcWebsiteService";
export const testTermsVersion = "2026-08-12";
export const testTermsDocumentSha256 = sha256("ARC terms 2026-08-12 immutable test document");
export const testProductTaxCode = "txcd_12345678";
export const testTaxRegistrations = Object.freeze([
  Object.freeze({ country: "US", id: "taxreg_ArcWashingtonTest", state: "WA", type: "state_sales_tax" })
]);
export const testTaxRegistrationsSha256 = sha256(canonicalJson(testTaxRegistrations));
export const testStripeAccountIdSha256 = sha256("acct_ArcBusinessTest");

export function createTestPaymentLinkEvidence({
  priceId = testPriceId,
  productId = testProductId,
  termsVersion = testTermsVersion,
  termsDocumentSha256 = testTermsDocumentSha256,
  productTaxCode = testProductTaxCode,
  taxRegistrations = testTaxRegistrations,
  taxRegistrationsSha256 = testTaxRegistrationsSha256,
  stripeAccountIdSha256 = testStripeAccountIdSha256,
  issuedAt = new Date().toISOString(),
  secret = testPaymentLinkEvidenceSecret
} = {}) {
  const configuration = canonicalJson({
    stripe_account_id_sha256: stripeAccountIdSha256,
    livemode: false,
    price_id: priceId,
    product_id: productId,
    amount_subtotal_minor_units: 500000,
    currency: "usd",
    quantity: 1,
    terms_version: termsVersion,
    terms_document_sha256: termsDocumentSha256,
    automatic_tax_enabled: true,
    customer_address_source: "stripe_checkout_customer_details.address",
    price_tax_behavior: "exclusive",
    product_tax_code: productTaxCode,
    tax_contract_version: "arc-tax-v1",
    tax_settings_status: "active",
    tax_registrations: taxRegistrations,
    tax_registrations_sha256: taxRegistrationsSha256,
    adult_acknowledgement_key: "adultpurchaserack",
    name_collection_required: true,
    submit_type: "auto",
    checkout_redirect_url: "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}",
    stripe_api_version: "2026-06-24.dahlia"
  });
  const evidencePrivate = canonicalJson({
    version: "arc1-checkout-offer-template-evidence-v1",
    scope: "authoritative-private-checkout-offer-template-preflight",
    stripe_account_id_sha256: stripeAccountIdSha256,
    price_id: priceId,
    product_id: productId,
    livemode: false,
    amount_subtotal_minor_units: 500000,
    currency: "usd",
    quantity: 1,
    terms_version: termsVersion,
    terms_document_sha256: termsDocumentSha256,
    automatic_tax_enabled: true,
    customer_address_source: "stripe_checkout_customer_details.address",
    price_tax_behavior: "exclusive",
    product_tax_code: productTaxCode,
    tax_contract_version: "arc-tax-v1",
    tax_settings_status: "active",
    tax_registrations: taxRegistrations,
    tax_registrations_sha256: taxRegistrationsSha256,
    adult_acknowledgement_key: "adultpurchaserack",
    name_collection_required: true,
    submit_type: "auto",
    checkout_redirect_url: "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}",
    stripe_api_version: "2026-06-24.dahlia",
    configuration_sha256: sha256(configuration),
    issued_at: issuedAt
  });
  return {
    evidencePrivate,
    evidenceSha256: sha256(evidencePrivate),
    privateInputs: {
      expected_price_id: priceId,
      expected_terms_version: termsVersion,
      expected_terms_document_sha256: termsDocumentSha256,
      retained_terms_documents_json: canonicalJson({ [termsVersion]: termsDocumentSha256 }),
      expected_product_tax_code: productTaxCode,
      expected_stripe_account_id_sha256: stripeAccountIdSha256,
      stripe_live_mode_enabled: "false",
      payment_link_evidence_secret: secret,
      payment_link_evidence_private: evidencePrivate,
      payment_link_evidence_hmac_sha256: createHmac("sha256", secret)
        .update(`arc1-checkout-offer-template-evidence-signature-v1\n${evidencePrivate}`)
        .digest("hex")
    }
  };
}
