import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

import { fixtures } from "../fixtures/v11_industries.mjs";
import { canonicalJson } from "../scripts/v11_site_contract.mjs";
import { createTestIntakeEvidence } from "./fixtures/intake_evidence.mjs";
import { createTestCheckoutOfferEvidence } from "./fixtures/checkout_offer_evidence.mjs";

const root = new URL("../", import.meta.url);
const [injectorSource, validatorSource, template] = await Promise.all([
  readFile(new URL("zapier/arc1_inject.js", root), "utf8"),
  readFile(new URL("zapier/arc1_validate_v11_bundle.js", root), "utf8"),
  readFile(new URL("ARC_MASTER_TEMPLATE_V11.html", root), "utf8")
]);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runInjector = new AsyncFunction("inputData", injectorSource);
const runValidator = new AsyncFunction("inputData", validatorSource);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const hmac = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");
const checkoutBindingSecret = "checkout-binding-secret-unique-0123456789";
const toolbar = '<aside class="arc-preview-toolbar" aria-label="ARC preview status"><span><strong>ARC preview</strong>Five-page website concept for this business.</span><span data-arc-checkout-private>Review and payment are available through your private review link.</span></aside>';

function injectorInput(fixture, { content = fixture.content, assetManifest = [], intakeOptions = {} } = {}) {
  const intake = createTestIntakeEvidence({
    assetManifest,
    businessName: content.BUSINESS_NAME,
    ...intakeOptions,
    submissionDataSha256: sha256(canonicalJson(content))
  });
  const payment = createTestCheckoutOfferEvidence();
  const receiptUrls = Object.fromEntries(JSON.parse(intake.privateInputs.asset_publication_receipt_private).entries
    .map(entry => [entry.role, entry.public_url]));
  return {
    template_content: template,
    raw_json: JSON.stringify(content),
    customer_email: fixture.customerEmail,
    private_claim_recipient_email: fixture.customerEmail,
    private_lead_notification_email: `private-leads-${fixture.expectedProfile}@example.test`,
    private_contact_phone: "+1 (206) 555-0188",
    private_contact_address: "123 Private Intake Way, Seattle WA 98101",
    checkout_binding_secret: checkoutBindingSecret,
    checkout_binding_key_id: "01",
    logo_file_url: receiptUrls.logo_file || "",
    hero_image_url: receiptUrls.hero_image_file || "",
    supporting_image_url: receiptUrls.supporting_image_file || "",
    ...intake.privateInputs,
    ...payment.privateInputs
  };
}

function boundedJpeg(size, fill) {
  const prefix = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00
  ]);
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.length - 2, fill), Buffer.from([0xff, 0xd9])], size);
}

function withRebuiltBundle(output, mutate) {
  const bundle = structuredClone(JSON.parse(output.render_bundle_private));
  mutate(bundle);
  const renderBundlePrivate = canonicalJson(bundle);
  return {
    ...output,
    render_bundle_private: renderBundlePrivate,
    render_bundle_sha256: sha256(renderBundlePrivate)
  };
}

function injectPublicMarkup(output, pagePath, markup) {
  return withRebuiltBundle(output, bundle => {
    const page = bundle.pages.find(item => item.path === pagePath);
    page.approval_html = page.approval_html.replace("</main>", `${markup}</main>`);
    page.approval_size = Buffer.byteLength(page.approval_html, "utf8");
    page.approval_sha256 = sha256(page.approval_html);
    page.published_html = page.approval_html.replace("</body>\n</html>\n", `${toolbar}\n</body>\n</html>\n`);
    page.published_size = Buffer.byteLength(page.published_html, "utf8");
    page.published_sha256 = sha256(page.published_html);
  });
}

const fixture = fixtures[0];
const injectorInputs = injectorInput(fixture);
const output = await runInjector(injectorInputs);
const validated = await runValidator(output);
const expectedValidationReceiptSha256 = sha256(canonicalJson({
  version: "arc1-v11-bundle-validation-receipt-v1",
  scope: "log-safe-exact-five-page-validation",
  validator_version: "arc1-v11-five-page-bundle-validator-v1",
  validation_result: "PASSED",
  page_count: 5,
  preview_folder: output.preview_folder,
  preview_paths: JSON.parse(output.preview_paths_json),
  render_bundle_sha256: output.render_bundle_sha256,
  approval_content_sha256: output.approval_content_sha256,
  published_preview_bundle_sha256: output.published_preview_bundle_sha256,
  production_content_sha256: output.production_content_sha256,
  asset_manifest_sha256: output.asset_manifest_sha256,
  asset_publication_receipt_sha256: output.asset_publication_receipt_sha256,
  checkout_offer_evidence_sha256: output.checkout_offer_evidence_sha256,
  checkout_offer_snapshot_sha256: output.checkout_offer_snapshot_sha256,
  checkout_recipient_reservation_sha256: output.checkout_recipient_reservation_sha256,
  script_manifest_sha256: output.script_manifest_sha256,
  expected_media_profile: fixture.expectedProfile
}));
assert.deepEqual(validated, {
  status: "V11_FIVE_PAGE_BUNDLE_VALIDATED",
  validation_pass: true,
  validator_version: "arc1-v11-five-page-bundle-validator-v1",
  failed_checks: "none",
  validation_check_count: 33,
  page_count: 5,
  preview_folder: output.preview_folder,
  preview_paths_json: output.preview_paths_json,
  render_bundle_sha256: output.render_bundle_sha256,
  validation_receipt_sha256: expectedValidationReceiptSha256,
  approval_content_sha256: output.approval_content_sha256,
  published_preview_bundle_sha256: output.published_preview_bundle_sha256,
  production_content_sha256: output.production_content_sha256,
  expected_media_profile: fixture.expectedProfile,
  legacy_singular_output_absent_pass: true,
  private_checkout_exposure_pass: true,
  private_recipient_exposure_pass: true,
  whole_site_digest_pass: true,
  production_derivation_pass: true
});

