import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc1_verify_payment_link.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runPreflight = new AsyncFunction("inputData", "fetch", "Buffer", source);
const paymentLinkId = "plink_1ArcV10Test5000";
const priceId = "price_1ArcV10Test5000";
const paymentLinkUrl = "https://buy.stripe.com/test_00000000000000";
const checkoutRedirectUrl = "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}";
const evidenceSecret = "arc-test-payment-link-evidence-secret-32-bytes-minimum";
const apiUrl = `https://api.stripe.com/v1/payment_links/${paymentLinkId}?expand%5B%5D=line_items.data.price`;
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
    recurring: null
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
  metadata: { terms_version: "2026-08-11" },
  submit_type: "auto",
  name_collection: {
    business: { enabled: true, optional: false },
    individual: { enabled: true, optional: false }
  },
  automatic_tax: { enabled: false },
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
  expected_terms_version: "2026-08-11",
  expected_payment_link_url: paymentLinkUrl,
  expected_checkout_redirect_url: checkoutRedirectUrl,
  payment_link_evidence_secret: evidenceSecret
};
const run = async (paymentLink = exactPaymentLink, inputOverride = {}) => runPreflight(
  { ...input, ...inputOverride },
  async (url, options = {}) => {
    assert.equal(url, apiUrl);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers?.["Stripe-Version"], "2026-06-24.dahlia");
    return { ok: true, status: 200, url, json: async () => paymentLink };
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
  "version", "scope", "payment_link_id", "payment_link_url", "price_id", "amount_total_minor_units",
  "currency", "quantity", "terms_version", "configuration_sha256", "issued_at"
].sort());
assert.equal(evidence.price_id, priceId);

await assert.rejects(run({ ...exactPaymentLink, active: false }), /identity, mode, active state/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: true, data: [lineItem] } }), /exactly one fully expanded line item/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, quantity: 2 }] } }), /exact one-time ARC Price/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, price: { ...lineItem.price, active: false } }] } }), /exact one-time ARC Price/);
await assert.rejects(run({ ...exactPaymentLink, line_items: { object: "list", has_more: false, data: [{ ...lineItem, adjustable_quantity: { enabled: true } }] } }), /exact one-time ARC Price/);
await assert.rejects(run({ ...exactPaymentLink, custom_fields: [{ ...exactPaymentLink.custom_fields[0], key: "adult_purchaser_ack" }] }), /adult acknowledgement dropdown/);
await assert.rejects(run({ ...exactPaymentLink, custom_fields: [{ ...exactPaymentLink.custom_fields[0], label: { type: "system", custom: "I am 18+ and authorized to buy for this business" } }] }), /adult acknowledgement dropdown/);
await assert.rejects(run({ ...exactPaymentLink, submit_type: "pay" }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, name_collection: { ...exactPaymentLink.name_collection, business: { enabled: false, optional: false } } }), /consent, terms, names/);
await assert.rejects(run({ ...exactPaymentLink, automatic_tax: { enabled: true } }), /consent, terms, names, tax/);
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

console.log("ARC1 signed Stripe Payment Link preflight contract passed");
