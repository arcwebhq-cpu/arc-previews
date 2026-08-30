import { createHash } from "node:crypto";

export const SYNTHETIC_STRIPE_API_VERSION = "2026-08-26.dahlia";
export const SYNTHETIC_SUBTOTAL_MINOR_UNITS = 500000;
export const SYNTHETIC_HTML_PATHS = Object.freeze([
  "about/index.html",
  "contact/index.html",
  "process/index.html",
  "services/index.html",
  "index.html"
]);

const SUPPORTED_NICHES = new Set(["roofing", "hvac", "remodeling", "landscaping", "auto_detailing"]);
const CHECKOUT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded"
]);
const REVERSAL_EVENTS = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed"
]);

const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: canonical JSON value");
};
const sha256 = value => createHash("sha256").update(value).digest("hex");
const exactIso = (value, label) => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`ARC_SYNTHETIC_E2E_INVALID: ${label} timestamp`);
  }
  return milliseconds;
};
const assertIdentifier = (value, pattern, label) => {
  if (!pattern.test(String(value ?? ""))) throw new TypeError(`ARC_SYNTHETIC_E2E_INVALID: ${label}`);
};

export function createSyntheticStripeTestHandoffSimulator({
  niche,
  previewFolder,
  previewPages,
  clock = () => new Date()
}) {
  if (!SUPPORTED_NICHES.has(niche)) throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: unsupported launch niche");
  if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder)) {
    throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: preview folder");
  }
  if (!Array.isArray(previewPages) || previewPages.length !== 5 ||
      JSON.stringify(previewPages.map(page => page?.path)) !== JSON.stringify(SYNTHETIC_HTML_PATHS) ||
      previewPages.some(page => !page || typeof page !== "object" || Array.isArray(page) || typeof page.html !== "string" ||
        !page.html.includes("ARC Client Master Template v11.0") ||
        !page.html.includes("Review and payment are available through your private review link.") ||
        /buy\.stripe\.com|\bplink_[A-Za-z0-9]+|client_reference_id|v[34]_[A-Za-z0-9_-]{135}/i.test(page.html))) {
    throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: exact ordered inert ARC five-page v11 bundle required");
  }
  const productionHasher = createHash("sha256");
  for (const page of previewPages) productionHasher.update(page.path).update("\0").update(page.html).update("\0");
  const productionContentSha256 = productionHasher.digest("hex");
  const processedEvents = new Map();
  const paidSessions = new Map();
  let state = "PREVIEW_READY";
  let checkout = null;
  let lastPayment = null;
  let handoff = null;
  let handoffCount = 0;

  const now = () => {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: clock");
    return value;
  };
  const requireProviderProof = value => {
    if (value?.webhook_signature_verified !== true || value?.authenticated_session_retrieved !== true) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: signed webhook plus authenticated provider retrieval required");
    }
    if (value.stripe_api_version !== SYNTHETIC_STRIPE_API_VERSION) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: pinned Stripe API contract mismatch");
    }
    if (value.livemode !== false) throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: simulator accepts test mode only");
  };

  const authorizeCheckout = configuration => {
    if (state !== "PREVIEW_READY") throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: checkout authorization is single-use");
    if (configuration?.payment_method_types !== undefined || configuration?.payment_method_selection !== "dynamic") {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: Stripe dynamic payment methods are required");
    }
    if (configuration.payment_link !== null) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: V11 Checkout Session payment_link must be null");
    }
    if (configuration.offer_contract_id !== "arc-fixed-five-page-offer-v1" ||
        configuration.deliverable !== "fixed-five-page-marketing-website-v1" || configuration.page_count !== 5 ||
        configuration.amount_subtotal_minor_units !== SYNTHETIC_SUBTOTAL_MINOR_UNITS || configuration.currency !== "usd" ||
        configuration.automatic_tax_enabled !== true || configuration.tax_settings_status !== "active" ||
        !Array.isArray(configuration.active_tax_registration_states) || !configuration.active_tax_registration_states.includes("WA") ||
        configuration.customer_creation !== "always" || configuration.submit_type !== "pay" ||
        configuration.destination_address_source !== "stripe_checkout_customer_details.address") {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: canonical private Checkout Session configuration required");
    }
    assertIdentifier(configuration.checkout_session_id, /^cs_test_[A-Za-z0-9_]+$/, "Checkout Session id");
    assertIdentifier(configuration.checkout_reference, /^v4_[A-Za-z0-9_-]{135}$/, "checkout reference");
    const createdAt = exactIso(configuration.created_at, "checkout creation");
    const expiresAt = exactIso(configuration.expires_at, "checkout expiry");
    if (expiresAt <= createdAt || expiresAt - createdAt > 30 * 60 * 1000) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: bounded Checkout Session expiry required");
    }
    checkout = {
      sessionId: configuration.checkout_session_id,
      reference: configuration.checkout_reference,
      createdAt,
      expiresAt,
      taxRegistrationStates: [...configuration.active_tax_registration_states].sort()
    };
    state = "CHECKOUT_AUTHORIZED";
    return snapshot();
  };

  const validateSession = session => {
    requireProviderProof(session);
    if (!checkout || now().getTime() >= checkout.expiresAt) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: fresh approved Checkout Session required");
    }
    if (session.id !== checkout.sessionId || session.client_reference_id !== checkout.reference || session.payment_link !== null) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: authenticated Session is not the approval-bound private Checkout Session");
    }
    if (session.amount_subtotal !== SYNTHETIC_SUBTOTAL_MINOR_UNITS || !Number.isSafeInteger(session.amount_tax) || session.amount_tax < 0 ||
        session.amount_total !== session.amount_subtotal + session.amount_tax || session.currency !== "usd" ||
        session.automatic_tax_enabled !== true || session.automatic_tax_status !== "complete" ||
        session.destination_address_complete !== true || session.price_tax_behavior !== "exclusive" ||
        session.tax_settings_status !== "active" || session.tax_registration_snapshot_status !== "active") {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: authenticated $5,000 plus Stripe Tax Session contract failed");
    }
    if (session.taxability_reason === "standard_rated" && session.amount_tax <= 0) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: standard-rated destination must produce nonzero tax");
    }
    if (session.taxability_reason === "not_taxable" && session.amount_tax !== 0) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: nontaxable destination must remain zero tax");
    }
    if (!["standard_rated", "not_taxable"].includes(session.taxability_reason)) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: unsupported taxability reason");
    }
    if (session.taxability_reason === "standard_rated" && !checkout.taxRegistrationStates.includes(session.destination_state)) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: destination tax registration is not active");
    }
  };

  const checkoutEvent = event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: checkout event");
    assertIdentifier(event.id, /^evt_[A-Za-z0-9_]+$/, "Stripe event id");
    if (!CHECKOUT_EVENTS.has(event.type)) throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: unsupported checkout event");
    const digest = sha256(canonicalJson(event));
    const replay = processedEvents.get(event.id);
    if (replay) {
      if (replay.digest !== digest) throw new Error("ARC_SYNTHETIC_E2E_CONFLICT: event id replay changed bytes");
      return { ...replay.result, idempotentReplay: true };
    }
    validateSession(event.session);
    let result;
    if (event.session.payment_status !== "paid") {
      if (event.type !== "checkout.session.completed") throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: async success event is not paid");
      state = "PAYMENT_PENDING";
      result = { state, handoffReady: false, fulfillmentClaimConsumed: false, idempotentReplay: false };
    } else {
      const sessionDigest = sha256(canonicalJson(event.session));
      const existing = paidSessions.get(event.session.id);
      if (existing && existing !== sessionDigest) throw new Error("ARC_SYNTHETIC_E2E_CONFLICT: paid Session replay changed authenticated facts");
      if (!existing) paidSessions.set(event.session.id, sessionDigest);
      lastPayment = {
        checkoutSessionId: event.session.id,
        paymentIntentId: event.session.payment_intent_id,
        chargeId: event.session.charge_id,
        digest: sessionDigest
      };
      state = "PAYMENT_VERIFIED";
      result = { state, handoffReady: false, fulfillmentClaimConsumed: true, idempotentReplay: Boolean(existing) };
    }
    processedEvents.set(event.id, { digest, result });
    return result;
  };

  const expireCheckout = () => {
    if (!checkout || lastPayment || now().getTime() < checkout.expiresAt) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: unpaid Checkout Session is not expired");
    }
    state = "CHECKOUT_EXPIRED";
    return snapshot();
  };

  const prepareHandoff = () => {
    if (state === "HALTED") throw new Error("ARC_SYNTHETIC_E2E_HALTED: reversal prevents handoff");
    if (state === "HANDOFF_READY" && handoff) return { ...handoff, idempotent_replay: true };
    if (!lastPayment || state !== "PAYMENT_VERIFIED") throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: authenticated paid Session required before handoff");
    handoffCount += 1;
    handoff = {
      version: "arc-synthetic-five-page-test-handoff-v3",
      synthetic: true,
      external_provider_proof: false,
      niche,
      preview_folder: previewFolder,
      offer_contract_id: "arc-fixed-five-page-offer-v1",
      deliverable: "fixed-five-page-marketing-website-v1",
      page_count: 5,
      preview_paths: SYNTHETIC_HTML_PATHS.map(path => `${previewFolder}/${path}`),
      production_content_sha256: productionContentSha256,
      checkout_session_id_sha256: sha256(lastPayment.checkoutSessionId),
      payment_evidence_sha256: lastPayment.digest,
      artifact_binding_sha256: sha256(`${previewFolder}\n${productionContentSha256}\n${lastPayment.digest}`)
    };
    state = "HANDOFF_READY";
    return { ...handoff, idempotent_replay: false };
  };

  const reversalEvent = event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: reversal event");
    assertIdentifier(event.id, /^evt_[A-Za-z0-9_]+$/, "Stripe event id");
    requireProviderProof(event);
    if (!REVERSAL_EVENTS.has(event.type) || !lastPayment || event.payment_intent_id !== lastPayment.paymentIntentId ||
        event.charge_id !== lastPayment.chargeId) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: reversal is not bound to the verified payment");
    }
    const digest = sha256(canonicalJson(event));
    const replay = processedEvents.get(event.id);
    if (replay) {
      if (replay.digest !== digest) throw new Error("ARC_SYNTHETIC_E2E_CONFLICT: reversal replay changed bytes");
      return { ...replay.result, idempotentReplay: true };
    }
    state = "HALTED";
    handoff = null;
    const result = { state, handoffReady: false, deliveryHalted: true, automaticRefundRequested: false, idempotentReplay: false };
    processedEvents.set(event.id, { digest, result });
    return result;
  };

  function snapshot() {
    return {
      synthetic: true,
      externalProviderProof: false,
      niche,
      state,
      productionContentSha256,
      checkoutSessionIdSha256: checkout ? sha256(checkout.sessionId) : null,
      handoffCount
    };
  }

  return { authorizeCheckout, checkoutEvent, expireCheckout, prepareHandoff, reversalEvent, snapshot };
}
