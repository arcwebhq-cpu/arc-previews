import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unsupportedMarketingClaims } from "./content_quality.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedContractRoots = new Set(
  [process.env.ARC_SITE_DIR]
    .filter(Boolean)
    .map(candidate => path.resolve(root, candidate))
    .filter(candidate => candidate.startsWith(`${root}${path.sep}`))
);
const v10Manifest = JSON.parse(await readFile(path.join(root, "qa-v10/manifest.json"), "utf8"));
const showcaseManifest = JSON.parse(await readFile(path.join(root, "showcases/manifest.json"), "utf8"));
const mediaManifest = JSON.parse(await readFile(path.join(root, "config/media-manifest.json"), "utf8"));
const qaFiles = [
  "northline-roofing-qa-6a776d95/index.html",
  "harborview-dental-qa-6a776c67/index.html",
  "evergreen-injury-law-qa-6a776e0e/index.html",
  "sound-stone-realty-qa-6a776e44/index.html",
  "aurora-aesthetics-qa-6a7770a4/index.html",
  "cascade-comfort-hvac-qa-6a776ecd/index.html",
  "sorella-table-qa-6a776f2a/index.html",
  "forge-strength-club-qa-6a776f52/index.html",
  "northwest-ledger-cpa-qa-6a7770f1/index.html",
  "prism-auto-detail-qa-6a77713f/index.html"
];
const retiredFiles = [
  "previews/01KXJB41TM7W31VTN7FTHR7V59/index.html",
  "previews/1784229608227-8hd6gnkc/index.html"
];
const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const leadDisclosurePattern = /<p class="form-status" role="note">By submitting this form, you agree that this business may contact you about your request\. Do not include sensitive personal, medical, legal, or financial information\.<\/p>/;

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", ".pages-dist", "node_modules", "test-results"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && excludedContractRoots.has(absolute)) continue;
    if (entry.isDirectory()) files.push(...await listHtmlFiles(absolute));
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolute);
  }
  return files;
}

const allHtmlFiles = await listHtmlFiles(root);
const showcasePages = showcaseManifest.flatMap(item => item.pages.map(page => ({ ...page, profile: item.profile })));
const showcaseFileSet = new Set(showcasePages.map(item => path.normalize(item.file)));
const previewFiles = allHtmlFiles.filter(file =>
  path.basename(file) !== "ARC_MASTER_TEMPLATE.html" &&
  !path.relative(root, file).split(path.sep).includes("deliveries") &&
  !showcaseFileSet.has(path.normalize(path.relative(root, file)))
);
const productionFiles = allHtmlFiles.filter(file =>
  path.relative(root, file).split(path.sep).includes("deliveries")
);
assert.ok(previewFiles.length >= 49, "The repository must retain every recoverable preview URL");
assert.equal(productionFiles.length, 0, "Paid production artifacts must not be committed to the public preview repository");

