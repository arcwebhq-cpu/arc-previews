# ARC previews

ARC's active website contract is the V11 fixed five-page system. Every customer preview contains
exactly these routes:

- `/` — Home
- `/services/` — Services
- `/about/` — About
- `/process/` — Process
- `/contact/` — Contact

Navigation, page metadata, route-relative links, the Contact-only lead form, per-page hashes, and
the whole-site approval digest are contract-bound. A missing, extra, reordered, or modified page
fails closed. The offer is `arc-fixed-five-page-offer-v1`: a $5,000 subtotal plus applicable
destination tax, two revision rounds, 30 days of launch-bug support, and a target of seven business
days after required dependencies are received. It does not promise business results, and additions
outside the fixed scope require a written quote.

Customer previews are unlisted and `noindex,nofollow`, but this repository and GitHub Pages are
public surfaces, not access controls. Anyone who discovers a URL or source folder can view it.
Customer PII, private checkout URLs or references, paid production bundles, receipts, credentials,
and handoff evidence must never be committed or deployed here.

## Quality gate

Run the full local gate with the matching ARC site checkout:

```sh
npm ci
ARC_SITE_DIR=/absolute/path/to/arc-site npm test
```

`ARC_SITE_DIR` must identify the exact partner contract under test. CI checks out that repository
at an immutable commit SHA, and the ARC site workflow pins this preview repository the same way.

The V11 renderer is exercised across 19 media profiles, producing 95 deterministic QA documents
(19 complete sites times five pages). The gate verifies the exact route vector, navigation and
metadata uniqueness, Contact-only form behavior, 150 KB per-page and 500 KB aggregate HTML caps,
sanitization, reviewed scripts, local/content-addressed assets, no unapproved egress, responsive
browser behavior, and whole-site tamper detection. `npm run test:v11-suite` runs the renderer,
production finalizer, and generated ARC1 injector contracts directly.

The local production finalizer treats `assetReview` as structural build/test evidence only: it
checks review shape and digest coverage, but it does not authenticate the reviewer or authorize a
publication. Actual publication requires the ARC1 publisher's signed, digest-bound human-review
receipt, private reviewer-key custody, and reviewer-authority checks.

`npm run test:browser` rebuilds the derived, gitignored `qa-v11` directory and renders all 95 active
V11 niche pages plus the 15 public V11 showcase pages at desktop and iPhone widths (220 browser
renders). `npm run test:browser:all-viewports` adds tablet and 320 px phone coverage. V10 is frozen
compatibility evidence and runs only when explicitly requested with `npm run test:browser:legacy`.

ARC1 generation still uses an exact 58-string provider-neutral response schema. It rejects thin or
repeated service, process, proof, and FAQ content; unfinished placeholders; mismatched CTAs;
inaccessible controls; and unsupported ratings, rankings, customer counts, percentages,
credentials, or guarantees. Real marketing proof requires separately reviewed source evidence;
omitting unsupported proof is required.

These tests are local contract evidence. No model provider is configured or verified, no live
generation call is made, and the synthetic end-to-end scenarios do not prove Stripe, GitHub,
Netlify, inbox, or email-provider behavior.

## ARC1 intake, generation, and publication

ARC1 accepts only the current `arc-intake-v8` fixed-offer intake after an authenticated Netlify
submission readback binds the submission ID and timestamp, required disclosures, immutable offer
ID, server-validated upload hashes, and a create-only private claim. Only a positive allowlist of
public business fields can enter generation. Private recipients, upload capability URLs, payment
data, and operational evidence never enter the generation prompt.

The default-off ARC1 consumer accepts one signed downstream packet and obtains an atomic
first-party claim before work. Its runnable phases are `CLAIM`, `AUTHORIZE`, and `COMPLETE`:

- `CLAIM` creates a PII-free private-state persistence intent.
- `AUTHORIZE` releases a signed mutation fence only after a create-or-exact durable readback.
- `COMPLETE` accepts only a signed immutable-result commit receipt.

The same provider attempt may safely replay an ambiguous response; competing attempts stop. An
expired claim becomes `REVIEW_REQUIRED` and is not reassigned until every downstream mutation
provider implements fencing. Claim and completion HTTP operations use a shared bounded deadline,
at most two byte-identical attempts, HTTPS-only endpoints, redirect rejection, and bounded response
bytes. Only `log_safe_json` may enter ordinary logs.

