// ARC1 payment-link preflight — retrieve the exact Stripe test Payment Link
// before rendering a preview and issue short-lived signed configuration evidence.
// This step is read-only and never creates a Checkout Session or charge.
const clean = value => String(value == null ? "" : value).trim();
const stripeTestApiKey = clean(inputData.stripe_test_api_key);
const expectedPaymentLinkId = clean(inputData.expected_payment_link_id);
const expectedPriceId = clean(inputData.expected_price_id);
const expectedTermsVersion = clean(inputData.expected_terms_version);
const expectedPaymentLinkUrl = clean(inputData.expected_payment_link_url);
const evidenceSecret = clean(inputData.payment_link_evidence_secret);
const expectedRedirectUrl = clean(inputData.expected_checkout_redirect_url);
const requiredCheckoutRedirectUrl = "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}";
if (!/^(?:sk|rk)_test_[A-Za-z0-9_]{12,}$/.test(stripeTestApiKey)) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe test API key is required");
}
if (!/^plink_[A-Za-z0-9]+$/.test(expectedPaymentLinkId) || !/^price_[A-Za-z0-9]+$/.test(expectedPriceId)) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exact Payment Link and Price ids are required");
}
if (expectedTermsVersion !== "2026-08-11") {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: static terms version mismatch");
}
if (expectedRedirectUrl !== requiredCheckoutRedirectUrl) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: checkout redirect must match the static ARC payment-success URL");
}
let configuredUrl;
let expectedRedirect;
try {
  configuredUrl = new URL(expectedPaymentLinkUrl);
  expectedRedirect = new URL(expectedRedirectUrl);
} catch (error) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: configured URL");
}
if (configuredUrl.origin !== "https://buy.stripe.com" || !/^\/test_[A-Za-z0-9]+$/.test(configuredUrl.pathname) ||
    configuredUrl.username || configuredUrl.password || configuredUrl.search || configuredUrl.hash ||
    expectedRedirect.protocol !== "https:" || expectedRedirect.username || expectedRedirect.password || expectedRedirect.hash ||
    !expectedRedirectUrl.includes("{CHECKOUT_SESSION_ID}") ||
    [...expectedRedirect.searchParams.values()].filter(value => value === "{CHECKOUT_SESSION_ID}").length !== 1) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exact test Payment Link and HTTPS redirect URL are required");
}
if (evidenceSecret.length < 32 || evidenceSecret.length > 256) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: evidence secret must be 32–256 characters");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: SHA-256 and HMAC-SHA-256 are required");
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
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const resourceUrl = `https://api.stripe.com/v1/payment_links/${encodeURIComponent(expectedPaymentLinkId)}?expand%5B%5D=line_items.data.price`;
const response = await fetch(resourceUrl, {
  method: "GET",
  headers: {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${stripeTestApiKey}:`, "utf8").toString("base64")}`,
    "Stripe-Version": "2026-06-24.dahlia"
  },
  redirect: "error"
});
if (response.url && response.url !== resourceUrl) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe API redirect rejected");
}
if (!response.ok) {
  throw new Error(`ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe Payment Link retrieval failed (${response.status})`);
}
const paymentLink = await response.json();
if (!paymentLink || typeof paymentLink !== "object" || Array.isArray(paymentLink) ||
    paymentLink.object !== "payment_link" || clean(paymentLink.id) !== expectedPaymentLinkId ||
    paymentLink.livemode !== false || paymentLink.active !== true || clean(paymentLink.url) !== configuredUrl.toString()) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Payment Link identity, mode, active state, or URL mismatch");
}
const lineItems = paymentLink.line_items;
if (!lineItems || typeof lineItems !== "object" || Array.isArray(lineItems) || lineItems.object !== "list" ||
    lineItems.has_more !== false || !Array.isArray(lineItems.data) || lineItems.data.length !== 1) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exactly one fully expanded line item is required");
}
const lineItem = lineItems.data[0];
const price = lineItem?.price;
if (!lineItem || lineItem.object !== "item" || lineItem.quantity !== 1 || clean(lineItem.currency) !== "usd" ||
    lineItem.amount_subtotal !== 500000 || lineItem.amount_discount !== 0 || lineItem.amount_tax !== 0 ||
    lineItem.amount_total !== 500000 || !price || typeof price !== "object" || Array.isArray(price) ||
    price.object !== "price" || clean(price.id) !== expectedPriceId || price.livemode !== false ||
    price.active !== true ||
    clean(price.type) !== "one_time" || clean(price.currency) !== "usd" || price.unit_amount !== 500000 ||
    price.custom_unit_amount !== null || price.recurring !== null ||
    (lineItem.adjustable_quantity != null && lineItem.adjustable_quantity.enabled !== false)) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: line item does not match the exact one-time ARC Price");
}
const fields = Array.isArray(paymentLink.custom_fields) ? paymentLink.custom_fields : [];
const adultFields = fields.filter(field => field && typeof field === "object" && clean(field.key) === "adultpurchaserack");
const adultOptions = adultFields[0]?.dropdown?.options;
if (fields.length !== 1 || adultFields.length !== 1 || clean(adultFields[0].type) !== "dropdown" ||
    adultFields[0].optional !== false || clean(adultFields[0].label?.type) !== "custom" ||
    clean(adultFields[0].label?.custom) !== "I am 18+ and authorized to buy for this business" ||
    !Array.isArray(adultOptions) || adultOptions.length !== 1 || clean(adultOptions[0]?.label) !== "I confirm" ||
    clean(adultOptions[0]?.value) !== "accepted" || !/^[A-Za-z0-9]{1,200}$/.test(clean(adultFields[0].key)) ||
    !/^[A-Za-z0-9]{1,200}$/.test(clean(adultOptions[0]?.value))) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exact required adult acknowledgement dropdown");
}
if (clean(paymentLink.consent_collection?.terms_of_service) !== "required" ||
    clean(paymentLink.metadata?.terms_version) !== expectedTermsVersion ||
    clean(paymentLink.submit_type) !== "auto" ||
    paymentLink.name_collection?.business?.enabled !== true || paymentLink.name_collection?.business?.optional !== false ||
    paymentLink.name_collection?.individual?.enabled !== true || paymentLink.name_collection?.individual?.optional !== false ||
    paymentLink.automatic_tax?.enabled !== false || paymentLink.payment_method_types != null ||
    paymentLink.allow_promotion_codes !== false ||
    (Array.isArray(paymentLink.optional_items) ? paymentLink.optional_items.length !== 0 : paymentLink.optional_items != null) ||
    paymentLink.restrictions?.completed_sessions?.limit != null ||
    paymentLink.phone_number_collection?.enabled !== false || paymentLink.invoice_creation?.enabled !== false ||
    clean(paymentLink.customer_creation) !== "if_required" || clean(paymentLink.billing_address_collection) !== "auto" ||
    paymentLink.shipping_address_collection != null || paymentLink.tax_id_collection?.enabled !== false) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: consent, terms, names, tax, or dynamic-payment-method configuration");
}
const redirectUrl = clean(paymentLink.after_completion?.redirect?.url);
let redirect;
try {
  redirect = new URL(redirectUrl);
} catch (error) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: checkout redirect URL");
}
if (clean(paymentLink.after_completion?.type) !== "redirect" || redirectUrl !== expectedRedirectUrl ||
    redirect.username || redirect.password || redirect.hash ||
    [...redirect.searchParams.values()].filter(value => value === "{CHECKOUT_SESSION_ID}").length !== 1) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: redirect must exactly match the configured HTTPS URL and Checkout Session placeholder");
}
const configDigest = await sha256Hex(canonicalJson({
  payment_link_id: expectedPaymentLinkId,
  payment_link_url: configuredUrl.toString(),
  price_id: expectedPriceId,
  amount_total_minor_units: 500000,
  currency: "usd",
  quantity: 1,
  terms_version: expectedTermsVersion,
  adult_acknowledgement_key: "adultpurchaserack",
  name_collection_required: true,
  automatic_tax_enabled: false,
  submit_type: "auto",
  checkout_redirect_url: redirectUrl,
  stripe_api_version: "2026-06-24.dahlia"
}));
const issuedAt = new Date().toISOString();
const evidencePrivate = canonicalJson({
  version: "arc1-payment-link-evidence-v1",
  scope: "authoritative-stripe-test-payment-link-preflight",
  payment_link_id: expectedPaymentLinkId,
  payment_link_url: configuredUrl.toString(),
  price_id: expectedPriceId,
  amount_total_minor_units: 500000,
  currency: "usd",
  quantity: 1,
  terms_version: expectedTermsVersion,
  configuration_sha256: configDigest,
  issued_at: issuedAt
});
const evidenceKey = await globalThis.crypto.subtle.importKey(
  "raw", encoder.encode(evidenceSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
);
const signature = await globalThis.crypto.subtle.sign(
  "HMAC", evidenceKey, encoder.encode(`arc1-payment-link-evidence-signature-v1\n${evidencePrivate}`)
);
return {
  status: "PAYMENT_LINK_PREFLIGHT_VERIFIED",
  external_write_allowed_by_this_step: false,
  payment_link_url: configuredUrl.toString(),
  payment_link_id: expectedPaymentLinkId,
  price_id: expectedPriceId,
  payment_link_evidence_private: evidencePrivate,
  payment_link_evidence_sha256: await sha256Hex(evidencePrivate),
  payment_link_evidence_hmac_sha256: [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("")
};
