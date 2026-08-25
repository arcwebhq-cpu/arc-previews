# ARC1 consumer runtime deployment contract

Status: **activation prohibited; provider capabilities unverified**.

`scripts/arc1_consumer_runtime.mjs` is the importable provider-neutral runtime.
`zapier/arc1_consumer_runtime.js` is its generated Node 18+ Code-step artifact.
Rebuild it with `npm run build:arc1-consumer-runtime`; CI runs the builder in
`--check` mode and verifies the exact SHA-256 in
`zapier/arc1_consumer_runtime.manifest.json`.

The bundle is executable, but that does not make an ordinary Zapier Code step
safe. Do not activate it until the chosen private integration proves encrypted
secret injection, suppression/redaction of raw inputs and outputs in task
history, authoritative atomic private-state persistence/readback, and a
disabled end-to-end provider test.

## Host contract

- Node.js 18 or newer with `crypto`, `Buffer`, `TextDecoder`, `AbortController`,
  Fetch `Response` streams, and HTTPS fetch support.
- Runtime secrets and activation controls injected through the encrypted host
  environment/private integration. The bundle reads `process.env`.
- No `console` logging, tracing, exception capture, or task-history capture of
  `ARC1_PACKET_JSON`, `private_state_json`, receipt JSON, HMAC values, or the
  mutation fence.
- Only the returned `log_safe_json` is approved for ordinary operational logs.
  It contains pseudonymous digests and identifiers, never the packet, customer
  fields, claim token, bearer, or secret values.
- Redirects are rejected. Claim/completion response URLs must equal their
  signed ARC endpoints, response media type must be exactly `application/json`
  or `application/json; charset=utf-8`, response bodies are limited to 16 KiB,
  and both attempts share one bounded deadline.
- Private-state adapters implement `createOrExact(operation, { signal })` and
  `commitResult(operation, { signal })`. Each call receives an `AbortSignal`,
  is capped at five seconds or the remaining claim lifetime (whichever is
  smaller), and fails locally if the adapter hangs. A create timeout cannot
  release provider work; a commit timeout cannot post completion.

The bundle ignores all runtime settings placed in ordinary `inputData` unless
the host environment itself sets
`ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED=true`. That compatibility
control must remain absent/false unless provider history redaction and encrypted
mapping have been independently attested. A mapped input cannot enable its own
compatibility path.

## Required encrypted runtime settings

Secrets (32–256 UTF-8 bytes and pairwise distinct):

- `ARC_INTAKE_ARC1_PACKET_SECRET`
- `ARC_INTAKE_ARC1_CONSUMER_BEARER`
- `ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET`
- `ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET`

Controls (only exact lowercase `true` enables them):

- `ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED`
- `ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED`
- `ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED`
- `ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED`
- `ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED`
- `ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED`

Optional: `ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS` is an integer from 100 through
10,000; the default is 10,000.

`ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS` is an integer from 100
through 5,000; the default and hard maximum are 5,000. It is always further
capped by the active claim deadline. Every activation control defaults off. A
partial configuration fails before network, private-state, or provider work.

## Three-phase private workflow

1. `CLAIM` consumes `ARC1_PACKET_JSON` and one stable
   `ARC1_STABLE_ATTEMPT_ID`. It verifies the signed canonical packet and obtains
   the first-party atomic claim. It returns a `CREATE_OR_EXACT` private-state
   operation. `private_state_json` contains the claim token: it is private-only
   and is explicitly forbidden from history/logging.
2. The trusted state adapter atomically creates or exact-replays that record,
   reads it back from the authoritative provider, hashes the provider's
   immutable version/receipt, and only then uses
   `createArc1ConsumerStateCreateReceipt`. `AUTHORIZE` consumes that receipt and
   releases the signed mutation fence and stable provider idempotency key.
3. After fenced provider work, the state adapter commits the one immutable
   result digest, reads it back authoritatively, hashes the provider's immutable
   version/receipt, and only then uses
   `createArc1ConsumerStateCommitReceipt`. `COMPLETE` consumes both signed
   provider-backed receipts and posts the byte-stable signed completion.

The receipt helpers only canonicalize and authenticate evidence. Calling them
locally without an authoritative provider write and readback is not durability
proof. Find-then-create, find-then-update, mutable overwrite, unverified task
success, and a locally fabricated provider receipt digest are forbidden.

There is no configured private-state provider, generator/provider mutation,
deployed runtime attestation, or live E2E in this repository. All corresponding
wiring flags remain false.
