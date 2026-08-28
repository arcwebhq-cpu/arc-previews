# ARC Zapier activation runbook

Status: **blocked and OFF**. Every ordered ARC stage defaults to OFF. External
provider controls are separate, and none is authorized by this runbook. The
V11 provider configuration is blocked and paused. It is not yet deployable:
the code-complete Checkout Session artifact adapter still needs a history-
redacted provider mapping, and the current first-party retention receipt and
signed runtime activation readback are unresolved. Nothing has been applied or
verified in the providers. Code presence is not provider
wiring, activation, runtime attestation, or
end-to-end evidence. Do not enable a Zap, public intake, email, checkout,
Netlify claim, or Apollo while any item below is unresolved.

## Authoritative V11 provider map

`zapier/wiring-contract.json#provider_deployment_v11` is the only active
provider wiring plan. The older component contracts in that file remain useful
offline invariants, but they are not provider configuration or evidence.

- Intake is the same-origin first-party `/api/intake/submit` Function. It must
  create durable state, send the mailbox-verification message, and consume the
  one-time verification before ARC1 release. A native Netlify Form submission
  is not an ARC1 trigger. Zapier's Catch Raw Hook is downstream dispatch only.
- ARC1 uses the current V11 validator and async orchestrator. Its state authority
  is an encrypted private adapter with create-or-exact, CAS-or-exact, and atomic
  one-use lease consumption. Zapier Tables is not an atomic authority.
- GitHub provider steps must be built with
  `scripts/package_arc1_github_provider_steps.mjs`. Their Ed25519 trust root is
  pinned into the packaged code; no mapped field may choose a keyring.
- All customer email roles use ARC's Resend-native Netlify worker and signed
  Resend webhook: intake confirmation, preview review, claim invitation,
  claim-link renewal, final delivery, and operations alert. Gmail and Zapier
  email actions are not customer-delivery providers, and no customer reply is
  required.
- Approval creates one private Stripe Checkout Session through
  `/api/review/checkout`. V11 has no active Payment Link path. The release target
  is live Stripe, but checkout mutation remains OFF until its provider readback
  and controlled end-to-end evidence pass.
- ARC2 claims the paid outbox through `/internal/payment-arc2/claim`, starts the
  signed Netlify deploy-and-claim handoff through
  `/internal/payment-arc2/start`, and completes only with the durable start
  receipt. The active `arc2_checkout_session_artifact_adapter.js` deterministically
  builds signed artifact evidence from the approval-bound preview and delegates
  payment authentication/evidence to the first-party worker; the retired Payment
  Link resolver is forbidden. The replacement is implemented, default-OFF, and
  not provider-wired or history-redaction-verified. Claim and final-delivery
  messages are sent by the same Resend-native worker.

The wiring contract contains the exact `default_off_provider_gates` maps for
the Zapier dashboard, ARC1 worker host, ARC2 worker host, ARC site runtime, and Apollo. Every
listed value is `false` in the paused package. Target activation values are not
current provider evidence. Change no value until the matching provider
revision/readback receipt has been captured and reviewed.

The ARC site gate inventory includes `ARC_FIRST_PARTY_RETENTION_ENABLED` and
`ARC_REVIEW_ACTIVATION_RUNTIME_READBACK_ENABLED`; both remain `false`. Production
also requires a current signed first-party retention completion receipt and a
deployment-bound Ed25519 runtime readback from the configured HTTPS verifier.

Use only the runtime names consumed by the ARC site:
`ARC_STRIPE_REVIEW_SECRET_KEY`, `ARC_STRIPE_ACCOUNT_VERIFICATION_KEY`, and
`ARC_EXPECTED_PRODUCT_TAX_CODE`. For the Netlify credential, prefer canonical
`NETLIFY_ADMIN_PAT`; the site permits exactly one of it or the retired
`NETLIFY_ACCESS_TOKEN` alias and rejects both together. Never map generic
`STRIPE_TEST_API_KEY` or `STRIPE_LIVE_API_KEY` fields.
Retention and runtime-readback configuration additionally use
`ARC_FIRST_PARTY_RETENTION_HMAC_SECRET`,
`ARC_FIRST_PARTY_RETENTION_UNPAID_DAYS`,
`ARC_FIRST_PARTY_RETENTION_PAID_DAYS`, `ARC_FIRST_PARTY_RETENTION_RECEIPT`,
`ARC_REVIEW_ACTIVATION_VERIFIER_URL`, and
`ARC_REVIEW_ACTIVATION_VERIFIER_ED25519_PUBLIC_KEY`. Values belong only in the
protected runtime store.

