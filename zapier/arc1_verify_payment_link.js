// ARC1 checkout-offer template preflight — authenticate the account, Price,
// Product, tax and terms facts. It never reads or exposes a reusable Payment
// Link; a separate default-off post-approval step creates the private one-use Link.
const clean = value => String(value == null ? "" : value).trim();
const stripeApiKey = clean(inputData.stripe_api_key || inputData.stripe_test_api_key);
const expectedPriceId = clean(inputData.expected_price_id);
const expectedTermsVersion = clean(inputData.expected_terms_version);
const expectedTermsDocumentSha256 = clean(inputData.expected_terms_document_sha256).toLowerCase();
const retainedTermsDocumentsJson = clean(inputData.retained_terms_documents_json);
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
const requiredTermsVersion = "2026-08-25";
const stripeApiVersion = "2026-07-29.dahlia";
const requiredCheckoutRedirectUrl = "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}";
if (!new RegExp(`^(?:sk|rk)_${stripeMode}_[A-Za-z0-9_]{12,}$`).test(stripeApiKey)) {
  throw new Error(`ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe ${stripeMode} API key is required`);
}
if (!/^price_[A-Za-z0-9]+$/.test(expectedPriceId)) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exact Price id is required");
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
let retainedTermsDocuments;
try { retainedTermsDocuments = JSON.parse(retainedTermsDocumentsJson); } catch {}
if (expectedTermsVersion !== requiredTermsVersion || !/^[a-f0-9]{64}$/.test(expectedTermsDocumentSha256) ||
    !retainedTermsDocuments || typeof retainedTermsDocuments !== "object" || Array.isArray(retainedTermsDocuments) ||
    JSON.stringify(Object.fromEntries(Object.entries(retainedTermsDocuments).sort(([a],[b])=>a<b?-1:a>b?1:0))) !== retainedTermsDocumentsJson || Object.keys(retainedTermsDocuments).length < 1 ||
    Object.keys(retainedTermsDocuments).length > 32 || Object.entries(retainedTermsDocuments).some(([version,digest]) =>
      !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(version) || !/^[a-f0-9]{64}$/.test(digest)) ||
    retainedTermsDocuments[expectedTermsVersion] !== expectedTermsDocumentSha256) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: retained immutable terms document registry mismatch");
}
if (expectedRedirectUrl !== requiredCheckoutRedirectUrl) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: checkout redirect must match the static ARC payment-success URL");
}
let expectedRedirect;
try {
  expectedRedirect = new URL(expectedRedirectUrl);
} catch (error) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: configured URL");
}
if (expectedRedirect.protocol !== "https:" || expectedRedirect.username || expectedRedirect.password || expectedRedirect.hash ||
    !expectedRedirectUrl.includes("{CHECKOUT_SESSION_ID}") ||
    [...expectedRedirect.searchParams.values()].filter(value => value === "{CHECKOUT_SESSION_ID}").length !== 1) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: exact HTTPS redirect URL is required");
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
  "Stripe-Version": stripeApiVersion
};
const requestedOperationTimeout=clean(inputData.provider_operation_timeout_ms),operationTimeoutMs=requestedOperationTimeout?Number(requestedOperationTimeout):20_000;
if(!Number.isSafeInteger(operationTimeoutMs)||operationTimeoutMs<25||operationTimeoutMs>25_000)throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: provider deadline");
const operationDeadline=Date.now()+operationTimeoutMs;
const endpointCaps={account:128_000,tax_settings:128_000,price:512_000,tax_code:128_000,registration:256_000};
const stripeGet = async (resourceUrl,maximumBytes) => {
  const remaining=Math.floor(operationDeadline-Date.now());if(remaining<=0)throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: provider operation deadline exceeded");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(10_000,remaining));let reader;
  try{
    const response=await fetch(resourceUrl,{method:"GET",headers:stripeHeaders,redirect:"error",signal:controller.signal});
    if(Date.now()>=operationDeadline)throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: provider operation deadline exceeded");
    if(response.url&&response.url!==resourceUrl)throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe API redirect rejected");
    if(!response.ok)throw new Error(`ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe read failed (${response.status})`);
    const declared=response.headers?.get?.("content-length");if(declared&&(!/^\d{1,9}$/.test(declared)||Number(declared)>maximumBytes))throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe response too large");
    reader=response.body?.getReader?.();if(!reader)throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: streaming Stripe response required");
    let total=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: invalid Stripe response chunk");total+=value.byteLength;if(total>maximumBytes){try{await reader.cancel();}catch{}throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe response too large");}chunks.push(Buffer.from(value));}
    try{return JSON.parse(Buffer.concat(chunks,total).toString("utf8"));}catch{throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe response JSON");}
  }catch(error){if(error?.name==="AbortError")throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Stripe bounded timeout");throw error;}finally{clearTimeout(timer);try{reader?.releaseLock?.();}catch{}}
};
const resourceUrl = `https://api.stripe.com/v1/prices/${encodeURIComponent(expectedPriceId)}?expand%5B%5D=product`;
const accountUrl = "https://api.stripe.com/v1/account";
const taxSettingsUrl = "https://api.stripe.com/v1/tax/settings";
const account = await stripeGet(accountUrl,endpointCaps.account);
const authenticatedStripeAccountId = clean(account?.id);
const stripeAccountIdSha256 = await sha256Hex(authenticatedStripeAccountId);
if (!account || typeof account !== "object" || Array.isArray(account) || account.object !== "account" ||
    !/^acct_[A-Za-z0-9]+$/.test(authenticatedStripeAccountId) ||
    !equalHex(stripeAccountIdSha256, expectedStripeAccountIdSha256)) {
  throw new Error("ARC_STRIPE_ACCOUNT_INVALID: authenticated Stripe account is not the configured ARC account");
}
const taxSettings = await stripeGet(taxSettingsUrl,endpointCaps.tax_settings);
if (!taxSettings || typeof taxSettings !== "object" || Array.isArray(taxSettings) ||
    taxSettings.object !== "tax.settings" || taxSettings.livemode !== stripeLiveModeEnabled ||
    clean(taxSettings.status) !== "active" ||
    !/^[A-Z]{2}$/.test(clean(taxSettings.head_office?.address?.country))) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: Stripe Tax settings are not active for the configured account and mode");
}
const price = await stripeGet(resourceUrl,endpointCaps.price);
const product = price?.product;
if (!price || typeof price !== "object" || Array.isArray(price) ||
    price.object !== "price" || clean(price.id) !== expectedPriceId || price.livemode !== stripeLiveModeEnabled ||
    price.active !== true ||
    clean(price.type) !== "one_time" || clean(price.currency) !== "usd" || price.unit_amount !== 500000 ||
    price.custom_unit_amount !== null || price.recurring !== null || clean(price.tax_behavior) !== "exclusive" ||
    !product || typeof product !== "object" || Array.isArray(product) || product.object !== "product" ||
    !/^prod_[A-Za-z0-9]+$/.test(clean(product.id)) || product.livemode !== stripeLiveModeEnabled || product.active !== true ||
    clean(typeof product.tax_code === "object" ? product.tax_code?.id : product.tax_code) !== expectedProductTaxCode) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: Price and Product do not match the exact private checkout offer template");
}
const taxCodeUrl = `https://api.stripe.com/v1/tax_codes/${encodeURIComponent(expectedProductTaxCode)}`;
const taxCode = await stripeGet(taxCodeUrl,endpointCaps.tax_code);
if (!taxCode || typeof taxCode !== "object" || Array.isArray(taxCode) || taxCode.object !== "tax_code" ||
    clean(taxCode.id) !== expectedProductTaxCode) {
  throw new Error("ARC_TAX_PREFLIGHT_INVALID: configured product tax code is not a canonical Stripe Tax code");
}
// Provider lifecycle timestamps are checked on every read but deliberately do
// not enter the immutable checkout configuration. That makes retries stable
// while still failing closed when a registration is no longer active.
const registrationSnapshots = [];
for (const expected of expectedTaxRegistrations) {
  const registrationUrl = `https://api.stripe.com/v1/tax/registrations/${encodeURIComponent(clean(expected.id))}`;
  const registration = await stripeGet(registrationUrl,endpointCaps.registration);
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
  registrationSnapshots.push({ id: clean(registration.id), country, state, type });
}
registrationSnapshots.sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
const taxRegistrationsSha256 = await sha256Hex(canonicalJson(registrationSnapshots));
const redirectUrl = expectedRedirectUrl;
let redirect;
try {
  redirect = new URL(redirectUrl);
} catch (error) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: checkout redirect URL");
}
if (redirectUrl !== expectedRedirectUrl || redirect.username || redirect.password || redirect.hash ||
    [...redirect.searchParams.values()].filter(value => value === "{CHECKOUT_SESSION_ID}").length !== 1) {
  throw new Error("ARC_PAYMENT_LINK_PREFLIGHT_INVALID: redirect must exactly match the configured HTTPS URL and Checkout Session placeholder");
}
const configDigest = await sha256Hex(canonicalJson({
  stripe_account_id_sha256: stripeAccountIdSha256,
  livemode: stripeLiveModeEnabled,
  price_id: expectedPriceId,
  product_id: clean(product.id),
  amount_subtotal_minor_units: 500000,
  currency: "usd",
  quantity: 1,
    terms_version: expectedTermsVersion,
    terms_document_sha256: expectedTermsDocumentSha256,
  automatic_tax_enabled: true,
  customer_address_source: "stripe_checkout_customer_details.address",
  price_tax_behavior: "exclusive",
  product_tax_code: expectedProductTaxCode,
  tax_contract_version: "arc-tax-v1",
  tax_settings_status: "active",
  tax_registrations: registrationSnapshots,
  tax_registrations_sha256: taxRegistrationsSha256,
  adult_acknowledgement_key: "adultpurchaserack",
  name_collection_required: true,
  submit_type: "auto",
  checkout_redirect_url: redirectUrl,
  stripe_api_version: stripeApiVersion
}));
const issuedAt = new Date().toISOString();
const evidencePrivate = canonicalJson({
  version: "arc1-checkout-offer-template-evidence-v1",
  scope: "authoritative-private-checkout-offer-template-preflight",
  stripe_account_id_sha256: stripeAccountIdSha256,
  price_id: expectedPriceId,
  product_id: clean(product.id),
  livemode: stripeLiveModeEnabled,
  amount_subtotal_minor_units: 500000,
  currency: "usd",
  quantity: 1,
  terms_version: expectedTermsVersion,
  terms_document_sha256: expectedTermsDocumentSha256,
  automatic_tax_enabled: true,
  customer_address_source: "stripe_checkout_customer_details.address",
  price_tax_behavior: "exclusive",
  product_tax_code: expectedProductTaxCode,
  tax_contract_version: "arc-tax-v1",
  tax_settings_status: "active",
  tax_registrations: registrationSnapshots,
  tax_registrations_sha256: taxRegistrationsSha256,
  adult_acknowledgement_key: "adultpurchaserack",
  name_collection_required: true,
  submit_type: "auto",
  checkout_redirect_url: redirectUrl,
  stripe_api_version: stripeApiVersion,
  configuration_sha256: configDigest,
  issued_at: issuedAt
});
const evidenceKey = await globalThis.crypto.subtle.importKey(
  "raw", encoder.encode(evidenceSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
);
const signature = await globalThis.crypto.subtle.sign(
  "HMAC", evidenceKey, encoder.encode(`arc1-checkout-offer-template-evidence-signature-v1\n${evidencePrivate}`)
);
return {
  status: "PRIVATE_CHECKOUT_OFFER_TEMPLATE_VERIFIED",
  external_write_allowed_by_this_step: false,
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
