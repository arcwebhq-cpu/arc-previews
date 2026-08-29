# ARC V11 Zapier paused-draft runbook

Status: **four install recipes are validated, unpublished and OFF**. They are
configuration artifacts only. They do not authorize a Zap publish, provider
call, email, Checkout Session, Netlify handoff, refund, dispute action, or
legacy task replay.

The machine-readable source is `zapier/drafts/index.json`. Validate it with:

```sh
npm run test:zapier-v11-drafts
```

The validator emits only file digests and OFF-state booleans. It never emits a
secret, recipient, claim token, Checkout Session ID, outbox key, invite, or
provider receipt.

## Non-negotiable Zapier boundary

- Create each recipe only as a new paused draft. Do not edit, publish, turn on,
  or replay a legacy ARC task.
- Set maximum concurrency to one. Disable Zapier automatic replay and provider
  retries until exact replay behavior has been separately proven.
- Secrets and private payloads may exist only inside a verified private Zapier
  integration or secret broker whose input and output history redaction has
  been read back. Never map them through ordinary Code, Webhooks, Tables,
  Filters, Paths, Storage, or task-history fields.
- A Zapier Catch Hook cannot produce ARC's exact synchronous durable ACK. It
  acknowledges ingress before downstream steps finish, so it cannot replace
  the first-party intake adapter, a private create-only claim, or an atomic
  compare-and-set operation.
- Find-then-create and find-then-update are not atomic CAS. Zapier Tables are
  not accepted as ARC's lease, dedupe, or completion authority without an
  independent provider capability receipt.
- Gmail, Email by Zapier, and Zapier email actions are forbidden. Customer
  email remains Resend-native through the first-party worker.
- Payment Links are forbidden. ARC V11 accepts only approval-bound private
  Stripe Checkout Sessions.

## Draft 1: review email

Recipe: `zapier/drafts/arc1-review-email.json`.

1. Keep `ARC1_REVIEW_EMAIL_ZAP_ENABLED` false.
2. The private claim action signs the exact bytes of
   `{"claim_next":true}` and posts them to
   `/api/internal/review-email/reserve`. It adds no `Origin` header and keeps
   the response private.
3. `empty=true` stops without a task. `renewal_required=true` routes to a
   first-party renewal adapter; the Zap must not invent a replacement invite.
4. The first-party scheduled `transactional-email-worker.mjs` owns the send,
   durable send-attempt latch, recipient vault, and Resend idempotency. The
   draft must not add a second sender.
5. `/api/internal/review-email/ack` accepts only signed native provider receipt
   evidence. A Resend API acceptance or a successful Zap task is not delivery.

This is not activation-ready: a normal Zap has one trigger and cannot safely
combine the scheduled claim source with the later native provider webhook
source. The first-party scheduled Resend-native worker also has no authenticated
on-demand dispatch route. Do not let the draft claim work until that boundary
is resolved and exactly one consumer owns the queue.

## Draft 2: review revision

Recipe: `zapier/drafts/arc1-review-revision.json`.

1. Keep `ARC1_REVIEW_REVISION_ZAP_ENABLED` false.
2. The private action posts exactly `{"cursor":null}` to
   `/api/internal/review-revision/claim` using only the dedicated revision
   worker bearer. Browser-origin requests are forbidden.
3. Keep `lease_token`, `revision_input`, revision notes, and recipient bindings
   inside the private integration. Stop on `empty=true`; otherwise exhaust each
   returned cursor without parallel claims.
4. Generate the exact 58-key V11 response, validate all five pages, create a
   pull request, pass the named GitHub Actions check, merge the immutable head,
   verify GitHub Pages exact bytes, and reserve a successor invite. Direct main
   pushes are forbidden.
5. Post exactly the seven completion fields listed in the recipe to
   `/api/internal/review-revision/complete`. Complete only after the durable
   artifact and invite receipts exist. A timeout leaves the work retryable; an
   exact completion replay may converge, but changed bytes must fail.

This draft stays blocked until the private ARC1 revision integration, provider
authorization leases, exact Pages readback, invite reservation, and task-history
redaction are installed and receipt-tested.

## Draft 3: payment to ARC2 start

Recipe: `zapier/drafts/arc2-payment-start.json`.

1. Keep `ARC2_PAYMENT_START_ZAP_ENABLED`,
   `arc2_checkout_session_adapter_enabled`, `payment_arc2_start_enabled`, and
   `stripe_live_mode_enabled` false.
2. Inside the private integration, generate at least 32 random bytes encoded as
   base64url. Post only `claim_token` to `/internal/payment-arc2/claim` with the
   dedicated payment worker bearer. Never show the token or private claim in
   task history.
3. Stop on `state=EMPTY`. Otherwise pass the full private claim and retained
   signed ARC1 evidence to `arc2_checkout_session_artifact_adapter.js` without
   ordinary field mapping.
4. The adapter derives the exact six-to-nine deploy artifacts and posts the
   exact eight-field request to `/internal/payment-arc2/start`. It never accepts
   caller-created payment evidence.
5. When reversal control is required, the first start is expected to return
   HTTP 202. HTTP 202 is not complete: persist the identical operation, register
   the signed Checkout Session-to-PaymentIntent binding, issue a fresh
   authoritative no-reversal recheck, and replay the exact same start bytes
   with the same claim token and outbox key.
6. Post `/internal/payment-arc2/complete` only after the first-party worker
   returns a durable signed completion receipt. A timeout or 202 stays
   retryable; never replay automatically through Zapier.

This draft stays blocked until the private claim/adapter action, restricted
Stripe recheck producer, reversal binding, atomic lease/exact replay behavior,
and history redaction have executed sandbox receipts.

## Draft 4: review Checkout revocation

Recipe: `zapier/drafts/review-checkout-revocation.json`.

ARC currently exposes no separate checkout-revocation claim or completion HTTP
surface. The implemented authority runs inside the first-party signed Resend
webhook and calls `expireSuppressedRecipientReviewCheckouts` directly. It must
retrieve every indexed bound Session, expire only open/unpaid Sessions,
retrieve again, and halt fulfillment plus create a manual refund-review alert
if a Session is already paid.

The paused recipe records the required provider behavior but must not call
Stripe. A standard Zap cannot atomically join a private recipient suppression,
all indexed Checkout Sessions, the Stripe retrieve-expire-retrieve sequence,
and the durable review state. Automatic refunds and dispute actions remain
false.

## Evidence required before any publish

For each workflow, independently read back the provider workflow ID, exact
paused version digest, concurrency-one setting, OFF state, and history-redaction
policy. Then execute sandbox-only receipts for:

- empty claim and one exact claim replay;
- changed replay rejection and timeout recovery;
- one delivered, bounced, complained, failed, and suppressed review email;
- one new revision and one exact revision completion replay;
- ARC2 `202 -> binding -> fresh recheck -> identical replay -> 200`;
- one open Checkout expiration, exact negative-event replay, and already-paid
  manual-review halt.

Provider controls must still read back OFF after those tests. Passing local
tests is not provider evidence and is not permission to publish a Zap.
