# ARC Zapier activation runbook

Status: **blocked and OFF**. This is a configuration order, not evidence that
ARC1 or ARC2 is ready. Do not enable a Zap, public intake, email, checkout,
Netlify claims, or Apollo while any item below is unresolved.

## Hard blockers before opening the Zap editor

1. **A normal Catch Hook cannot be the ARC1 destination.** Zapier's Catch Hook
   and Catch Raw Hook return an immediate, non-customizable response. ARC1
   requires an exact signed acknowledgement only after private asset retrieval
   and a durable create-only ingress claim. Pointing
   `ARC_INTAKE_ARC1_ENDPOINT` directly at a Zapier hook therefore fails the
   acknowledgement contract.
2. **The first-party adapter is code-complete only.** `arc-site-launch` now has
   a default-OFF Netlify Blob adapter that validates the signed envelope,
   authoritative content-addressed asset indexes and bytes, atomically claims
   ingress, returns the exact signed ACK, and queues a bounded downstream hook
   dispatch. It is not deployed, runtime-attested, or provider-tested. All of
   its activation flags remain OFF and ARC public readiness remains false.
3. **Downstream dedupe and completion are not proven.** Adapter state can prove
   producer-side claim and Catch Raw Hook ingress. The Zap cannot yet atomically
   claim that Blob record, the adapter packet is not signed as one unit, and a
   Hook HTTP 200 arrives before Zap tasks run. A consumer-side create-only/CAS
   claim plus signed completion callback/reconciliation is still required.
4. **The secret boundary is not proven.** The committed Code steps receive
   secrets through `inputData`. Do not paste production secrets into ordinary
   Zap fields. Use a reviewed private integration/authentication connection or
   an external secret-bearing adapter that exposes only bounded signed results
   to the Zap.
5. **Alert delivery is not implemented.** The ARC site can create deduplicated
   `PENDING` alert records, but it has no alert lease/send/receipt/ack consumer.
6. **Email receipt adapters are missing.** A provider must authenticate its
   native delivered webhook before signing ARC's receipt. Accepted, queued, or
   sent is not delivered.

Official Zapier capability references reviewed on 2026-08-24:

- https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zap-workflows-from-webhooks
- https://help.zapier.com/hc/en-us/articles/29972220283789-Webhooks-by-Zapier-rate-limits
- https://help.zapier.com/hc/en-us/articles/22495436062605-Set-up-custom-error-handling
- https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay

## Required private components

Choose and verify these before mapping steps:

- a disabled deployment and exact runtime attestation for the committed
  first-party ARC1 acknowledgement adapter;
- an atomic create-only and compare-and-set provider for downstream Zap dedupe,
  outboxes, provider transitions, and signed completion reconciliation;
- a secret broker or private Zapier integration for Stripe, GitHub, Netlify,
  bridge, receipt, and HMAC credentials;
- a branded transactional email provider with native signed webhooks and a
  stable provider idempotency key;
- an inbox receipt signer bound to the actual lead inbox;
- an alert consumer with lease, bounded retry, delivered receipt,
  acknowledgement, and escalation;
- an explicit scheduled caller for ARC1 recovery and the operations audit;
- the authoritative Stripe reversal binding/recheck producer.

No provider credential may be stored in Git, a public URL, a customer email, or
ordinary Zap mapping text.

## ARC1 disabled build order

Build with the Zap unpublished and every provider action in test/sandbox mode.

1. Deploy the committed first-party adapter only in a disabled test context.
   Keep `ARC_INTAKE_ARC1_ADAPTER_ENABLED`,
   `ARC_INTAKE_ARC1_BRIDGE_ENABLED`, `ARC_INTAKE_ARC1_DISPATCH_ENABLED`,
   `ARC_INTAKE_ARC1_DOWNSTREAM_ENABLED`, and
   `ARC_INTAKE_ASSET_RETRIEVAL_ENABLED` absent or `false`.
2. Configure `ARC_INTAKE_ARC1_ENDPOINT` as the exact same-deploy
   `/internal/intake/arc1/adapter` URL. Configure
   `ARC_INTAKE_ARC1_DOWNSTREAM_ENDPOINT` as one exact unpublished Catch Raw Hook
   URL. Never reverse these endpoints or put a Zapier URL in the producer slot.
3. In the disabled fixture, prove that the adapter validates the producer
   destination bearer, canonical envelope HMAC, idempotency key, freshness,
   bridge contract, strong-store source, every content-addressed asset index,
   and actual asset bytes before one create-only Blob claim and exact ACK.
4. Prove the Catch Raw Hook receives exactly the downstream bearer in
   `Authorization`, the bridge delivery ID in `Idempotency-Key`, the contract
   digest in `X-ARC-Bridge-Contract`, and the canonical adapter packet as its
   body. Map that actual downstream bearer—not the producer-to-adapter bearer—
   into `arc1_verify_function_intake.js`.
5. Treat exact HTTP 200 only as `HOOK_ACCEPTED`. Prove duplicate and ambiguous
   hook requests against a consumer-visible create-only/CAS dedupe claim before
   any preview, GitHub, Stripe, email, or Netlify mutation. Add a signed
   completion callback/receipt so task failure after Hook 200 remains retryable.