## Ordered activation and cumulative evidence

The only valid stage order is:

`OFF -> EMAIL_SANDBOX -> CLAIM_SANDBOX -> LIVE_CHECKOUT -> PUBLIC_INTAKE -> PILOT -> OUTREACH`

Each transition appends its new evidence after every earlier receipt. The
complete receipt order is exact and cumulative:

1. `email_sandbox_e2e`
2. `claim_sandbox_e2e`
3. `adult_legal_tax_approval`
4. `checkout_test_e2e`
5. `live_checkout_readback`
6. `public_intake_privacy_retention_review`
7. `public_intake_provider_e2e`
8. `pilot_acceptance`
9. `outreach_approval`

The receipts are reviewed, access-controlled external evidence; only their
pseudonymous references and digests belong in a short-lived activation
manifest. Repository tests, synthetic fixtures, a successful Zap task, a local
HMAC, or an inventory readback cannot substitute for a provider receipt. A
higher stage may not skip, reorder, or replace any earlier receipt, and a signed
manifest never turns on an external provider dashboard by itself.

### Bootstrap is implemented but remains provider-blocked

The ARC site now contains a default-OFF `TEST_BOOTSTRAP` path for
`CLAIM_SANDBOX`: a deployment-bound manifest lasts no more than 15 minutes and
can seed exactly one paid review-session handoff, with exact retries only. It
cannot use live Stripe or a Payment Link. This closes the code-level circularity
but does not count as provider evidence and has not been deployed or proven.
Public intake still requires the full `PUBLIC_INTAKE` authority and cumulative
provider evidence.

Do not weaken a runtime minimum, fabricate a receipt, treat a local fixture as
external evidence, or reuse the one-use authority for a second handoff. The
bootstrap remains blocked until its exact provider deployment and controlled
sandbox readback are reviewed.

## Hard blockers before opening the Zap editor

1. **A normal Catch Hook cannot be the ARC1 destination.** Zapier's Catch Hook
   and Catch Raw Hook return an immediate, non-customizable response. ARC1
   requires an exact signed acknowledgement only after private asset retrieval
   and a durable create-only ingress claim. Pointing
   `ARC_INTAKE_ARC1_ENDPOINT` directly at a Zapier hook therefore fails the
   acknowledgement contract.
2. **The first-party adapter is code-complete only.** The current ARC Netlify
   bundle contains the committed default-OFF Blob adapter that
   validates the signed envelope, authoritative content-addressed asset indexes
   and bytes, atomically claims ingress, returns the exact signed ACK, and
   queues a bounded downstream hook dispatch. That deployed code has not been
   enabled, runtime-attested, wired to the required private providers, or
   provider-tested. All activation flags remain OFF and ARC public readiness
   remains false.
3. **The downstream runtime is executable but provider-unverified.** The adapter now
   signs one canonical v2 packet, exposes default-OFF atomic claim and signed
   completion endpoints, and retains recovery state after Hook HTTP 200 until
   completion. `scripts/arc1_consumer_runtime.mjs` and the reproducibly generated
   `zapier/arc1_consumer_runtime.js` implement `CLAIM`, `AUTHORIZE`, and
   `COMPLETE`. The actual bundle and the importable provider-neutral runtime are
   tested, including against a packet generated by the pinned ARC site code.
   No private-state provider, provider mutation, or deployed provider E2E is
   configured or verified.
4. **The secret and history boundary is not proven.** The generic bundle prefers
   encrypted host environment/private-integration injection. It ignores secrets
   and activation controls mapped through ordinary `inputData` unless the host
   separately enables the compatibility path. Do not enable that path until the
   provider proves raw input/output history suppression or redaction. `CLAIM`
   returns `private_state_json` containing the capability token; it is a
   private-only handoff, never a log-safe output. Only `log_safe_json` may enter
   ordinary task history. A normal Zap Code step must not be used until these
   boundaries are attested.
