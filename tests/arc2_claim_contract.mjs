import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fixtures } from "../fixtures/v11_industries.mjs";
import {
  V11_PRODUCTION_HEADERS_FILE,
  V11_PRODUCTION_HTML_PATHS,
  finalizeV11ProductionSite
} from "../scripts/v11_production_finalizer.mjs";
import { canonicalJson, renderV11Site, sha256 } from "../scripts/v11_site_contract.mjs";
const siteRoot = path.resolve(process.env.ARC_SITE_DIR || "../arc-site");
const { normalizeStartPayload } = await import(pathToFileURL(path.join(siteRoot, "netlify/lib/arc2-handoff-core.mjs")).href);
const { startHandoff } = await import(pathToFileURL(path.join(siteRoot, "netlify/lib/arc2-handoff-service.mjs")).href);

const resolverSource = await readFile(new URL("../zapier/arc2_resolve_and_finalize.js", import.meta.url), "utf8");
const template = await readFile(new URL("../ARC_MASTER_TEMPLATE_V11.html", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runResolverSource = new AsyncFunction("inputData", "fetch", "Buffer", resolverSource);
const fixture = fixtures[0];
const checkoutSecret = "arc2-v4-resolver-checkout-binding-secret-0123456789";
const artifactSecret = "arc2-v4-resolver-artifact-evidence-secret-0123456789";
const publicationSecret = "arc2-v4-publication-receipt-secret-0123456789";
const checkoutKeyId = "01";
const accountId = "acct_ArcV4ResolverContract";
const accountSha256 = sha256(accountId);
const sessionId = "cs_test_ArcV4ResolverContract";
const paymentLinkId = "plink_ArcV4ResolverContract";
const priceId = "price_ArcV4ResolverContract";
const productId = "prod_ArcV4ResolverContract";
const productTaxCode = "txcd_12345678";
const sourceCommitSha = "1".repeat(40);
const sourceTreeSha = "2".repeat(40);
const claimEmail = "buyer@example.test";
const payerEmail = "payer@example.test";
const leadEmail = "leads@example.test";
const nowSeconds = Math.floor(Date.now() / 1000);
const taxRegistrations = [{ country: "US", id: "taxreg_ArcWashington", state: "WA", type: "state_sales_tax" }];

const digest = value => createHash("sha256").update(value).digest("hex");
const mac = (secret, message) => createHmac("sha256", secret).update(message).digest("hex");
const gitSha = value => createHash("sha1").update(value).digest("hex");

function boundedJpeg(size, fill) {
  const prefix = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00
  ]);
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.length - 2, fill), Buffer.from([0xff, 0xd9])], size);
}

function checkoutCreateBody(policy, metadata, includeIntent) {
  const params = new URLSearchParams();
  const set = (name, value) => params.append(name, String(value));
  set("line_items[0][price]", policy.price_id); set("line_items[0][quantity]", "1");
  set("automatic_tax[enabled]", "true"); set("billing_address_collection", "required");
  set("consent_collection[terms_of_service]", "required"); set("custom_fields[0][key]", "adultpurchaserack");
  set("custom_fields[0][label][type]", "custom"); set("custom_fields[0][label][custom]", "I am 18+ and authorized to buy for this business");
  set("custom_fields[0][optional]", "false"); set("custom_fields[0][type]", "dropdown");
  set("custom_fields[0][dropdown][options][0][label]", "I confirm"); set("custom_fields[0][dropdown][options][0][value]", "accepted");
  set("name_collection[business][enabled]", "true"); set("name_collection[business][optional]", "false");
  set("name_collection[individual][enabled]", "true"); set("name_collection[individual][optional]", "false");
  set("after_completion[type]", "redirect"); set("after_completion[redirect][url]", policy.checkout_redirect_url);
  set("restrictions[completed_sessions][limit]", "1"); set("allow_promotion_codes", "false");
  set("customer_creation", "if_required"); set("invoice_creation[enabled]", "false");
  set("phone_number_collection[enabled]", "false"); set("tax_id_collection[enabled]", "false"); set("submit_type", "auto");
  for (const name of Object.keys(metadata).sort()) if (name !== "arc_intent_sha256") set(`metadata[${name}]`, metadata[name]);
  if (includeIntent) set("metadata[arc_intent_sha256]", metadata.arc_intent_sha256);
  return params.toString();
}

function publishedManifest(rendered) {
  return {
    version: "arc-v11-published-preview-bundle-v1",
    pages: V11_PRODUCTION_HTML_PATHS.map(path => {
      const page = rendered.pages.find(item => item.path === path);
      return { path, sha256: sha256(page.html), size: Buffer.byteLength(page.html) };
    })
  };
}

