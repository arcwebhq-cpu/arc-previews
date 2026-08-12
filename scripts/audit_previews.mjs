import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    if (entry.isDirectory()) files.push(...await listHtmlFiles(absolute));
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolute);
  }
  return files;
}

const allHtmlFiles = await listHtmlFiles(root);
const showcaseFileSet = new Set(showcaseManifest.map(item => path.normalize(item.file)));
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
}

assert.deepEqual(
  showcaseManifest.map(({ profile, name, sourceFile, file }) => ({ profile, name, sourceFile, file })),
  [
    {
      profile: "roofing",
      name: "Ironwood Roofing Concept",
      sourceFile: "qa-v10/ironwood-roofing-concept-a1000001/index.html",
      file: "showcases/roofing/index.html"
    },
    {
      profile: "dental",
      name: "Cedar Dental Concept",
      sourceFile: "qa-v10/cedar-dental-concept-b2000001/index.html",
      file: "showcases/dental/index.html"
    },
    {
      profile: "finance",
      name: "Clearwater Finance Concept",
      sourceFile: "qa-v10/clearwater-finance-concept-b2000010/index.html",
      file: "showcases/finance/index.html"
    }
  ],
  "The public showcase aliases changed without an explicit contract update"
);
for (const showcase of showcaseManifest) {
  const html = await readFile(path.join(root, showcase.file), "utf8");
  const sourceHtml = await readFile(path.join(root, showcase.sourceFile), "utf8");
  assert.match(sourceHtml, /data-arc-site-mode=["']preview["']/i, `${showcase.sourceFile}: private source stopped being a preview`);
  assert.match(sourceHtml, /data-arc-checkout[^>]+buy\.stripe\.com/i, `${showcase.sourceFile}: private v10 checkout contract was weakened`);
  assert.match(html, /arc-template-version["']\s+content=["']10\.0/i, `${showcase.file}: v10 marker missing`);
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*nofollow/i, `${showcase.file}: noindex/nofollow missing`);
  assert.match(html, new RegExp(`<meta\\s+name=["']arc-showcase-profile["']\\s+content=["']${showcase.profile}["']`, "i"), `${showcase.file}: showcase profile missing`);
  assert.match(html, /<meta\s+name=["']arc-site-mode["']\s+content=["']showcase["']/i, `${showcase.file}: showcase metadata mode missing`);
  assert.match(html, /data-arc-site-mode=["']showcase["']/i, `${showcase.file}: inert showcase mode missing`);
  assert.match(html, /Fictional ARC design concept — not a real business\. Checkout and lead collection are disabled\./, `${showcase.file}: visible fictional-concept disclosure missing`);
  assert.doesNotMatch(html, /<form\b|\bdata-netlify\b|\bnetlify-honeypot\b|data-arc-checkout|buy\.stripe\.com/i, `${showcase.file}: checkout or customer lead submission remained active`);
  assert.doesNotMatch(html, emailAddressPattern, `${showcase.file}: an email address leaked into showcase HTML`);
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
assert.ok(template.includes("ARC_MEDIA_MANIFEST_START v10.0"), "Master template media manifest marker missing");
assert.ok(template.includes('const previewMode=document.body.dataset.arcSiteMode!=="production"'), "Form mode is still inferred from the hosting domain");

assert.equal(v10Manifest.length, mediaManifest.profiles.length, "Every media profile must have a v10 browser fixture");
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
  const checkoutReference = new URL(fixture.checkoutUrl).searchParams.get("client_reference_id");
  const folderSuffix = fixture.folder.slice(-8);
  assert.match(checkoutReference || "", new RegExp(`^${folderSuffix}_[a-f0-9]{64}_[a-f0-9]{64}$`), `${fixture.file}: Stripe checkout is not cryptographically bound to immutable approval bytes`);
  assert.equal(checkoutReference.length, 138, `${fixture.file}: Stripe client_reference_id must use the fixed v2 length`);
  assert.equal(new URL(fixture.checkoutUrl).origin, "https://buy.stripe.com", `${fixture.file}: checkout host is not Stripe`);
  assert.match(new URL(fixture.checkoutUrl).pathname, /^\/test_[A-Za-z0-9]+$/, `${fixture.file}: checkout is not a test-mode Payment Link`);
  assert.ok(html.includes(`client_reference_id=${checkoutReference}`), `${fixture.file}: bound Stripe URL was not rendered`);
}
assert.equal(launchCompositions.size, 5, "The five launch niches must use five distinct layout/variant compositions");

const validator = await readFile(path.join(root, "arc_step7_validator.js"), "utf8");
const contentSanitizer = await readFile(path.join(root, "scripts/content_sanitizer.mjs"), "utf8");
const arc1 = await readFile(path.join(root, "zapier/arc1_inject.js"), "utf8");
const arc1PaymentLink = await readFile(path.join(root, "zapier/arc1_verify_payment_link.js"), "utf8");
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
for (const source of [arc1, arc1PaymentLink, arc2, arc1PrPublisher, arc1PrMerge, arc1EmailGate, arc2LeadRouteVerifier, arc2PrPublisher, arc2PrMerge, arc2EmailGate, arc2CustomerControl]) {
  new Function("inputData", "fetch", "Buffer", `return (async () => {${source}})()`);
}
assert.ok(validator.includes("customer_email_not_exposed_pass"), "Validator does not block requester-email exposure");
assert.ok(validator.includes("private_preview_metadata_pass"), "Validator does not enforce private previews");
assert.ok(validator.includes("dummy_link_pass"), "Validator does not reject dummy external CTAs");
assert.ok(validator.includes("generated_media_ownership_pass"), "Validator does not reject unowned AI-selected media");
assert.ok(validator.includes("semantic_media_profile_pass"), "Validator does not enforce semantic media selection");
assert.ok(validator.includes("scalar_render_escaping_pass"), "Validator does not attest scalar escaping");
assert.ok(contentSanitizer.includes("sanitizeStructuredMarkup"), "Typed structured-markup sanitizer is missing");
assert.ok(contentSanitizer.includes("generated class is not allowlisted"), "Generated classes are not fail-closed");
assert.ok(contentSanitizer.includes("form action must stay same-origin"), "Generated forms can escape same-origin routing");
assert.doesNotMatch(template, /"(?:name|description|areaServed)"\s*:\s*"\[\[/, "Raw placeholders remain inside executable JSON-LD JavaScript");
assert.match(arc1, /Scalar fields are HTML-escaped/, "Zapier ARC1 does not document its untrusted-content boundary");
assert.match(arc1, /sanitizeMarkup/, "Zapier ARC1 does not use the typed structured-markup sanitizer");
assert.match(arc1, /verifiedAssetUrl\.search/, "Zapier ARC1 can publish a signed customer-upload URL containing query credentials or PII");
assert.match(arc1, /generated class is not allowlisted/, "Zapier ARC1 generated classes are not fail-closed");
assert.doesNotMatch(arc1, /payment_link_url\s*\|\|\s*["']https:\/\/buy\.stripe\.com/i, "ARC1 retains a default live Payment Link");
assert.match(arc1, /test-mode Payment Link/, "ARC1 does not require a test-mode Payment Link");
assert.match(arc1, /payment_link_evidence_private/, "ARC1 does not require signed Payment Link preflight evidence");
assert.match(arc1, /paymentLinkEvidenceIssuedMs<Date\.now\(\)-5\*60\*1000/, "ARC1 accepts stale Payment Link preflight evidence");
assert.match(arc1, /checkout_binding_secret/, "ARC1 does not cryptographically bind checkout to the preview folder");
assert.match(arc1, /HMAC/, "ARC1 checkout binding is not HMAC based");
assert.match(arc1, /arc-checkout-reference-v2/, "ARC1 checkout reference is not domain-separated");
assert.match(arc1, /`\$\{submissionPrefix\}_\$\{approvalContentSha256\}_\$\{checkoutBinding\}`/, "ARC1 does not bind immutable approval bytes in Stripe-safe syntax");
assert.match(arc1PaymentLink, /Stripe-Version": "2026-06-24\.dahlia"/, "ARC1 Payment Link preflight does not pin the Stripe API version");
assert.match(arc1PaymentLink, /expand%5B%5D=line_items\.data\.price/, "ARC1 Payment Link preflight does not expand the exact line item Price");
assert.match(arc1PaymentLink, /adultpurchaserack/, "ARC1 Payment Link preflight uses an invalid or stale custom-field key");
assert.match(arc1PaymentLink, /price\.active !== true/, "ARC1 Payment Link preflight does not require an active Price before checkout exposure");
assert.match(arc1PaymentLink, /paymentLink\.payment_method_types != null/, "ARC1 Payment Link preflight does not preserve dynamic payment methods");
assert.match(arc1PaymentLink, /redirectUrl !== expectedRedirectUrl/, "ARC1 Payment Link preflight does not bind the exact success redirect");
assert.match(arc1PaymentLink, /https:\/\/arcweb\.onl\/payment-success\/\?session_id=\{CHECKOUT_SESSION_ID\}/, "ARC1 Payment Link preflight does not pin the static ARC payment-success URL");
assert.match(arc2, /amount_total_minor_units/, "ARC2 amount semantics are ambiguous");
assert.match(arc2, /api\.stripe\.com\/v1\/checkout\/sessions/, "ARC2 does not retrieve the authoritative Stripe session");
assert.match(arc2, /expand%5B%5D=line_items/, "ARC2 does not retrieve expanded line items");
assert.match(arc2, /Stripe-Version": "2026-06-24\.dahlia"/, "ARC2 does not pin the Stripe API version");
assert.match(arc2, /expectedPriceId/, "ARC2 does not bind fulfillment to one configured Price");
assert.match(arc2, /required Stripe business and individual names/, "ARC2 does not require configured name collection");
assert.match(arc2, /preview_source_github_owner/, "ARC2 does not separate its public preview source identity");
assert.doesNotMatch(arc2, /github\.io|pages_base_url|production_url:/i, "ARC2 still treats ARC Pages as paid-delivery hosting");
assert.match(arc2, /livemode must be false/, "ARC2 does not reject live mode");
assert.match(arc2, /terms_of_service consent must be accepted/, "ARC2 does not require checkout terms consent");
assert.match(arc2, /checkout reference signature mismatch/, "ARC2 does not verify the signed checkout reference");
assert.match(arc2, /approved preview proof hash mismatch/, "ARC2 does not verify the approved-preview proof hash");
assert.match(arc2, /arc-checkout-reference-v2/, "ARC2 checkout reference is not domain-separated and approval-bound");
assert.match(arc2, /approved preview bytes do not match the checkout approval digest/, "ARC2 does not reject mutable same-folder preview replacement");
assert.doesNotMatch(arc2, /inputData\.lead_route_status/, "ARC2 trusts a caller-provided lead-route status");
assert.match(arc2, /READY_FOR_CLAIMABLE_DEPLOY/, "ARC2 does not end at the claimable-deploy boundary");
assert.match(arc2, /arc2-handoff-artifact-evidence-signature-v1/, "ARC2 does not sign the claimable artifact manifest");
assert.match(arc2, /productionPath = "index\.html"/, "ARC2 production HTML is not a root deploy artifact");
assert.match(arc2, /path: "_headers"/, "ARC2 does not emit staging privacy headers");
assert.doesNotMatch(arc2, /USAGE\.md|\.arc-handoff\.json|netlify\.toml/, "ARC2 resolver still emits legacy public handoff artifacts");
assert.match(arc2, /arc-lead-route-recipient-v1/, "ARC2 does not bind the private lead recipient with HMAC");
assert.doesNotMatch(arc2, /match\(\/\[a-f0-9\]\{8\}/, "ARC2 retains substring folder matching");
assert.doesNotMatch(arc2LeadRouteVerifier, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/, "Lead-route verifier is not read-only");
assert.match(arc2LeadRouteVerifier, /arc-lead-route-evidence-signature-v1/, "Lead-route verifier does not sign evidence");
assert.match(arc2LeadRouteVerifier, /current deploy file manifest/, "Lead-route verifier does not bind the exact staging source manifest");
assert.match(arc2LeadRouteVerifier, /original uploaded bytes changed/, "Lead-route verifier does not check the original uploaded source bytes");
assert.match(arc2LeadRouteVerifier, /processed staging HTML or staging-only response headers changed/, "Lead-route verifier does not check the canonical Netlify-processed response");
assert.match(arc2LeadRouteVerifier, /staging site HTML injection snippets are forbidden/, "Lead-route verifier does not reject staging injection snippets");
assert.match(arc2LeadRouteVerifier, /sourceFormAttributes\?\.get\("action"\) !== "\/\?submitted=1"/, "Lead-route verifier does not bind the exact success-state form action");
assert.match(arc2LeadRouteVerifier, /exact visible lead privacy disclosure/, "Lead-route verifier does not require the visible privacy disclosure");
assert.match(arc1PrPublisher, /send_preview_email:\s*false/, "ARC1 PR publisher can authorize preview email");
assert.match(arc1PrMerge, /requiredCheckAppId\s*=\s*15368/, "ARC1 merge does not bind the GitHub Actions app identity");
assert.match(arc1PrMerge, /merge_method:\s*["']squash["']/, "ARC1 does not squash-merge its validated PR");
assert.match(arc1EmailGate, /arc-preview-email-v1/, "ARC1 preview-email claim is not bound to immutable preview identity");
assert.doesNotMatch(arc1EmailGate, /sha256Hex\(`\$\{emailStateToken\}/, "ARC1 preview-email claim still depends on a rotatable caller token");
for (const [label, source] of [["publisher", arc2PrPublisher], ["merge", arc2PrMerge], ["customer control", arc2CustomerControl]]) {
  assert.match(source.split("\n").slice(0, 4).join("\n"), /ARC_LEGACY_HANDOFF_DISABLED/, `Legacy ARC2 ${label} does not fail closed before work`);
}
assert.match(arc2EmailGate, /email_claim_binding_secret/, "ARC2 delivery-email recipient claim lacks a private binding secret");
assert.match(arc2EmailGate, /state_write_required_before_email:\s*true/, "ARC2 email can bypass the private durable state write");
assert.match(arc2EmailGate, /arc2-claim-state-evidence-signature-v1/, "ARC2 email lacks signed deploy-and-claim state evidence");
assert.match(arc2EmailGate, /netlify-deploy-and-claim-final-deploy/, "ARC2 email uses the wrong claim-state scope");
assert.match(arc2EmailGate, /artifact manifest SHA-256 mismatch/, "ARC2 email does not recompute the artifact manifest hash");
assert.match(arc2EmailGate, /exact Payment Link, Price, and static terms version/, "ARC2 email does not independently bind exact Stripe configuration");
assert.match(arc2EmailGate, /payment_evidence_sha256/, "ARC2 email is not bound to payment evidence");
assert.doesNotMatch(arc2EmailGate, /WAITING_FOR_PAGES|pages_base_url|github\.io/i, "ARC2 email still depends on public Pages delivery");
assert.doesNotMatch(arc2EmailGate, /businessName/, "ARC2 email interpolates an unbound business name");

console.log(`Static audit passed: ${previewFiles.length}/${previewFiles.length} unlisted noindex previews, ${showcaseManifest.length} inert public showcase aliases, zero public paid-delivery artifacts, ${qaFiles.length} legacy QA sites, ${launchFixtures.length} launch fixtures, and ${v10Manifest.length} total v10 profile fixtures.`);