5. **Alert delivery is implemented locally but provider-unverified.** The ARC
   site has a default-OFF operations-alert outbox/worker. Its Resend sender,
   webhook, lease, retry, delivery receipt, acknowledgement, and escalation
   still need provider readback and E2E evidence.
6. **Resend-native email is implemented locally but provider-unverified.** The
   shared worker, attempt ledger, encrypted recipient vault, suppression state,
   and signed webhook reconciliation are code-complete. A configured Resend
   domain/account/webhook and authenticated delivered events are still
   required. Accepted, queued, or a successful worker invocation is not
   delivery.
7. **GitHub Pages must use GitHub Actions as its only publication source.** A
   branch/root Pages build can publish repository internals before the strict
   allowlisted Actions artifact replaces it. Verify the Pages settings
   readback is Actions-only and the live artifact contains only the committed
   public allowlist before any preview-repository push. A passing Actions run
   does not neutralize a concurrently configured branch/root publisher.
8. **The GitHub provider authorization adapter is not deployed.** The V11
   templates reject caller-controlled keyrings and require a deployment-pinned
   Ed25519 trust root plus a signed atomic lease-consumption receipt. The
   packager and reference adapter are tested, but no production keyring,
   private integration, atomic store, packaged Zap revision, concurrency proof,
   or provider-history attestation exists yet.

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
  outboxes, provider transitions, and signed completion reconciliation, with an
  authoritative readback after both create-or-exact and immutable-result commit;
- an authenticated private-integration action that atomically consumes each
  GitHub authorization lease and signs the exact persisted consumption receipt;
- a secret broker or private Zapier integration for Stripe, GitHub, Netlify,
  bridge, receipt, and HMAC credentials;
- the configured Resend account, branded sender, native signed webhook, and a
  stable provider idempotency key;
- an inbox receipt signer bound to the actual lead inbox;
- an alert consumer with lease, bounded retry, delivered receipt,
  acknowledgement, and escalation;
- an explicit scheduled caller for ARC1 recovery and the operations audit;
- a one-time authorized operator run of the bounded ARC1 v1 record migration;
- the authoritative Stripe reversal binding/recheck producer.

No provider credential may be stored in Git, a public URL, a customer email, or
ordinary Zap mapping text.

The receipt helpers in `scripts/arc1_consumer_runtime.mjs` are evidence encoders,
not storage. An HMAC made locally without a successful authoritative provider
write and readback proves nothing and must not be passed to `AUTHORIZE` or
`COMPLETE`.

## ARC1 disabled build order

Build the production-target revision while it remains unpublished and every
provider mutation gate remains OFF. A live-target configuration is not a live
workflow and must not be represented as one.

1. Deploy the committed first-party adapter only in a disabled test context.
   Keep `ARC_INTAKE_ARC1_ADAPTER_ENABLED`,
   `ARC_INTAKE_ARC1_BRIDGE_ENABLED`, `ARC_INTAKE_ARC1_DISPATCH_ENABLED`,
   `ARC_INTAKE_ARC1_DOWNSTREAM_ENABLED`, and
   `ARC_INTAKE_ASSET_RETRIEVAL_ENABLED` absent or `false`. Keep
   `ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED` and
   `ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED` off too. Also keep
   `ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED`,
   `ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED`,
   `ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED`,
   `ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED`, and
   `ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED` absent or `false`.
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
5. Treat exact HTTP 200 only as `HOOK_ACCEPTED`. In a provider whose raw history
   is already disabled/redacted and whose secrets are injected by its encrypted
   host/private integration, pass the untouched canonical packet plus one
   stable, unique provider workflow-attempt ID to the bundle's `CLAIM` phase.
   It must verify the packet HMAC, exact origin/endpoints/media/deadline, and
   receive `CLAIMED`. The same attempt may exact-replay an ambiguous response; a
   different attempt must stop on conflict. Never derive the attempt only from
   the delivery ID, and never log the packet, claim token, or raw private-state
   output.