function renderScenario({ noForm = false, noAssets = false } = {}) {
  const baseContent = noForm ? {
    ...fixture.content,
    CONTACT_ACTION_HTML: '<a href="https://booking.example.test/start">Book through the scheduling service</a>'
  } : fixture.content;
  const initial = renderV11Site(template, baseContent, { trustedEventPrefix: fixture.id });
  if (noAssets) {
    const finalized = finalizeV11ProductionSite(initial, { assets: [] });
    return { rendered: initial, finalized, asset: null };
  }
  const assetBytes = boundedJpeg(512, 0x41);
  const assetDigest = sha256(assetBytes);
  const sourceUrl = `https://arcwebhq-cpu.github.io/arc-previews/${initial.folder}/assets/${assetDigest}.jpg`;
  const content = {
    ...baseContent,
    HERO_MEDIA_HTML: `<picture><source srcset="${sourceUrl} 1x"><img src="${sourceUrl}" alt="Customer supplied project"></picture>`
  };
  const rendered = renderV11Site(template, content, { trustedEventPrefix: fixture.id, heroImageUrl: sourceUrl });
  const asset = { path: `assets/${assetDigest}.jpg`, bytes: assetBytes, sourceUrl };
  const finalized = finalizeV11ProductionSite(rendered, { assets: [asset] });
  return { rendered, finalized, asset };
}

