import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { fixtures } from "../fixtures/v10_industries.mjs";
import { renderPreview } from "../scripts/arc_contract.mjs";
import {
  createSyntheticStripeTestHandoffSimulator,
  SYNTHETIC_STRIPE_API_VERSION,
  SYNTHETIC_SUBTOTAL_MINOR_UNITS
} from "../scripts/test_mode_e2e_simulator.mjs";

const template = await readFile(new URL("../ARC_MASTER_TEMPLATE.html", import.meta.url), "utf8");
const launchFixtures = new Map(fixtures.filter(fixture => fixture.isLaunch).map(fixture => [fixture.expectedProfile, fixture]));
assert.deepEqual([...launchFixtures.keys()], ["roofing", "hvac", "remodeling", "landscaping", "auto_detailing"]);

const makeHarness = (niche, clockValue = "2026-08-21T18:00:00.000Z", suffix = "") => {
  const fixture = launchFixtures.get(niche);
  const previewFolder = `${niche.replaceAll("_", "-")}-synthetic-${fixture.id}`;
  const rendered = renderPreview(template, fixture.content, {
    trustedEventPrefix: fixture.id,
    customerEmail: fixture.customerEmail,
    leadNotificationEmail: `verified-${niche}@example.test`
  });
  let currentTime = new Date(clockValue);
  const simulator = createSyntheticStripeTestHandoffSimulator({
    niche,
    previewFolder,
    previewHtml: rendered.html,
    clock: () => new Date(currentTime)
  });
  return {
    fixture,
    previewFolder,
    simulator,
    setClock: value => { currentTime = new Date(value); },
    linkId: `plink_Synthetic${niche.replaceAll("_", "")}5000${suffix}`
  };
};

const linkConfiguration = ({ linkId, activatedAt = "2026-08-21T17:55:00.000Z", expiresAt = "2026-08-22T17:55:00.000Z", generation = 0 }) => ({
  payment_link_id: linkId,
  generation,
  payment_method_selection: "dynamic",
  automatic_tax_enabled: true,
  tax_settings_status: "active",
  active_tax_registration_states: ["AZ", "CO", "TX", "WA"],
  billing_address_collection: "required",
  destination_address_required: true,
  activated_at: activatedAt,
  expires_at: expiresAt
});

