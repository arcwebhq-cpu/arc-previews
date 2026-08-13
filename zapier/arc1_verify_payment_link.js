// ARC1 payment-link preflight — retrieve the exact configured Stripe Payment Link
// before rendering a preview and issue short-lived signed configuration evidence.
// This step is read-only and never creates a Checkout Session or charge.
const clean = value => String(value == null ? "" : value).trim();
const stripeApiKey = clean(inputData.stripe_api_key || inputData.stripe_test_api_key);
const expectedPaymentLinkId = clean(inputData.expected_payment_link_id);
const expectedPriceId = clean(inputData.expected_price_id);
const expectedTermsVersion = clean(inputData.expected_terms_version);
const expectedPaymentLinkUrl = clean(inputData.expected_payment_link_url);
const evidenceSecret = clean(inputData.payment_link_evidence_secret);
const expectedRedirectUrl = clean(inputData.expected_checkout_redirect_url);
const expectedProductTaxCode = clean(inputData.expected_product_tax_code);
const expectedTaxRegistrationsJson = clean(inputData.expected_tax_registrations_json);
const expectedStripeAccountIdSha256 = clean(inputData.expected_stripe_account_id_sha256).toLowerCase();
const stripeLiveModeFlag = clean(inputData.stripe_live_mode_enabled).toLowerCase();
if (!["", "false", "true"].includes(stripeLiveModeFlag)) {
  throw new Error("ARC_STRIPE_MODE_INVALID: stripe_live_mode_enabled must be true or false");
}
const stripeLiveModeEnabled = stripeLiveModeFlag === "true";
const stripeMode = stripeLiveModeEnabled ? "live" : "test";
const requiredCheckoutRedirectUrl = "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}";
if (!new RegExp(`^(?:sk|rk)_${stripeMode}_[A-Za-z0-9_]{12,}$`).test(stripeApiKey)) {
  throw new Error(`ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe ${stripeMode} API key is required`);
}
if (!/^plink_[A-Za-z0-9]+$/.test(expectedPaymentLinkId) || !/^price_[A-Za-z0-9]+$/.test(expectedPriceId)) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exact Payment Link and Price ids are required");
}
if (!/^[a-f0-9]{64}$/.test(expectedStripeAccountIdSha256)) {
  throw new Error("ARC_STRIPE_ACCOUNT_INVALID: exact ARC Stripe account id SHA-256 is required");
}
if (!/^txcd_[0-9]{8}$/.test(expectedProductTaxCode)) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: a Stripe-canonical, advisor-confirmed product tax code is required");
}
let expectedTaxRegistrations;
try {
  expectedTaxRegistrations = JSON.parse(expectedTaxRegistrationsJson);
} catch (error) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: expected tax registrations JSON");
}
if (!Array.isArray(expectedTaxRegistrations) || expectedTaxRegistrations.length < 1 || expectedTaxRegistrations.length > 100) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: one to 100 expected active tax registrations are required");
}
const taxRegistrationFields = ["country", "id", "state", "type"];
for (const registration of expectedTaxRegistrations) {
  if (!registration || typeof registration !== "object" || Array.isArray(registration) ||
      JSON.stringify(Object.keys(registration).sort()) !== JSON.stringify(taxRegistrationFields) ||
      !/^taxreg_[A-Za-z0-9]+$/.test(clean(registration.id)) ||
      !/^[A-Z]{2}$/.test(clean(registration.country)) ||
      !/^[A-Z0-9-]{1,10}$/.test(clean(registration.state)) ||
      !/^[a-z][a-z0-9_]{2,63}$/.test(clean(registration.type))) {
    throw new Error("ARC_TAX_PREFLIGHT_INVALID: exact tax registration identity and jurisdiction are required");
  }
}
if (new Set(expectedTaxRegistrations.map(registration => clean(registration.id))).size !== expectedTaxRegistrations.length) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: duplicate expected tax registration");
}
if (!expectedTaxRegistrations.some(registration =>
  clean(registration.country) === "US" && clean(registration.state) === "WA" && clean(registration.type) === "state_sales_tax"
)) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: a verified Washington sales-tax registration is required");
}
if (expectedTermsVersion !== "2026-08-12") {
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
const paymentLinkPathMatchesMode = stripeLiveModeEnabled
  ? /^\/[A-Za-z0-9]+$/.test(configuredUrl.pathname) && !configuredUrl.pathname.startsWith("/test_")
  : /^\/test_[A-Za-z0-9]+$/.test(configuredUrl.pathname);
if (configuredUrl.origin !== "https://buy.stripe.com" || !paymentLinkPathMatchesMode ||
    configuredUrl.username || configuredUrl.password || configuredUrl.search || configuredUrl.hash ||
    expectedRedirect.protocol !== "https:" || expectedRedirect.username || expectedRedirect.password || expectedRedirect.hash ||
    !expectedRedirectUrl.includes("{CHECKOUT_SESSION_ID}") ||
    [...expectedRedirect.searchParams.values()].filter(value => value === "{CHECKOUT_SESSION_ID}").length !== 1) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exact mode-matched Payment Link and HTTPS redirect URL are required");
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
const equalHex = (first, second) => {
  if (!/^[a-f0-9]{64}$/.test(first) || !/^[a-f0-9]{64}$/.test(second)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
};
const stripeHeaders = {
  Accept: "application/json",
  Authorization: `Basic ${Buffer.from(`${stripeApiKey}:`, "utf8").toString("base64")}`,
  "Stripe-Version": "2026-06-24.dahlia"
};
const stripeGet = async resourceUrl => {
  const response = await fetch(resourceUrl, {
    method: "GET",
    headers: stripeHeaders,
    redirect: "error"
  });
  if (response.url && response.url !== resourceUrl) {
    throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe API redirect rejected");
  }
  if (!response.ok) {
    throw new Error(`ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe read failed (${response.status})`);
  }
  return response.json();
};
const resourceUrl = `https://api.stripe.com/v1/payment_links/${encodeURIComponent(expectedPaymentLinkId)}?expand%5B%5D=line_items.data.price.product`;
const accountUrl = "https://api.stripe.com/v1/account";
const taxSettingsUrl = "https://api.stripe.com/v1/tax/settings";
const account = await stripeGet(accountUrl);
const authenticatedStripeAccountId = clean(account?.id);
const stripeAccountIdSha256 = await sha256Hex(authenticatedStripeAccountId);
if (!account || typeof account !== "object" || Array.isArray(account) || account.object !== "account" ||
    !/^acct_[A-Za-z0-9]+$/.test(authenticatedStripeAccountId) ||
    !equalHex(stripeAccountIdSha256, expectedStripeAccountIdSha256)) {
  throw new Error("ARC_STRIPE_ACCOUNT_INVALID: authenticated Stripe account is not the configured ARC account");
}
const taxSettings = await stripeGet(taxSettingsUrl);
if (!taxSettings || typeof taxSettings !== "object" || Array.isArray(taxSettings) ||
    taxSettings.object !== "tax.settings" || taxSettings.livemode !== stripeLiveModeEnabled ||
    clean(taxSettings.status) !== "active" ||
    !/^[A-Z]{2}$/.test(clean(taxSettings.head_office?.address?.country))) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: Stripe Tax settings are not active for the configured account and mode");
}
const paymentLink = await stripeGet(resourceUrl);
if (!paymentLink || typeof paymentLink !== "object" || Array.isArray(paymentLink) ||
    paymentLink.object !== "payment_link" || clean(paymentLink.id) !== expectedPaymentLinkId ||
    paymentLink.livemode !== stripeLiveModeEnabled || paymentLink.active !== true || clean(paymentLink.url) !== configuredUrl.toString()) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Payment Link identity, mode, active state, or URL mismatch");
}
const lineItems = paymentLink.line_items;
if (!lineItems || typeof lineItems !== "object" || Array.isArray(lineItems) || lineItems.object !== "list" ||
    lineItems.has_more !== false || !Array.isArray(lineItems.data) || lineItems.data.length !== 1) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exactly one fully expanded line item is required");
}
const lineItem = lineItems.data[0];
const price = lineItem?.price;
const product = price?.product;
if (!lineItem || lineItem.object !== "item" || lineItem.quantity !== 1 || clean(lineItem.currency) !== "usd" ||
    lineItem.amount_subtotal !== 500000 || lineItem.amount_discount !== 0 || lineItem.amount_tax !== 0 ||
    lineItem.amount_total !== 500000 || !price || typeof price !== "object" || Array.isArray(price) ||
    price.object !== "price" || clean(price.id) !== expectedPriceId || price.livemode !== stripeLiveModeEnabled ||
    price.active !== true ||
    clean(price.type) !== "one_time" || clean(price.currency) !== "usd" || price.unit_amount !== 500000 ||
    price.custom_unit_amount !== null || price.recurring !== null || clean(price.tax_behavior) !== "exclusive" ||
    !product || typeof product !== "object" || Array.isArray(product) || product.object !== "product" ||
    !/^prod_[A-Za-z0-9]+$/.test(clean(product.id)) || product.livemode !== stripeLiveModeEnabled || product.active !== true ||
    clean(typeof product.tax_code === "object" ? product.tax_code?.id : product.tax_code) !== expectedProductTaxCode ||
    (lineItem.adjustable_quantity != null && lineItem.adjustable_quantity.enabled !== false)) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: line item does not match the exact exclusive-tax ARC Price and Product");
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
    clean(paymentLink.metadata?.tax_contract_version) !== "arc-tax-v1" ||
    clean(paymentLink.submit_type) !== "auto" ||
    paymentLink.name_collection?.business?.enabled !== true || paymentLink.name_collection?.business?.optional !== false ||
    paymentLink.name_collection?.individual?.enabled !== true || paymentLink.name_collection?.individual?.optional !== false ||
    paymentLink.automatic_tax?.enabled !== true || paymentLink.payment_method_types != null ||
    paymentLink.allow_promotion_codes !== false ||
    (Array.isArray(paymentLink.optional_items) ? paymentLink.optional_items.length !== 0 : paymentLink.optional_items != null) ||
    paymentLink.restrictions?.completed_sessions?.limit != null ||
    paymentLink.phone_number_collection?.enabled !== false || paymentLink.invoice_creation?.enabled !== false ||
    clean(paymentLink.customer_creation) !== "if_required" || clean(paymentLink.billing_address_collection) !== "auto" ||
    paymentLink.shipping_address_collection != null || paymentLink.tax_id_collection?.enabled !== false) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: consent, terms, names, tax, or dynamic-payment-method configuration");
}
const taxCodeUrl = `https://api.stripe.com/v1/tax_codes/${encodeURIComponent(expectedProductTaxCode)}`;
const taxCode = await stripeGet(taxCodeUrl);
if (!taxCode || typeof taxCode !== "object" || Array.isArray(taxCode) || taxCode.object !== "tax_code" ||
    clean(taxCode.id) !== expectedProductTaxCode) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: configured product tax code is not a canonical Stripe Tax code");
}
const registrationSnapshots = [];
for (const expected of expectedTaxRegistrations) {
  const registrationUrl = `https://api.stripe.com/v1/tax/registrations/${encodeURIComponent(clean(expected.id))}`;
  const registration = await stripeGet(registrationUrl);
  const activeFrom = registration?.active_from;
  const expiresAt = registration?.expires_at;
  const country = clean(registration?.country);
  const state = clean(registration?.country_options?.us?.state);
  const type = clean(registration?.country_options?.us?.type);
  if (!registration || typeof registration !== "object" || Array.isArray(registration) ||
      registration.object !== "tax.registration" || clean(registration.id) !== clean(expected.id) ||
      registration.livemode !== stripeLiveModeEnabled || clean(registration.status) !== "active" ||
      !Number.isSafeInteger(activeFrom) || activeFrom * 1000 > Date.now() + 5 * 60 * 1000 ||
      (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= Date.now())) ||
      country !== clean(expected.country) || state !== clean(expected.state) || type !== clean(expected.type)) {
    throw new Error("ARC_TAX_PREFLIGHT_INVALID: expected Stripe Tax registration is not active or its jurisdiction changed");
  }
  registrationSnapshots.push({
    id: clean(registration.id),
    country,
    state,
    type,
    active_from: activeFrom,
    expires_at: expiresAt
  });
}
registrationSnapshots.sort((first, second) => first.id.localeCompare(second.id));
const taxRegistrationsSha256 = await sha256Hex(canonicalJson(registrationSnapshots));
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
  stripe_account_id_sha256: stripeAccountIdSha256,
  livemode: stripeLiveModeEnabled,
  payment_link_url: configuredUrl.toString(),
  price_id: expectedPriceId,
  amount_subtotal_minor_units: 500000,
  currency: "usd",
  quantity: 1,
  terms_version: expectedTermsVersion,
  automatic_tax_enabled: true,
  customer_address_source: "stripe_checkout_customer_details.address",
  price_tax_behavior: "exclusive",
  product_tax_code: expectedProductTaxCode,
  tax_contract_version: "arc-tax-v1",
  tax_settings_status: "active",
  tax_registrations_sha256: taxRegistrationsSha256,
  adult_acknowledgement_key: "adultpurchaserack",
  name_collection_required: true,
  submit_type: "auto",
  checkout_redirect_url: redirectUrl,
  stripe_api_version: "2026-06-24.dahlia"
}));
const issuedAt = new Date().toISOString();
const evidencePrivate = canonicalJson({
  version: "arc1-payment-link-evidence-v2",
  scope: "authoritative-stripe-payment-link-preflight",
  payment_link_id: expectedPaymentLinkId,
  stripe_account_id_sha256: stripeAccountIdSha256,
  payment_link_url: configuredUrl.toString(),
  price_id: expectedPriceId,
  livemode: stripeLiveModeEnabled,
  amount_subtotal_minor_units: 500000,
  currency: "usd",
  quantity: 1,
  terms_version: expectedTermsVersion,
  automatic_tax_enabled: true,
  customer_address_source: "stripe_checkout_customer_details.address",
  price_tax_behavior: "exclusive",
  product_tax_code: expectedProductTaxCode,
  tax_contract_version: "arc-tax-v1",
  tax_settings_status: "active",
  tax_registrations_sha256: taxRegistrationsSha256,
  configuration_sha256: configDigest,
  issued_at: issuedAt
});
const evidenceKey = await globalThis.crypto.subtle.importKey(
  "raw", encoder.encode(evidenceSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
);
const signature = await globalThis.crypto.subtle.sign(
  "HMAC", evidenceKey, encoder.encode(`arc1-payment-link-evidence-signature-v2\n${evidencePrivate}`)
);
return {
  status: "PAYMENT_LINK_PREFLIGHT_VERIFIED",
  external_write_allowed_by_this_step: false,
  payment_link_url: configuredUrl.toString(),
  payment_link_id: expectedPaymentLinkId,
  price_id: expectedPriceId,
  stripe_account_id_sha256: stripeAccountIdSha256,
  livemode: stripeLiveModeEnabled,
  product_tax_code: expectedProductTaxCode,
  tax_settings_status: "active",
  tax_registrations_sha256: taxRegistrationsSha256,
  payment_link_evidence_private: evidencePrivate,
  payment_link_evidence_sha256: await sha256Hex(evidencePrivate),
  payment_link_evidence_hmac_sha256: [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("")
};
