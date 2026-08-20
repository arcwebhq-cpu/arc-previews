// ARC2 Code step — retrieve the authoritative configured-mode Stripe Checkout Session,
// resolve the exact approved preview, finalize it, and prepare one signed
// self-contained Netlify claimable-deploy bundle. This step never creates a site,
// repository, claim invitation, or email.
const clean = value => String(value == null ? "" : value).trim();
const decodePrivacyEntities = value => String(value == null ? "" : value)
  .replace(/&#(\d+);?/g, (_, code) => { const point = Number(code); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
  .replace(/&#x([0-9a-f]+);?/gi, (_, code) => { const point = Number.parseInt(code, 16); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
  .replace(/&(amp|quot|apos|lt|gt|colon|sol|period|commat|percnt|num);/gi, (_, name) => ({
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", sol: "/", period: ".", commat: "@", percnt: "%", num: "#"
  })[name.toLowerCase()]);
const recursivelyDecodePrivacyValue = value => {
  let current = String(value == null ? "" : value);
  for (let pass = 0; pass < 5; pass += 1) {
    let next = decodePrivacyEntities(current);
    try { next = decodeURIComponent(next.replace(/\+/g, "%20")); } catch {}
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC");
};
const privacyCanonical = value => recursivelyDecodePrivacyValue(value).toLowerCase().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const privacyCompact = value => privacyCanonical(value).replace(/[^\p{L}\p{N}@]+/gu, "");
const assertPrivateValuesAbsent = (content, privateValues, label) => {
  const decoded = recursivelyDecodePrivacyValue(content);
  const text = recursivelyDecodePrivacyValue(decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const urlSurfaces = [...decoded.matchAll(/\b(?:href|src|srcset|action|content|style)\s*=\s*["']([^"']*)["']/gi)].map(match => recursivelyDecodePrivacyValue(match[1]));
  const surfaces = [decoded, text, ...urlSurfaces].map(value => ({ canonical: privacyCanonical(value), compact: privacyCompact(value) }));
  for (const item of privateValues) {
    const privateCanonical = privacyCanonical(item?.value);
    if (!privateCanonical) continue;
    const privateCompact = privacyCompact(privateCanonical);
    if (surfaces.some(surface => surface.canonical.includes(privateCanonical) || (privateCompact.length >= 7 && surface.compact.includes(privateCompact)))) {
      throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private ${item.label}`);
    }
  }
};
const sessionId = clean(inputData.checkout_session_id || inputData.session_id);
const stripeApiKey = clean(inputData.stripe_api_key || inputData.stripe_test_api_key);
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const handoffArtifactEvidenceSecret = clean(inputData.handoff_artifact_evidence_secret);
const stripeLiveModeFlag = clean(inputData.stripe_live_mode_enabled).toLowerCase();
if (!["", "false", "true"].includes(stripeLiveModeFlag)) throw new Error("ARC_STRIPE_MODE_INVALID: stripe_live_mode_enabled must be true or false");
const stripeLiveModeEnabled = stripeLiveModeFlag === "true";
const stripeMode = stripeLiveModeEnabled ? "live" : "test";
const owner = clean(inputData.preview_source_github_owner || inputData.github_owner);
const repository = clean(inputData.preview_source_github_repo || inputData.github_repo);
const branch = clean(inputData.preview_source_github_branch || inputData.github_branch || "main");
const token = clean(inputData.github_token);
if (!new RegExp(`^cs_${stripeMode}_[A-Za-z0-9_]+$`).test(sessionId)) throw new Error(`ARC_PAYMENT_INVALID: ${stripeMode} checkout session id`);
if (!new RegExp(`^(?:sk|rk)_${stripeMode}_[A-Za-z0-9_]{12,}$`).test(stripeApiKey)) {
  throw new Error(`ARC_PAYMENT_INVALID: Stripe ${stripeMode} API key is required`);
}
const taxRegistrationFields = ["country", "id", "state", "type"];
if (checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256) {
  throw new Error("ARC_PAYMENT_INVALID: checkout binding secret must be 32–256 characters");
}
if (handoffArtifactEvidenceSecret.length < 32 || handoffArtifactEvidenceSecret.length > 256) {
  throw new Error("ARC_ARTIFACT_INVALID: handoff artifact evidence secret must be 32–256 characters");
}
if (!token) throw new Error("ARC_GITHUB_INVALID: preview-source github_token is required");
if (branch !== "main") throw new Error("ARC_GITHUB_INVALID: ARC2 must resolve an approved preview from main");
if (owner !== "arcwebhq-cpu" || repository !== "arc-previews" || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) ||
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
const sha256Bytes = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const privateCheckoutPattern=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v3_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v1|arc1-checkout-recipient-reservation-v1|arc1-preview-readiness-(?:core|observation)-v1|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v1|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;
const normalizePublicSurface=value=>{let current=String(value??"");for(let pass=0;pass<5;pass+=1){let next=current.replace(/&#(\d+);?/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);?/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&(amp|period|colon|sol|percnt|num|tab|newline);/gi,(_,name)=>({amp:"&",period:".",colon:":",sol:"/",percnt:"%",num:"#",tab:"\t",newline:"\n"})[name.toLowerCase()]).replace(/\/\*[\s\S]*?\*\//g,"").replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/[\u3002\uff0e\uff61]/g,".").replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));}});if(next===current)break;current=next;}return current.normalize("NFKC").toLowerCase();};
const trustedScriptHashes=["55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870","98cbb58e3ec829ddaec61983333a8bb500b91558625a346350bfc8fe4842b860"].sort();
const assertPaidPublicSurface=async(html,label)=>{
  const raw=String(html??""),scripts=raw.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)||[],hashes=(await Promise.all(scripts.map(script=>sha256Hex(script)))).sort();
  if((raw.match(/<script\b/gi)||[]).length!==scripts.length||(raw.match(/<\/script\b/gi)||[]).length!==scripts.length||hashes.length!==3||canonicalJson(hashes)!==canonicalJson(trustedScriptHashes)||await sha256Hex(hashes.join("\n"))!=="8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b")
    throw new Error(`ARC_FINALIZE_INVALID: ${label} reviewed script manifest changed`);
  const nonScript=raw.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,""),decoded=normalizePublicSurface(nonScript),compact=decoded.replace(/[\s\u0000-\u001f\u007f]+/g,"");
  if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScript)||/\p{Default_Ignorable_Code_Point}/u.test(decoded)||
    /<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(raw)||/<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style\s*>/i.test(decoded)||
    /\bstyle\s*=\s*(?:"[^"]*\\|'[^']*\\)/i.test(decoded)||privateCheckoutPattern.test(decoded)||privateCheckoutPattern.test(compact))
    throw new Error(`ARC_FINALIZE_INVALID: ${label} contains private or executable output`);
  for(const match of nonScript.matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){
    const attr=match[1]??match[2]??match[3]??"",normalized=normalizePublicSurface(attr);let parsed;try{parsed=new URL(normalized,"https://arc.invalid/");}catch{}
    const host=parsed?.hostname?.toLowerCase()||"";
    if(/%(?![0-9a-f]{2})/i.test(attr)||/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(attr)||/\p{Default_Ignorable_Code_Point}/u.test(normalized)||
      host==="buy.stripe.com"||host.endsWith(".buy.stripe.com")||new Set(["javascript:","vbscript:"]).has(parsed?.protocol)||privateCheckoutPattern.test(normalized)||privateCheckoutPattern.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g,"")))
      throw new Error(`ARC_FINALIZE_INVALID: ${label} contains unsafe URL output`);
  }
};
const equalHex = (first, second) => {
  if (!/^[a-f0-9]{64}$/.test(first) || !/^[a-f0-9]{64}$/.test(second)) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
};
const requestedOperationTimeout = clean(inputData.provider_operation_timeout_ms);
const operationTimeoutMs = requestedOperationTimeout ? Number(requestedOperationTimeout) : 20_000;
if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 25 || operationTimeoutMs > 25_000) {
  throw new Error("ARC_PROVIDER_DEADLINE: resolver operation timeout is invalid");
}
const operationDeadlineMs = Date.now() + operationTimeoutMs;
const remainingRequestMs = () => {
  const remaining = Math.floor(operationDeadlineMs - Date.now());
  if (remaining <= 0) throw new Error("ARC_PROVIDER_DEADLINE: resolver operation deadline exceeded");
  return Math.min(10_000, remaining);
};
const fetchBytesBounded = async (url, options, maximumBytes, validateResponse, label) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, remainingRequestMs());
  let reader;
  try {
    const response = await fetch(url, { ...options, redirect: "error", signal: controller.signal });
    validateResponse(response);
    const declared = response.headers?.get?.("content-length");
    if (declared && (!/^\d{1,9}$/.test(declared) || Number(declared) > maximumBytes)) {
      throw new Error(`${label}: response too large`);
    }
    reader = response.body?.getReader?.();
    if (!reader) throw new Error(`${label}: streaming response body required`);
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error(`${label}: invalid response chunk`);
      total += value.byteLength;
      if (total > maximumBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error(`${label}: response too large`);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (timedOut || error?.name === "AbortError") throw new Error(`${label}: bounded timeout exceeded`);
    throw error;
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock?.(); } catch {}
  }
};
const fetchJsonBounded = async (url, options, maximumBytes, validateResponse, label) => {
  const bytes = await fetchBytesBounded(url, options, maximumBytes, validateResponse, label);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${label}: response JSON invalid`); }
};

// The Stripe trigger payload and caller-mapped fields are notification hints only.
// Every payment, consent, customer, and preview-binding fact below comes from this
// authenticated read of the exact configured-mode Checkout Session.
const stripeHeaders = {
  Accept: "application/json",
  Authorization: `Basic ${Buffer.from(`${stripeApiKey}:`, "utf8").toString("base64")}`,
  "Stripe-Version": "2026-06-24.dahlia"
};
const stripeGet = async (resourceUrl, maximumBytes) => fetchJsonBounded(
  resourceUrl,
  { method: "GET", headers: stripeHeaders },
  maximumBytes,
  response => {
    if (response.url && response.url !== resourceUrl) throw new Error("ARC_PAYMENT_INVALID: Stripe API redirect rejected");
    if (!response.ok) throw new Error(`ARC_PAYMENT_INVALID: Stripe API retrieval failed (${response.status})`);
  },
  "ARC_PAYMENT_INVALID: Stripe API retrieval failed"
);
const stripeAccount = await stripeGet("https://api.stripe.com/v1/account", 128_000);
const authenticatedStripeAccountId = clean(stripeAccount?.id);
const stripeAccountIdSha256 = await sha256Hex(authenticatedStripeAccountId);
if (!stripeAccount || typeof stripeAccount !== "object" || Array.isArray(stripeAccount) || stripeAccount.object !== "account" ||
    !/^acct_[A-Za-z0-9]+$/.test(authenticatedStripeAccountId)) {
  throw new Error("ARC_STRIPE_ACCOUNT_INVALID: authenticated Stripe account identity is invalid");
}
const stripeSessionUrl = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand%5B%5D=line_items.data.price.product&expand%5B%5D=payment_intent.latest_charge`;
const session = await stripeGet(stripeSessionUrl, 2_000_000);
if (!session || typeof session !== "object" || Array.isArray(session) || session.object !== "checkout.session" || clean(session.id) !== sessionId) {
  throw new Error("ARC_PAYMENT_INVALID: Stripe Checkout Session identity mismatch");
}
const sessionCreated = session.created;
if (!Number.isSafeInteger(sessionCreated) || sessionCreated < 1_577_836_800 || sessionCreated * 1000 > Date.now() + 5 * 60 * 1000) {
  throw new Error("ARC_PAYMENT_INVALID: authenticated Checkout Session creation time");
}
const paymentIntent = session.payment_intent;
const latestCharge = paymentIntent?.latest_charge;
const paymentSucceededAt = latestCharge?.created;
if (!paymentIntent || typeof paymentIntent !== "object" || Array.isArray(paymentIntent) || paymentIntent.object !== "payment_intent" ||
    !/^pi_[A-Za-z0-9]+$/.test(clean(paymentIntent.id)) || clean(paymentIntent.status) !== "succeeded" ||
    paymentIntent.livemode !== session.livemode || paymentIntent.amount !== session.amount_total || paymentIntent.amount_received!==session.amount_total || clean(paymentIntent.currency) !== clean(session.currency) ||
    !latestCharge || typeof latestCharge !== "object" || Array.isArray(latestCharge) || latestCharge.object !== "charge" ||
    !/^ch_[A-Za-z0-9]+$/.test(clean(latestCharge.id)) || latestCharge.paid !== true || latestCharge.captured!==true || latestCharge.refunded!==false ||
    latestCharge.amount_refunded!==0 || latestCharge.disputed!==false || clean(latestCharge.status) !== "succeeded" ||
    latestCharge.livemode !== session.livemode || clean(typeof latestCharge.payment_intent === "object" ? latestCharge.payment_intent?.id : latestCharge.payment_intent) !== clean(paymentIntent.id) ||
    latestCharge.amount !== session.amount_total || clean(latestCharge.currency) !== clean(session.currency) ||
    !Number.isSafeInteger(paymentSucceededAt) || paymentSucceededAt < sessionCreated || paymentSucceededAt * 1000 > Date.now() + 5 * 60 * 1000) {
  throw new Error("ARC_PAYMENT_INVALID: immutable successful Charge and payment timestamp are required");
}
const deterministicEvidenceIssuedAt = new Date(paymentSucceededAt * 1000).toISOString();
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
if (!/^plink_[A-Za-z0-9]+$/.test(paymentLinkId)) throw new Error("ARC_PAYMENT_INVALID: Payment Link identity invalid");
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
    price.object !== "price" || !/^price_[A-Za-z0-9]+$/.test(clean(price.id)) || price.livemode !== stripeLiveModeEnabled ||
    clean(price.type) !== "one_time" || clean(price.currency) !== "usd" || price.unit_amount !== 500000 ||
    price.custom_unit_amount !== null || price.recurring !== null || clean(price.tax_behavior) !== "exclusive" ||
    !product || typeof product !== "object" || Array.isArray(product) || product.object !== "product" || !/^prod_[A-Za-z0-9]+$/.test(clean(product.id))) {
  throw new Error("ARC_PAYMENT_INVALID: expanded line item does not match the exact exclusive-tax ARC Price and Product");
}
if (termsConsent !== "accepted") throw new Error("ARC_PAYMENT_INVALID: terms_of_service consent must be accepted");
if (!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(termsVersion)) throw new Error("ARC_PAYMENT_INVALID: terms version invalid");
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
const customerAddressSha256 = await sha256Hex(canonicalJson({
  city: clean(customerAddress.city),
  country: clean(customerAddress.country),
  line1: clean(customerAddress.line1),
  line2: clean(customerAddress.line2),
  postal_code: clean(customerAddress.postal_code),
  state: clean(customerAddress.state)
}));
const authenticatedCustomerEmailSha256 = await sha256Hex(customerEmail);
// Payment identity is the authenticated Session.payment_link and its private
// create-before-provider reverse reservation. client_reference_id is buyer-
// controlled telemetry only: absent or mismatched values never redirect the
// authoritative Link mapping and never strand an otherwise exact paid sale.
const privateLinkReverseRaw=clean(inputData.private_link_reverse_state);
let privateLinkReverse,checkoutPolicy,linkReceipt,checkoutRecipientReservation;
try{
  privateLinkReverse=JSON.parse(privateLinkReverseRaw);
  checkoutPolicy=JSON.parse(clean(privateLinkReverse.checkout_policy_private));
  linkReceipt=JSON.parse(clean(privateLinkReverse.link_receipt_private));
  checkoutRecipientReservation=JSON.parse(clean(privateLinkReverse.checkout_recipient_reservation_private));
}catch{throw new Error("ARC_PAYMENT_INVALID: private Payment Link reverse reservation JSON");}
const exactKeys=(value,keys,label)=>{if(!value||typeof value!=="object"||Array.isArray(value)||JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))throw new Error(`ARC_PAYMENT_INVALID: ${label} fields`);};
exactKeys(privateLinkReverse,["version","scope","link_id_hmac_sha256","payment_link_id","checkout_reference","checkout_reference_sha256","checkout_policy_private","checkout_policy_sha256","checkout_recipient_reservation_private","checkout_recipient_reservation_hmac_sha256","link_receipt_private","link_receipt_sha256","link_receipt_hmac_sha256"],"private Link reverse reservation");
exactKeys(checkoutPolicy,["version","scope","checkout_binding_key_id","stripe_mode","stripe_account_id_sha256","price_id","product_id","amount_subtotal_minor_units","currency","quantity","terms_version","terms_document_sha256","automatic_tax_enabled","customer_address_source","price_tax_behavior","product_tax_code","tax_contract_version","tax_registrations","tax_registrations_sha256","adult_acknowledgement_key","name_collection_required","checkout_redirect_url","completed_sessions_limit","stripe_api_version","preview_source_repository","preview_folder","preview_path","approval_content_sha256","content_sha256","published_html_sha256","source_commit_sha","source_tree_sha","asset_publication_receipt_sha256","lead_route_recipient_hmac_sha256","claim_recipient_email_sha256","readiness_core_sha256","offer_snapshot_sha256","recipient_reservation_sha256"],"private checkout policy");
exactKeys(linkReceipt,["version","scope","payment_link_id","payment_link_url_sha256","checkout_reference_sha256","checkout_policy_sha256","provider_intent_sha256","create_request_sha256","stripe_mode","stripe_account_id_sha256","credential_key_id","readback_sha256"],"private Link receipt");
exactKeys(checkoutRecipientReservation,["version","scope","approval_content_sha256","checkout_offer_snapshot_sha256","checkout_binding_key_id","stripe_mode","lead_route_recipient_hmac_sha256","lead_notification_email","claim_recipient_email","claim_recipient_email_sha256"],"private recipient reservation");
if(!privateLinkReverse||canonicalJson(privateLinkReverse)!==privateLinkReverseRaw||privateLinkReverse.version!=="arc-private-checkout-link-reverse-v1"||
  privateLinkReverse.scope!=="private-link-id-to-approved-reference"||privateLinkReverse.payment_link_id!==paymentLinkId||
  privateLinkReverse.checkout_reference_sha256!==await sha256Hex(clean(privateLinkReverse.checkout_reference))||
  privateLinkReverse.checkout_policy_sha256!==await sha256Hex(clean(privateLinkReverse.checkout_policy_private))||
  checkoutPolicy.recipient_reservation_sha256!==await sha256Hex(clean(privateLinkReverse.checkout_recipient_reservation_private))||
  privateLinkReverse.link_receipt_sha256!==await sha256Hex(clean(privateLinkReverse.link_receipt_private))){
  throw new Error("ARC_PAYMENT_INVALID: private Payment Link reverse reservation binding");
}
const resolvedCheckoutReference=clean(privateLinkReverse.checkout_reference);
if (!/^v3_[A-Za-z0-9_-]{135}$/.test(resolvedCheckoutReference)) throw new Error("ARC_PAYMENT_INVALID: signed checkout reference v3");
let checkoutReferenceBytes;
try { checkoutReferenceBytes = Buffer.from(resolvedCheckoutReference.slice(3), "base64url"); } catch {}
if (!checkoutReferenceBytes || checkoutReferenceBytes.length !== 101 ||
    checkoutReferenceBytes.toString("base64url") !== resolvedCheckoutReference.slice(3)) {
  throw new Error("ARC_PAYMENT_INVALID: canonical checkout reference v3 encoding");
}
const checkoutReferencePayload = checkoutReferenceBytes.subarray(0, 69);
const checkoutSignature = checkoutReferenceBytes.subarray(69);
const checkoutBindingKeyId = checkoutReferencePayload.subarray(0, 1).toString("hex");
const clientReferenceId = checkoutReferencePayload.subarray(1, 5).toString("hex");
const approvalContentSha256 = checkoutReferencePayload.subarray(5, 37).toString("hex");
const checkoutConfigSnapshotSha256 = checkoutReferencePayload.subarray(37, 69).toString("hex");
const currentCheckoutBindingKeyId = clean(inputData.checkout_binding_key_id).toLowerCase();
if (!/^[a-f0-9]{2}$/.test(currentCheckoutBindingKeyId)) throw new Error("ARC_PAYMENT_INVALID: current checkout binding key id");
let retiredCheckoutBindingKeys;
const retiredCheckoutBindingKeysRaw = clean(inputData.retired_checkout_binding_keys_json);
try { retiredCheckoutBindingKeys = JSON.parse(retiredCheckoutBindingKeysRaw); } catch {
  throw new Error("ARC_PAYMENT_INVALID: retired checkout binding key registry JSON");
}
if (!retiredCheckoutBindingKeys || typeof retiredCheckoutBindingKeys !== "object" || Array.isArray(retiredCheckoutBindingKeys) ||
    canonicalJson(retiredCheckoutBindingKeys) !== retiredCheckoutBindingKeysRaw ||
    Object.keys(retiredCheckoutBindingKeys).some(id => !/^[a-f0-9]{2}$/.test(id) || id === currentCheckoutBindingKeyId ||
      typeof retiredCheckoutBindingKeys[id] !== "string" || retiredCheckoutBindingKeys[id].length < 32 || retiredCheckoutBindingKeys[id].length > 256)) {
  throw new Error("ARC_PAYMENT_INVALID: retired checkout binding key registry");
}
const selectedCheckoutBindingSecret = checkoutBindingKeyId === currentCheckoutBindingKeyId
  ? checkoutBindingSecret : retiredCheckoutBindingKeys[checkoutBindingKeyId];
if (!selectedCheckoutBindingSecret) throw new Error("ARC_PAYMENT_INVALID: checkout binding key id is not retained");
const checkoutBindingKey = await globalThis.crypto.subtle.importKey(
  "raw",
  encoder.encode(selectedCheckoutBindingSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
);
const checkoutReferenceDomain = encoder.encode(`arc-checkout-reference-v3\narcwebhq-cpu/arc-previews\narc-production\nstripe-${stripeMode}\n`);
const checkoutReferenceMessage = new Uint8Array(checkoutReferenceDomain.length + checkoutReferencePayload.length);
checkoutReferenceMessage.set(checkoutReferenceDomain, 0);
checkoutReferenceMessage.set(checkoutReferencePayload, checkoutReferenceDomain.length);
if (!(await globalThis.crypto.subtle.verify("HMAC", checkoutBindingKey, checkoutSignature, checkoutReferenceMessage))) {
  throw new Error("ARC_PAYMENT_INVALID: checkout reference signature mismatch");
}
const checkoutReferenceSha256=await sha256Hex(resolvedCheckoutReference);
const linkIdHmac=await (async()=>{const signature=await globalThis.crypto.subtle.sign("HMAC",checkoutBindingKey,encoder.encode(`arc-private-checkout-link-id-key-v1\n${stripeMode}\n${paymentLinkId}`));return [...new Uint8Array(signature)].map(byte=>byte.toString(16).padStart(2,"0")).join("");})();
if(privateLinkReverse.link_id_hmac_sha256!==linkIdHmac||privateLinkReverse.checkout_reference_sha256!==checkoutReferenceSha256||
  checkoutPolicy.version!=="arc-private-checkout-policy-v1"||checkoutPolicy.scope!=="one-approved-preview-one-private-payment-link"||
  canonicalJson(checkoutPolicy)!==clean(privateLinkReverse.checkout_policy_private)||privateLinkReverse.checkout_policy_sha256!==checkoutConfigSnapshotSha256||
  checkoutPolicy.checkout_binding_key_id!==checkoutBindingKeyId||checkoutPolicy.stripe_mode!==stripeMode||checkoutPolicy.stripe_account_id_sha256!==stripeAccountIdSha256||
  linkReceipt.version!=="arc-private-checkout-link-receipt-v1"||linkReceipt.scope!=="validated-one-use-private-payment-link"||canonicalJson(linkReceipt)!==clean(privateLinkReverse.link_receipt_private)||
  linkReceipt.payment_link_id!==paymentLinkId||linkReceipt.checkout_reference_sha256!==checkoutReferenceSha256||linkReceipt.checkout_policy_sha256!==checkoutConfigSnapshotSha256||
  linkReceipt.stripe_mode!==stripeMode||linkReceipt.stripe_account_id_sha256!==stripeAccountIdSha256){
  throw new Error("ARC_PAYMENT_INVALID: signed private Link policy/receipt binding");
}
const receiptSignature=clean(privateLinkReverse.link_receipt_hmac_sha256).toLowerCase();
if(!/^[a-f0-9]{64}$/.test(receiptSignature)||!await globalThis.crypto.subtle.verify("HMAC",checkoutBindingKey,Uint8Array.from(receiptSignature.match(/../g),byte=>Number.parseInt(byte,16)),encoder.encode(`arc-private-checkout-link-receipt-signature-v1\n${stripeMode}\n${clean(privateLinkReverse.link_receipt_private)}`))){
  throw new Error("ARC_PAYMENT_INVALID: private Link receipt signature");
}
const recipientSignature=clean(privateLinkReverse.checkout_recipient_reservation_hmac_sha256).toLowerCase();
if(checkoutRecipientReservation.version!=="arc1-checkout-recipient-reservation-v1"||checkoutRecipientReservation.scope!=="private-lead-recipient-for-approved-checkout"||
  checkoutRecipientReservation.checkout_binding_key_id!==checkoutBindingKeyId||checkoutRecipientReservation.stripe_mode!==stripeMode||
  checkoutRecipientReservation.approval_content_sha256!==approvalContentSha256||checkoutRecipientReservation.lead_route_recipient_hmac_sha256!==checkoutPolicy.lead_route_recipient_hmac_sha256||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkoutRecipientReservation.claim_recipient_email)||checkoutRecipientReservation.claim_recipient_email!==checkoutRecipientReservation.claim_recipient_email.toLowerCase()||
  checkoutRecipientReservation.claim_recipient_email_sha256!==await sha256Hex(checkoutRecipientReservation.claim_recipient_email)||
  checkoutPolicy.claim_recipient_email_sha256!==checkoutRecipientReservation.claim_recipient_email_sha256||
  !/^[a-f0-9]{64}$/.test(recipientSignature)||!await globalThis.crypto.subtle.verify("HMAC",checkoutBindingKey,Uint8Array.from(recipientSignature.match(/../g),byte=>Number.parseInt(byte,16)),encoder.encode(`arc1-checkout-recipient-reservation-signature-v1\n${stripeMode}\n${clean(privateLinkReverse.checkout_recipient_reservation_private)}`))){
  throw new Error("ARC_PAYMENT_INVALID: private recipient reservation binding");
}
const sessionMetadata=session.metadata&&typeof session.metadata==="object"&&!Array.isArray(session.metadata)?session.metadata:{};
if(clean(sessionMetadata.arc_v3_ref)!==resolvedCheckoutReference||clean(sessionMetadata.arc_v3_ref_sha256)!==checkoutReferenceSha256||
  clean(sessionMetadata.arc_policy_sha256)!==checkoutConfigSnapshotSha256||clean(sessionMetadata.arc_intent_sha256)!==linkReceipt.provider_intent_sha256||
  clean(sessionMetadata.arc_preview_commit)!==checkoutPolicy.source_commit_sha||clean(sessionMetadata.terms_version)!==checkoutPolicy.terms_version||
  clean(sessionMetadata.terms_document_sha256)!==checkoutPolicy.terms_document_sha256||clean(sessionMetadata.tax_contract_version)!==checkoutPolicy.tax_contract_version){
  throw new Error("ARC_PAYMENT_INVALID: copied private Payment Link metadata binding");
}
if(!/^[a-f0-9]{64}$/.test(linkReceipt.payment_link_url_sha256)||![linkReceipt.checkout_reference_sha256,linkReceipt.checkout_policy_sha256,linkReceipt.provider_intent_sha256,linkReceipt.create_request_sha256,linkReceipt.stripe_account_id_sha256,linkReceipt.readback_sha256].every(value=>/^[a-f0-9]{64}$/.test(value))||
  !/^[a-z0-9_-]{2,64}$/.test(linkReceipt.credential_key_id))throw new Error("ARC_PAYMENT_INVALID: private Link receipt field values");
const expectedLinkMetadata={arc_intent_sha256:linkReceipt.provider_intent_sha256,arc_policy_sha256:checkoutConfigSnapshotSha256,arc_preview_commit:checkoutPolicy.source_commit_sha,
  arc_v3_ref:resolvedCheckoutReference,arc_v3_ref_sha256:checkoutReferenceSha256,tax_contract_version:checkoutPolicy.tax_contract_version,
  terms_document_sha256:checkoutPolicy.terms_document_sha256,terms_version:checkoutPolicy.terms_version};
const createParams=new URLSearchParams(),setCreate=(name,value)=>createParams.append(name,String(value));
setCreate("line_items[0][price]",checkoutPolicy.price_id);setCreate("line_items[0][quantity]","1");setCreate("automatic_tax[enabled]","true");setCreate("billing_address_collection","auto");
setCreate("consent_collection[terms_of_service]","required");setCreate("custom_fields[0][key]","adultpurchaserack");setCreate("custom_fields[0][label][type]","custom");setCreate("custom_fields[0][label][custom]","I am 18+ and authorized to buy for this business");setCreate("custom_fields[0][optional]","false");setCreate("custom_fields[0][type]","dropdown");setCreate("custom_fields[0][dropdown][options][0][label]","I confirm");setCreate("custom_fields[0][dropdown][options][0][value]","accepted");
setCreate("name_collection[business][enabled]","true");setCreate("name_collection[business][optional]","false");setCreate("name_collection[individual][enabled]","true");setCreate("name_collection[individual][optional]","false");setCreate("after_completion[type]","redirect");setCreate("after_completion[redirect][url]",checkoutPolicy.checkout_redirect_url);setCreate("restrictions[completed_sessions][limit]","1");setCreate("allow_promotion_codes","false");setCreate("customer_creation","if_required");setCreate("invoice_creation[enabled]","false");setCreate("phone_number_collection[enabled]","false");setCreate("tax_id_collection[enabled]","false");setCreate("submit_type","auto");
for(const name of Object.keys(expectedLinkMetadata).sort())if(name!=="arc_intent_sha256")setCreate(`metadata[${name}]`,expectedLinkMetadata[name]);
if(await sha256Hex(createParams.toString())!==linkReceipt.provider_intent_sha256)throw new Error("ARC_PAYMENT_INVALID: private Link provider intent binding");
setCreate("metadata[arc_intent_sha256]",linkReceipt.provider_intent_sha256);
if(await sha256Hex(createParams.toString())!==linkReceipt.create_request_sha256)throw new Error("ARC_PAYMENT_INVALID: private Link create request binding");
const paymentLinkUrl=`https://api.stripe.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}?expand%5B%5D=line_items.data.price.product`;
const paidLink=await stripeGet(paymentLinkUrl,1_000_000),paidLinkItems=paidLink?.line_items,paidLinkItem=paidLinkItems?.data?.[0],paidLinkProduct=paidLinkItem?.price?.product;
const expectedAdultField=[{key:"adultpurchaserack",type:"dropdown",optional:false,label:{type:"custom",custom:"I am 18+ and authorized to buy for this business"},dropdown:{options:[{label:"I confirm",value:"accepted"}]}}];
const expectedNameCollection={business:{enabled:true,optional:false},individual:{enabled:true,optional:false}};
if(!paidLink||paidLink.object!=="payment_link"||paidLink.id!==paymentLinkId||paidLink.livemode!==stripeLiveModeEnabled||typeof paidLink.active!=="boolean"||
  !/^https:\/\/buy\.stripe\.com\/(?:test_)?[A-Za-z0-9]+$/.test(clean(paidLink.url))||await sha256Hex(clean(paidLink.url))!==linkReceipt.payment_link_url_sha256||paidLink.restrictions?.completed_sessions?.limit!==1||paidLink.automatic_tax?.enabled!==true||paidLink.billing_address_collection!=="auto"||paidLink.consent_collection?.terms_of_service!=="required"||paidLink.allow_promotion_codes!==false||canonicalJson(paidLink.custom_fields)!==canonicalJson(expectedAdultField)||canonicalJson(paidLink.name_collection)!==canonicalJson(expectedNameCollection)||paidLink.submit_type!=="auto"||paidLink.after_completion?.type!=="redirect"||clean(paidLink.after_completion?.redirect?.url)!==checkoutPolicy.checkout_redirect_url||paidLink.customer_creation!=="if_required"||paidLink.invoice_creation?.enabled!==false||paidLink.phone_number_collection?.enabled!==false||paidLink.tax_id_collection?.enabled!==false||paidLink.shipping_address_collection!=null||!Array.isArray(paidLink.optional_items)||paidLink.optional_items.length!==0||canonicalJson(paidLink.metadata)!==canonicalJson(expectedLinkMetadata)||
  !paidLinkItems||paidLinkItems.object!=="list"||paidLinkItems.has_more!==false||!Array.isArray(paidLinkItems.data)||paidLinkItems.data.length!==1||paidLinkItem.quantity!==1||clean(paidLinkItem.price?.id)!==checkoutPolicy.price_id||clean(paidLinkProduct?.id)!==checkoutPolicy.product_id)throw new Error("ARC_PAYMENT_INVALID: authenticated paid Payment Link differs from private creation receipt");
const historicalReadbackSha=await sha256Hex(canonicalJson({id:paymentLinkId,active:true,livemode:paidLink.livemode,url_sha256:linkReceipt.payment_link_url_sha256,metadata:expectedLinkMetadata,completed_sessions_limit:1,price_id:checkoutPolicy.price_id,product_id:checkoutPolicy.product_id}));
if(historicalReadbackSha!==linkReceipt.readback_sha256)throw new Error("ARC_PAYMENT_INVALID: private Payment Link historical readback digest");
const clientReferenceObservation=!rawClientReferenceId?"ABSENT":rawClientReferenceId===resolvedCheckoutReference?"MATCHED":"MISMATCH_REVIEW_REQUIRED";
const clientReferenceMismatchReviewKey=clientReferenceObservation==="MISMATCH_REVIEW_REQUIRED"?await (async()=>{const bytes=await globalThis.crypto.subtle.sign("HMAC",checkoutBindingKey,encoder.encode(`arc2-client-reference-mismatch-review-key-v1\n${stripeMode}\n${sessionId}\n${paymentLinkId}`));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");})():"";
const clientReferenceMismatchReview = clientReferenceObservation === "MISMATCH_REVIEW_REQUIRED" ? canonicalJson({
  version:"arc2-client-reference-mismatch-review-v1",scope:"buyer-supplied-client-reference-anomaly",status:"REVIEW_REQUIRED",
  record_key_hmac_sha256:clientReferenceMismatchReviewKey,
  checkout_session_id_hmac_sha256:await (async()=>{const bytes=await globalThis.crypto.subtle.sign("HMAC",checkoutBindingKey,encoder.encode(`arc2-session-review-key-v1\n${stripeMode}\n${sessionId}`));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");})(),
  link_id_hmac_sha256:linkIdHmac,expected_checkout_reference_sha256:checkoutReferenceSha256,
  observed_client_reference_sha256:await sha256Hex(rawClientReferenceId),checkout_policy_sha256:checkoutConfigSnapshotSha256,
  link_receipt_sha256:privateLinkReverse.link_receipt_sha256,stripe_mode:stripeMode,stripe_account_id_sha256:stripeAccountIdSha256
}) : "";
const clientReferenceMismatchReviewSha256=clientReferenceMismatchReview?await sha256Hex(clientReferenceMismatchReview):"";
const clientReferenceMismatchReviewHmacSha256=clientReferenceMismatchReview?await (async()=>{const bytes=await globalThis.crypto.subtle.sign("HMAC",checkoutBindingKey,encoder.encode(`arc2-client-reference-mismatch-review-signature-v1\n${stripeMode}\n${clientReferenceMismatchReview}`));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");})():"";
const existingClientReferenceMismatchReview=clean(inputData.client_reference_mismatch_review_state);
if(clientReferenceMismatchReview&&existingClientReferenceMismatchReview&&existingClientReferenceMismatchReview!==clientReferenceMismatchReview){
  throw new Error("ARC_PAYMENT_INVALID: client-reference mismatch review state conflict");
}
if(clientReferenceMismatchReview&&existingClientReferenceMismatchReview&&clean(inputData.client_reference_mismatch_review_hmac_sha256).toLowerCase()!==clientReferenceMismatchReviewHmacSha256)throw new Error("ARC_PAYMENT_INVALID: client-reference mismatch review HMAC readback");
if(clientReferenceMismatchReview&&!existingClientReferenceMismatchReview)return{status:"CLIENT_REFERENCE_MISMATCH_REVIEW_WRITE_REQUIRED",external_deploy_write_allowed_by_this_step:false,
  claim_invitation_allowed_by_this_step:false,email_allowed_by_this_step:false,handoff_allowed:false,client_reference_id_observation:clientReferenceObservation,
  client_reference_mismatch_review_record_key_hmac_sha256:clientReferenceMismatchReviewKey,client_reference_mismatch_review_state:clientReferenceMismatchReview,
  client_reference_mismatch_review_sha256:clientReferenceMismatchReviewSha256,client_reference_mismatch_review_hmac_sha256:clientReferenceMismatchReviewHmacSha256,
  client_reference_mismatch_review_write_required_before_handoff:true,state_adapter_contract:"create-or-exact mismatch review, then exact HMAC-bound readback before resolver replay"};

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28"
};
const github = async (url, maximumBytes = 2_000_000) => fetchJsonBounded(
  url,
  { method: "GET", headers },
  maximumBytes,
  response => {
    if (response.url && response.url !== url) throw new Error("ARC_GITHUB_FAILED: redirect rejected");
    if (!response.ok) throw new Error(`ARC_GITHUB_FAILED: ${response.status} ${response.statusText}`);
  },
  "ARC_GITHUB_FAILED"
);
const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
const checkoutTagName = `arc-checkout-ready-v3/${checkoutReferenceSha256}`;
const checkoutTagRef = await github(`${api}/git/ref/${encodeURIComponent(`tags/${checkoutTagName}`)}`, 64_000);
const sourceCommitSha = clean(checkoutTagRef.object?.sha).toLowerCase();
if (clean(checkoutTagRef.ref) !== `refs/tags/${checkoutTagName}` || clean(checkoutTagRef.object?.type) !== "commit" || !/^[a-f0-9]{40}$/.test(sourceCommitSha)||sourceCommitSha!==checkoutPolicy.source_commit_sha) {
  throw new Error("ARC_GITHUB_FAILED: exact immutable checkout source tag");
}
const sourceCommit=await github(`${api}/git/commits/${sourceCommitSha}`,128_000);
const sourceTreeSha=clean(sourceCommit.tree?.sha).toLowerCase();
if(clean(sourceCommit.sha).toLowerCase()!==sourceCommitSha||!/^[a-f0-9]{40}$/.test(sourceTreeSha)||sourceTreeSha!==checkoutPolicy.source_tree_sha){
  throw new Error("ARC_GITHUB_FAILED: immutable source commit tree differs from signed policy");
}
const tree = await github(`${api}/git/trees/${sourceTreeSha}?recursive=1`, 4_000_000);
if(clean(tree.sha).toLowerCase()!==sourceTreeSha)throw new Error("ARC_GITHUB_FAILED: recursive tree identity mismatch");
if (tree.truncated) throw new Error("ARC_FOLDER_LOOKUP_FAILED: repository tree was truncated");
const treeItems = Array.isArray(tree.tree) ? tree.tree : [];
const previewFolder = clean(checkoutPolicy.preview_folder).toLowerCase();
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/i.test(previewFolder)) {
  throw new Error("ARC_FOLDER_NOT_FOUND: resolved preview must be one root folder ending in eight hexadecimal characters");
}
const previewPath = `${previewFolder}/index.html`;
if(previewFolder.slice(-8)!==clientReferenceId||checkoutPolicy.preview_path!==previewPath||checkoutPolicy.preview_source_repository!==`${owner}/${repository}`||
  checkoutPolicy.approval_content_sha256!==approvalContentSha256||checkoutPolicy.checkout_binding_key_id!==checkoutBindingKeyId){
  throw new Error("ARC_FOLDER_NOT_FOUND: private Link policy preview binding");
}
const previewTreeItem = treeItems.find(item => item.path === previewPath && item.type === "blob" && item.mode === "100644");
if (!previewTreeItem || !/^[a-f0-9]{40}$/.test(clean(previewTreeItem.sha)) || !Number.isSafeInteger(previewTreeItem.size) || previewTreeItem.size < 1 || previewTreeItem.size > 500000) {
  throw new Error("ARC_FINALIZE_INVALID: immutable preview blob is missing");
}
const readBlob = async (sha, expectedSize) => {
  const blob = await github(`${api}/git/blobs/${sha}`, Math.min(1_800_000, Math.max(64_000, Math.ceil(expectedSize * 1.5) + 4096)));
  if (clean(blob.sha).toLowerCase() !== sha || blob.encoding !== "base64" || !Number.isSafeInteger(blob.size) || blob.size !== expectedSize ||
      typeof blob.content !== "string" || blob.content.length > Math.ceil(expectedSize / 3) * 4 + 4096) throw new Error("ARC_GITHUB_FAILED: immutable blob binding");
  const bytes = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
  if (bytes.toString("base64") !== blob.content.replace(/\s/g, "") || bytes.length !== expectedSize) throw new Error("ARC_GITHUB_FAILED: immutable blob bytes");
  return bytes;
};
const previewBytes = await readBlob(clean(previewTreeItem.sha), previewTreeItem.size);
let html = previewBytes.toString("utf8").trim();
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
await assertPaidPublicSurface(proofSourceHtml,"approved preview");
const checkoutConfigSnapshot=checkoutPolicy,checkoutConfigSnapshotRaw=clean(privateLinkReverse.checkout_policy_private);
if (checkoutConfigSnapshot.price_id !== clean(price.id) ||checkoutConfigSnapshot.product_id !== clean(product.id) || checkoutConfigSnapshot.stripe_account_id_sha256 !== stripeAccountIdSha256 ||
    checkoutConfigSnapshot.stripe_mode !== stripeMode || checkoutConfigSnapshot.amount_subtotal_minor_units !== session.amount_subtotal ||
    checkoutConfigSnapshot.currency !== clean(session.currency) || checkoutConfigSnapshot.quantity !== lineItem.quantity ||
    checkoutConfigSnapshot.terms_version !== termsVersion || checkoutConfigSnapshot.automatic_tax_enabled !== true || checkoutConfigSnapshot.completed_sessions_limit!==1||
    checkoutConfigSnapshot.customer_address_source !== "stripe_checkout_customer_details.address" ||checkoutConfigSnapshot.price_tax_behavior !== clean(price.tax_behavior) ||
    !/^txcd_[0-9]{8}$/.test(checkoutConfigSnapshot.product_tax_code) ||checkoutConfigSnapshot.tax_contract_version !== clean(session.metadata?.tax_contract_version) ||
    checkoutConfigSnapshot.adult_acknowledgement_key !== "adultpurchaserack" ||checkoutConfigSnapshot.name_collection_required !== true ||
    checkoutConfigSnapshot.checkout_redirect_url !== "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}" ||checkoutConfigSnapshot.stripe_api_version !== "2026-06-24.dahlia" ||
    !/^[a-f0-9]{64}$/.test(checkoutConfigSnapshot.asset_publication_receipt_sha256) ||!/^(?:|[a-f0-9]{64})$/.test(checkoutConfigSnapshot.lead_route_recipient_hmac_sha256)) {
  throw new Error("ARC_PAYMENT_INVALID: paid Session differs from immutable checkout configuration");
}
const snapshotRegistrations = checkoutConfigSnapshot.tax_registrations;
if (!Array.isArray(snapshotRegistrations) || snapshotRegistrations.length < 1 || snapshotRegistrations.length > 100 ||
    snapshotRegistrations.some(registration => !registration || typeof registration !== "object" || Array.isArray(registration) ||
      JSON.stringify(Object.keys(registration).sort()) !== JSON.stringify(taxRegistrationFields) ||
      !/^taxreg_[A-Za-z0-9]+$/.test(clean(registration.id)) || !/^[A-Z]{2}$/.test(clean(registration.country)) ||
      !/^[A-Z0-9-]{1,10}$/.test(clean(registration.state)) || !/^[a-z][a-z0-9_]{2,63}$/.test(clean(registration.type))) ||
    canonicalJson([...snapshotRegistrations].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) !== canonicalJson(snapshotRegistrations) ||
    new Set(snapshotRegistrations.map(registration => registration.id)).size !== snapshotRegistrations.length ||
    await sha256Hex(canonicalJson(snapshotRegistrations)) !== checkoutConfigSnapshot.tax_registrations_sha256 ||
    !snapshotRegistrations.some(registration => registration.country === "US" && registration.state === "WA" && registration.type === "state_sales_tax")) {
  throw new Error("ARC_TAX_INVALID: immutable tax registration snapshot");
}
// The registration identities were authenticated immediately before checkout
// eligibility and are covered by the retained checkout key. Do not re-read a
// mutable or later-expired registration after payment: the successful Charge,
// completed automatic-tax calculation, destination, and immutable snapshot are
// the historical fulfillment authority. Current registration state belongs to
// the pre-checkout readiness gate, not paid replay.
const taxRegistrationsSha256 = checkoutConfigSnapshot.tax_registrations_sha256;
const inertToolbar='<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview</strong>Built for this business. Purchase only if approved.</span><span data-arc-checkout-private>Checkout is available only through the private approval email.</span></aside>';
if((proofSourceHtml.match(/<aside class="arc-preview-toolbar"/g)||[]).length!==1||!proofSourceHtml.endsWith(`${inertToolbar}\n</body>\n</html>`)||/buy\.stripe\.com|\bplink_|client_reference_id|arc-checkout-config|v3_[A-Za-z0-9_-]{135}/i.test(proofSourceHtml)){
  throw new Error("ARC_FINALIZE_INVALID: exact inert terminal private-checkout notice is required");
}
const approvalHtml = proofSourceHtml.replace(`${inertToolbar}\n</body>\n</html>`, "</body>\n</html>");
if (await sha256Hex(approvalHtml) !== approvalContentSha256) {
  throw new Error("ARC_PAYMENT_INVALID: approved preview bytes do not match the checkout approval digest");
}

// Bind every preview-host asset in the approved bytes to the signed ARC1
// publication receipt and the same immutable main commit used for index.html.
const pagesRoot = "https://arcwebhq-cpu.github.io/arc-previews";
const previewHostReferences = [...new Set(html.match(/https:\/\/arcwebhq-cpu\.github\.io\/arc-previews\/[^"'()<>{}\s]+/gi) || [])];
const publicationRaw = clean(inputData.asset_publication_receipt_private);
const publicationExpectedSha256 = clean(inputData.asset_publication_receipt_sha256).toLowerCase();
let assetArtifacts = [];
if (previewHostReferences.length || publicationRaw || publicationExpectedSha256) {
  // ARC1 verified the receipt HMAC before approval and pinned its exact digest
  // into the checkout snapshot. Paid replay therefore authenticates the
  // historical receipt through the retained checkout key + immutable tag,
  // rather than depending on a mutable current publication-receipt secret.
  if (!/^[a-f0-9]{64}$/.test(publicationExpectedSha256) ||
      publicationExpectedSha256 !== checkoutConfigSnapshot.asset_publication_receipt_sha256) {
    throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication receipt digest differs from immutable checkout snapshot");
  }
  let publication;
  try { publication = JSON.parse(publicationRaw); } catch { throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication receipt JSON"); }
  const fields = ["version","scope","bridge_contract_sha256","delivery_id","bridge_evidence_sha256","private_asset_receipt_sha256",
    "intake_evidence_sha256","intake_state_digest_sha256","asset_manifest_sha256","asset_permission","repository","base_branch",
    "preview_branch","pages_base_url","public_folder_prefix","preview_folder","entries","status"];
  const entryFields = ["asset_id","content_type","git_blob_sha1","public_url","repository_path","role","sha256","size_bytes"];
  if (!publication || typeof publication !== "object" || Array.isArray(publication) || canonicalJson(publication) !== publicationRaw ||
      JSON.stringify(Object.keys(publication).sort()) !== JSON.stringify(fields.slice().sort()) ||
      publication.version !== "arc1-public-asset-publication-receipt-v1" || publication.scope !== "github-content-addressed-preview-assets" ||
      publication.bridge_contract_sha256 !== "e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841" ||
      ![publication.delivery_id,publication.bridge_evidence_sha256,publication.private_asset_receipt_sha256,publication.intake_evidence_sha256,
        publication.intake_state_digest_sha256,publication.asset_manifest_sha256].every(value => /^[a-f0-9]{64}$/.test(value)) ||
      publication.repository !== `${owner}/${repository}` || publication.base_branch !== "main" || publication.pages_base_url !== pagesRoot ||
      publication.preview_folder !== previewFolder || publication.public_folder_prefix !== clientReferenceId ||
      publication.preview_branch !== `arc-preview/${clientReferenceId}` || !Array.isArray(publication.entries) || publication.entries.length > 3 ||
      publication.status !== (publication.entries.length ? "VERIFIED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS") ||
      publication.asset_permission !== (publication.entries.length ? "Confirmed" : "") ||
      await sha256Hex(publicationRaw) !== publicationExpectedSha256) throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication receipt binding");
  const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const roles = new Set();
  const byPath = new Map();
  let aggregateBytes = 0;
  for (const entry of publication.entries) {
    const extension = extensions[entry?.content_type];
    const path = `${previewFolder}/assets/${entry?.sha256}.${extension}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(entryFields.slice().sort()) ||
        !/^[a-f0-9]{64}$/.test(entry.asset_id) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !/^[a-f0-9]{40}$/.test(entry.git_blob_sha1) ||
        !new Set(["hero_image_file","logo_file","supporting_image_file"]).has(entry.role) || roles.has(entry.role) || !extension ||
        entry.repository_path !== path || entry.public_url !== `${pagesRoot}/${path}` ||
        !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 1 || entry.size_bytes > 1250000) {
      throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication receipt entry");
    }
    roles.add(entry.role);
    aggregateBytes += entry.size_bytes;
    const previous = byPath.get(path);
    if (previous && (previous.sha256 !== entry.sha256 || previous.git_blob_sha1 !== entry.git_blob_sha1 || previous.size_bytes !== entry.size_bytes ||
        previous.content_type !== entry.content_type)) throw new Error("ARC_ARTIFACT_INVALID: duplicate content path conflict");
    byPath.set(path, entry);
  }
  if (aggregateBytes > 3000000 || byPath.size > 3) throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication aggregate");
  const receiptUrls = new Set([...byPath.values()].map(entry => entry.public_url));
  if (previewHostReferences.length !== receiptUrls.size || previewHostReferences.some(url => !receiptUrls.has(url)) ||
      [...receiptUrls].some(url => !previewHostReferences.includes(url))) {
    throw new Error("ARC_ARTIFACT_INVALID: approved HTML and publication receipt asset sets differ");
  }
  const expectedSubtree = new Map([[previewPath, { type: "blob", mode: "100644", sha: clean(previewTreeItem.sha) }]]);
  if (byPath.size) expectedSubtree.set(`${previewFolder}/assets`, { type: "tree", mode: "040000" });
  for (const [path, entry] of byPath) expectedSubtree.set(path, { type: "blob", mode: "100644", sha: entry.git_blob_sha1 });
  const subtreeItems = treeItems.filter(item => item.path === previewFolder || item.path.startsWith(`${previewFolder}/`));
  const permittedPaths = new Set([previewFolder, ...expectedSubtree.keys()]);
  if (subtreeItems.some(item => !permittedPaths.has(item.path)) ||
      subtreeItems.filter(item => item.path === previewFolder && item.type === "tree" && item.mode === "040000").length !== 1) {
    throw new Error("ARC_ARTIFACT_INVALID: immutable preview subtree contains extra or missing paths");
  }
  for (const [path, expected] of expectedSubtree) {
    const matches = subtreeItems.filter(item => item.path === path && item.type === expected.type && item.mode === expected.mode &&
      (!expected.sha || clean(item.sha).toLowerCase() === expected.sha));
    if (matches.length !== 1) throw new Error("ARC_ARTIFACT_INVALID: immutable preview subtree binding");
  }
  let uniqueAssetBytes = 0;
  for (const [repositoryPath, entry] of [...byPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const item = subtreeItems.find(candidate => candidate.path === repositoryPath);
    if (item.size !== entry.size_bytes) throw new Error("ARC_ARTIFACT_INVALID: immutable asset size");
    const bytes = await readBlob(entry.git_blob_sha1, entry.size_bytes);
    if (await sha256Bytes(bytes) !== entry.sha256) throw new Error("ARC_ARTIFACT_INVALID: immutable asset digest");
    const magic = entry.content_type === "image/png" ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      entry.content_type === "image/jpeg" ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217 :
      bytes.length >= 20 && bytes.subarray(0,4).toString("ascii") === "RIFF" && bytes.subarray(8,12).toString("ascii") === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length;
    if (!magic || /<(?:script|svg|html|iframe|object|embed)\b|javascript\s*:/.test(bytes.toString("latin1").toLowerCase())) {
      throw new Error("ARC_ARTIFACT_INVALID: immutable asset media type");
    }
    const localPath = repositoryPath.slice(`${previewFolder}/`.length);
    html = html.split(entry.public_url).join(localPath);
    assetArtifacts.push({ path: localPath, bytes });
    uniqueAssetBytes += bytes.length;
  }
  if (uniqueAssetBytes > 3000000) throw new Error("ARC_ARTIFACT_INVALID: paid bundle asset bytes exceed bounded handoff capacity");
}
if (/https:\/\/arcwebhq-cpu\.github\.io\/arc-previews(?:\/|["'?#]|$)/i.test(html)) {
  throw new Error("ARC_ARTIFACT_INVALID: paid production cannot depend on ARC preview hosting");
}
html = html.replace(`${inertToolbar}\n</body>\n</html>`, "</body>\n</html>");
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

const verifiedLeadNotificationEmail = clean(checkoutRecipientReservation.lead_notification_email).toLowerCase();
const leadRouteEvidenceSecret = clean(inputData.lead_route_evidence_secret);
const productionPath = "index.html";
// The final customer URL is unknowable until the customer-controlled Netlify
// site exists. Remove any source-preview URL instead of publishing a false
// canonical or coupling paid delivery to ARC Pages.
html = html
  .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "")
  .replace(/<meta\s+property=["']og:url["'][^>]*>\s*/gi, "");
// The signed artifact is the exact indexable production bundle. The ARC2
// handoff service deterministically derives a separate noindex-only preclaim
// header for the temporary source-owned deploy; final deployment restores
// these exact signed bytes.
const headersFile = `/*\n  Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
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
let leadRouteRecipientHmacSha256 = "";
if (hasLeadForm) {
  const recipientBinding = await globalThis.crypto.subtle.sign(
    "HMAC",
    checkoutBindingKey,
    encoder.encode(`arc-checkout-lead-recipient-v1\n${stripeMode}\n${verifiedLeadNotificationEmail}`)
  );
  leadRouteRecipientHmacSha256 = [...new Uint8Array(recipientBinding)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
if (checkoutConfigSnapshot.lead_route_recipient_hmac_sha256 !== leadRouteRecipientHmacSha256) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: mutable lead recipient differs from immutable checkout snapshot");
}
const privateHandoffValues = [
  { label: "Checkout Session id", value: sessionId },
  { label: "customer email", value: customerEmail },
  { label: "lead recipient", value: verifiedLeadNotificationEmail },
  { label: "lead evidence secret", value: leadRouteEvidenceSecret },
  { label: "purchaser name", value: collectedIndividualName },
  { label: "customer phone", value: session.customer_details?.phone },
  ...["line1", "line2", "city", "postal_code"].map(field => ({ label: `customer address ${field}`, value: customerAddress?.[field] }))
];
for (const [label, publicContent] of [["production HTML", html], ["headers file", headersFile]]) {
  assertPrivateValuesAbsent(publicContent, privateHandoffValues, label);
}
const relativeReferences = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(reference => !/^(?:https?:|mailto:|tel:|#|\/|\?)/i.test(reference) &&
    !assetArtifacts.some(artifact => artifact.path === reference));
if (relativeReferences.length) {
  throw new Error(`ARC_ARTIFACT_INVALID: unresolved relative assets: ${[...new Set(relativeReferences)].join(",")}`);
}
if (/<base\b/i.test(html)) throw new Error("ARC_ARTIFACT_INVALID: HTML base elements are forbidden");
const referencedLocalAssets = new Set(html.match(/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)/gi)?.map(value => value.toLowerCase()) || []);
const bundledLocalAssets = new Set(assetArtifacts.map(artifact => artifact.path));
if (referencedLocalAssets.size !== bundledLocalAssets.size || [...referencedLocalAssets].some(path => !bundledLocalAssets.has(path)) ||
    [...bundledLocalAssets].some(path => !referencedLocalAssets.has(path))) {
  throw new Error("ARC_ARTIFACT_INVALID: production HTML and local asset bundle differ");
}
await assertPaidPublicSurface(html,"final paid HTML");
const productionSha256 = await sha256Hex(html);
const bundleArtifacts = [
  { path: "_headers", bytes: Buffer.from(headersFile, "utf8") },
  ...assetArtifacts.sort((left, right) => left.path.localeCompare(right.path)),
  { path: productionPath, bytes: Buffer.from(html, "utf8") }
];
if (bundleArtifacts.reduce((total, artifact) => total + artifact.bytes.length, 0) > 3510000) {
  throw new Error("ARC_ARTIFACT_INVALID: paid bundle aggregate exceeds bounded handoff capacity");
}
const bundleFingerprint = await sha256Bytes(Buffer.concat(bundleArtifacts.flatMap(artifact => [
  Buffer.from(`${artifact.path}\0`, "utf8"), artifact.bytes, Buffer.from("\0", "utf8")
])));
const artifactManifest = [];
for (const artifact of bundleArtifacts) {
  artifactManifest.push({
    path: artifact.path,
    sha256: await sha256Bytes(artifact.bytes),
    size: artifact.bytes.length
  });
}
const artifactManifestPrivate = canonicalJson(artifactManifest);
const artifactManifestSha256 = await sha256Hex(artifactManifestPrivate);
const artifactEvidenceIssuedAt = deterministicEvidenceIssuedAt;
const checkoutSourceTagSha256 = await sha256Hex(`refs/tags/${checkoutTagName}`);
const assetPublicationReceiptSha256 = publicationExpectedSha256 || await sha256Hex("arc1-no-publication-receipt-v1");
if (checkoutConfigSnapshot.asset_publication_receipt_sha256 !== assetPublicationReceiptSha256) {
  throw new Error("ARC_ARTIFACT_INVALID: mutable asset receipt differs from immutable checkout snapshot");
}
const handoffArtifactEvidence = canonicalJson({
  version: "arc2-handoff-artifact-evidence-v3",
  scope: "netlify-claimable-deploy-artifacts",
  approval_content_sha256: approvalContentSha256,
  asset_publication_receipt_sha256: assetPublicationReceiptSha256,
  checkout_config_snapshot_sha256: checkoutConfigSnapshotSha256,
  checkout_binding_key_id: checkoutBindingKeyId,
  checkout_reference_sha256: checkoutReferenceSha256,
  preview_folder: previewFolder,
  preview_source_commit_sha: sourceCommitSha,
  preview_source_repository: `${owner}/${repository}`,
  preview_source_tag_sha256: checkoutSourceTagSha256,
  lead_route_mode: hasLeadForm ? "netlify_form" : "not_required",
  lead_route_form_name: leadRouteFormName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
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
  encoder.encode(`arc2-handoff-artifact-evidence-signature-v3\n${handoffArtifactEvidence}`)
);
const handoffArtifactEvidenceHmacSha256 = [...new Uint8Array(handoffArtifactEvidenceSignatureBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");
const claimRecipientEmail=checkoutRecipientReservation.claim_recipient_email;
const claimRecipientEmailSha256=checkoutRecipientReservation.claim_recipient_email_sha256;
const payerEmailSha256=authenticatedCustomerEmailSha256;
const paymentEvidence = canonicalJson({
  version: "arc2-payment-evidence-v3",
  scope: "authoritative-stripe-checkout-session",
  checkout_session_id: sessionId,
  stripe_account_id_sha256: stripeAccountIdSha256,
  client_reference_id: resolvedCheckoutReference,
  client_reference_id_sha256: checkoutReferenceSha256,
  client_reference_id_observation:clientReferenceObservation,
  client_reference_mismatch_review_required:Boolean(clientReferenceMismatchReview),
  client_reference_mismatch_review_record_key_hmac_sha256:clientReferenceMismatchReviewKey,
  client_reference_mismatch_review_state:clientReferenceMismatchReview,
  client_reference_mismatch_review_sha256:clientReferenceMismatchReviewSha256,
  client_reference_mismatch_review_hmac_sha256:clientReferenceMismatchReviewHmacSha256,
  approval_content_sha256: approvalContentSha256,
  asset_publication_receipt_sha256: assetPublicationReceiptSha256,
  checkout_config_snapshot: checkoutConfigSnapshotRaw,
  checkout_config_snapshot_sha256: checkoutConfigSnapshotSha256,
  preview_folder: previewFolder,
  preview_source_commit_sha: sourceCommitSha,
  preview_source_repository: `${owner}/${repository}`,
  preview_source_tag_sha256: checkoutSourceTagSha256,
  production_content_sha256: productionSha256,
  artifact_manifest_sha256: artifactManifestSha256,
  handoff_artifact_evidence_sha256: handoffArtifactEvidenceSha256,
  bundle_fingerprint: bundleFingerprint,
  claim_recipient_email_sha256:claimRecipientEmailSha256,
  payer_email_sha256:payerEmailSha256,
  livemode: stripeLiveModeEnabled,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: amountTax,
  amount_total_minor_units: session.amount_total,
  payment_link_id: paymentLinkId,
  payment_intent_id:clean(paymentIntent.id),
  charge_id:clean(latestCharge.id),
  price_id: checkoutConfigSnapshot.price_id,
  product_id: checkoutConfigSnapshot.product_id,
  product_tax_code: checkoutConfigSnapshot.product_tax_code,
  price_tax_behavior: "exclusive",
  automatic_tax_enabled: true,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "historical_precheckout_snapshot",
  tax_contract_version: "arc-tax-v1",
  tax_registrations_sha256: taxRegistrationsSha256,
  customer_address_sha256: customerAddressSha256,
  customer_address_country: customerAddressCountry,
  customer_address_state: customerAddressState,
  quantity: 1,
  terms_of_service_consent: "accepted",
  terms_version: checkoutConfigSnapshot.terms_version,
  adult_purchaser_acknowledgement: "accepted"
});
const paymentEvidenceSignatureBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  checkoutBindingKey,
  encoder.encode(`arc2-payment-evidence-signature-v3\n${stripeMode}\n${paymentEvidence}`)
);
const paymentEvidenceHmacSha256 = [...new Uint8Array(paymentEvidenceSignatureBytes)]
  .map(byte => byte.toString(16).padStart(2, "0"))
  .join("");
const paymentEvidenceSha256 = await sha256Hex(paymentEvidence);
const deployArtifactsPrivate = canonicalJson(bundleArtifacts.map(artifact => ({
  path: artifact.path,
  content_base64: artifact.bytes.toString("base64")
})));
return {
  status: "READY_FOR_CLAIMABLE_DEPLOY",
  external_deploy_write_allowed_by_this_step: false,
  claim_invitation_allowed_by_this_step: false,
  email_allowed_by_this_step: false,
  payment_verification_status: `verified_${stripeMode}_payment_from_stripe_api`,
  stripe_session_retrieved: true,
  checkout_session_id: sessionId,
  client_reference_id: resolvedCheckoutReference,
  client_reference_id_observation:clientReferenceObservation,
  client_reference_mismatch_review_record_key_hmac_sha256:clientReferenceMismatchReviewKey,
  client_reference_mismatch_review_state:clientReferenceMismatchReview,
  client_reference_mismatch_review_sha256:clientReferenceMismatchReviewSha256,
  client_reference_mismatch_review_hmac_sha256:clientReferenceMismatchReviewHmacSha256,
  client_reference_mismatch_review_write_required_before_handoff:false,
  livemode: stripeLiveModeEnabled,
  payment_status: "paid",
  currency: "usd",
  amount_total_minor_units: session.amount_total,
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: amountTax,
  payment_link_id: paymentLinkId,
  payment_intent_id:clean(paymentIntent.id),
  charge_id:clean(latestCharge.id),
  price_id: checkoutConfigSnapshot.price_id,
  stripe_account_id_sha256: stripeAccountIdSha256,
  product_id: checkoutConfigSnapshot.product_id,
  product_tax_code: checkoutConfigSnapshot.product_tax_code,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "historical_precheckout_snapshot",
  customer_address_sha256: customerAddressSha256,
  tax_registrations_sha256: taxRegistrationsSha256,
  quantity: 1,
  terms_of_service_consent: "accepted",
  terms_version: checkoutConfigSnapshot.terms_version,
  adult_purchaser_acknowledgement: "accepted",
  payment_evidence_private: paymentEvidence,
  payment_evidence_sha256: paymentEvidenceSha256,
  payment_evidence_hmac_sha256: paymentEvidenceHmacSha256,
  dedupe_key: `arc2:${sessionId}`,
  preview_folder: previewFolder,
  preview_file_path: previewPath,
  preview_blob_sha: clean(previewTreeItem.sha),
  preview_source_commit_sha: sourceCommitSha,
  preview_source_tag: checkoutTagName,
  preview_source_tag_sha256: checkoutSourceTagSha256,
  approval_content_sha256: approvalContentSha256,
  checkout_config_snapshot_private: checkoutConfigSnapshotRaw,
  checkout_config_snapshot_sha256: checkoutConfigSnapshotSha256,
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
  customer_email:claimRecipientEmail,
  customer_email_sha256:claimRecipientEmailSha256,
  claim_recipient_email:claimRecipientEmail,
  claim_recipient_email_sha256:claimRecipientEmailSha256,
  payer_email_sha256:payerEmailSha256,
  lead_route_status: hasLeadForm ? "pending_live_staging_evidence" : "not_required",
  lead_route_evidence_required: hasLeadForm,
  lead_route_evidence_version: hasLeadForm ? "arc-lead-route-evidence-v1" : "",
  lead_route_form_name: leadRouteFormName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
  verified_lead_notification_email: hasLeadForm ? verifiedLeadNotificationEmail : ""
};
