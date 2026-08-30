# ARC V11 Zapier private integration CLI runbook

Status: **source scaffold only; BLOCKED_UNVERIFIED**.

The private app source lives at `zapier/private-integration/cli-app`. It contains
exactly two zero-input actions:

- `arc1-review-revision` (`arc1_review_revision` in the Zapier app schema)
- `arc2-payment-start` (`arc2_payment_start` in the Zapier app schema)

`arc1-review-email` and `review-checkout-revocation` are first-party-only. Never
add them as Zapier actions. Their recipient custody, Resend event authority,
Stripe reconciliation, and durable acknowledgement stay inside the signed
Netlify runtime.

## Current guarantees

- Node is pinned to 22.x.
- Zapier core and CLI are pinned to 19.1.0.
- `form-data` is overridden to exactly 4.0.6.
- There is no authentication config, trigger, search, input field, environment
  read, or network call.
- `beforeRequest` rejects every request with one fixed redacted error.
- Both action adapters stop with one fixed redacted error.
- Provider mutation, activation, publish, promotion, and enable gates are false.
- Provider, artifact, archive, validation, and readback states are all
  `BLOCKED_UNVERIFIED`.

Local checks inspect source contracts only:

```sh
npm run test:zapier-v11-cli-private-app
```

They do not build or validate against Zapier, install an app, create a version,
publish an app, create or enable a Zap, or prove provider behavior.

## Required before any provider-ready claim

Use a fresh reviewed tree and separately authorize the provider-aware stage.
Then require all of the following without weakening any OFF gate:

1. clean dependency install from the committed lockfile under Node 22;
2. production dependency audit with `npm audit --omit=dev`;
3. Zapier CLI validation with zero errors and zero warnings;
4. fresh build archive plus exact source/archive digest inventory;
5. provider app ID and immutable private-version readback;
6. exact two-action, zero-input, OFF-state, concurrency-one, and history
   redaction readbacks;
7. sandbox receipts required by `zapier/v11-paused-draft-runbook.md`.

The ARC2 binding producer must first validate the Checkout
Session-to-PaymentIntent relationship against authoritative Stripe data. It
must durably store the exact canonical binding body and signature before the
first write, then replay those byte-identical values on every retry. It must
never regenerate `issued_at` or re-sign a retry.

Until every receipt exists, all state fields must remain
`BLOCKED_UNVERIFIED`. Never convert a local source check into a provider PASS.
