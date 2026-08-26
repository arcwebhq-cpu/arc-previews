import { createHash, createHmac } from "node:crypto";

import { assertHumanImageReview, assertSafeImageAsset, assertSafeImageSource } from "./image_asset_contract.mjs";
import {
  V11_PAGES,
  V11_SITE_CONTRACT_VERSION,
  V11_TEMPLATE_VERSION,
  canonicalJson,
  createV11ApprovalManifest,
  digestV11ApprovalManifest,
  sha256
} from "./v11_site_contract.mjs";

export const V11_ARTIFACT_EVIDENCE_VERSION = "arc2-handoff-artifact-evidence-v4";
export const V11_ARTIFACT_EVIDENCE_SCOPE = "netlify-claimable-deploy-artifacts";
export const V11_ARTIFACT_SIGNATURE_PREFIX = "arc2-handoff-artifact-evidence-signature-v4\n";
export const V11_PREVIEW_SOURCE_REPOSITORY = "arcwebhq-cpu/arc-previews";

export const V11_PRODUCTION_HTML_PATHS = Object.freeze([
  "about/index.html",
  "contact/index.html",
  "process/index.html",
  "services/index.html",
  "index.html"
]);

export const V11_PRODUCTION_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const V11_PRODUCTION_HEADERS_FILE = `/*\n  Content-Security-Policy: ${V11_PRODUCTION_CONTENT_SECURITY_POLICY}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`;

export const V11_PRODUCTION_SAFE_CAPS = Object.freeze({
  maxAssetCount: 3,
  maxAssetBytes: 1_250_000,
  maxAggregateAssetBytes: 3_000_000,
  maxHtmlBytes: 150_000,
  maxAggregateHtmlBytes: 500_000,
  maxHeadersBytes: 10_000,
  maxArtifactBytes: 3_510_000,
  maxDeployArtifactsJsonBytes: 4_700_000
});

const RENDER_PATHS = Object.freeze(V11_PAGES.map(page => page.path));
const RENDER_KEYS = Object.freeze(V11_PAGES.map(page => page.key));
const HTML_PATH_SET = new Set(V11_PRODUCTION_HTML_PATHS);
const ASSET_PATH_PATTERN = /^assets\/([a-f0-9]{64})\.(png|jpg|webp)$/;
const ROOT_ASSET_REFERENCE_PATTERN = /^\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)$/;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const FORM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const INDEX_ROBOTS_VALUE = "index,follow,max-image-preview:large";
const FINALIZED_VERSION = "arc-v11-production-bundle-v1";

function invalid(detail) {
  throw new Error(`ARC_V11_FINALIZER_INVALID: ${detail}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    invalid(`${label} fields are invalid`);
  }
}

function hex64(value, label) {
  if (typeof value !== "string" || !HEX_64_PATTERN.test(value)) invalid(`${label} must be lowercase SHA-256`);
  return value;
}

function replaceOne(html, pattern, replacement, label) {
  const matches = html.match(pattern) || [];
  if (matches.length !== 1) invalid(`${label} must occur exactly once`);
  return html.replace(pattern, replacement);
}

function attributeValues(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...tag.matchAll(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([^"']*)\\1`, "gi"))].map(match => match[2]);
}

