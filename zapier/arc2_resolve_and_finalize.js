// ARC2 Code step — authenticate one paid Stripe Checkout Session, resolve the
// immutable v4 five-page approval, and produce the exact signed payload accepted
// by arc-site. This step performs read-only provider calls. It never writes a
// deploy, claim, state row, repository object, tag, or email.
const clean = value => String(value == null ? "" : value).trim();
const encoder = new TextEncoder();
const HTML_PATHS = Object.freeze([
  "about/index.html",
  "contact/index.html",
  "process/index.html",
  "services/index.html",
  "index.html"
]);
const APPROVAL_PATHS = Object.freeze([
  "index.html",
  "services/index.html",
  "about/index.html",
  "process/index.html",
  "contact/index.html"
]);
const PAGE_KEYS = Object.freeze({
  "index.html": "home",
  "services/index.html": "services",
  "about/index.html": "about",
  "process/index.html": "process",
  "contact/index.html": "contact"
});
const ROOT_ASSET_PATTERN = /^\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const OFFER_CONTRACT_ID = "arc-fixed-five-page-offer-v1";
const DELIVERABLE = "fixed-five-page-marketing-website-v1";
const TERMS_VERSION = "2026-08-25";
const STRIPE_API_VERSION = "2026-07-29.dahlia";
const PREVIEW_TOOLBAR = '<aside class="arc-preview-toolbar" aria-label="ARC preview status"><span><strong>ARC preview</strong>Five-page website concept for this business.</span><span data-arc-checkout-private>Review and payment are available through your private review link.</span></aside>';
const CONTENT_SECURITY_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEADERS_FILE = `/*\n  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
const SAFE_CAPS = Object.freeze({
  maxAssetCount: 3,
  maxAssetBytes: 1_250_000,
  maxAggregateAssetBytes: 3_000_000,
  maxHtmlBytes: 150_000,
  maxAggregateHtmlBytes: 500_000,
  maxHeadersBytes: 10_000,
  maxArtifactBytes: 3_510_000,
  maxDeployArtifactsJsonBytes: 4_700_000
});

if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256 and SHA-256 are required");
}

const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC_CANONICAL_INVALID: plain JSON values are required");
};
const sha256Bytes = async bytes => {
  const input = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const hmacBytes = async (key, message) => new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key,
  typeof message === "string" ? encoder.encode(message) : message));
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
const fromHex = value => Uint8Array.from((value.match(/../g) || []), byte => Number.parseInt(byte, 16));
const parseCanonical = (raw, label, minimum = 2, maximum = 100_000) => {
  if (typeof raw !== "string" || raw.length < minimum || raw.length > maximum || raw !== raw.trim()) {
    throw new Error(`ARC_PAYMENT_INVALID: ${label} canonical JSON`);
  }
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`ARC_PAYMENT_INVALID: ${label} JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || canonicalJson(value) !== raw) {
    throw new Error(`ARC_PAYMENT_INVALID: ${label} canonical JSON`);
  }
  return value;
};
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`ARC_PAYMENT_INVALID: ${label} fields`);
  }
};
const verifyHmac = async (key, signature, message, label) => {
  if (!HEX_64_PATTERN.test(signature) ||
      !await globalThis.crypto.subtle.verify("HMAC", key, fromHex(signature), encoder.encode(message))) {
    throw new Error(`ARC_PAYMENT_INVALID: ${label} HMAC`);
  }
};
const framedDigest = async entries => sha256Bytes(Buffer.concat(entries.flatMap(entry => [
  Buffer.from(`${entry.path}\0`, "utf8"), Buffer.from(entry.bytes), Buffer.from("\0", "utf8")
])));

