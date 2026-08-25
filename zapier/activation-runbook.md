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
3. **Downstream dedupe and completion are code-complete only.** The adapter now
   signs one canonical v2 packet, exposes default-OFF atomic claim and signed
   completion endpoints, and retains recovery state after Hook HTTP 200 until
   completion. `scripts/arc1_consumer_contract.mjs` verifies that packet, claims
   before invoking work, fences each provider workflow attempt, and completes
   only from separately signed durable-result evidence. None of this is
   deployed, mapped to a private Zap/state provider, or provider-tested yet.
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
- a one-time authorized operator run of the bounded ARC1 v1 record migration;
- the authoritative Stripe reversal binding/recheck producer.

No provider credential may be stored in Git, a public URL, a customer email, or
ordinary Zap mapping text.

## ARC1 disabled build order

Build with the Zap unpublished and every provider action in test/sandbox mode.

1. Deploy the committed first-party adapter only in a disabled test context.
   Keep `ARC_INTAKE_ARC1_ADAPTER_ENABLED`,
   `ARC_INTAKE_ARC1_BRIDGE_ENABLED`, `ARC_INTAKE_ARC1_DISPATCH_ENABLED`,
   `ARC_INTAKE_ARC1_DOWNSTREAM_ENABLED`, and
   `ARC_INTAKE_ASSET_RETRIEVAL_ENABLED` absent or `false`. Keep
   `ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED` and
   `ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED` off too.
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
5. Treat exact HTTP 200 only as `HOOK_ACCEPTED`. Pass the untouched canonical
   packet plus one stable, unique provider workflow-attempt ID to
   `scripts/arc1_consumer_contract.mjs`. It must verify the packet HMAC and live
   deadline and receive `CLAIMED` before any asset, generation, preview, GitHub,
   Stripe, email, or Netlify mutation. The same attempt may exact-replay an
   ambiguous response; a different attempt must stop on conflict. Never derive
   the attempt only from the delivery ID, and never log the packet or claim
   token.
6. Run downstream `arc1_verify_function_intake.js` and
   `arc1_retrieve_function_assets.js` as defense-in-depth. Prove exact content
   type, byte count, SHA-256, no redirect, and bounded decode
   for every retrieved private asset.
7. Create or exact-replay the private durable work record under the mutation
   fence/idempotency key. Only its separately HMAC-signed durable-state receipt
   may be hashed into the completion request. Post the byte-stable signed
   completion before treating the first-party adapter as terminal. An expired
   claim becomes `REVIEW_REQUIRED`; do not reassign it automatically.
8. An exact producer replay may reuse the same first-party claim and
   acknowledgement. A changed
   replay must stop before acknowledgement or downstream work.
9. Exercise the adapter recovery endpoint through every authenticated
   `next_cursor` until `RECOVERY_COMPLETE`; verify five attempts, CAS leases,
   preserved backoff, quarantine, source failure, dead letter, and alert state.
   Its adapter attestation lasts at most 24 hours, so prove a safe rotation
   procedure rather than installing a static value.
10. Before any intake activation, keep
    `ARC_INTAKE_ARC1_LEGACY_MIGRATION_ENABLED` off except during one authorized
    maintenance window. Call `/internal/intake/arc1/adapter/migrate-legacy`
    through every signed `next_cursor` until `MIGRATION_COMPLETE`; require the
    cumulative `invalid` count to equal zero and verify every legacy v1
    `HOOK_ACCEPTED` record became `REVIEW_REQUIRED` with its review index. Turn
    the migration flag back off before continuing. Never silently treat an old
    hook acceptance as consumer completion.
11. Run `arc1_verify_payment_link.js` read-only against the correct ARC Stripe
   test account. Require the account hash, active tax settings and expected
   registration, exact one-time Price, destination address, terms snapshot, and
   redirect URL.
12. Enforce approved rolling/day limits from the durable work record.
13. Publish content-addressed assets, inject the preview, run the validator,
   publish a PR, wait for the exact required check, and squash merge only that
   immutable head.
14. Re-read GitHub Pages bytes. Reserve the preview outbox before any email.
15. Run the private checkout PREPARE/AUTHORIZE/CREATE/PERSIST/ACTIVATE/FINALIZE
    phases with compare-and-set transitions. Keep the Link private and bounded
    to one completed session.
16. Send the preview email through the branded transactional provider using the
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
  terminal. Adapter `HOOK_ACCEPTED` is not downstream completion; only the
  exact signed consumer completion receipt can authorize pending-index cleanup.
- A consumer claim is one non-renewable lease for one provider workflow
  attempt. Exact same-attempt replay is allowed. A competing attempt conflicts,
  and an expired claim becomes terminal `REVIEW_REQUIRED`; never start a
  replacement worker while downstream providers lack universal fencing.
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