const imageBytes = boundedJpeg(512, 0x45);
const imageDigest = sha256(imageBytes);
const assetManifest = [{
  asset_id: sha256("arc-validator-logo-asset"),
  content_type: "image/jpeg",
  kind: "UPLOAD",
  retrieval_endpoint_sha256: sha256("https://arcweb.onl/internal/intake/arc1/assets/retrieve"),
  role: "logo_file",
  sha256: imageDigest,
  size_bytes: imageBytes.length
}];
const mediaReceivedAt = new Date(Date.now() - 60_000).toISOString();
const provisionalMedia = createTestIntakeEvidence({
  assetManifest,
  businessName: fixture.content.BUSINESS_NAME,
  receivedAt: mediaReceivedAt
});
const imageUrl = JSON.parse(provisionalMedia.privateInputs.asset_publication_receipt_private).entries[0].public_url;
const mediaOutput = await runInjector(injectorInput(fixture, {
  content: { ...fixture.content, LOGO_HTML: `<img src="${imageUrl}" alt="Customer-supplied logo">` },
  assetManifest,
  intakeOptions: { receivedAt: mediaReceivedAt }
}));
assert.equal((await runValidator(mediaOutput)).validation_pass, true,
  "receipt-bound content-addressed customer assets must validate across all five pages and production derivation");

const noFormOutput = await runInjector(injectorInput(fixture, {
  content: {
    ...fixture.content,
    CONTACT_ACTION_HTML: '<a href="https://booking.example.test/start">Book through the verified scheduling service</a>'
  }
}));
assert.equal(noFormOutput.lead_route_mode, "not_required");
assert.equal((await runValidator(noFormOutput)).validation_pass, true,
  "the exact five-page no-form route must validate without inventing lead-recipient state");
assert.doesNotMatch(validatorSource, /inputData\.(?:html_content|file_path)\b/,
  "active V11 validator must not consume singular-page values");
assert.doesNotMatch(validatorSource, /\bfetch\s*\(|\bXMLHttpRequest\b|api\.github\.com/,
  "the local validator must not perform network or publication work");
assert.equal(Object.keys(validated).some(key => /^(?:customer_email|lead_notification_email|claim_recipient_email|checkout_url)$|_private$/.test(key)), false,
  "validator output must remain log-safe and exclude private recipients or checkout capability");

for (const legacy of ["html_content", "file_path", "preview_path", "html_character_count"]) {
  await assert.rejects(runValidator({ ...output, [legacy]: "legacy" }), /legacy singular input/,
    `${legacy} must fail closed`);
}

await assert.rejects(
  runValidator(withRebuiltBundle(output, bundle => {
    bundle.pages.find(page => page.path === "services/index.html").approval_html += "tampered";
  })),
  /services\/index\.html digest\/path\/size binding/,
  "a secondary-page byte change must fail even when the outer bundle digest is recomputed"
);

await assert.rejects(
  runValidator(withRebuiltBundle(output, bundle => { bundle.pages.reverse(); })),
  /digest\/path\/size binding|exactly five pages|required/,
  "page-order ambiguity must fail closed"
);

await assert.rejects(
  runValidator(injectPublicMarkup(output, "services/index.html", '<a href="https://buy.stripe.com/test_private">Pay</a>')),
  /ARC_V11_CHECKOUT_EXPOSURE_FAILED/,
  "a rehashed secondary page must not expose checkout"
);

const recipient = JSON.parse(output.checkout_recipient_reservation_private);
await assert.rejects(
  runValidator(injectPublicMarkup(output, "about/index.html", `<p>${recipient.claim_recipient_email}</p>`)),
  /ARC_V11_PRIVACY_FAILED/,
  "a rehashed secondary page must not expose private recipient data"
);

await assert.rejects(
  runValidator(withRebuiltBundle(output, bundle => {
    bundle.pages.find(page => page.path === "process/index.html").production_sha256 = "0".repeat(64);
  })),
  /process\/index\.html production digest\/size/,
  "production bytes must be independently re-derived from the approval bundle"
);

const changedRecipient = { ...recipient, claim_recipient_email: "different-private@example.test" };
changedRecipient.claim_recipient_email_sha256 = sha256(changedRecipient.claim_recipient_email);
const changedRecipientRaw = canonicalJson(changedRecipient);
await assert.rejects(
  runValidator({
    ...output,
    checkout_recipient_reservation_private: changedRecipientRaw,
    checkout_recipient_reservation_sha256: sha256(changedRecipientRaw),
    checkout_recipient_reservation_hmac_sha256: hmac(checkoutBindingSecret,
      `arc1-checkout-recipient-reservation-signature-v2\ntest\n${changedRecipientRaw}`)
  }),
  /private checkout recipient binding|signed render evidence binding/,
  "recipient replacement must break the immutable reservation chain"
);

await assert.rejects(
  runValidator({ ...output, render_bundle_private: `${output.render_bundle_private}\n` }),
  /render bundle canonical JSON|render bundle JSON/,
  "noncanonical bundle bytes must fail closed"
);

console.log("ARC1 V11 bundle validator contract passed: exact five-page digests, production derivation, private checkout isolation, PII isolation, and legacy singular rejection.");
