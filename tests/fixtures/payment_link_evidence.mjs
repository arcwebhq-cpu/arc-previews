import { createHash, createHmac } from "node:crypto";

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const testPaymentLinkEvidenceSecret = "arc-test-payment-link-evidence-secret-32-bytes-minimum";
export const testPaymentLinkId = "plink_1ArcV10Test5000";
export const testPriceId = "price_1ArcV10Test5000";
export const testTermsVersion = "2026-08-12";
export const testPaymentLinkUrl = "https://buy.stripe.com/test_00000000000000";
export const testProductTaxCode = "txcd_12345678";
export const testTaxRegistrationsSha256 = createHash("sha256")
  .update("arc-test-active-wa-tax-registration")
  .digest("hex");
export const testStripeAccountIdSha256 = createHash("sha256")
  .update("acct_ArcBusinessTest")
  .digest("hex");

export function createTestPaymentLinkEvidence({
  paymentLinkId = testPaymentLinkId,
  priceId = testPriceId,
  paymentLinkUrl = testPaymentLinkUrl,
  termsVersion = testTermsVersion,
  productTaxCode = testProductTaxCode,
  taxRegistrationsSha256 = testTaxRegistrationsSha256,
  stripeAccountIdSha256 = testStripeAccountIdSha256,
  issuedAt = new Date().toISOString(),
  secret = testPaymentLinkEvidenceSecret
} = {}) {
  const configuration = canonicalJson({
    payment_link_id: paymentLinkId,
    stripe_account_id_sha256: stripeAccountIdSha256,
    livemode: false,
    payment_link_url: paymentLinkUrl,
    price_id: priceId,
    terms_version: termsVersion,
    automatic_tax_enabled: true,
    product_tax_code: productTaxCode,
    tax_settings_status: "active",
    tax_registrations_sha256: taxRegistrationsSha256
  });
  const evidencePrivate = canonicalJson({
    version: "arc1-payment-link-evidence-v2",
    scope: "authoritative-stripe-payment-link-preflight",
    payment_link_id: paymentLinkId,
    stripe_account_id_sha256: stripeAccountIdSha256,
    livemode: false,
    payment_link_url: paymentLinkUrl,
    price_id: priceId,
    amount_subtotal_minor_units: 500000,
    currency: "usd",
    quantity: 1,
    terms_version: termsVersion,
    automatic_tax_enabled: true,
    customer_address_source: "stripe_checkout_customer_details.address",
    price_tax_behavior: "exclusive",
    product_tax_code: productTaxCode,
    tax_contract_version: "arc-tax-v1",
    tax_settings_status: "active",
    tax_registrations_sha256: taxRegistrationsSha256,
    configuration_sha256: createHash("sha256").update(configuration).digest("hex"),
    issued_at: issuedAt
  });
  return {
    evidencePrivate,
    evidenceSha256: createHash("sha256").update(evidencePrivate).digest("hex"),
    privateInputs: {
      payment_link_url: paymentLinkUrl,
      expected_payment_link_id: paymentLinkId,
      expected_price_id: priceId,
      expected_terms_version: termsVersion,
      expected_product_tax_code: productTaxCode,
      expected_stripe_account_id_sha256: stripeAccountIdSha256,
      stripe_live_mode_enabled: "false",
      payment_link_evidence_secret: secret,
      payment_link_evidence_private: evidencePrivate,
      payment_link_evidence_hmac_sha256: createHmac("sha256", secret)
        .update(`arc1-payment-link-evidence-signature-v2\n${evidencePrivate}`)
        .digest("hex")
    }
  };
}
