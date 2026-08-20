import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { slugify } from "./arc_contract.mjs";
import { validateGeneratedFormContract } from "./content_sanitizer.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function clean(value) {
  return String(value ?? "").trim();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function validatePaidSession(session, {
  expectedPaymentLinkId,
  expectedPriceId,
  expectedTermsVersion,
  expectedProductTaxCode,
  stripeLiveModeEnabled = false
} = {}) {
  const id = clean(session?.id);
  const object = clean(session?.object);
  const mode = clean(session?.mode).toLowerCase();
  const status = clean(session?.status).toLowerCase();
  const paymentStatus = clean(session?.payment_status).toLowerCase();
  const currency = clean(session?.currency).toLowerCase();
  const amountTotal = session?.amount_total;
  const amountSubtotal = session?.amount_subtotal;
  const amountTax = session?.total_details?.amount_tax;
  const paymentLinkId = clean(
    session?.payment_link && typeof session.payment_link === "object"
      ? session.payment_link.id
      : session?.payment_link
  );
  const requiredPaymentLinkId = clean(expectedPaymentLinkId);
  const requiredPriceId = clean(expectedPriceId);
  const termsConsent = clean(session?.consent?.terms_of_service).toLowerCase();
  const termsVersion = clean(session?.metadata?.terms_version);
  const requiredTermsVersion = clean(expectedTermsVersion);
  const requiredProductTaxCode = clean(expectedProductTaxCode);
  const customerDetailsEmail = clean(session?.customer_details?.email).toLowerCase();
  const customerEmail = clean(session?.customer_email).toLowerCase();
  const adultAcknowledgements = (Array.isArray(session?.custom_fields) ? session.custom_fields : []).filter(field =>
    field && typeof field === "object" && clean(field.key) === "adultpurchaserack"
  );
  const adultAcknowledgement = clean(
    adultAcknowledgements[0]?.dropdown?.value ||
    adultAcknowledgements[0]?.text?.value ||
    adultAcknowledgements[0]?.numeric?.value
  ).toLowerCase();
  const stripeMode = stripeLiveModeEnabled ? "live" : "test";
  if (!new RegExp(`^cs_${stripeMode}_[A-Za-z0-9_]+$`).test(id)) throw new Error(`ARC_PAYMENT_INVALID: ${stripeMode} checkout session id`);
  if (object !== "checkout.session") throw new Error("ARC_PAYMENT_INVALID: Checkout Session object identity");
  if (session?.livemode !== stripeLiveModeEnabled) throw new Error("ARC_PAYMENT_INVALID: Checkout Session livemode does not match configured Stripe mode");
  if (mode !== "payment" || status !== "complete") {
    throw new Error("ARC_PAYMENT_INVALID: Checkout Session must be a completed one-time payment");
  }
  if (paymentStatus !== "paid") throw new Error("ARC_PAYMENT_INVALID: session is not paid");
  if (currency !== "usd") throw new Error("ARC_PAYMENT_INVALID: currency must be usd");
  if (!Number.isSafeInteger(amountSubtotal) || amountSubtotal !== 500000) {
    throw new Error("ARC_PAYMENT_INVALID: amount_subtotal must be exactly 500000 minor units ($5,000.00)");
  }
  if (!Number.isSafeInteger(amountTax) || amountTax < 0 || !Number.isSafeInteger(amountTotal) ||
      amountTotal !== amountSubtotal + amountTax || session?.total_details?.amount_discount !== 0 ||
      session?.total_details?.amount_shipping !== 0) {
    throw new Error("ARC_TAX_INVALID: total must equal the $5,000 subtotal plus Stripe-calculated tax");
  }
  if (session?.automatic_tax?.enabled !== true || clean(session?.automatic_tax?.status) !== "complete") {
    throw new Error("ARC_TAX_INVALID: Stripe automatic tax must be enabled and complete");
  }
  if (!/^plink_[A-Za-z0-9]+$/.test(requiredPaymentLinkId)) throw new Error("ARC_PAYMENT_INVALID: expected Payment Link id");
  if (paymentLinkId !== requiredPaymentLinkId) throw new Error("ARC_PAYMENT_INVALID: Payment Link identity mismatch");
  if (!/^price_[A-Za-z0-9]+$/.test(requiredPriceId)) throw new Error("ARC_PAYMENT_INVALID: expected Price id");
  if (!/^txcd_[0-9]{8}$/.test(requiredProductTaxCode)) throw new Error("ARC_TAX_INVALID: expected product tax code");
  const lineItems = session?.line_items;
  if (!lineItems || typeof lineItems !== "object" || Array.isArray(lineItems) || lineItems.object !== "list" ||
      lineItems.has_more !== false || !Array.isArray(lineItems.data) || lineItems.data.length !== 1) {
    throw new Error("ARC_PAYMENT_INVALID: exactly one fully expanded line item is required");
  }
  const lineItem = lineItems.data[0];
  const price = lineItem?.price;
  const product = price?.product;
  if (!lineItem || lineItem.object !== "item" || lineItem.quantity !== 1 || lineItem.currency !== "usd" ||
      lineItem.amount_subtotal !== 500000 || lineItem.amount_discount !== 0 || lineItem.amount_tax !== amountTax ||
      lineItem.amount_total !== amountTotal || !price || typeof price !== "object" || Array.isArray(price) ||
      price.object !== "price" || price.id !== requiredPriceId || price.livemode !== stripeLiveModeEnabled ||
      price.type !== "one_time" || price.currency !== "usd" || price.unit_amount !== 500000 ||
      price.custom_unit_amount !== null || price.recurring !== null || clean(price.tax_behavior) !== "exclusive" ||
      !product || typeof product !== "object" || Array.isArray(product) || product.object !== "product" ||
      clean(typeof product.tax_code === "object" ? product.tax_code?.id : product.tax_code) !== requiredProductTaxCode) {
    throw new Error("ARC_PAYMENT_INVALID: expanded line item does not match the exact exclusive-tax ARC Price and Product");
  }
  if (termsConsent !== "accepted") throw new Error("ARC_PAYMENT_INVALID: terms_of_service consent must be accepted");
  if (!requiredTermsVersion) throw new Error("ARC_PAYMENT_INVALID: expected terms version");
  if (termsVersion !== requiredTermsVersion) throw new Error("ARC_PAYMENT_INVALID: terms version mismatch");
  if (clean(session?.metadata?.tax_contract_version) !== "arc-tax-v1") {
    throw new Error("ARC_TAX_INVALID: tax contract version mismatch");
  }
  if (adultAcknowledgements.length !== 1 || adultAcknowledgement !== "accepted" ||
      clean(adultAcknowledgements[0].type) !== "dropdown" || adultAcknowledgements[0].optional !== false ||
      clean(adultAcknowledgements[0].label?.type) !== "custom" ||
      clean(adultAcknowledgements[0].label?.custom) !== "I am 18+ and authorized to buy for this business") {
    throw new Error("ARC_PAYMENT_INVALID: adult purchaser acknowledgement must be accepted");
  }
  if (customerDetailsEmail && customerEmail && customerDetailsEmail !== customerEmail) {
    throw new Error("ARC_HANDOFF_INVALID: Stripe customer email fields disagree");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerDetailsEmail || customerEmail)) {
    throw new Error("ARC_HANDOFF_INVALID: Stripe customer email");
  }
  if (clean(session?.customer_details?.tax_exempt) !== "none") {
    throw new Error("ARC_TAX_INVALID: tax-exempt customers require a separately verified exemption workflow");
  }
  const address = session?.customer_details?.address;
  const addressFields = ["city", "country", "line1", "postal_code"];
  const addressCountry = clean(address?.country);
  const addressState = clean(address?.state);
  if (!address || typeof address !== "object" || Array.isArray(address) ||
      addressFields.some(field => !clean(address[field]) || clean(address[field]).length > 120 || /[\r\n<>]/.test(clean(address[field]))) ||
      !/^[A-Z]{2}$/.test(addressCountry) || !/^[A-Z0-9-]{0,10}$/.test(addressState) ||
      (addressCountry === "US" && !/^[A-Z]{2}$/.test(addressState))) {
    throw new Error("ARC_TAX_INVALID: complete Stripe customer destination address is required");
  }
  if (addressCountry === "US" && addressState === "WA" && amountTax <= 0) {
    throw new Error("ARC_TAX_INVALID: Washington destination requires positive calculated sales tax");
  }
  const collectedBusinessName = clean(session?.collected_information?.business_name);
  const collectedIndividualName = clean(session?.collected_information?.individual_name);
  if (!collectedBusinessName || collectedBusinessName.length > 120 || /[\r\n<>]/.test(collectedBusinessName) ||
      !collectedIndividualName || collectedIndividualName.length > 120 || /[\r\n<>]/.test(collectedIndividualName)) {
    throw new Error("ARC_HANDOFF_INVALID: required Stripe business and individual names");
  }
  return true;
}

