import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { fixtures } from "../fixtures/v11_industries.mjs";
import { renderV11Site } from "../scripts/v11_site_contract.mjs";
import {
  createSyntheticStripeTestHandoffSimulator,
  SYNTHETIC_HTML_PATHS,
  SYNTHETIC_STRIPE_API_VERSION,
  SYNTHETIC_SUBTOTAL_MINOR_UNITS
} from "../scripts/test_mode_e2e_simulator.mjs";

const [template, simulatorSource] = await Promise.all([
  readFile(new URL("../ARC_MASTER_TEMPLATE_V11.html", import.meta.url), "utf8"),
  readFile(new URL("../scripts/test_mode_e2e_simulator.mjs", import.meta.url), "utf8")
]);
const launchFixtures = new Map(fixtures.filter(fixture => fixture.isLaunch).map(fixture => [fixture.expectedProfile, fixture]));
assert.deepEqual([...launchFixtures.keys()], ["roofing", "hvac", "remodeling", "landscaping", "auto_detailing"]);
assert.doesNotMatch(simulatorSource, /\bplink_|buy\.stripe\.com|activateLink|renewLink|deactivateExpiredLink|LINK_ACTIVE|LINK_DEACTIVATED/,
  "Synthetic V11 validation still models a Payment Link lifecycle.");
assert.match(simulatorSource, /session\.payment_link !== null/,
  "Synthetic V11 validation must require authenticated Checkout Sessions to have payment_link=null.");

const referenceFor = niche => `v4_${Buffer.from(niche).toString("base64url").padEnd(135, "A").slice(0, 135)}`;
const makeHarness = (niche, clockValue = "2026-08-21T18:00:00.000Z", suffix = "") => {
  const fixture = launchFixtures.get(niche);
  const previewFolder = `${niche.replaceAll("_", "-")}-synthetic-${fixture.id}`;
  const rendered = renderV11Site(template, fixture.content, {
    trustedEventPrefix: fixture.id,
    customerEmail: fixture.customerEmail,
    leadNotificationEmail: `verified-${niche}@example.test`
  });
  let currentTime = new Date(clockValue);
  const simulator = createSyntheticStripeTestHandoffSimulator({
    niche,
    previewFolder,
    previewPages: SYNTHETIC_HTML_PATHS.map(path => {
      const page = rendered.pages.find(item => item.path === path);
      return { path: page.path, html: page.html };
    }),
    clock: () => new Date(currentTime)
  });
  return {
    fixture,
    previewFolder,
    simulator,
    setClock: value => { currentTime = new Date(value); },
    sessionId: `cs_test_${niche.replaceAll("_", "")}${suffix}`,
    checkoutReference: referenceFor(`${niche}${suffix}`)
  };
};

const checkoutConfiguration = ({ sessionId, checkoutReference, createdAt = "2026-08-21T17:55:00.000Z", expiresAt = "2026-08-21T18:25:00.000Z" }) => ({
  checkout_session_id: sessionId,
  checkout_reference: checkoutReference,
  payment_link: null,
  offer_contract_id: "arc-fixed-five-page-offer-v1",
  deliverable: "fixed-five-page-marketing-website-v1",
  page_count: 5,
  amount_subtotal_minor_units: SYNTHETIC_SUBTOTAL_MINOR_UNITS,
  currency: "usd",
  payment_method_selection: "dynamic",
  automatic_tax_enabled: true,
  tax_settings_status: "active",
  active_tax_registration_states: ["AZ", "CO", "TX", "WA"],
  destination_address_source: "stripe_checkout_customer_details.address",
  customer_creation: "always",
  submit_type: "pay",
  created_at: createdAt,
  expires_at: expiresAt
});

