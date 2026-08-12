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
export const testTermsVersion = "2026-08-11";
export const testPaymentLinkUrl = "https://buy.stripe.com/test_00000000000000";

export function createTestPaymentLinkEvidence({
  paymentLinkId = testPaymentLinkId,
  priceId = testPriceId,
  paymentLinkUrl = testPaymentLinkUrl,
  termsVersion = testTermsVersion,
  issuedAt = new Date().toISOString(),
  secret = testPaymentLinkEvidenceSecret
} = {}) {
  const configuration = canonicalJson({
    payment_link_id: paymentLinkId,
    payment_link_url: paymentLinkUrl,
    price_id: priceId,
    terms_version: termsVersion
  });
  const evidencePrivate = canonicalJson({
    version: "arc1-payment-link-evidence-v1",
    scope: "authoritative-stripe-test-payment-link-preflight",
    payment_link_id: paymentLinkId,
    payment_link_url: paymentLinkUrl,
    price_id: priceId,
    amount_total_minor_units: 500000,
    currency: "usd",
    quantity: 1,
    terms_version: termsVersion,
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
      payment_link_evidence_secret: secret,
      payment_link_evidence_private: evidencePrivate,
      payment_link_evidence_hmac_sha256: createHmac("sha256", secret)
        .update(`arc1-payment-link-evidence-signature-v1\n${evidencePrivate}`)
        .digest("hex")
    }
  };
}