export function resolvePreviewFolder({ clientReferenceId, treePaths }) {
  const reference = clean(clientReferenceId).replace(/^\/+|\/+$/g, "");
  if (!reference) throw new Error("ARC_FOLDER_NOT_FOUND: client_reference_id is empty");
  const folders = [...new Set(
    (treePaths || [])
      .map(value => clean(value).replace(/^\/+/, ""))
      .filter(value => /(?:^|\/)index\.html$/i.test(value))
      .map(value => value.replace(/\/index\.html$/i, ""))
      .filter(value => !/^deliveries\//i.test(value))
  )];
  const requireRootPreviewFolder = folder => {
    if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/i.test(folder)) {
      throw new Error('ARC_FOLDER_NOT_FOUND: resolved preview must be one root folder ending in eight hexadecimal characters');
    }
    return folder;
  };
  if (folders.includes(reference)) return requireRootPreviewFolder(reference);

  if (!/^[a-f0-9]{8}$/i.test(reference)) {
    throw new Error("ARC_FOLDER_NOT_FOUND: reference must be an exact folder or exactly eight hexadecimal characters");
  }
  const idPrefix = reference.toLowerCase();
  const matches = folders.filter(folder => {
    const leaf = folder.split("/").pop().toLowerCase();
    return leaf === `arc-${idPrefix}` || leaf.endsWith(`-${idPrefix}`);
  });
  if (matches.length !== 1) {
    throw new Error(`ARC_FOLDER_NOT_FOUND: expected one match for ${idPrefix}; found ${matches.length}`);
  }
  return requireRootPreviewFolder(matches[0]);
}

