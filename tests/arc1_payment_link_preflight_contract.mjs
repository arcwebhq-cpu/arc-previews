import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc1_verify_payment_link.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runPreflight = new AsyncFunction("inputData", "fetch", "Buffer", source);
const paymentLinkId = "plink_1ArcV10Test5000";
const priceId = "price_1ArcV10Test5000";
const paymentLinkUrl = "https://buy.stripe.com/test_00000000000000";
const checkoutRedirectUrl = "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}";
const evidenceSecret = "arc-test-payment-link-evidence-secret-32-bytes-minimum";
const productTaxCode = "txcd_12345678";
const taxRegistrationId = "taxreg_ArcWashingtonTest";
const stripeAccountId = "acct_ArcBusinessTest";
const stripeAccountIdSha256 = createHash("sha256").update(stripeAccountId).digest("hex");
const expectedTaxRegistrations = [{
  country: "US",
  id: taxRegistrationId,
  state: "WA",
  type: "state_sales_tax"
}];
const apiUrl = `https://api.stripe.com/v1/payment_links/${paymentLinkId}?expand%5B%5D=line_items.data.price.product`;
const taxCodeUrl = `https://api.stripe.com/v1/tax_codes/${productTaxCode}`;
const taxRegistrationUrl = `https://api.stripe.com/v1/tax/registrations/${taxRegistrationId}`;
const accountUrl = "https://api.stripe.com/v1/account";
const taxSettingsUrl = "https://api.stripe.com/v1/tax/settings";
const lineItem = {
  object: "item",
  quantity: 1,
  currency: "usd",
  amount_subtotal: 500000,
  amount_discount: 0,
  amount_tax: 0,
  amount_total: 500000,
  adjustable_quantity: { enabled: false },
  price: {
    object: "price",
    id: priceId,
    livemode: false,
    active: true,
    type: "one_time",
    currency: "usd",
    unit_amount: 500000,
    custom_unit_amount: null,
    recurring: null,
    tax_behavior: "exclusive",
    product: {
      object: "product",
      id: "prod_ArcWebsiteService",
      livemode: false,
      active: true,
      tax_code: productTaxCode
    }
  }
};
const exactPaymentLink = {
  object: "payment_link",
  id: paymentLinkId,
  livemode: false,
  active: true,
  url: paymentLinkUrl,
  line_items: { object: "list", has_more: false, data: [lineItem] },
  custom_fields: [{
    key: "adultpurchaserack",
    type: "dropdown",
    optional: false,
    label: { type: "custom", custom: "I am 18+ and authorized to buy for this business" },
    dropdown: { options: [{ label: "I confirm", value: "accepted" }] }
  }],
  consent_collection: { terms_of_service: "required" },
  metadata: { terms_version: "2026-08-12", tax_contract_version: "arc-tax-v1" },
  submit_type: "auto",
  name_collection: {
    business: { enabled: true, optional: false },
    individual: { enabled: true, optional: false }
  },
  automatic_tax: { enabled: true },
  payment_method_types: null,
  allow_promotion_codes: false,
  optional_items: [],
  restrictions: { completed_sessions: null },
  phone_number_collection: { enabled: false },
  invoice_creation: { enabled: false },
  customer_creation: "if_required",
  billing_address_collection: "auto",
  shipping_address_collection: null,
  tax_id_collection: { enabled: false },
  after_completion: {
    type: "redirect",
    redirect: { url: checkoutRedirectUrl }
  }
};
const input = {
  stripe_test_api_key: "rk_test_arc_payment_link_read_1234567890",
  expected_payment_link_id: paymentLinkId,
  expected_price_id: priceId,
  expected_terms_version: "2026-08-12",
  expected_payment_link_url: paymentLinkUrl,
  expected_checkout_redirect_url: checkoutRedirectUrl,
  expected_product_tax_code: productTaxCode,
  expected_tax_registrations_json: JSON.stringify(expectedTaxRegistrations),
  expected_stripe_account_id_sha256: stripeAccountIdSha256,
  stripe_live_mode_enabled: "false",
  payment_link_evidence_secret: evidenceSecret
};
const exactTaxSettings = {
  object: "tax.settings",
  livemode: false,
  status: "active",
  head_office: { address: { country: "US" } }
};
const run = async (paymentLink = exactPaymentLink, inputOverride = {}, taxSettings = exactTaxSettings) => runPreflight(
  { ...input, ...inputOverride },
  async (url, options = {}) => {
    assert.ok([accountUrl, taxSettingsUrl, apiUrl, taxCodeUrl, taxRegistrationUrl].includes(url));
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers?.["Stripe-Version"], "2026-06-24.dahlia");
    const payload = url === accountUrl
      ? { object: "account", id: stripeAccountId }
      : url === taxSettingsUrl
      ? taxSettings
      : url === apiUrl
      ? paymentLink
      : url === taxCodeUrl
        ? { object: "tax_code", id: productTaxCode }
        : {
            object: "tax.registration",
            id: taxRegistrationId,
            livemode: false,
            status: "active",
            active_from: Math.floor(Date.now() / 1000) - 3600,
            expires_at: null,
            country: "US",
            country_options: { us: { state: "WA", type: "state_sales_tax" } }
          };
    return { ok: true, status: 200, url, json: async () => payload };
  },
  Buffer
);

