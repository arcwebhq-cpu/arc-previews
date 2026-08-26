import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc1_verify_payment_link.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runPreflight = new AsyncFunction("inputData", "fetch", "Buffer", source);
const sha = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object"
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);

const priceId = "price_1ArcV10Test5000";
const productId = "prod_ArcWebsiteService";
const productTaxCode = "txcd_12345678";
const registrationId = "taxreg_ArcWashingtonTest";
const accountId = "acct_ArcBusinessTest";
const termsVersion = "2026-08-25";
const termsDocumentSha256 = sha("immutable ARC terms test document");
const redirect = "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}";
const registration = { country: "US", id: registrationId, state: "WA", type: "state_sales_tax" };
const input = {
  stripe_test_api_key: "rk_test_arc_offer_preflight_1234567890",
  expected_price_id: priceId,
  expected_terms_version: termsVersion,
  expected_terms_document_sha256: termsDocumentSha256,
  retained_terms_documents_json: canonical({ [termsVersion]: termsDocumentSha256 }),
  expected_checkout_redirect_url: redirect,
  expected_product_tax_code: productTaxCode,
  expected_tax_registrations_json: JSON.stringify([registration]),
  expected_stripe_account_id_sha256: sha(accountId),
  stripe_live_mode_enabled: "false",
  payment_link_evidence_secret: "arc-test-offer-evidence-secret-32-bytes-minimum"
};
const urls = {
  account: "https://api.stripe.com/v1/account",
  settings: "https://api.stripe.com/v1/tax/settings",
  price: `https://api.stripe.com/v1/prices/${priceId}?expand%5B%5D=product`,
  taxCode: `https://api.stripe.com/v1/tax_codes/${productTaxCode}`,
  registration: `https://api.stripe.com/v1/tax/registrations/${registrationId}`
};
const product = { object: "product", id: productId, livemode: false, active: true, tax_code: productTaxCode };
const price = { object: "price", id: priceId, livemode: false, active: true, type: "one_time", currency: "usd", unit_amount: 500000,
  custom_unit_amount: null, recurring: null, tax_behavior: "exclusive", product };
const payloads = {
  [urls.account]: { object: "account", id: accountId },
  [urls.settings]: { object: "tax.settings", livemode: false, status: "active", head_office: { address: { country: "US" } } },
  [urls.price]: price,
  [urls.taxCode]: { object: "tax_code", id: productTaxCode },
  [urls.registration]: { object: "tax.registration", id: registrationId, livemode: false, status: "active",
    active_from: Math.floor(Date.now() / 1000) - 3600, expires_at: null, country: "US", country_options: { us: { state: "WA", type: "state_sales_tax" } } }
};
const run = async (overrides = {}, mutate = {}) => runPreflight({ ...input, ...overrides }, async (url, options = {}) => {
  assert.equal(options.method, "GET");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers?.["Stripe-Version"], "2026-07-29.dahlia");
  assert.ok(Object.hasOwn(payloads, url), `unexpected Stripe resource ${url}`);
  const payload = Object.hasOwn(mutate, url) ? mutate[url] : payloads[url];
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}, Buffer);

const verified = await run();
assert.equal(verified.status, "PRIVATE_CHECKOUT_OFFER_TEMPLATE_VERIFIED");
assert.equal(verified.external_write_allowed_by_this_step, false);
assert.equal(Object.hasOwn(verified, "payment_link_url"), false);
assert.equal(Object.hasOwn(verified, "payment_link_id"), false);
const evidence = JSON.parse(verified.payment_link_evidence_private);
assert.equal(evidence.version, "arc1-checkout-offer-template-evidence-v1");
assert.equal(evidence.scope, "authoritative-private-checkout-offer-template-preflight");
assert.equal(evidence.price_id, priceId);
assert.equal(evidence.product_id, productId);
assert.equal(evidence.terms_document_sha256, termsDocumentSha256);
assert.equal(evidence.terms_version, "2026-08-25");
assert.equal(evidence.stripe_api_version, "2026-07-29.dahlia");
assert.doesNotMatch(verified.payment_link_evidence_private, /buy\.stripe\.com|\bplink_/i);
assert.match(verified.payment_link_evidence_sha256, /^[a-f0-9]{64}$/);
assert.match(verified.payment_link_evidence_hmac_sha256, /^[a-f0-9]{64}$/);

await assert.rejects(run({}, { [urls.account]: { object: "account", id: "acct_Wrong" } }), /configured ARC account/);
await assert.rejects(run({}, { [urls.settings]: { ...payloads[urls.settings], status: "pending" } }), /Tax settings are not active/);
await assert.rejects(run({}, { [urls.price]: { ...price, active: false } }), /Price and Product/);
await assert.rejects(run({}, { [urls.price]: { ...price, product: { ...product, tax_code: "txcd_87654321" } } }), /Price and Product/);
await assert.rejects(run({}, { [urls.registration]: { ...payloads[urls.registration], expires_at: Math.floor(Date.now() / 1000) - 1 } }), /registration is not active/);
await assert.rejects(run({ retained_terms_documents_json: canonical({ [termsVersion]: "0".repeat(64) }) }), /terms document registry mismatch/);
await assert.rejects(run({ expected_terms_version: "2026-08-12", retained_terms_documents_json: canonical({ "2026-08-12": termsDocumentSha256 }) }), /terms document registry mismatch/);
await assert.rejects(run({ expected_checkout_redirect_url: "https://attacker.example/?session_id={CHECKOUT_SESSION_ID}" }), /static ARC payment-success URL/);
await assert.rejects(run({ stripe_live_mode_enabled: "true", stripe_test_api_key: input.stripe_test_api_key }), /Stripe live API key/);

await assert.rejects(runPreflight(input, async url => new Response(JSON.stringify(payloads[url]), {
  status: 200, headers: { "content-length": "9000000", "content-type": "application/json" }
}), Buffer), /response too large/);
await assert.rejects(runPreflight({ ...input, provider_operation_timeout_ms: "25" }, async () => {
  await new Promise(resolve => setTimeout(resolve, 40));
  return new Response("{}", { status: 200 });
}, Buffer), /bounded timeout|operation deadline/);

console.log("ARC1 signed checkout-offer template preflight contract passed (no reusable Payment Link capability).");
