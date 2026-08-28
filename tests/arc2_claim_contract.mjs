import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

import { fixtures } from "../fixtures/v11_industries.mjs";
import {
  V11_PRODUCTION_HEADERS_FILE,
  V11_PRODUCTION_HTML_PATHS,
  finalizeV11ProductionSite
} from "../scripts/v11_production_finalizer.mjs";
import { canonicalJson, renderV11Site, sha256 } from "../scripts/v11_site_contract.mjs";

const source = await readFile(new URL("../zapier/arc2_checkout_session_artifact_adapter.js", import.meta.url), "utf8");
const retiredSource = await readFile(new URL("../zapier/arc2_resolve_and_finalize.js", import.meta.url), "utf8");
const template = await readFile(new URL("../ARC_MASTER_TEMPLATE_V11.html", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runAdapter = new AsyncFunction("inputData", "fetch", "Buffer", source);
const runRetired = new AsyncFunction("inputData", "fetch", "Buffer", retiredSource);

const checkoutSecret = "arc2-checkout-session-binding-secret-0123456789";
const artifactSecret = "arc2-checkout-session-artifact-secret-0123456789";
const publicationSecret = "arc2-checkout-session-publication-secret-0123456789";
const workerSecret = "arc2-checkout-session-worker-secret-0123456789";
const checkoutKeyId = "01";
const sessionId = "cs_test_ArcReviewCheckout123456";
const sourceCommitSha = "1".repeat(40);
const claimEmail = "buyer@example.test";
const leadEmail = "leads@example.test";
const workerUrl = "https://arcweb.onl/internal/payment-arc2/start";
const digest = value => createHash("sha256").update(value).digest("hex");
const mac = (secret, message) => createHmac("sha256", secret).update(message).digest("hex");
const gitSha = value => createHash("sha1").update(value).digest("hex");

function boundedJpeg(size = 512, fill = 0x41) {
  const prefix = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00
  ]);
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.length - 2, fill), Buffer.from([0xff, 0xd9])], size);
}

function assetReview(assets) {
  return {
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
    assets: assets.map(asset => ({ content_type: "image/jpeg", path: asset.path, sha256: digest(asset.bytes) }))
  };
}

function renderedScenario({ noAsset = false, noForm = false } = {}) {
  const fixture = fixtures[0];
  const baseContent = noForm ? {
    ...fixture.content,
    CONTACT_ACTION_HTML: '<a href="https://booking.example.test/start">Book through the scheduling service</a>'
  } : fixture.content;
  const initial = renderV11Site(template, baseContent, { trustedEventPrefix: fixture.id });
  if (noAsset) return { rendered: initial, finalized: finalizeV11ProductionSite(initial, { assets: [] }), asset: null };
  const bytes = boundedJpeg();
  const assetDigest = digest(bytes);
  const sourceUrl = `https://arcwebhq-cpu.github.io/arc-previews/${initial.folder}/assets/${assetDigest}.jpg`;
  const content = {
    ...baseContent,
    HERO_MEDIA_HTML: `<picture><source srcset="${sourceUrl} 1x"><img src="${sourceUrl}" alt="Customer supplied project"></picture>`
  };
  const rendered = renderV11Site(template, content, { trustedEventPrefix: fixture.id, heroImageUrl: sourceUrl });
  const asset = { path: `assets/${assetDigest}.jpg`, bytes, sourceUrl };
  return {
    rendered,
    finalized: finalizeV11ProductionSite(rendered, { assets: [asset], assetReview: assetReview([asset]) }),
    asset
  };
}