function buildScenario(options = {}) {
  const { rendered, finalized, asset } = renderScenario(options);
  const folder = rendered.folder;
  const previewPaths = V11_PRODUCTION_HTML_PATHS.map(path => `${folder}/${path}`);
  const assetGitSha = asset ? gitSha(asset.bytes) : "";
  const publicationEntries = asset ? [{
    asset_id: "9".repeat(64),
    content_type: "image/jpeg",
    git_blob_sha1: assetGitSha,
    public_url: asset.sourceUrl,
    repository_path: `${folder}/${asset.path}`,
    role: "hero_image_file",
    sha256: sha256(asset.bytes),
    size_bytes: asset.bytes.length
  }] : [];
  const publication = canonicalJson({
    version: "arc1-public-asset-publication-receipt-v1",
    scope: "github-content-addressed-preview-assets",
    bridge_contract_sha256: "c4ab396bf04464629624dd19a37602755c8d429db0bf729b49bbfdfdba3ae20c",
    delivery_id: "3".repeat(64),
    bridge_evidence_sha256: "4".repeat(64),
    private_asset_receipt_sha256: "5".repeat(64),
    intake_evidence_sha256: "6".repeat(64),
    intake_state_digest_sha256: "7".repeat(64),
    asset_manifest_sha256: "8".repeat(64),
    asset_permission: asset ? "Confirmed" : "",
    repository: "arcwebhq-cpu/arc-previews",
    base_branch: "main",
    preview_branch: `arc-preview/${folder.slice(-8)}`,
    pages_base_url: "https://arcwebhq-cpu.github.io/arc-previews",
    public_folder_prefix: folder.slice(-8),
    preview_folder: folder,
    entries: publicationEntries,
    status: asset ? "VERIFIED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS"
  });
  const publicationSha256 = sha256(publication);
  const leadRouteMode = finalized.leadRouteMode;
  const leadRouteFormName = finalized.leadRouteFormName;
  const leadRecipientHmac = leadRouteMode === "netlify_form"
    ? mac(checkoutSecret, `arc-checkout-lead-recipient-v1\ntest\n${leadEmail}`) : "";
  const offerSnapshotSha256 = "a".repeat(64);
  const recipient = canonicalJson({
    version: "arc1-checkout-recipient-reservation-v2",
    scope: "private-recipients-for-approved-five-page-checkout",
    offer_contract_id: "arc-fixed-five-page-offer-v1",
    deliverable: "fixed-five-page-marketing-website-v1",
    page_count: 5,
    preview_folder: folder,
    preview_paths: previewPaths,
    approval_content_sha256: rendered.approvalBundleSha256,
    published_preview_bundle_sha256: sha256(canonicalJson(publishedManifest(rendered))),
    production_content_sha256: finalized.productionContentSha256,
    checkout_offer_snapshot_sha256: offerSnapshotSha256,
    checkout_binding_key_id: checkoutKeyId,
    stripe_mode: "test",
    lead_route_mode: leadRouteMode,
    lead_route_form_name: leadRouteFormName,
    lead_route_recipient_hmac_sha256: leadRecipientHmac,
    lead_notification_email: leadRouteMode === "netlify_form" ? leadEmail : "",
    claim_recipient_email: claimEmail,
    claim_recipient_email_sha256: sha256(claimEmail)
  });
  const recipientSha256 = sha256(recipient);
  const policy = canonicalJson({
    version: "arc-private-checkout-policy-v2",
    scope: "one-approved-five-page-preview-one-private-payment-link",
    checkout_binding_key_id: checkoutKeyId,
    stripe_mode: "test",
    stripe_account_id_sha256: accountSha256,
    price_id: priceId,
    product_id: productId,
    amount_subtotal_minor_units: 500000,
    currency: "usd",
    quantity: 1,
    terms_version: "2026-08-25",
    terms_document_sha256: "b".repeat(64),
    automatic_tax_enabled: true,
    customer_address_source: "stripe_checkout_customer_details.address",
    price_tax_behavior: "exclusive",
    product_tax_code: productTaxCode,
    tax_contract_version: "arc-tax-v1",
    tax_registrations: taxRegistrations,
    tax_registrations_sha256: sha256(canonicalJson(taxRegistrations)),
    adult_acknowledgement_key: "adultpurchaserack",
    name_collection_required: true,
    checkout_redirect_url: "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}",
    completed_sessions_limit: 1,
    stripe_api_version: "2026-07-29.dahlia",
    offer_contract_id: "arc-fixed-five-page-offer-v1",
    deliverable: "fixed-five-page-marketing-website-v1",
    page_count: 5,
    preview_source_repository: "arcwebhq-cpu/arc-previews",
    preview_folder: folder,
    preview_paths: previewPaths,
    approval_content_sha256: rendered.approvalBundleSha256,
    content_sha256: sha256(canonicalJson(publishedManifest(rendered))),
    published_site_sha256: finalized.productionContentSha256,
    source_commit_sha: sourceCommitSha,
    source_tree_sha: sourceTreeSha,
    asset_publication_receipt_sha256: publicationSha256,
    lead_route_recipient_hmac_sha256: leadRecipientHmac,
    claim_recipient_email_sha256: sha256(claimEmail),
    readiness_core_sha256: "c".repeat(64),
    offer_snapshot_sha256: offerSnapshotSha256,
    recipient_reservation_sha256: recipientSha256
  });
  const policySha256 = sha256(policy);
  const referencePayload = Buffer.concat([
    Buffer.from(checkoutKeyId, "hex"),
    Buffer.from(folder.slice(-8), "hex"),
    Buffer.from(rendered.approvalBundleSha256, "hex"),
    Buffer.from(policySha256, "hex")
  ]);
  const referenceMac = createHmac("sha256", checkoutSecret)
    .update("arc-checkout-reference-v4\narcwebhq-cpu/arc-previews\narc-production\nstripe-test\n")
    .update(referencePayload).digest();
  const checkoutReference = `v4_${Buffer.concat([referencePayload, referenceMac]).toString("base64url")}`;
  const checkoutReferenceSha256 = sha256(checkoutReference);
  const metadata = {
    arc_intent_sha256: "",
    arc_policy_sha256: policySha256,
    arc_preview_commit: sourceCommitSha,
    arc_v4_ref: checkoutReference,
    arc_v4_ref_sha256: checkoutReferenceSha256,
    tax_contract_version: "arc-tax-v1",
    terms_document_sha256: "b".repeat(64),
    terms_version: "2026-08-25"
  };
  metadata.arc_intent_sha256 = sha256(checkoutCreateBody(JSON.parse(policy), metadata, false));
  const createRequestSha256 = sha256(checkoutCreateBody(JSON.parse(policy), metadata, true));
  const paymentLinkUrl = "https://buy.stripe.com/test_ArcV4Resolver";
  const linkReceipt = canonicalJson({
    version: "arc-private-checkout-link-receipt-v1",
    scope: "validated-one-use-private-payment-link",
    payment_link_id: paymentLinkId,
    payment_link_url_sha256: sha256(paymentLinkUrl),
    checkout_reference_sha256: checkoutReferenceSha256,
    checkout_policy_sha256: policySha256,
    provider_intent_sha256: metadata.arc_intent_sha256,
    create_request_sha256: createRequestSha256,
    stripe_mode: "test",
    stripe_account_id_sha256: accountSha256,
    credential_key_id: "arc_test_rak_v4",
    readback_sha256: sha256(canonicalJson({ id: paymentLinkId, active: true, livemode: false, url_sha256: sha256(paymentLinkUrl),
      metadata, completed_sessions_limit: 1, price_id: priceId, product_id: productId }))
  });
  const reverse = canonicalJson({
    version: "arc-private-checkout-link-reverse-v1",
    scope: "private-link-id-to-approved-reference",
    link_id_hmac_sha256: mac(checkoutSecret, `arc-private-checkout-link-id-key-v1\ntest\n${paymentLinkId}`),
    payment_link_id: paymentLinkId,
    checkout_reference: checkoutReference,
    checkout_reference_sha256: checkoutReferenceSha256,
    checkout_policy_private: policy,
    checkout_policy_sha256: policySha256,
    checkout_recipient_reservation_private: recipient,
    checkout_recipient_reservation_hmac_sha256: mac(checkoutSecret, `arc1-checkout-recipient-reservation-signature-v2\ntest\n${recipient}`),
    link_receipt_private: linkReceipt,
    link_receipt_sha256: sha256(linkReceipt),
    link_receipt_hmac_sha256: mac(checkoutSecret, `arc-private-checkout-link-receipt-signature-v1\ntest\n${linkReceipt}`)
  });

  const product = { object: "product", id: productId, tax_code: productTaxCode };
  const price = { object: "price", id: priceId, livemode: false, type: "one_time", currency: "usd", unit_amount: 500000,
    custom_unit_amount: null, recurring: null, tax_behavior: "exclusive", product };
  const lineItem = { object: "item", quantity: 1, currency: "usd", amount_subtotal: 500000, amount_discount: 0,
    amount_tax: 50000, amount_total: 550000, price };
  const adultField = [{ key: "adultpurchaserack", type: "dropdown", optional: false,
    label: { type: "custom", custom: "I am 18+ and authorized to buy for this business" },
    dropdown: { options: [{ label: "I confirm", value: "accepted" }], value: "accepted" } }];
  const session = {
    object: "checkout.session", id: sessionId, created: nowSeconds - 30, livemode: false, mode: "payment", status: "complete", payment_status: "paid",
    currency: "usd", amount_subtotal: 500000, amount_total: 550000, total_details: { amount_tax: 50000, amount_discount: 0, amount_shipping: 0 },
    automatic_tax: { enabled: true, status: "complete" }, payment_link: paymentLinkId, client_reference_id: checkoutReference,
    consent: { terms_of_service: "accepted" }, metadata, custom_fields: adultField,
    collected_information: { business_name: "ZXQ Business 918273", individual_name: "ZXQ Purchaser 918273" },
    customer_details: { email: payerEmail, phone: null, tax_exempt: "none",
      address: { line1: "918273 Secluded Avenue", line2: "", city: "Zqxville", state: "WA", postal_code: "98101", country: "US" } },
    customer_email: payerEmail,
    line_items: { object: "list", has_more: false, data: [lineItem] },
    payment_intent: { object: "payment_intent", id: "pi_ArcV4ResolverContract", status: "succeeded", livemode: false,
      amount: 550000, amount_received: 550000, currency: "usd", latest_charge: { object: "charge", id: "ch_ArcV4ResolverContract",
        created: nowSeconds - 10, paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false, status: "succeeded",
        livemode: false, payment_intent: "pi_ArcV4ResolverContract", amount: 550000, currency: "usd" } }
  };
  const paidLink = {
    object: "payment_link", id: paymentLinkId, livemode: false, active: true, url: paymentLinkUrl,
    restrictions: { completed_sessions: { limit: 1 } }, automatic_tax: { enabled: true }, billing_address_collection: "required",
    consent_collection: { terms_of_service: "required" }, allow_promotion_codes: false, custom_fields: adultField.map(field => ({ ...field, dropdown: { options: field.dropdown.options } })),
    name_collection: { business: { enabled: true, optional: false }, individual: { enabled: true, optional: false } }, submit_type: "auto",
    after_completion: { type: "redirect", redirect: { url: "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}" } },
    customer_creation: "if_required", invoice_creation: { enabled: false }, phone_number_collection: { enabled: false }, tax_id_collection: { enabled: false },
    shipping_address_collection: null, optional_items: [], metadata,
    line_items: { object: "list", has_more: false, data: [{ quantity: 1, price }] }
  };

  const pageShaByPath = new Map(rendered.pages.map(page => [page.path, gitSha(page.path)]));
  const blobs = new Map(rendered.pages.map(page => [pageShaByPath.get(page.path), Buffer.from(page.html)]));
  if (asset) blobs.set(assetGitSha, asset.bytes);
  const treeItems = [
    { path: folder, type: "tree", mode: "040000", sha: gitSha(folder) },
    ...["about", "contact", "process", "services", ...(asset ? ["assets"] : [])].map(name =>
      ({ path: `${folder}/${name}`, type: "tree", mode: "040000", sha: gitSha(`${folder}/${name}`) })),
    ...V11_PRODUCTION_HTML_PATHS.map(path => ({ path: `${folder}/${path}`, type: "blob", mode: "100644", sha: pageShaByPath.get(path), size: blobs.get(pageShaByPath.get(path)).length })),
    ...(asset ? [{ path: `${folder}/${asset.path}`, type: "blob", mode: "100644", sha: assetGitSha, size: asset.bytes.length }] : [])
  ];
  const inputs = {
    checkout_session_id: sessionId,
    stripe_api_key: "rk_test_ArcV4ResolverContract0123456789",
    stripe_live_mode_enabled: "false",
    checkout_binding_key_id: checkoutKeyId,
    checkout_binding_secret: checkoutSecret,
    retired_checkout_binding_keys_json: "{}",
    handoff_artifact_evidence_secret: artifactSecret,
    private_link_reverse_state: reverse,
    asset_publication_receipt_private: publication,
    asset_publication_receipt_sha256: publicationSha256,
    asset_publication_receipt_hmac_sha256: mac(publicationSecret, `arc1-public-asset-publication-receipt-v1\n${publication}`),
    asset_publication_receipt_secret: publicationSecret,
    preview_source_github_owner: "arcwebhq-cpu",
    preview_source_github_repo: "arc-previews",
    preview_source_github_branch: "main",
    github_token: "github-token",
    provider_operation_timeout_ms: "25000"
  };
  return { inputs, rendered, finalized, asset, policy, reverse, publication, recipient, linkReceipt, checkoutReference,
    checkoutReferenceSha256, metadata, session, paidLink, treeItems, blobs, pageShaByPath };
}