6. Persist the returned `CREATE_OR_EXACT` private-state intent under its exact
   key and idempotency key. Read it back authoritatively, bind the provider's
   immutable version/receipt digest, sign the create receipt in the trusted
   adapter, and pass that receipt to `AUTHORIZE`. Only this phase may release
   the signed mutation fence and provider idempotency key. A locally signed
   receipt without write/readback is invalid. The adapter receives an
   `AbortSignal`; cap create-or-exact at
   `ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS` (100–5,000 ms, default
   5,000) or the remaining claim lifetime, whichever is smaller.
7. Run downstream `arc1_verify_function_intake.js` and
   `arc1_retrieve_function_assets.js` as defense-in-depth. Prove exact content
   type, byte count, SHA-256, no redirect, and bounded decode
   for every retrieved private asset.
8. Execute every provider mutation with the released fence and idempotency key.
   Commit its one immutable result digest into private state, authoritatively
   read it back, bind the provider version/receipt digest, and sign the commit
   receipt in the trusted adapter. Pass both provider-backed receipts to
   `COMPLETE`; post the byte-stable signed completion before treating the
   first-party adapter as terminal. An expired claim becomes `REVIEW_REQUIRED`;
   do not reassign it automatically. Apply the same signal and deadline cap to
   the commit. A hung or over-deadline commit must never post completion.
9. An exact producer replay may reuse the same first-party claim and
   acknowledgement. A changed
   replay must stop before acknowledgement or downstream work.
10. Exercise the adapter recovery endpoint through every authenticated
   `next_cursor` until `RECOVERY_COMPLETE`; verify five attempts, CAS leases,
   preserved backoff, quarantine, source failure, dead letter, and alert state.
   Its adapter attestation lasts at most 24 hours, so prove a safe rotation
   procedure rather than installing a static value.
11. Before any intake activation, keep
    `ARC_INTAKE_ARC1_LEGACY_MIGRATION_ENABLED` off except during one authorized
    maintenance window. Call `/internal/intake/arc1/adapter/migrate-legacy`
    through every signed `next_cursor` until `MIGRATION_COMPLETE`; require the
    cumulative `invalid` count to equal zero and verify every legacy v1
    `HOOK_ACCEPTED` record became `REVIEW_REQUIRED` with its review index. Turn
    the migration flag back off before continuing. Never silently treat an old
    hook acceptance as consumer completion.
12. Keep `arc1_verify_payment_link.js`, `arc1_private_checkout_link.js`, and its
   lifecycle step outside the active V11 order. They are default-OFF frozen
   pre-review Payment Link replay components, not the approved private Checkout
   Session flow.
13. Enforce approved rolling/day limits from the durable work record.
14. Before any preview-repository push, verify GitHub Pages is configured with
   GitHub Actions as its only publication source. A branch/root publisher must
   be disabled; do not rely on the strict artifact racing it afterward.
15. Publish content-addressed assets, then run the active read-only
   `arc1_verify_checkout_offer.js` against the exact configured Stripe Account,
   Price/Product, Tax settings, Tax code, expected active Tax registrations, and
   retained terms. It must return `PRIVATE_CHECKOUT_SESSION_OFFER_VERIFIED` and
   `checkout_offer_evidence_*`; it may not read, create, or expose a checkout
   capability. Map those exact signed V2 evidence fields into `arc1_inject.js`,
   then map its complete V11 output into `arc1_validate_v11_bundle.js`. Do not map legacy
   `payment_link_evidence_*`, `html_content`, `file_path`, or `preview_path`
   fields. Require `V11_FIVE_PAGE_BUNDLE_VALIDATED`; pass only its boolean `validation_pass`
   plus the injector's private bundle fields into the PR publisher. Start the
   async coordinator with `artifactSha256` equal to the validator's exact
   `render_bundle_sha256` and `validationReceiptSha256` equal to its
   `validation_receipt_sha256`; no caller-selected identity is permitted. The
   validator output is log-safe and must never forward recipient records or a
   checkout URL. Start `arc1_preview_async_orchestrator.mjs`, persist its
   create-or-exact `READY_PR_CREATE` state, and obtain the signed authoritative
   readback. Run `arc1_publish_preview_pr.js#PREPARE_REQUEST` with network access
   denied, persist its exact PR-create intent, claim the short authorization
   lease and authorize it. Invoke the authenticated private-integration
   consumption action, require its exact signed atomic-consumption readback,
   and only then run `#EXECUTE` using a provider source packaged with the
   adapter's pinned public keyring. The publisher must independently verify the
   consumption receipt and immutable request digest before its first GitHub
   request. A mapped Zap input may never supply the keyring. Consume
   `PR_CREATED`, then only the issuer-bound
   `PR_CHECK_PASSED` receipt. Run `arc1_merge_preview_pr.js#PREPARE_REQUEST`
   without network access, persist its exact merge intent with CAS-or-exact,
   claim its short authorization lease, authorize it, atomically consume that
   lease through the same private integration, and run packaged `#EXECUTE` to
   squash merge only that immutable head. Consume `MERGE_CONFIRMED`. Follow
   `arc1-github-provider-step-deployment.md`; the checked-in templates remain
   fail-closed.
