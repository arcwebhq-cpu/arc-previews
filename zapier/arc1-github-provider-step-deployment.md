# ARC1 GitHub provider-step deployment

Status: **packaging and adapter contract implemented; deployment and provider E2E remain OFF**.

The checked-in `arc1_publish_preview_pr.js` and
`arc1_merge_preview_pr.js` files are deployment templates, not paste-ready Code
steps. Their trust-root sentinel deliberately fails closed. Packaging replaces
that sentinel with the private-state authorization adapter's Ed25519 **public**
keyring. A Zap input can never select or extend that keyring.

## Required private integration action

Between the coordinator's `AUTHORIZE_*` result and either GitHub `EXECUTE`
phase, invoke one authenticated private-integration action. Its connection—not
normal Zap input data—must custody:

- the state-readback verification keyring;
- the authorization-consumption signing private key;
- credentials for the encrypted durable state provider; and
- the implementation of atomic compare-and-set lease consumption.

Use `scripts/arc1_provider_authorization_adapter.mjs` as the executable service
contract. The durable adapter's `consumeExact` operation must atomically:

1. compare the state key, state digest, operation-intent digest, lease ID, and
   provider record version from the signed authorization readback;
2. change that one lease from available to consumed while incrementing the
   provider record version exactly once;
3. persist the canonical consumption receipt in the same transaction; and
4. return the persisted exact receipt on an identical retry, while rejecting a
   changed lease, intent, request digest, state digest, or consumption ID.

Only after the strong readback succeeds may the adapter sign
`arc1-preview-provider-authorization-consumption-v1`. The GitHub step verifies
that receipt against its packaged trust root before its first GitHub request.
Replaying the same receipt can only repeat the same digest-bound idempotent
operation, and it stops working when the short lease expires.

## Build the two Zapier sources

Create a local public-only JSON file outside the repository:

```json
{
  "schema": "arc1-zapier-provider-step-deployment-config-v1",
  "trust_root_id": "arc1-trust-production-authorization-v1",
  "authorization_public_keyring": {
    "consume01": {
      "issuer": "private-state-authorization-adapter",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
    }
  }
}
```

Then write to a new output directory:

```sh
npm run package:arc1-github-provider-steps -- \
  --config /secure/operator/provider-step-public-config.json \
  --output /secure/operator/arc1-zapier-provider-steps-v1
```

The packager validates Ed25519 public keys, rejects private keys and unexpected
fields, refuses to overwrite an existing file, and emits both Code-step sources
plus `manifest.json`. Verify the three file digests, then paste only the two
packaged JavaScript files into the matching private Zap revision.

## Exact Zap mapping

The private integration action receives the coordinator's private
authorization packet. It returns only:

- `async_authorization_consumption_private`;
- `async_authorization_consumption_signature_base64url`; and
- its log-safe consumption digest for operator comparison.

Map the untouched operation intent to `async_operation_intent_private`, set
`async_operation_phase=EXECUTE`, and map the two consumption fields above.
Never map a public keyring, raw signing key, state-readback keyring, private
adapter credential, or caller-selected adapter endpoint. The provider steps
explicitly reject the old readback/keyring input names.

## Activation evidence still required

Before ARC1 can be enabled, an operator must prove in the real private
integration and state provider that concurrent attempts produce one atomic
consumption, exact retries return the same receipt, changed attempts conflict,
expired receipts make zero GitHub requests, and Zap history contains no private
state, credentials, recipient data, or signing material. Local tests are not
that provider evidence.

An ordinary Code by Zapier step plus mapped Zapier Tables fields is not this
adapter: mapped fields cannot safely custody signing keys, prove an atomic
compare-and-set lease transition, or guarantee private history redaction.