function mockFetch(scenario, mutations = {}) {
  const calls = [];
  const requests = [];
  const fetch = async (url, options = {}) => {
    calls.push(String(url));
    requests.push({ url: String(url), options });
    if (url === "https://api.stripe.com/v1/account") return jsonResponse({ object: "account", id: accountId });
    if (String(url).includes("/v1/checkout/sessions/")) return jsonResponse(scenario.session);
    if (String(url).includes("/v1/payment_links/")) return jsonResponse(scenario.paidLink);
    if (String(url).includes("/git/ref/")) return jsonResponse({ ref: `refs/tags/arc-checkout-ready-v4/${scenario.checkoutReferenceSha256}`,
      object: { type: "commit", sha: sourceCommitSha } });
    if (String(url).endsWith(`/git/commits/${sourceCommitSha}`)) return jsonResponse({ sha: sourceCommitSha, tree: { sha: sourceTreeSha } });
    if (String(url).includes(`/git/trees/${sourceTreeSha}`)) return jsonResponse({ sha: sourceTreeSha, truncated: false,
      tree: mutations.treeItems || scenario.treeItems });
    const blobSha = String(url).split("/git/blobs/")[1];
    if (blobSha) {
      const bytes = mutations.blobs?.get(blobSha) || scenario.blobs.get(blobSha);
      if (!bytes) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse({ sha: blobSha, encoding: "base64", size: bytes.length, content: bytes.toString("base64") });
    }
    throw new Error(`Unexpected resolver request: ${url}`);
  };
  return { fetch, calls, requests };
}