// Decode repeatedly so private values cannot be hidden with URL or HTML entity
// encoding. Every published, approval, and finalized page is scanned.
const decodeEntities = value => String(value == null ? "" : value)
  .replace(/&#(\d+);?/g, (_, code) => { const point = Number(code); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
  .replace(/&#x([0-9a-f]+);?/gi, (_, code) => { const point = Number.parseInt(code, 16); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
  .replace(/&(amp|quot|apos|lt|gt|colon|sol|period|commat|percnt|num);/gi, (_, name) => ({
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", sol: "/", period: ".", commat: "@", percnt: "%", num: "#"
  })[name.toLowerCase()]);
const recursivelyDecode = value => {
  let current = String(value == null ? "" : value);
  for (let pass = 0; pass < 5; pass += 1) {
    let next = decodeEntities(current);
    try { next = decodeURIComponent(next.replace(/\+/g, "%20")); } catch {}
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC");
};
const privacyCanonical = value => recursivelyDecode(value).toLowerCase()
  .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const privacyCompact = value => privacyCanonical(value).replace(/[^\p{L}\p{N}@]+/gu, "");
const assertPrivateValuesAbsent = (content, privateValues, label) => {
  const decoded = recursivelyDecode(content);
  const text = recursivelyDecode(decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const urlSurfaces = [...decoded.matchAll(/\b(?:href|src|srcset|action|content|style)\s*=\s*["']([^"']*)["']/gi)]
    .map(match => recursivelyDecode(match[1]));
  const surfaces = [decoded, text, ...urlSurfaces].map(value => ({ canonical: privacyCanonical(value), compact: privacyCompact(value) }));
  for (const item of privateValues) {
    const privateCanonical = privacyCanonical(item?.value);
    if (!privateCanonical) continue;
    const privateCompact = privacyCompact(privateCanonical);
    if (surfaces.some(surface => surface.canonical.includes(privateCanonical) ||
        (privateCompact.length >= 7 && surface.compact.includes(privateCompact)))) {
      throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private ${item.label}`);
    }
  }
};

const normalizePublicSurface = value => {
  let current = String(value ?? "");
  for (let pass = 0; pass < 5; pass += 1) {
    let next = current.replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/&(amp|period|colon|sol|percnt|num|tab|newline);/gi, (_, name) => ({
        amp: "&", period: ".", colon: ":", sol: "/", percnt: "%", num: "#", tab: "\t", newline: "\n"
      })[name.toLowerCase()])
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\\x([0-9a-f]{2})/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
      .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
      .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
      .replace(/[\u3002\uff0e\uff61]/g, ".")
      .replace(/(?:%[0-9a-f]{2})+/gi, encoded => { try { return decodeURIComponent(encoded); } catch { return encoded; } });
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC").toLowerCase();
};
const PRIVATE_CHECKOUT_PATTERN = /buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v[34]_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v[12]|arc1-checkout-recipient-reservation-v[12]|arc1-preview-readiness-(?:core|observation)-v[12]|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v[12]|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;
const TRUSTED_SCRIPT_HASHES = ["36441ce93ccc1f13622e64f34ba6e43a039cdb453e1f40010dd8c399c97751f4"];
const TRUSTED_SCRIPT_MANIFEST_SHA256 = "1ef7f0088cdcf042b1593fbc11d7ea2d3c47e9ff92c94caf2f578179e3993685";
const assertPaidPublicSurface = async (html, label) => {
  const raw = String(html ?? "");
  const scripts = raw.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) || [];
  const hashes = (await Promise.all(scripts.map(script => sha256Bytes(script)))).sort();
  if ((raw.match(/<script\b/gi) || []).length !== scripts.length || (raw.match(/<\/script\b/gi) || []).length !== scripts.length ||
      canonicalJson(hashes) !== canonicalJson(TRUSTED_SCRIPT_HASHES) || await sha256Bytes(hashes.join("\n")) !== TRUSTED_SCRIPT_MANIFEST_SHA256) {
    throw new Error(`ARC_FINALIZE_INVALID: ${label} reviewed script manifest changed`);
  }
  const nonScript = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const decoded = normalizePublicSurface(nonScript);
  const compact = decoded.replace(/[\s\u0000-\u001f\u007f]+/g, "");
  if (/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScript) || /\p{Default_Ignorable_Code_Point}/u.test(decoded) ||
      /<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(raw) || /<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style\s*>/i.test(decoded) ||
      /\bstyle\s*=\s*(?:"[^"]*\\|'[^']*\\)/i.test(decoded) || PRIVATE_CHECKOUT_PATTERN.test(decoded) || PRIVATE_CHECKOUT_PATTERN.test(compact)) {
    throw new Error(`ARC_FINALIZE_INVALID: ${label} contains private or executable output`);
  }
  for (const match of nonScript.matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    const attribute = match[1] ?? match[2] ?? match[3] ?? "";
    const normalized = normalizePublicSurface(attribute);
    let parsed;
    try { parsed = new URL(normalized, "https://arc.invalid/"); } catch {}
    const host = parsed?.hostname?.toLowerCase() || "";
    if (/%(?![0-9a-f]{2})/i.test(attribute) || /\p{Default_Ignorable_Code_Point}/u.test(normalized) ||
        host === "buy.stripe.com" || host.endsWith(".buy.stripe.com") || new Set(["javascript:", "vbscript:"]).has(parsed?.protocol) ||
        PRIVATE_CHECKOUT_PATTERN.test(normalized) || PRIVATE_CHECKOUT_PATTERN.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g, ""))) {
      throw new Error(`ARC_FINALIZE_INVALID: ${label} contains unsafe URL output`);
    }
  }
};

const sessionId = clean(inputData.checkout_session_id || inputData.session_id);
const stripeLiveModeFlag = clean(inputData.stripe_live_mode_enabled).toLowerCase();
if (!new Set(["", "false", "true"]).has(stripeLiveModeFlag)) throw new Error("ARC_STRIPE_MODE_INVALID: stripe_live_mode_enabled must be true or false");
const stripeLiveModeEnabled = stripeLiveModeFlag === "true";
const stripeMode = stripeLiveModeEnabled ? "live" : "test";
const stripeApiKey = clean(inputData.stripe_api_key || inputData.stripe_test_api_key);
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const handoffArtifactEvidenceSecret = clean(inputData.handoff_artifact_evidence_secret);
const assetPublicationReceiptSecret = clean(inputData.asset_publication_receipt_secret);
const owner = clean(inputData.preview_source_github_owner || inputData.github_owner);
const repository = clean(inputData.preview_source_github_repo || inputData.github_repo);
const branch = clean(inputData.preview_source_github_branch || inputData.github_branch || "main");
const githubToken = clean(inputData.github_token);
if (!new RegExp(`^cs_${stripeMode}_[A-Za-z0-9_]+$`).test(sessionId)) throw new Error(`ARC_PAYMENT_INVALID: ${stripeMode} checkout session id`);
if (!new RegExp(`^rk_${stripeMode}_[A-Za-z0-9_]{12,}$`).test(stripeApiKey)) throw new Error(`ARC_PAYMENT_INVALID: restricted Stripe ${stripeMode} API key is required`);
if (checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256) throw new Error("ARC_PAYMENT_INVALID: checkout binding secret must be 32–256 characters");
if (handoffArtifactEvidenceSecret.length < 32 || handoffArtifactEvidenceSecret.length > 256) throw new Error("ARC_ARTIFACT_INVALID: handoff artifact evidence secret must be 32–256 characters");
if (assetPublicationReceiptSecret.length < 32 || assetPublicationReceiptSecret.length > 256 ||
    new Set([checkoutBindingSecret, handoffArtifactEvidenceSecret, assetPublicationReceiptSecret]).size !== 3) {
  throw new Error("ARC_ARTIFACT_INVALID: distinct publication receipt secret must be 32–256 characters");
}
if (!githubToken || owner !== "arcwebhq-cpu" || repository !== "arc-previews" || branch !== "main") {
  throw new Error("ARC_GITHUB_INVALID: ARC2 requires arcwebhq-cpu/arc-previews main and a token");
}

const currentCheckoutBindingKeyId = clean(inputData.checkout_binding_key_id).toLowerCase();
const retiredCheckoutBindingKeysRaw = clean(inputData.retired_checkout_binding_keys_json);
let retiredCheckoutBindingKeys;
try { retiredCheckoutBindingKeys = JSON.parse(retiredCheckoutBindingKeysRaw); } catch {}
if (!/^[a-f0-9]{2}$/.test(currentCheckoutBindingKeyId) || !retiredCheckoutBindingKeys ||
    typeof retiredCheckoutBindingKeys !== "object" || Array.isArray(retiredCheckoutBindingKeys) ||
    canonicalJson(retiredCheckoutBindingKeys) !== retiredCheckoutBindingKeysRaw ||
    Object.entries(retiredCheckoutBindingKeys).some(([id, value]) => !/^[a-f0-9]{2}$/.test(id) || id === currentCheckoutBindingKeyId ||
      typeof value !== "string" || value.length < 32 || value.length > 256) ||
    new Set(Object.values(retiredCheckoutBindingKeys)).size !== Object.values(retiredCheckoutBindingKeys).length ||
    Object.values(retiredCheckoutBindingKeys).some(value =>
      value === checkoutBindingSecret || value === handoffArtifactEvidenceSecret || value === assetPublicationReceiptSecret)) {
  throw new Error("ARC_PAYMENT_INVALID: checkout binding key registry");
}

// Reject v3 and every v3/v4 cross-pair before any provider access. Frozen v3
// handoff replay remains an arc-site state-service responsibility; it can never
// originate from this fresh resolver.
const privateLinkReverseRaw = clean(inputData.private_link_reverse_state);
const privateLinkReverse = parseCanonical(privateLinkReverseRaw, "private Link reverse reservation", 200, 80_000);
exactKeys(privateLinkReverse, ["version", "scope", "link_id_hmac_sha256", "payment_link_id", "checkout_reference", "checkout_reference_sha256",
  "checkout_policy_private", "checkout_policy_sha256", "checkout_recipient_reservation_private", "checkout_recipient_reservation_hmac_sha256",
  "link_receipt_private", "link_receipt_sha256", "link_receipt_hmac_sha256"], "private Link reverse reservation");
if (privateLinkReverse.version !== "arc-private-checkout-link-reverse-v1" || privateLinkReverse.scope !== "private-link-id-to-approved-reference" ||
    !/^v4_[A-Za-z0-9_-]{135}$/.test(privateLinkReverse.checkout_reference)) {
  throw new Error("ARC_PAYMENT_INVALID: fresh ARC2 requires an exact checkout reference v4 reservation");
}
const checkoutPolicyRaw = clean(privateLinkReverse.checkout_policy_private);
const checkoutPolicy = parseCanonical(checkoutPolicyRaw, "private checkout policy", 200, 24_000);
const checkoutRecipientRaw = clean(privateLinkReverse.checkout_recipient_reservation_private);
const checkoutRecipient = parseCanonical(checkoutRecipientRaw, "private recipient reservation", 200, 24_000);
const linkReceiptRaw = clean(privateLinkReverse.link_receipt_private);
const linkReceipt = parseCanonical(linkReceiptRaw, "private Link receipt", 100, 16_000);
const policyFields = ["adult_acknowledgement_key", "amount_subtotal_minor_units", "approval_content_sha256", "asset_publication_receipt_sha256", "automatic_tax_enabled",
  "checkout_binding_key_id", "checkout_redirect_url", "claim_recipient_email_sha256", "completed_sessions_limit", "content_sha256", "currency", "customer_address_source",
  "deliverable", "lead_route_recipient_hmac_sha256", "name_collection_required", "offer_contract_id", "offer_snapshot_sha256", "page_count", "preview_folder",
  "preview_paths", "preview_source_repository", "price_id", "price_tax_behavior", "product_id", "product_tax_code", "published_site_sha256", "quantity",
  "readiness_core_sha256", "recipient_reservation_sha256", "scope", "source_commit_sha", "source_tree_sha", "stripe_account_id_sha256", "stripe_api_version",
  "stripe_mode", "tax_contract_version", "tax_registrations", "tax_registrations_sha256", "terms_document_sha256", "terms_version", "version"];
const recipientFields = ["approval_content_sha256", "checkout_binding_key_id", "checkout_offer_snapshot_sha256", "claim_recipient_email", "claim_recipient_email_sha256",
  "deliverable", "lead_notification_email", "lead_route_form_name", "lead_route_mode", "lead_route_recipient_hmac_sha256", "offer_contract_id", "page_count",
  "preview_folder", "preview_paths", "production_content_sha256", "published_preview_bundle_sha256", "scope", "stripe_mode", "version"];
const receiptFields = ["checkout_policy_sha256", "checkout_reference_sha256", "create_request_sha256", "credential_key_id", "payment_link_id",
  "payment_link_url_sha256", "provider_intent_sha256", "readback_contract", "readback_sha256", "scope", "stripe_account_id_sha256", "stripe_mode", "version"];
exactKeys(checkoutPolicy, policyFields, "private checkout policy");
exactKeys(checkoutRecipient, recipientFields, "private recipient reservation");
exactKeys(linkReceipt, receiptFields, "private Link receipt");
const previewFolder = clean(checkoutPolicy.preview_folder).toLowerCase();
const expectedPreviewPaths = HTML_PATHS.map(path => `${previewFolder}/${path}`);
if (checkoutPolicy.version !== "arc-private-checkout-policy-v2" ||
    checkoutPolicy.scope !== "one-approved-five-page-preview-one-private-payment-link" ||
    checkoutPolicy.offer_contract_id !== OFFER_CONTRACT_ID || checkoutPolicy.deliverable !== DELIVERABLE || checkoutPolicy.page_count !== 5 ||
    checkoutPolicy.preview_source_repository !== "arcwebhq-cpu/arc-previews" || !/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder) ||
    canonicalJson(checkoutPolicy.preview_paths) !== canonicalJson(expectedPreviewPaths) || checkoutPolicy.stripe_mode !== stripeMode ||
    checkoutPolicy.amount_subtotal_minor_units !== 500000 || checkoutPolicy.currency !== "usd" || checkoutPolicy.quantity !== 1 ||
    checkoutPolicy.terms_version !== TERMS_VERSION || !HEX_64_PATTERN.test(checkoutPolicy.terms_document_sha256) ||
    checkoutPolicy.automatic_tax_enabled !== true || checkoutPolicy.customer_address_source !== "stripe_checkout_customer_details.address" ||
    checkoutPolicy.price_tax_behavior !== "exclusive" || !/^txcd_[0-9]{8}$/.test(checkoutPolicy.product_tax_code) ||
    checkoutPolicy.tax_contract_version !== "arc-tax-v1" || checkoutPolicy.adult_acknowledgement_key !== "adultpurchaserack" ||
    checkoutPolicy.name_collection_required !== true || checkoutPolicy.checkout_redirect_url !== "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}" ||
    checkoutPolicy.completed_sessions_limit !== 1 || checkoutPolicy.stripe_api_version !== STRIPE_API_VERSION ||
    !/^price_[A-Za-z0-9]+$/.test(checkoutPolicy.price_id) || !/^prod_[A-Za-z0-9]+$/.test(checkoutPolicy.product_id) ||
    !/^[a-f0-9]{40}$/.test(checkoutPolicy.source_commit_sha) || !/^[a-f0-9]{40}$/.test(checkoutPolicy.source_tree_sha) ||
    !["stripe_account_id_sha256", "approval_content_sha256", "content_sha256", "published_site_sha256", "asset_publication_receipt_sha256",
      "readiness_core_sha256", "offer_snapshot_sha256", "recipient_reservation_sha256"].every(field => HEX_64_PATTERN.test(checkoutPolicy[field])) ||
    !/^(?:|[a-f0-9]{64})$/.test(checkoutPolicy.lead_route_recipient_hmac_sha256)) {
  throw new Error("ARC_PAYMENT_INVALID: exact v4 five-page private checkout policy");
}

let packedReference;
try { packedReference = Buffer.from(privateLinkReverse.checkout_reference.slice(3), "base64url"); } catch {}
if (!packedReference || packedReference.length !== 101 || packedReference.toString("base64url") !== privateLinkReverse.checkout_reference.slice(3)) {
  throw new Error("ARC_PAYMENT_INVALID: canonical checkout reference v4 encoding");
}
const referencePayload = packedReference.subarray(0, 69);
const checkoutBindingKeyId = referencePayload.subarray(0, 1).toString("hex");
const folderPrefix = referencePayload.subarray(1, 5).toString("hex");
const approvalContentSha256 = referencePayload.subarray(5, 37).toString("hex");
const checkoutConfigSnapshotSha256 = referencePayload.subarray(37, 69).toString("hex");
const selectedCheckoutBindingSecret = checkoutBindingKeyId === currentCheckoutBindingKeyId
  ? checkoutBindingSecret : retiredCheckoutBindingKeys[checkoutBindingKeyId];
if (!selectedCheckoutBindingSecret) throw new Error("ARC_PAYMENT_INVALID: checkout binding key id is not retained");
const checkoutBindingKey = await globalThis.crypto.subtle.importKey("raw", encoder.encode(selectedCheckoutBindingSecret),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const referenceDomain = encoder.encode(`arc-checkout-reference-v4\narcwebhq-cpu/arc-previews\narc-production\nstripe-${stripeMode}\n`);
const referenceMessage = new Uint8Array(referenceDomain.length + referencePayload.length);
referenceMessage.set(referenceDomain);
referenceMessage.set(referencePayload, referenceDomain.length);
if (!await globalThis.crypto.subtle.verify("HMAC", checkoutBindingKey, packedReference.subarray(69), referenceMessage)) {
  throw new Error("ARC_PAYMENT_INVALID: checkout reference v4 signature mismatch");
}
const checkoutReference = privateLinkReverse.checkout_reference;
const checkoutReferenceSha256 = await sha256Bytes(checkoutReference);
if (previewFolder.slice(-8) !== folderPrefix || checkoutPolicy.checkout_binding_key_id !== checkoutBindingKeyId ||
    checkoutPolicy.approval_content_sha256 !== approvalContentSha256 || checkoutConfigSnapshotSha256 !== await sha256Bytes(checkoutPolicyRaw) ||
    checkoutPolicy.preview_folder !== previewFolder || privateLinkReverse.checkout_policy_sha256 !== checkoutConfigSnapshotSha256 ||
    privateLinkReverse.checkout_reference_sha256 !== checkoutReferenceSha256 || await sha256Bytes(checkoutReference) !== checkoutReferenceSha256) {
  throw new Error("ARC_PAYMENT_INVALID: checkout reference v4 policy binding");
}

const paymentLinkId = clean(privateLinkReverse.payment_link_id);
const linkIdHmac = hex(await hmacBytes(checkoutBindingKey, `arc-private-checkout-link-id-key-v1\n${stripeMode}\n${paymentLinkId}`));
if (!/^plink_[A-Za-z0-9]+$/.test(paymentLinkId) || privateLinkReverse.link_id_hmac_sha256 !== linkIdHmac ||
    linkReceipt.version !== "arc-private-checkout-link-receipt-v1" || linkReceipt.scope !== "validated-one-use-private-payment-link" ||
    linkReceipt.payment_link_id !== paymentLinkId || linkReceipt.checkout_reference_sha256 !== checkoutReferenceSha256 ||
    linkReceipt.checkout_policy_sha256 !== checkoutConfigSnapshotSha256 || linkReceipt.stripe_mode !== stripeMode ||
    linkReceipt.readback_contract !== "product-tax-code-bound-v1" ||
    linkReceipt.stripe_account_id_sha256 !== checkoutPolicy.stripe_account_id_sha256 || !/^[a-z0-9_-]{2,64}$/.test(linkReceipt.credential_key_id) ||
    !["payment_link_url_sha256", "provider_intent_sha256", "create_request_sha256", "readback_sha256"].every(field => HEX_64_PATTERN.test(linkReceipt[field])) ||
    privateLinkReverse.link_receipt_sha256 !== await sha256Bytes(linkReceiptRaw)) {
  throw new Error("ARC_PAYMENT_INVALID: v4 private Link receipt binding");
}
await verifyHmac(checkoutBindingKey, clean(privateLinkReverse.link_receipt_hmac_sha256).toLowerCase(),
  `arc-private-checkout-link-receipt-signature-v1\n${stripeMode}\n${linkReceiptRaw}`, "private Link receipt");

const recipientHmac = clean(privateLinkReverse.checkout_recipient_reservation_hmac_sha256).toLowerCase();
if (checkoutRecipient.version !== "arc1-checkout-recipient-reservation-v2" ||
    checkoutRecipient.scope !== "private-recipients-for-approved-five-page-checkout" ||
    checkoutRecipient.offer_contract_id !== OFFER_CONTRACT_ID || checkoutRecipient.deliverable !== DELIVERABLE || checkoutRecipient.page_count !== 5 ||
    checkoutRecipient.preview_folder !== previewFolder || canonicalJson(checkoutRecipient.preview_paths) !== canonicalJson(expectedPreviewPaths) ||
    checkoutRecipient.approval_content_sha256 !== approvalContentSha256 || checkoutRecipient.published_preview_bundle_sha256 !== checkoutPolicy.content_sha256 ||
    checkoutRecipient.production_content_sha256 !== checkoutPolicy.published_site_sha256 ||
    checkoutRecipient.checkout_offer_snapshot_sha256 !== checkoutPolicy.offer_snapshot_sha256 ||
    checkoutRecipient.checkout_binding_key_id !== checkoutBindingKeyId || checkoutRecipient.stripe_mode !== stripeMode ||
    checkoutRecipient.lead_route_recipient_hmac_sha256 !== checkoutPolicy.lead_route_recipient_hmac_sha256 ||
    !new Set(["netlify_form", "not_required"]).has(checkoutRecipient.lead_route_mode) ||
    (checkoutRecipient.lead_route_mode === "netlify_form"
      ? (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(checkoutRecipient.lead_route_form_name) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkoutRecipient.lead_notification_email) || !HEX_64_PATTERN.test(checkoutRecipient.lead_route_recipient_hmac_sha256))
      : (checkoutRecipient.lead_route_form_name !== "" || checkoutRecipient.lead_notification_email !== "" || checkoutRecipient.lead_route_recipient_hmac_sha256 !== "")) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkoutRecipient.claim_recipient_email) ||
    checkoutRecipient.claim_recipient_email !== checkoutRecipient.claim_recipient_email.toLowerCase() ||
    checkoutRecipient.claim_recipient_email_sha256 !== await sha256Bytes(checkoutRecipient.claim_recipient_email) ||
    checkoutRecipient.claim_recipient_email_sha256 !== checkoutPolicy.claim_recipient_email_sha256 ||
    checkoutPolicy.recipient_reservation_sha256 !== await sha256Bytes(checkoutRecipientRaw)) {
  throw new Error("ARC_PAYMENT_INVALID: v4 private recipient reservation binding");
}
await verifyHmac(checkoutBindingKey, recipientHmac,
  `arc1-checkout-recipient-reservation-signature-v2\n${stripeMode}\n${checkoutRecipientRaw}`, "private recipient reservation");
const expectedLeadRecipientHmac = checkoutRecipient.lead_route_mode === "netlify_form"
  ? hex(await hmacBytes(checkoutBindingKey, `arc-checkout-lead-recipient-v1\n${stripeMode}\n${checkoutRecipient.lead_notification_email}`)) : "";
if (expectedLeadRecipientHmac !== checkoutRecipient.lead_route_recipient_hmac_sha256) {
  throw new Error("ARC_PAYMENT_INVALID: v4 lead recipient reservation binding");
}

const taxRegistrationFields = ["country", "id", "state", "type"];
const taxRegistrations = checkoutPolicy.tax_registrations;
if (!Array.isArray(taxRegistrations) || taxRegistrations.length < 1 || taxRegistrations.length > 100 ||
    taxRegistrations.some(registration => !registration || typeof registration !== "object" || Array.isArray(registration) ||
      JSON.stringify(Object.keys(registration).sort()) !== JSON.stringify(taxRegistrationFields) ||
      !/^taxreg_[A-Za-z0-9]+$/.test(registration.id) || !/^[A-Z]{2}$/.test(registration.country) ||
      !/^[A-Z0-9-]{1,10}$/.test(registration.state) || !/^[a-z][a-z0-9_]{2,63}$/.test(registration.type)) ||
    canonicalJson([...taxRegistrations].sort((left, right) => left.id.localeCompare(right.id))) !== canonicalJson(taxRegistrations) ||
    new Set(taxRegistrations.map(registration => registration.id)).size !== taxRegistrations.length ||
    await sha256Bytes(canonicalJson(taxRegistrations)) !== checkoutPolicy.tax_registrations_sha256 ||
    !taxRegistrations.some(registration => registration.country === "US" && registration.state === "WA" && registration.type === "state_sales_tax")) {
  throw new Error("ARC_TAX_INVALID: immutable tax registration snapshot");
}

const publicationRaw = clean(inputData.asset_publication_receipt_private);
const publicationExpectedSha256 = clean(inputData.asset_publication_receipt_sha256).toLowerCase();
const publicationHmacSha256 = clean(inputData.asset_publication_receipt_hmac_sha256).toLowerCase();
const publication = parseCanonical(publicationRaw, "ARC1 publication receipt", 200, 100_000);
const publicationFields = ["version", "scope", "bridge_contract_sha256", "delivery_id", "bridge_evidence_sha256", "private_asset_receipt_sha256",
  "intake_evidence_sha256", "intake_state_digest_sha256", "asset_manifest_sha256", "asset_permission", "asset_visual_review_authority_verified",
  "asset_visual_review_key_id", "asset_visual_review_reviewer_id_sha256", "asset_visual_review_sha256", "repository", "base_branch",
  "preview_branch", "pages_base_url", "public_folder_prefix", "preview_folder", "entries", "status"];
const publicationEntryFields = ["asset_id", "content_type", "git_blob_sha1", "public_url", "repository_path", "role", "sha256", "size_bytes"];
exactKeys(publication, publicationFields, "ARC1 publication receipt");
if (publication.version !== "arc1-public-asset-publication-receipt-v1" || publication.scope !== "github-content-addressed-preview-assets" ||
    publication.bridge_contract_sha256 !== "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2" ||
    publication.repository !== "arcwebhq-cpu/arc-previews" || publication.base_branch !== "main" ||
    publication.pages_base_url !== "https://arcwebhq-cpu.github.io/arc-previews" || publication.preview_folder !== previewFolder ||
    publication.public_folder_prefix !== folderPrefix || publication.preview_branch !== `arc-preview/${folderPrefix}` ||
    !Array.isArray(publication.entries) || publication.entries.length > SAFE_CAPS.maxAssetCount ||
    publication.status !== (publication.entries.length ? "HUMAN_REVIEWED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS") ||
    publication.asset_permission !== (publication.entries.length ? "Confirmed rights and no visible watermark v1" : "") ||
    (publication.entries.length ?
      (publication.asset_visual_review_authority_verified !== true || !/^[a-f0-9]{2}$/.test(publication.asset_visual_review_key_id) ||
        !HEX_64_PATTERN.test(publication.asset_visual_review_reviewer_id_sha256) || !HEX_64_PATTERN.test(publication.asset_visual_review_sha256)) :
      (publication.asset_visual_review_authority_verified !== false || publication.asset_visual_review_key_id !== "" ||
        publication.asset_visual_review_reviewer_id_sha256 !== "" || publication.asset_visual_review_sha256 !== "")) ||
    !["delivery_id", "bridge_evidence_sha256", "private_asset_receipt_sha256", "intake_evidence_sha256", "intake_state_digest_sha256", "asset_manifest_sha256"]
      .every(field => HEX_64_PATTERN.test(publication[field])) ||
    !HEX_64_PATTERN.test(publicationExpectedSha256) || publicationExpectedSha256 !== checkoutPolicy.asset_publication_receipt_sha256 ||
    await sha256Bytes(publicationRaw) !== publicationExpectedSha256) {
  throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication receipt binding");
}
const publicationKey = await globalThis.crypto.subtle.importKey("raw", encoder.encode(assetPublicationReceiptSecret),
  { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
await verifyHmac(publicationKey, publicationHmacSha256,
  `arc1-public-asset-publication-receipt-v1\n${publicationRaw}`, "ARC1 publication receipt");
const contentTypeExtensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const assetReceiptByRepositoryPath = new Map();
const assetRoles = new Set();
let declaredAssetBytes = 0;
for (const entry of publication.entries) {
  exactKeys(entry, publicationEntryFields, "ARC1 publication receipt entry");
  const extension = contentTypeExtensions[entry.content_type];
  const repositoryPath = `${previewFolder}/assets/${entry.sha256}.${extension}`;
  if (!extension || !HEX_64_PATTERN.test(entry.asset_id) || !HEX_64_PATTERN.test(entry.sha256) || !/^[a-f0-9]{40}$/.test(entry.git_blob_sha1) ||
      !new Set(["hero_image_file", "logo_file", "supporting_image_file"]).has(entry.role) || assetRoles.has(entry.role) ||
      entry.repository_path !== repositoryPath || entry.public_url !== `${publication.pages_base_url}/${repositoryPath}` ||
      !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 1 || entry.size_bytes > SAFE_CAPS.maxAssetBytes ||
      assetReceiptByRepositoryPath.has(repositoryPath)) {
    throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication receipt entry");
  }
  assetRoles.add(entry.role);
  declaredAssetBytes += entry.size_bytes;
  assetReceiptByRepositoryPath.set(repositoryPath, entry);
}
if (declaredAssetBytes > SAFE_CAPS.maxAggregateAssetBytes) throw new Error("ARC_ARTIFACT_INVALID: ARC1 publication aggregate");

const requestedOperationTimeout = clean(inputData.provider_operation_timeout_ms);
const operationTimeoutMs = requestedOperationTimeout ? Number(requestedOperationTimeout) : 25_000;
if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 100 || operationTimeoutMs > 25_000) {
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
    if (declared && (!/^\d{1,9}$/.test(declared) || Number(declared) > maximumBytes)) throw new Error(`${label}: response too large`);
    reader = response.body?.getReader?.();
    if (!reader) throw new Error(`${label}: streaming response body required`);
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error(`${label}: invalid response chunk`);
      total += value.byteLength;
      if (total > maximumBytes) { try { await reader.cancel(); } catch {} throw new Error(`${label}: response too large`); }
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

const stripeHeaders = {
  Accept: "application/json",
  Authorization: `Basic ${Buffer.from(`${stripeApiKey}:`, "utf8").toString("base64")}`,
  "Stripe-Version": STRIPE_API_VERSION
};
const stripeGet = async (resourceUrl, maximumBytes) => fetchJsonBounded(resourceUrl, { method: "GET", headers: stripeHeaders }, maximumBytes,
  response => {
    if (response.url && response.url !== resourceUrl) throw new Error("ARC_PAYMENT_INVALID: Stripe API redirect rejected");
    if (!response.ok) throw new Error(`ARC_PAYMENT_INVALID: Stripe API retrieval failed (${response.status})`);
  }, "ARC_PAYMENT_INVALID: Stripe API retrieval failed");
const stripeAccount = await stripeGet("https://api.stripe.com/v1/account", 128_000);
const authenticatedStripeAccountId = clean(stripeAccount?.id);
const stripeAccountIdSha256 = await sha256Bytes(authenticatedStripeAccountId);
if (!stripeAccount || stripeAccount.object !== "account" || !/^acct_[A-Za-z0-9]+$/.test(authenticatedStripeAccountId) ||
    stripeAccountIdSha256 !== checkoutPolicy.stripe_account_id_sha256) {
  throw new Error("ARC_STRIPE_ACCOUNT_INVALID: authenticated Stripe account identity is invalid");
}

const stripeSessionUrl = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand%5B%5D=line_items.data.price.product&expand%5B%5D=line_items.data.taxes&expand%5B%5D=payment_intent.latest_charge`;
const session = await stripeGet(stripeSessionUrl, 2_000_000);
const paymentIntent = session?.payment_intent;
const latestCharge = paymentIntent?.latest_charge;
const sessionCreated = session?.created;
const paymentSucceededAt = latestCharge?.created;
if (!session || session.object !== "checkout.session" || clean(session.id) !== sessionId || session.livemode !== stripeLiveModeEnabled ||
    session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid" || session.currency !== "usd" ||
    !Number.isSafeInteger(sessionCreated) || sessionCreated < 1_577_836_800 || sessionCreated * 1000 > Date.now() + 300_000 ||
    !paymentIntent || paymentIntent.object !== "payment_intent" || !/^pi_[A-Za-z0-9]+$/.test(clean(paymentIntent.id)) || paymentIntent.status !== "succeeded" ||
    paymentIntent.livemode !== session.livemode || paymentIntent.amount !== session.amount_total || paymentIntent.amount_received !== session.amount_total || paymentIntent.currency !== "usd" ||
    !latestCharge || latestCharge.object !== "charge" || !/^ch_[A-Za-z0-9]+$/.test(clean(latestCharge.id)) || latestCharge.paid !== true ||
    latestCharge.captured !== true || latestCharge.refunded !== false || latestCharge.amount_refunded !== 0 || latestCharge.disputed !== false || latestCharge.status !== "succeeded" ||
    latestCharge.livemode !== session.livemode || clean(typeof latestCharge.payment_intent === "object" ? latestCharge.payment_intent?.id : latestCharge.payment_intent) !== clean(paymentIntent.id) ||
    latestCharge.amount !== session.amount_total || latestCharge.currency !== "usd" || !Number.isSafeInteger(paymentSucceededAt) ||
    paymentSucceededAt < sessionCreated || paymentSucceededAt * 1000 > Date.now() + 300_000) {
  throw new Error("ARC_PAYMENT_INVALID: immutable completed payment and Charge are required");
}
const deterministicEvidenceIssuedAt = new Date(paymentSucceededAt * 1000).toISOString();
const amountTax = session.total_details?.amount_tax;
if (session.amount_subtotal !== 500000 || !Number.isSafeInteger(amountTax) || amountTax < 0 || amountTax > 500000 ||
    !Number.isSafeInteger(session.amount_total) || session.amount_total !== 500000 + amountTax ||
    session.total_details?.amount_discount !== 0 || session.total_details?.amount_shipping !== 0 ||
    session.automatic_tax?.enabled !== true || session.automatic_tax?.status !== "complete") {
  throw new Error("ARC_TAX_INVALID: total must equal the $5,000 subtotal plus completed Stripe destination tax");
}
const lineItems = session.line_items;
const lineItem = lineItems?.data?.[0];
const price = lineItem?.price;
const product = price?.product;
const productTaxCode = clean(typeof product?.tax_code === "object" ? product.tax_code?.id : product?.tax_code);
if (!lineItems || lineItems.object !== "list" || lineItems.has_more !== false || !Array.isArray(lineItems.data) || lineItems.data.length !== 1 ||
    lineItem?.object !== "item" || lineItem.quantity !== 1 || lineItem.currency !== "usd" || lineItem.amount_subtotal !== 500000 ||
    lineItem.amount_discount !== 0 || lineItem.amount_tax !== amountTax || lineItem.amount_total !== session.amount_total ||
    price?.object !== "price" || price.id !== checkoutPolicy.price_id || price.livemode !== stripeLiveModeEnabled || price.type !== "one_time" ||
    price.currency !== "usd" || price.unit_amount !== 500000 || price.custom_unit_amount !== null || price.recurring !== null || price.tax_behavior !== "exclusive" ||
    product?.object !== "product" || product.id !== checkoutPolicy.product_id) {
  throw new Error("ARC_PAYMENT_INVALID: expanded line item differs from the exact v4 offer");
}
if (productTaxCode !== checkoutPolicy.product_tax_code) {
  throw new Error("ARC_TAX_REVIEW_REQUIRED: current Checkout Product tax code differs from the signed creation-time policy; manual tax review is required");
}
const lineItemTaxes = lineItem.taxes;
const knownTaxabilityReasons = new Set(["customer_exempt", "not_collecting", "not_subject_to_tax", "not_supported", "portion_product_exempt", "portion_reduced_rated",
  "portion_standard_rated", "product_exempt", "product_exempt_holiday", "proportionally_rated", "reduced_rated", "reverse_charge", "standard_rated",
  "taxable_basis_reduced", "zero_rated"]);
if (!Array.isArray(lineItemTaxes) || lineItemTaxes.length < 1 || lineItemTaxes.length > 32 ||
    lineItemTaxes.some(tax => !tax || typeof tax !== "object" || Array.isArray(tax) || !Number.isSafeInteger(tax.amount) || tax.amount < 0 ||
      !knownTaxabilityReasons.has(clean(tax.taxability_reason))) ||
    lineItemTaxes.reduce((total, tax) => total + tax.amount, 0) !== amountTax ||
    (amountTax > 0 && !lineItemTaxes.some(tax => tax.amount > 0 && clean(tax.taxability_reason) === "standard_rated")) ||
    lineItemTaxes.some(tax => tax.amount > 0 && clean(tax.taxability_reason) !== "standard_rated")) {
  throw new Error("ARC_TAX_INVALID: expanded Stripe line-item tax breakdown is required and must reconcile");
}
const customerDetailsEmail = clean(session.customer_details?.email).toLowerCase();
const customerEmail = clean(session.customer_email).toLowerCase();
if (customerDetailsEmail && customerEmail && customerDetailsEmail !== customerEmail) throw new Error("ARC_HANDOFF_INVALID: Stripe customer email fields disagree");
const payerEmail = customerDetailsEmail || customerEmail;
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) throw new Error("ARC_HANDOFF_INVALID: Stripe payer email");
const collectedBusinessName = clean(session.collected_information?.business_name);
const collectedIndividualName = clean(session.collected_information?.individual_name);
if (!collectedBusinessName || collectedBusinessName.length > 120 || /[\r\n<>]/.test(collectedBusinessName) ||
    !collectedIndividualName || collectedIndividualName.length > 120 || /[\r\n<>]/.test(collectedIndividualName)) {
  throw new Error("ARC_HANDOFF_INVALID: required Stripe business and individual names");
}
const adultFields = (Array.isArray(session.custom_fields) ? session.custom_fields : []).filter(field => field?.key === "adultpurchaserack");
const adultValue = clean(adultFields[0]?.dropdown?.value).toLowerCase();
if (session.consent?.terms_of_service !== "accepted" || clean(session.metadata?.terms_version) !== TERMS_VERSION ||
    adultFields.length !== 1 || adultFields[0].type !== "dropdown" || adultFields[0].optional !== false || adultValue !== "accepted" ||
    adultFields[0].label?.type !== "custom" || adultFields[0].label?.custom !== "I am 18+ and authorized to buy for this business") {
  throw new Error("ARC_PAYMENT_INVALID: exact 2026-08-25 terms and adult purchaser consent are required");
}
const customerAddress = session.customer_details?.address;
const requiredAddressFields = ["city", "country", "line1", "postal_code"];
const customerAddressCountry = clean(customerAddress?.country);
const customerAddressState = clean(customerAddress?.state);
if (!customerAddress || typeof customerAddress !== "object" || Array.isArray(customerAddress) || session.customer_details?.tax_exempt !== "none" ||
    requiredAddressFields.some(field => !clean(customerAddress[field]) || clean(customerAddress[field]).length > 120 || /[\r\n<>]/.test(clean(customerAddress[field]))) ||
    !/^[A-Z]{2}$/.test(customerAddressCountry) || !/^[A-Z0-9-]{0,10}$/.test(customerAddressState) ||
    (customerAddressCountry === "US" && !/^[A-Z]{2}$/.test(customerAddressState)) ||
    (customerAddressCountry === "US" && customerAddressState === "WA" && amountTax <= 0)) {
  throw new Error("ARC_TAX_INVALID: verified Stripe destination address and applicable tax are required");
}
const taxabilityReasons = [...new Set(lineItemTaxes.map(tax => clean(tax.taxability_reason)))].sort();
const ratedTaxabilityReasons = new Set(["portion_reduced_rated", "portion_standard_rated", "proportionally_rated", "reduced_rated", "standard_rated", "taxable_basis_reduced"]);
if (amountTax === 0 && (taxabilityReasons.some(reason => ratedTaxabilityReasons.has(reason)) ||
    taxabilityReasons.some(reason => ["customer_exempt", "not_supported", "reverse_charge"].includes(reason)) ||
    (taxabilityReasons.includes("not_collecting") && productTaxCode !== "txcd_00000000"))) {
  throw new Error("ARC_TAX_REVIEW_REQUIRED: zero tax is unexplained or requires Product, registration, exemption, reverse-charge, or unsupported-tax review");
}
const lineItemTaxesSha256 = await sha256Bytes(canonicalJson(lineItemTaxes.map(tax => ({
  amount_minor_units: tax.amount,
  taxability_reason: clean(tax.taxability_reason)
}))));
const customerAddressSha256 = await sha256Bytes(canonicalJson({
  city: clean(customerAddress.city), country: customerAddressCountry, line1: clean(customerAddress.line1), line2: clean(customerAddress.line2),
  postal_code: clean(customerAddress.postal_code), state: customerAddressState
}));

const expectedLinkMetadata = {
  arc_intent_sha256: linkReceipt.provider_intent_sha256,
  arc_policy_sha256: checkoutConfigSnapshotSha256,
  arc_preview_commit: checkoutPolicy.source_commit_sha,
  arc_v4_ref: checkoutReference,
  arc_v4_ref_sha256: checkoutReferenceSha256,
  tax_contract_version: "arc-tax-v1",
  terms_document_sha256: checkoutPolicy.terms_document_sha256,
  terms_version: TERMS_VERSION
};
if (canonicalJson(session.metadata || {}) !== canonicalJson(expectedLinkMetadata) ||
    (clean(session.client_reference_id) && clean(session.client_reference_id) !== checkoutReference && clean(session.client_reference_id).length > 512)) {
  throw new Error("ARC_PAYMENT_INVALID: copied v4 private Payment Link metadata binding");
}
const createParams = new URLSearchParams();
const setCreate = (name, value) => createParams.append(name, String(value));
setCreate("line_items[0][price]", checkoutPolicy.price_id); setCreate("line_items[0][quantity]", "1");
setCreate("automatic_tax[enabled]", "true"); setCreate("billing_address_collection", "required");
setCreate("consent_collection[terms_of_service]", "required"); setCreate("custom_fields[0][key]", "adultpurchaserack");
setCreate("custom_fields[0][label][type]", "custom"); setCreate("custom_fields[0][label][custom]", "I am 18+ and authorized to buy for this business");
setCreate("custom_fields[0][optional]", "false"); setCreate("custom_fields[0][type]", "dropdown");
setCreate("custom_fields[0][dropdown][options][0][label]", "I confirm"); setCreate("custom_fields[0][dropdown][options][0][value]", "accepted");
setCreate("name_collection[business][enabled]", "true"); setCreate("name_collection[business][optional]", "false");
setCreate("name_collection[individual][enabled]", "true"); setCreate("name_collection[individual][optional]", "false");
setCreate("after_completion[type]", "redirect"); setCreate("after_completion[redirect][url]", checkoutPolicy.checkout_redirect_url);
setCreate("restrictions[completed_sessions][limit]", "1"); setCreate("allow_promotion_codes", "false");
setCreate("customer_creation", "if_required"); setCreate("invoice_creation[enabled]", "false");
setCreate("phone_number_collection[enabled]", "false"); setCreate("tax_id_collection[enabled]", "false"); setCreate("submit_type", "auto");
for (const name of Object.keys(expectedLinkMetadata).sort()) if (name !== "arc_intent_sha256") setCreate(`metadata[${name}]`, expectedLinkMetadata[name]);
if (await sha256Bytes(createParams.toString()) !== linkReceipt.provider_intent_sha256) throw new Error("ARC_PAYMENT_INVALID: private Link provider intent binding");
setCreate("metadata[arc_intent_sha256]", linkReceipt.provider_intent_sha256);
if (await sha256Bytes(createParams.toString()) !== linkReceipt.create_request_sha256) throw new Error("ARC_PAYMENT_INVALID: private Link create request binding");

const paymentLinkUrl = `https://api.stripe.com/v1/payment_links/${encodeURIComponent(paymentLinkId)}?expand%5B%5D=line_items.data.price.product`;
const paidLink = await stripeGet(paymentLinkUrl, 1_000_000);
const paidLinkItems = paidLink?.line_items;
const paidLinkItem = paidLinkItems?.data?.[0];
const paidLinkProduct = paidLinkItem?.price?.product;
const paidLinkProductTaxCode = clean(typeof paidLinkProduct?.tax_code === "object" ? paidLinkProduct.tax_code?.id : paidLinkProduct?.tax_code);
const expectedAdultField = [{ key: "adultpurchaserack", type: "dropdown", optional: false,
  label: { type: "custom", custom: "I am 18+ and authorized to buy for this business" }, dropdown: { options: [{ label: "I confirm", value: "accepted" }] } }];
const expectedNameCollection = { business: { enabled: true, optional: false }, individual: { enabled: true, optional: false } };
if (!paidLink || paidLink.object !== "payment_link" || paidLink.id !== paymentLinkId || paidLink.livemode !== stripeLiveModeEnabled || typeof paidLink.active !== "boolean" ||
    !/^https:\/\/buy\.stripe\.com\/(?:test_)?[A-Za-z0-9]+$/.test(clean(paidLink.url)) || await sha256Bytes(clean(paidLink.url)) !== linkReceipt.payment_link_url_sha256 ||
    paidLink.restrictions?.completed_sessions?.limit !== 1 || paidLink.automatic_tax?.enabled !== true || paidLink.billing_address_collection !== "required" ||
    paidLink.consent_collection?.terms_of_service !== "required" || paidLink.allow_promotion_codes !== false ||
    canonicalJson(paidLink.custom_fields) !== canonicalJson(expectedAdultField) || canonicalJson(paidLink.name_collection) !== canonicalJson(expectedNameCollection) ||
    paidLink.submit_type !== "auto" || paidLink.after_completion?.type !== "redirect" || paidLink.after_completion?.redirect?.url !== checkoutPolicy.checkout_redirect_url ||
    paidLink.customer_creation !== "if_required" || paidLink.invoice_creation?.enabled !== false || paidLink.phone_number_collection?.enabled !== false ||
    paidLink.tax_id_collection?.enabled !== false || paidLink.shipping_address_collection != null || !Array.isArray(paidLink.optional_items) || paidLink.optional_items.length !== 0 ||
    canonicalJson(paidLink.metadata) !== canonicalJson(expectedLinkMetadata) || !paidLinkItems || paidLinkItems.object !== "list" || paidLinkItems.has_more !== false ||
    !Array.isArray(paidLinkItems.data) || paidLinkItems.data.length !== 1 || paidLinkItem.quantity !== 1 || paidLinkItem.price?.id !== checkoutPolicy.price_id ||
    paidLinkProduct?.id !== checkoutPolicy.product_id) {
  throw new Error("ARC_PAYMENT_INVALID: authenticated paid Payment Link differs from its v4 creation receipt");
}
if (paidLinkProductTaxCode !== checkoutPolicy.product_tax_code) {
  throw new Error("ARC_TAX_REVIEW_REQUIRED: current Payment Link Product tax code differs from the signed creation-time policy; manual tax review is required");
}
const creationTimeReadbackSha256 = await sha256Bytes(canonicalJson({ id: paymentLinkId, active: true, livemode: paidLink.livemode,
  url_sha256: linkReceipt.payment_link_url_sha256, metadata: expectedLinkMetadata, completed_sessions_limit: 1,
  price_id: checkoutPolicy.price_id, product_id: checkoutPolicy.product_id, product_tax_code: checkoutPolicy.product_tax_code }));
if (creationTimeReadbackSha256 !== linkReceipt.readback_sha256) throw new Error("ARC_PAYMENT_INVALID: private Payment Link creation-time readback digest");

const rawClientReferenceId = clean(session.client_reference_id);
const clientReferenceObservation = !rawClientReferenceId ? "ABSENT" : rawClientReferenceId === checkoutReference ? "MATCHED" : "MISMATCH_REVIEW_REQUIRED";
const mismatchReviewKey = clientReferenceObservation === "MISMATCH_REVIEW_REQUIRED"
  ? hex(await hmacBytes(checkoutBindingKey, `arc2-client-reference-mismatch-review-key-v1\n${stripeMode}\n${sessionId}\n${paymentLinkId}`)) : "";
const mismatchReview = clientReferenceObservation === "MISMATCH_REVIEW_REQUIRED" ? canonicalJson({
  version: "arc2-client-reference-mismatch-review-v1", scope: "buyer-supplied-client-reference-anomaly", status: "REVIEW_REQUIRED",
  record_key_hmac_sha256: mismatchReviewKey,
  checkout_session_id_hmac_sha256: hex(await hmacBytes(checkoutBindingKey, `arc2-session-review-key-v1\n${stripeMode}\n${sessionId}`)),
  link_id_hmac_sha256: linkIdHmac, expected_checkout_reference_sha256: checkoutReferenceSha256,
  observed_client_reference_sha256: await sha256Bytes(rawClientReferenceId), checkout_policy_sha256: checkoutConfigSnapshotSha256,
  link_receipt_sha256: privateLinkReverse.link_receipt_sha256, stripe_mode: stripeMode, stripe_account_id_sha256: stripeAccountIdSha256
}) : "";
const mismatchReviewSha256 = mismatchReview ? await sha256Bytes(mismatchReview) : "";
const mismatchReviewHmacSha256 = mismatchReview
  ? hex(await hmacBytes(checkoutBindingKey, `arc2-client-reference-mismatch-review-signature-v1\n${stripeMode}\n${mismatchReview}`)) : "";
const existingMismatchReview = clean(inputData.client_reference_mismatch_review_state);
if (mismatchReview && existingMismatchReview && existingMismatchReview !== mismatchReview) throw new Error("ARC_PAYMENT_INVALID: client-reference mismatch review state conflict");
if (mismatchReview && existingMismatchReview && clean(inputData.client_reference_mismatch_review_hmac_sha256).toLowerCase() !== mismatchReviewHmacSha256) {
  throw new Error("ARC_PAYMENT_INVALID: client-reference mismatch review HMAC readback");
}
if (mismatchReview && !existingMismatchReview) return {
  status: "CLIENT_REFERENCE_MISMATCH_REVIEW_WRITE_REQUIRED",
  external_deploy_write_allowed_by_this_step: false,
  provider_write_allowed_by_this_step: false,
  stripe_provider_write_allowed_by_this_step: false,
  github_provider_write_allowed_by_this_step: false,
  netlify_provider_write_allowed_by_this_step: false,
  state_write_allowed_by_this_step: false,
  claim_invitation_allowed_by_this_step: false,
  email_allowed_by_this_step: false,
  delivery_email_send_allowed_by_this_step: false,
  handoff_allowed: false,
  client_reference_id_observation: clientReferenceObservation,
  client_reference_mismatch_review_record_key_hmac_sha256: mismatchReviewKey,
  client_reference_mismatch_review_state: mismatchReview,
  client_reference_mismatch_review_sha256: mismatchReviewSha256,
  client_reference_mismatch_review_hmac_sha256: mismatchReviewHmacSha256,
  client_reference_mismatch_review_write_required_before_handoff: true,
  state_adapter_contract: "create-or-exact mismatch review, then exact HMAC-bound readback before resolver replay"
};

const githubHeaders = { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2022-11-28" };
const github = async (url, maximumBytes = 2_000_000) => fetchJsonBounded(url, { method: "GET", headers: githubHeaders }, maximumBytes,
  response => {
    if (response.url && response.url !== url) throw new Error("ARC_GITHUB_FAILED: redirect rejected");
    if (!response.ok) throw new Error(`ARC_GITHUB_FAILED: ${response.status} ${response.statusText}`);
  }, "ARC_GITHUB_FAILED");
const githubApi = "https://api.github.com/repos/arcwebhq-cpu/arc-previews";
const checkoutTagName = `arc-checkout-ready-v4/${checkoutReferenceSha256}`;
const checkoutTagRef = await github(`${githubApi}/git/ref/${encodeURIComponent(`tags/${checkoutTagName}`)}`, 64_000);
const sourceCommitSha = clean(checkoutTagRef.object?.sha).toLowerCase();
if (checkoutTagRef.ref !== `refs/tags/${checkoutTagName}` || checkoutTagRef.object?.type !== "commit" ||
    !/^[a-f0-9]{40}$/.test(sourceCommitSha) || sourceCommitSha !== checkoutPolicy.source_commit_sha) {
  throw new Error("ARC_GITHUB_FAILED: exact immutable v4 checkout source tag");
}
const sourceCommit = await github(`${githubApi}/git/commits/${sourceCommitSha}`, 128_000);
const sourceTreeSha = clean(sourceCommit.tree?.sha).toLowerCase();
if (clean(sourceCommit.sha).toLowerCase() !== sourceCommitSha || !/^[a-f0-9]{40}$/.test(sourceTreeSha) || sourceTreeSha !== checkoutPolicy.source_tree_sha) {
  throw new Error("ARC_GITHUB_FAILED: immutable source commit tree differs from signed v4 policy");
}
const tree = await github(`${githubApi}/git/trees/${sourceTreeSha}?recursive=1`, 4_000_000);
if (clean(tree.sha).toLowerCase() !== sourceTreeSha || tree.truncated || !Array.isArray(tree.tree)) {
  throw new Error("ARC_GITHUB_FAILED: exact untruncated recursive tree is required");
}
const treeItems = tree.tree;
const subtreeItems = treeItems.filter(item => item.path === previewFolder || item.path.startsWith(`${previewFolder}/`));
const expectedTreeEntries = new Map([[previewFolder, { type: "tree", mode: "040000" }]]);
for (const path of HTML_PATHS) {
  const repositoryPath = `${previewFolder}/${path}`;
  expectedTreeEntries.set(repositoryPath, { type: "blob", mode: "100644" });
  if (path !== "index.html") expectedTreeEntries.set(repositoryPath.slice(0, -"/index.html".length), { type: "tree", mode: "040000" });
}
if (assetReceiptByRepositoryPath.size) expectedTreeEntries.set(`${previewFolder}/assets`, { type: "tree", mode: "040000" });
for (const [path, entry] of assetReceiptByRepositoryPath) expectedTreeEntries.set(path, { type: "blob", mode: "100644", sha: entry.git_blob_sha1, size: entry.size_bytes });
if (subtreeItems.length !== expectedTreeEntries.size || new Set(subtreeItems.map(item => item.path)).size !== subtreeItems.length) {
  throw new Error("ARC_ARTIFACT_INVALID: immutable five-page preview subtree contains missing or extra paths");
}
for (const [path, expected] of expectedTreeEntries) {
  const matches = subtreeItems.filter(item => item.path === path && item.type === expected.type && item.mode === expected.mode);
  if (matches.length !== 1 || (expected.sha && clean(matches[0].sha).toLowerCase() !== expected.sha) ||
      (expected.size && matches[0].size !== expected.size)) {
    throw new Error("ARC_ARTIFACT_INVALID: immutable five-page preview subtree binding");
  }
}

const readBlob = async (sha, expectedSize, maximumSize) => {
  if (!/^[a-f0-9]{40}$/.test(sha) || !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > maximumSize) {
    throw new Error("ARC_GITHUB_FAILED: immutable blob descriptor");
  }
  const blob = await github(`${githubApi}/git/blobs/${sha}`, Math.min(1_800_000, Math.max(64_000, Math.ceil(expectedSize * 1.5) + 4096)));
  const compactContent = typeof blob.content === "string" ? blob.content.replace(/\s/g, "") : "";
  if (clean(blob.sha).toLowerCase() !== sha || blob.encoding !== "base64" || blob.size !== expectedSize ||
      compactContent.length > Math.ceil(expectedSize / 3) * 4 + 4096) throw new Error("ARC_GITHUB_FAILED: immutable blob binding");
  const bytes = Buffer.from(compactContent, "base64");
  if (bytes.toString("base64") !== compactContent || bytes.length !== expectedSize) throw new Error("ARC_GITHUB_FAILED: immutable blob bytes");
  return bytes;
};

const pageBytesByPath = new Map();
let publishedAggregateBytes = 0;
for (const path of HTML_PATHS) {
  const item = subtreeItems.find(candidate => candidate.path === `${previewFolder}/${path}`);
  if (!item || !/^[a-f0-9]{40}$/.test(clean(item.sha).toLowerCase()) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > SAFE_CAPS.maxHtmlBytes) {
    throw new Error(`ARC_FINALIZE_INVALID: immutable preview page is missing (${path})`);
  }
  publishedAggregateBytes += item.size;
  pageBytesByPath.set(path, await readBlob(clean(item.sha).toLowerCase(), item.size, SAFE_CAPS.maxHtmlBytes));
}
if (publishedAggregateBytes > SAFE_CAPS.maxAggregateHtmlBytes) throw new Error("ARC_FINALIZE_INVALID: published five-page aggregate exceeds 500000 bytes");

// Structurally validate images before they enter the signed bundle. arc-site
// repeats a stricter decode/readback check at its own trust boundary.
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const assertSafeImage = (bytes, contentType, label) => {
  const active = /<(?:script|svg|html|iframe|object|embed)\b|javascript\s*:/i.test(bytes.toString("latin1"));
  const valid = contentType === "image/png"
    ? bytes.length >= 57 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.subarray(-12, -8).toString("ascii") === "IEND"
    : contentType === "image/jpeg"
      ? bytes.length >= 30 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
      : contentType === "image/webp"
        ? bytes.length >= 25 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length
        : false;
  if (!valid || active) throw new Error(`ARC_ARTIFACT_INVALID: immutable asset media type (${label})`);
};
const assets = [];
for (const [repositoryPath, entry] of [...assetReceiptByRepositoryPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const bytes = await readBlob(entry.git_blob_sha1, entry.size_bytes, SAFE_CAPS.maxAssetBytes);
  if (await sha256Bytes(bytes) !== entry.sha256) throw new Error("ARC_ARTIFACT_INVALID: immutable asset digest");
  assertSafeImage(bytes, entry.content_type, repositoryPath);
  assets.push({ path: repositoryPath.slice(`${previewFolder}/`.length), bytes, sourceUrl: entry.public_url });
}

const privateValues = [
  { label: "Checkout Session id", value: sessionId },
  { label: "Stripe account id", value: authenticatedStripeAccountId },
  { label: "Payment Link id", value: paymentLinkId },
  { label: "PaymentIntent id", value: paymentIntent.id },
  { label: "Charge id", value: latestCharge.id },
  { label: "payer email", value: payerEmail },
  { label: "claim recipient", value: checkoutRecipient.claim_recipient_email },
  { label: "lead recipient", value: checkoutRecipient.lead_notification_email },
  { label: "Stripe API key", value: stripeApiKey },
  { label: "GitHub token", value: githubToken },
  { label: "current checkout binding secret", value: checkoutBindingSecret },
  { label: "checkout binding secret", value: selectedCheckoutBindingSecret },
  ...Object.values(retiredCheckoutBindingKeys).map((value, index) => ({ label: `retired checkout binding secret ${index + 1}`, value })),
  { label: "artifact evidence secret", value: handoffArtifactEvidenceSecret },
  { label: "publication receipt secret", value: assetPublicationReceiptSecret },
  { label: "business name", value: collectedBusinessName },
  { label: "purchaser name", value: collectedIndividualName },
  { label: "observed client reference", value: rawClientReferenceId },
  { label: "customer phone", value: session.customer_details?.phone },
  ...taxRegistrations.map((registration, index) => ({ label: `tax registration ${index + 1}`, value: registration.id })),
  ...["line1", "line2", "city", "postal_code"].map(field => ({ label: `customer address ${field}`, value: customerAddress?.[field] }))
];
const approvalPagesByPath = new Map();
for (const path of HTML_PATHS) {
  let publishedHtml;
  try { publishedHtml = new TextDecoder("utf-8", { fatal: true }).decode(pageBytesByPath.get(path)); } catch {
    throw new Error(`ARC_FINALIZE_INVALID: ${path} is not valid UTF-8`);
  }
  if (!publishedHtml.endsWith(`${PREVIEW_TOOLBAR}\n</body>\n</html>\n`) ||
      (publishedHtml.match(/<aside\b[^>]*\bclass="arc-preview-toolbar"/g) || []).length !== 1 ||
      (publishedHtml.match(/<span data-arc-checkout-private>/g) || []).length !== 1) {
    throw new Error(`ARC_FINALIZE_INVALID: ${path} exact inert preview toolbar is missing`);
  }
  const approvalHtml = publishedHtml.replace(`${PREVIEW_TOOLBAR}\n</body>\n</html>\n`, "</body>\n</html>\n");
  const meta = name => [...approvalHtml.matchAll(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]+)"`, "gi"))].map(match => match[1]);
  if (!/^<!doctype html>/i.test(approvalHtml) || meta("arc-template-version").length !== 1 || meta("arc-template-version")[0] !== "11.0" ||
      meta("arc-site-contract").length !== 1 || meta("arc-site-contract")[0] !== "arc-five-page-site-v1" ||
      meta("arc-page-key").length !== 1 || meta("arc-page-key")[0] !== PAGE_KEYS[path] || meta("arc-page-path").length !== 1 || meta("arc-page-path")[0] !== path ||
      meta("robots").length !== 1 || !meta("robots")[0].toLowerCase().split(",").map(value => value.trim()).includes("noindex") ||
      !meta("robots")[0].toLowerCase().split(",").map(value => value.trim()).includes("nofollow")) {
    throw new Error(`ARC_FINALIZE_INVALID: ${path} is not the exact v11 private preview page`);
  }
  await assertPaidPublicSurface(approvalHtml, `${path} approved preview`);
  assertPrivateValuesAbsent(publishedHtml, privateValues, `${path} published preview`);
  assertPrivateValuesAbsent(approvalHtml, privateValues, `${path} approved preview`);
  approvalPagesByPath.set(path, approvalHtml);
}
const publishedPreviewManifest = {
  version: "arc-v11-published-preview-bundle-v1",
  pages: HTML_PATHS.map(path => ({ path, sha256: null, size: pageBytesByPath.get(path).length }))
};
for (const page of publishedPreviewManifest.pages) page.sha256 = await sha256Bytes(pageBytesByPath.get(page.path));
if (await sha256Bytes(canonicalJson(publishedPreviewManifest)) !== checkoutPolicy.content_sha256) {
  throw new Error("ARC_FINALIZE_INVALID: immutable published five-page manifest digest mismatch");
}
const approvalManifest = {
  version: "arc-v11-approval-bundle-v1",
  pages: APPROVAL_PATHS.map(path => ({ path, sha256: null, size: Buffer.byteLength(approvalPagesByPath.get(path), "utf8") }))
};
for (const page of approvalManifest.pages) page.sha256 = await sha256Bytes(approvalPagesByPath.get(page.path));
if (await sha256Bytes(canonicalJson(approvalManifest)) !== approvalContentSha256) {
  throw new Error("ARC_FINALIZE_INVALID: exact five-page approval manifest digest mismatch");
}

const replaceOne = (html, pattern, replacement, label) => {
  const matches = html.match(pattern) || [];
  if (matches.length !== 1) throw new Error(`ARC_FINALIZE_INVALID: ${label} must occur exactly once`);
  return html.replace(pattern, replacement);
};
const exactQuotedAttribute = (attributes, name, label) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentions = [...attributes.matchAll(new RegExp(`(?:^|\\s)${escaped}(?=\\s|=|$)`, "gi"))];
  const assignments = [...attributes.matchAll(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([^"']*)\\1`, "gi"))];
  if (mentions.length !== 1 || assignments.length !== 1) throw new Error(`ARC_FINALIZE_INVALID: ${label} must contain exactly one quoted ${name} attribute`);
  return assignments[0][2];
};
const productionPages = HTML_PATHS.map(path => {
  let html = approvalPagesByPath.get(path);
  html = replaceOne(html, /<meta\s+name="robots"\s+content="[^"]*">/gi,
    '<meta name="robots" content="index,follow,max-image-preview:large">', `${path} robots metadata`);
  html = replaceOne(html, /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*">/gi,
    `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`, `${path} CSP metadata`);
  html = replaceOne(html, /data-arc-site-mode="preview"/g, 'data-arc-site-mode="production"', `${path} preview mode marker`);
  for (const asset of assets) {
    const encodedUrl = asset.sourceUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    html = html.split(asset.sourceUrl).join(`/${asset.path}`).split(encodedUrl).join(`/${asset.path}`);
  }
  return { path, html };
});
if (productionPages.some(page => /\bformaction\b/i.test(page.html))) throw new Error("ARC_FINALIZE_INVALID: formaction overrides are forbidden on every page");
const formPages = productionPages.flatMap(page => (page.html.match(/<form\b/gi) || []).map(() => page.path));
const formCloseCount = productionPages.reduce((total, page) => total + (page.html.match(/<\/form\s*>/gi) || []).length, 0);
let leadRouteMode = "not_required";
let leadRouteFormName = "";
if (formPages.length === 0) {
  if (formCloseCount !== 0) throw new Error("ARC_FINALIZE_INVALID: orphan form closing tag is forbidden");
} else {
  if (formPages.length !== 1 || formCloseCount !== 1 || formPages[0] !== "contact/index.html") {
    throw new Error("ARC_FINALIZE_INVALID: exactly one form is allowed, on Contact only");
  }
  const contact = productionPages.find(page => page.path === "contact/index.html");
  const forms = [...contact.html.matchAll(/<form\b([^>]*)>[\s\S]*?<\/form\s*>/gi)];
  if (forms.length !== 1) throw new Error("ARC_FINALIZE_INVALID: exactly one complete Contact form is required");
  const attributes = forms[0][1];
  leadRouteFormName = exactQuotedAttribute(attributes, "name", "Contact form");
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(leadRouteFormName) ||
      exactQuotedAttribute(attributes, "method", "Contact form").toUpperCase() !== "POST" ||
      exactQuotedAttribute(attributes, "data-netlify", "Contact form").toLowerCase() !== "true" ||
      exactQuotedAttribute(attributes, "netlify-honeypot", "Contact form") !== "bot-field" ||
      exactQuotedAttribute(attributes, "action", "Contact form") !== "./?submitted=1") {
    throw new Error("ARC_FINALIZE_INVALID: Contact form Netlify attributes are invalid");
  }
  const inputs = [...contact.html.matchAll(/<input\b([^>]*)>/gi)];
  const formNameInputs = inputs.filter(match => /(?:^|\s)name\s*=\s*(?:"form-name"|'form-name'|form-name)(?=\s|\/|$)/i.test(match[1]));
  const honeypotInputs = inputs.filter(match => /(?:^|\s)name\s*=\s*(?:"bot-field"|'bot-field'|bot-field)(?=\s|\/|$)/i.test(match[1]));
  if (formNameInputs.length !== 1 || exactQuotedAttribute(formNameInputs[0][1], "type", "form-name input").toLowerCase() !== "hidden" ||
      exactQuotedAttribute(formNameInputs[0][1], "name", "form-name input") !== "form-name" ||
      exactQuotedAttribute(formNameInputs[0][1], "value", "form-name input") !== leadRouteFormName || honeypotInputs.length !== 1 ||
      exactQuotedAttribute(honeypotInputs[0][1], "name", "honeypot input") !== "bot-field") {
    throw new Error("ARC_FINALIZE_INVALID: Contact form hidden bindings are invalid");
  }
  contact.html = replaceOne(contact.html, /action="\.\/\?submitted=1"/g, 'action="/contact/?submitted=1"', "Contact form action");
  leadRouteMode = "netlify_form";
}
if (leadRouteMode !== checkoutRecipient.lead_route_mode || leadRouteFormName !== checkoutRecipient.lead_route_form_name) {
  throw new Error("ARC_LEAD_ROUTE_INVALID: finalized Contact-only form differs from immutable recipient reservation");
}

const includedAssets = new Set(assets.map(asset => asset.path));
const referencedAssets = new Set();
let aggregateProductionHtmlBytes = 0;
for (const page of productionPages) {
  const bytes = Buffer.from(page.html, "utf8");
  if (!bytes.length || bytes.length > SAFE_CAPS.maxHtmlBytes) throw new Error(`ARC_FINALIZE_INVALID: ${page.path} exceeds 150000 bytes`);
  aggregateProductionHtmlBytes += bytes.length;
  if ((page.html.match(/<meta name="robots" content="index,follow,max-image-preview:large">/g) || []).length !== 1 ||
      (page.html.match(/<body\b[^>]*data-arc-site-mode="production"[^>]*>/g) || []).length !== 1 ||
      (page.html.match(new RegExp(`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`, "g")) || []).length !== 1 ||
      /<aside\b[^>]*\bclass=["'][^"']*\barc-preview-toolbar\b/i.test(page.html) || /<base\b/i.test(page.html) ||
      /https:\/\/arcwebhq-cpu\.github\.io\/arc-previews(?:\/|["'?#]|$)/i.test(page.html)) {
    throw new Error(`ARC_FINALIZE_INVALID: ${page.path} production metadata or routing is invalid`);
  }
  for (const match of page.html.matchAll(/(?:^|["'(=\s])(\/?assets\/[^"'()\s,<>]+)/gi)) {
    if (!ROOT_ASSET_PATTERN.test(match[1])) throw new Error(`ARC_ARTIFACT_INVALID: ${page.path} contains a non-root or non-content-addressed asset reference`);
  }
  for (const tag of page.html.match(/<(?:img|source)\b[^>]*>/gi) || []) {
    for (const attributeName of ["src", "srcset"]) {
      const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const values = [...tag.matchAll(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([^"']*)\\1`, "gi"))]
        .map(match => match[2]);
      for (const rawValue of values) {
        const candidates = attributeName === "srcset" ? rawValue.split(",").map(value => value.trim().split(/\s+/)[0]) : [rawValue];
        if (candidates.some(value => !ROOT_ASSET_PATTERN.test(value))) {
          throw new Error(`ARC_ARTIFACT_INVALID: ${page.path} image sources must use root-relative content-addressed assets`);
        }
      }
    }
  }
  for (const match of page.html.matchAll(/(?:^|["'(=\s])(\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp))(?=$|["')\s,<>])/gi)) referencedAssets.add(match[1].slice(1));
  await assertPaidPublicSurface(page.html, `${page.path} final paid HTML`);
  assertPrivateValuesAbsent(page.html, privateValues, `${page.path} production HTML`);
  page.bytes = bytes;
}
if (aggregateProductionHtmlBytes > SAFE_CAPS.maxAggregateHtmlBytes || referencedAssets.size !== includedAssets.size ||
    [...referencedAssets].some(path => !includedAssets.has(path)) || [...includedAssets].some(path => !referencedAssets.has(path))) {
  throw new Error("ARC_ARTIFACT_INVALID: site-wide production asset union or HTML aggregate differs from the exact bundle");
}
const productionContentSha256 = await framedDigest(productionPages);
if (productionContentSha256 !== checkoutPolicy.published_site_sha256) {
  throw new Error("ARC_FINALIZE_INVALID: whole five-page production site digest differs from the immutable v4 policy");
}

const artifactVector = [
  { path: "_headers", bytes: Buffer.from(HEADERS_FILE, "utf8") },
  ...assets.map(asset => ({ path: asset.path, bytes: Buffer.from(asset.bytes) })),
  ...productionPages.map(page => ({ path: page.path, bytes: Buffer.from(page.bytes) }))
];
if (artifactVector.length < 6 || artifactVector.length > 9 || artifactVector[0].bytes.length > SAFE_CAPS.maxHeadersBytes ||
    artifactVector.reduce((total, entry) => total + entry.bytes.length, 0) > SAFE_CAPS.maxArtifactBytes ||
    canonicalJson(artifactVector.map(entry => entry.path)) !== canonicalJson(["_headers", ...[...includedAssets].sort(), ...HTML_PATHS])) {
  throw new Error("ARC_ARTIFACT_INVALID: exact 6–9 artifact vector or aggregate cap is invalid");
}
const artifacts = [];
for (const entry of artifactVector) artifacts.push({ path: entry.path, sha256: await sha256Bytes(entry.bytes), size: entry.bytes.length });
const artifactManifestPrivate = canonicalJson(artifacts);
const artifactManifestSha256 = await sha256Bytes(artifactManifestPrivate);
const bundleFingerprint = await framedDigest(artifactVector);
const deployArtifacts = artifactVector.map(entry => ({ path: entry.path, content_base64: entry.bytes.toString("base64") }));
const deployArtifactsPrivate = canonicalJson(deployArtifacts);
if (Buffer.byteLength(deployArtifactsPrivate, "utf8") > SAFE_CAPS.maxDeployArtifactsJsonBytes) {
  throw new Error("ARC_ARTIFACT_INVALID: canonical deploy artifacts exceed 4700000 bytes");
}

const checkoutSourceTagSha256 = await sha256Bytes(`refs/tags/${checkoutTagName}`);
const handoffArtifactEvidenceData = {
  version: "arc2-handoff-artifact-evidence-v4",
  scope: "netlify-claimable-deploy-artifacts",
  approval_content_sha256: approvalContentSha256,
  asset_publication_receipt_sha256: publicationExpectedSha256,
  checkout_config_snapshot_sha256: checkoutConfigSnapshotSha256,
  checkout_binding_key_id: checkoutBindingKeyId,
  checkout_reference_sha256: checkoutReferenceSha256,
  preview_folder: previewFolder,
  preview_source_commit_sha: sourceCommitSha,
  preview_source_repository: "arcwebhq-cpu/arc-previews",
  preview_source_tag_sha256: checkoutSourceTagSha256,
  lead_route_mode: leadRouteMode,
  lead_route_form_name: leadRouteFormName,
  lead_route_recipient_hmac_sha256: checkoutRecipient.lead_route_recipient_hmac_sha256,
  production_content_sha256: productionContentSha256,
  artifact_manifest_sha256: artifactManifestSha256,
  bundle_fingerprint: bundleFingerprint,
  artifacts,
  issued_at: deterministicEvidenceIssuedAt
};
const handoffArtifactEvidence = canonicalJson(handoffArtifactEvidenceData);
const handoffArtifactEvidenceSha256 = await sha256Bytes(handoffArtifactEvidence);
const artifactEvidenceKey = await globalThis.crypto.subtle.importKey("raw", encoder.encode(handoffArtifactEvidenceSecret),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const handoffArtifactEvidenceHmacSha256 = hex(await hmacBytes(artifactEvidenceKey,
  `arc2-handoff-artifact-evidence-signature-v4\n${handoffArtifactEvidence}`));
const payerEmailSha256 = await sha256Bytes(payerEmail);

const paymentEvidenceData = {
  version: "arc2-payment-evidence-v4",
  scope: "authoritative-stripe-checkout-session",
  checkout_session_id: sessionId,
  stripe_account_id_sha256: stripeAccountIdSha256,
  client_reference_id: checkoutReference,
  client_reference_id_sha256: checkoutReferenceSha256,
  client_reference_id_observation: clientReferenceObservation,
  client_reference_mismatch_review_required: Boolean(mismatchReview),
  client_reference_mismatch_review_record_key_hmac_sha256: mismatchReviewKey,
  client_reference_mismatch_review_state: mismatchReview,
  client_reference_mismatch_review_sha256: mismatchReviewSha256,
  client_reference_mismatch_review_hmac_sha256: mismatchReviewHmacSha256,
  approval_content_sha256: approvalContentSha256,
  asset_publication_receipt_sha256: publicationExpectedSha256,
  checkout_config_snapshot: checkoutPolicyRaw,
  checkout_config_snapshot_sha256: checkoutConfigSnapshotSha256,
  preview_folder: previewFolder,
  preview_source_commit_sha: sourceCommitSha,
  preview_source_repository: "arcwebhq-cpu/arc-previews",
  preview_source_tag_sha256: checkoutSourceTagSha256,
  production_content_sha256: productionContentSha256,
  artifact_manifest_sha256: artifactManifestSha256,
  handoff_artifact_evidence_sha256: handoffArtifactEvidenceSha256,
  bundle_fingerprint: bundleFingerprint,
  claim_recipient_email_sha256: checkoutRecipient.claim_recipient_email_sha256,
  payer_email_sha256: payerEmailSha256,
  livemode: stripeLiveModeEnabled,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: amountTax,
  taxability_reasons: taxabilityReasons,
  line_item_taxes_sha256: lineItemTaxesSha256,
  amount_total_minor_units: session.amount_total,
  payment_link_id: paymentLinkId,
  payment_intent_id: clean(paymentIntent.id),
  charge_id: clean(latestCharge.id),
  price_id: checkoutPolicy.price_id,
  product_id: checkoutPolicy.product_id,
  product_tax_code: checkoutPolicy.product_tax_code,
  price_tax_behavior: "exclusive",
  automatic_tax_enabled: true,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "historical_precheckout_snapshot",
  tax_contract_version: "arc-tax-v1",
  tax_registrations_sha256: checkoutPolicy.tax_registrations_sha256,
  customer_address_sha256: customerAddressSha256,
  customer_address_country: customerAddressCountry,
  customer_address_state: customerAddressState,
  quantity: 1,
  terms_of_service_consent: "accepted",
  terms_version: TERMS_VERSION,
  adult_purchaser_acknowledgement: "accepted"
};
const paymentEvidence = canonicalJson(paymentEvidenceData);
const paymentEvidenceHmacSha256 = hex(await hmacBytes(checkoutBindingKey,
  `arc2-payment-evidence-signature-v4\n${stripeMode}\n${paymentEvidence}`));
const paymentEvidenceSha256 = await sha256Bytes(paymentEvidence);
const handoffStartPayload = canonicalJson({
  artifact_evidence: handoffArtifactEvidence,
  artifact_evidence_hmac_sha256: handoffArtifactEvidenceHmacSha256,
  deploy_artifacts: deployArtifactsPrivate,
  lead_notification_email: leadRouteMode === "netlify_form" ? checkoutRecipient.lead_notification_email : "",
  lead_route_recipient_hmac_sha256: checkoutRecipient.lead_route_recipient_hmac_sha256,
  payment_evidence: paymentEvidence,
  payment_evidence_hmac_sha256: paymentEvidenceHmacSha256
});
const productionPagesPrivate = canonicalJson(productionPages.map(page => ({
  path: page.path, content_base64: page.bytes.toString("base64"), sha256: artifacts.find(entry => entry.path === page.path).sha256, size: page.bytes.length
})));

return {
  status: "READY_FOR_CLAIMABLE_DEPLOY",
  external_deploy_write_allowed_by_this_step: false,
  provider_write_allowed_by_this_step: false,
  stripe_provider_write_allowed_by_this_step: false,
  github_provider_write_allowed_by_this_step: false,
  netlify_provider_write_allowed_by_this_step: false,
  state_write_allowed_by_this_step: false,
  claim_invitation_allowed_by_this_step: false,
  email_allowed_by_this_step: false,
  delivery_email_send_allowed_by_this_step: false,
  payment_verification_status: `verified_${stripeMode}_payment_from_stripe_api`,
  stripe_session_retrieved: true,
  checkout_session_id: sessionId,
  client_reference_id: checkoutReference,
  client_reference_id_observation: clientReferenceObservation,
  client_reference_mismatch_review_record_key_hmac_sha256: mismatchReviewKey,
  client_reference_mismatch_review_state: mismatchReview,
  client_reference_mismatch_review_sha256: mismatchReviewSha256,
  client_reference_mismatch_review_hmac_sha256: mismatchReviewHmacSha256,
  client_reference_mismatch_review_write_required_before_handoff: false,
  livemode: stripeLiveModeEnabled,
  payment_status: "paid",
  currency: "usd",
  amount_total_minor_units: session.amount_total,
  subtotal_amount_minor_units: 500000,
  tax_amount_minor_units: amountTax,
  taxability_reasons: taxabilityReasons,
  line_item_taxes_sha256: lineItemTaxesSha256,
  payment_link_id: paymentLinkId,
  payment_intent_id: clean(paymentIntent.id),
  charge_id: clean(latestCharge.id),
  price_id: checkoutPolicy.price_id,
  product_id: checkoutPolicy.product_id,
  product_tax_code: checkoutPolicy.product_tax_code,
  stripe_account_id_sha256: stripeAccountIdSha256,
  automatic_tax_status: "complete",
  customer_address_status: "verified",
  tax_registration_status: "historical_precheckout_snapshot",
  customer_address_sha256: customerAddressSha256,
  tax_registrations_sha256: checkoutPolicy.tax_registrations_sha256,
  quantity: 1,
  terms_of_service_consent: "accepted",
  terms_version: TERMS_VERSION,
  adult_purchaser_acknowledgement: "accepted",
  payment_evidence_private: paymentEvidence,
  payment_evidence_sha256: paymentEvidenceSha256,
  payment_evidence_hmac_sha256: paymentEvidenceHmacSha256,
  dedupe_key: `arc2:${sessionId}`,
  preview_folder: previewFolder,
  preview_paths: expectedPreviewPaths,
  preview_paths_json: canonicalJson(expectedPreviewPaths),
  preview_source_commit_sha: sourceCommitSha,
  preview_source_tree_sha: sourceTreeSha,
  preview_source_tag: checkoutTagName,
  preview_source_tag_sha256: checkoutSourceTagSha256,
  approval_content_sha256: approvalContentSha256,
  published_preview_bundle_sha256: checkoutPolicy.content_sha256,
  checkout_config_snapshot_private: checkoutPolicyRaw,
  checkout_config_snapshot_sha256: checkoutConfigSnapshotSha256,
  production_page_paths: HTML_PATHS,
  production_page_paths_json: canonicalJson(HTML_PATHS),
  production_pages_private: productionPagesPrivate,
  headers_file_path: "_headers",
  headers_file_base64: artifactVector[0].bytes.toString("base64"),
  deploy_artifacts_private: deployArtifactsPrivate,
  handoff_start_payload_private: handoffStartPayload,
  artifact_manifest_private: artifactManifestPrivate,
  artifact_manifest_sha256: artifactManifestSha256,
  handoff_artifact_evidence_private: handoffArtifactEvidence,
  handoff_artifact_evidence_sha256: handoffArtifactEvidenceSha256,
  handoff_artifact_evidence_hmac_sha256: handoffArtifactEvidenceHmacSha256,
  total_production_html_bytes: aggregateProductionHtmlBytes,
  production_content_sha256: productionContentSha256,
  bundle_fingerprint: bundleFingerprint,
  artifact_count: artifactVector.length,
  claimable_deploy_required: true,
  preview_source_repository: "arcwebhq-cpu/arc-previews",
  customer_email: checkoutRecipient.claim_recipient_email,
  customer_email_sha256: checkoutRecipient.claim_recipient_email_sha256,
  claim_recipient_email: checkoutRecipient.claim_recipient_email,
  claim_recipient_email_sha256: checkoutRecipient.claim_recipient_email_sha256,
  payer_email_sha256: payerEmailSha256,
  lead_route_status: leadRouteMode === "netlify_form" ? "pending_live_staging_evidence" : "not_required",
  lead_route_evidence_required: leadRouteMode === "netlify_form",
  lead_route_evidence_version: leadRouteMode === "netlify_form" ? "arc-lead-route-evidence-v1" : "",
  lead_route_mode: leadRouteMode,
  lead_route_form_name: leadRouteFormName,
  lead_route_recipient_hmac_sha256: checkoutRecipient.lead_route_recipient_hmac_sha256,
  verified_lead_notification_email: leadRouteMode === "netlify_form" ? checkoutRecipient.lead_notification_email : ""
};