16. Re-read the live GitHub Pages file allowlist and exact bytes, sign
   `PAGES_EXACT_BYTES_VERIFIED` with the Pages attestor, and resume the exact
   orchestration state. Run
   `arc1_preview_review_outbox.js#PREPARE`, atomically claim the durable outbox,
   issue one private ARC review invite, bind it with `BIND_INVITE`, and
   authoritatively read back the exact `INVITE_BOUND` bytes.
17. Bind the immutable provider request digest, persist the preview-email
   operation intent with CAS-or-exact, atomically claim its authorization lease,
   and run the orchestrator authorization. Then run `AUTHORIZE_SEND` immediately
   before the ARC-site Resend-native worker call. Send only the private review
   link using the returned durable idempotency key and lease. A Zapier/Gmail
   send step is prohibited. Never include a checkout link or require an email
   reply.
18. Accept only the provider's authenticated `DELIVERED` webhook evidence in
   `ACK_DELIVERY`; queued, accepted, or a successful Zap task is not delivery.
   Consume the email attestor's `PREVIEW_EMAIL_DELIVERED` receipt. The review
   service may advance only after its separate signed `APPROVE_AND_PAY`
   decision and `CUSTOMER_APPROVAL_VERIFIED` receipt. Persist and lease the
   private Checkout Session authorization before the checkout adapter acts,
   then require `PRIVATE_CHECKOUT_AUTHORIZED`. `REQUEST_CHANGES` must produce a
   new immutable preview and invite before another email.

## ARC2 disabled build order

1. Configure one `/internal/stripe/reversal-webhook` destination with one
   signing secret per mode and this exact 13-event set:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.updated`,
   `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, and
   `charge.dispute.funds_reinstated`. Only the first two are fulfillment
   candidates; failed/expired and reversal events halt or alert. Treat every
   trigger field as untrusted. The ARC-site Stripe webhook and checkout ledger
   must seal the exact approval-bound Session first; `session.payment_link`
   must be `null`.
2. The paused ARC2 revision calls `/internal/payment-arc2/claim` with one fresh
   random claim token. The retired `arc2_resolve_and_finalize.js` Payment Link
   resolver must not be mapped or executed. Map the default-OFF
   `arc2_checkout_session_artifact_adapter.js` only through a history-redacted
   private integration. It builds exact signed V4 artifact evidence and sends the
   exact eight-field start request; it receives no Stripe credential and produces
   no payment evidence. The first-party worker independently re-reads Stripe,
   the checkout ledger, review approval, and recipient binding, then creates the
   transient payment evidence. Provider mapping and history redaction remain
   unverified, so ARC2 stays blocked.
3. Persist any client-reference anomaly, register the reversal binding, and
   obtain a fresh authoritative Stripe recheck before each irreversible
   provider transition. A duplicate exact event replays; changed facts stop.
4. The adapter calls `/internal/payment-arc2/start` with immutable artifact
   evidence and no caller-produced payment evidence. The first-party ARC2 service creates/recovers the ARC-controlled
   Netlify site, deploys the exact bundle, verifies any lead route, and reserves
   the claim invitation. Complete the worker lease only from its signed durable
   start receipt.
