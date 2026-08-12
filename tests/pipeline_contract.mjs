import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures } from "../fixtures/v10_industries.mjs";
import { renderPreview } from "../scripts/arc_contract.mjs";
import {
  buildProductionHandoff,
  finalizePreviewHtml,
  resolvePreviewFolder,
  validatePaidSession
} from "../scripts/finalize_site.mjs";
import { createTestIntakeEvidence } from "./fixtures/intake_evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE.html"), "utf8");
const validatorSource = await readFile(path.join(root, "arc_step7_validator.js"), "utf8");
const arc1Source = await readFile(path.join(root, "zapier/arc1_inject.js"), "utf8");
const arc2Source = await readFile(path.join(root, "zapier/arc2_resolve_and_finalize.js"), "utf8");
const legacyPublisherSource = await readFile(
  path.join(root, "tests/fixtures/arc2_publish_delivery_direct_regression.js"),
  "utf8"
);
const validate = new Function("inputData", validatorSource);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runArc1 = new AsyncFunction("inputData", arc1Source);
const runArc2 = new AsyncFunction("inputData", "fetch", "Buffer", arc2Source);
const runLegacyPublisher = new AsyncFunction("inputData", "fetch", "Buffer", legacyPublisherSource);

const paymentLinkUrl = "https://buy.stripe.com/test_00000000000000";
const expectedPaymentLinkId = "plink_1ArcV10Test5000";
const expectedTermsVersion = "2026-08-11";
const checkoutBindingSecret = "arc-test-checkout-binding-secret-32-bytes-minimum";
const leadRouteEvidenceSecret = "arc-test-lead-route-evidence-secret-32-bytes-minimum";
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const signedCheckoutReference = folder =>
  `${folder}.${createHmac("sha256", checkoutBindingSecret).update(folder, "utf8").digest("hex")}`;
const leadRouteRecipientHmac = email =>
  createHmac("sha256", leadRouteEvidenceSecret)
    .update(`arc-lead-route-recipient-v1\n${email.toLowerCase()}`, "utf8")
    .digest("hex");
