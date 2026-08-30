# ARC V11 Zapier private run-one integration

This package is intentionally default-OFF. It defines exactly two zero-input
actions for `arc1-review-revision` and `arc2-payment-start`. Version `0.0.2`
is immutably pinned to `https://arc2-sandbox.netlify.app` and can POST only an
empty JSON object to the two exact first-party `run-one` paths. Production
requires a separately reviewed private-app version pinned to `https://arcweb.onl`.

`arc1-review-email` and `review-checkout-revocation` remain first-party-only
Netlify responsibilities and are not Zapier actions.

The actions read no `bundle.inputData`. Each has a separate exact-`true`
activation gate that defaults false, plus one named per-version bearer secret;
secret presence never enables an action. Requests
have fixed HTTPS origins and paths, a 10-second timeout, a 4096-byte response
limit, redirects disabled, and fixed redacted outputs/errors.

All provider, artifact, archive, validation, and readback states remain
`BLOCKED_UNVERIFIED`. Local checks do not install or publish an app, enable a
Zap, call a provider, or authorize any provider mutation.

Run local checks with Node 22:

```sh
npm test
```

After a clean install, audit the production runtime independently of the pinned
Zapier CLI development toolchain:

```sh
npm run audit:production
```

Do not add inputs, triggers, searches, origins, paths, secret aliases, redirects,
or raw response fields. The name-only secret mapping is recorded in
`secret-binding-contract.json`; no secret value belongs in source.
