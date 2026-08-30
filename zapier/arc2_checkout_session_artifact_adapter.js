// ARC2 V11 Checkout Session artifact adapter.
//
// The first-party ARC worker owns payment authentication, the durable paid
// ledger, approval/revocation checks, and the transient signed payment proof.
// This Zapier step owns only deterministic five-page artifact construction and,
// behind a separate exact-true gate, one authenticated POST to that worker.
// It never receives a provider credential and never calls a payment provider.
const clean = value => String(value == null ? "" : value).trim();
const encoder = new TextEncoder();
const HEX_64 = /^[a-f0-9]{64}$/;
const HEX_40 = /^[a-f0-9]{40}$/;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9_]{6,128}$/;
const CLAIM_TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const OUTBOX_KEY = /^payment-arc2-start-outbox\/[a-f0-9]{64}$/;
const PREVIEW_FOLDER = /^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/;
const OFFER_CONTRACT_ID = "arc-fixed-five-page-offer-v1";
const DELIVERABLE = "fixed-five-page-marketing-website-v1";
const WORKER_URL = "https://arcweb.onl/internal/payment-arc2/start";
const LOGICAL_PATHS = Object.freeze([
  "index.html",
  "services/index.html",
  "about/index.html",
  "process/index.html",
  "contact/index.html"
]);
const ARTIFACT_PATHS = Object.freeze([
  "about/index.html",
  "contact/index.html",
  "process/index.html",
  "services/index.html",
  "index.html"
]);
const PAGE_KEYS = Object.freeze(["home", "services", "about", "process", "contact"]);
const PAGE_LABELS = Object.freeze(["Home", "Services", "About", "Process", "Contact"]);
const START_RECEIPT_FIELDS = Object.freeze([
  "schema", "accepted", "handoff_id", "started_at", "payment_evidence_sha256",
  "artifact_evidence_sha256", "bridge_immutable_binding_sha256", "review_session_binding_sha256",
  "checkout_session_id_hmac_sha256", "payment_intent_id_hmac_sha256", "recipient_email_sha256",
  "payer_email_sha256", "handoff_state", "reversal_control_ready", "continuation_ready"
]);
const TOOLBAR = '<aside class="arc-preview-toolbar" aria-label="ARC preview status"><span><strong>ARC preview</strong>Five-page website concept for this business.</span><span data-arc-checkout-private>Review and payment are available through your private review link.</span></aside>';
const CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const HEADERS_FILE = `/*\n  Content-Security-Policy: ${CSP}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
const TRUSTED_SCRIPT_HASHES = Object.freeze(["36441ce93ccc1f13622e64f34ba6e43a039cdb453e1f40010dd8c399c97751f4"]);
const TRUSTED_SCRIPT_MANIFEST_SHA256 = "1ef7f0088cdcf042b1593fbc11d7ea2d3c47e9ff92c94caf2f578179e3993685";
const CAPS = Object.freeze({
  assetCount: 3,
  assetBytes: 1_250_000,
  assetTotal: 3_000_000,
  htmlBytes: 150_000,
  htmlTotal: 500_000,
  artifactTotal: 3_510_000,
  deployJson: 4_700_000,
  startRequest: 4_800_000
});

if (clean(inputData.arc2_checkout_session_adapter_enabled).toLowerCase() !== "true") {
  return {
    status: "ARC2_CHECKOUT_SESSION_ADAPTER_PAUSED",
    artifact_resolution_performed: false,
    payment_arc2_start_request_performed: false,
    provider_write_allowed_by_this_step: false,
    stripe_provider_write_allowed_by_this_step: false,
    github_provider_write_allowed_by_this_step: false,
    netlify_provider_write_allowed_by_this_step: false,
    email_allowed_by_this_step: false
  };
}

if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC2_ADAPTER_CRYPTO_UNAVAILABLE");
}

const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC2_ADAPTER_INVALID: canonical JSON requires plain values");
};
const sha256 = async value => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const hmacKey = async secret => globalThis.crypto.subtle.importKey(
  "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
);
const hexBytes = value => Uint8Array.from((value.match(/../g) || []), byte => Number.parseInt(byte, 16));
const sign = async (key, message) => {
  const result = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const verify = async (key, signature, message, label) => {
  if (!HEX_64.test(signature) || !await globalThis.crypto.subtle.verify("HMAC", key, hexBytes(signature), encoder.encode(message))) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${label} signature`);
  }
};
const parseCanonical = (rawValue, label, maximum = 1_300_000) => {
  const raw = typeof rawValue === "string" ? rawValue : "";
  if (raw.length < 2 || raw.length > maximum || raw !== raw.trim()) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${label} canonical JSON`);
  }
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`ARC2_ADAPTER_INVALID: ${label} JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || canonicalJson(value) !== raw) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${label} canonical JSON`);
  }
  return { raw, value };
};
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${label} fields`);
  }
};
const iso = (value, label) => {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || value.length < 20 || value.length > 32 || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${label} timestamp`);
  }
  return parsed;
};
const replaceOne = (html, pattern, replacement, label) => {
  const matches = html.match(pattern) || [];
  if (matches.length !== 1) throw new Error(`ARC2_ADAPTER_INVALID: ${label} must occur exactly once`);
  return html.replace(pattern, replacement);
};
const framedDigest = async entries => sha256(Buffer.concat(entries.flatMap(entry => [
  Buffer.from(`${entry.path}\0`, "utf8"), Buffer.from(entry.bytes), Buffer.from("\0", "utf8")
])));

const modeFlag = clean(inputData.stripe_live_mode_enabled).toLowerCase();
if (!new Set(["false", "true"]).has(modeFlag)) throw new Error("ARC2_ADAPTER_INVALID: explicit checkout mode is required");
const livemode = modeFlag === "true";
const stripeMode = livemode ? "live" : "test";
const sessionId = clean(inputData.checkout_session_id);
if (!SESSION_ID.test(sessionId) || !sessionId.startsWith(livemode ? "cs_live_" : "cs_test_")) {
  throw new Error("ARC2_ADAPTER_INVALID: configured-mode Checkout Session id");
}
const claimToken = clean(inputData.payment_arc2_claim_token);
if (!CLAIM_TOKEN.test(claimToken)) throw new Error("ARC2_ADAPTER_INVALID: paid outbox claim token");

const claimContext = parseCanonical(inputData.payment_arc2_claim_private, "paid outbox claim", 100_000);
const claim = claimContext.value;
const claimFields = ["accepted", "arc2_start_receipt_sha256", "claim_attempt_count", "idempotent_replay",
  "immutable_binding_sha256", "lease_expires_at", "outbox_key", "payload", "state"];
exactKeys(claim, claimFields, "paid outbox claim");
const immutableFields = ["approval_receipt_hmac_sha256", "approval_receipt_sha256", "authorization_expires_at", "brief_sha256",
  "checkout_session_id_hmac_sha256", "invite_hmac_sha256", "livemode", "payer_email_sha256", "payment_binding_sha256",
  "payment_intent_id_hmac_sha256", "payment_receipt_sha256", "payment_state_event_sha256", "preview_content_sha256",
  "preview_manifest_sha256", "recipient_email_sha256", "review_session_binding_sha256", "schema", "scope_version",
  "stripe_account_id_sha256"];
exactKeys(claim.payload, immutableFields, "paid outbox immutable binding");
const leaseExpiresMs = iso(claim.lease_expires_at, "paid outbox lease expiration");
iso(claim.payload.authorization_expires_at, "review authorization expiration");
const nowMs = Date.now();
if (claim.accepted !== true || claim.state !== "CLAIMED" || claim.arc2_start_receipt_sha256 !== null ||
    typeof claim.idempotent_replay !== "boolean" || !Number.isSafeInteger(claim.claim_attempt_count) || claim.claim_attempt_count < 1 ||
    !OUTBOX_KEY.test(claim.outbox_key) || !HEX_64.test(claim.immutable_binding_sha256) ||
    claim.payload.schema !== "arc-payment-arc2-start-binding-v2" || claim.payload.scope_version !== OFFER_CONTRACT_ID ||
    claim.payload.livemode !== livemode || immutableFields.filter(field => field.endsWith("_sha256")).some(field => !HEX_64.test(claim.payload[field])) ||
    await sha256(canonicalJson(claim.payload)) !== claim.immutable_binding_sha256 ||
    leaseExpiresMs <= nowMs || leaseExpiresMs > nowMs + 10 * 60_000) {
  throw new Error("ARC2_ADAPTER_INVALID: live paid outbox lease binding");
}

const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const currentKeyId = clean(inputData.checkout_binding_key_id).toLowerCase();
const retiredRaw = clean(inputData.retired_checkout_binding_keys_json);
let retiredKeys;
try { retiredKeys = JSON.parse(retiredRaw); } catch {}
if (!/^[a-f0-9]{2}$/.test(currentKeyId) || checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256 ||
    !retiredKeys || typeof retiredKeys !== "object" || Array.isArray(retiredKeys) || canonicalJson(retiredKeys) !== retiredRaw ||
    Object.entries(retiredKeys).some(([id, secret]) => !/^[a-f0-9]{2}$/.test(id) || id === currentKeyId || typeof secret !== "string" || secret.length < 32 || secret.length > 256) ||
    new Set(Object.values(retiredKeys)).size !== Object.values(retiredKeys).length || Object.values(retiredKeys).includes(checkoutBindingSecret)) {
  throw new Error("ARC2_ADAPTER_INVALID: checkout binding key registry");
}

const offerContext = parseCanonical(inputData.checkout_offer_snapshot_private, "checkout offer snapshot", 80_000);
const offer = offerContext.value;
const offerFields = ["adult_acknowledgement_key", "amount_subtotal_minor_units", "approval_content_sha256", "asset_publication_receipt_sha256",
  "automatic_tax_enabled", "checkout_binding_key_id", "checkout_redirect_url", "configuration_sha256", "currency", "customer_address_source",
  "customer_creation", "deliverable", "environment", "lead_route_form_name", "lead_route_mode", "lead_route_recipient_hmac_sha256", "livemode",
  "offer_contract_id", "page_count", "preview_folder", "preview_paths", "preview_source_repository",
  "price_id", "price_tax_behavior", "product_id", "product_tax_code", "production_content_sha256", "public_folder_prefix",
  "published_preview_bundle_sha256", "quantity", "render_bundle_sha256", "scope", "stripe_account_id_sha256", "stripe_api_version",
  "submit_type", "tax_contract_version", "tax_registrations", "tax_registrations_sha256", "tax_settings_status", "terms_document_sha256",
  "terms_version", "version"];
exactKeys(offer, offerFields, "checkout offer snapshot");
const offerSha256 = await sha256(offerContext.raw);
const selectedSecret = offer.checkout_binding_key_id === currentKeyId ? checkoutBindingSecret : retiredKeys[offer.checkout_binding_key_id];
if (!selectedSecret || clean(inputData.checkout_offer_snapshot_sha256).toLowerCase() !== offerSha256) {
  throw new Error("ARC2_ADAPTER_INVALID: checkout offer key or digest");
}
const checkoutKey = await hmacKey(selectedSecret);
await verify(checkoutKey, clean(inputData.checkout_offer_snapshot_hmac_sha256).toLowerCase(),
  `arc-checkout-offer-snapshot-signature-v2\n${stripeMode}\n${offerContext.raw}`, "checkout offer snapshot");

const bundleContext = parseCanonical(inputData.render_bundle_private, "V11 render bundle");
const bundle = bundleContext.value;
const bundleFields = ["approval_manifest", "approval_manifest_sha256", "deliverable", "lead_route_form_name", "lead_route_mode",
  "logical_page_paths", "offer_contract_id", "page_count", "pages", "preview_folder", "preview_paths", "production_content_sha256",
  "published_preview_bundle_sha256", "published_preview_manifest", "runtime_version", "scope", "site_contract_version", "template_version", "version"];
exactKeys(bundle, bundleFields, "V11 render bundle");
const bundleSha256 = await sha256(bundleContext.raw);
const previewFolder = clean(bundle.preview_folder).toLowerCase();
const expectedPreviewPaths = ARTIFACT_PATHS.map(path => `${previewFolder}/${path}`);
if (bundle.version !== "arc1-five-page-render-bundle-v1" || bundle.scope !== "private-sanitized-five-page-preview-render" ||
    bundle.runtime_version !== "arc1-inject-v11-render-runtime-v1" || bundle.site_contract_version !== "arc-five-page-site-v1" ||
    bundle.template_version !== "11.0" || bundle.offer_contract_id !== OFFER_CONTRACT_ID || bundle.deliverable !== DELIVERABLE ||
    bundle.page_count !== 5 || !PREVIEW_FOLDER.test(previewFolder) || canonicalJson(bundle.logical_page_paths) !== canonicalJson(LOGICAL_PATHS) ||
    canonicalJson(bundle.preview_paths) !== canonicalJson(expectedPreviewPaths) || clean(inputData.render_bundle_sha256).toLowerCase() !== bundleSha256 ||
    ![bundle.approval_manifest_sha256, bundle.published_preview_bundle_sha256, bundle.production_content_sha256].every(value => HEX_64.test(value))) {
  throw new Error("ARC2_ADAPTER_INVALID: exact V11 render bundle");
}

const stableCheckout = {
  stripe_account_id_sha256: offer.stripe_account_id_sha256,
  livemode: offer.livemode,
  price_id: offer.price_id,
  product_id: offer.product_id,
  amount_subtotal_minor_units: offer.amount_subtotal_minor_units,
  currency: offer.currency,
  quantity: offer.quantity,
  terms_version: offer.terms_version,
  terms_document_sha256: offer.terms_document_sha256,
  automatic_tax_enabled: offer.automatic_tax_enabled,
  customer_address_source: offer.customer_address_source,
  price_tax_behavior: offer.price_tax_behavior,
  product_tax_code: offer.product_tax_code,
  tax_contract_version: offer.tax_contract_version,
  tax_settings_status: offer.tax_settings_status,
  tax_registrations: offer.tax_registrations,
  tax_registrations_sha256: offer.tax_registrations_sha256,
  adult_acknowledgement_key: offer.adult_acknowledgement_key,
  customer_creation: offer.customer_creation,
  submit_type: offer.submit_type,
  checkout_redirect_url: offer.checkout_redirect_url,
  stripe_api_version: offer.stripe_api_version
};
if (offer.version !== "arc-checkout-offer-snapshot-v2" || offer.scope !== "immutable-approved-five-page-preview-private-checkout-offer" ||
    offer.offer_contract_id !== OFFER_CONTRACT_ID || offer.deliverable !== DELIVERABLE || offer.page_count !== 5 || offer.preview_folder !== previewFolder ||
    canonicalJson(offer.preview_paths) !== canonicalJson(expectedPreviewPaths) || offer.preview_source_repository !== "arcwebhq-cpu/arc-previews" ||
    offer.public_folder_prefix !== previewFolder.slice(-8) || offer.approval_content_sha256 !== bundle.approval_manifest_sha256 ||
    offer.published_preview_bundle_sha256 !== bundle.published_preview_bundle_sha256 || offer.production_content_sha256 !== bundle.production_content_sha256 ||
    offer.render_bundle_sha256 !== bundleSha256 || offer.lead_route_mode !== bundle.lead_route_mode || offer.lead_route_form_name !== bundle.lead_route_form_name ||
    offer.environment !== "arc-production" || offer.livemode !== livemode || offer.amount_subtotal_minor_units !== 500000 || offer.currency !== "usd" ||
    offer.quantity !== 1 || offer.automatic_tax_enabled !== true || offer.customer_address_source !== "stripe_checkout_customer_details.address" ||
    offer.price_tax_behavior !== "exclusive" || offer.tax_contract_version !== "arc-tax-v1" || offer.tax_settings_status !== "active" ||
    !Array.isArray(offer.tax_registrations) || offer.tax_registrations.length < 1 || offer.tax_registrations.length > 100 ||
    offer.adult_acknowledgement_key !== "adultpurchaserack" || offer.customer_creation !== "always" || offer.submit_type !== "pay" ||
    offer.checkout_redirect_url !== "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}" || offer.stripe_api_version !== "2026-08-26.dahlia" ||
    !/^price_[A-Za-z0-9]+$/.test(offer.price_id) || !/^prod_[A-Za-z0-9]+$/.test(offer.product_id) || !/^txcd_[0-9]{8}$/.test(offer.product_tax_code) ||
    ![offer.stripe_account_id_sha256, offer.terms_document_sha256, offer.tax_registrations_sha256, offer.configuration_sha256,
      offer.asset_publication_receipt_sha256].every(value => HEX_64.test(value)) ||
    await sha256(canonicalJson(stableCheckout)) !== offer.configuration_sha256 ||
    await sha256(canonicalJson(offer.tax_registrations)) !== offer.tax_registrations_sha256) {
  throw new Error("ARC2_ADAPTER_INVALID: immutable five-page checkout offer");
}

const recipientContext = parseCanonical(inputData.checkout_recipient_reservation_private, "recipient reservation", 40_000);
const recipient = recipientContext.value;
const recipientFields = ["approval_content_sha256", "checkout_binding_key_id", "checkout_offer_snapshot_sha256", "claim_recipient_email",
  "claim_recipient_email_sha256", "deliverable", "lead_notification_email", "lead_route_form_name", "lead_route_mode",
  "lead_route_recipient_hmac_sha256", "offer_contract_id", "page_count", "preview_folder", "preview_paths", "production_content_sha256",
  "published_preview_bundle_sha256", "scope", "stripe_mode", "version"];
exactKeys(recipient, recipientFields, "recipient reservation");
const recipientSha256 = await sha256(recipientContext.raw);
if (clean(inputData.checkout_recipient_reservation_sha256).toLowerCase() !== recipientSha256) {
  throw new Error("ARC2_ADAPTER_INVALID: recipient reservation digest");
}
await verify(checkoutKey, clean(inputData.checkout_recipient_reservation_hmac_sha256).toLowerCase(),
  `arc1-checkout-recipient-reservation-signature-v2\n${stripeMode}\n${recipientContext.raw}`, "recipient reservation");
if (recipient.version !== "arc1-checkout-recipient-reservation-v2" || recipient.scope !== "private-recipients-for-approved-five-page-checkout" ||
    recipient.offer_contract_id !== OFFER_CONTRACT_ID || recipient.deliverable !== DELIVERABLE || recipient.page_count !== 5 ||
    recipient.preview_folder !== previewFolder || canonicalJson(recipient.preview_paths) !== canonicalJson(expectedPreviewPaths) ||
    recipient.approval_content_sha256 !== bundle.approval_manifest_sha256 || recipient.published_preview_bundle_sha256 !== bundle.published_preview_bundle_sha256 ||
    recipient.production_content_sha256 !== bundle.production_content_sha256 || recipient.checkout_offer_snapshot_sha256 !== offerSha256 ||
    recipient.checkout_binding_key_id !== offer.checkout_binding_key_id || recipient.stripe_mode !== stripeMode ||
    recipient.lead_route_mode !== bundle.lead_route_mode || recipient.lead_route_form_name !== bundle.lead_route_form_name ||
    recipient.lead_route_recipient_hmac_sha256 !== offer.lead_route_recipient_hmac_sha256 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.claim_recipient_email) || recipient.claim_recipient_email !== recipient.claim_recipient_email.toLowerCase() ||
    await sha256(recipient.claim_recipient_email) !== recipient.claim_recipient_email_sha256 ||
    recipient.claim_recipient_email_sha256 !== claim.payload.recipient_email_sha256 ||
    (bundle.lead_route_mode === "netlify_form"
      ? (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.lead_notification_email) || !HEX_64.test(recipient.lead_route_recipient_hmac_sha256) ||
        await sign(checkoutKey, `arc-checkout-lead-recipient-v1\n${stripeMode}\n${recipient.lead_notification_email}`) !== recipient.lead_route_recipient_hmac_sha256)
      : (recipient.lead_notification_email !== "" || recipient.lead_route_recipient_hmac_sha256 !== ""))) {
  throw new Error("ARC2_ADAPTER_INVALID: immutable recipient or paid outbox binding");
}

const publicationContext = parseCanonical(inputData.asset_publication_receipt_private, "asset publication receipt", 100_000);
const publication = publicationContext.value;
const publicationFields = ["asset_manifest_sha256", "asset_permission", "asset_visual_review_authority_verified", "asset_visual_review_key_id",
  "asset_visual_review_reviewer_id_sha256", "asset_visual_review_sha256", "base_branch", "bridge_contract_sha256", "bridge_evidence_sha256",
  "delivery_id", "entries", "intake_evidence_sha256", "intake_state_digest_sha256", "pages_base_url", "preview_branch", "preview_folder",
  "private_asset_receipt_sha256", "public_folder_prefix", "repository", "scope", "status", "version"];
exactKeys(publication, publicationFields, "asset publication receipt");
const publicationSha256 = await sha256(publicationContext.raw);
const publicationSecret = clean(inputData.asset_publication_receipt_secret);
const artifactSecret = clean(inputData.handoff_artifact_evidence_secret);
const workerSecret = clean(inputData.payment_arc2_worker_secret);
if ([publicationSecret, artifactSecret, workerSecret].some(secret => secret.length < 32 || secret.length > 512) ||
    new Set([selectedSecret, publicationSecret, artifactSecret, workerSecret]).size !== 4 ||
    Object.values(retiredKeys).some(secret => new Set([publicationSecret, artifactSecret, workerSecret]).has(secret))) {
  throw new Error("ARC2_ADAPTER_INVALID: distinct runtime secrets");
}
const publicationKey = await hmacKey(publicationSecret);
if (clean(inputData.asset_publication_receipt_sha256).toLowerCase() !== publicationSha256 || offer.asset_publication_receipt_sha256 !== publicationSha256) {
  throw new Error("ARC2_ADAPTER_INVALID: asset publication receipt digest");
}
await verify(publicationKey, clean(inputData.asset_publication_receipt_hmac_sha256).toLowerCase(),
  `arc1-public-asset-publication-receipt-v1\n${publicationContext.raw}`, "asset publication receipt");
if (publication.version !== "arc1-public-asset-publication-receipt-v1" || publication.scope !== "github-content-addressed-preview-assets" ||
    publication.bridge_contract_sha256 !== "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2" ||
    publication.repository !== "arcwebhq-cpu/arc-previews" || publication.base_branch !== "main" || publication.preview_folder !== previewFolder ||
    publication.preview_branch !== `arc-preview/${previewFolder.slice(-8)}` || publication.public_folder_prefix !== previewFolder.slice(-8) ||
    publication.pages_base_url !== "https://arcwebhq-cpu.github.io/arc-previews" || !Array.isArray(publication.entries) ||
    publication.entries.length > CAPS.assetCount || publication.status !== (publication.entries.length ? "HUMAN_REVIEWED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS") ||
    (publication.entries.length ? (publication.asset_permission !== "Confirmed rights and no visible watermark v1" ||
      publication.asset_visual_review_authority_verified !== true || !/^[a-f0-9]{2}$/.test(publication.asset_visual_review_key_id) ||
      !HEX_64.test(publication.asset_visual_review_reviewer_id_sha256) || !HEX_64.test(publication.asset_visual_review_sha256)) :
      (publication.asset_permission !== "" || publication.asset_visual_review_authority_verified !== false || publication.asset_visual_review_key_id !== "" ||
        publication.asset_visual_review_reviewer_id_sha256 !== "" || publication.asset_visual_review_sha256 !== ""))) {
  throw new Error("ARC2_ADAPTER_INVALID: asset publication authority");
}

const operationTimeout = clean(inputData.provider_operation_timeout_ms) ? Number(inputData.provider_operation_timeout_ms) : 25_000;
if (!Number.isSafeInteger(operationTimeout) || operationTimeout < 100 || operationTimeout > 25_000) {
  throw new Error("ARC2_ADAPTER_INVALID: operation timeout");
}
const operationDeadline = Date.now() + operationTimeout;
const fetchBytesBounded = async (url, options, maximumBytes, label, allowedStatuses = [200]) => {
  const remaining = Math.floor(operationDeadline - Date.now());
  if (remaining <= 0) throw new Error(`ARC2_ADAPTER_FAILED: ${label} deadline`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(10_000, remaining));
  let reader;
  try {
    const response = await fetch(url, { ...options, redirect: "error", signal: controller.signal });
    if (response.url && response.url !== url) throw new Error(`ARC2_ADAPTER_FAILED: ${label} redirect`);
    if (!allowedStatuses.includes(response.status)) throw new Error(`ARC2_ADAPTER_FAILED: ${label} status ${response.status}`);
    const declared = response.headers?.get?.("content-length");
    if (declared && (!/^\d{1,9}$/.test(declared) || Number(declared) > maximumBytes)) throw new Error(`ARC2_ADAPTER_FAILED: ${label} response too large`);
    reader = response.body?.getReader?.();
    if (!reader) throw new Error(`ARC2_ADAPTER_FAILED: ${label} streaming response required`);
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error(`ARC2_ADAPTER_FAILED: ${label} response chunk`);
      total += value.byteLength;
      if (total > maximumBytes) { try { await reader.cancel(); } catch {} throw new Error(`ARC2_ADAPTER_FAILED: ${label} response too large`); }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
    return { bytes: Buffer.concat(chunks, total), status: response.status };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`ARC2_ADAPTER_FAILED: ${label} timeout`);
    throw error;
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock?.(); } catch {}
  }
};

const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const assets = [];
const roles = new Set();
let aggregateAssetBytes = 0;
const githubToken = clean(inputData.github_token);
if (publication.entries.length && (githubToken.length < 20 || /\s/.test(githubToken))) {
  throw new Error("ARC2_ADAPTER_INVALID: read-only GitHub token required for signed assets");
}
const safeImage = (bytes, contentType) => {
  const active = /<(?:script|svg|html|iframe|object|embed)\b|javascript\s*:/i.test(bytes.toString("latin1"));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const valid = contentType === "image/png"
    ? bytes.length >= 57 && bytes.subarray(0, 8).equals(png) && bytes.subarray(-12, -8).toString("ascii") === "IEND"
    : contentType === "image/jpeg"
      ? bytes.length >= 30 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
      : contentType === "image/webp"
        ? bytes.length >= 25 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length
        : false;
  if (!valid || active) throw new Error("ARC2_ADAPTER_INVALID: signed asset media bytes");
};
for (const entry of publication.entries) {
  exactKeys(entry, ["asset_id", "content_type", "git_blob_sha1", "public_url", "repository_path", "role", "sha256", "size_bytes"], "asset entry");
  const extension = extensions[entry.content_type];
  const assetPath = `assets/${entry.sha256}.${extension}`;
  if (!extension || !HEX_64.test(entry.asset_id) || !HEX_64.test(entry.sha256) || !HEX_40.test(entry.git_blob_sha1) ||
      !new Set(["hero_image_file", "logo_file", "supporting_image_file"]).has(entry.role) || roles.has(entry.role) ||
      entry.repository_path !== `${previewFolder}/${assetPath}` || entry.public_url !== `${publication.pages_base_url}/${entry.repository_path}` ||
      !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 1 || entry.size_bytes > CAPS.assetBytes) {
    throw new Error("ARC2_ADAPTER_INVALID: signed asset entry");
  }
  roles.add(entry.role);
  const blobUrl = `https://api.github.com/repos/arcwebhq-cpu/arc-previews/git/blobs/${entry.git_blob_sha1}`;
  const response = await fetchBytesBounded(blobUrl, { method: "GET", headers: {
    Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2022-11-28"
  } }, Math.min(1_900_000, Math.ceil(entry.size_bytes * 1.5) + 4096), "GitHub asset read");
  let blob;
  try { blob = JSON.parse(response.bytes.toString("utf8")); } catch { throw new Error("ARC2_ADAPTER_FAILED: GitHub asset JSON"); }
  const encoded = typeof blob.content === "string" ? blob.content.replace(/\s/g, "") : "";
  const bytes = Buffer.from(encoded, "base64");
  if (blob.sha !== entry.git_blob_sha1 || blob.encoding !== "base64" || blob.size !== entry.size_bytes ||
      bytes.toString("base64") !== encoded || bytes.length !== entry.size_bytes || await sha256(bytes) !== entry.sha256) {
    throw new Error("ARC2_ADAPTER_FAILED: GitHub asset binding");
  }
  safeImage(bytes, entry.content_type);
  aggregateAssetBytes += bytes.length;
  assets.push({ path: assetPath, bytes, sourceUrl: entry.public_url });
}
assets.sort((left, right) => left.path.localeCompare(right.path));
if (aggregateAssetBytes > CAPS.assetTotal) throw new Error("ARC2_ADAPTER_INVALID: signed asset aggregate");