function jsonResponse(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, { status, headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } });
}

async function runScenario(scenario, mutations) {
  const mocked = mockFetch(scenario, mutations);
  return { output: await runResolverSource(scenario.inputs, mocked.fetch, Buffer), calls: mocked.calls, requests: mocked.requests };
}

const scenario = buildScenario();
const first = await runScenario(scenario);
const second = await runScenario(scenario);
assert.equal(first.output.status, "READY_FOR_CLAIMABLE_DEPLOY");
assert.equal(first.output.provider_write_allowed_by_this_step, false);
assert.equal(first.output.external_deploy_write_allowed_by_this_step, false);
assert.equal(first.output.claim_invitation_allowed_by_this_step, false);
assert.equal(first.output.email_allowed_by_this_step, false);
for (const flag of ["stripe_provider_write_allowed_by_this_step", "github_provider_write_allowed_by_this_step",
  "netlify_provider_write_allowed_by_this_step", "state_write_allowed_by_this_step", "delivery_email_send_allowed_by_this_step"]) {
  assert.equal(first.output[flag], false, `${flag} must remain false in the read-only resolver`);
}
assert.equal(first.output.terms_version, "2026-08-25");
assert.deepEqual(first.output.production_page_paths, V11_PRODUCTION_HTML_PATHS);
assert.deepEqual(first.output.preview_paths, V11_PRODUCTION_HTML_PATHS.map(path => `${scenario.rendered.folder}/${path}`));
for (const request of first.requests.filter(item => item.url.startsWith("https://api.stripe.com/"))) {
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers["Stripe-Version"], "2026-07-29.dahlia");
  assert.match(request.options.headers.Authorization, /^Basic [A-Za-z0-9+/]+=*$/);
}
for (const request of first.requests.filter(item => item.url.startsWith("https://api.github.com/"))) {
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer github-token");
  assert.equal(request.options.headers["X-GitHub-Api-Version"], "2022-11-28");
}
assert.equal(first.calls.filter(url => url.includes("/git/blobs/") && scenario.pageShaByPath.has([...scenario.pageShaByPath].find(([, sha]) => url.endsWith(sha))?.[0])).length, 5);
for (const path of V11_PRODUCTION_HTML_PATHS) {
  assert.equal(first.calls.filter(url => url.endsWith(`/git/blobs/${scenario.pageShaByPath.get(path)}`)).length, 1, `${path} must be read exactly once`);
}
assert.equal(first.output.production_content_sha256, scenario.finalized.productionContentSha256);
assert.equal(first.output.bundle_fingerprint, scenario.finalized.bundleFingerprint);
assert.equal(first.output.artifact_manifest_sha256, scenario.finalized.artifactManifestSha256);
assert.equal(first.output.deploy_artifacts_private, scenario.finalized.deployArtifactsJson);
assert.equal(first.output.handoff_artifact_evidence_private, second.output.handoff_artifact_evidence_private, "evidence must be deterministic for one Charge timestamp");
assert.equal(first.output.payment_evidence_private, second.output.payment_evidence_private);
assert.equal(first.output.handoff_start_payload_private, second.output.handoff_start_payload_private);
assert.equal(Object.hasOwn(first.output, "production_content_base64"), false, "Home-only production fallback must be removed");
assert.equal(Object.hasOwn(first.output, "preview_file_path"), false, "singular preview fallback must be removed");
assert.doesNotMatch(resolverSource, /(?:paidLinkProduct|product)\?\.tax_code/,
  "paid replay must not read a mutable current Product tax code");

