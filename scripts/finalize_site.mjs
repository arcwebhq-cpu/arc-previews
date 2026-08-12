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

export function validatePaidSession(session, { expectedPaymentLinkId, expectedTermsVersion } = {}) {
  const id = clean(session?.id);
  const paymentStatus = clean(session?.payment_status).toLowerCase();
  const currency = clean(session?.currency).toLowerCase();
  const amountTotal = session?.amount_total;
  const paymentLinkId = clean(session?.payment_link);
  const requiredPaymentLinkId = clean(expectedPaymentLinkId);
  const termsConsent = clean(session?.consent?.terms_of_service).toLowerCase();
  const termsVersion = clean(session?.metadata?.terms_version);
  const requiredTermsVersion = clean(expectedTermsVersion);
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(id)) throw new Error("ARC_PAYMENT_INVALID: test checkout session id");
  if (session?.livemode !== false) throw new Error("ARC_PAYMENT_INVALID: livemode must be false");
  if (paymentStatus !== "paid") throw new Error("ARC_PAYMENT_INVALID: session is not paid");
  if (currency !== "usd") throw new Error("ARC_PAYMENT_INVALID: currency must be usd");
  if (!Number.isSafeInteger(amountTotal) || amountTotal !== 500000) {
    throw new Error("ARC_PAYMENT_INVALID: amount_total must be exactly 500000 minor units ($5,000.00)");
  }
  if (!/^plink_[A-Za-z0-9]+$/.test(requiredPaymentLinkId)) throw new Error("ARC_PAYMENT_INVALID: expected Payment Link id");
  if (paymentLinkId !== requiredPaymentLinkId) throw new Error("ARC_PAYMENT_INVALID: Payment Link identity mismatch");
  if (termsConsent !== "accepted") throw new Error("ARC_PAYMENT_INVALID: terms_of_service consent must be accepted");
  if (!requiredTermsVersion) throw new Error("ARC_PAYMENT_INVALID: expected terms version");
  if (termsVersion !== requiredTermsVersion) throw new Error("ARC_PAYMENT_INVALID: terms version mismatch");
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
  if (!/class=["'][^"']*arc-preview-toolbar/i.test(html)) {
    throw new Error("ARC_FINALIZE_INVALID: preview purchase toolbar is missing");
  }

  html = html.replace(/<aside\b[^>]*class=["'][^"']*arc-preview-toolbar[^"']*["'][^>]*>[\s\S]*?<\/aside>\s*/gi, "");

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

export function buildNetlifyConfig() {
  return `[build]\n  publish = "."\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n    X-Frame-Options = "DENY"\n    X-Robots-Tag = "noindex, nofollow, noarchive"\n    Referrer-Policy = "strict-origin-when-cross-origin"\n    Permissions-Policy = "camera=(), microphone=(), geolocation=()"\n`;
}

export function buildUsageGuide() {
  return `# Launch checklist\n\nThis production website is ready to deploy.\n\n1. In Netlify, enable **Forms > Form detection**, then redeploy once.\n2. In **Project configuration > Notifications > Form submission notifications**, add the separately verified lead-notification address.\n3. Submit one test lead and confirm it arrives before connecting the final domain.\n4. Connect the business domain and replace the temporary canonical URL with the final HTTPS domain.\n5. Only after the final domain and lead route are verified, remove the staging-only \`X-Robots-Tag\` noindex header from \`netlify.toml\` and redeploy.\n\nDo not publish unverified claims, reviews, licenses, prices, or results.\n`;
}

export function buildProductionHandoff({
  session,
  treePaths,
  previewHtml,
  pagesBaseUrl,
  canonicalUrl,
  expectedPaymentLinkId,
  expectedTermsVersion,
  verifiedLeadNotificationEmail,
  leadRouteEvidenceSecret
}) {
  validatePaidSession(session, { expectedPaymentLinkId, expectedTermsVersion });
  const previewFolder = resolvePreviewFolder({
    clientReferenceId: session.client_reference_id,
    treePaths
  });
  const productionFolder = `deliveries/${previewFolder}`;
  const base = clean(pagesBaseUrl || "https://arcwebhq-cpu.github.io/arc-previews").replace(/\/+$/, "");
  const productionUrl = `${base}/${productionFolder}/`;
  const productionHtml = finalizePreviewHtml(previewHtml, { canonicalUrl: canonicalUrl || productionUrl });
  const deployUrl = `https://app.netlify.com/start/deploy?repository=${encodeURIComponent("https://github.com/arcwebhq-cpu/arc-previews")}&create_from_path=${encodeURIComponent(productionFolder)}`;
  const customerEmail = clean(session.customer_details?.email || session.customer_email).toLowerCase();
  const formTags = productionHtml.match(/<form\b[^>]*>/gi) || [];
  const formBlocks = productionHtml.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const hasLeadForm = formTags.length > 0;
  const routeEmail = clean(verifiedLeadNotificationEmail).toLowerCase();
  const evidenceSecret = clean(leadRouteEvidenceSecret);
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
  if (hasLeadForm && (evidenceSecret.length < 32 || evidenceSecret.length > 256)) {
    throw new Error("ARC_LEAD_ROUTE_INVALID: lead-route evidence secret must be 32–256 characters");
  }
  const leadRouteRecipientHmacSha256 = hasLeadForm
    ? createHmac("sha256", evidenceSecret)
      .update(`arc-lead-route-recipient-v1\n${routeEmail}`, "utf8")
      .digest("hex")
    : "";
  const netlifyConfig = buildNetlifyConfig();
  const usageGuide = buildUsageGuide();
  for (const [label, content] of [["production HTML", productionHtml], ["Netlify config", netlifyConfig], ["usage guide", usageGuide]]) {
    for (const privateValue of [clean(session.id), customerEmail, routeEmail, evidenceSecret].filter(Boolean)) {
      if (content.toLowerCase().includes(privateValue.toLowerCase())) {
        throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private handoff data`);
      }
    }
  }
  const productionContentSha256 = createHash("sha256").update(productionHtml, "utf8").digest("hex");
  const bundleFingerprint = createHash("sha256").update([
    { path: `${productionFolder}/index.html`, content: productionHtml },
    { path: `${productionFolder}/netlify.toml`, content: netlifyConfig },
    { path: `${productionFolder}/USAGE.md`, content: usageGuide }
  ].map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""), "utf8").digest("hex");
  return {
    checkoutSessionId: session.id,
    dedupeKey: `arc2:${session.id}`,
    previewFolder,
    previewFilePath: `${previewFolder}/index.html`,
    productionFolder,
    productionFilePath: `${productionFolder}/index.html`,
    productionHtml,
    netlifyConfigPath: `${productionFolder}/netlify.toml`,
    netlifyConfig,
    usageGuidePath: `${productionFolder}/USAGE.md`,
    usageGuide,
    productionUrl,
    deployUrl,
    customerEmail,
    productionContentSha256,
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
