import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { fixtures } from "../fixtures/v11_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v11_media_coverage.mjs";
import { finalizeV11ProductionSite } from "../scripts/v11_production_finalizer.mjs";
import { canonicalJson } from "../scripts/v11_site_contract.mjs";
import { createTestIntakeEvidence } from "./fixtures/intake_evidence.mjs";
import { createTestPaymentLinkEvidence } from "./fixtures/payment_link_evidence.mjs";

const root = new URL("../", import.meta.url);
const [injectorSource, template, legacyTemplate] = await Promise.all([
  readFile(new URL("zapier/arc1_inject.js", root), "utf8"),
  readFile(new URL("ARC_MASTER_TEMPLATE_V11.html", root), "utf8"),
  readFile(new URL("ARC_MASTER_TEMPLATE.html", root), "utf8")
]);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runInjector = new AsyncFunction("inputData", injectorSource);
const allFixtures = [...fixtures, ...mediaCoverageFixtures];
const checkoutBindingSecret = "checkout-binding-secret-unique-0123456789";
const deliverable = "fixed-five-page-marketing-website-v1";
const offerContractId = "arc-fixed-five-page-offer-v1";
const logicalPaths = ["index.html", "services/index.html", "about/index.html", "process/index.html", "contact/index.html"];
const artifactPaths = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"];
const sha256 = value => createHash("sha256").update(value).digest("hex");
const hmac = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");

function boundedJpeg(size, fill) {
  const prefix = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00
  ]);
  assert.ok(size > prefix.length + 2);
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.length - 2, fill), Buffer.from([0xff, 0xd9])], size);
}

function injectorInput(fixture, {
  content = fixture.content,
  selectedTemplate = template,
  assetManifest = [],
  assetUrls = {},
  intakeOptions = {},
  privateLeadEmail = `private-leads-${fixture.expectedProfile}@example.test`
} = {}) {
  const intake = createTestIntakeEvidence({
    assetManifest,
    businessName: content.BUSINESS_NAME,
    ...intakeOptions,
    submissionDataSha256: sha256(canonicalJson(content))
  });
  const receiptUrls = Object.fromEntries(JSON.parse(intake.privateInputs.asset_publication_receipt_private).entries
    .map(entry => [entry.role, entry.public_url]));
  const payment = createTestPaymentLinkEvidence();
  return {
    input: {
      template_content: selectedTemplate,
      raw_json: JSON.stringify(content),
      customer_email: fixture.customerEmail,
      private_claim_recipient_email: fixture.customerEmail,
      private_lead_notification_email: privateLeadEmail,
      private_contact_phone: "+1 (206) 555-0188",
      private_contact_address: "123 Private Intake Way, Seattle WA 98101",
      checkout_binding_secret: checkoutBindingSecret,
      checkout_binding_key_id: "01",
      logo_file_url: assetUrls.logo_file || receiptUrls.logo_file || "",
      hero_image_url: assetUrls.hero_image_file || receiptUrls.hero_image_file || "",
      supporting_image_url: assetUrls.supporting_image_file || receiptUrls.supporting_image_file || "",
      ...intake.privateInputs,
      ...payment.privateInputs
    },
    intake,
    payment
  };
}

function finalizedFromBundle(bundle, assets = []) {
  const rendered = {
    contractVersion: bundle.site_contract_version,
    templateVersion: bundle.template_version,
    folder: bundle.preview_folder,
    pageCount: bundle.page_count,
    pages: bundle.pages.map(page => ({
      key: page.key,
      label: page.label,
      path: page.path,
      approvalHtml: page.approval_html,
      approvalSha256: page.approval_sha256,
      html: page.published_html
    })),
    approvalManifest: bundle.approval_manifest,
    approvalManifestJson: canonicalJson(bundle.approval_manifest),
    approvalBundleSha256: bundle.approval_manifest_sha256
  };
  const options = { assets };
  if (assets.length) {
    options.assetReview = {
      version: "arc-customer-image-visual-review-v1",
      scope: "human-visible-watermark-and-rights-review",
      decision: "APPROVED_FOR_PUBLICATION",
      reviewer_type: "AUTHORIZED_HUMAN",
      reviewer_id_sha256: "a".repeat(64),
      policy_version: "arc-image-provenance-policy-v1",
      review_method: "HUMAN_VISUAL_INSPECTION_FULL_RESOLUTION",
      review_validity: "CONTENT_DIGEST_BOUND_NO_EXPIRY",
      automated_screening: "PASSED_DETERMINISTIC_INDICATORS_ONLY",
      automated_screening_version: "arc-deterministic-image-screen-v1",
      pixel_level_watermark_certainty: false,
      watermark_free_guarantee: false,
      reviewed_at: "2026-08-25T11:30:00.000Z",
      rights_basis: "CUSTOMER_CONFIRMED_OWNERSHIP_OR_LICENSE",
      filename_screening: "PASSED_OR_UNAVAILABLE_FROM_FIRST_PARTY_INTAKE",
      source_host_screening: "HTTPS_SYNTAX_AND_STOCK_HOST_DENYLIST_SCREENED",
      visible_watermark_screening: "NO_VISIBLE_WATERMARK_FOUND",
      stock_preview_screening: "NO_VISIBLE_STOCK_PREVIEW_MARKER_FOUND",
      assets: assets.map(asset => ({
        content_type: asset.path.endsWith(".png") ? "image/png" : asset.path.endsWith(".jpg") ? "image/jpeg" : "image/webp",
        path: asset.path,
        sha256: asset.path.match(/assets\/([a-f0-9]{64})\./)[1]
      })).sort((left, right) => left.path.localeCompare(right.path))
    };
  }
  return finalizeV11ProductionSite(rendered, options);
}

