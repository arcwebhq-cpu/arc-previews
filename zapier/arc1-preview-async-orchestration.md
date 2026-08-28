# ARC1 preview async orchestration

Status: **implemented, provider-neutral, and OFF**.

`scripts/arc1_preview_async_orchestrator.mjs` is the durable coordinator after a
V11 render has passed validation. Its artifact digest is exactly the validator's
`render_bundle_sha256`, and its validation-receipt digest is exactly the
validator's `validation_receipt_sha256`. It does not call GitHub, GitHub Pages, the
review service, Stripe, an email provider, or a persistence provider. The host
must keep private persistence/action payloads out of ordinary Zap history; only
`logSafeJson` is log-safe.

The fixed order is:

1. prepare the immutable PR provider request without network access, persist its
   intent, read it back, claim a short authorization lease, create/reuse the PR,
   and consume the authenticated `PR_CREATED` receipt;
2. authenticated PR quality check success;
3. prepare the exact merge request without network access, persist the merge
   intent, read it back, authorize the idempotent merge, then
   consume the authenticated merge readback;
4. consume the authenticated exact-byte readback for all five Pages routes;
5. persist the preview-email intent, read it back, authorize the idempotent
   send, then consume the provider-authenticated `DELIVERED` receipt;
6. consume a separately authenticated `APPROVE_AND_PAY` decision from the
   private review portal; and
7. persist and read back the private-checkout authorization intent before any
   checkout adapter may act.

Checkout is therefore impossible before both preview-email delivery and the
customer's explicit approval. The coordinator carries only immutable hashes;
it never emits a Payment Link URL, checkout reference, customer email, invite
capability, or provider-native receipt.

## Persistence contract

- Initial state: `CREATE_OR_EXACT`.
- The state key is deterministically hash-derived from the immutable V11
  artifact and validation-receipt digests; callers cannot choose a second key
  for the same validated artifact.
- Every later transition: `COMPARE_AND_SET_OR_EXACT` against
  `expectedPreviousStateSha256`. If a write committed but its acknowledgement
  was lost, an exact target readback is success; a different target conflicts.
- Every resume/authorization requires a fresh, signed, authoritative exact-state
  readback.
- Provider authorization additionally requires a short signed authorization
  lease from an atomic current-state claim. An authenticated private-integration
  action must consume the lease ID and operation idempotency key atomically and
  return the exact signed consumption receipt.
- Lease issuance keeps `provider_action_allowed=false`; only a packaged
  provider step holding the signed consumption receipt can cross the provider
  boundary.
- The PR-create and merge steps expose `PREPARE_REQUEST` zero-network phases.
  Their `EXECUTE` phases independently verify the deployment-pinned
  authorization-adapter key, atomic consumption receipt, operation intent,
  immutable request digest, action, artifact, freshness, and expiry before the
  first GitHub request. A mapped input can never select the keyring.
- Mutation intent is persisted before action authorization.
- Every operation intent binds the SHA-256 of its immutable private provider
  request/target, so mutable PR, recipient, or checkout inputs cannot be swapped
  under an existing authorization.
- Replayed intent preparation recovers the same idempotency key.
- Replayed exact stage receipts are no-ops.
- Changed, reordered, unsigned, expired, or non-durable state fails closed.

Each issuer has its own Ed25519 key and key ID; GitHub, Pages, email, review,
checkout, and private-state authority are not interchangeable. Retired public
keys and state HMAC keys remain in bounded rollover keyrings so active workflows
survive rotation. The provider adapter signs only a digest of its native receipt. Existing ARC
contracts remain authoritative for receipt semantics:

- PR and merge: fenced `PREPARE_REQUEST`/`EXECUTE` phases in
  `arc1_publish_preview_pr.js` and `arc1_merge_preview_pr.js`, followed by their
  authenticated provider readbacks;
- Pages: `arc1_preview_email_gate.js` exact five-route byte evidence;
- preview email: `arc1_preview_review_outbox.js` `SENT` state backed by the
  provider-authenticated `DELIVERED` evidence;
- approval: the private review service's signed `APPROVE_AND_PAY` decision; and
- checkout: the private checkout adapter's signed authorization/readback.

The two GitHub Code-step sources must be built with
`scripts/package_arc1_github_provider_steps.mjs`; the checked-in templates are
intentionally unconfigured and fail closed. The operator sequence and private
integration boundary are in
`zapier/arc1-github-provider-step-deployment.md`.

## Default-OFF controls

All are required from a history-redacted host environment, never normal Code
step fields:

- `ARC1_PREVIEW_ASYNC_ORCHESTRATOR_ENABLED`
- `ARC1_PREVIEW_ASYNC_PRIVATE_STATE_ENABLED`
- `ARC1_PREVIEW_ASYNC_PROVIDER_ACTIONS_ENABLED`
- `ARC1_PREVIEW_ASYNC_HISTORY_REDACTION_ATTESTED`
- `ARC1_PREVIEW_ASYNC_STATE_CURRENT_KEY_ID`
- `ARC1_PREVIEW_ASYNC_STATE_KEYRING_JSON`
- `ARC1_PREVIEW_ASYNC_READBACK_PUBLIC_KEYRING_JSON`
- `ARC1_PREVIEW_ASYNC_STAGE_RECEIPT_PUBLIC_KEYRING_JSON`

The runtime receives only issuer-scoped Ed25519 public keys. The durable-state
and provider adapters retain the corresponding private signing keys outside the
runtime, so the coordinator cannot manufacture its own readback, authorization
lease, customer approval, or stage-success receipt.

Missing or non-exact activation flags keep the coordinator off. Code presence
does not authorize any external action.

## Provider blockers

Before activation, ARC still needs a deployed encrypted/CAS private-state
adapter with create-or-exact, CAS-or-exact, and atomic authorization-lease
consumption; a private-integration action using the reference adapter contract;
signed adapter readbacks and consumption receipts; authenticated email-delivery webhooks; a
deployed private review decision service, and provider E2E evidence for GitHub
checks/merge, Pages exact bytes, email delivery, and private checkout. Local
contract tests are not external proof.