function renderBundle(rendered, finalized) {
  const finalizedByPath = new Map(finalized.pages.map(page => [page.path, page]));
  const publishedManifest = {
    version: "arc-v11-published-preview-bundle-v1",
    pages: V11_PRODUCTION_HTML_PATHS.map(path => {
      const page = rendered.pages.find(item => item.path === path);
      return { path, sha256: page.publishedSha256, size: Buffer.byteLength(page.html) };
    })
  };
  return canonicalJson({
    version: "arc1-five-page-render-bundle-v1",
    scope: "private-sanitized-five-page-preview-render",
    runtime_version: "arc1-inject-v11-render-runtime-v1",
    site_contract_version: "arc-five-page-site-v1",
    template_version: "11.0",
    offer_contract_id: "arc-fixed-five-page-offer-v1",
    deliverable: "fixed-five-page-marketing-website-v1",
    preview_folder: rendered.folder,
    page_count: 5,
    logical_page_paths: rendered.pages.map(page => page.path),
    preview_paths: V11_PRODUCTION_HTML_PATHS.map(path => `${rendered.folder}/${path}`),
    lead_route_mode: finalized.leadRouteMode,
    lead_route_form_name: finalized.leadRouteFormName,
    pages: rendered.pages.map(page => ({
      key: page.key,
      label: page.label,
      path: page.path,
      repository_path: page.filePath,
      url: page.url,
      approval_html: page.approvalHtml,
      approval_sha256: page.approvalSha256,
      approval_size: Buffer.byteLength(page.approvalHtml),
      published_html: page.html,
      published_sha256: page.publishedSha256,
      published_size: Buffer.byteLength(page.html),
      production_sha256: finalizedByPath.get(page.path).sha256,
      production_size: finalizedByPath.get(page.path).size
    })),
    approval_manifest: rendered.approvalManifest,
    approval_manifest_sha256: rendered.approvalBundleSha256,
    published_preview_manifest: publishedManifest,
    published_preview_bundle_sha256: digest(canonicalJson(publishedManifest)),
    production_content_sha256: finalized.productionContentSha256
  });
}