for (const file of previewFiles) {
  const html = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*nofollow/i, `${relative}: private robots metadata missing`);
  assert.doesNotMatch(html, /content=["']\s*index\s*,?\s*follow/i, `${relative}: public indexing is still enabled`);
  assert.doesNotMatch(html, emailAddressPattern, `${relative}: an email address leaked into public HTML`);
  if (/<meta\s+name=["']arc-template-version["']\s+content=["']10\.0["']/i.test(html)) {
    assert.deepEqual(unsupportedMarketingClaims(html), [], `${relative}: unsupported marketing proof requires source evidence`);
  }
}

assert.deepEqual(
  showcaseManifest.map(({ profile, name, fixtureId, fixtureSource, contractVersion, templateVersion, page_count, pages }) => ({
    profile,
    name,
    fixtureId,
    fixtureSource,
    contractVersion,
    templateVersion,
    page_count,
    pages: pages.map(({ key, label, path: pagePath, file }) => ({ key, label, path: pagePath, file }))
  })),
  [
    {
      profile: "roofing",
      name: "Ironwood Roofing Concept",
      fixtureId: "a1000001",
      fixtureSource: "fixtures/v11_industries.mjs",
      contractVersion: "arc-five-page-site-v1",
      templateVersion: "11.0",
      page_count: 5,
      pages: [
        { key: "home", label: "Home", path: "index.html", file: "showcases/roofing/index.html" },
        { key: "services", label: "Services", path: "services/index.html", file: "showcases/roofing/services/index.html" },
        { key: "about", label: "About", path: "about/index.html", file: "showcases/roofing/about/index.html" },
        { key: "process", label: "Process", path: "process/index.html", file: "showcases/roofing/process/index.html" },
        { key: "contact", label: "Contact", path: "contact/index.html", file: "showcases/roofing/contact/index.html" }
      ]
    },
    {
      profile: "dental",
      name: "Cedar Dental Concept",
      fixtureId: "b2000001",
      fixtureSource: "fixtures/v11_media_coverage.mjs",
      contractVersion: "arc-five-page-site-v1",
      templateVersion: "11.0",
      page_count: 5,
      pages: [
        { key: "home", label: "Home", path: "index.html", file: "showcases/dental/index.html" },
        { key: "services", label: "Services", path: "services/index.html", file: "showcases/dental/services/index.html" },
        { key: "about", label: "About", path: "about/index.html", file: "showcases/dental/about/index.html" },
        { key: "process", label: "Process", path: "process/index.html", file: "showcases/dental/process/index.html" },
        { key: "contact", label: "Contact", path: "contact/index.html", file: "showcases/dental/contact/index.html" }
      ]
    },
    {
      profile: "finance",
      name: "Clearwater Finance Concept",
      fixtureId: "b2000010",
      fixtureSource: "fixtures/v11_media_coverage.mjs",
      contractVersion: "arc-five-page-site-v1",
      templateVersion: "11.0",
      page_count: 5,
      pages: [
        { key: "home", label: "Home", path: "index.html", file: "showcases/finance/index.html" },
        { key: "services", label: "Services", path: "services/index.html", file: "showcases/finance/services/index.html" },
        { key: "about", label: "About", path: "about/index.html", file: "showcases/finance/about/index.html" },
        { key: "process", label: "Process", path: "process/index.html", file: "showcases/finance/process/index.html" },
        { key: "contact", label: "Contact", path: "contact/index.html", file: "showcases/finance/contact/index.html" }
      ]
    }
  ],
  "The public showcase aliases changed without an explicit contract update"
);
for (const showcase of showcaseManifest) {
  assert.equal(showcase.pages.length, 5, `${showcase.profile}: exact five-page showcase set missing`);
  assert.equal(showcase.total_bytes, showcase.pages.reduce((total, page) => total + page.bytes, 0), `${showcase.profile}: total byte binding mismatch`);
  for (const page of showcase.pages) {
    const html = await readFile(path.join(root, page.file), "utf8");
    assert.equal(Buffer.byteLength(html, "utf8"), page.bytes, `${page.file}: manifest byte binding mismatch`);
    assert.equal(createHash("sha256").update(html, "utf8").digest("hex"), page.sha256, `${page.file}: manifest digest binding mismatch`);
    assert.match(html, /arc-template-version["']\s+content=["']11\.0/i, `${page.file}: v11 marker missing`);
    assert.match(html, /arc-site-contract["']\s+content=["']arc-five-page-site-v1/i, `${page.file}: five-page site contract missing`);
    assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*nofollow/i, `${page.file}: noindex/nofollow missing`);
    assert.match(html, new RegExp(`<meta\\s+name=["']arc-showcase-profile["']\\s+content=["']${showcase.profile}["']`, "i"), `${page.file}: showcase profile missing`);
    assert.match(html, new RegExp(`<meta\\s+name=["']arc-page-key["']\\s+content=["']${page.key}["']`, "i"), `${page.file}: page key missing`);
    assert.match(html, /<meta\s+name=["']arc-site-mode["']\s+content=["']showcase["']/i, `${page.file}: showcase metadata mode missing`);
    assert.match(html, /data-arc-site-mode=["']showcase["']/i, `${page.file}: inert showcase mode missing`);
    assert.match(html, /Fictional ARC design concept — not a real business\. Checkout and lead collection are disabled\./, `${page.file}: visible fictional-concept disclosure missing`);
    assert.doesNotMatch(html, /<script\b|<form\b|\bdata-netlify\b|\bnetlify-honeypot\b|data-arc-checkout|buy\.stripe\.com/i, `${page.file}: executable checkout or customer lead submission remained active`);
    assert.doesNotMatch(html, emailAddressPattern, `${page.file}: an email address leaked into showcase HTML`);
  }
}

for (const file of qaFiles) {
  const html = await readFile(path.join(root, file), "utf8");
  assert.match(html, /ARC Client Master Template v9\.6/i, `${file}: v9.6 marker missing`);
  assert.ok(html.includes("ARC production hardening v9.6"), `${file}: hardening CSS missing`);
  assert.ok(html.includes("ARC adaptive mobile grid fix v9.6"), `${file}: adaptive phone grid fix missing`);
  assert.doesNotMatch(html, /https?:\/\/(?:www\.)?example\.(?:com|org|net)/i, `${file}: dummy external CTA remains`);
  assert.doesNotMatch(html, /\[\[[A-Z0-9_]+\]\]/, `${file}: unresolved template placeholder`);
}

for (const file of retiredFiles) {
  const html = await readFile(path.join(root, file), "utf8");
  assert.match(html, /<title>Preview retired<\/title>/i, `${file}: malformed artifact was not retired`);
}

const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE.html"), "utf8");
const placeholders = [...template.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map(match => match[1]);
assert.equal(new Set(placeholders).size, 58, "Master template must preserve the exact 58-key contract");
assert.match(template, /ARC Client Master Template v10\.0/i, "Master template version is not v10.0");
assert.match(template, /content=["']noindex,nofollow,noarchive,nosnippet["']/i, "Master template is not private by default");
assert.ok(template.includes("ARC production hardening v10.0"), "Master template hardening marker missing");
assert.ok(template.includes("ARC premium composition v10.0"), "Master template premium composition marker missing");
assert.ok(template.includes("ARC adaptive mobile grid fix v10.0"), "Master template adaptive phone grid fix missing");
assert.ok(template.includes("ARC_COMPOSITION_MANIFEST_START v10.1"), "Master template local-composition manifest marker missing");
assert.ok(template.includes('const previewMode=document.body.dataset.arcSiteMode!=="production"'), "Form mode is still inferred from the hosting domain");

assert.equal(v10Manifest.length, mediaManifest.profiles.length, "Every media profile must have a v10 browser fixture");
assert.equal(new Set(v10Manifest.map(item => item.folder)).size, v10Manifest.length, "Every v10 fixture folder must be unique");
assert.equal(new Set(v10Manifest.map(item => item.previewUrl)).size, v10Manifest.length, "Every v10 fixture preview URL must be unique");
assert.deepEqual(
  [...new Set(v10Manifest.map(item => item.expectedProfile))].sort(),
  mediaManifest.profiles.map(item => item.key).sort(),
  "The v10 fixture set does not cover every media profile"
);
const launchFixtures = v10Manifest.filter(item => item.isLaunch);
assert.equal(launchFixtures.length, 5, "Exactly five launch-industry fixtures are required");
const launchCompositions = new Set();
for (const fixture of v10Manifest) {
  const profile = mediaManifest.profiles.find(item => item.key === fixture.expectedProfile);
  assert.ok(profile, `${fixture.file}: media profile is missing`);
  assert.ok(["impact", "trusted", "editorial", "balanced"].includes(profile.layout), `${fixture.file}: unsupported composition layout`);
  assert.ok(Number.isInteger(profile.variant) && profile.variant >= 0 && profile.variant <= 2, `${fixture.file}: unsupported composition variant`);
  if (fixture.isLaunch) launchCompositions.add(`${profile.layout}:${profile.variant}`);
  const html = await readFile(path.join(root, fixture.file), "utf8");
  assert.match(html, /ARC Client Master Template v10\.0/i, `${fixture.file}: v10 marker missing`);
  assert.match(html, /data-arc-site-mode=["']preview["']/i, `${fixture.file}: preview mode missing`);
  assert.match(html, leadDisclosurePattern, `${fixture.file}: visible lead privacy disclosure missing`);
  assert.ok(html.includes(`key:${JSON.stringify(fixture.expectedProfile)}`), `${fixture.file}: expected media profile is absent`);
  assert.match(html, /<span data-arc-checkout-private>Checkout is available only through the private approval email\.<\/span>/,
    `${fixture.file}: exact inert private-checkout notice is missing`);
  assert.doesNotMatch(html,/buy\.stripe\.com|\bplink_[A-Za-z0-9]+|client_reference_id|arc-checkout-config|v[34]_[A-Za-z0-9_-]{135}/i,
    `${fixture.file}: public fixture leaked a checkout capability or private offer evidence`);
}
assert.equal(launchCompositions.size, 5, "The five launch niches must use five distinct layout/variant compositions");

const validator = await readFile(path.join(root, "arc_step7_validator.js"), "utf8");
const contentSanitizer = await readFile(path.join(root, "scripts/content_sanitizer.mjs"), "utf8");
const arc1 = await readFile(path.join(root, "zapier/arc1_inject.js"), "utf8");
const arc1PaymentLink = await readFile(path.join(root, "zapier/arc1_verify_payment_link.js"), "utf8");
const arc1PrivateCheckout = await readFile(path.join(root, "zapier/arc1_private_checkout_link.js"), "utf8");
const arc2 = await readFile(path.join(root, "zapier/arc2_resolve_and_finalize.js"), "utf8");
const arc2LeadRouteVerifier = await readFile(path.join(root, "zapier/arc2_verify_lead_route_staging.js"), "utf8");
const arc1PrPublisher = await readFile(path.join(root, "zapier/arc1_publish_preview_pr.js"), "utf8");
const arc1PrMerge = await readFile(path.join(root, "zapier/arc1_merge_preview_pr.js"), "utf8");
const arc1EmailGate = await readFile(path.join(root, "zapier/arc1_preview_email_gate.js"), "utf8");
const arc2PrPublisher = await readFile(path.join(root, "zapier/arc2_publish_delivery_pr.js"), "utf8");
const arc2PrMerge = await readFile(path.join(root, "zapier/arc2_merge_delivery_pr.js"), "utf8");
const arc2EmailGate = await readFile(path.join(root, "zapier/arc2_delivery_email_gate.js"), "utf8");
const arc2CustomerControl = await readFile(path.join(root, "zapier/arc2_verify_customer_control.js"), "utf8");
new Function("inputData", validator);
for (const source of [arc1, arc1PaymentLink, arc1PrivateCheckout, arc2, arc1PrPublisher, arc1PrMerge, arc1EmailGate, arc2LeadRouteVerifier, arc2PrPublisher, arc2PrMerge, arc2EmailGate, arc2CustomerControl]) {
  new Function("inputData", "fetch", "Buffer", `return (async () => {${source}})()`);
}
assert.ok(validator.includes("customer_email_not_exposed_pass"), "Validator does not block requester-email exposure");
assert.ok(validator.includes("private_preview_metadata_pass"), "Validator does not enforce private previews");
assert.ok(validator.includes("dummy_link_pass"), "Validator does not reject dummy external CTAs");
assert.ok(validator.includes("generated_media_ownership_pass"), "Validator does not reject unowned AI-selected media");
assert.ok(validator.includes("semantic_media_profile_pass"), "Validator does not enforce semantic media selection");
assert.ok(validator.includes("scalar_render_escaping_pass"), "Validator does not attest scalar escaping");
assert.ok(validator.includes("premium_content_contract_pass"), "Validator does not reject thin or repeated generated sections");
assert.ok(validator.includes("unsupported_claims_pass"), "Validator does not reject unsupported marketing proof");
assert.ok(contentSanitizer.includes("sanitizeStructuredMarkup"), "Typed structured-markup sanitizer is missing");
assert.ok(contentSanitizer.includes("generated class is not allowlisted"), "Generated classes are not fail-closed");
assert.ok(contentSanitizer.includes("form action must stay same-origin"), "Generated forms can escape same-origin routing");
assert.doesNotMatch(template, /"(?:name|description|areaServed)"\s*:\s*"\[\[/, "Raw placeholders remain inside executable JSON-LD JavaScript");
assert.match(arc1, /Scalar fields are HTML-escaped/, "Zapier ARC1 does not document its untrusted-content boundary");
assert.match(arc1, /sanitizeMarkup/, "Zapier ARC1 does not use the typed structured-markup sanitizer");
assert.match(arc1, /ARC1_LEGACY_INTAKE_DISABLED/, "Zapier ARC1 still permits legacy source URLs instead of the clean Function-intake cutover");
assert.match(arc1, /const url=`\$\{pagesRoot\}\/\$\{path\}`/, "Zapier ARC1 does not derive public asset URLs solely from the content-addressed repository path");
assert.match(arc1, /generated class is not allowlisted/, "Zapier ARC1 generated classes are not fail-closed");
assert.match(arc1, /ARC_CONTENT_QUALITY_INVALID/, "Zapier ARC1 does not enforce the premium content contract before signing a preview");
assert.match(arc1, /ARC_CLAIM_EVIDENCE_REQUIRED/, "Zapier ARC1 can sign unsupported marketing proof");
assert.doesNotMatch(arc1, /payment_link_url\s*\|\|\s*["']https:\/\/buy\.stripe\.com/i, "ARC1 retains a default live Payment Link");
assert.match(arc1, /stripe_live_mode_enabled must be true or false/, "ARC1 does not fail closed on Stripe mode selection");
assert.match(arc1, /arc1-checkout-offer-template-evidence-v1/, "ARC1 does not require signed offer-template preflight evidence");
assert.match(arc1, /paymentLinkEvidenceIssuedMs<Date\.now\(\)-5\*60\*1000/, "ARC1 accepts stale offer-template preflight evidence");
assert.match(arc1, /arc-checkout-offer-snapshot-signature-v2/, "ARC1 does not sign the immutable five-page private checkout offer");
assert.match(arc1, /Review and payment are available through your private review link\./, "ARC1 does not render the exact inert private-review notice");
assert.doesNotMatch(arc1, /checkout_url\s*:|payment_link_url\s*:/, "ARC1 exposes a public checkout URL");
assert.match(arc1PaymentLink, /stripeApiVersion = "2026-07-29\.dahlia"/, "ARC1 offer-template preflight does not pin the Stripe API version");
assert.match(arc1PaymentLink, /\/v1\/prices\/\$\{encodeURIComponent\(expectedPriceId\)\}/, "ARC1 offer-template preflight does not read the exact Price and Product");
assert.match(arc1PaymentLink, /https:\/\/api\.stripe\.com\/v1\/account/, "ARC1 offer-template preflight does not verify the authenticated ARC Stripe account");
assert.match(arc1PaymentLink, /expectedStripeAccountIdSha256/, "ARC1 offer-template preflight does not bind the private ARC Stripe account hash");
assert.match(arc1PaymentLink, /automatic_tax_enabled:\s*true/, "ARC1 offer-template preflight does not require Stripe automatic tax for the later one-use Link");
assert.match(arc1PaymentLink, /tax\/registrations/, "ARC1 Payment Link preflight does not re-read active Stripe Tax registrations");
assert.match(arc1PaymentLink, /price\.tax_behavior/, "ARC1 Payment Link preflight does not require exclusive tax behavior");
assert.match(arc1PaymentLink, /product\.tax_code/, "ARC1 Payment Link preflight does not verify the Product tax code");
assert.match(arc1PaymentLink, /adultpurchaserack/, "ARC1 Payment Link preflight uses an invalid or stale custom-field key");
assert.match(arc1PaymentLink, /price\.active !== true/, "ARC1 Payment Link preflight does not require an active Price before checkout exposure");
assert.doesNotMatch(arc1PrivateCheckout, /set\("payment_method_types|payment_method_types\[0\]/,
  "Private checkout creation pins payment methods instead of allowing Stripe dynamic payment methods");
assert.match(arc1PaymentLink, /checkout_redirect_url:\s*redirectUrl/, "ARC1 offer-template preflight does not bind the exact success redirect");
assert.match(arc1PaymentLink, /https:\/\/arcweb\.onl\/payment-success\/\?session_id=\{CHECKOUT_SESSION_ID\}/, "ARC1 Payment Link preflight does not pin the static ARC payment-success URL");
assert.match(arc1PrivateCheckout, /restrictions\[completed_sessions\]\[limit\]",\s*"1"/, "Private checkout creation does not enforce a one-completed-Session Link");
assert.match(arc1PrivateCheckout, /private_checkout_provider_mutation_enabled/, "Private checkout provider mutation lacks a distinct default-off gate");
assert.match(arc1PrivateCheckout, /private_checkout_ready_tag_mutation_enabled/, "Private checkout READY tag mutation lacks a distinct default-off gate");
assert.match(arc1PrivateCheckout, /arc-checkout-ready-v4/, "Private checkout does not create the post-readiness immutable five-page READY tag");
assert.match(arc1PrivateCheckout, /link_reverse_state_write_required/, "Private checkout does not require a durable Link-ID reverse mapping before activation");
assert.match(arc2, /amount_total_minor_units/, "ARC2 amount semantics are ambiguous");
assert.match(arc2, /api\.stripe\.com\/v1\/checkout\/sessions/, "ARC2 does not retrieve the authoritative Stripe session");
assert.match(arc2, /expand%5B%5D=line_items\.data\.price\.product/, "ARC2 does not retrieve expanded Price and Product line items");
assert.match(arc2, /const STRIPE_API_VERSION = "2026-07-29\.dahlia"/, "ARC2 does not pin the Stripe API version");
assert.match(arc2, /"Stripe-Version": STRIPE_API_VERSION/, "ARC2 does not send the pinned Stripe API version");
assert.match(arc2, /private_link_reverse_state/, "ARC2 does not resolve paid identity from the private Payment Link mapping");
assert.match(arc2, /required Stripe business and individual names/, "ARC2 does not require configured name collection");
assert.match(arc2, /preview_source_github_owner/, "ARC2 does not separate its public preview source identity");
// ARC Pages is an authenticated, immutable source for approved preview assets,
// never the paid delivery host. The resolver may bind exact receipt URLs only
// while rewriting them into the self-contained Netlify bundle; it must then
// reject any remaining preview-host dependency before signing artifacts.
assert.match(arc2, /arc-checkout-ready-v4/, "ARC2 does not require the post-readiness immutable five-page source tag");
assert.match(arc2, /html = html\.split\(asset\.sourceUrl\)\.join\(`\/\$\{asset\.path\}`\)/, "ARC2 does not rewrite exact signed preview asset URLs to local bundle paths");
assert.match(arc2, /arcwebhq-cpu\\\.github\\\.io\\\/arc-previews/, "ARC2 does not reject remaining preview-host dependencies before signing");
assert.match(arc2, /preview_source_commit_sha:\s*sourceCommitSha/, "ARC2 does not expose its immutable preview-source commit binding");
assert.doesNotMatch(arc2, /production_url:\s*[`"']https?:\/\/(?:[^`"']*github\.io|arcwebhq-cpu\.github\.io)/i, "ARC2 still treats ARC Pages as paid-delivery hosting");
assert.match(arc2, /session\.livemode !== stripeLiveModeEnabled/, "ARC2 does not bind livemode to the explicit mode gate");
assert.match(arc2, /https:\/\/api\.stripe\.com\/v1\/account/, "ARC2 does not verify the authenticated ARC Stripe account");
assert.match(arc2, /total must equal the \$5,000 subtotal plus completed Stripe destination tax/, "ARC2 does not verify subtotal-plus-tax arithmetic");
assert.match(arc2, /session\.automatic_tax\?\.enabled !== true \|\| session\.automatic_tax\?\.status !== "complete"/, "ARC2 does not require complete Stripe automatic tax");
assert.match(arc2, /verified Stripe destination address and applicable tax are required/, "ARC2 does not require destination-address evidence");
assert.match(arc2, /tax_registration_status: "historical_precheckout_snapshot"/, "ARC2 does not use the immutable historical tax snapshot for paid replay");
assert.match(arc2, /session\.consent\?\.terms_of_service !== "accepted"/, "ARC2 does not require checkout terms consent");
assert.match(arc2, /checkout reference v4 signature mismatch/, "ARC2 does not verify the signed checkout reference");
assert.match(arc2, /exact five-page approval manifest digest mismatch/, "ARC2 does not verify the approved-preview proof hash");
assert.match(arc2, /arc-checkout-reference-v4/, "ARC2 five-page checkout reference is not domain-separated and approval-bound");
assert.match(arc2, /whole five-page production site digest differs from the immutable v4 policy/, "ARC2 does not reject mutable same-folder five-page replacement");
assert.doesNotMatch(arc2, /inputData\.lead_route_status/, "ARC2 trusts a caller-provided lead-route status");
assert.match(arc2, /READY_FOR_CLAIMABLE_DEPLOY/, "ARC2 does not end at the claimable-deploy boundary");
assert.match(arc2, /arc2-handoff-artifact-evidence-signature-v4/, "ARC2 does not sign the five-page claimable artifact manifest");
for (const productionPath of ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"]) {
  assert.ok(arc2.includes(productionPath), `ARC2 does not bind required production path ${productionPath}`);
}
assert.match(arc2, /path: "_headers"/, "ARC2 does not emit staging privacy headers");
assert.doesNotMatch(arc2, /USAGE\.md|\.arc-handoff\.json|netlify\.toml/, "ARC2 resolver still emits legacy public handoff artifacts");
assert.match(arc2, /arc-checkout-lead-recipient-v1/, "ARC2 does not bind the private lead recipient with HMAC");
assert.doesNotMatch(arc2, /match\(\/\[a-f0-9\]\{8\}/, "ARC2 retains substring folder matching");
assert.doesNotMatch(arc2LeadRouteVerifier, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/, "Lead-route verifier is not read-only");
assert.match(arc2LeadRouteVerifier, /arc-lead-route-evidence-signature-v1/, "Lead-route verifier does not sign evidence");
assert.match(arc2LeadRouteVerifier, /current deploy file manifest/, "Lead-route verifier does not bind the exact staging source manifest");
assert.match(arc2LeadRouteVerifier, /original uploaded bytes changed/, "Lead-route verifier does not check the original uploaded source bytes");
assert.match(arc2LeadRouteVerifier, /processed staging HTML or staging-only response headers changed/, "Lead-route verifier does not check the canonical Netlify-processed response");
assert.match(arc2LeadRouteVerifier, /staging site HTML injection snippets are forbidden/, "Lead-route verifier does not reject staging injection snippets");
assert.match(arc2LeadRouteVerifier, /exactAttribute\(attrs, "action"\) !== "\/contact\/\?submitted=1"/, "Lead-route verifier does not bind the exact Contact success-state form action");
assert.match(arc2LeadRouteVerifier, /exact visible lead privacy disclosure/, "Lead-route verifier does not require the visible privacy disclosure");
assert.match(arc1PrPublisher, /send_preview_email:\s*false/, "ARC1 PR publisher can authorize preview email");
assert.match(arc1PrMerge, /requiredCheckAppId\s*=\s*15368/, "ARC1 merge does not bind the GitHub Actions app identity");
assert.match(arc1PrMerge, /merge_method:\s*["']squash["']/, "ARC1 does not squash-merge its validated PR");
assert.match(arc1EmailGate, /arc1-preview-readiness-core-signature-v2/, "ARC1 readiness core is not bound to immutable five-page preview identity");
assert.match(arc1EmailGate, /arc1-preview-readiness-observation-signature-v2/, "ARC1 five-page readiness lacks a renewable, short-lived Pages observation");
assert.match(arc1EmailGate, /send_preview_email:\s*false/, "ARC1 public readiness gate can authorize email directly");
assert.match(arc1EmailGate, /private_checkout_link_allowed:\s*false/, "ARC1 public readiness gate can expose a private checkout URL directly");
assert.match(arc1EmailGate, /checkout_url_exposure_allowed:\s*false/, "ARC1 public readiness gate can expose checkout URL material directly");
for (const [label, source] of [["publisher", arc2PrPublisher], ["merge", arc2PrMerge], ["customer control", arc2CustomerControl]]) {
  assert.match(source.split("\n").slice(0, 4).join("\n"), /ARC_LEGACY_HANDOFF_DISABLED/, `Legacy ARC2 ${label} does not fail closed before work`);
}
assert.match(arc2EmailGate, /email_claim_binding_secret/, "ARC2 delivery-email recipient claim lacks a private binding secret");
assert.match(arc2EmailGate, /durable_outbox_claim_verified:\s*true/, "ARC2 email does not require the already-durable CLAIMED outbox authority");
assert.match(arc2EmailGate, /state_write_required_before_email:\s*false/, "ARC2 email incorrectly requires a second pre-send write after the CLAIMED outbox is verified");
assert.match(arc2EmailGate, /sent_state_write_required_after_provider_ack:\s*true/, "ARC2 email does not require the post-provider SENT transition");
assert.match(arc2EmailGate, /outbox_claim_key_hmac_sha256:\s*emailClaimKeyHmacSha256/, "ARC2 email does not return the authenticated outbox key for the SENT transition");
assert.match(arc2EmailGate, /arc2-claim-state-evidence-signature-v3/, "ARC2 email lacks fresh signed deploy-and-claim send authority");
assert.match(arc2EmailGate, /netlify-deploy-and-claim-final-deploy/, "ARC2 email uses the wrong claim-state scope");
assert.match(arc2EmailGate, /artifact manifest SHA-256 mismatch/, "ARC2 email does not recompute the artifact manifest hash");
assert.match(arc2EmailGate, /arc2-payment-evidence-signature-v4/, "ARC2 email does not verify v4 five-page payment evidence");
assert.match(arc2EmailGate, /arc-private-checkout-policy-v2/, "ARC2 email does not bind the immutable five-page private checkout policy");
assert.match(arc2EmailGate, /retired_checkout_binding_keys_json/, "ARC2 email cannot verify retained checkout binding keys");
assert.match(arc2EmailGate, /recipient is not the reserved claim recipient/, "ARC2 email does not bind delivery to the reserved claim recipient");
assert.doesNotMatch(arc2EmailGate, /expected_payment_link_id|expectedPriceId|expected_product_tax_code/, "ARC2 email still depends on mutable current checkout configuration");
assert.match(arc2EmailGate, /stripe_account_id_sha256/, "ARC2 email does not bind the authenticated ARC Stripe account hash");
assert.match(arc2EmailGate, /authoritative-stripe-checkout-session/, "ARC2 email does not require authoritative Checkout Session evidence");
assert.match(arc2EmailGate, /payment_evidence_sha256/, "ARC2 email is not bound to payment evidence");
assert.doesNotMatch(arc2EmailGate, /WAITING_FOR_PAGES|pages_base_url|github\.io/i, "ARC2 email still depends on public Pages delivery");
assert.doesNotMatch(arc2EmailGate, /businessName/, "ARC2 email interpolates an unbound business name");

console.log(`Static audit passed: ${previewFiles.length}/${previewFiles.length} unlisted noindex previews, ${showcaseManifest.length} inert public showcase aliases, zero public paid-delivery artifacts, ${qaFiles.length} legacy QA sites, ${launchFixtures.length} launch fixtures, and ${v10Manifest.length} total v10 profile fixtures.`);
