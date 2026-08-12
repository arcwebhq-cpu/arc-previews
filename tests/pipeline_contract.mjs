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
const stripeTestApiKey = "sk_test_arc_contract_key_000000000000";
const previewSourceOwner = "arcwebhq-cpu";
const previewSourceRepository = "arc-previews";
const deliveryOwner = "arc-delivery-owner";
const deliveryRepository = "arc-delivery-private";
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
    object: "checkout.session",
    client_reference_id: checkoutReference,
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "usd",
    amount_total: 500000,
    payment_link: expectedPaymentLinkId,
    consent: { terms_of_service: "accepted" },
    metadata: { terms_version: expectedTermsVersion },
    custom_fields: [{ key: "adult_purchaser_ack", dropdown: { value: "accepted" } }],
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
  assert.doesNotMatch(handoff.productionHtml, /<link\s+rel=["']canonical["']|<meta\s+property=["']og:url["']/i);
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
  assert.equal(handoff.secureCustomerSetupRequired, true);
  assert.equal(Object.hasOwn(handoff, "deployUrl"), false);

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
  assert.equal(arc1.render_content_sha256, sha256(arc1.html_content));
  assert.match(arc1.render_evidence_hmac_sha256, /^[a-f0-9]{64}$/);
  const renderEvidence = JSON.parse(arc1.render_evidence_private);
  assert.equal(renderEvidence.preview_folder, preview.folder);
  assert.equal(renderEvidence.content_sha256, arc1.render_content_sha256);
  assert.equal(renderEvidence.intake_evidence_sha256, intake.intakeEvidenceSha256);
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
  const mockFetch = async (url, options = {}) => {
    if (url === `https://api.stripe.com/v1/checkout/sessions/${session.id}`) {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(
        Buffer.from(String(options.headers?.Authorization || "").replace(/^Basic\s+/, ""), "base64").toString("utf8"),
        `${stripeTestApiKey}:`
      );
      return {
        ok: true,
        status: 200,
        url,
        json: async () => session
      };
    }
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
    stripe_test_api_key: stripeTestApiKey,
    checkout_binding_secret: checkoutBindingSecret,
    expected_payment_link_id: expectedPaymentLinkId,
    expected_terms_version: expectedTermsVersion,
    // Caller-mapped Stripe fields are deliberately false. The resolver must ignore them.
    client_reference_id: "attacker-deadbeef." + "0".repeat(64),
    livemode: true,
    payment_status: "unpaid",
    currency: "eur",
    amount_total_minor_units: 1,
    payment_link_id: "plink_1WrongCaller",
    terms_of_service_consent: "",
    metadata_terms_version: "stale-caller-value",
    customer_email: "wrong-recipient@example.test",
    verified_lead_notification_email: verifiedLeadNotificationEmail,
    lead_route_evidence_secret: leadRouteEvidenceSecret,
    github_token: "test-token",
    preview_source_github_owner: previewSourceOwner,
    preview_source_github_repo: previewSourceRepository,
    preview_source_github_branch: "main",
    delivery_github_owner: deliveryOwner,
    delivery_github_repo: deliveryRepository,
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
  assert.equal(arc2.payment_verification_status, "verified_test_payment_from_stripe_api");
  assert.equal(arc2.stripe_session_retrieved, true);
  assert.equal(arc2.client_reference_id, checkoutReference);
  assert.equal(arc2.livemode, false);
  assert.equal(arc2.amount_total_minor_units, 500000);
  assert.equal(arc2.payment_link_id, expectedPaymentLinkId);
  assert.equal(arc2.terms_of_service_consent, "accepted");
  assert.equal(arc2.terms_version, expectedTermsVersion);
  assert.equal(arc2.adult_purchaser_acknowledgement, "accepted");
  assert.equal(arc2.customer_email, fixture.customerEmail);
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
  assert.equal(arc2.secure_customer_setup_required, true);
  assert.equal(Object.hasOwn(arc2, "deploy_url"), false);
  assert.equal(arc2.preview_source_repository, `${previewSourceOwner}/${previewSourceRepository}`);
  assert.equal(arc2.private_delivery_repository, `${deliveryOwner}/${deliveryRepository}`);
  assert.equal(Object.hasOwn(arc2, "production_url"), false);

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
    const suffixSession = { ...session, client_reference_id: suffixReference };
    const suffixFetch = async (url, options = {}) => {
      if (url === `https://api.stripe.com/v1/checkout/sessions/${session.id}`) {
        return { ok: true, status: 200, url, json: async () => suffixSession };
      }
      return mockFetch(url, options);
    };
    const suffixResolved = await runArc2(arc2Input, suffixFetch, Buffer);
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
      return suffixFetch(url);
    };
    await assert.rejects(
      runArc2(arc2Input, collisionFetch, Buffer),
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
    const tamperedProofFetch = async (url, options = {}) => {
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
      return mockFetch(url, options);
    };
    await assert.rejects(runArc2(arc2Input, tamperedProofFetch, Buffer), /approved preview proof hash mismatch/);

    const conflictingFormSource = arc1.html_content.replace('name="form-name" value="roofing-lead"', 'name="form-name" value="wrong-lead"');
    const conflictingFormProof = conflictingFormSource.replace(
      /<\/head>/i,
      `<!-- ARC_PREVIEW_PROOF_START -->\n<meta name="arc-preview-folder" content="${preview.folder}">\n<meta name="arc-preview-source-sha256" content="${sha256(conflictingFormSource)}">\n<!-- ARC_PREVIEW_PROOF_END -->\n</head>`
    );
    const conflictingFormFetch = async (url, options = {}) => {
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
      return mockFetch(url, options);
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
  object: "checkout.session",
  client_reference_id: rendered[0].preview.folder,
  livemode: false,
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  currency: "usd",
  amount_total: 500000,
  payment_link: expectedPaymentLinkId,
  consent: { terms_of_service: "accepted" },
  metadata: { terms_version: expectedTermsVersion },
  custom_fields: [{ key: "adult_purchaser_ack", dropdown: { value: "accepted" } }],
  customer_details: { email: rendered[0].fixture.customerEmail }
};
const paymentExpectations = { expectedPaymentLinkId, expectedTermsVersion };
assert.throws(() => validatePaidSession({ ...validPaidSession, amount_total: 499999 }, paymentExpectations), /500000 minor units/);
assert.throws(() => validatePaidSession({ ...validPaidSession, amount_total: "500000" }, paymentExpectations), /500000 minor units/);
assert.throws(() => validatePaidSession({ ...validPaidSession, object: "payment_intent" }, paymentExpectations), /object identity/);
assert.throws(() => validatePaidSession({ ...validPaidSession, id: "cs_live_forbidden", livemode: true }, paymentExpectations), /test checkout session id/);
assert.throws(() => validatePaidSession({ ...validPaidSession, livemode: true }, paymentExpectations), /livemode must be false/);
assert.throws(() => validatePaidSession({ ...validPaidSession, mode: "subscription" }, paymentExpectations), /completed one-time payment/);
assert.throws(() => validatePaidSession({ ...validPaidSession, status: "open" }, paymentExpectations), /completed one-time payment/);
assert.throws(() => validatePaidSession(validPaidSession, { ...paymentExpectations, expectedPaymentLinkId: "" }), /expected Payment Link id/);
assert.throws(() => validatePaidSession({ ...validPaidSession, payment_link: "plink_1WrongIdentity" }, paymentExpectations), /identity mismatch/);
assert.throws(() => validatePaidSession({ ...validPaidSession, consent: {} }, paymentExpectations), /consent must be accepted/);
assert.throws(() => validatePaidSession(validPaidSession, { ...paymentExpectations, expectedTermsVersion: "" }), /expected terms version/);
assert.throws(() => validatePaidSession({ ...validPaidSession, metadata: { terms_version: "stale-terms" } }, paymentExpectations), /terms version mismatch/);
assert.throws(() => validatePaidSession({ ...validPaidSession, custom_fields: [] }, paymentExpectations), /adult purchaser acknowledgement/);
assert.throws(() => validatePaidSession({ ...validPaidSession, customer_email: "different@example.test" }, paymentExpectations), /email fields disagree/);
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
  stripe_test_api_key: stripeTestApiKey,
  checkout_binding_secret: checkoutBindingSecret,
  expected_payment_link_id: expectedPaymentLinkId,
  expected_terms_version: expectedTermsVersion,
  github_token: "test-token",
  preview_source_github_owner: previewSourceOwner,
  preview_source_github_repo: previewSourceRepository,
  preview_source_github_branch: "main",
  delivery_github_owner: deliveryOwner,
  delivery_github_repo: deliveryRepository
};
const authoritativeNegativeSession = {
  ...validPaidSession,
  client_reference_id: signedCheckoutReference(rendered[0].preview.folder)
};
await assert.rejects(
  runArc2({
    ...arc2PaymentNegativeInput,
    delivery_github_owner: previewSourceOwner,
    delivery_github_repo: previewSourceRepository
  }, async () => { throw new Error("network must not run"); }, Buffer),
  /private delivery repository separate from the preview source/
);
const paymentFetch = override => async (url, options = {}) => {
  if (url === `https://api.stripe.com/v1/checkout/sessions/${validPaidSession.id}`) {
    return { ok: true, status: 200, url, json: async () => ({ ...authoritativeNegativeSession, ...override }) };
  }
  throw new Error("payment gate unexpectedly reached GitHub");
};
await assert.rejects(
  runArc2(arc2PaymentNegativeInput, paymentFetch({ amount_total: "500000" }), Buffer),
  /amount_total must be exactly 500000/
);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ amount_total: 499999 }), Buffer), /amount_total must be exactly 500000/);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ livemode: true }), Buffer), /livemode must be false/);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ mode: "subscription" }), Buffer), /completed one-time payment/);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ status: "open" }), Buffer), /completed one-time payment/);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ payment_link: "plink_1WrongIdentity" }), Buffer), /identity mismatch/);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ consent: {} }), Buffer), /consent must be accepted/);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ metadata: { terms_version: "" } }), Buffer), /terms version mismatch/);
await assert.rejects(runArc2(arc2PaymentNegativeInput, paymentFetch({ custom_fields: [] }), Buffer), /adult purchaser acknowledgement/);
await assert.rejects(
  runArc2(arc2PaymentNegativeInput, paymentFetch({ customer_details: { email: "one@example.test" }, customer_email: "two@example.test" }), Buffer),
  /customer email fields disagree/
);
await assert.rejects(runArc2({ ...arc2PaymentNegativeInput, preview_source_github_branch: "arc-preview/unmerged" }, paymentFetch({}), Buffer), /approved preview from main/);
await assert.rejects(
  runArc2({ ...arc2PaymentNegativeInput, stripe_test_api_key: "sk_live_forbidden" }, async () => { throw new Error("Stripe fetch must not run"); }, Buffer),
  /Stripe test API key/
);
await assert.rejects(
  runArc2({ ...arc2PaymentNegativeInput, expected_terms_version: "stale-terms" }, async () => { throw new Error("Stripe fetch must not run"); }, Buffer),
  /configured terms version/
);
const validSignedReference = authoritativeNegativeSession.client_reference_id;
await assert.rejects(
  runArc2(arc2PaymentNegativeInput, paymentFetch({
    client_reference_id: `${validSignedReference.slice(0, -1)}${validSignedReference.endsWith("0") ? "1" : "0"}`
  }), Buffer),
  /checkout reference signature mismatch/
);