function buildScenario(options = {}) {
  const { rendered, finalized, asset } = renderedScenario(options);
  const bundle = renderBundle(rendered, finalized);
  const bundleValue = JSON.parse(bundle);
  const bundleSha256 = digest(bundle);
  const taxRegistrations = [{ country: "US", id: "taxreg_ArcWashington", state: "WA", type: "state_sales_tax" }];
  const stableCheckout = {
    stripe_account_id_sha256: "b".repeat(64),
    livemode: false,
    price_id: "price_ArcFivePage5000",
    product_id: "prod_ArcFivePageWebsite",
    amount_subtotal_minor_units: 500000,
    currency: "usd",
    quantity: 1,
    terms_version: "2026-08-25",
    terms_document_sha256: "c".repeat(64),
    automatic_tax_enabled: true,
    customer_address_source: "stripe_checkout_customer_details.address",
    price_tax_behavior: "exclusive",
    product_tax_code: "txcd_12345678",
    tax_contract_version: "arc-tax-v1",
    tax_settings_status: "active",
    tax_registrations: taxRegistrations,
    tax_registrations_sha256: digest(canonicalJson(taxRegistrations)),
    adult_acknowledgement_key: "adultpurchaserack",
    name_collection_required: true,
    submit_type: "auto",
    checkout_redirect_url: "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}",
    stripe_api_version: "2026-07-29.dahlia"
  };
  const publicationEntry = asset ? {
    asset_id: "d".repeat(64),
    content_type: "image/jpeg",
    git_blob_sha1: gitSha(asset.bytes),
    public_url: asset.sourceUrl,
    repository_path: `${rendered.folder}/${asset.path}`,
    role: "hero_image_file",
    sha256: digest(asset.bytes),
    size_bytes: asset.bytes.length
  } : null;
  const publication = canonicalJson({
    version: "arc1-public-asset-publication-receipt-v1",
    scope: "github-content-addressed-preview-assets",
    bridge_contract_sha256: "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2",
    delivery_id: "1".repeat(64),
    bridge_evidence_sha256: "2".repeat(64),
    private_asset_receipt_sha256: "3".repeat(64),
    intake_evidence_sha256: "4".repeat(64),
    intake_state_digest_sha256: "5".repeat(64),
    asset_manifest_sha256: "6".repeat(64),
    asset_permission: asset ? "Confirmed rights and no visible watermark v1" : "",
    asset_visual_review_authority_verified: Boolean(asset),
    asset_visual_review_key_id: asset ? "01" : "",
    asset_visual_review_reviewer_id_sha256: asset ? "7".repeat(64) : "",
    asset_visual_review_sha256: asset ? "8".repeat(64) : "",
    repository: "arcwebhq-cpu/arc-previews",
    base_branch: "main",
    preview_branch: `arc-preview/${rendered.folder.slice(-8)}`,
    pages_base_url: "https://arcwebhq-cpu.github.io/arc-previews",
    public_folder_prefix: rendered.folder.slice(-8),
    preview_folder: rendered.folder,
    entries: asset ? [publicationEntry] : [],
    status: asset ? "HUMAN_REVIEWED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS"
  });
  const publicationSha256 = digest(publication);
  const leadHmac = finalized.leadRouteMode === "netlify_form"
    ? mac(checkoutSecret, `arc-checkout-lead-recipient-v1\ntest\n${leadEmail}`) : "";
  const offer = canonicalJson({
    version: "arc-checkout-offer-snapshot-v2",
    scope: "immutable-approved-five-page-preview-private-checkout-offer",
    offer_contract_id: "arc-fixed-five-page-offer-v1",
    deliverable: "fixed-five-page-marketing-website-v1",
    page_count: 5,
    preview_folder: rendered.folder,
    preview_paths: bundleValue.preview_paths,
    preview_source_repository: "arcwebhq-cpu/arc-previews",
    public_folder_prefix: rendered.folder.slice(-8),
    approval_content_sha256: rendered.approvalBundleSha256,
    published_preview_bundle_sha256: bundleValue.published_preview_bundle_sha256,
    production_content_sha256: finalized.productionContentSha256,
    render_bundle_sha256: bundleSha256,
    lead_route_mode: finalized.leadRouteMode,
    lead_route_form_name: finalized.leadRouteFormName,
    checkout_binding_key_id: checkoutKeyId,
    environment: "arc-production",
    lead_route_recipient_hmac_sha256: leadHmac,
    asset_publication_receipt_sha256: publicationSha256,
    ...stableCheckout,
    configuration_sha256: digest(canonicalJson(stableCheckout))
  });
  const offerSha256 = digest(offer);
  const recipient = canonicalJson({
    version: "arc1-checkout-recipient-reservation-v2",
    scope: "private-recipients-for-approved-five-page-checkout",
    offer_contract_id: "arc-fixed-five-page-offer-v1",
    deliverable: "fixed-five-page-marketing-website-v1",
    page_count: 5,
    preview_folder: rendered.folder,
    preview_paths: bundleValue.preview_paths,
    approval_content_sha256: rendered.approvalBundleSha256,
    published_preview_bundle_sha256: bundleValue.published_preview_bundle_sha256,
    production_content_sha256: finalized.productionContentSha256,
    checkout_offer_snapshot_sha256: offerSha256,
    checkout_binding_key_id: checkoutKeyId,
    stripe_mode: "test",
    lead_route_mode: finalized.leadRouteMode,
    lead_route_form_name: finalized.leadRouteFormName,
    lead_route_recipient_hmac_sha256: leadHmac,
    lead_notification_email: finalized.leadRouteMode === "netlify_form" ? leadEmail : "",
    claim_recipient_email: claimEmail,
    claim_recipient_email_sha256: digest(claimEmail)
  });
  const approvalReceiptSha256 = "9".repeat(64);
  const immutable = {
    schema: "arc-payment-arc2-start-binding-v2",
    review_session_binding_sha256: "a".repeat(64),
    invite_hmac_sha256: "b".repeat(64),
    payment_binding_sha256: "c".repeat(64),
    payment_receipt_sha256: "d".repeat(64),
    payment_state_event_sha256: "e".repeat(64),
    approval_receipt_sha256: approvalReceiptSha256,
    approval_receipt_hmac_sha256: "f".repeat(64),
    preview_manifest_sha256: finalized.artifactManifestSha256,
    preview_content_sha256: finalized.productionContentSha256,
    brief_sha256: "1".repeat(64),
    recipient_email_sha256: digest(claimEmail),
    payer_email_sha256: "2".repeat(64),
    checkout_session_id_hmac_sha256: "3".repeat(64),
    payment_intent_id_hmac_sha256: "4".repeat(64),
    stripe_account_id_sha256: stableCheckout.stripe_account_id_sha256,
    livemode: false,
    scope_version: "arc-fixed-five-page-offer-v1",
    authorization_expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
  };
  const claim = canonicalJson({
    accepted: true,
    outbox_key: `payment-arc2-start-outbox/${"5".repeat(64)}`,
    state: "CLAIMED",
    idempotent_replay: false,
    immutable_binding_sha256: digest(canonicalJson(immutable)),
    claim_attempt_count: 1,
    lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    arc2_start_receipt_sha256: null,
    payload: immutable
  });
  const inputs = {
    arc2_checkout_session_adapter_enabled: "true",
    payment_arc2_start_enabled: "false",
    stripe_live_mode_enabled: "false",
    checkout_session_id: sessionId,
    payment_arc2_claim_token: "arc2ClaimToken_012345678901234567890123456789",
    payment_arc2_claim_private: claim,
    checkout_binding_key_id: checkoutKeyId,
    checkout_binding_secret: checkoutSecret,
    retired_checkout_binding_keys_json: "{}",
    checkout_offer_snapshot_private: offer,
    checkout_offer_snapshot_sha256: offerSha256,
    checkout_offer_snapshot_hmac_sha256: mac(checkoutSecret, `arc-checkout-offer-snapshot-signature-v2\ntest\n${offer}`),
    render_bundle_private: bundle,
    render_bundle_sha256: bundleSha256,
    checkout_recipient_reservation_private: recipient,
    checkout_recipient_reservation_sha256: digest(recipient),
    checkout_recipient_reservation_hmac_sha256: mac(checkoutSecret, `arc1-checkout-recipient-reservation-signature-v2\ntest\n${recipient}`),
    asset_publication_receipt_private: publication,
    asset_publication_receipt_sha256: publicationSha256,
    asset_publication_receipt_hmac_sha256: mac(publicationSecret, `arc1-public-asset-publication-receipt-v1\n${publication}`),
    asset_publication_receipt_secret: publicationSecret,
    handoff_artifact_evidence_secret: artifactSecret,
    payment_arc2_worker_secret: workerSecret,
    payment_arc2_worker_url: workerUrl,
    preview_source_commit_sha: sourceCommitSha,
    github_token: "github_pat_ArcReadOnlyAssets0123456789",
    provider_operation_timeout_ms: "25000"
  };
  return { inputs, rendered, finalized, asset, publicationEntry, immutable, approvalReceiptSha256 };
}