const pageFields = ["approval_html", "approval_sha256", "approval_size", "key", "label", "path", "production_sha256", "production_size",
  "published_html", "published_sha256", "published_size", "repository_path", "url"];
if (!Array.isArray(bundle.pages) || bundle.pages.length !== 5) throw new Error("ARC2_ADAPTER_INVALID: exact five-page bundle");
const pageByPath = new Map();
for (let index = 0; index < 5; index += 1) {
  const page = bundle.pages[index];
  exactKeys(page, pageFields, `V11 page ${index + 1}`);
  const path = LOGICAL_PATHS[index];
  const expectedUrl = `https://arcwebhq-cpu.github.io/arc-previews/${previewFolder}/${path === "index.html" ? "" : path.replace(/index\.html$/, "")}`;
  const expectedPublished = page.approval_html.replace("</body>\n</html>\n", `${TOOLBAR}\n</body>\n</html>\n`);
  if (page.key !== PAGE_KEYS[index] || page.label !== PAGE_LABELS[index] || page.path !== path || page.repository_path !== `${previewFolder}/${path}` ||
      page.url !== expectedUrl || pageByPath.has(path) || ![page.approval_sha256, page.published_sha256, page.production_sha256].every(value => HEX_64.test(value)) ||
      ![page.approval_size, page.published_size, page.production_size].every(Number.isSafeInteger) || page.approval_size < 1 || page.published_size < 1 ||
      page.production_size < 1 || page.approval_size > CAPS.htmlBytes || page.published_size > CAPS.htmlBytes || page.production_size > CAPS.htmlBytes ||
      Buffer.byteLength(page.approval_html, "utf8") !== page.approval_size || Buffer.byteLength(page.published_html, "utf8") !== page.published_size ||
      await sha256(page.approval_html) !== page.approval_sha256 || await sha256(page.published_html) !== page.published_sha256 || expectedPublished !== page.published_html) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${path} signed V11 page binding`);
  }
  const scripts = page.approval_html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) || [];
  const scriptHashes = (await Promise.all(scripts.map(script => sha256(script)))).sort();
  if ((page.approval_html.match(/<script\b/gi) || []).length !== scripts.length ||
      canonicalJson(scriptHashes) !== canonicalJson(TRUSTED_SCRIPT_HASHES) || await sha256(scriptHashes.join("\n")) !== TRUSTED_SCRIPT_MANIFEST_SHA256 ||
      /<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(page.approval_html) ||
      /https?:\/\/[^"'\s<>]*stripe\.com/i.test(page.approval_html) || /\bcs_(?:test|live)_[A-Za-z0-9_]+/i.test(page.approval_html)) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${path} executable or private checkout surface`);
  }
  pageByPath.set(path, page);
}
const approvalManifest = { version: "arc-v11-approval-bundle-v1", pages: LOGICAL_PATHS.map(path => {
  const page = pageByPath.get(path); return { path, sha256: page.approval_sha256, size: page.approval_size };
}) };
const publishedManifest = { version: "arc-v11-published-preview-bundle-v1", pages: ARTIFACT_PATHS.map(path => {
  const page = pageByPath.get(path); return { path, sha256: page.published_sha256, size: page.published_size };
}) };
if (canonicalJson(bundle.approval_manifest) !== canonicalJson(approvalManifest) || canonicalJson(bundle.published_preview_manifest) !== canonicalJson(publishedManifest) ||
    await sha256(canonicalJson(approvalManifest)) !== bundle.approval_manifest_sha256 ||
    await sha256(canonicalJson(publishedManifest)) !== bundle.published_preview_bundle_sha256) {
  throw new Error("ARC2_ADAPTER_INVALID: five-page render manifests");
}