const netlifyFormName = html => {
  const tag = (String(html).match(/<form\b[^>]*>/gi) || [])
    .find(candidate => /\bdata-netlify\s*=\s*["']true["']/i.test(candidate) || /\snetlify(?:\s|=|>)/i.test(candidate));
  return tag?.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1] || "";
};

const evidenceClock = Date.now();
const intakeContexts = fixtures.map((fixture, index) => createTestIntakeEvidence({
  submissionId: `5231110b5803540aeb${(index + 1).toString(16).padStart(6, "0")}`,
  receivedAt: new Date(evidenceClock - 60_000).toISOString(),
  issuedAt: new Date(evidenceClock).toISOString(),
  submissionDataSha256: sha256(JSON.stringify(fixture.content))
}));
const rendered = fixtures.map((fixture, index) => ({
  fixture,
  intake: intakeContexts[index],
  preview: renderPreview(template, fixture.content, {
    trustedEventPrefix: intakeContexts[index].publicFolderPrefix,
    customerEmail: fixture.customerEmail,
    paymentLinkUrl,
    checkoutBindingSecret
  })
}));
const treePaths = rendered.map(item => item.preview.filePath);

for (const [index, item] of rendered.entries()) {
  const { fixture, intake, preview } = item;
  const checkoutReference = signedCheckoutReference(preview.folder);
  const session = {
    id: `cs_test_arcv10_${String(index + 1).padStart(2, "0")}`,
    client_reference_id: checkoutReference,
    livemode: false,
    payment_status: "paid",
    currency: "usd",
    amount_total: 500000,
    payment_link: expectedPaymentLinkId,
    consent: { terms_of_service: "accepted" },
    metadata: { terms_version: expectedTermsVersion },
    customer_details: { email: fixture.customerEmail }
  };
  const verifiedLeadNotificationEmail = `verified-${fixture.expectedProfile}@example.test`;
  const expectedRecipientHmac = leadRouteRecipientHmac(verifiedLeadNotificationEmail);
  const expectedLeadRouteFormName = netlifyFormName(preview.html);
  assert.ok(expectedLeadRouteFormName, "fixture must contain one named Netlify lead form");

  const folderLookupReference = index % 2 ? intake.publicFolderPrefix : preview.folder;
  assert.equal(resolvePreviewFolder({ clientReferenceId: folderLookupReference, treePaths }), preview.folder);
  validatePaidSession(session, { expectedPaymentLinkId, expectedTermsVersion });

  const handoff = buildProductionHandoff({
    session: { ...session, client_reference_id: folderLookupReference },
    treePaths,
    previewHtml: preview.html,
    expectedPaymentLinkId,
    expectedTermsVersion,
    verifiedLeadNotificationEmail,
    leadRouteEvidenceSecret,
    // Caller assertions are deliberately inert. Live staging evidence is the authority.
    leadRouteStatus: "verified",
    deliveryPrWriteUnlocked: true
  });
  assert.equal(handoff.previewFolder, preview.folder);
  assert.equal(handoff.productionFilePath, `deliveries/${preview.folder}/index.html`);
  assert.match(handoff.productionHtml, /<meta name="robots" content="index,follow,max-image-preview:large">/i);
  assert.match(handoff.productionHtml, /data-arc-site-mode="production"/i);
  assert.doesNotMatch(handoff.productionHtml, /\[ARC TEST\]/i);
  assert.doesNotMatch(handoff.productionHtml, /<aside\b[^>]*arc-preview-toolbar|data-arc-checkout|buy\.stripe\.com/i);
  assert.match(handoff.productionHtml, /<link rel="canonical" href="https:\/\/arcwebhq-cpu\.github\.io\/arc-previews\/deliveries\//i);
  assert.equal(handoff.netlifyConfigPath, `deliveries/${preview.folder}/netlify.toml`);
  assert.equal(handoff.usageGuidePath, `deliveries/${preview.folder}/USAGE.md`);
  assert.match(handoff.netlifyConfig, /publish = "\."/);
  assert.match(handoff.usageGuide, /Form submission notifications/);
  assert.doesNotMatch(handoff.usageGuide, /@|cs_test_/i);
  assert.equal(handoff.leadRouteStatus, "pending_live_staging_evidence");
  assert.equal(handoff.leadRouteEvidenceRequired, true);
  assert.equal(handoff.leadRouteEvidenceVersion, "arc-lead-route-evidence-v1");
  assert.equal(handoff.leadRouteFormName, expectedLeadRouteFormName);
  assert.equal(handoff.leadRouteRecipientHmacSha256, expectedRecipientHmac);
  assert.equal(handoff.verifiedLeadNotificationEmail, verifiedLeadNotificationEmail);
  assert.equal(new URL(handoff.deployUrl).searchParams.get("create_from_path"), `deliveries/${preview.folder}`);
  assert.ok(handoff.productionUrl.endsWith(`/deliveries/${preview.folder}/`));

  const arc1Input = {
    template_content: template,
    raw_json: JSON.stringify(fixture.content),
    customer_email: fixture.customerEmail,
    payment_link_url: paymentLinkUrl,
    checkout_binding_secret: checkoutBindingSecret,
    // These browser-supplied values must not override the signed intake identity.
    submission_id: "ffffffffffffffffffffffff",
    trusted_event_prefix: "deadbeef",
    ...intake.privateInputs
  };
  const arc1 = await runArc1(arc1Input);
  assert.equal(arc1.trusted_event_prefix, intake.publicFolderPrefix);
  assert.equal(arc1.trusted_netlify_submission_id, intake.evidence.submission_id);
  assert.equal(arc1.intake_state_key, intake.evidence.state_key);
  assert.equal(arc1.intake_evidence_sha256, intake.intakeEvidenceSha256);
  assert.equal(arc1.submission_data_sha256, intake.evidence.submission_data_sha256);
  assert.equal(arc1.file_path, preview.filePath);
  assert.equal(new URL(arc1.checkout_url).searchParams.get("client_reference_id"), checkoutReference);
  assert.equal(arc1.checkout_reference, checkoutReference);
  assert.equal(arc1.expected_media_profile, fixture.expectedProfile);
  assert.match(arc1.html_content, /class="arc-preview-toolbar"/);
  assert.equal((arc1.html_content.match(/buy\.stripe\.com/g) || []).length, 1);

  const validation = validate({
    html_content: arc1.html_content,
    raw_json: arc1.raw_json,
    file_path: arc1.file_path,
    business_name: fixture.content.BUSINESS_NAME,
    customer_email: fixture.customerEmail,
    trusted_event_prefix: arc1.trusted_event_prefix,
    preview_url: arc1.preview_url,
    expected_cta: fixture.content.PRIMARY_CTA_LABEL,
    main_call_to_action: fixture.content.PRIMARY_CTA_LABEL,
    final_placeholder_count: arc1.final_placeholder_count,
    template_placeholder_count: arc1.template_placeholder_count,
    html_character_count: arc1.html_character_count,
    template_comment: arc1.template_comment
  });
  assert.equal(validation.validation_pass, true);
  assert.equal(validation.trusted_event_prefix, intake.publicFolderPrefix);
  assert.equal(validation.semantic_media_profile, fixture.expectedProfile);

  const approvedSourceSha256 = sha256(arc1.html_content);
  const approvedPreviewHtml = arc1.html_content.replace(
    /<\/head>/i,
    `<!-- ARC_PREVIEW_PROOF_START -->\n<meta name="arc-preview-folder" content="${preview.folder}">\n<meta name="arc-preview-source-sha256" content="${approvedSourceSha256}">\n<!-- ARC_PREVIEW_PROOF_END -->\n</head>`
  );
  const mockFetch = async url => {
    if (url.includes("/git/trees/")) {
      return {
        ok: true,
        json: async () => ({
          truncated: false,
          tree: treePaths.map(filePath => ({ type: "blob", path: filePath }))
        })
      };
    }
    if (url.includes("/contents/")) {
      return {
        ok: true,
        json: async () => ({
          sha: `fixture-${index + 1}`,
          content: Buffer.from(approvedPreviewHtml, "utf8").toString("base64")
        })
      };
    }
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
  };
  const arc2Input = {
    checkout_session_id: session.id,
    client_reference_id: session.client_reference_id,
    checkout_binding_secret: checkoutBindingSecret,
    livemode: session.livemode,
    payment_status: session.payment_status,
    currency: session.currency,
    amount_total_minor_units: session.amount_total,
    payment_link_id: session.payment_link,
    expected_payment_link_id: expectedPaymentLinkId,
    terms_of_service_consent: session.consent.terms_of_service,
    metadata_terms_version: session.metadata.terms_version,
    expected_terms_version: expectedTermsVersion,
    customer_email: fixture.customerEmail,
    verified_lead_notification_email: verifiedLeadNotificationEmail,
    lead_route_evidence_secret: leadRouteEvidenceSecret,
    github_token: "test-token",
    // These caller claims must never unlock the delivery PR write.
    lead_route_status: "verified",
    lead_route_verified: true,
    delivery_pr_write_unlocked: true
  };
  const arc2 = await runArc2(arc2Input, mockFetch, Buffer);
  assert.equal(arc2.status, "PENDING_LIVE_STAGING_EVIDENCE");
  assert.equal(arc2.delivery_pr_write_unlocked, false);
  assert.equal(arc2.lead_route_status, "pending_live_staging_evidence");
  assert.equal(arc2.lead_route_evidence_required, true);
  assert.equal(arc2.lead_route_evidence_version, "arc-lead-route-evidence-v1");
  assert.equal(arc2.lead_route_form_name, expectedLeadRouteFormName);
  assert.equal(arc2.lead_route_recipient_hmac_sha256, expectedRecipientHmac);
  assert.equal(arc2.payment_verification_status, "verified_test_payment");
  assert.equal(arc2.client_reference_id, checkoutReference);
  assert.equal(arc2.livemode, false);
  assert.equal(arc2.amount_total_minor_units, 500000);
  assert.equal(arc2.payment_link_id, expectedPaymentLinkId);
  assert.equal(arc2.terms_of_service_consent, "accepted");
  assert.equal(arc2.terms_version, expectedTermsVersion);
  assert.equal(arc2.preview_folder, preview.folder);
  assert.equal(arc2.production_file_path, `deliveries/${preview.folder}/index.html`);
  const arc2Html = Buffer.from(arc2.production_content_base64, "base64").toString("utf8");
  assert.match(arc2Html, /data-arc-site-mode="production"/i);
  assert.doesNotMatch(arc2Html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "", /noindex/i);
  assert.doesNotMatch(arc2Html, /<aside\b[^>]*arc-preview-toolbar|data-arc-checkout|buy\.stripe\.com/i);
  assert.equal(arc2.netlify_config_path, `deliveries/${preview.folder}/netlify.toml`);
  assert.equal(arc2.usage_guide_path, `deliveries/${preview.folder}/USAGE.md`);
  assert.match(arc2.production_content_sha256, /^[a-f0-9]{64}$/);
  assert.match(arc2.bundle_fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(Buffer.from(arc2.usage_guide_base64, "base64").toString("utf8"), /@|cs_test_/i);
  assert.equal(new URL(arc2.deploy_url).searchParams.get("create_from_path"), `deliveries/${preview.folder}`);

  const noCallerClaimInput = { ...arc2Input };
  delete noCallerClaimInput.lead_route_status;
  delete noCallerClaimInput.lead_route_verified;
  delete noCallerClaimInput.delivery_pr_write_unlocked;
  const noCallerClaim = await runArc2(noCallerClaimInput, mockFetch, Buffer);
  assert.equal(noCallerClaim.status, arc2.status);
  assert.equal(noCallerClaim.delivery_pr_write_unlocked, arc2.delivery_pr_write_unlocked);
  assert.equal(noCallerClaim.lead_route_status, arc2.lead_route_status);
  assert.equal(noCallerClaim.bundle_fingerprint, arc2.bundle_fingerprint);

  if (index === 0) {
    const suffixReference = signedCheckoutReference(intake.publicFolderPrefix);
    const suffixResolved = await runArc2({ ...arc2Input, client_reference_id: suffixReference }, mockFetch, Buffer);
    assert.equal(suffixResolved.preview_folder, preview.folder);
    assert.equal(suffixResolved.status, "PENDING_LIVE_STAGING_EVIDENCE");
    const collisionFetch = async url => {
      if (url.includes("/git/trees/")) {
        return {
          ok: true,
          json: async () => ({
            truncated: false,
            tree: [...treePaths, `second-concept-${intake.publicFolderPrefix}/index.html`]
              .map(filePath => ({ type: "blob", path: filePath }))
          })
        };
      }
      return mockFetch(url);
    };
    await assert.rejects(
      runArc2({ ...arc2Input, client_reference_id: suffixReference }, collisionFetch, Buffer),
      /expected one match.*found 2/
    );
    await assert.rejects(
      runArc2({ ...arc2Input, verified_lead_notification_email: "", lead_route_status: "verified" }, mockFetch, Buffer),
      /verified lead notification email/
    );
    await assert.rejects(
      runArc2({ ...arc2Input, lead_route_evidence_secret: "", lead_route_status: "verified" }, mockFetch, Buffer),
      /lead-route evidence secret/
    );
    const tamperedProofFetch = async url => {
      if (url.includes("/git/trees/")) {
        return {
          ok: true,
          json: async () => ({ truncated: false, tree: treePaths.map(filePath => ({ type: "blob", path: filePath })) })
        };
      }
      if (url.includes("/contents/")) {
        const tampered = approvedPreviewHtml.replace(fixture.content.BUSINESS_NAME, `${fixture.content.BUSINESS_NAME} tampered`);
        return {
          ok: true,
          json: async () => ({ sha: "tampered-proof", content: Buffer.from(tampered, "utf8").toString("base64") })
        };
      }
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
    };
    await assert.rejects(runArc2(arc2Input, tamperedProofFetch, Buffer), /approved preview proof hash mismatch/);

    const conflictingFormSource = arc1.html_content.replace('name="form-name" value="roofing-lead"', 'name="form-name" value="wrong-lead"');
    const conflictingFormProof = conflictingFormSource.replace(
      /<\/head>/i,
      `<!-- ARC_PREVIEW_PROOF_START -->\n<meta name="arc-preview-folder" content="${preview.folder}">\n<meta name="arc-preview-source-sha256" content="${sha256(conflictingFormSource)}">\n<!-- ARC_PREVIEW_PROOF_END -->\n</head>`
    );
    const conflictingFormFetch = async url => {
      if (url.includes("/git/trees/")) {
        return {
          ok: true,
          json: async () => ({ truncated: false, tree: treePaths.map(filePath => ({ type: "blob", path: filePath })) })
        };
      }
      if (url.includes("/contents/")) {
        return {
          ok: true,
          json: async () => ({ sha: "conflicting-form-proof", content: Buffer.from(conflictingFormProof, "utf8").toString("base64") })
        };
      }
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
    };
    await assert.rejects(runArc2(arc2Input, conflictingFormFetch, Buffer), /lead control semantics/);
  }

  console.log(`PASS signed intake + pending lead-route evidence ${index + 1}/${rendered.length}: ${fixture.expectedProfile}`);
}

let legacyPublisherFetchCalls = 0;
await assert.rejects(
  runLegacyPublisher({
    direct_publish_test_only: true,
    lead_route_status: "verified",
    lead_route_verified: true,
    delivery_pr_write_unlocked: true
  }, async () => {
    legacyPublisherFetchCalls += 1;
    throw new Error("legacy direct publisher reached the network");
  }, Buffer),
  /ARC_DELIVERY_PR_REQUIRED: direct-main publisher is disabled/
);
assert.equal(legacyPublisherFetchCalls, 0, "legacy direct publisher must fail before any network access");

const validPaidSession = {
  id: "cs_test_contract_negative",
  client_reference_id: rendered[0].preview.folder,
  livemode: false,
  payment_status: "paid",
  currency: "usd",
  amount_total: 500000,
  payment_link: expectedPaymentLinkId,
  consent: { terms_of_service: "accepted" },
  metadata: { terms_version: expectedTermsVersion },
  customer_details: { email: rendered[0].fixture.customerEmail }
};
const paymentExpectations = { expectedPaymentLinkId, expectedTermsVersion };
assert.throws(() => validatePaidSession({ ...validPaidSession, amount_total: 499999 }, paymentExpectations), /500000 minor units/);
assert.throws(() => validatePaidSession({ ...validPaidSession, amount_total: "500000" }, paymentExpectations), /500000 minor units/);
assert.throws(() => validatePaidSession({ ...validPaidSession, id: "cs_live_forbidden", livemode: true }, paymentExpectations), /test checkout session id/);
assert.throws(() => validatePaidSession({ ...validPaidSession, livemode: true }, paymentExpectations), /livemode must be false/);
assert.throws(() => validatePaidSession(validPaidSession, { ...paymentExpectations, expectedPaymentLinkId: "" }), /expected Payment Link id/);
assert.throws(() => validatePaidSession({ ...validPaidSession, payment_link: "plink_1WrongIdentity" }, paymentExpectations), /identity mismatch/);
assert.throws(() => validatePaidSession({ ...validPaidSession, consent: {} }, paymentExpectations), /consent must be accepted/);
assert.throws(() => validatePaidSession(validPaidSession, { ...paymentExpectations, expectedTermsVersion: "" }), /expected terms version/);
assert.throws(() => validatePaidSession({ ...validPaidSession, metadata: { terms_version: "stale-terms" } }, paymentExpectations), /terms version mismatch/);
assert.throws(() => buildProductionHandoff({
  session: validPaidSession,
  treePaths,
  previewHtml: rendered[0].preview.html,
  ...paymentExpectations,
  leadRouteStatus: "verified",
  deliveryPrWriteUnlocked: true
}), /verified lead notification email/);
assert.throws(() => buildProductionHandoff({
  session: validPaidSession,
  treePaths,
  previewHtml: rendered[0].preview.html,
  ...paymentExpectations,
  verifiedLeadNotificationEmail: "verified@example.test",
  leadRouteStatus: "verified",
  deliveryPrWriteUnlocked: true
}), /lead-route evidence secret/);
assert.throws(() => resolvePreviewFolder({
  clientReferenceId: "deadbeef",
  treePaths: ["first-deadbeef/index.html", "second-deadbeef/index.html"]
}), /found 2/);
assert.throws(() => resolvePreviewFolder({
  clientReferenceId: "prefix-deadbeef-suffix",
  treePaths: ["first-deadbeef/index.html"]
}), /exact folder or exactly eight hexadecimal/);
assert.throws(() => resolvePreviewFolder({
  clientReferenceId: "deadbeef00",
  treePaths: ["first-deadbeef/index.html"]
}), /exact folder or exactly eight hexadecimal/);
assert.throws(() => resolvePreviewFolder({
  clientReferenceId: "qa/first-deadbeef",
  treePaths: ["qa/first-deadbeef/index.html"]
}), /one root folder/);
assert.throws(() => finalizePreviewHtml("<!doctype html><html><head></head><body></body></html>"), /private ARC preview/);
assert.throws(
  () => finalizePreviewHtml('<!doctype html><html><head><meta name="robots" content="noindex,nofollow"></head><body></body></html>'),
  /verified ARC v10/
);

const firstIntake = rendered[0].intake;
const arc1NegativeInput = {
  template_content: template,
  raw_json: JSON.stringify(rendered[0].fixture.content),
  customer_email: rendered[0].fixture.customerEmail,
  ...firstIntake.privateInputs
};
await assert.rejects(runArc1(arc1NegativeInput), /test Payment Link URL is required/);
await assert.rejects(
  runArc1({ ...arc1NegativeInput, payment_link_url: "https://buy.stripe.com/liveForbidden123" }),
  /test-mode Payment Link/
);
await assert.rejects(
  runArc1({ ...arc1NegativeInput, payment_link_url: paymentLinkUrl }),
  /checkout binding secret/
);
await assert.rejects(
  runArc1({
    ...arc1NegativeInput,
    payment_link_url: paymentLinkUrl,
    checkout_binding_secret: checkoutBindingSecret,
    intake_evidence_private: ""
  }),
  /intake evidence JSON/
);
await assert.rejects(
  runArc1({
    ...arc1NegativeInput,
    payment_link_url: paymentLinkUrl,
    checkout_binding_secret: checkoutBindingSecret,
    intake_evidence_hmac_sha256: "0".repeat(64)
  }),
  /intake evidence HMAC mismatch/
);

const arc2PaymentNegativeInput = {
  checkout_session_id: validPaidSession.id,
  client_reference_id: signedCheckoutReference(rendered[0].preview.folder),
  checkout_binding_secret: checkoutBindingSecret,
  livemode: false,
  payment_status: "paid",
  currency: "usd",
  amount_total_minor_units: "500000",
  payment_link_id: expectedPaymentLinkId,
  expected_payment_link_id: expectedPaymentLinkId,
  terms_of_service_consent: "accepted",
  metadata_terms_version: expectedTermsVersion,
  expected_terms_version: expectedTermsVersion,
  github_token: "test-token"
};
const unreachableFetch = async () => { throw new Error("payment gate unexpectedly reached GitHub"); };
await assert.rejects(
  runArc2({ ...arc2PaymentNegativeInput, amount_total_minor_units: "5,000", amount_total: 500000 }, unreachableFetch, Buffer),
  /amount_total_minor_units/
);
await assert.rejects(runArc2({ ...arc2PaymentNegativeInput, amount_total_minor_units: "0500000" }, unreachableFetch, Buffer), /amount_total_minor_units/);
await assert.rejects(runArc2({ ...arc2PaymentNegativeInput, livemode: true }, unreachableFetch, Buffer), /livemode must be false/);
await assert.rejects(runArc2({ ...arc2PaymentNegativeInput, github_branch: "arc-preview/unmerged" }, unreachableFetch, Buffer), /approved preview from main/);
await assert.rejects(runArc2({ ...arc2PaymentNegativeInput, payment_link_id: "plink_1WrongIdentity" }, unreachableFetch, Buffer), /identity mismatch/);
await assert.rejects(runArc2({ ...arc2PaymentNegativeInput, terms_of_service_consent: "" }, unreachableFetch, Buffer), /consent must be accepted/);
await assert.rejects(runArc2({ ...arc2PaymentNegativeInput, metadata_terms_version: "" }, unreachableFetch, Buffer), /terms version mismatch/);
const validSignedReference = arc2PaymentNegativeInput.client_reference_id;
await assert.rejects(
  runArc2({
    ...arc2PaymentNegativeInput,
    client_reference_id: `${validSignedReference.slice(0, -1)}${validSignedReference.endsWith("0") ? "1" : "0"}`
  }, unreachableFetch, Buffer),
  /checkout reference signature mismatch/
);

console.log(
  `Pipeline contract passed: ${rendered.length}/${rendered.length} signed ARC1 intake payloads, ` +
  "ARC2 pending live-staging evidence, caller verification flags ignored, and legacy direct publishing fail-closed."
);