6. Run downstream `arc1_verify_function_intake.js` and
   `arc1_retrieve_function_assets.js` as defense-in-depth. Prove exact content
   type, byte count, SHA-256, no redirect, and bounded decode
   for every retrieved private asset.
7. An exact producer replay may reuse the same first-party claim and
   acknowledgement. A changed
   replay must stop before acknowledgement or downstream work.
8. Exercise the adapter recovery endpoint through every authenticated
   `next_cursor` until `RECOVERY_COMPLETE`; verify five attempts, CAS leases,
   preserved backoff, quarantine, source failure, dead letter, and alert state.
   Its adapter attestation lasts at most 24 hours, so prove a safe rotation
   procedure rather than installing a static value.
9. Run `arc1_verify_payment_link.js` read-only against the correct ARC Stripe
   test account. Require the account hash, active tax settings and expected
   registration, exact one-time Price, destination address, terms snapshot, and
   redirect URL.
10. Atomically claim the downstream intake and enforce approved rolling/day limits.
11. Publish content-addressed assets, inject the preview, run the validator,
   publish a PR, wait for the exact required check, and squash merge only that
   immutable head.
12. Re-read GitHub Pages bytes. Reserve the preview outbox before any email.
13. Run the private checkout PREPARE/AUTHORIZE/CREATE/PERSIST/ACTIVATE/FINALIZE
    phases with compare-and-set transitions. Keep the Link private and bounded
    to one completed session.
14. Send the preview email through the branded transactional provider using the
    durable outbox key as idempotency. Persist provider receipt evidence; do not
    treat a Zap step success as delivery.

## ARC2 disabled build order

1. Accept only `checkout.session.completed` and
   `checkout.session.async_payment_succeeded`; route
   `checkout.session.async_payment_failed` to a durable alert. Treat trigger
   fields as untrusted.
2. Run `arc2_resolve_and_finalize.js`, which must retrieve the complete Checkout
   Session directly from the correct Stripe test account and bind the immutable
   preview, private Link receipt, $5,000 subtotal, tax, address, consent, and
   purchaser authority.
3. Persist any client-reference anomaly, then atomically create the payment
   fulfillment claim. A duplicate exact event must replay; changed facts stop.
4. Register reversal binding and obtain a fresh authoritative Stripe recheck
   before each irreversible provider transition.
5. Call the ARC site handoff endpoints in their documented resumable order:
   create/recover site, deploy exact bundle, verify lead routing and inbox
   receipt, reserve claim invitation, verify destination account, redeploy and
   read back final bytes.
6. Claim each email outbox before sending. Use the exact outbox HMAC as the
   provider idempotency key.
7. Run `arc2_delivery_email_gate.js` only after `FINAL_DEPLOY_READY` and a fresh
   no-reversal observation. The email provider's authenticated delivered event
   must be converted to the signed `/internal/arc2/final-delivery-ack` contract.
8. Clean the temporary staging site only after authoritative customer delivery
   receipt and preserve the required audit/retention records.

## Retry and alert policy

- Use ARC's durable state as authority. Do not rely on Zap task success.
- ARC1 delivery uses five bounded attempts with 1 minute, 5 minute, 30 minute,
  and 2 hour retry spacing. The producer recovery and first-party adapter
  recovery endpoints must each be called through their signed cursors until
  terminal. Adapter `HOOK_ACCEPTED` is not downstream completion.
- A scheduled operations audit must follow every `next_cursor` until
  `AUDIT_COMPLETE`.
- Do not combine custom error handlers with an assumption that Zapier Autoreplay
  remains enabled; publishing an error handler disables Autoreplay for that Zap.
- Every provider mutation needs an idempotency key plus create-only/CAS state.
- `CLAIMED` but unsent email is manual review; never blind-resend it.
- Exhaustion, conflict, invalid signature, stale proof, reversal, bounce,
  complaint, or missing receipt must create a durable alert and stop delivery.

## Smallest safe login sequence

1. Sign into Zapier and inspect ARC1/ARC2/ARC3 without publishing them.
2. Confirm all three are OFF and no dormant task backlog will release.
3. Inventory connected accounts; remove or stop using non-ARC Gmail/Stripe
   mappings. Do not rotate or expose credentials in the editor.
4. Select the private state, secret, email, inbox-receipt, and alert adapters.
5. Build ARC1 behind the acknowledgement adapter and run one zero-egress fixture.
6. Build ARC2 in Stripe test mode and run the five committed synthetic niches,
   then five real sandbox provider workflows.
7. Test duplicate, timeout, lost response, async payment, expired Link, refund,
   dispute, bounce, complaint, stuck outbox, and alert acknowledgement.
8. Export/redact the exact step map and evidence for adult review.
9. Keep every Zap OFF until the repository and provider evidence both pass.

Activation order remains: transactional email test, disposable Netlify claim
test, public intake, live Stripe last. Apollo stays OFF until its separate
branded-domain and outreach-compliance gate passes.