const historicalTaxScenario = buildScenario();
historicalTaxScenario.session.line_items.data[0].price.product.tax_code = "txcd_87654321";
const historicalTaxReplay = await runScenario(historicalTaxScenario);
assert.equal(historicalTaxReplay.output.status, "READY_FOR_CLAIMABLE_DEPLOY",
  "a completed payment must replay from the signed pre-exposure tax snapshot after mutable Product tax-code drift");
assert.equal(JSON.parse(historicalTaxReplay.output.payment_evidence_private).product_tax_code, productTaxCode);

const artifactEvidence = JSON.parse(first.output.handoff_artifact_evidence_private);
const paymentEvidence = JSON.parse(first.output.payment_evidence_private);
const deployArtifacts = JSON.parse(first.output.deploy_artifacts_private);
assert.equal(artifactEvidence.version, "arc2-handoff-artifact-evidence-v4");
assert.equal(paymentEvidence.version, "arc2-payment-evidence-v4");
assert.deepEqual(artifactEvidence.artifacts.map(entry => entry.path), ["_headers", scenario.asset.path, ...V11_PRODUCTION_HTML_PATHS]);
assert.equal(Buffer.from(deployArtifacts[0].content_base64, "base64").toString("utf8"), V11_PRODUCTION_HEADERS_FILE);
assert.equal(artifactEvidence.preview_source_tag_sha256, sha256(`refs/tags/arc-checkout-ready-v4/${scenario.checkoutReferenceSha256}`));
assert.equal(paymentEvidence.checkout_config_snapshot, scenario.policy);
assert.equal(paymentEvidence.production_content_sha256, artifactEvidence.production_content_sha256);
assert.equal(paymentEvidence.artifact_manifest_sha256, artifactEvidence.artifact_manifest_sha256);
assert.equal(paymentEvidence.bundle_fingerprint, artifactEvidence.bundle_fingerprint);
assert.equal(paymentEvidence.handoff_artifact_evidence_sha256, sha256(first.output.handoff_artifact_evidence_private));
assert.equal(first.output.payment_evidence_hmac_sha256,
  mac(checkoutSecret, `arc2-payment-evidence-signature-v4\ntest\n${first.output.payment_evidence_private}`));
assert.equal(first.output.handoff_artifact_evidence_hmac_sha256,
  mac(artifactSecret, `arc2-handoff-artifact-evidence-signature-v4\n${first.output.handoff_artifact_evidence_private}`));