function assertCanonical(raw) {
  const parsed = JSON.parse(raw);
  assert.equal(canonicalJson(parsed), raw);
  return parsed;
}

function exactArtifactPreviewPaths(folder) {
  return artifactPaths.map(pagePath => `${folder}/${pagePath}`);
}

execFileSync(process.execPath, [new URL("scripts/build_arc1_inject_v11_runtime.mjs", root).pathname, "--check"], {
  cwd: new URL(".", root).pathname,
  stdio: "pipe"
});
assert.equal(allFixtures.length, 19);
assert.equal(new Set(allFixtures.map(fixture => fixture.expectedProfile)).size, 19);
assert.doesNotMatch(injectorSource, /\bhtml_content\b|\bfile_path\b/,
  "the active injector source must not expose the legacy one-page handoff names");

for (const malformedEntries of [null, {}]) {
  const malformed = injectorInput(fixtures[0]);
  const receipt = JSON.parse(malformed.input.asset_publication_receipt_private);
  receipt.entries = malformedEntries;
  const receiptRaw = canonicalJson(receipt);
  malformed.input.asset_publication_receipt_private = receiptRaw;
  malformed.input.asset_publication_receipt_sha256 = sha256(receiptRaw);
  malformed.input.asset_publication_receipt_hmac_sha256 = hmac(
    malformed.input.asset_publication_receipt_secret,
    `arc1-public-asset-publication-receipt-v1\n${receiptRaw}`
  );
  await assert.rejects(runInjector(malformed.input), /ARC1_ASSET_PUBLICATION_INVALID: exact publication receipt binding/,
    "malformed publication entries must fail with a controlled ARC error before any length access");
}