const paidSession = ({ niche, sessionId, checkoutReference, state, tax, reason = "standard_rated", paymentStatus = "paid", suffix = "" }) => ({
  id: sessionId,
  client_reference_id: checkoutReference,
  payment_link: null,
  payment_intent_id: `pi_${niche.replaceAll("_", "")}${suffix}`,
  charge_id: `ch_${niche.replaceAll("_", "")}${suffix}`,
  payment_status: paymentStatus,
  amount_subtotal: SYNTHETIC_SUBTOTAL_MINOR_UNITS,
  amount_tax: tax,
  amount_total: SYNTHETIC_SUBTOTAL_MINOR_UNITS + tax,
  currency: "usd",
  livemode: false,
  webhook_signature_verified: true,
  authenticated_session_retrieved: true,
  stripe_api_version: SYNTHETIC_STRIPE_API_VERSION,
  automatic_tax_enabled: true,
  automatic_tax_status: "complete",
  destination_address_complete: true,
  destination_state: state,
  taxability_reason: reason,
  tax_settings_status: "active",
  tax_registration_snapshot_status: "active",
  price_tax_behavior: "exclusive"
});
const checkoutEvent = ({ id, type = "checkout.session.completed", session }) => ({ id, type, session });
const reversalEvent = ({ id, type, session }) => ({
  id,
  type,
  payment_intent_id: session.payment_intent_id,
  charge_id: session.charge_id,
  livemode: false,
  webhook_signature_verified: true,
  authenticated_session_retrieved: true,
  stripe_api_version: SYNTHETIC_STRIPE_API_VERSION
});
const authorize = harness => harness.simulator.authorizeCheckout(checkoutConfiguration({
  sessionId: harness.sessionId,
  checkoutReference: harness.checkoutReference
}));