const startInput = JSON.parse(first.output.handoff_start_payload_private);
const siblingEnv = {
  ARC_CHECKOUT_BINDING_SECRET: checkoutSecret,
  ARC_CHECKOUT_BINDING_KEY_ID: checkoutKeyId,
  ARC_RETIRED_CHECKOUT_BINDING_KEYS_JSON: "{}",
  ARC_HANDOFF_ARTIFACT_EVIDENCE_SECRET: artifactSecret,
  ARC_STRIPE_LIVE_MODE_ENABLED: "false"
};
const normalized = normalizeStartPayload(startInput, siblingEnv, new Date());
assert.deepEqual(normalized.deployArtifacts.map(entry => entry.path), ["_headers", scenario.asset.path, ...V11_PRODUCTION_HTML_PATHS]);
assert.equal(normalized.payment.value.version, "arc2-payment-evidence-v4");
assert.equal(normalized.artifact.value.version, "arc2-handoff-artifact-evidence-v4");
assert.equal(normalized.formName, scenario.finalized.leadRouteFormName);

class FakeStore {
  values = new Map();
  writes = 0;
  counter = 0;
  async getWithMetadata(key) {
    const entry = this.values.get(key);
    return entry ? { data: structuredClone(entry.data), etag: entry.etag, metadata: {} } : null;
  }
  async setJSON(key, data, options = {}) {
    const current = this.values.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) return { modified: false };
    const etag = `etag-${++this.counter}`;
    this.values.set(key, { data: structuredClone(data), etag });
    this.writes += 1;
    return { modified: true, etag };
  }
}
const startStore = new FakeStore();
const startResult = await startHandoff(startInput, {
  ...siblingEnv,
  ARC_HANDOFF_STATE_SECRET: "arc2-sibling-state-secret-01234567890123456789",
  ARC_STRIPE_CHECKOUT_LEDGER_ENABLED: "false",
  ARC_STRIPE_CHECKOUT_LEDGER_REQUIRED: "false",
  ARC_RUNTIME_ENVIRONMENT: "sandbox",
  ARC_ALLOW_TEST_MODE_EVENTS: "true",
  ARC_HANDOFF_ENABLED: "false",
  ARC_EXPECTED_STRIPE_ACCOUNT_ID_SHA256: accountSha256,
  ARC_STRIPE_ACCOUNT_VERIFICATION_KEY: "rk_test_arc2ResolverAccountRead0123456789",
  ARC_STRIPE_LIVE_MODE_ENABLED: "false",
  ARC_STRIPE_REVERSAL_CONTROL_REQUIRED: "true",
  ARC_STRIPE_REVERSAL_WEBHOOK_ENABLED: "true",
  ARC_STRIPE_REVERSAL_BINDING_ENABLED: "true",
  ARC_STRIPE_REVERSAL_RECHECK_ENABLED: "true",
  ARC_STRIPE_WEBHOOK_API_VERSION: "2026-07-29.dahlia",
  ARC_STRIPE_WEBHOOK_SIGNING_SECRET: "arc2-webhook-signing-secret-01234567890123456789",
  ARC_STRIPE_REVERSAL_HMAC_SECRET: "arc2-reversal-hmac-secret-01234567890123456789",
  ARC_STRIPE_REVERSAL_BINDING_SECRET: "arc2-reversal-binding-secret-01234567890123456789",
  ARC_STRIPE_REVERSAL_BINDING_ENDPOINT_SECRET: "arc2-reversal-binding-endpoint-secret-0123456789",
  ARC_STRIPE_REVERSAL_RECHECK_SECRET: "arc2-reversal-recheck-secret-01234567890123456789",
  ARC_STRIPE_REVERSAL_RECHECK_ENDPOINT_SECRET: "arc2-reversal-recheck-endpoint-secret-0123456789"
}, {
  store: startStore,
  clock: () => new Date(),
  uuid: () => "33333333-3333-4333-8333-333333333333",
  fetch: async () => { throw new Error("fresh v4 bootstrap must reserve before provider access"); }
});
assert.equal(startResult.record.state, "PAYMENT_VERIFIED", "sibling start service must accept and reserve the exact resolver payload");
assert.equal(startResult.reversalControlReady, false);
assert.ok(startStore.writes >= 3, "start compatibility must exercise immutable reference/session reservations plus the handoff row");

const secondarySha = scenario.pageShaByPath.get("about/index.html");
const tamperedBlobs = new Map(scenario.blobs);
const secondaryBytes = Buffer.from(tamperedBlobs.get(secondarySha));
secondaryBytes[secondaryBytes.indexOf(Buffer.from("About"))] ^= 1;
tamperedBlobs.set(secondarySha, secondaryBytes);
await assert.rejects(runScenario(scenario, { blobs: tamperedBlobs }), /published five-page manifest|approval manifest|v11 private preview/i,
  "a secondary-page byte change must fail even when Home is untouched");