The active V11 injector emits one `arc1-five-page-render-bundle-v1`, not a singular `html_content`
or `file_path`. Publication creates or reuses a draft PR containing exactly the five preview files
and any receipt-bound content-addressed assets. The merge gate verifies the customer folder bytes
without incorrectly pinning unrelated repository content, so publishing another customer's site
does not invalidate an earlier approved preview. The email gate then performs an authoritative
GitHub Pages readback of all five routes before it can authorize the automated email containing
the private review link.

All ARC1 network, persistence, provider-work, PR-email, and private-checkout controls default to
off. A Catch Hook HTTP 200 is not durability evidence. Activation requires encrypted secret
injection, authoritative provider create/commit readbacks, history redaction, durable retry state,
stale-claim alerts, and provider-specific disabled-sandbox evidence.

## GitHub Pages

GitHub Pages must use **GitHub Actions** as its build source. On a push to `main` or the dedicated
`automation/generated-previews` publishing branch, deployment waits for the full quality gate and
publishes only the allowlisted `.pages-dist` artifact. `main` remains protected; ARC's generator
writes only to the publishing branch. Do not switch Pages to branch/root publishing.

The public showcase set is exactly three fictional V11 sites—roofing, dental, and finance—with five
pages each (15 showcase documents total). Each page visibly says that it is a fictional ARC design
concept. Checkout, lead collection, scripts, remote runtime dependencies, and email addresses are
disabled; the three home-page photos are ARC-owned, content-addressed WebP assets with recorded
provenance.

Customer Pages previews use the same exact five-page V11 route contract and contain only the inert
notice, “Review and payment are available through your private review link.” The Pages allowlist
excludes QA fixtures, legacy previews, paid bundles, source, configuration, tests, dependencies,
and every private checkout capability or evidence value.

## Private checkout and Stripe

The automated preview email contains one private ARC review-portal link—never a checkout link and
never a request to reply manually. Before that email is authorized, the exact five-page Pages bytes
must pass the readiness gate, a durable outbox must move through `PENDING -> CLAIMED ->
INVITE_BOUND`, and the bound state must be authoritatively read back. `SENT` requires an
authenticated provider `DELIVERED` receipt; queued or accepted is not delivery.

Checkout becomes eligible only after the customer selects `APPROVE_AND_PAY` in that private portal.
`REQUEST_CHANGES` creates a new immutable five-page preview and a new invite, for at most two
revision rounds. The older pre-review Payment Link state machine remains default-off for frozen
legacy replay and is no longer part of ARC1's ordered flow. The retained checkout contracts are:

- Offer snapshot and recipient reservation: V2
- Readiness core and observation: V2
- Private checkout policy: `arc-private-checkout-policy-v2`
- Checkout reference and ready tag: V4
- ARC2 payment evidence: `arc2-payment-evidence-v4`
- ARC2 handoff artifact evidence: `arc2-handoff-artifact-evidence-v4`

The read-only Payment Link preflight and ARC2 authenticated Checkout Session retrieval both require
mode-matched restricted `rk_` credentials and pin Stripe API `2026-07-29.dahlia` and terms version
`2026-08-25`. The signed private policy binds one
approved five-page preview to one private, one-use Payment Link; the preview folder; all five route
paths and whole-site digest; ARC account hash; Product and Price; $5,000 one-time subtotal;
exclusive tax behavior; advisor-confirmed Product tax code; expected active tax registrations;
automatic destination tax; required billing address; business and individual name collection;
adult purchaser acknowledgement; and the exact payment-success redirect.

Checkout uses Stripe's dynamic payment-method selection and never exposes a Payment Link URL,
Link ID, checkout reference, policy, or readiness evidence on a public page. Durable create-before-
mutation state, reverse lookup, renewal, expiry, and deactivation are contract-tested but their
provider adapters remain disabled.

`ARC_STRIPE_LIVE_MODE_ENABLED` is fail-closed: missing or `false` selects test-mode contracts, and
only exact `true` selects live credentials and resources. This repository leaves live events,
Payment Link mutation, and real charges off.

## ARC2 paid handoff