5. The ARC-site Resend worker atomically claims the invitation outbox and sends
   it with the durable provider idempotency key. Only the authenticated Resend
   delivered webhook records delivery; Zap task success is not delivery.
6. The customer exchanges the fragment through `/api/arc2/claim`. An expired
   invite may use the same-origin, rate-limited `/api/arc2/claim-link-renew`
   path only while payment, recipient continuity, and suppression checks pass.
7. Treat Netlify's claim webhook as an unsigned hint. Re-read the destination
   account, redeploy and verify the exact final bytes, then reserve the final
   delivery outbox.
8. The Resend-native worker sends final delivery. Its authenticated webhook is
   converted into the signed `/internal/arc2/final-delivery-ack` contract.
   Negative delivery events move the durable ARC2 record to review and revoke
   remaining bearer/capsule authority.
9. Clean temporary staging only after authoritative customer delivery evidence
   and preserve the required audit/retention records. Keep public intake off
   until the bounded first-party retention cascade completes and its current,
   deployment-bound, signed receipt passes preflight.

The live Checkout gate additionally requires the external verifier to refresh a
signed deployment/provider readback every five minutes. Each envelope expires
within 15 minutes and is rejected on rollback or same-time equivocation. The
manifest binds the stable verifier authority, not a one-shot static receipt.
Operations-alert delivery and the unified Stripe destination remain separate
external evidence gates; local contract tests are not proof.

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

## Controlled proof and pilot

The five committed niche fixtures remain offline breadth regressions only. They
do not configure Zapier, prove a provider, authorize a charge, or satisfy a live
receipt. Capture one controlled provider end-to-end with the exact deployed V11
revision and provider readbacks before public intake. Keep private Checkout
Session creation OFF until its separate live account/catalog/tax/webhook
readback is valid; never create a $5,000 smoke-test charge merely to manufacture
evidence.

`pilot_acceptance` may be reviewed only after the cumulative evidence through
`PUBLIC_INTAKE` is valid. Pilot contacts must be individually reviewed against
suppression, sender-domain, and outreach-compliance controls. Keep Apollo OFF
during the pilot; no sequence may start until the later `OUTREACH` stage also
has `outreach_approval`.

## Smallest safe login sequence

1. Sign into Zapier and inspect ARC1/ARC2/ARC3 without publishing them.
2. Confirm all three are OFF and no dormant task backlog will release.
3. Inventory connected accounts and remove every Gmail customer-send or legacy
   Payment Link mapping. Do not rotate or expose credentials in the editor.
4. Configure the private CAS/secret adapter, package the two GitHub actions with
   the deployment-pinned Ed25519 public trust root, and import only those
   packaged sources into the paused ARC1 revision.
5. Configure Resend sender/webhook/suppression and the Netlify worker secrets,
   while every send switch remains OFF. Configure the restricted Stripe live
   key, the single 13-event webhook destination, and Netlify handoff bindings
   while checkout remains OFF. Configure the retention secret/policy and signed
   runtime-readback verifier key/URL without turning on either gate.
6. Build ARC1 behind the acknowledgement adapter, map the default-OFF Checkout
   Session artifact adapter against the first-party payment worker endpoints in
   a history-redacted private integration, and run zero-egress plus offline regression fixtures. Then
   capture the controlled provider E2E, current retention receipt, runtime
   verifier envelope, operations-alert receipt, and exact webhook readbacks.
7. Test duplicate, timeout, lost response, async payment, expired Session, claim
   renewal, refund,
   dispute, bounce, complaint, stuck outbox, and alert acknowledgement.
8. Export/redact the exact step map and evidence for adult review.
9. Keep every Zap OFF until the repository and provider evidence both pass.

Activation order remains exactly `OFF -> EMAIL_SANDBOX -> CLAIM_SANDBOX ->
LIVE_CHECKOUT -> PUBLIC_INTAKE -> PILOT -> OUTREACH`, with cumulative evidence
in the order documented above. GitHub Pages Actions-only publication is a
precondition to any preview push, not a substitute stage. Apollo stays OFF
through the balanced five-niche pilot and until the separate branded-domain,
suppression, outreach-compliance, and `outreach_approval` gates all pass.