function jsonResponse(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, { status, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } });
}

function mockFetch(scenario, { completedReplay = false, corruptAsset = false, omitStartReceipt = false, tamperStartReceipt = false, workerStatus = 200 } = {}) {
  const calls = [];
  let startBody = null;
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://api.github.com/")) {
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, `Bearer ${scenario.inputs.github_token}`);
      const bytes = corruptAsset ? Buffer.from(scenario.asset.bytes).fill(0x42, 30, 40) : scenario.asset.bytes;
      return jsonResponse({
        sha: scenario.publicationEntry.git_blob_sha1,
        encoding: "base64",
        size: bytes.length,
        content: bytes.toString("base64")
      });
    }
    if (url === workerUrl) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, `Bearer ${workerSecret}`);
      startBody = JSON.parse(options.body);
      if (completedReplay) {
        return jsonResponse({
          accepted: true,
          outbox_key: JSON.parse(scenario.inputs.payment_arc2_claim_private).outbox_key,
          state: "COMPLETED",
          idempotent_replay: true,
          immutable_binding_sha256: digest(canonicalJson(scenario.immutable)),
          claim_attempt_count: 1,
          lease_expires_at: null,
          arc2_start_receipt_sha256: "a".repeat(64)
        });
      }
      const handoffId = "6".repeat(64);
      const continuationReady = workerStatus === 200;
      const handoffState = continuationReady ? "INVITATION_READY" : "PAYMENT_VERIFIED";
      const startReceipt = canonicalJson({
        schema: "arc2-review-handoff-start-receipt-v2",
        accepted: true,
        handoff_id: handoffId,
        started_at: new Date().toISOString(),
        payment_evidence_sha256: "8".repeat(64),
        artifact_evidence_sha256: digest(startBody.artifact_evidence),
        bridge_immutable_binding_sha256: digest(canonicalJson(scenario.immutable)),
        review_session_binding_sha256: scenario.immutable.review_session_binding_sha256,
        checkout_session_id_hmac_sha256: scenario.immutable.checkout_session_id_hmac_sha256,
        payment_intent_id_hmac_sha256: scenario.immutable.payment_intent_id_hmac_sha256,
        recipient_email_sha256: tamperStartReceipt ? "0".repeat(64) : scenario.immutable.recipient_email_sha256,
        payer_email_sha256: scenario.immutable.payer_email_sha256,
        handoff_state: handoffState,
        reversal_control_ready: continuationReady,
        continuation_ready: continuationReady
      });
      return jsonResponse({
        accepted: true,
        outbox_key: JSON.parse(scenario.inputs.payment_arc2_claim_private).outbox_key,
        state: workerStatus === 202 ? "PENDING" : "COMPLETED",
        idempotent_replay: false,
        immutable_binding_sha256: digest(canonicalJson(scenario.immutable)),
        claim_attempt_count: 1,
        lease_expires_at: workerStatus === 202 ? null : null,
        arc2_start_receipt_sha256: workerStatus === 202 ? null : digest(startReceipt),
        handoff_id: handoffId,
        handoff_state: handoffState,
        reversal_control_ready: continuationReady,
        ...(!omitStartReceipt ? { start_receipt: startReceipt, start_receipt_hmac_sha256: "7".repeat(64) } : {}),
        ...(workerStatus === 202 ? { retry_required: true } : {})
      }, workerStatus);
    }
    throw new Error(`unexpected network request ${url}`);
  };
  return { fetch, calls, get startBody() { return startBody; } };
}

