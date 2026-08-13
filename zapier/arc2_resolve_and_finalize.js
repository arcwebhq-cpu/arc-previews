// ARC2 Code step — retrieve the authoritative configured-mode Stripe Checkout Session,
// resolve the exact approved preview, finalize it, and prepare one signed
// root-only Netlify claimable-deploy bundle. This step never creates a site,
// repository, claim invitation, or email.
const clean = value => String(value == null ? "" : value).trim();
const sessionId = clean(inputData.checkout_session_id || inputData.session_id);
const stripeApiKey = clean(inputData.stripe_api_key || inputData.stripe_test_api_key);
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const handoffArtifactEvidenceSecret = clean(inputData.handoff_artifact_evidence_secret);
const expectedPaymentLinkId = clean(inputData.expected_payment_link_id);
const expectedPriceId = clean(inputData.expected_price_id);
const expectedProductTaxCode = clean(inputData.expected_product_tax_code);
const expectedTaxRegistrationsJson = clean(inputData.expected_tax_registrations_json);
const expectedStripeAccountIdSha256 = clean(inputData.expected_stripe_account_id_sha256).toLowerCase();
const stripeLiveModeFlag = clean(inputData.stripe_live_mode_enabled).toLowerCase();
if (!["", "false", "true"].includes(stripeLiveModeFlag)) throw new Error("ARC_STRIPE_MODE_INVALID: stripe_live_mode_enabled must be true or false");
const stripeLiveModeEnabled = stripeLiveModeFlag === "true";
const stripeMode = stripeLiveModeEnabled ? "live" : "test";
const expectedTermsVersion = "2026-08-12";
const owner = clean(inputData.preview_source_github_owner || inputData.github_owner);
const repository = clean(inputData.preview_source_github_repo || inputData.github_repo);
const branch = clean(inputData.preview_source_github_branch || inputData.github_branch || "main");
const token = clean(inputData.github_token);
if (!new RegExp(`^cs_${stripeMode}_[A-Za-z0-9_]+$`).test(sessionId)) throw new Error(`ARC_PAYMENT_INVALID: ${stripeMode} checkout session id`);
if (!new RegExp(`^(?:sk|rk)_${stripeMode}_[A-Za-z0-9_]{12,}$`).test(stripeApiKey)) {
  throw new Error(`ARC_PAYMENT_INVALID: Stripe ${stripeMode} API key is required`);
}
if (!/^plink_[A-Za-z0-9]+$/.test(expectedPaymentLinkId)) throw new Error("ARC_PAYMENT_INVALID: expected Payment Link id");
if (!/^price_[A-Za-z0-9]+$/.test(expectedPriceId)) throw new Error("ARC_PAYMENT_INVALID: expected Price id");
if (!/^txcd_[0-9]{8}$/.test(expectedProductTaxCode)) throw new Error("ARC_TAX_INVALID: expected product tax code");
if (!/^[a-f0-9]{64}$/.test(expectedStripeAccountIdSha256)) throw new Error("ARC_STRIPE_ACCOUNT_INVALID: exact ARC Stripe account id SHA-256 is required");
let expectedTaxRegistrations;
try {
  expectedTaxRegistrations = JSON.parse(expectedTaxRegistrationsJson);
} catch (error) {
  throw new Error("ARC_TAX_INVALID: expected tax registrations JSON");
}
const taxRegistrationFields = ["country", "id", "state", "type"];
if (!Array.isArray(expectedTaxRegistrations) || expectedTaxRegistrations.length < 1 || expectedTaxRegistrations.length > 100 ||
    expectedTaxRegistrations.some(registration => !registration || typeof registration !== "object" || Array.isArray(registration) ||
      JSON.stringify(Object.keys(registration).sort()) !== JSON.stringify(taxRegistrationFields) ||
      !/^taxreg_[A-Za-z0-9]+$/.test(clean(registration.id)) || !/^[A-Z]{2}$/.test(clean(registration.country)) ||
      !/^[A-Z0-9-]{1,10}$/.test(clean(registration.state)) || !/^[a-z][a-z0-9_]{2,63}$/.test(clean(registration.type))) ||
    new Set(expectedTaxRegistrations.map(registration => clean(registration.id))).size !== expectedTaxRegistrations.length ||
    !expectedTaxRegistrations.some(registration => clean(registration.country) === "US" && clean(registration.state) === "WA" && clean(registration.type) === "state_sales_tax")) {
  throw new Error("ARC_TAX_INVALID: exact active Washington tax registration configuration is required");
}
if (clean(inputData.expected_terms_version) !== expectedTermsVersion) {
  throw new Error("ARC_PAYMENT_INVALID: configured terms version must match the static ARC checkout contract");
}
if (checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256) {
  throw new Error("ARC_PAYMENT_INVALID: checkout binding secret must be 32–256 characters");
}
if (handoffArtifactEvidenceSecret.length < 32 || handoffArtifactEvidenceSecret.length > 256) {
  throw new Error("ARC_ARTIFACT_INVALID: handoff artifact evidence secret must be 32–256 characters");
}
if (!token) throw new Error("ARC_GITHUB_INVALID: preview-source github_token is required");
if (branch !== "main") throw new Error("ARC_GITHUB_INVALID: ARC2 must resolve an approved preview from main");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)) {
  throw new Error("ARC_GITHUB_INVALID: preview-source owner, repository, or branch");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256 and SHA-256 are required");
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
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const equalHex = (first, second) => {
  if (!/^[a-f0-9]{64}$/.test(first) || !/^[a-f0-9]{64}$/.test(second)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
};

// The Stripe trigger payload and caller-mapped fields are notification hints only.
// Every payment, consent, customer, and preview-binding fact below comes from this
// authenticated read of the exact configured-mode Checkout Session.
const stripeHeaders = {
  Accept: "application/json",
  Authorization: `Basic ${Buffer.from(`${stripeApiKey}:`, "utf8").toString("base64")}`,
  "Stripe-Version": "2026-06-24.dahlia"
};
const stripeGet = async resourceUrl => {
  const response = await fetch(resourceUrl, { method: "GET", headers: stripeHeaders, redirect: "error" });
  if (response.url && response.url !== resourceUrl) throw new Error("ARC_PAYMENT_INVALID: Stripe API redirect rejected");
  if (!response.ok) throw new Error(`ARC_PAYMENT_INVALID: Stripe API retrieval failed (${response.status})`);
  return response.json();
};
const stripeAccount = await stripeGet("https://api.stripe.com/v1/account");
const authenticatedStripeAccountId = clean(stripeAccount?.id);
const stripeAccountIdSha256 = await sha256Hex(authenticatedStripeAccountId);
if (!stripeAccount || typeof stripeAccount !== "object" || Array.isArray(stripeAccount) || stripeAccount.object !== "account" ||
    !/^acct_[A-Za-z0-9]+$/.test(authenticatedStripeAccountId) || !equalHex(stripeAccountIdSha256, expectedStripeAccountIdSha256)) {
  throw new Error("ARC_STRIPE_ACCOUNT_INVALID: authenticated Stripe account is not the configured ARC account");
}
const stripeSessionUrl = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand%5B%5D=line_items.data.price.product`;
const session = await stripeGet(stripeSessionUrl);
if (!session || typeof session !== "object" || Array.isArray(session) || session.object !== "checkout.session" || clean(session.id) !== sessionId) {
  throw new Error("ARC_PAYMENT_INVALID: Stripe Checkout Session identity mismatch");
}
const rawClientReferenceId = clean(session.client_reference_id);
const paymentLinkId = clean(typeof session.payment_link === "object" ? session.payment_link?.id : session.payment_link);
const termsConsent = clean(session.consent?.terms_of_service).toLowerCase();
const termsVersion = clean(session.metadata?.terms_version);
const sessionCustomerDetailsEmail = clean(session.customer_details?.email).toLowerCase();
const sessionCustomerEmail = clean(session.customer_email).toLowerCase();
if (sessionCustomerDetailsEmail && sessionCustomerEmail && sessionCustomerDetailsEmail !== sessionCustomerEmail) {
  throw new Error("ARC_HANDOFF_INVALID: Stripe customer email fields disagree");
}
const customerEmail = sessionCustomerDetailsEmail || sessionCustomerEmail;
const collectedBusinessName = clean(session.collected_information?.business_name);
const collectedIndividualName = clean(session.collected_information?.individual_name);
const adultAcknowledgements = (Array.isArray(session.custom_fields) ? session.custom_fields : []).filter(field =>
  field && typeof field === "object" && clean(field.key) === "adultpurchaserack"
);
const adultAcknowledgement = clean(
  adultAcknowledgements[0]?.dropdown?.value ||
  adultAcknowledgements[0]?.text?.value ||
  adultAcknowledgements[0]?.numeric?.value
).toLowerCase();
if (!rawClientReferenceId) throw new Error("ARC_FOLDER_NOT_FOUND: client_reference_id is empty");
if (session.livemode !== stripeLiveModeEnabled) throw new Error("ARC_PAYMENT_INVALID: Checkout Session livemode does not match configured Stripe mode");
if (clean(session.mode).toLowerCase() !== "payment" || clean(session.status).toLowerCase() !== "complete") {
  throw new Error("ARC_PAYMENT_INVALID: Checkout Session must be a completed one-time payment");
}
if (clean(session.payment_status).toLowerCase() !== "paid") throw new Error("ARC_PAYMENT_INVALID: session is not paid");
if (clean(session.currency).toLowerCase() !== "usd") throw new Error("ARC_PAYMENT_INVALID: currency must be usd");
if (!Number.isSafeInteger(session.amount_subtotal) || session.amount_subtotal !== 500000) {
  throw new Error("ARC_PAYMENT_INVALID: amount_subtotal must be exactly 500000 minor units ($5,000.00)");
}
const amountTax = session.total_details?.amount_tax;
if (!Number.isSafeInteger(amountTax) || amountTax < 0 || !Number.isSafeInteger(session.amount_total) ||
    session.amount_total !== session.amount_subtotal + amountTax || session.total_details?.amount_discount !== 0 ||
    session.total_details?.amount_shipping !== 0) {
  throw new Error("ARC_TAX_INVALID: total must equal the $5,000 subtotal plus Stripe-calculated tax");
}
if (session.automatic_tax?.enabled !== true || clean(session.automatic_tax?.status) !== "complete") {
  throw new Error("ARC_TAX_INVALID: Stripe automatic tax must be enabled and complete");
}
if (paymentLinkId !== expectedPaymentLinkId) throw new Error("ARC_PAYMENT_INVALID: Payment Link identity mismatch");
const lineItems = session.line_items;
if (!lineItems || typeof lineItems !== "object" || Array.isArray(lineItems) || lineItems.object !== "list" ||
    lineItems.has_more !== false || !Array.isArray(lineItems.data) || lineItems.data.length !== 1) {
  throw new Error("ARC_PAYMENT_INVALID: exactly one fully expanded line item is required");
}
const lineItem = lineItems.data[0];
const price = lineItem?.price;
const product = price?.product;
if (!lineItem || lineItem.object !== "item" || lineItem.quantity !== 1 || lineItem.currency !== "usd" ||
    lineItem.amount_subtotal !== 500000 || lineItem.amount_discount !== 0 || lineItem.amount_tax !== amountTax ||
    lineItem.amount_total !== session.amount_total || !price || typeof price !== "object" || Array.isArray(price) ||
    price.object !== "price" || clean(price.id) !== expectedPriceId || price.livemode !== stripeLiveModeEnabled ||
    clean(price.type) !== "one_time" || clean(price.currency) !== "usd" || price.unit_amount !== 500000 ||
    price.custom_unit_amount !== null || price.recurring !== null || clean(price.tax_behavior) !== "exclusive" ||
    !product || typeof product !== "object" || Array.isArray(product) || product.object !== "product" ||
    clean(typeof product.tax_code === "object" ? product.tax_code?.id : product.tax_code) !== expectedProductTaxCode) {
  throw new Error("ARC_PAYMENT_INVALID: expanded line item does not match the exact exclusive-tax ARC Price and Product");
}
if (termsConsent !== "accepted") throw new Error("ARC_PAYMENT_INVALID: terms_of_service consent must be accepted");
if (termsVersion !== expectedTermsVersion) throw new Error("ARC_PAYMENT_INVALID: terms version mismatch");
if (clean(session.metadata?.tax_contract_version) !== "arc-tax-v1") throw new Error("ARC_TAX_INVALID: tax contract version mismatch");
if (adultAcknowledgements.length !== 1 || adultAcknowledgement !== "accepted" ||
    clean(adultAcknowledgements[0].type) !== "dropdown" || adultAcknowledgements[0].optional !== false ||
    clean(adultAcknowledgements[0].label?.type) !== "custom" ||
    clean(adultAcknowledgements[0].label?.custom) !== "I am 18+ and authorized to buy for this business") {
  throw new Error("ARC_PAYMENT_INVALID: adult purchaser acknowledgement must be accepted");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
  throw new Error("ARC_HANDOFF_INVALID: Stripe customer email");
}
if (clean(session.customer_details?.tax_exempt) !== "none") {
  throw new Error("ARC_TAX_INVALID: tax-exempt customers require a separately verified exemption workflow");
}
const customerAddress = session.customer_details?.address;
const requiredAddressFields = ["city", "country", "line1", "postal_code"];
const customerAddressCountry = clean(customerAddress?.country);
const customerAddressState = clean(customerAddress?.state);
if (!customerAddress || typeof customerAddress !== "object" || Array.isArray(customerAddress) ||
    requiredAddressFields.some(field => !clean(customerAddress[field]) || clean(customerAddress[field]).length > 120 || /[\r\n<>]/.test(clean(customerAddress[field]))) ||
    !/^[A-Z]{2}$/.test(customerAddressCountry) || !/^[A-Z0-9-]{0,10}$/.test(customerAddressState) ||
    (customerAddressCountry === "US" && !/^[A-Z]{2}$/.test(customerAddressState))) {
  throw new Error("ARC_TAX_INVALID: complete Stripe customer destination address is required");
}
if (customerAddressCountry === "US" && customerAddressState === "WA" && amountTax <= 0) {
  throw new Error("ARC_TAX_INVALID: Washington destination requires positive calculated sales tax");
}
if (!collectedBusinessName || collectedBusinessName.length > 120 || /[\r\n<>]/.test(collectedBusinessName) ||
    !collectedIndividualName || collectedIndividualName.length > 120 || /[\r\n<>]/.test(collectedIndividualName)) {
  throw new Error("ARC_HANDOFF_INVALID: required Stripe business and individual names");
}
if (rawClientReferenceId.length > 200 || !/^[A-Za-z0-9_-]+$/.test(rawClientReferenceId)) {
  throw new Error("ARC_PAYMENT_INVALID: client_reference_id exceeds Stripe's allowed syntax");
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
    throw new Error("ARC_TAX_INVALID: expected Stripe Tax registration is not active or its jurisdiction changed");
  }
  registrationSnapshots.push({ id: clean(registration.id), country, state, type, active_from: activeFrom, expires_at: expiresAt });
}
registrationSnapshots.sort((first, second) => first.id.localeCompare(second.id));
const taxRegistrationsSha256 = await sha256Hex(canonicalJson(registrationSnapshots));
const customerAddressSha256 = await sha256Hex(canonicalJson({
  city: clean(customerAddress.city),
  country: clean(customerAddress.country),
  line1: clean(customerAddress.line1),
  line2: clean(customerAddress.line2),
  postal_code: clean(customerAddress.postal_code),
  state: clean(customerAddress.state)
}));
const signedReference = rawClientReferenceId.match(/^([a-f0-9]{8})_([a-f0-9]{64})_([a-f0-9]{64})$/i);
if (!signedReference) throw new Error("ARC_PAYMENT_INVALID: signed checkout reference");
const clientReferenceId = signedReference[1].toLowerCase();
const approvalContentSha256 = signedReference[2].toLowerCase();
const checkoutSignature = Uint8Array.from(signedReference[3].match(/../g), byte => Number.parseInt(byte, 16));
const checkoutBindingKey = await globalThis.crypto.subtle.importKey(
  "raw",
  encoder.encode(checkoutBindingSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);
const checkoutReferenceMessage = `arc-checkout-reference-v2\n${clientReferenceId}\n${approvalContentSha256}`;
if (!(await globalThis.crypto.subtle.verify("HMAC", checkoutBindingKey, checkoutSignature, encoder.encode(checkoutReferenceMessage)))) {
  throw new Error("ARC_PAYMENT_INVALID: checkout reference signature mismatch");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28"
};
const github = async url => {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`ARC_GITHUB_FAILED: ${response.status} ${response.statusText}`);
  return response.json();
};
const tree = await github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
if (tree.truncated) throw new Error("ARC_FOLDER_LOOKUP_FAILED: repository tree was truncated");
const folders = [...new Set((tree.tree || [])
  .filter(item => item.type === "blob" && /(?:^|\/)index\.html$/i.test(item.path || ""))
  .map(item => item.path.replace(/\/index\.html$/i, ""))
  .filter(folder => !/^deliveries\//i.test(folder)))];
const prefix = clientReferenceId.toLowerCase();
const matches = folders.filter(folder => {
  const leaf = folder.split("/").pop().toLowerCase();
  return leaf === `arc-${prefix}` || leaf.endsWith(`-${prefix}`);
});
if (matches.length !== 1) throw new Error(`ARC_FOLDER_NOT_FOUND: expected one match for ${prefix}; found ${matches.length}`);
const previewFolder = matches[0];
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/i.test(previewFolder)) {
  throw new Error("ARC_FOLDER_NOT_FOUND: resolved preview must be one root folder ending in eight hexadecimal characters");
}
const previewPath = `${previewFolder}/index.html`;
const content = await github(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${previewPath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`);
let html = Buffer.from(clean(content.content).replace(/\s/g, ""), "base64").toString("utf8").trim();
if (!/<!doctype html>/i.test(html) || !/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) {
  throw new Error("ARC_FINALIZE_INVALID: source is not a complete private preview");
}
if (!/<meta\s+name=["']arc-template-version["']\s+content=["']10\.0["']/i.test(html)) throw new Error("ARC_FINALIZE_INVALID: only verified ARC v10 previews can be delivered");
const proofBlocks = html.match(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/gi) || [];
const proofFolder = html.match(/<meta\s+name=["']arc-preview-folder["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] || "";
const proofSourceSha256 = html.match(/<meta\s+name=["']arc-preview-source-sha256["'][^>]*content=["']([a-f0-9]{64})["'][^>]*>/i)?.[1] || "";
if (proofBlocks.length !== 1 || proofFolder !== previewFolder || !proofSourceSha256) {
  throw new Error("ARC_FINALIZE_INVALID: approved preview proof is missing or mismatched");
}
const proofSourceHtml = html.replace(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/i, "");
if (await sha256Hex(proofSourceHtml) !== proofSourceSha256.toLowerCase()) {
  throw new Error("ARC_FINALIZE_INVALID: approved preview proof hash mismatch");
}
const toolbarBlocks = proofSourceHtml.match(/<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview<\/strong>Built for this business\. Purchase only if approved\.<\/span><a data-arc-checkout href="https:\/\/buy\.stripe\.com\/(?:test_)?[A-Za-z0-9]+\?client_reference_id=[a-f0-9]{8}_[a-f0-9]{64}_[a-f0-9]{64}">Own this website — \$5,000<\/a><\/aside>/g) || [];
if (toolbarBlocks.length !== 1 || !proofSourceHtml.endsWith(`${toolbarBlocks[0]}\n</body>\n</html>`)) {
  throw new Error("ARC_FINALIZE_INVALID: exact terminal preview purchase toolbar is required");
}
const toolbarCheckoutUrl = toolbarBlocks[0].match(/href="([^"]+)"/)?.[1] || "";
let toolbarReference = "";
try {
  const toolbarCheckout = new URL(toolbarCheckoutUrl.replaceAll("&amp;", "&"));
  const toolbarPathMatchesMode = stripeLiveModeEnabled
    ? /^\/[A-Za-z0-9]+$/.test(toolbarCheckout.pathname) && !toolbarCheckout.pathname.startsWith("/test_")
    : /^\/test_[A-Za-z0-9]+$/.test(toolbarCheckout.pathname);
  if (toolbarCheckout.origin !== "https://buy.stripe.com" || !toolbarPathMatchesMode) {
    throw new Error("ARC_FINALIZE_INVALID: preview toolbar Stripe mode mismatch");
  }
  toolbarReference = toolbarCheckout.searchParams.get("client_reference_id") || "";
} catch (error) {
  throw new Error("ARC_FINALIZE_INVALID: preview toolbar checkout URL");
}
if (toolbarReference !== rawClientReferenceId) {
  throw new Error("ARC_PAYMENT_INVALID: preview toolbar reference does not match the paid Checkout Session");
}
const approvalHtml = proofSourceHtml.replace(`${toolbarBlocks[0]}\n</body>\n</html>`, "</body>\n</html>");
if (await sha256Hex(approvalHtml) !== approvalContentSha256) {
  throw new Error("ARC_PAYMENT_INVALID: approved preview bytes do not match the checkout approval digest");
}
html = html.replace(`${toolbarBlocks[0]}\n</body>\n</html>`, "</body>\n</html>");
const replaceOrInsertHead = (expression, markup) => {
  html = expression.test(html) ? html.replace(expression, markup) : html.replace(/<\/head>/i, `  ${markup}\n</head>`);
};
replaceOrInsertHead(/<meta\s+name=["']robots["'][^>]*>/i, '<meta name="robots" content="index,follow,max-image-preview:large">');
replaceOrInsertHead(/<meta\s+name=["']arc-site-mode["'][^>]*>/i, '<meta name="arc-site-mode" content="production">');
html = html.replace(/<body\b([^>]*?)\sdata-arc-site-mode=["'][^"']*["']([^>]*)>/i, '<body$1 data-arc-site-mode="production"$2>');
if (!/data-arc-site-mode=["']production["']/i.test(html)) html = html.replace(/<body\b/i, '<body data-arc-site-mode="production"');
html = html.replace(/\[ARC TEST\]\s*/gi, "").trim() + "\n";
if (/noindex/i.test(html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "")) throw new Error("ARC_FINALIZE_FAILED: noindex remained");
if (/\[\[[A-Z0-9_]+\]\]/.test(html)) throw new Error("ARC_FINALIZE_FAILED: unresolved placeholder");
if (/<aside\b[^>]*arc-preview-toolbar|data-arc-checkout|buy\.stripe\.com/i.test(html)) throw new Error("ARC_FINALIZE_FAILED: preview payment controls remained in production");

const verifiedLeadNotificationEmail = clean(inputData.verified_lead_notification_email).toLowerCase();
const leadRouteEvidenceSecret = clean(inputData.lead_route_evidence_secret);
const productionPath = "index.html";
// The final customer URL is unknowable until the customer-controlled Netlify
// site exists. Remove any source-preview URL instead of publishing a false
// canonical or coupling paid delivery to ARC Pages.
html = html
  .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "")
  .replace(/<meta\s+property=["']og:url["'][^>]*>\s*/gi, "");
const headersFile = `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
const supportedLeadControlNames = new Set(["form-name", "bot-field", "name", "email", "phone", "project_details"]);
const leadDisclosureHtml = '<p class="form-status" role="note">By submitting this form, you agree that this business may contact you about your request. Do not include sensitive personal, medical, legal, or financial information.</p>';
const canonicalAttributes = (tag, tagName) => {
  const match = tag.match(new RegExp(`^<${tagName}\\b([\\s\\S]*?)>$`, "i"));
  if (!match) return null;
  const attributes = new Map();
  let remaining = match[1].trim();
  while (remaining) {
    const nameMatch = remaining.match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)/);
    if (!nameMatch || attributes.has(nameMatch[1].toLowerCase())) return null;
    const name = nameMatch[1].toLowerCase();
    remaining = remaining.slice(nameMatch[0].length).trimStart();
    let value = name;
    if (remaining.startsWith("=")) {
      remaining = remaining.slice(1).trimStart();
      if (remaining[0] !== '"') return null;
      const end = remaining.indexOf('"', 1);
      if (end < 0) return null;
      value = remaining.slice(1, end);
      remaining = remaining.slice(end + 1).trimStart();
    }
    attributes.set(name, value);
  }
  return attributes;
};
const resolveLeadForm = markup => {
  const formBlocks = markup.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const formOpenings = markup.match(/<form\b[^>]*>/gi) || [];
  if (!formOpenings.length) return { hasLeadForm: false, formName: "" };
  if (formBlocks.length !== 1 || formOpenings.length !== 1) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: production must contain exactly one Netlify-managed form");
  }
  if (!formBlocks[0].includes(leadDisclosureHtml)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: exact visible lead privacy disclosure is required");
  }
  const formAttributes = canonicalAttributes(formOpenings[0], "form");
  const formName = clean(formAttributes?.get("name"));
  const honeypotName = clean(formAttributes?.get("netlify-honeypot"));
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(formName) ||
      formAttributes?.get("method") !== "POST" || formAttributes?.get("data-netlify") !== "true" ||
      formAttributes?.get("action") !== "/?submitted=1" || honeypotName !== "bot-field") {
    throw new Error("ARC_LEAD_ROUTE_INVALID: exact Netlify form attributes are required");
  }
  const controls = [];
  for (const tag of formBlocks[0].match(/<(?:input|textarea|select|button)\b[^>]*>/gi) || []) {
    const tagName = tag.match(/^<([a-z]+)/i)?.[1].toLowerCase();
    const attributes = canonicalAttributes(tag, tagName);
    if (!attributes) throw new Error("ARC_LEAD_ROUTE_INVALID: malformed canonical lead control");
    const name = clean(attributes.get("name"));
    if (name) controls.push({ tagName, name, attributes });
  }
  const names = controls.map(control => control.name);
  if (new Set(names).size !== names.length || names.some(name => !supportedLeadControlNames.has(name)) ||
      [...supportedLeadControlNames].some(name => !names.includes(name))) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: duplicate, unsupported, or missing lead control");
  }
  const control = name => controls.find(item => item.name === name);
  const type = name => clean(control(name)?.attributes.get("type")).toLowerCase();
  const required = name => control(name)?.attributes.has("required");
  if (control("form-name")?.tagName !== "input" || type("form-name") !== "hidden" || clean(control("form-name")?.attributes.get("value")) !== formName ||
      control(honeypotName)?.tagName !== "input" || !new Set(["", "text"]).has(type(honeypotName)) ||
      control("name")?.tagName !== "input" || type("name") !== "text" || !required("name") ||
      control("email")?.tagName !== "input" || type("email") !== "email" || !required("email") ||
      control("phone")?.tagName !== "input" || type("phone") !== "tel" ||
      control("project_details")?.tagName !== "textarea" || !required("project_details") ||
      (formBlocks[0].match(/<button\b[^>]*type="submit"[^>]*>/gi) || []).length !== 1) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: lead control semantics do not match the supported schema");
  }
  return { hasLeadForm: true, formName };
};
const leadForm = resolveLeadForm(html);
const hasLeadForm = leadForm.hasLeadForm;
const leadRouteFormName = leadForm.formName;
if (hasLeadForm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedLeadNotificationEmail)) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: verified lead notification email");
}
if (hasLeadForm && (leadRouteEvidenceSecret.length < 32 || leadRouteEvidenceSecret.length > 256)) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: lead-route evidence secret must be 32–256 characters");
}
let leadRouteRecipientHmacSha256 = "";
if (hasLeadForm) {
  const leadRouteKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(leadRouteEvidenceSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const recipientBinding = await globalThis.crypto.subtle.sign(
    "HMAC",
    leadRouteKey,
    encoder.encode(`arc-lead-route-recipient-v1\n${verifiedLeadNotificationEmail}`)
  );
  leadRouteRecipientHmacSha256 = [...new Uint8Array(recipientBinding)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
for (const [label, publicContent] of [["production HTML", html], ["headers file", headersFile]]) {
  for (const privateValue of [sessionId, customerEmail, verifiedLeadNotificationEmail, leadRouteEvidenceSecret].filter(Boolean)) {
    if (publicContent.toLowerCase().includes(privateValue.toLowerCase())) {
      throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private handoff data`);
    }
  }
}
const relativeReferences = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(reference => !/^(?:https?:|mailto:|tel:|#|\/|\?)/i.test(reference));
if (relativeReferences.length) {
  throw new Error(`ARC_ARTIFACT_INVALID: unresolved relative assets: ${[...new Set(relativeReferences)].join(",")}`);
}
const productionSha256 = await sha256Hex(html);
const bundleArtifacts = [
  { path: "_headers", content: headersFile },
  { path: productionPath, content: html }
];
const bundleFingerprint = await sha256Hex(bundleArtifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
const artifactManifest = [];
for (const artifact of bundleArtifacts) {
  artifactManifest.push({
    path: artifact.path,
    sha256: await sha256Hex(artifact.content),
    size: Buffer.byteLength(artifact.content, "utf8")
  });
}
const artifactManifestPrivate = canonicalJson(artifactManifest);
const artifactManifestSha256 = await sha256Hex(artifactManifestPrivate);
const artifactEvidenceIssuedAt = new Date().toISOString();
const handoffArtifactEvidence = canonicalJson({
  version: "arc2-handoff-artifact-evidence-v1",
  scope: "netlify-claimable-deploy-artifacts",
  preview_folder: previewFolder,
  production_content_sha256: productionSha256,
  artifact_manifest_sha256: artifactManifestSha256,
  bundle_fingerprint: bundleFingerprint,
  artifacts: artifactManifest,
  issued_at: artifactEvidenceIssuedAt
});
const handoffArtifactEvidenceSha256 = await sha256Hex(handoffArtifactEvidence);
const artifactEvidenceKey = await globalThis.crypto.subtle.importKey(
  "raw",
  encoder.encode(handoffArtifactEvidenceSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const handoffArtifactEvidenceSignatureBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  artifactEvidenceKey,
  encoder.encode(`arc2-handoff-artifact-evidence-signature-v1\n${handoffArtifactEvidence}`)
);
const handoffArtifactEvidenceHmacSha256 = [...new Uint8Array(handoffArtifactEvidenceSignatureBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");
const customerEmailSha256 = await sha256Hex(customerEmail);
const paymentEvidence = canonicalJson({
  version: "arc2-payment-evidence-v2",
  scope: "authoritative-stripe-checkout-session",
  checkout_session_id: sessionId,
  stripe_account_id_sha256: stripeAccountIdSha256,
  client_reference_id_sha256: await sha256Hex(rawClientReferenceId),
  preview_folder: previewFolder,
  production_content_sha256: productionSha256,
  artifact_manifest_sha256: artifactManifestSha256,
  handoff_artifact_evidence_sha256: handoffArtifactEvidenceSha256,
  bundle_fingerprint: bundleFingerprint,
  customer_email_sha256: customerEmailSha256,
  livemode: stripeLiveModeEnabled,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: amountTax,
  amount_total_minor_units: session.amount_total,
  payment_link_id: paymentLinkId,
  price_id: expectedPriceId,
  product_tax_code: expectedProductTaxCode,
  price_tax_behavior: "exclusive",
  automatic_tax_enabled: true,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "verified",
  tax_contract_version: "arc-tax-v1",
  tax_registrations_sha256: taxRegistrationsSha256,
  customer_address_sha256: customerAddressSha256,
  customer_address_country: customerAddressCountry,
  customer_address_state: customerAddressState,
  quantity: 1,
  terms_of_service_consent: "accepted",
  terms_version: termsVersion,
  adult_purchaser_acknowledgement: "accepted"
});
const paymentEvidenceSignatureBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  checkoutBindingKey,
  encoder.encode(`arc2-payment-evidence-signature-v2\n${paymentEvidence}`)
);
const paymentEvidenceHmacSha256 = [...new Uint8Array(paymentEvidenceSignatureBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");
const paymentEvidenceSha256 = await sha256Hex(paymentEvidence);
const deployArtifactsPrivate = canonicalJson(bundleArtifacts.map(artifact => ({
  path: artifact.path,
  content_base64: Buffer.from(artifact.content, "utf8").toString("base64")
})));
return {
  status: "READY_FOR_CLAIMABLE_DEPLOY",
  external_deploy_write_allowed_by_this_step: false,
  claim_invitation_allowed_by_this_step: false,
  email_allowed_by_this_step: false,
  payment_verification_status: `verified_${stripeMode}_payment_from_stripe_api`,
  stripe_session_retrieved: true,
  checkout_session_id: sessionId,
  client_reference_id: rawClientReferenceId,
  livemode: stripeLiveModeEnabled,
  payment_status: "paid",
  currency: "usd",
  amount_total_minor_units: session.amount_total,
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: amountTax,
  payment_link_id: paymentLinkId,
  price_id: expectedPriceId,
  stripe_account_id_sha256: stripeAccountIdSha256,
  product_tax_code: expectedProductTaxCode,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "verified",
  customer_address_sha256: customerAddressSha256,
  tax_registrations_sha256: taxRegistrationsSha256,
  quantity: 1,
  terms_of_service_consent: "accepted",
  terms_version: termsVersion,
  adult_purchaser_acknowledgement: "accepted",
  payment_evidence_private: paymentEvidence,
  payment_evidence_sha256: paymentEvidenceSha256,
  payment_evidence_hmac_sha256: paymentEvidenceHmacSha256,
  dedupe_key: `arc2:${sessionId}`,
  preview_folder: previewFolder,
  preview_file_path: previewPath,
  preview_blob_sha: content.sha,
  production_file_path: productionPath,
  production_content_base64: Buffer.from(html, "utf8").toString("base64"),
  headers_file_path: "_headers",
  headers_file_base64: Buffer.from(headersFile, "utf8").toString("base64"),
  deploy_artifacts_private: deployArtifactsPrivate,
  artifact_manifest_private: artifactManifestPrivate,
  artifact_manifest_sha256: artifactManifestSha256,
  handoff_artifact_evidence_private: handoffArtifactEvidence,
  handoff_artifact_evidence_sha256: handoffArtifactEvidenceSha256,
  handoff_artifact_evidence_hmac_sha256: handoffArtifactEvidenceHmacSha256,
  production_html_character_count: html.length,
  production_content_sha256: productionSha256,
  bundle_fingerprint: bundleFingerprint,
  claimable_deploy_required: true,
  preview_source_repository: `${owner}/${repository}`,
  customer_email: customerEmail,
  customer_email_sha256: customerEmailSha256,
  lead_route_status: hasLeadForm ? "pending_live_staging_evidence" : "not_required",
  lead_route_evidence_required: hasLeadForm,
  lead_route_evidence_version: hasLeadForm ? "arc-lead-route-evidence-v1" : "",
  lead_route_form_name: leadRouteFormName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
  verified_lead_notification_email: hasLeadForm ? verifiedLeadNotificationEmail : ""
};