// Caller-mapped Stripe fields cannot override the authenticated session.
const callerTamperingResult = await runArc2({
  ...arc2PaymentNegativeInput,
  client_reference_id: "attacker-deadbeef." + "0".repeat(64),
  livemode: true,
  payment_status: "unpaid",
  amount_total_minor_units: 1,
  payment_link_id: "plink_1WrongIdentity",
  terms_of_service_consent: "",
  metadata_terms_version: "stale",
  customer_email: "attacker@example.test",
  verified_lead_notification_email: "verified-roofing@example.test",
  lead_route_evidence_secret: leadRouteEvidenceSecret
}, async (url, options = {}) => {
  if (url === `https://api.stripe.com/v1/checkout/sessions/${validPaidSession.id}`) {
    return { ok: true, status: 200, url, json: async () => authoritativeNegativeSession };
  }
  if (url.includes("/git/trees/")) {
    return { ok: true, json: async () => ({ truncated: false, tree: treePaths.map(filePath => ({ type: "blob", path: filePath })) }) };
  }
  if (url.includes("/contents/")) {
    const preview = rendered[0].preview;
    const source = preview.html.trim();
    const sourceHash = sha256(source);
    const approved = source.replace(
      /<\/head>/i,
      `<!-- ARC_PREVIEW_PROOF_START -->\n<meta name="arc-preview-folder" content="${preview.folder}">\n<meta name="arc-preview-source-sha256" content="${sourceHash}">\n<!-- ARC_PREVIEW_PROOF_END -->\n</head>`
    );
    return { ok: true, json: async () => ({ sha: "authoritative-caller-tamper", content: Buffer.from(approved).toString("base64") }) };
  }
  throw new Error(`unexpected URL ${url}`);
}, Buffer);
assert.equal(callerTamperingResult.customer_email, validPaidSession.customer_details.email);
assert.equal(callerTamperingResult.payment_link_id, expectedPaymentLinkId);
assert.equal(callerTamperingResult.amount_total_minor_units, 500000);

console.log(
  `Pipeline contract passed: ${rendered.length}/${rendered.length} signed ARC1 intake payloads, ` +
  "ARC2 pending live-staging evidence, caller verification flags ignored, and legacy direct publishing fail-closed."
);