assert.doesNotThrow(() => new AsyncFunction("inputData", "fetch", "Buffer", source));
assert.doesNotMatch(source, /api\.stripe\.com|stripe_api_key|private_link_reverse_state|payment_link_id|buy\.stripe\.com|\bplink_/i);
assert.match(source, /\/internal\/payment-arc2\/start/);
assert.match(source, /ARC2_CHECKOUT_SESSION_ADAPTER_PAUSED/);
assert.doesNotMatch(retiredSource, /api\.stripe\.com|stripe_api_key|private_link_reverse_state|buy\.stripe\.com|\bplink_/i);
await assert.rejects(runRetired({}, async () => { throw new Error("network must not run"); }, Buffer), /ARC2_RETIRED_RESOLVER/);

let pausedCalls = 0;
const paused = await runAdapter({}, async () => { pausedCalls += 1; throw new Error("paused adapter must not use network"); }, Buffer);
assert.equal(paused.status, "ARC2_CHECKOUT_SESSION_ADAPTER_PAUSED");
assert.equal(paused.artifact_resolution_performed, false);
assert.equal(paused.payment_arc2_start_request_performed, false);
assert.equal(pausedCalls, 0);

const scenario = buildScenario();
const resolvedMock = mockFetch(scenario);
const resolved = await runAdapter(scenario.inputs, resolvedMock.fetch, Buffer);
assert.equal(resolved.status, "READY_FOR_FIRST_PARTY_PAYMENT_ARC2_START");
assert.equal(resolved.payment_arc2_start_request_performed, false);
assert.equal(resolved.artifact_count, 7);
assert.equal(resolved.artifact_manifest_sha256, scenario.finalized.artifactManifestSha256);
assert.equal(resolved.production_content_sha256, scenario.finalized.productionContentSha256);
assert.equal(resolved.bundle_fingerprint, scenario.finalized.bundleFingerprint);
assert.equal(resolved.checkout_session_id_sha256, digest(sessionId));
assert.equal(resolved.outbox_key_sha256, digest(JSON.parse(scenario.inputs.payment_arc2_claim_private).outbox_key));
assert.equal(Object.hasOwn(resolved, "checkout_session_id"), false);
assert.equal(Object.hasOwn(resolved, "outbox_key"), false);
assert.equal(resolvedMock.calls.length, 1);
assert.match(resolvedMock.calls[0].url, /^https:\/\/api\.github\.com\/repos\/arcwebhq-cpu\/arc-previews\/git\/blobs\//);

const startedMock = mockFetch(scenario);
const started = await runAdapter({ ...scenario.inputs, payment_arc2_start_enabled: "true" }, startedMock.fetch, Buffer);
assert.equal(started.status, "PAYMENT_ARC2_START_COMPLETED");
assert.equal(started.payment_arc2_start_request_performed, true);
assert.equal(started.first_party_worker_may_perform_provider_mutations, true);
assert.equal(started.provider_write_allowed_by_this_step, false);
assert.equal(started.stripe_provider_write_allowed_by_this_step, false);
assert.equal(started.github_provider_write_allowed_by_this_step, false);
assert.equal(started.netlify_provider_write_allowed_by_this_step, false);
assert.equal(started.checkout_session_id_sha256, digest(sessionId));
assert.equal(started.outbox_key_sha256, digest(JSON.parse(scenario.inputs.payment_arc2_claim_private).outbox_key));
assert.equal(Object.hasOwn(started, "checkout_session_id"), false);
assert.equal(Object.hasOwn(started, "outbox_key"), false);
assert.equal(startedMock.calls.length, 2);
assert.deepEqual(Object.keys(startedMock.startBody).sort(), [
  "artifact_evidence", "artifact_evidence_hmac_sha256", "checkout_session_id", "claim_token", "deploy_artifacts",
  "lead_notification_email", "lead_route_recipient_hmac_sha256", "outbox_key"
].sort());
const evidence = JSON.parse(startedMock.startBody.artifact_evidence);
const deployArtifacts = JSON.parse(startedMock.startBody.deploy_artifacts);
assert.equal(evidence.version, "arc2-handoff-artifact-evidence-v4");
assert.equal(evidence.checkout_config_snapshot_sha256, scenario.inputs.checkout_offer_snapshot_sha256);
assert.equal(evidence.checkout_reference_sha256, digest(scenario.approvalReceiptSha256));
assert.equal(evidence.artifact_manifest_sha256, scenario.finalized.artifactManifestSha256);
assert.equal(evidence.production_content_sha256, scenario.finalized.productionContentSha256);
assert.equal(evidence.preview_source_commit_sha, sourceCommitSha);
assert.equal(startedMock.startBody.artifact_evidence_hmac_sha256,
  mac(artifactSecret, `arc2-handoff-artifact-evidence-signature-v4\n${startedMock.startBody.artifact_evidence}`));
assert.deepEqual(deployArtifacts.map(entry => entry.path), ["_headers", scenario.asset.path, ...V11_PRODUCTION_HTML_PATHS]);
assert.equal(Buffer.from(deployArtifacts[0].content_base64, "base64").toString("utf8"), V11_PRODUCTION_HEADERS_FILE);
assert.equal(Object.hasOwn(started, "payment_evidence_private"), false);
assert.equal(Object.hasOwn(startedMock.startBody, "payment_evidence"), false);
assert.equal(startedMock.calls.some(call => /stripe\.com/i.test(call.url)), false);

const completedReplayMock = mockFetch(scenario, { completedReplay: true });
const completedReplay = await runAdapter({ ...scenario.inputs, payment_arc2_start_enabled: "true" }, completedReplayMock.fetch, Buffer);
assert.equal(completedReplay.status, "PAYMENT_ARC2_START_COMPLETED");
assert.equal(completedReplay.observed_start_receipt_sha256, "");
assert.equal(completedReplay.first_party_start_receipt_sha256, "a".repeat(64));
assert.equal(completedReplay.handoff_id, "");
assert.equal(completedReplay.retry_required, false);

const retryMock = mockFetch(scenario, { workerStatus: 202 });
const retry = await runAdapter({ ...scenario.inputs, payment_arc2_start_enabled: "true" }, retryMock.fetch, Buffer);
assert.equal(retry.status, "PAYMENT_ARC2_START_RETRY_REQUIRED");
assert.equal(retry.retry_required, true);
assert.match(retry.observed_start_receipt_sha256, /^[a-f0-9]{64}$/);
assert.equal(retry.first_party_start_receipt_sha256, "");

const missingReceiptMock = mockFetch(scenario, { omitStartReceipt: true, workerStatus: 202 });
await assert.rejects(
  runAdapter({ ...scenario.inputs, payment_arc2_start_enabled: "true" }, missingReceiptMock.fetch, Buffer),
  /first-party start binding/
);

const tamperedReceiptMock = mockFetch(scenario, { tamperStartReceipt: true, workerStatus: 202 });
await assert.rejects(
  runAdapter({ ...scenario.inputs, payment_arc2_start_enabled: "true" }, tamperedReceiptMock.fetch, Buffer),
  /signed first-party start receipt/
);

const noFormScenario = buildScenario({ noAsset: true, noForm: true });
const noForm = await runAdapter(noFormScenario.inputs, async () => { throw new Error("no-asset paused-start path needs no network"); }, Buffer);
assert.equal(noForm.status, "READY_FOR_FIRST_PARTY_PAYMENT_ARC2_START");
assert.equal(noForm.artifact_count, 6);

const badClaimValue = JSON.parse(scenario.inputs.payment_arc2_claim_private);
badClaimValue.payload.preview_manifest_sha256 = "0".repeat(64);
badClaimValue.immutable_binding_sha256 = digest(canonicalJson(badClaimValue.payload));
let badClaimCalls = 0;
const badClaimMock = mockFetch(scenario);
await assert.rejects(runAdapter({ ...scenario.inputs, payment_arc2_claim_private: canonicalJson(badClaimValue) }, async (url, options) => {
  badClaimCalls += 1;
  return badClaimMock.fetch(url, options);
}, Buffer), /artifact manifest binding/);
assert.ok(badClaimCalls <= 1, "a manifest mismatch may read only its signed asset before failing and must never POST");

let badSignatureCalls = 0;
await assert.rejects(runAdapter({ ...scenario.inputs, checkout_recipient_reservation_hmac_sha256: "0".repeat(64) }, async () => {
  badSignatureCalls += 1;
  throw new Error("signature failure must precede network");
}, Buffer), /recipient reservation signature/);
assert.equal(badSignatureCalls, 0);

await assert.rejects(runAdapter({ ...scenario.inputs, checkout_session_id: "cs_live_wrongmode" }, async () => {
  throw new Error("mode failure must precede network");
}, Buffer), /configured-mode Checkout Session id/);

const corruptMock = mockFetch(scenario, { corruptAsset: true });
await assert.rejects(runAdapter(scenario.inputs, corruptMock.fetch, Buffer), /GitHub asset binding|signed asset media bytes/);

console.log("ARC2 Checkout Session artifact adapter contract passed (paid outbox -> exact five pages -> first-party start; zero payment-provider reads).");