const paidSession = ({ niche, linkId, state, tax, taxApplies = true, paymentStatus = "paid", suffix = "" }) => ({
  id: `cs_test_${niche.replaceAll("_", "")}${suffix}`,
  payment_link_id: linkId,
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
  billing_address_complete: true,
  destination_address_complete: true,
  destination_state: state,
  tax_jurisdiction_applies: taxApplies,
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

// Roofing: ordinary paid Checkout Session reaches one synthetic handoff.
{
  const harness = makeHarness("roofing");
  harness.simulator.activateLink(linkConfiguration({ linkId: harness.linkId }));
  const session = paidSession({ niche: "roofing", linkId: harness.linkId, state: "WA", tax: 50000 });
  const paid = harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_RoofingPaid", session }));
  assert.equal(paid.state, "PAYMENT_VERIFIED");
  const handoff = harness.simulator.prepareHandoff();
  assert.equal(handoff.synthetic, true);
  assert.equal(handoff.external_provider_proof, false);
  assert.equal(handoff.niche, "roofing");
  assert.equal(harness.simulator.snapshot().handoffCount, 1);
}

// HVAC: exact Stripe and handoff replays remain idempotent and create nothing twice.
{
  const harness = makeHarness("hvac");
  harness.simulator.activateLink(linkConfiguration({ linkId: harness.linkId }));
  const event = checkoutEvent({
    id: "evt_HvacPaid",
    session: paidSession({ niche: "hvac", linkId: harness.linkId, state: "CO", tax: 40000 })
  });
  assert.equal(harness.simulator.checkoutEvent(event).idempotentReplay, false);
  assert.equal(harness.simulator.checkoutEvent(event).idempotentReplay, true);
  assert.equal(harness.simulator.prepareHandoff().idempotent_replay, false);
  assert.equal(harness.simulator.prepareHandoff().idempotent_replay, true);
  assert.equal(harness.simulator.snapshot().handoffCount, 1);
}

// Remodeling: an unpaid completed event consumes no claim; later async success remains eligible.
{
  const harness = makeHarness("remodeling");
  harness.simulator.activateLink(linkConfiguration({ linkId: harness.linkId }));
  const pendingSession = paidSession({ niche: "remodeling", linkId: harness.linkId, state: "TX", tax: 41250, paymentStatus: "unpaid" });
  const pending = harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_RemodelingPending", session: pendingSession }));
  assert.equal(pending.state, "PAYMENT_PENDING");
  assert.equal(pending.fulfillmentClaimConsumed, false);
  assert.throws(() => harness.simulator.prepareHandoff(), /authenticated paid session required/);
  const paid = harness.simulator.checkoutEvent(checkoutEvent({
    id: "evt_RemodelingAsyncPaid",
    type: "checkout.session.async_payment_succeeded",
    session: { ...pendingSession, payment_status: "paid" }
  }));
  assert.equal(paid.state, "PAYMENT_VERIFIED");
  assert.equal(harness.simulator.prepareHandoff().niche, "remodeling");
}

// Landscaping: an expired unpaid Link must be deactivated before a distinct, double-checked renewal.
{
  const harness = makeHarness("landscaping");
  harness.simulator.activateLink(linkConfiguration({
    linkId: harness.linkId,
    activatedAt: "2026-08-20T16:00:00.000Z",
    expiresAt: "2026-08-21T16:00:00.000Z"
  }));
  assert.equal(harness.simulator.expireLink().state, "LINK_EXPIRED");
  harness.simulator.deactivateExpiredLink({
    payment_link_id: harness.linkId,
    active: false,
    completed_sessions_count: 0,
    livemode: false,
    webhook_signature_verified: true,
    authenticated_session_retrieved: true,
    stripe_api_version: SYNTHETIC_STRIPE_API_VERSION
  });
  const renewedLinkId = `${harness.linkId}Renewed`;
  harness.simulator.renewLink({
    ...linkConfiguration({ linkId: renewedLinkId, activatedAt: "2026-08-21T18:00:00.000Z", expiresAt: "2026-08-22T18:00:00.000Z" }),
    predecessor_payment_link_id: harness.linkId,
    precreate_offer_and_tax_ready: true,
    precreate_preview_ready: true,
    postcreate_offer_and_tax_ready: true,
    postcreate_preview_ready: true
  });
  assert.equal(harness.simulator.snapshot().linkGeneration, 1);
  const session = paidSession({ niche: "landscaping", linkId: renewedLinkId, state: "OR", tax: 0, taxApplies: false });
  harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_LandscapingPaid", session }));
  assert.equal(harness.simulator.prepareHandoff().niche, "landscaping");
}

// Auto detailing: either a bound refund or dispute permanently halts pre-handoff delivery.
for (const [suffix, type] of [["Refund", "refund.created"], ["Dispute", "charge.dispute.created"]]) {
  const harness = makeHarness("auto_detailing", "2026-08-21T18:00:00.000Z", suffix);
  harness.simulator.activateLink(linkConfiguration({ linkId: harness.linkId }));
  const session = paidSession({ niche: "auto_detailing", linkId: harness.linkId, state: "AZ", tax: 42500, suffix });
  harness.simulator.checkoutEvent(checkoutEvent({ id: `evt_AutoPaid${suffix}`, session }));
  const halted = harness.simulator.reversalEvent(reversalEvent({ id: `evt_Auto${suffix}`, type, session }));
  assert.equal(halted.deliveryHalted, true);
  assert.equal(halted.automaticRefundRequested, false);
  assert.throws(() => harness.simulator.prepareHandoff(), /reversal prevents handoff/);
}

// Guardrails: no pinned card list, zero applicable tax, unsigned webhook, or API drift may pass.
{
  const harness = makeHarness("roofing", "2026-08-21T18:00:00.000Z", "Guard");
  assert.throws(() => harness.simulator.activateLink({
    ...linkConfiguration({ linkId: harness.linkId }),
    payment_method_types: ["card"]
  }), /dynamic payment methods/);
  assert.throws(() => harness.simulator.activateLink({
    ...linkConfiguration({ linkId: harness.linkId }),
    billing_address_collection: "auto"
  }), /destination-address collection/);
  harness.simulator.activateLink(linkConfiguration({ linkId: harness.linkId }));
  const applicableZeroTax = paidSession({ niche: "roofing", linkId: harness.linkId, state: "WA", tax: 0 });
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({ id: "evt_ZeroApplicableTax", session: applicableZeroTax })), /nonzero tax/);
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({
    id: "evt_UnsignedWebhook",
    session: { ...applicableZeroTax, amount_tax: 50000, amount_total: 550000, webhook_signature_verified: false }
  })), /signed webhook/);
  assert.throws(() => harness.simulator.checkoutEvent(checkoutEvent({
    id: "evt_ApiDrift",
    session: { ...applicableZeroTax, amount_tax: 50000, amount_total: 550000, stripe_api_version: "future-unreviewed" }
  })), /pinned Stripe API contract/);
}

console.log("PASS synthetic five-niche Stripe-test→handoff simulator: local contract coverage only; zero external provider proof.");