function parseCheckoutReference(clientReferenceId) {
  const raw = clean(clientReferenceId);
  if (!/^v3_[A-Za-z0-9_-]{135}$/.test(raw)) throw new Error("ARC_PAYMENT_INVALID: immutable signed checkout reference v3");
  const bytes = Buffer.from(raw.slice(3), "base64url");
  if (bytes.length !== 101 || bytes.toString("base64url") !== raw.slice(3)) throw new Error("ARC_PAYMENT_INVALID: canonical checkout reference v3");
  return {
    raw,
    payload: bytes.subarray(0, 69),
    keyId: bytes.subarray(0, 1).toString("hex"),
    folderSuffix: bytes.subarray(1, 5).toString("hex"),
    approvalContentSha256: bytes.subarray(5, 37).toString("hex"),
    checkoutConfigSnapshotSha256: bytes.subarray(37, 69).toString("hex"),
    signature: bytes.subarray(69),
  };
}

function removeExactTerminalPreviewToolbar(previewHtml, stripeLiveModeEnabled = false) {
  const toolbarPattern = /<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview<\/strong>Built for this business\. Purchase only if approved\.<\/span><a data-arc-checkout href="https:\/\/buy\.stripe\.com\/(?:test_)?[A-Za-z0-9]+\?client_reference_id=v3_[A-Za-z0-9_-]{135}">Own this website — \$5,000<\/a><\/aside>/g;
  const blocks = [...String(previewHtml).matchAll(toolbarPattern)].map(match => match[0]);
  if (blocks.length !== 1 || !String(previewHtml).endsWith(`${blocks[0]}\n</body>\n</html>`)) {
    throw new Error("ARC_FINALIZE_INVALID: exact terminal preview purchase toolbar is required");
  }
  const checkout = new URL(blocks[0].match(/href="([^"]+)"/)?.[1] || "");
  const pathMatchesMode = stripeLiveModeEnabled
    ? /^\/[A-Za-z0-9]+$/.test(checkout.pathname) && !checkout.pathname.startsWith("/test_")
    : /^\/test_[A-Za-z0-9]+$/.test(checkout.pathname);
  if (checkout.origin !== "https://buy.stripe.com" || !pathMatchesMode) {
    throw new Error("ARC_FINALIZE_INVALID: preview toolbar Stripe mode mismatch");
  }
  return String(previewHtml).replace(`${blocks[0]}\n</body>\n</html>`, "</body>\n</html>");
}