for (const fixture of allFixtures) {
  assert.equal(Object.keys(fixture.content).length, 58, `${fixture.expectedProfile}: exact candidate key count`);
  const prepared = injectorInput(fixture);
  const output = await runInjector(prepared.input);
  const repeated = await runInjector(prepared.input);
  assert.deepEqual(output, repeated, `${fixture.expectedProfile}: exact replay must be deterministic`);
  assert.equal(Object.hasOwn(output, "html_content"), false);
  assert.equal(Object.hasOwn(output, "file_path"), false);
  assert.equal(output.page_count, 5);
  assert.equal(output.offer_contract_id, offerContractId);
  assert.equal(output.deliverable, deliverable);
  assert.deepEqual(output.preview_paths, exactArtifactPreviewPaths(output.preview_folder));
  assert.equal(output.preview_paths_json, canonicalJson(output.preview_paths));
  assert.equal(output.logical_page_paths_json, canonicalJson(logicalPaths));
  assert.equal(output.template_comment, "ARC Client Master Template v11.0");
  assert.equal(output.expected_media_profile, fixture.expectedProfile);

  const bundle = assertCanonical(output.render_bundle_private);
  assert.equal(output.render_bundle_sha256, sha256(output.render_bundle_private));
  assert.equal(bundle.version, "arc1-five-page-render-bundle-v1");
  assert.equal(bundle.scope, "private-sanitized-five-page-preview-render");
  assert.equal(bundle.offer_contract_id, offerContractId);
  assert.equal(bundle.deliverable, deliverable);
  assert.equal(bundle.page_count, 5);
  assert.deepEqual(bundle.logical_page_paths, logicalPaths);
  assert.deepEqual(bundle.preview_paths, exactArtifactPreviewPaths(bundle.preview_folder));
  assert.deepEqual(bundle.pages.map(page => page.path), logicalPaths);
  assert.equal(new Set(bundle.pages.map(page => page.repository_path)).size, 5);
  assert.deepEqual(bundle.pages.map(page => page.repository_path), logicalPaths.map(pagePath => `${bundle.preview_folder}/${pagePath}`));
  assert.equal(bundle.approval_manifest_sha256, sha256(canonicalJson(bundle.approval_manifest)));
  assert.equal(bundle.approval_manifest_sha256, output.approval_content_sha256);
  assert.equal(bundle.published_preview_bundle_sha256, sha256(canonicalJson(bundle.published_preview_manifest)));
  assert.equal(bundle.published_preview_bundle_sha256, output.published_preview_bundle_sha256);
  assert.equal(bundle.production_content_sha256, output.production_content_sha256);
  assert.equal(bundle.lead_route_mode, "netlify_form");
  assert.equal(bundle.lead_route_form_name, `${fixture.expectedProfile}-lead`);

  const privateNeedles = [
    fixture.customerEmail,
    prepared.input.private_lead_notification_email,
    prepared.input.private_contact_phone,
    prepared.input.private_contact_address,
    "buy.stripe.com",
    "arc-checkout-offer-snapshot-v2",
    "arc1-checkout-recipient-reservation-v2"
  ].map(value => value.toLowerCase());
  let siteFormCount = 0;
  for (const page of bundle.pages) {
    assert.equal(page.approval_sha256, sha256(page.approval_html), `${fixture.expectedProfile}/${page.path}: approval hash`);
    assert.equal(page.published_sha256, sha256(page.published_html), `${fixture.expectedProfile}/${page.path}: published hash`);
    assert.equal(page.approval_size, Buffer.byteLength(page.approval_html, "utf8"));
    assert.equal(page.published_size, Buffer.byteLength(page.published_html, "utf8"));
    assert.ok(page.approval_size <= 150_000 && page.published_size <= 150_000);
    assert.match(page.approval_html, /<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/);
    assert.doesNotMatch(page.approval_html, /<aside\b[^>]*arc-preview-toolbar/i);
    assert.equal((page.published_html.match(/<aside class="arc-preview-toolbar"/g) || []).length, 1);
    assert.equal((page.published_html.match(/<nav class="nav-links"/g) || []).length, 1);
    const forms = page.approval_html.match(/<form\b/gi) || [];
    siteFormCount += forms.length;
    assert.equal(forms.length, page.path === "contact/index.html" ? 1 : 0);
    const lowerPages = `${page.approval_html}\n${page.published_html}`.toLowerCase();
    for (const needle of privateNeedles) assert.equal(lowerPages.includes(needle), false,
      `${fixture.expectedProfile}/${page.path}: private checkout or recipient data escaped`);
  }
  assert.equal(siteFormCount, 1);
  assert.ok(bundle.pages.reduce((total, page) => total + page.approval_size, 0) <= 500_000);
  assert.ok(bundle.pages.reduce((total, page) => total + page.published_size, 0) <= 500_000);

  const finalized = finalizedFromBundle(bundle);
  assert.equal(finalized.productionContentSha256, output.production_content_sha256,
    `${fixture.expectedProfile}: injector and finalizer production digests`);
  for (const page of bundle.pages) {
    const production = finalized.pages.find(item => item.path === page.path);
    assert.equal(page.production_sha256, production.sha256);
    assert.equal(page.production_size, production.size);
  }

  const snapshot = assertCanonical(output.checkout_offer_snapshot_private);
  assert.equal(output.checkout_offer_snapshot_sha256, sha256(output.checkout_offer_snapshot_private));
  assert.equal(output.checkout_offer_snapshot_hmac_sha256,
    hmac(checkoutBindingSecret, `arc-checkout-offer-snapshot-signature-v2\ntest\n${output.checkout_offer_snapshot_private}`));
  assert.equal(snapshot.version, "arc-checkout-offer-snapshot-v2");
  assert.equal(snapshot.scope, "immutable-approved-five-page-preview-private-checkout-offer");
  assert.equal(snapshot.offer_contract_id, offerContractId);
  assert.equal(snapshot.deliverable, deliverable);
  assert.equal(snapshot.page_count, 5);
  assert.deepEqual(snapshot.preview_paths, exactArtifactPreviewPaths(output.preview_folder));
  assert.equal(snapshot.approval_content_sha256, output.approval_content_sha256);
  assert.equal(snapshot.published_preview_bundle_sha256, output.published_preview_bundle_sha256);
  assert.equal(snapshot.production_content_sha256, output.production_content_sha256);
  assert.equal(snapshot.render_bundle_sha256, output.render_bundle_sha256);

  const reservation = assertCanonical(output.checkout_recipient_reservation_private);
  assert.equal(output.checkout_recipient_reservation_sha256, sha256(output.checkout_recipient_reservation_private));
  assert.equal(output.checkout_recipient_reservation_hmac_sha256,
    hmac(checkoutBindingSecret, `arc1-checkout-recipient-reservation-signature-v2\ntest\n${output.checkout_recipient_reservation_private}`));
  assert.equal(reservation.version, "arc1-checkout-recipient-reservation-v2");
  assert.equal(reservation.offer_contract_id, offerContractId);
  assert.equal(reservation.deliverable, deliverable);
  assert.equal(reservation.lead_notification_email, prepared.input.private_lead_notification_email);
  assert.equal(reservation.claim_recipient_email, fixture.customerEmail);
  assert.equal(reservation.production_content_sha256, output.production_content_sha256);

  const renderEvidence = assertCanonical(output.render_evidence_private);
  assert.equal(output.render_evidence_hmac_sha256,
    hmac(prepared.intake.privateInputs.intake_evidence_secret, `arc1-render-evidence-signature-v2\n${output.render_evidence_private}`));
  assert.equal(renderEvidence.version, "arc1-render-evidence-v2");
  assert.equal(renderEvidence.scope, "signed-sanitized-five-page-preview-render");
  assert.equal(renderEvidence.render_bundle_sha256, output.render_bundle_sha256);
  assert.equal(renderEvidence.content_sha256, output.published_preview_bundle_sha256);
  assert.equal(renderEvidence.production_content_sha256, output.production_content_sha256);
}

