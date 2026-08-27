import { createHash } from "node:crypto";

export const SYNTHETIC_STRIPE_API_VERSION = "2026-07-29.dahlia";
export const SYNTHETIC_SUBTOTAL_MINOR_UNITS = 500000;
export const SYNTHETIC_HTML_PATHS = Object.freeze([
  "about/index.html",
  "contact/index.html",
  "process/index.html",
  "services/index.html",
  "index.html"
]);

const SUPPORTED_NICHES = new Set(["roofing", "hvac", "remodeling", "landscaping", "auto_detailing"]);
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
const assertTestIdentifier = (value, pattern, label) => {
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
  let activeLink = null;
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

  const activateLink = configuration => {
    if (configuration?.payment_method_types !== undefined || configuration?.payment_method_selection !== "dynamic") {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: Stripe dynamic payment methods are required");
    }
    if (configuration.checkout_policy_version !== "arc-private-checkout-policy-v2" ||
        configuration.offer_contract_id !== "arc-fixed-five-page-offer-v1" ||
        configuration.deliverable !== "fixed-five-page-marketing-website-v1" || configuration.page_count !== 5 ||
        configuration.automatic_tax_enabled !== true || configuration.tax_settings_status !== "active" ||
        !Array.isArray(configuration.active_tax_registration_states) || !configuration.active_tax_registration_states.includes("WA") ||
        configuration.billing_address_collection !== "required" || configuration.destination_address_required !== true) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: active tax registration and destination-address collection are required");
    }
    assertTestIdentifier(configuration.payment_link_id, /^plink_[A-Za-z0-9]+$/, "Payment Link id");
    const activatedAt = exactIso(configuration.activated_at, "Link activation");
    const expiresAt = exactIso(configuration.expires_at, "Link expiry");
    if (expiresAt <= activatedAt || expiresAt - activatedAt > 7 * 24 * 60 * 60 * 1000) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: bounded private Link expiry required");
    }
    activeLink = {
      paymentLinkId: configuration.payment_link_id,
      generation: configuration.generation,
      activatedAt,
      expiresAt,
      active: true,
      completedSessions: 0,
      taxRegistrationStates: [...configuration.active_tax_registration_states].sort()
    };
    state = "LINK_ACTIVE";
    return snapshot();
  };

  const validateSession = session => {
    requireProviderProof(session);
    assertTestIdentifier(session.id, /^cs_test_[A-Za-z0-9_]+$/, "Checkout Session id");
    if (!activeLink || session.payment_link_id !== activeLink.paymentLinkId || activeLink.active !== true) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: session is not bound to the active private Link");
    }
    if (session.amount_subtotal !== SYNTHETIC_SUBTOTAL_MINOR_UNITS || !Number.isSafeInteger(session.amount_tax) || session.amount_tax < 0 ||
        session.amount_total !== session.amount_subtotal + session.amount_tax || session.currency !== "usd" ||
        session.automatic_tax_enabled !== true || session.automatic_tax_status !== "complete" ||
        session.billing_address_complete !== true || session.destination_address_complete !== true ||
        session.price_tax_behavior !== "exclusive" || session.tax_settings_status !== "active" ||
        session.tax_registration_snapshot_status !== "active") {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: authenticated $5,000 plus Stripe Tax session contract failed");
    }
    if (session.tax_jurisdiction_applies === true && session.amount_tax <= 0) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: applicable synthetic tax jurisdiction must produce nonzero tax");
    }
    if (session.tax_jurisdiction_applies === false && session.amount_tax !== 0) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: non-applicable synthetic tax jurisdiction must remain zero");
    }
    if (session.tax_jurisdiction_applies === true && !activeLink.taxRegistrationStates.includes(session.destination_state)) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: destination tax registration is not active");
    }
  };

  const checkoutEvent = event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: checkout event");
    assertTestIdentifier(event.id, /^evt_[A-Za-z0-9_]+$/, "Stripe event id");
    if (!new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]).has(event.type)) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: unsupported checkout event");
    }
    const digest = sha256(canonicalJson(event));
    const replay = processedEvents.get(event.id);
    if (replay) {
      if (replay.digest !== digest) throw new Error("ARC_SYNTHETIC_E2E_CONFLICT: event id replay changed bytes");
      return { ...replay.result, idempotentReplay: true };
    }
    validateSession(event.session);
    let result;
    if (event.session.payment_status !== "paid") {
      if (event.type !== "checkout.session.completed") {
        throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: async success event is not paid");
      }
      state = "PAYMENT_PENDING";
      result = { state, handoffReady: false, fulfillmentClaimConsumed: false, idempotentReplay: false };
    } else {
      const existing = paidSessions.get(event.session.id);
      if (existing && existing.digest !== sha256(canonicalJson(event.session))) {
        throw new Error("ARC_SYNTHETIC_E2E_CONFLICT: paid session replay changed authenticated facts");
      }
      if (!existing) {
        paidSessions.set(event.session.id, { digest: sha256(canonicalJson(event.session)) });
        activeLink.completedSessions += 1;
      }
      if (activeLink.completedSessions !== 1) throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: private Link completed-session limit exceeded");
      lastPayment = {
        checkoutSessionId: event.session.id,
        paymentIntentId: event.session.payment_intent_id,
        chargeId: event.session.charge_id,
        amountTotal: event.session.amount_total,
        digest: sha256(canonicalJson(event.session))
      };
      state = "PAYMENT_VERIFIED";
      result = { state, handoffReady: false, fulfillmentClaimConsumed: true, idempotentReplay: Boolean(existing) };
    }
    processedEvents.set(event.id, { digest, result });
    return result;
  };

  const prepareHandoff = () => {
    if (state === "HALTED") throw new Error("ARC_SYNTHETIC_E2E_HALTED: reversal prevents handoff");
    if (state === "HANDOFF_READY" && handoff) return { ...handoff, idempotent_replay: true };
    if (!lastPayment || state !== "PAYMENT_VERIFIED") throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: authenticated paid session required before handoff");
    if (!handoff) {
      handoffCount += 1;
      handoff = {
        version: "arc-synthetic-five-page-test-handoff-v2",
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
    }
    state = "HANDOFF_READY";
    return { ...handoff, idempotent_replay: false };
  };

  const expireLink = () => {
    if (!activeLink || !activeLink.active || now().getTime() < activeLink.expiresAt) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: Link is not expired");
    }
    if (activeLink.completedSessions !== 0) throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: paid Link cannot enter unpaid expiry lifecycle");
    state = "LINK_EXPIRED";
    return snapshot();
  };

  const deactivateExpiredLink = evidence => {
    requireProviderProof(evidence);
    if (state !== "LINK_EXPIRED" || evidence.payment_link_id !== activeLink?.paymentLinkId || evidence.active !== false ||
        evidence.completed_sessions_count !== 0) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: exact inactive unpaid Link readback required");
    }
    activeLink.active = false;
    state = "LINK_DEACTIVATED";
    return snapshot();
  };

  const renewLink = configuration => {
    if (state !== "LINK_DEACTIVATED" || configuration.predecessor_payment_link_id !== activeLink?.paymentLinkId ||
        configuration.payment_link_id === activeLink.paymentLinkId || configuration.precreate_offer_and_tax_ready !== true ||
        configuration.precreate_preview_ready !== true || configuration.postcreate_offer_and_tax_ready !== true ||
        configuration.postcreate_preview_ready !== true) {
      throw new Error("ARC_SYNTHETIC_E2E_BLOCKED: deactivated predecessor plus fresh pre/post renewal proofs required");
    }
    return activateLink({ ...configuration, generation: activeLink.generation + 1 });
  };

  const reversalEvent = event => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("ARC_SYNTHETIC_E2E_INVALID: reversal event");
    assertTestIdentifier(event.id, /^evt_[A-Za-z0-9_]+$/, "Stripe reversal event id");
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
      paymentLinkId: activeLink?.paymentLinkId ?? null,
      linkGeneration: activeLink?.generation ?? null,
      handoffCount
    };
  }

  return { activateLink, checkoutEvent, deactivateExpiredLink, expireLink, prepareHandoff, renewLink, reversalEvent, snapshot };
}
