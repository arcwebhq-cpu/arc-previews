# ARC2 Checkout Session artifact adapter

`arc2_checkout_session_artifact_adapter.js` is the only fresh V11 Zapier artifact resolver. It does not receive a payment-provider credential, retrieve payment-provider objects, or produce payment evidence. The ARC-site worker independently authenticates the paid Checkout Session, durable paid ledger, approved review, recipient controls, and current revocation state.

Both activation flags default to off:

- `arc2_checkout_session_adapter_enabled=true` permits deterministic artifact resolution and read-only retrieval of signed, content-addressed GitHub asset blobs.
- `payment_arc2_start_enabled=true` additionally permits one authenticated request to the exact first-party endpoint `https://arcweb.onl/internal/payment-arc2/start`.

Any other value is false. When the adapter flag is false, the step returns `ARC2_CHECKOUT_SESSION_ADAPTER_PAUSED` before validating inputs or using the network. When artifact resolution is enabled but start is disabled, it returns only digests and `READY_FOR_FIRST_PARTY_PAYMENT_ARC2_START`; it never emits the claim token, recipient address, deploy bytes, artifact evidence, worker secret, raw Checkout Session ID, or raw outbox key. Both enabled return paths expose only `checkout_session_id_sha256` and `outbox_key_sha256` for those two private identifiers.

## Required input mapping

The ARC2 Zap must first POST one fresh random claim token to `/internal/payment-arc2/claim`. Map the canonical full claim response and the same token into:

- `payment_arc2_claim_private`
- `payment_arc2_claim_token`
- `checkout_session_id`
- `stripe_live_mode_enabled`

The claim must be an unexpired `CLAIMED` `arc-payment-arc2-start-binding-v2` lease. Its immutable payload digest, review/session hashes, recipient hash, final artifact-manifest hash, production-content hash, mode, and fixed five-page scope are checked before a start request can be made.

Map the retained signed ARC1 evidence into:

- `render_bundle_private`, `render_bundle_sha256`
- `checkout_offer_snapshot_private`, `checkout_offer_snapshot_sha256`, `checkout_offer_snapshot_hmac_sha256`
- `checkout_recipient_reservation_private`, `checkout_recipient_reservation_sha256`, `checkout_recipient_reservation_hmac_sha256`
- `asset_publication_receipt_private`, `asset_publication_receipt_sha256`, `asset_publication_receipt_hmac_sha256`, `asset_publication_receipt_secret`
- `checkout_binding_key_id`, `checkout_binding_secret`, `retired_checkout_binding_keys_json`
- `handoff_artifact_evidence_secret`
- `preview_source_commit_sha`
- `github_token` only when the signed publication receipt contains assets

The GitHub credential must be read-only for `arcwebhq-cpu/arc-previews`. The adapter reads only the exact signed blob IDs for zero to three content-addressed assets. It performs no GitHub mutation.

The signed offer must match the first-party Checkout Session producer exactly: `automatic_tax=true`,
`customer_creation=always`, and `submit_type=pay`. Both `name_collection` and
`billing_address_collection` are omitted from the provider request; ARC2 rejects the older signed
offer shape that required names or forced a billing address.

For the guarded first-party start request, map:

- `payment_arc2_worker_url=https://arcweb.onl/internal/payment-arc2/start`
- `payment_arc2_worker_secret`
- `provider_operation_timeout_ms` between 100 and 25000

The checkout-binding, publication, artifact, and worker secrets must all be distinct. Store them only in the provider secret store.

## First-party start request

With both flags true, the adapter POSTs exactly these eight fields:

1. `artifact_evidence`
2. `artifact_evidence_hmac_sha256`
3. `checkout_session_id`
4. `claim_token`
5. `deploy_artifacts`
6. `lead_notification_email`
7. `lead_route_recipient_hmac_sha256`
8. `outbox_key`

The request contains no caller-produced payment evidence. The ARC-site worker re-reads the leased outbox, review record, paid ledger, and provider authority; creates transient signed review-session payment evidence; starts or resumes the handoff; and completes the lease only from its durable signed start receipt.

A `200` response must be bound to the same outbox and immutable digest and have state `COMPLETED`. A fresh `200` response must include the canonical receipt and bind the worker's persisted receipt digest to it. An exact completed idempotent replay may omit the already-persisted receipt body, but only when `idempotent_replay=true`, the receipt-envelope fields are all absent, and the persisted receipt digest is valid. A `202` response must have state `PENDING`, `retry_required=true`, a signed start receipt, and a null persisted completion-receipt digest. Every `202` receipt is required and its outbox, review, Checkout Session, recipient, and artifact bindings are validated; its observed digest is reported separately without pretending it has been persisted. The adapter returns `PAYMENT_ARC2_START_RETRY_REQUIRED` so the same exact lease operation can be retried; it never interprets a `202` as delivery.

## Exact production bundle

The adapter revalidates the signed V11 render bundle and deterministically creates exactly 6–9 artifacts in this order:

1. `_headers`
2. Zero to three sorted `assets/<sha256>.(png|jpg|webp)` entries
3. `about/index.html`
4. `contact/index.html`
5. `process/index.html`
6. `services/index.html`
7. `index.html`

It recomputes every page digest, both preview manifests, the production-content digest, artifact manifest, bundle fingerprint, lead-form contract, self-contained asset union, security headers, and signed artifact evidence. The resulting artifact-manifest and production-content digests must exactly equal the first-party paid outbox binding. A mismatch halts before `/start`.

`arc2_resolve_and_finalize.js` is a fail-closed retirement shim so an old Zap revision cannot regain fulfillment authority. Do not map it into a V11 revision.