const verified = await run();
assert.equal(verified.status, "PAYMENT_LINK_PREFLIGHT_VERIFIED");
assert.equal(verified.external_write_allowed_by_this_step, false);
assert.equal(verified.payment_link_url, paymentLinkUrl);
assert.match(verified.payment_link_evidence_sha256, /^[a-f0-9]{64}$/);
assert.match(verified.payment_link_evidence_hmac_sha256, /^[a-f0-9]{64}$/);
const evidence = JSON.parse(verified.payment_link_evidence_private);
assert.deepEqual(Object.keys(evidence).sort(), [
  "version", "scope", "payment_link_id", "payment_link_url", "price_id", "amount_subtotal_minor_units",
  "stripe_account_id_sha256", "livemode",
  "currency", "quantity", "terms_version", "automatic_tax_enabled", "customer_address_source",
  "price_tax_behavior", "product_tax_code", "tax_contract_version", "tax_settings_status", "tax_registrations_sha256",
  "configuration_sha256", "issued_at"
].sort());
assert.equal(evidence.price_id, priceId);
assert.equal(evidence.stripe_account_id_sha256, stripeAccountIdSha256);
assert.equal(evidence.livemode, false);
assert.equal(evidence.automatic_tax_enabled, true);
assert.equal(evidence.product_tax_code, productTaxCode);
assert.equal(evidence.tax_settings_status, "active");
assert.match(evidence.tax_registrations_sha256, /^[a-f0-9]{64}$/);

await assert.rejects(run(exactPaymentLink, {}, { ...exactTaxSettings, status: "pending" }), /Tax settings are not active/);

await assert.rejects(run({ ...exactPaymentLink, active: false }), /identity, mode, active state/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: true, data: [lineItem] } }), /exactly one fully expanded line item/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, quantity: 2 }] } }), /exclusive-tax ARC Price/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, price: { ...lineItem.price, active: false } }] } }), /exclusive-tax ARC Price/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, adjustable_quantity: { enabled: true } }] } }), /exclusive-tax ARC Price/);
await assert.rejects(run({ ...exactPaymentLink, custom_fields: [{ ...exactPaymentLink.custom_fields[0], key: "adult_purchaser_ack" }] }), /adult acknowledgement dropdown/);
await assert.rejects(run({ ...exactPaymentLink, custom_fields: [{ ...exactPaymentLink.custom_fields[0], label: { type: "system", custom: "I am 18+ and authorized to buy for this business" } }] }), /adult acknowledgement dropdown/);
await assert.rejects(run({ ...exactPaymentLink, submit_type: "pay" }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, name_collection: { ...exactPaymentLink.name_collection, business: { enabled: false, optional: false } } }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, automatic_tax: { enabled: false } }), /consent, terms, names, tax/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, price: { ...lineItem.price, tax_behavior: "inclusive" } }] } }), /exclusive-tax ARC Price/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, price: { ...lineItem.price, product: { ...lineItem.price.product, tax_code: "txcd_87654321" } } }] } }), /exclusive-tax ARC Price/);
const dynamicMethodsAbsent = { ...exactPaymentLink };
delete dynamicMethodsAbsent.payment_method_types;
assert.equal((await run(dynamicMethodsAbsent)).status, "PAYMENT_LINK_PREFLIGHT_VERIFIED");
await assert.rejects(run({ ...exactPaymentLink, payment_method_types: ["card"] }), /dynamic-payment-method/);
await assert.rejects(run({ ...exactPaymentLink, allow_promotion_codes: true }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, optional_items: [{ price: "price_extra", quantity: 1 }] }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, restrictions: { completed_sessions: { limit: 1 } } }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, phone_number_collection: { enabled: true } }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, invoice_creation: { enabled: true } }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, customer_creation: "always" }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, billing_address_collection: "required" }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, shipping_address_collection: { allowed_countries: ["US"] } }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, tax_id_collection: { enabled: true } }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, after_completion: { type: "hosted_confirmation" } }), /checkout redirect URL/);
await assert.rejects(run({ ...exactPaymentLink, after_completion: { type: "redirect", redirect: { url: "https://arcweb.onl/other/?session_id={CHECKOUT_SESSION_ID}" } } }), /exactly match the configured HTTPS URL/);
await assert.rejects(run(exactPaymentLink, { expected_checkout_redirect_url: "https://attacker.example/payment-success/?session_id={CHECKOUT_SESSION_ID}" }), /static ARC payment-success URL/);
await assert.rejects(run(exactPaymentLink, { expected_price_id: "" }), /exact Payment Link and Price ids/);
await assert.rejects(run(exactPaymentLink, { expected_product_tax_code: "" }), /product tax code/);
await assert.rejects(run(exactPaymentLink, { expected_stripe_account_id_sha256: "0".repeat(64) }), /not the configured ARC account/);
await assert.rejects(run(exactPaymentLink, { expected_tax_registrations_json: "[]" }), /active tax registrations/);
await assert.rejects(run(exactPaymentLink, {
  expected_tax_registrations_json: JSON.stringify([{ ...expectedTaxRegistrations[0], state: "OR" }])
}), /Washington sales-tax registration/);

console.log("ARC1 signed Stripe Payment Link preflight contract passed");