const referenceFixture = fixtures[0];
const referencePrepared = injectorInput(referenceFixture);
const referenceOutput = await runInjector(referencePrepared.input);
const referenceBundle = JSON.parse(referenceOutput.render_bundle_private);
const changedContent = {
  ...referenceFixture.content,
  ABOUT_BODY: `${referenceFixture.content.ABOUT_BODY}<p>A secondary-page change must alter every whole-site binding.</p>`
};
const changedOutput = await runInjector(injectorInput(referenceFixture, { content: changedContent }).input);
const changedBundle = JSON.parse(changedOutput.render_bundle_private);
assert.equal(referenceBundle.pages.find(page => page.path === "index.html").approval_sha256,
  changedBundle.pages.find(page => page.path === "index.html").approval_sha256,
  "the secondary-page regression must keep Home unchanged");
for (const field of ["approval_content_sha256", "published_preview_bundle_sha256", "production_content_sha256", "render_bundle_sha256"]) {
  assert.notEqual(referenceOutput[field], changedOutput[field], `${field} must bind secondary-page changes`);
}
const tamperedBundle = structuredClone(referenceBundle);
tamperedBundle.pages.find(page => page.path === "about/index.html").approval_html = tamperedBundle.pages
  .find(page => page.path === "about/index.html").approval_html.replace("</body>", "<p>tampered</p></body>");
assert.notEqual(sha256(canonicalJson(tamperedBundle)), referenceOutput.render_bundle_sha256,
  "private-bundle secondary-page tampering must invalidate its digest");

const externalContent = {
  ...referenceFixture.content,
  CONTACT_ACTION_HTML: '<a href="https://booking.example.test/start">Book through the verified scheduling service</a>'
};
const externalPrepared = injectorInput(referenceFixture, { content: externalContent, privateLeadEmail: "" });
const externalOutput = await runInjector(externalPrepared.input);
const externalBundle = JSON.parse(externalOutput.render_bundle_private);
assert.equal(externalOutput.lead_route_mode, "not_required");
assert.equal(externalOutput.lead_route_form_name, "");
assert.equal(externalBundle.pages.some(page => /<form\b/i.test(page.approval_html)), false);
const externalReservation = JSON.parse(externalOutput.checkout_recipient_reservation_private);
assert.equal(externalReservation.lead_notification_email, "");
assert.equal(externalReservation.lead_route_recipient_hmac_sha256, "");