function upsertHeadTag(html, expression, markup) {
  if (expression.test(html)) return html.replace(expression, markup);
  return html.replace(/<\/head>/i, `  ${markup}\n</head>`);
}

export function finalizePreviewHtml(previewHtml, options = {}) {
  let html = clean(previewHtml);
  if (!/<!doctype html>/i.test(html) || !/<\/html>/i.test(html)) {
    throw new Error("ARC_FINALIZE_INVALID: preview HTML is incomplete");
  }
  if (!/<meta\s+name=["']robots["'][^>]*noindex/i.test(html)) {
    throw new Error("ARC_FINALIZE_INVALID: source is not a private ARC preview");
  }
  if (!/<meta\s+name=["']arc-template-version["']\s+content=["']10\.0["']/i.test(html)) {
    throw new Error("ARC_FINALIZE_INVALID: only verified ARC v10 previews can be delivered");
  }
  html = removeExactTerminalPreviewToolbar(html, options.stripeLiveModeEnabled === true);

  html = upsertHeadTag(
    html,
    /<meta\s+name=["']robots["'][^>]*>/i,
    '<meta name="robots" content="index,follow,max-image-preview:large">'
  );
  html = upsertHeadTag(
    html,
    /<meta\s+name=["']arc-site-mode["'][^>]*>/i,
    '<meta name="arc-site-mode" content="production">'
  );
  html = html.replace(
    /<body\b([^>]*?)\sdata-arc-site-mode=["'][^"']*["']([^>]*)>/i,
    '<body$1 data-arc-site-mode="production"$2>'
  );
  if (!/data-arc-site-mode=["']production["']/i.test(html)) {
    html = html.replace(/<body\b/i, '<body data-arc-site-mode="production"');
  }

  const canonicalUrl = clean(options.canonicalUrl);
  if (canonicalUrl) {
    if (!/^https:\/\//i.test(canonicalUrl)) throw new Error("ARC_FINALIZE_INVALID: canonical URL must use HTTPS");
    html = upsertHeadTag(html, /<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${canonicalUrl.replace(/["<>]/g, "")}">`);
    html = upsertHeadTag(html, /<meta\s+property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${canonicalUrl.replace(/["<>]/g, "")}">`);
  }

  html = html.replace(/\[ARC TEST\]\s*/gi, "");
  if (/noindex/i.test(html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "")) {
    throw new Error("ARC_FINALIZE_FAILED: noindex remained in production robots metadata");
  }
  if (!/data-arc-site-mode=["']production["']/i.test(html)) {
    throw new Error("ARC_FINALIZE_FAILED: production mode was not applied");
  }
  if (/\[\[[A-Z0-9_]+\]\]/.test(html)) throw new Error("ARC_FINALIZE_FAILED: unresolved placeholder");
  if (/<aside\b[^>]*arc-preview-toolbar|data-arc-checkout|buy\.stripe\.com/i.test(html)) {
    throw new Error("ARC_FINALIZE_FAILED: preview payment controls remained in production");
  }
  return `${html.trim()}\n`;
}

export function buildHeadersFile() {
  return `/*\n  Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;
}

export function buildNetlifyConfig() {
  throw new Error("ARC_LEGACY_HANDOFF_DISABLED: netlify.toml is not a deploy artifact; use _headers");
}

export function buildUsageGuide() {
  throw new Error("ARC_LEGACY_HANDOFF_DISABLED: USAGE.md must not be deployed with a customer site");
}

export function buildProductionHandoff({
  session,
  treePaths,
  previewHtml,
  canonicalUrl,
  expectedPaymentLinkId,
  expectedPriceId,
  expectedTermsVersion,
  expectedProductTaxCode,
  stripeLiveModeEnabled = false,
  verifiedLeadNotificationEmail,
  leadRouteEvidenceSecret,
  handoffArtifactEvidenceSecret,
  checkoutBindingSecret,
  artifactEvidenceIssuedAt = new Date().toISOString()
}) {
  validatePaidSession(session, {
    expectedPaymentLinkId,
    expectedPriceId,
    expectedTermsVersion,
    expectedProductTaxCode,
    stripeLiveModeEnabled
  });
  const checkoutReference = parseCheckoutReference(session.client_reference_id);
  const bindingSecret = clean(checkoutBindingSecret);
  if (bindingSecret.length < 32 || bindingSecret.length > 256) {
    throw new Error("ARC_PAYMENT_INVALID: checkout binding secret must be 32–256 characters");
  }
  const expectedCheckoutSignature = createHmac("sha256", bindingSecret)
    .update(`arc-checkout-reference-v3\narcwebhq-cpu/arc-previews\narc-production\nstripe-${stripeLiveModeEnabled ? "live" : "test"}\n`).update(checkoutReference.payload).digest();
  if (!expectedCheckoutSignature.equals(checkoutReference.signature)) {
    throw new Error("ARC_PAYMENT_INVALID: checkout reference signature mismatch");
  }
  const previewFolder = resolvePreviewFolder({
    clientReferenceId: checkoutReference.folderSuffix,
    treePaths
  });
  const approvalHtml = removeExactTerminalPreviewToolbar(clean(previewHtml), stripeLiveModeEnabled);
  if (sha256(approvalHtml) !== checkoutReference.approvalContentSha256) {
    throw new Error("ARC_PAYMENT_INVALID: approved preview bytes do not match the checkout approval digest");
  }
  const snapshotEncoded = approvalHtml.match(/<meta name="arc-checkout-config" content="([A-Za-z0-9_-]+)">/)?.[1] || "";
  if (!snapshotEncoded || sha256(Buffer.from(snapshotEncoded, "base64url")) !== checkoutReference.checkoutConfigSnapshotSha256) {
    throw new Error("ARC_PAYMENT_INVALID: checkout configuration snapshot digest mismatch");
  }
  const productionHtml = finalizePreviewHtml(previewHtml, { canonicalUrl, stripeLiveModeEnabled });
  const customerEmail = clean(session.customer_details?.email || session.customer_email).toLowerCase();
  const formTags = productionHtml.match(/<form\b[^>]*>/gi) || [];
  const formBlocks = productionHtml.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const hasLeadForm = formTags.length > 0;
  const routeEmail = clean(verifiedLeadNotificationEmail).toLowerCase();
  if (hasLeadForm && (formTags.length !== 1 || formBlocks.length !== 1)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: production must contain exactly one Netlify-managed form");
  }
  if (hasLeadForm) validateGeneratedFormContract(formBlocks[0]);
  const leadRouteFormName = hasLeadForm
    ? clean(formTags[0].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1])
    : "";
  if (hasLeadForm && !/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(leadRouteFormName)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: exact Netlify form name");
  }
  if (hasLeadForm && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(routeEmail)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: verified lead notification email");
  }
  const leadRouteRecipientHmacSha256 = hasLeadForm
    ? createHmac("sha256", bindingSecret)
      .update(`arc-checkout-lead-recipient-v1\n${stripeLiveModeEnabled ? "live" : "test"}\n${routeEmail}`, "utf8")
      .digest("hex")
    : "";
  const headersFile = buildHeadersFile();
  for (const [label, content] of [["production HTML", productionHtml], ["headers file", headersFile]]) {
    for (const privateValue of [clean(session.id), customerEmail, routeEmail].filter(Boolean)) {
      if (content.toLowerCase().includes(privateValue.toLowerCase())) {
        throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private handoff data`);
      }
    }
  }
  const relativeReferences = [...productionHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
    .map(match => match[1])
    .filter(reference => !/^(?:https?:|mailto:|tel:|#|\/|\?)/i.test(reference));
  if (relativeReferences.length) {
    throw new Error(`ARC_ARTIFACT_INVALID: unresolved relative assets: ${[...new Set(relativeReferences)].join(",")}`);
  }
  if (/<base\b/i.test(productionHtml)) throw new Error("ARC_ARTIFACT_INVALID: HTML base elements are forbidden");
  const artifactSecret = clean(handoffArtifactEvidenceSecret);
  if (artifactSecret.length < 32 || artifactSecret.length > 256) {
    throw new Error("ARC_ARTIFACT_INVALID: handoff artifact evidence secret must be 32–256 characters");
  }
  if (!Number.isFinite(Date.parse(artifactEvidenceIssuedAt)) || new Date(Date.parse(artifactEvidenceIssuedAt)).toISOString() !== artifactEvidenceIssuedAt) {
    throw new Error("ARC_ARTIFACT_INVALID: evidence issued_at must be canonical ISO-8601");
  }
  const artifacts = [
    { path: "_headers", content: headersFile },
    { path: "index.html", content: productionHtml }
  ];
  const artifactManifest = artifacts.map(({ path: artifactPath, content }) => ({
    path: artifactPath,
    sha256: sha256(content),
    size: Buffer.byteLength(content, "utf8")
  }));
  const artifactManifestPrivate = canonicalJson(artifactManifest);
  const artifactManifestSha256 = sha256(artifactManifestPrivate);
  const productionContentSha256 = artifactManifest.find(item => item.path === "index.html").sha256;
  const headersContentSha256 = artifactManifest.find(item => item.path === "_headers").sha256;
  const bundleFingerprint = sha256(artifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
  const handoffArtifactEvidencePrivate = canonicalJson({
    version: "arc2-handoff-artifact-evidence-v2",
    scope: "netlify-claimable-deploy-artifacts",
    preview_folder: previewFolder,
    lead_route_mode: hasLeadForm ? "netlify_form" : "not_required",
    lead_route_form_name: leadRouteFormName,
    lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
    production_content_sha256: productionContentSha256,
    artifact_manifest_sha256: artifactManifestSha256,
    bundle_fingerprint: bundleFingerprint,
    artifacts: artifactManifest,
    issued_at: artifactEvidenceIssuedAt
  });
  const handoffArtifactEvidenceSha256 = sha256(handoffArtifactEvidencePrivate);
  const handoffArtifactEvidenceHmacSha256 = createHmac("sha256", artifactSecret)
    .update(`arc2-handoff-artifact-evidence-signature-v2\n${handoffArtifactEvidencePrivate}`, "utf8")
    .digest("hex");
  return {
    status: "READY_FOR_CLAIMABLE_DEPLOY",
    checkoutSessionId: session.id,
    dedupeKey: `arc2:${session.id}`,
    previewFolder,
    previewFilePath: `${previewFolder}/index.html`,
    productionFilePath: "index.html",
    productionHtml,
    headersFilePath: "_headers",
    headersFile,
    deployArtifacts: artifacts,
    artifactManifest,
    artifactManifestPrivate,
    artifactManifestSha256,
    handoffArtifactEvidencePrivate,
    handoffArtifactEvidenceSha256,
    handoffArtifactEvidenceHmacSha256,
    claimableDeployRequired: true,
    customerEmail,
    productionContentSha256,
    headersContentSha256,
    bundleFingerprint,
    leadRouteStatus: hasLeadForm ? "pending_live_staging_evidence" : "not_required",
    leadRouteEvidenceRequired: hasLeadForm,
    leadRouteEvidenceVersion: hasLeadForm ? "arc-lead-route-evidence-v1" : "",
    leadRouteFormName,
    leadRouteRecipientHmacSha256,
    verifiedLeadNotificationEmail: hasLeadForm ? routeEmail : "",
    businessSlug: slugify(previewFolder.replace(/-[a-f0-9]{8}$/i, ""))
  };
}

async function runCli() {
  const [source, destination, canonicalUrl = ""] = process.argv.slice(2);
  if (!source || !destination) {
    throw new Error("Usage: node scripts/finalize_site.mjs SOURCE_HTML DESTINATION_HTML [CANONICAL_URL]");
  }
  const html = finalizePreviewHtml(await readFile(path.resolve(source), "utf8"), { canonicalUrl });
  const destinationPath = path.resolve(destination);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, html);
  console.log(`Finalized ${path.relative(process.cwd(), destinationPath)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await runCli();
}