for (const [label, mutate, expected] of [
  ["missing page", items => items.filter(item => item.path !== `${scenario.rendered.folder}/process/index.html`), /missing or extra paths/],
  ["extra page", items => [...items, { path: `${scenario.rendered.folder}/team/index.html`, type: "blob", mode: "100644", sha: "d".repeat(40), size: 10 }], /missing or extra paths/],
  ["missing asset", items => items.filter(item => item.path !== `${scenario.rendered.folder}/${scenario.asset.path}`), /missing or extra paths/],
  ["extra asset", items => [...items, { path: `${scenario.rendered.folder}/assets/${"e".repeat(64)}.png`, type: "blob", mode: "100644", sha: "e".repeat(40), size: 68 }], /missing or extra paths/]
]) {
  await assert.rejects(runScenario(scenario, { treeItems: mutate(scenario.treeItems) }), expected, label);
}
const oversizedPageTree = scenario.treeItems.map(item => item.path === `${scenario.rendered.folder}/about/index.html`
  ? { ...item, size: 150001 } : item);
await assert.rejects(runScenario(scenario, { treeItems: oversizedPageTree }), /missing|exceeds|binding/i, "per-page source cap must fail closed");

let preflightNetworkCalls = 0;
const v3Reverse = canonicalJson({ ...JSON.parse(scenario.reverse), checkout_reference: `v3_${scenario.checkoutReference.slice(3)}` });
await assert.rejects(runResolverSource({ ...scenario.inputs, private_link_reverse_state: v3Reverse }, async () => {
  preflightNetworkCalls += 1;
  throw new Error("v3 must fail before network");
}, Buffer), /requires an exact checkout reference v4 reservation/);
const mixedPolicy = canonicalJson({ ...JSON.parse(scenario.policy), version: "arc-private-checkout-policy-v1" });
const mixedReverse = canonicalJson({ ...JSON.parse(scenario.reverse), checkout_policy_private: mixedPolicy });
await assert.rejects(runResolverSource({ ...scenario.inputs, private_link_reverse_state: mixedReverse }, async () => {
  preflightNetworkCalls += 1;
  throw new Error("mixed versions must fail before network");
}, Buffer), /exact v4 five-page private checkout policy|policy binding/);
await assert.rejects(runResolverSource({ ...scenario.inputs, asset_publication_receipt_hmac_sha256: "0".repeat(64) }, async () => {
  preflightNetworkCalls += 1;
  throw new Error("invalid publication HMAC must fail before network");
}, Buffer), /publication receipt HMAC/);
assert.equal(preflightNetworkCalls, 0, "fresh v3, mixed/cross pairs, and unauthenticated publication receipts must fail before provider reads or mutations");

const noFormScenario = buildScenario({ noForm: true });
const noForm = await runScenario(noFormScenario);
const noFormEvidence = JSON.parse(noForm.output.handoff_artifact_evidence_private);
const noFormStart = JSON.parse(noForm.output.handoff_start_payload_private);
assert.equal(noFormEvidence.lead_route_mode, "not_required");
assert.equal(noFormEvidence.lead_route_form_name, "");
assert.equal(noFormEvidence.lead_route_recipient_hmac_sha256, "");
assert.equal(noFormStart.lead_notification_email, "");
assert.equal(noFormStart.lead_route_recipient_hmac_sha256, "");
assert.equal(normalizeStartPayload(noFormStart, siblingEnv, new Date()).formName, "");

const noAssetScenario = buildScenario({ noAssets: true });
const noAsset = await runScenario(noAssetScenario);
assert.equal(noAsset.output.artifact_count, 6, "zero approved assets must produce the exact six-artifact minimum");
assert.deepEqual(JSON.parse(noAsset.output.deploy_artifacts_private).map(entry => entry.path),
  ["_headers", ...V11_PRODUCTION_HTML_PATHS]);
assert.equal(noAsset.output.deploy_artifacts_private, noAssetScenario.finalized.deployArtifactsJson);

const mixedArtifactStart = { ...startInput, artifact_evidence: noForm.output.handoff_artifact_evidence_private,
  artifact_evidence_hmac_sha256: noForm.output.handoff_artifact_evidence_hmac_sha256 };
assert.throws(() => normalizeStartPayload(mixedArtifactStart, siblingEnv, new Date()), /binding|match|invalid|unbound/i,
  "cross-paired v4 artifact/payment evidence must fail in the sibling normalizer");

console.log("ARC2 exact five-page v4 resolver and sibling handoff contract passed");