const imageBytes = boundedJpeg(512, 0x45);
const imageDigest = sha256(imageBytes);
const assetManifest = [{
  asset_id: sha256("arc-test-logo-asset"),
  content_type: "image/jpeg",
  kind: "UPLOAD",
  retrieval_endpoint_sha256: sha256("https://arcweb.onl/internal/intake/arc1/assets/retrieve"),
  role: "logo_file",
  sha256: imageDigest,
  size_bytes: imageBytes.length
}];
const mediaReceivedAt = new Date(Date.now() - 60_000).toISOString();
const provisionalMediaIntake = createTestIntakeEvidence({
  assetManifest,
  businessName: referenceFixture.content.BUSINESS_NAME,
  receivedAt: mediaReceivedAt
});
const imageUrl = JSON.parse(provisionalMediaIntake.privateInputs.asset_publication_receipt_private).entries[0].public_url;
const mediaContent = {
  ...referenceFixture.content,
  LOGO_HTML: `<img src="${imageUrl}" alt="Customer-supplied logo">`
};
const mediaPrepared = injectorInput(referenceFixture, {
  content: mediaContent,
  assetManifest,
  intakeOptions: { receivedAt: mediaReceivedAt }
});
const mediaOutput = await runInjector(mediaPrepared.input);
const mediaBundle = JSON.parse(mediaOutput.render_bundle_private);
assert.equal(mediaBundle.pages.every(page => page.approval_html.includes(imageUrl)), true,
  "the uploaded logo URL must map across the complete preview bundle");
assert.equal(mediaBundle.pages.every(page => /data-arc-media-provider="customer-upload"/.test(page.approval_html)), true);
const mediaFinalized = finalizedFromBundle(mediaBundle, [{
  path: `assets/${imageDigest}.jpg`,
  bytes: imageBytes,
  sourceUrl: imageUrl
}]);
assert.equal(mediaFinalized.productionContentSha256, mediaOutput.production_content_sha256,
  "uploaded asset root mapping must produce the same finalizer whole-site digest");

const oversizedSingleBytes = 1_250_001;
const oversizedSingleUrl = "https://uploads.example.test/oversized.jpg";
const oversizedSingleManifest = [{
  asset_id: sha256("arc-test-oversized-logo"), content_type: "image/jpeg", kind: "UPLOAD",
  retrieval_endpoint_sha256: sha256("https://arcweb.onl/internal/intake/arc1/assets/retrieve"),
  role: "logo_file", sha256: "a".repeat(64), size_bytes: oversizedSingleBytes
}];
await assert.rejects(runInjector(injectorInput(referenceFixture, {
  content: { ...referenceFixture.content, LOGO_HTML: `<img src="${oversizedSingleUrl}" alt="Logo">` },
  assetManifest: oversizedSingleManifest,
  assetUrls: { logo_file: oversizedSingleUrl }
}).input), /asset URL\/hash\/type\/size binding/i);

const aggregateUrls = {
  logo_file: "https://uploads.example.test/aggregate-logo.jpg",
  hero_image_file: "https://uploads.example.test/aggregate-hero.jpg",
  supporting_image_file: "https://uploads.example.test/aggregate-support.jpg"
};
const aggregateManifest = ["hero_image_file", "logo_file", "supporting_image_file"].map((role, index) => ({
  asset_id: sha256(`arc-test-aggregate-${role}`), content_type: "image/jpeg", kind: "UPLOAD",
  retrieval_endpoint_sha256: sha256("https://arcweb.onl/internal/intake/arc1/assets/retrieve"),
  role, sha256: String(index + 1).repeat(64), size_bytes: 1_000_001
}));
await assert.rejects(runInjector(injectorInput(referenceFixture, {
  assetManifest: aggregateManifest
}).input), /production-safe asset caps/i);

const pageOversizedTemplate = template.replace("</head>", `<!--${"p".repeat(130_000)}--></head>`);
await assert.rejects(runInjector(injectorInput(referenceFixture, {
  selectedTemplate: pageOversizedTemplate
}).input), /150000-byte page cap/i);
const aggregateOversizedTemplate = template.replace("</head>", `<!--${"a".repeat(82_000)}--></head>`);
await assert.rejects(runInjector(injectorInput(referenceFixture, {
  selectedTemplate: aggregateOversizedTemplate
}).input), /aggregate exceeds 500000/i);
await assert.rejects(runInjector(injectorInput(referenceFixture, {
  selectedTemplate: legacyTemplate
}).input), /ARC_V11_TEMPLATE_INVALID/);
const extraKeyContent = { ...referenceFixture.content, LEGACY_SINGLE_PAGE_OVERRIDE: "forbidden" };
await assert.rejects(runInjector(injectorInput(referenceFixture, {
  content: extraKeyContent
}).input), /ARC_CONTRACT_INVALID/);

console.log("ARC1 v11 injector contract passed: 19 profiles, exact five-page private bundle, form/no-form routes, uploaded assets, whole-site digests, caps, tamper sensitivity, and no legacy singular outputs.");
