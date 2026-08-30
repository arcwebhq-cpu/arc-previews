# ARC V11 Zapier paused-draft runbook

Status: **four workflow source contracts are locally checked; each workflow's
provider and configuration state remains BLOCKED_UNVERIFIED**. Their source controls remain
unpublished and OFF, but that is not provider readback. Exactly two contracts
are paused private-app action recipes: review revision and payment start. Review email and Checkout
revocation are first-party-only contracts, never Zapier install recipes. None
of these artifacts authorizes a Zap publish, provider call, email, Checkout
Session, Netlify handoff, refund, dispute action, or legacy task replay.

The machine-readable source is `zapier/drafts/index.json`. Validate it with:

```sh
npm run test:zapier-v11-drafts
```

The validator emits only file digests and OFF-state booleans. It never emits a
secret, recipient, claim token, Checkout Session ID, outbox key, invite, or
provider receipt.

## Non-negotiable Zapier boundary

- Only `arc1-review-revision` and `arc2-payment-start` may become new paused
  private-app actions after separate provider mutation authorization. Never
  create `arc1-review-email` or `review-checkout-revocation` as a Zapier action
  or Zap. Do not edit, publish, turn on, or replay a legacy ARC task.
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

## Contract 1: review email (first-party only)

Contract: `zapier/drafts/arc1-review-email.json`. This is not a Zapier install
recipe. Its recorded claim, send, and acknowledgement steps describe
first-party boundaries only.

1. Keep `ARC1_REVIEW_EMAIL_ZAP_ENABLED` false.
2. The first-party claim boundary signs the exact bytes of
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

This is not a Zapier action and is not activation-ready. A normal Zap has one
trigger and cannot safely combine the scheduled claim source with the later
native provider webhook source. The first-party scheduled Resend-native worker
also has no authenticated on-demand dispatch route. Do not let the contract
claim work until that boundary is resolved and exactly one consumer owns the
queue.

## Draft 2: review revision

Recipe: `zapier/drafts/arc1-review-revision.json`.

1. Version `0.0.2` is sandbox-only. The action runs only when
   `ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_ENABLED` is exactly `true` and the
   separately stored `ARC_ZAPIER_REVIEW_REVISION_RUN_ONE_SECRET` is valid.
   Secret presence never enables the action; the gate defaults to false.
2. The zero-input action ignores `bundle.inputData` and posts exactly `{}` to
   `https://arc2-sandbox.netlify.app/api/internal/review-revision/run-one`.
   It sends no Origin header, follows no redirects, and uses fixed request and
   response bounds.
3. The first-party worker owns the atomic claim, generation, validation,
   immutable publication, invite reservation, and completion. Zapier never
   receives revision notes, lease tokens, recipients, or raw worker results.
4. Only `EMPTY`, `LEASE_ACTIVE`, and `COMPLETED` become fixed redacted output.
   Every malformed, unexpected, or unavailable response becomes one fixed
   secret-free error. Never replay automatically.

This draft stays blocked until the private version, exact per-version bearer,
concurrency-one setting, site OFF gate, and task-history redaction are installed
and sandbox receipt-tested.

## Draft 3: payment to ARC2 start

Recipe: `zapier/drafts/arc2-payment-start.json`.

1. Version `0.0.2` is sandbox-only. The action runs only when
   `ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_ENABLED` is exactly `true` and the
   separately stored `ARC_ZAPIER_PAYMENT_ARC2_RUN_ONE_SECRET` is valid.
   Secret presence never enables it. Stripe live mode remains false.
2. The zero-input action ignores `bundle.inputData` and posts exactly `{}` to
   `https://arc2-sandbox.netlify.app/internal/payment-arc2/run-one`, with no
   Origin header, redirects, or caller-provided payload.
3. The first-party worker owns claim tokens, artifact custody, authoritative
   Stripe validation, reversal binding/recheck, byte-identical replay, ARC2
   start, and durable completion. None enters Zapier task history.
4. HTTP 202 is not complete. It maps only to fixed `RETRY_REQUIRED` output;
   Zapier automatic replay remains disabled. HTTP 409 `REVIEW_REQUIRED` is a
   terminal redacted state. IDLE and COMPLETED are the only accepted 200 states.
5. Production requires a separately reviewed immutable private-app version
   pinned to `https://arcweb.onl`; never retarget version `0.0.2`.

This draft stays blocked until the private claim/adapter action, restricted
Stripe recheck producer, reversal binding, atomic lease/exact replay behavior,
and history redaction have executed sandbox receipts.

## Contract 4: review Checkout revocation (first-party only)

Contract: `zapier/drafts/review-checkout-revocation.json`.

This is a first-party-only behavior contract, not a Zapier install recipe. Do
not create it as an action or Zap.

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

For the two private-app action workflows only, independently read back the
provider app/action identity, exact paused private-version digest,
concurrency-one setting, OFF state, and history-redaction policy. For the two
first-party-only contracts, read back the exact Netlify runtime deployment and
source digests, OFF gates, single-consumer ownership, and log-redaction policy.
Then execute sandbox-only receipts for:

- empty claim and one exact claim replay;
- changed replay rejection and timeout recovery;
- one delivered, bounced, complained, failed, and suppressed review email;
- one new revision and one exact revision completion replay;
- ARC2 `202 -> binding -> fresh recheck -> identical replay -> 200`;
- one open Checkout expiration, exact negative-event replay, and already-paid
  manual-review halt.

The two Zapier action controls and both first-party runtime gates must still
read back OFF after those tests. Passing local tests is not provider evidence
and is not permission to publish a Zap.