`checkout.session.completed` and `checkout.session.async_payment_succeeded` are notifications, not
payment proof. ARC2 retrieves the authenticated configured-mode Session with expanded line-item
taxes and verifies paid status, the exact private V4 reverse reservation, line item, destination
tax, Product tax-code readback, address, names, adult
acknowledgement, retained terms digest, tax-registration snapshot, and immutable five-page source
before fulfillment may advance. The expanded tax amounts must reconcile to the Session total, and a
zero-tax result must carry a recognized Stripe `taxability_reason`. The ambiguous `not_collecting`
reason fails closed for Product and registration review unless the authenticated, advisor-confirmed
Product code is Stripe Nontaxable; `not_supported` fails closed for provider-support review. A
`customer_exempt` or `reverse_charge` result also stops automatic fulfillment until separately
signed exemption or tax-ID evidence is designed and verified. A
provider reason is evidence of Stripe's calculation, not a legal conclusion about registration
obligations or taxability. Product objects remain mutable: if the current Product tax code differs
from the signed creation-time policy or receipt, ARC stops automatic fulfillment with
`ARC_TAX_REVIEW_REQUIRED` for manual review. That current readback is a drift signal, not immutable
historical tax evidence. An unpaid `completed` event does not consume the claim,
so a later asynchronous success remains eligible. Refund or dispute state halts fulfillment.
The signed V4 payment evidence retains the sorted taxability-reason set and a digest of the exact
canonical line-item tax amounts/reasons used for reconciliation, so later handoff and delivery
audits remain bound to the tax breakdown that the resolver evaluated.

The resolver stops at `READY_FOR_CLAIMABLE_DEPLOY`; that state does not mean a site was created,
deployed, claimed, emailed, or launched. Its signed V4 handoff bundle contains exactly 6–9 files in
this order:

1. `_headers`
2. Zero to three lexically sorted `assets/<sha256>.(png|jpg|webp)` files
3. `about/index.html`
4. `contact/index.html`
5. `process/index.html`
6. `services/index.html`
7. `index.html`

The five HTML files implement the public routes `/about/`, `/contact/`, `/process/`, `/services/`,
and `/`. Every asset is self-contained and receipt-bound; preview-host references are forbidden.
`USAGE.md`, `.arc-handoff.json`, `netlify.toml`, success pages, recipient data, Stripe identifiers,
secrets, and any other file are forbidden deploy artifacts.

The intended ownership transfer uses Netlify's deploy-and-claim flow. A claim invitation is
eligible only after the exact preclaim deploy, form route, notification hook, rendered-form probe,
and authoritative inbox receipt are verified. The opaque claim token remains a bearer secret,
stored only as an HMAC, and is forbidden in URL paths and queries. `READY` is not email-delivery
evidence. Final email authorization requires a claimed durable outbox plus fresh signed V4 payment
and artifact evidence and signed claim-state evidence that transitively binds a fresh final-deploy
readback. The gate neither sends mail nor mutates provider state.

The provider-neutral synthetic suite exercises roofing, HVAC, remodeling, landscaping, and auto
detailing through paid success, duplicate replay, unpaid-then-async success, link expiry/renewal,
and refund/dispute halt scenarios. It performs no network calls or external mutations and does not
satisfy the required provider test scenarios by itself.

## Legacy compatibility

V10 templates, QA fixture directories, and historical preview folders remain only for frozen
regression and replay evidence. They are not the active generator, publication, checkout, or
resolver path, and new work may not emit the old singular-page output.

Existing V3 checkout evidence may be accepted only as an exact frozen replay of an already-created
matching pair. New V3 references, tags, policies, artifact evidence, payment evidence, or mixed
V3/V4 chains are forbidden. Legacy delivery-PR, merge, and customer-control scripts remain
fail-closed and are not part of the Netlify claim flow.

## Activation status

This repository does **not** establish launch readiness. All ARC repository-controlled automation
and provider-mutation gates remain off, including ARC1 model work, private-state writes, preview
email, checkout creation and lifecycle changes, ARC2 provider calls, Netlify site/claim issuance,
inbox routing, and delivery email. That source state does not disable external Stripe capabilities
or existing provider objects; those remain separate blockers recorded by the readiness audit.

Activation remains blocked until an adult operator and legal entity are established and the
following are verified with real provider evidence:

- ARC-owned Stripe account binding, Product/Price/Payment Link configuration, tax-code advice,
  registrations, destination-tax testing, refunds, disputes, and atomic fulfillment state
- Durable private-state/CAS storage, secret brokerage, Zapier wiring, retry recovery, and redacted
  histories
- Protected create-only checkout-ready tags plus durable GitHub commit, tree, blob, and Pages
  history retention for paid replay and fulfillment
- Netlify credentials, site creation, exact deploy readback, form detection, claim capability, and
  customer-authorized post-claim readback
- Real lead recipient, authoritative inbox receipts, email-provider delivery receipts, and alerting
- Final domain, client-supplied privacy-policy URL, immutable legal-document retention, entity
  address and venue decisions, analytics/privacy review, and production browser/device QA
- Owned, licensed, content-addressed customer asset bytes and provenance through the live provider
  path

Do not enable live controls or send real outreach, checkout, claims, or customer email until those
blockers are closed and explicitly reviewed.
