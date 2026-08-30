# ARC V11 Zapier private integration scaffold

This package is intentionally fail-closed. It defines exactly two zero-input
actions for the paused `arc1-review-revision` and `arc2-payment-start`
contracts. Both actions stop with one fixed redacted error before any provider
adapter or network boundary can run.

`arc1-review-email` and `review-checkout-revocation` remain first-party-only
Netlify responsibilities and are not Zapier actions.

All provider, artifact, archive, validation, and readback states remain
`BLOCKED_UNVERIFIED`. Local checks are source checks only. They do not create a
Zapier app, produce provider evidence, publish a version, enable a Zap, or
authorize any provider mutation.

Run local checks with Node 22:

```sh
npm test
```

After a clean install, audit the production runtime independently of the pinned
Zapier CLI development toolchain:

```sh
npm run audit:production
```

Do not add authentication, environment reads, input fields, triggers, searches,
network requests, or provider adapters until a separately reviewed runtime and
fresh provider-aware readback process exist.