function exactQuotedAttribute(attributes, name, label) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentions = [...attributes.matchAll(new RegExp(`(?:^|\\s)${escaped}(?=\\s|=|$)`, "gi"))];
  const assignments = [...attributes.matchAll(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])([^"']*)\\1`, "gi"))];
  if (mentions.length !== 1 || assignments.length !== 1) {
    invalid(`${label} must contain exactly one quoted ${name} attribute`);
  }
  return assignments[0][2];
}

function normalizedAssets(rawAssets) {
  if (!Array.isArray(rawAssets)) invalid("assets must be an array");
  if (rawAssets.length > V11_PRODUCTION_SAFE_CAPS.maxAssetCount) invalid("asset count exceeds 3");
  const paths = new Set();
  let aggregateBytes = 0;
  const assets = rawAssets.map((rawAsset, index) => {
    const asset = plainObject(rawAsset, `asset ${index + 1}`);
    const allowedKeys = asset.sourceUrl === undefined ? ["bytes", "path"] : ["bytes", "path", "sourceUrl"];
    exactKeys(asset, allowedKeys, `asset ${index + 1}`);
    const match = typeof asset.path === "string" ? asset.path.match(ASSET_PATH_PATTERN) : null;
    if (!match) invalid(`asset ${index + 1} path is not content-addressed`);
    if (paths.has(asset.path)) invalid("asset paths must be unique");
    paths.add(asset.path);
    const bytes = Buffer.isBuffer(asset.bytes)
      ? Buffer.from(asset.bytes)
      : asset.bytes instanceof Uint8Array
        ? Buffer.from(asset.bytes.buffer, asset.bytes.byteOffset, asset.bytes.byteLength)
        : invalid(`asset ${index + 1} bytes are invalid`);
    if (!bytes.length || bytes.length > V11_PRODUCTION_SAFE_CAPS.maxAssetBytes) {
      invalid(`asset ${index + 1} exceeds 1250000 bytes`);
    }
    const digest = sha256(bytes);
    if (digest !== match[1]) invalid(`asset ${index + 1} path digest does not match its bytes`);
    const contentType = match[2] === "png" ? "image/png" : match[2] === "jpg" ? "image/jpeg" : "image/webp";
    assertSafeImageAsset(bytes, contentType, `v11 ${asset.path}`);
    let sourceUrl = "";
    if (asset.sourceUrl !== undefined) {
      try { assertSafeImageSource(asset.sourceUrl, contentType, `v11 asset ${index + 1}`); }
      catch (error) { invalid(error?.message || `asset ${index + 1} source URL is invalid`); }
      sourceUrl = asset.sourceUrl;
    }
    aggregateBytes += bytes.length;
    return { path: asset.path, bytes, sourceUrl, contentType, sha256: digest };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (aggregateBytes > V11_PRODUCTION_SAFE_CAPS.maxAggregateAssetBytes) {
    invalid("aggregate assets exceed 3000000 bytes");
  }
  return assets;
}

function assertRenderedSite(rendered) {
  plainObject(rendered, "renderV11Site result");
  if (rendered.contractVersion !== V11_SITE_CONTRACT_VERSION || rendered.templateVersion !== V11_TEMPLATE_VERSION ||
      rendered.pageCount !== 5 || !Array.isArray(rendered.pages) || rendered.pages.length !== 5 ||
      JSON.stringify(rendered.pages.map(page => page?.key)) !== JSON.stringify(RENDER_KEYS) ||
      JSON.stringify(rendered.pages.map(page => page?.path)) !== JSON.stringify(RENDER_PATHS)) {
    invalid("input is not an exact renderV11Site five-page result");
  }
  const manifest = createV11ApprovalManifest(rendered.pages);
  const manifestJson = canonicalJson(manifest);
  const bundleDigest = digestV11ApprovalManifest(manifest);
  if (rendered.approvalManifestJson !== manifestJson || rendered.approvalBundleSha256 !== bundleDigest ||
      canonicalJson(rendered.approvalManifest) !== manifestJson || rendered.pages.some(page =>
        typeof page.approvalHtml !== "string" || page.approvalSha256 !== sha256(page.approvalHtml))) {
    invalid("approval bytes do not match the rendered approval manifest");
  }
  if (typeof rendered.folder !== "string" || !/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(rendered.folder)) {
    invalid("preview folder is invalid");
  }
}

function productionMetadata(html, pagePath) {
  if (/<aside\b[^>]*\bclass=["'][^"']*\barc-preview-toolbar\b/i.test(html)) {
    invalid(`${pagePath} approval bytes contain the preview toolbar`);
  }
  let output = replaceOne(
    html,
    /<meta\s+name="robots"\s+content="[^"]*">/gi,
    `<meta name="robots" content="${INDEX_ROBOTS_VALUE}">`,
    `${pagePath} robots metadata`
  );
  output = replaceOne(
    output,
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*">/gi,
    `<meta http-equiv="Content-Security-Policy" content="${V11_PRODUCTION_CONTENT_SECURITY_POLICY}">`,
    `${pagePath} CSP metadata`
  );
  output = replaceOne(
    output,
    /data-arc-site-mode="preview"/g,
    'data-arc-site-mode="production"',
    `${pagePath} preview mode marker`
  );
  return output;
}

function rewriteAssetSources(html, assets) {
  let output = html;
  for (const asset of assets) {
    if (asset.sourceUrl) {
      const encodedUrl = asset.sourceUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
      output = output.split(asset.sourceUrl).join(`/${asset.path}`).split(encodedUrl).join(`/${asset.path}`);
    }
  }
  return output;
}

function assetReferences(html, pagePath) {
  if (/https:\/\/arcwebhq-cpu\.github\.io\/arc-previews(?:\/|["'?#]|$)/i.test(html)) {
    invalid(`${pagePath} still references the ARC preview host`);
  }
  if (/<base\b/i.test(html)) invalid(`${pagePath} contains a forbidden base element`);

  for (const match of html.matchAll(/(?:^|["'(=\s])(\/?assets\/[^"'()\s,<>]+)/gi)) {
    if (!ROOT_ASSET_REFERENCE_PATTERN.test(match[1])) {
      invalid(`${pagePath} contains a non-root or non-content-addressed asset reference`);
    }
  }

  for (const tag of html.match(/<(?:img|source)\b[^>]*>/gi) || []) {
    for (const name of ["src", "srcset"]) {
      for (const rawValue of attributeValues(tag, name)) {
        const candidates = name === "srcset" ? rawValue.split(",").map(value => value.trim().split(/\s+/)[0]) : [rawValue];
        if (candidates.some(value => !ROOT_ASSET_REFERENCE_PATTERN.test(value))) {
          invalid(`${pagePath} image sources must use root-relative content-addressed assets`);
        }
      }
    }
  }

  return new Set([...html.matchAll(/(?:^|["'(=\s])(\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp))(?=$|["')\s,<>])/gi)]
    .map(match => match[1].slice(1)));
}

function contactFormContract(pages) {
  if (pages.some(page => /\bformaction\b/i.test(page.html))) {
    invalid("formaction overrides are forbidden on every page");
  }
  const formPages = pages.flatMap(page => (page.html.match(/<form\b/gi) || []).map(() => page.path));
  const closeCount = pages.reduce((count, page) => count + (page.html.match(/<\/form\s*>/gi) || []).length, 0);
  if (formPages.length === 0) {
    if (closeCount !== 0) invalid("orphan form closing tag is forbidden");
    return { leadRouteMode: "not_required", leadRouteFormName: "", pages };
  }
  if (formPages.length !== 1 || closeCount !== 1 || formPages[0] !== "contact/index.html") {
    invalid("exactly one form is allowed, on Contact only");
  }
  const contact = pages.find(page => page.path === "contact/index.html");
  const forms = [...contact.html.matchAll(/<form\b([^>]*)>[\s\S]*?<\/form\s*>/gi)];
  if (forms.length !== 1) invalid("exactly one complete Contact form is required");
  const attributes = forms[0][1];
  if (exactQuotedAttribute(attributes, "method", "Contact form").toUpperCase() !== "POST" ||
      exactQuotedAttribute(attributes, "data-netlify", "Contact form").toLowerCase() !== "true" ||
      exactQuotedAttribute(attributes, "netlify-honeypot", "Contact form") !== "bot-field") {
    invalid("Contact form Netlify attributes are invalid");
  }
  const name = exactQuotedAttribute(attributes, "name", "Contact form");
  if (!FORM_NAME_PATTERN.test(name)) invalid("Contact form name is invalid");
  const action = exactQuotedAttribute(attributes, "action", "Contact form");
  if (action !== "./?submitted=1") invalid("approval Contact form action is invalid");

  const inputs = [...contact.html.matchAll(/<input\b([^>]*)>/gi)];
  const formNameInputs = inputs.filter(match =>
    /(?:^|\s)name\s*=\s*(?:"form-name"|'form-name'|form-name)(?=\s|\/|$)/i.test(match[1]));
  if (formNameInputs.length !== 1 ||
      exactQuotedAttribute(formNameInputs[0][1], "name", "form-name input") !== "form-name" ||
      exactQuotedAttribute(formNameInputs[0][1], "type", "form-name input").toLowerCase() !== "hidden" ||
      exactQuotedAttribute(formNameInputs[0][1], "value", "form-name input") !== name) {
    invalid("Contact form hidden bindings are invalid");
  }
  const honeypotInputs = inputs.filter(match =>
    /(?:^|\s)name\s*=\s*(?:"bot-field"|'bot-field'|bot-field)(?=\s|\/|$)/i.test(match[1]));
  if (honeypotInputs.length !== 1 ||
      exactQuotedAttribute(honeypotInputs[0][1], "name", "honeypot input") !== "bot-field") {
    invalid("Contact form honeypot input binding is invalid");
  }

  const normalizedHtml = replaceOne(
    contact.html,
    /action="\.\/\?submitted=1"/g,
    'action="/contact/?submitted=1"',
    "Contact form action"
  );
  return {
    leadRouteMode: "netlify_form",
    leadRouteFormName: name,
    pages: pages.map(page => page.path === contact.path ? { ...page, html: normalizedHtml } : page)
  };
}

function validateProductionPages(pages, assets) {
  const includedAssets = new Set(assets.map(asset => asset.path));
  const referencedAssets = new Set();
  let aggregateHtmlBytes = 0;
  for (const page of pages) {
    const bytes = Buffer.byteLength(page.html, "utf8");
    if (!bytes || bytes > V11_PRODUCTION_SAFE_CAPS.maxHtmlBytes) invalid(`${page.path} exceeds 150000 bytes`);
    aggregateHtmlBytes += bytes;
    if ((page.html.match(new RegExp(`<meta name="robots" content="${INDEX_ROBOTS_VALUE}">`, "g")) || []).length !== 1 ||
        /<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["'][^"']*(?:noindex|nofollow)/i.test(page.html) ||
        (page.html.match(/<body\b[^>]*data-arc-site-mode="production"[^>]*>/g) || []).length !== 1 ||
        (page.html.match(new RegExp(`<meta http-equiv="Content-Security-Policy" content="${V11_PRODUCTION_CONTENT_SECURITY_POLICY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`, "g")) || []).length !== 1 ||
        /<aside\b[^>]*\bclass=["'][^"']*\barc-preview-toolbar\b/i.test(page.html)) {
      invalid(`${page.path} production metadata is invalid`);
    }
    for (const asset of assetReferences(page.html, page.path)) referencedAssets.add(asset);
  }
  if (aggregateHtmlBytes > V11_PRODUCTION_SAFE_CAPS.maxAggregateHtmlBytes) {
    invalid("aggregate HTML exceeds 500000 bytes");
  }
  if (referencedAssets.size !== includedAssets.size || [...referencedAssets].some(path => !includedAssets.has(path)) ||
      [...includedAssets].some(path => !referencedAssets.has(path))) {
    invalid("site-wide asset references do not match the exact bundle");
  }
}

function framedDigest(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry.path, "utf8").update("\0").update(entry.bytes).update("\0");
  return hash.digest("hex");
}

function assertArtifactCaps(entries, deployArtifactsJson) {
  const headers = entries.find(entry => entry.path === "_headers");
  if (!headers || headers.bytes.length > V11_PRODUCTION_SAFE_CAPS.maxHeadersBytes) invalid("headers exceed 10000 bytes");
  const total = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  if (total > V11_PRODUCTION_SAFE_CAPS.maxArtifactBytes) invalid("artifact bundle exceeds 3510000 bytes");
  if (Buffer.byteLength(deployArtifactsJson, "utf8") > V11_PRODUCTION_SAFE_CAPS.maxDeployArtifactsJsonBytes) {
    invalid("canonical deploy artifacts exceed 4700000 bytes");
  }
}

/**
 * STRUCTURAL_VALIDATION_ONLY_NOT_PUBLICATION_AUTHORITY
 *
 * This local finalizer checks the review object's shape and its coverage of the
 * bundled asset digests. It does not authenticate a reviewer, verify private-key
 * custody, or authorize publication. The Zapier ARC1 publisher must independently
 * verify the signed, digest-bound review receipt before any provider write.
 */
export function finalizeV11ProductionSite(rendered, options = {}) {
  assertRenderedSite(rendered);
  plainObject(options, "finalizer options");
  if (Object.keys(options).some(key => !["assetReview", "assets"].includes(key))) invalid("finalizer option fields are invalid");
  const assets = normalizedAssets(options.assets ?? []);
  try { assertHumanImageReview(options.assetReview, assets, "v11 finalizer customer images"); }
  catch (error) { invalid(error?.message || "customer image review is required"); }
  let pages = rendered.pages.map(page => ({
    key: page.key,
    path: page.path,
    html: rewriteAssetSources(productionMetadata(page.approvalHtml, page.path), assets)
  }));
  const form = contactFormContract(pages);
  pages = form.pages;
  validateProductionPages(pages, assets);

  const pageByPath = new Map(pages.map(page => [page.path, page]));
  const orderedPages = V11_PRODUCTION_HTML_PATHS.map(path => {
    const page = pageByPath.get(path);
    if (!page) invalid(`missing production page ${path}`);
    return { ...page, bytes: Buffer.from(page.html, "utf8") };
  });
  const artifactVector = [
    { path: "_headers", bytes: Buffer.from(V11_PRODUCTION_HEADERS_FILE, "utf8") },
    ...assets.map(asset => ({ path: asset.path, bytes: Buffer.from(asset.bytes) })),
    ...orderedPages.map(page => ({ path: page.path, bytes: Buffer.from(page.bytes) }))
  ];
  const artifacts = artifactVector.map(entry => ({ path: entry.path, sha256: sha256(entry.bytes), size: entry.bytes.length }));
  const artifactManifestJson = canonicalJson(artifacts);
  const deployArtifacts = artifactVector.map(entry => ({ path: entry.path, content_base64: entry.bytes.toString("base64") }));
  const deployArtifactsJson = canonicalJson(deployArtifacts);
  assertArtifactCaps(artifactVector, deployArtifactsJson);
  return {
    version: FINALIZED_VERSION,
    folder: rendered.folder,
    approvalContentSha256: rendered.approvalBundleSha256,
    leadRouteMode: form.leadRouteMode,
    leadRouteFormName: form.leadRouteFormName,
    pages: orderedPages.map(page => ({
      key: page.key,
      path: page.path,
      html: page.html,
      sha256: sha256(page.bytes),
      size: page.bytes.length
    })),
    artifacts,
    artifactVector,
    artifactManifestJson,
    artifactManifestSha256: sha256(artifactManifestJson),
    productionContentSha256: framedDigest(orderedPages),
    bundleFingerprint: framedDigest(artifactVector),
    deployArtifacts,
    deployArtifactsJson
  };
}

function assertFinalized(finalized) {
  plainObject(finalized, "finalized production site");
  if (finalized.version !== FINALIZED_VERSION || !Array.isArray(finalized.artifacts) || !Array.isArray(finalized.artifactVector) ||
      !Array.isArray(finalized.deployArtifacts) || finalized.artifacts.length !== finalized.artifactVector.length ||
      finalized.deployArtifacts.length !== finalized.artifactVector.length ||
      canonicalJson(finalized.artifacts) !== finalized.artifactManifestJson || sha256(finalized.artifactManifestJson) !== finalized.artifactManifestSha256 ||
      framedDigest(finalized.artifactVector) !== finalized.bundleFingerprint ||
      framedDigest(finalized.artifactVector.filter(entry => HTML_PATH_SET.has(entry.path))) !== finalized.productionContentSha256 ||
      canonicalJson(finalized.deployArtifacts) !== finalized.deployArtifactsJson) {
    invalid("finalized production bundle is inconsistent");
  }
  for (let index = 0; index < finalized.artifactVector.length; index += 1) {
    const vectorEntry = finalized.artifactVector[index];
    const manifestEntry = finalized.artifacts[index];
    const deployEntry = finalized.deployArtifacts[index];
    if (!vectorEntry || typeof vectorEntry.path !== "string" || !Buffer.isBuffer(vectorEntry.bytes) ||
        !manifestEntry || manifestEntry.path !== vectorEntry.path || manifestEntry.sha256 !== sha256(vectorEntry.bytes) ||
        manifestEntry.size !== vectorEntry.bytes.length || !deployEntry || deployEntry.path !== vectorEntry.path ||
        deployEntry.content_base64 !== vectorEntry.bytes.toString("base64")) {
      invalid("finalized artifact bytes do not match their manifest and deploy encodings");
    }
  }
  const paths = finalized.artifacts.map(artifact => artifact.path);
  const htmlStart = paths.length - V11_PRODUCTION_HTML_PATHS.length;
  const assetPaths = paths.slice(1, htmlStart);
  if (paths[0] !== "_headers" || JSON.stringify(paths.slice(htmlStart)) !== JSON.stringify(V11_PRODUCTION_HTML_PATHS) ||
      JSON.stringify(assetPaths) !== JSON.stringify([...assetPaths].sort()) || assetPaths.some(path => !ASSET_PATH_PATTERN.test(path))) {
    invalid("finalized artifact path vector is inconsistent");
  }
}

export function createV11ArtifactEvidenceData(finalized, bindings) {
  assertFinalized(finalized);
  const value = plainObject(bindings, "artifact evidence bindings");
  exactKeys(value, [
    "assetPublicationReceiptSha256",
    "checkoutBindingKeyId",
    "checkoutConfigSnapshotSha256",
    "checkoutReferenceSha256",
    "issuedAt",
    "leadRouteRecipientHmacSha256",
    "previewSourceCommitSha",
    "previewSourceTagSha256"
  ], "artifact evidence bindings");
  if (!/^[a-f0-9]{2}$/.test(value.checkoutBindingKeyId) || !/^[a-f0-9]{40}$/.test(value.previewSourceCommitSha)) {
    invalid("artifact evidence immutable source binding is invalid");
  }
  for (const [field, label] of [
    ["assetPublicationReceiptSha256", "asset publication receipt"],
    ["checkoutConfigSnapshotSha256", "checkout configuration"],
    ["checkoutReferenceSha256", "checkout reference"],
    ["previewSourceTagSha256", "preview source tag"]
  ]) hex64(value[field], label);
  if (typeof value.issuedAt !== "string" || value.issuedAt.length < 20 || value.issuedAt.length > 32 ||
      !Number.isFinite(Date.parse(value.issuedAt)) || new Date(Date.parse(value.issuedAt)).toISOString() !== value.issuedAt) {
    invalid("issuedAt must be a canonical ISO timestamp");
  }
  if (finalized.leadRouteMode === "netlify_form") {
    hex64(value.leadRouteRecipientHmacSha256, "lead route recipient HMAC");
  } else if (value.leadRouteRecipientHmacSha256 !== "") {
    invalid("no-form evidence cannot contain a lead route recipient HMAC");
  }
  return {
    approval_content_sha256: hex64(finalized.approvalContentSha256, "approval content"),
    artifact_manifest_sha256: hex64(finalized.artifactManifestSha256, "artifact manifest"),
    artifacts: finalized.artifacts.map(artifact => ({ ...artifact })),
    asset_publication_receipt_sha256: value.assetPublicationReceiptSha256,
    bundle_fingerprint: hex64(finalized.bundleFingerprint, "bundle fingerprint"),
    checkout_binding_key_id: value.checkoutBindingKeyId,
    checkout_config_snapshot_sha256: value.checkoutConfigSnapshotSha256,
    checkout_reference_sha256: value.checkoutReferenceSha256,
    issued_at: value.issuedAt,
    lead_route_form_name: finalized.leadRouteFormName,
    lead_route_mode: finalized.leadRouteMode,
    lead_route_recipient_hmac_sha256: value.leadRouteRecipientHmacSha256,
    preview_folder: finalized.folder,
    preview_source_commit_sha: value.previewSourceCommitSha,
    preview_source_repository: V11_PREVIEW_SOURCE_REPOSITORY,
    preview_source_tag_sha256: value.previewSourceTagSha256,
    production_content_sha256: hex64(finalized.productionContentSha256, "production content"),
    scope: V11_ARTIFACT_EVIDENCE_SCOPE,
    version: V11_ARTIFACT_EVIDENCE_VERSION
  };
}

export function signV11ArtifactEvidence(evidence, secret) {
  const canonical = typeof evidence === "string" ? evidence : canonicalJson(evidence);
  if (typeof canonical !== "string" || canonical.length < 2 || canonicalJson(JSON.parse(canonical)) !== canonical) {
    invalid("artifact evidence must be canonical JSON");
  }
  if (typeof secret !== "string" || secret.length < 32) invalid("artifact evidence secret is unavailable");
  return createHmac("sha256", secret).update(`${V11_ARTIFACT_SIGNATURE_PREFIX}${canonical}`, "utf8").digest("hex");
}

export function createV11ArtifactEvidence(finalized, bindings, secret) {
  const data = createV11ArtifactEvidenceData(finalized, bindings);
  const canonical = canonicalJson(data);
  return {
    data,
    canonical,
    sha256: sha256(canonical),
    hmacSha256: signV11ArtifactEvidence(canonical, secret)
  };
}