// Roofing: an approval-bound paid Checkout Session reaches one synthetic handoff.
{
  const harness = makeHarness("roofing");
  authorize(harness);
  const session = paidSession({ niche: "roofing", sessionId: harness.sessionId, checkoutReference: harness.checkoutReference, state: "WA", tax: 50000 });
  assert.equal(harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_RoofingPaid", session })).state, "PAYMENT_VERIFIED");
  const handoff = harness.simulator.prepareHandoff();
  assert.equal(handoff.synthetic, true);
  assert.equal(handoff.external_provider_proof, false);
  assert.equal(handoff.version, "arc-synthetic-five-page-test-handoff-v3");
  assert.equal(handoff.niche, "roofing");
  assert.equal(handoff.page_count, 5);
  assert.deepEqual(handoff.preview_paths, SYNTHETIC_HTML_PATHS.map(path => `${harness.previewFolder}/${path}`));
  assert.match(handoff.production_content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(harness.simulator.snapshot().handoffCount, 1);
}

assert.throws(() => createSyntheticStripeTestHandoffSimulator({
  niche: "roofing",
  previewFolder: "roofing-synthetic-a1000001",
  previewHtml: "<!doctype html>ARC Client Master Template v10.0"
}), /exact ordered inert ARC five-page v11 bundle required/);

// HVAC: exact Stripe and handoff replays remain idempotent.
{
  const harness = makeHarness("hvac");
  authorize(harness);
  const event = checkoutEvent({ id: "evt_HvacPaid", session: paidSession({ niche: "hvac", sessionId: harness.sessionId, checkoutReference: harness.checkoutReference, state: "CO", tax: 40000 }) });
  assert.equal(harness.simulator.checkoutEvent(event).idempotentReplay, false);
  assert.equal(harness.simulator.checkoutEvent(event).idempotentReplay, true);
  assert.equal(harness.simulator.prepareHandoff().idempotent_replay, false);
  assert.equal(harness.simulator.prepareHandoff().idempotent_replay, true);
  assert.equal(harness.simulator.snapshot().handoffCount, 1);
}

// Remodeling: an unpaid completed event consumes no claim; async success remains eligible.
{
  const harness = makeHarness("remodeling");
  authorize(harness);
  const pendingSession = paidSession({ niche: "remodeling", sessionId: harness.sessionId, checkoutReference: harness.checkoutReference, state: "TX", tax: 41250, paymentStatus: "unpaid" });
  const pending = harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_RemodelingPending", session: pendingSession }));
  assert.equal(pending.state, "PAYMENT_PENDING");
  assert.equal(pending.fulfillmentClaimConsumed, false);
  assert.throws(() => harness.simulator.prepareHandoff(), /authenticated paid Session required/);
  const paid = harness.simulator.checkoutEvent(checkoutEvent({
    id: "evt_RemodelingAsyncPaid",
    type: "checkout.session.async_payment_succeeded",
    session: { ...pendingSession, payment_status: "paid" }
  }));
  assert.equal(paid.state, "PAYMENT_VERIFIED");
  assert.equal(harness.simulator.prepareHandoff().niche, "remodeling");
}

// Landscaping: an unpaid expired Session is terminal and never enters a Link-renewal lifecycle.
{
  const harness = makeHarness("landscaping", "2026-08-21T18:30:00.000Z");
  harness.simulator.authorizeCheckout(checkoutConfiguration({
    sessionId: harness.sessionId,
    checkoutReference: harness.checkoutReference,
    createdAt: "2026-08-21T17:55:00.000Z",
    expiresAt: "2026-08-21T18:25:00.000Z"
  }));
  assert.equal(harness.simulator.expireCheckout().state, "CHECKOUT_EXPIRED");
  const late = paidSession({ niche: "landscaping", sessionId: harness.sessionId, checkoutReference: harness.checkoutReference, state: "OR", tax: 0, reason: "not_taxable" });
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_LandscapingLate", session: late })), /fresh approved Checkout Session required/);
  assert.throws(() => authorize(harness), /single-use/);
}

// Auto detailing: either a bound refund or dispute permanently halts pre-handoff delivery.
for (const [suffix, type] of [["Refund", "refund.created"], ["Dispute", "charge.dispute.created"]]) {
  const harness = makeHarness("auto_detailing", "2026-08-21T18:00:00.000Z", suffix);
  authorize(harness);
  const session = paidSession({ niche: "auto_detailing", sessionId: harness.sessionId, checkoutReference: harness.checkoutReference, state: "AZ", tax: 42500, suffix });
  harness.simulator.checkoutEvent(checkoutEvent({ id: `evt_AutoPaid${suffix}`, session }));
  const halted = harness.simulator.reversalEvent(reversalEvent({ id: `evt_Auto${suffix}`, type, session }));
  assert.equal(halted.deliveryHalted, true);
  assert.equal(halted.automaticRefundRequested, false);
  assert.throws(() => harness.simulator.prepareHandoff(), /reversal prevents handoff/);
}

// Guardrails: no Payment Link binding, pinned payment methods, unsigned webhook, tax drift, or API drift may pass.
{
  const harness = makeHarness("roofing", "2026-08-21T18:00:00.000Z", "Guard");
  assert.throws(() => harness.simulator.authorizeCheckout({
    ...checkoutConfiguration({ sessionId: harness.sessionId, checkoutReference: harness.checkoutReference }),
    payment_link: "legacy-capability"
  }), /payment_link must be null/);
  assert.throws(() => harness.simulator.authorizeCheckout({
    ...checkoutConfiguration({ sessionId: harness.sessionId, checkoutReference: harness.checkoutReference }),
    payment_method_types: ["card"]
  }), /dynamic payment methods/);
  authorize(harness);
  const applicableZeroTax = paidSession({ niche: "roofing", sessionId: harness.sessionId, checkoutReference: harness.checkoutReference, state: "WA", tax: 0 });
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_ZeroApplicableTax", session: applicableZeroTax })), /nonzero tax/);
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({
    id: "evt_UnsignedWebhook",
    session: { ...applicableZeroTax, amount_tax: 50000, amount_total: 550000, webhook_signature_verified: false }
  })), /signed webhook/);
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({
    id: "evt_ApiDrift",
    session: { ...applicableZeroTax, amount_tax: 50000, amount_total: 550000, stripe_api_version: "2025-01-01" }
  })), /API contract mismatch/);
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({
    id: "evt_WrongReference",
    session: { ...applicableZeroTax, amount_tax: 50000, amount_total: 550000, client_reference_id: referenceFor("wrong") }
  })), /approval-bound private Checkout Session/);
}

console.log("Five-niche synthetic Stripe Checkout Session flow passed: payment_link=null, tax, expiry, replay, async payment, reversal, and handoff controls.");