const productionPages = [];
for (const path of LOGICAL_PATHS) {
  const page = pageByPath.get(path);
  let html = replaceOne(page.approval_html, /<meta\s+name="robots"\s+content="[^"]*">/gi,
    '<meta name="robots" content="index,follow,max-image-preview:large">', `${path} robots metadata`);
  html = replaceOne(html, /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*">/gi,
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`, `${path} security policy`);
  html = replaceOne(html, /data-arc-site-mode="preview"/g, 'data-arc-site-mode="production"', `${path} production mode`);
  if (path === "contact/index.html" && bundle.lead_route_mode === "netlify_form") {
    html = replaceOne(html, /action="\.\/\?submitted=1"/g, 'action="/contact/?submitted=1"', "Contact form action");
  }
  for (const asset of assets) {
    const encodedUrl = asset.sourceUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    html = html.split(asset.sourceUrl).join(`/${asset.path}`).split(encodedUrl).join(`/${asset.path}`);
  }
  if (Buffer.byteLength(html, "utf8") !== page.production_size || /https:\/\/arcwebhq-cpu\.github\.io\/arc-previews(?:\/|["'?#]|$)/i.test(html) ||
      /<base\b/i.test(html) || await sha256(html) !== page.production_sha256) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${path} deterministic production bytes`);
  }
  productionPages.push({ path, html, bytes: Buffer.from(html, "utf8") });
}
if (productionPages.some(page => /\bformaction\b/i.test(page.html))) throw new Error("ARC2_ADAPTER_INVALID: form action override");
const formPages = productionPages.flatMap(page => (page.html.match(/<form\b/gi) || []).map(() => page.path));
const formCloseCount = productionPages.reduce((count, page) => count + (page.html.match(/<\/form\s*>/gi) || []).length, 0);
if (bundle.lead_route_mode === "not_required") {
  if (bundle.lead_route_form_name !== "" || formPages.length !== 0 || formCloseCount !== 0) throw new Error("ARC2_ADAPTER_INVALID: no-form artifact binding");
} else {
  if (bundle.lead_route_mode !== "netlify_form" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(bundle.lead_route_form_name) ||
      canonicalJson(formPages) !== canonicalJson(["contact/index.html"]) || formCloseCount !== 1) {
    throw new Error("ARC2_ADAPTER_INVALID: Contact-only lead form binding");
  }
  const contact = productionPages.find(page => page.path === "contact/index.html").html;
  const form = [...contact.matchAll(/<form\b([^>]*)>[\s\S]*?<\/form\s*>/gi)];
  const attrs = form[0]?.[1] || "";
  const attribute = name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const values = [...attrs.matchAll(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([^"']*)\\1`, "gi"))];
    if (values.length !== 1) throw new Error(`ARC2_ADAPTER_INVALID: Contact ${name} attribute`);
    return values[0][2];
  };
  if (form.length !== 1 || attribute("name") !== bundle.lead_route_form_name || attribute("method").toUpperCase() !== "POST" ||
      attribute("data-netlify").toLowerCase() !== "true" || attribute("netlify-honeypot") !== "bot-field" || attribute("action") !== "/contact/?submitted=1") {
    throw new Error("ARC2_ADAPTER_INVALID: exact Contact form contract");
  }
}

const includedAssets = new Set(assets.map(asset => asset.path));
const referencedAssets = new Set();
let aggregateHtmlBytes = 0;
const privateValues = [claimToken, workerSecret, sessionId, recipient.claim_recipient_email, recipient.lead_notification_email,
  selectedSecret, publicationSecret, artifactSecret, claim.outbox_key];
for (const page of productionPages) {
  aggregateHtmlBytes += page.bytes.length;
  const decoded = page.html.normalize("NFKC").toLowerCase();
  if (privateValues.some(value => value && decoded.includes(value.normalize("NFKC").toLowerCase())) ||
      /https?:\/\/[^"'\s<>]*stripe\.com/i.test(decoded) || /javascript\s*:/i.test(decoded)) {
    throw new Error(`ARC2_ADAPTER_INVALID: ${page.path} contains private authority`);
  }
  for (const match of page.html.matchAll(/(?:^|["'(=\s])(\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp))(?=$|["')\s,<>])/gi)) {
    referencedAssets.add(match[1].slice(1));
  }
}
if (aggregateHtmlBytes > CAPS.htmlTotal || referencedAssets.size !== includedAssets.size ||
    [...referencedAssets].some(path => !includedAssets.has(path)) || [...includedAssets].some(path => !referencedAssets.has(path))) {
  throw new Error("ARC2_ADAPTER_INVALID: exact production asset union");
}
const orderedProductionPages = ARTIFACT_PATHS.map(path => productionPages.find(page => page.path === path));
const productionContentSha256 = await framedDigest(orderedProductionPages);
if (productionContentSha256 !== bundle.production_content_sha256 || productionContentSha256 !== claim.payload.preview_content_sha256) {
  throw new Error("ARC2_ADAPTER_INVALID: paid outbox production content binding");
}

const artifactVector = [
  { path: "_headers", bytes: Buffer.from(HEADERS_FILE, "utf8") },
  ...assets.map(asset => ({ path: asset.path, bytes: Buffer.from(asset.bytes) })),
  ...orderedProductionPages.map(page => ({ path: page.path, bytes: Buffer.from(page.bytes) }))
];
const artifactBytes = artifactVector.reduce((total, entry) => total + entry.bytes.length, 0);
if (artifactVector.length < 6 || artifactVector.length > 9 || artifactBytes > CAPS.artifactTotal) {
  throw new Error("ARC2_ADAPTER_INVALID: exact artifact vector limits");
}
const artifacts = [];
for (const entry of artifactVector) artifacts.push({ path: entry.path, sha256: await sha256(entry.bytes), size: entry.bytes.length });
const artifactManifestPrivate = canonicalJson(artifacts);
const artifactManifestSha256 = await sha256(artifactManifestPrivate);
if (artifactManifestSha256 !== claim.payload.preview_manifest_sha256) {
  throw new Error("ARC2_ADAPTER_INVALID: paid outbox artifact manifest binding");
}
const bundleFingerprint = await framedDigest(artifactVector);
const deployArtifactsPrivate = canonicalJson(artifactVector.map(entry => ({ path: entry.path, content_base64: entry.bytes.toString("base64") })));
if (Buffer.byteLength(deployArtifactsPrivate, "utf8") > CAPS.deployJson) throw new Error("ARC2_ADAPTER_INVALID: deploy artifact JSON limit");

const sourceCommitSha = clean(inputData.preview_source_commit_sha).toLowerCase();
if (!HEX_40.test(sourceCommitSha)) throw new Error("ARC2_ADAPTER_INVALID: approved preview source commit");
const issuedAt = new Date(leaseExpiresMs - 5 * 60_000).toISOString();
const checkoutReferenceSha256 = await sha256(claim.payload.approval_receipt_sha256);
const previewSourceTagSha256 = await sha256(`arc-review-approved-source-v1\n${sourceCommitSha}\n${claim.payload.approval_receipt_sha256}`);
const artifactEvidence = canonicalJson({
  version: "arc2-handoff-artifact-evidence-v4",
  scope: "netlify-claimable-deploy-artifacts",
  approval_content_sha256: bundle.approval_manifest_sha256,
  artifact_manifest_sha256: artifactManifestSha256,
  artifacts,
  asset_publication_receipt_sha256: publicationSha256,
  bundle_fingerprint: bundleFingerprint,
  checkout_binding_key_id: offer.checkout_binding_key_id,
  checkout_config_snapshot_sha256: offerSha256,
  checkout_reference_sha256: checkoutReferenceSha256,
  issued_at: issuedAt,
  lead_route_form_name: bundle.lead_route_form_name,
  lead_route_mode: bundle.lead_route_mode,
  lead_route_recipient_hmac_sha256: recipient.lead_route_recipient_hmac_sha256,
  preview_folder: previewFolder,
  preview_source_commit_sha: sourceCommitSha,
  preview_source_repository: "arcwebhq-cpu/arc-previews",
  preview_source_tag_sha256: previewSourceTagSha256,
  production_content_sha256: productionContentSha256
});
const artifactEvidenceSha256 = await sha256(artifactEvidence);
const artifactKey = await hmacKey(artifactSecret);
const artifactEvidenceHmacSha256 = await sign(artifactKey, `arc2-handoff-artifact-evidence-signature-v4\n${artifactEvidence}`);
const startRequest = {
  artifact_evidence: artifactEvidence,
  artifact_evidence_hmac_sha256: artifactEvidenceHmacSha256,
  checkout_session_id: sessionId,
  claim_token: claimToken,
  deploy_artifacts: deployArtifactsPrivate,
  lead_notification_email: bundle.lead_route_mode === "netlify_form" ? recipient.lead_notification_email : "",
  lead_route_recipient_hmac_sha256: recipient.lead_route_recipient_hmac_sha256,
  outbox_key: claim.outbox_key
};
const startRequestPrivate = canonicalJson(startRequest);
if (Buffer.byteLength(startRequestPrivate, "utf8") > CAPS.startRequest) throw new Error("ARC2_ADAPTER_INVALID: first-party start request limit");
const startRequestSha256 = await sha256(startRequestPrivate);
const checkoutSessionIdSha256 = await sha256(sessionId);
const outboxKeySha256 = await sha256(claim.outbox_key);

if (clean(inputData.payment_arc2_start_enabled).toLowerCase() !== "true") {
  return {
    status: "READY_FOR_FIRST_PARTY_PAYMENT_ARC2_START",
    artifact_resolution_performed: true,
    payment_arc2_start_request_performed: false,
    provider_write_allowed_by_this_step: false,
    stripe_provider_write_allowed_by_this_step: false,
    github_provider_write_allowed_by_this_step: false,
    netlify_provider_write_allowed_by_this_step: false,
    email_allowed_by_this_step: false,
    checkout_session_id_sha256: checkoutSessionIdSha256,
    outbox_key_sha256: outboxKeySha256,
    immutable_binding_sha256: claim.immutable_binding_sha256,
    start_request_sha256: startRequestSha256,
    artifact_evidence_sha256: artifactEvidenceSha256,
    artifact_manifest_sha256: artifactManifestSha256,
    production_content_sha256: productionContentSha256,
    bundle_fingerprint: bundleFingerprint,
    artifact_count: artifacts.length,
    preview_folder: previewFolder,
    preview_source_commit_sha: sourceCommitSha
  };
}

const configuredWorkerUrl = clean(inputData.payment_arc2_worker_url);
if (configuredWorkerUrl !== WORKER_URL) throw new Error("ARC2_ADAPTER_INVALID: exact first-party worker URL");
const workerResponse = await fetchBytesBounded(configuredWorkerUrl, {
  method: "POST",
  headers: { Accept: "application/json", Authorization: `Bearer ${workerSecret}`, "Content-Type": "application/json" },
  body: startRequestPrivate
}, 128_000, "first-party payment ARC2 start", [200, 202]);
let workerResult;
try { workerResult = JSON.parse(workerResponse.bytes.toString("utf8")); } catch { throw new Error("ARC2_ADAPTER_FAILED: first-party start JSON"); }
if (!workerResult || typeof workerResult !== "object" || Array.isArray(workerResult) || Object.getPrototypeOf(workerResult) !== Object.prototype) {
  throw new Error("ARC2_ADAPTER_FAILED: first-party start response");
}
const allowedResultFields = new Set(["accepted", "arc2_start_receipt_sha256", "claim_attempt_count", "handoff_id", "handoff_state",
  "idempotent_replay", "immutable_binding_sha256", "lease_expires_at", "outbox_key", "retry_required", "reversal_control_ready",
  "start_receipt", "start_receipt_hmac_sha256", "state"]);
const receiptEnvelopeFields = ["handoff_id", "handoff_state", "reversal_control_ready", "start_receipt", "start_receipt_hmac_sha256"];
const receiptEnvelopeFieldCount = receiptEnvelopeFields.filter(field => Object.hasOwn(workerResult, field)).length;
const completedReplayWithoutReceipt = workerResponse.status === 200 && workerResult.state === "COMPLETED" &&
  workerResult.idempotent_replay === true && receiptEnvelopeFieldCount === 0;
if (Object.keys(workerResult).some(field => !allowedResultFields.has(field)) || workerResult.accepted !== true ||
    workerResult.outbox_key !== claim.outbox_key || workerResult.immutable_binding_sha256 !== claim.immutable_binding_sha256 ||
    typeof workerResult.idempotent_replay !== "boolean" || !Number.isSafeInteger(workerResult.claim_attempt_count) ||
    workerResult.claim_attempt_count < claim.claim_attempt_count ||
    (receiptEnvelopeFieldCount !== 0 && receiptEnvelopeFieldCount !== receiptEnvelopeFields.length) ||
    (workerResponse.status === 202
      ? (workerResult.retry_required !== true || workerResult.state !== "PENDING" || workerResult.arc2_start_receipt_sha256 !== null ||
        receiptEnvelopeFieldCount !== receiptEnvelopeFields.length)
      : (workerResult.retry_required !== undefined || workerResult.state !== "COMPLETED" ||
        !HEX_64.test(workerResult.arc2_start_receipt_sha256) ||
        (receiptEnvelopeFieldCount === 0 && !completedReplayWithoutReceipt)))) {
  throw new Error("ARC2_ADAPTER_FAILED: first-party start binding");
}
let observedStartReceiptSha256 = "";
if (!completedReplayWithoutReceipt) {
  const startReceiptContext = parseCanonical(workerResult.start_receipt, "first-party start receipt", 20_000);
  const startReceipt = startReceiptContext.value;
  exactKeys(startReceipt, START_RECEIPT_FIELDS, "first-party start receipt");
  observedStartReceiptSha256 = await sha256(startReceiptContext.raw);
  const persistedReceiptBindingValid = workerResponse.status === 200
    ? workerResult.arc2_start_receipt_sha256 === observedStartReceiptSha256
    : workerResult.arc2_start_receipt_sha256 === null;
  if (!HEX_64.test(workerResult.start_receipt_hmac_sha256) || !persistedReceiptBindingValid || !HEX_64.test(workerResult.handoff_id) ||
      typeof workerResult.reversal_control_ready !== "boolean" || startReceipt.schema !== "arc2-review-handoff-start-receipt-v2" ||
      startReceipt.accepted !== true || startReceipt.handoff_id !== workerResult.handoff_id ||
      startReceipt.handoff_state !== workerResult.handoff_state ||
      startReceipt.reversal_control_ready !== workerResult.reversal_control_ready ||
      startReceipt.continuation_ready !== (workerResponse.status === 200) ||
      startReceipt.artifact_evidence_sha256 !== artifactEvidenceSha256 ||
      startReceipt.bridge_immutable_binding_sha256 !== claim.immutable_binding_sha256 ||
      startReceipt.review_session_binding_sha256 !== claim.payload.review_session_binding_sha256 ||
      startReceipt.checkout_session_id_hmac_sha256 !== claim.payload.checkout_session_id_hmac_sha256 ||
      startReceipt.payment_intent_id_hmac_sha256 !== claim.payload.payment_intent_id_hmac_sha256 ||
      startReceipt.recipient_email_sha256 !== claim.payload.recipient_email_sha256 ||
      startReceipt.payer_email_sha256 !== claim.payload.payer_email_sha256 ||
      START_RECEIPT_FIELDS.filter(field => field.endsWith("_sha256")).some(field => !HEX_64.test(startReceipt[field]))) {
    throw new Error("ARC2_ADAPTER_FAILED: signed first-party start receipt");
  }
  iso(startReceipt.started_at, "first-party start receipt timestamp");
}

return {
  status: workerResponse.status === 202 ? "PAYMENT_ARC2_START_RETRY_REQUIRED" : "PAYMENT_ARC2_START_COMPLETED",
  artifact_resolution_performed: true,
  payment_arc2_start_request_performed: true,
  provider_write_allowed_by_this_step: false,
  first_party_worker_may_perform_provider_mutations: true,
  stripe_provider_write_allowed_by_this_step: false,
  github_provider_write_allowed_by_this_step: false,
  netlify_provider_write_allowed_by_this_step: false,
  email_allowed_by_this_step: false,
  checkout_session_id_sha256: checkoutSessionIdSha256,
  outbox_key_sha256: outboxKeySha256,
  immutable_binding_sha256: claim.immutable_binding_sha256,
  start_request_sha256: startRequestSha256,
  artifact_evidence_sha256: artifactEvidenceSha256,
  artifact_manifest_sha256: artifactManifestSha256,
  production_content_sha256: productionContentSha256,
  bundle_fingerprint: bundleFingerprint,
  artifact_count: artifacts.length,
  preview_folder: previewFolder,
  preview_source_commit_sha: sourceCommitSha,
  handoff_id: workerResult.handoff_id || "",
  handoff_state: workerResult.handoff_state || "",
  reversal_control_ready: workerResult.reversal_control_ready === true,
  retry_required: workerResponse.status === 202,
  observed_start_receipt_sha256: observedStartReceiptSha256,
  first_party_start_receipt_sha256: workerResult.arc2_start_receipt_sha256 || ""
};
