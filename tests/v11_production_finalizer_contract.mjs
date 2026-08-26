import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fixtures } from "../fixtures/v11_industries.mjs";
import {
  V11_ARTIFACT_EVIDENCE_SCOPE,
  V11_ARTIFACT_EVIDENCE_VERSION,
  V11_ARTIFACT_SIGNATURE_PREFIX,
  V11_PRODUCTION_CONTENT_SECURITY_POLICY,
  V11_PRODUCTION_HEADERS_FILE,
  V11_PRODUCTION_HTML_PATHS,
  V11_PRODUCTION_SAFE_CAPS,
  createV11ArtifactEvidence,
  createV11ArtifactEvidenceData,
  finalizeV11ProductionSite,
  signV11ArtifactEvidence
} from "../scripts/v11_production_finalizer.mjs";
import {
  canonicalJson,
  createV11ApprovalManifest,
  digestV11ApprovalManifest,
  renderV11Site,
  sha256
} from "../scripts/v11_site_contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE_V11.html"), "utf8");
const fixture = fixtures[0];
const evidenceSecret = "v11-artifact-evidence-test-secret-0000000000000000000000000000";
const issuedAt = "2026-08-25T12:00:00.000Z";
const evidenceBindings = Object.freeze({
  assetPublicationReceiptSha256: sha256("asset-publication-receipt"),
  checkoutBindingKeyId: "01",
  checkoutConfigSnapshotSha256: sha256("checkout-config-snapshot"),
  checkoutReferenceSha256: sha256("checkout-reference"),
  issuedAt,
  leadRouteRecipientHmacSha256: sha256("lead-route-recipient-binding"),
  previewSourceCommitSha: "a".repeat(40),
  previewSourceTagSha256: sha256("preview-source-tag")
});

function render(content = fixture.content, options = {}) {
  return renderV11Site(template, content, { trustedEventPrefix: fixture.id, ...options });
}

function framedDigest(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(entry.path, "utf8").update("\0").update(entry.bytes).update("\0");
  return hash.digest("hex");
}

function boundedJpeg(size, fill) {
  const prefix = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00
  ]);
  assert.ok(size > prefix.length + 2);
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.length - 2, fill), Buffer.from([0xff, 0xd9])], size);
}

function withApprovalMutation(rendered, mutate) {
  const pages = rendered.pages.map(page => {
    const approvalHtml = mutate(page.approvalHtml, page);
    return { ...page, approvalHtml, approvalSha256: sha256(approvalHtml) };
  });
  const approvalManifest = createV11ApprovalManifest(pages);
  return {
    ...rendered,
    pages,
    approvalManifest,
    approvalManifestJson: canonicalJson(approvalManifest),
    approvalBundleSha256: digestV11ApprovalManifest(approvalManifest)
  };
}

function padHtml(html, targetBytes) {
  const current = Buffer.byteLength(html, "utf8");
  if (current >= targetBytes) return html;
  return html.replace("</body>", `<!--${"x".repeat(targetBytes - current - 7)}--></body>`);
}

assert.deepEqual(V11_PRODUCTION_HTML_PATHS, [
  "about/index.html",
  "contact/index.html",
  "process/index.html",
  "services/index.html",
  "index.html"
]);
assert.deepEqual(V11_PRODUCTION_SAFE_CAPS, {
  maxAssetCount: 3,
  maxAssetBytes: 1_250_000,
  maxAggregateAssetBytes: 3_000_000,
  maxHtmlBytes: 150_000,
  maxAggregateHtmlBytes: 500_000,
  maxHeadersBytes: 10_000,
  maxArtifactBytes: 3_510_000,
  maxDeployArtifactsJsonBytes: 4_700_000
});

const assetBytes = boundedJpeg(512, 0x41);
const assetDigest = sha256(assetBytes);
const assetPath = `assets/${assetDigest}.jpg`;
const sourceUrl = `https://uploads.example.test/customer-image.jpg?receipt=${sha256("receipt-a")}&variant=hero`;
const mediaContent = {
  ...fixture.content,
  HERO_MEDIA_HTML: `<picture><source srcset="${sourceUrl} 1x"><img src="${sourceUrl}" alt="Customer-supplied roofing project"></picture>`
};
const rendered = render(mediaContent, { heroImageUrl: sourceUrl });
assert.ok(rendered.pages.some(page => page.html.includes("<aside class=\"arc-preview-toolbar\"")), "preview output should retain its inert toolbar");
assert.ok(rendered.pages.some(page => page.approvalHtml.includes("&amp;variant=hero")), "approval bytes should retain the escaped receipt URL");

const finalized = finalizeV11ProductionSite(rendered, {
  assets: [{ path: assetPath, bytes: assetBytes, sourceUrl }]
});
const repeated = finalizeV11ProductionSite(rendered, {
  assets: [{ path: assetPath, bytes: assetBytes, sourceUrl }]
});

assert.deepEqual(finalized.artifacts.map(artifact => artifact.path), [
  "_headers",
  assetPath,
  ...V11_PRODUCTION_HTML_PATHS
]);
assert.equal(finalized.artifactVector[0].bytes.toString("utf8"), V11_PRODUCTION_HEADERS_FILE);
assert.equal(finalized.artifactManifestJson, repeated.artifactManifestJson, "finalization must be deterministic");
assert.equal(finalized.deployArtifactsJson, repeated.deployArtifactsJson, "canonical base64 delivery must be deterministic");
assert.equal(finalized.productionContentSha256, repeated.productionContentSha256);
assert.equal(finalized.bundleFingerprint, repeated.bundleFingerprint);
assert.equal(finalized.leadRouteMode, "netlify_form");
assert.equal(finalized.leadRouteFormName, "roofing-lead");
assert.equal(Buffer.byteLength(finalized.deployArtifactsJson, "utf8") <= V11_PRODUCTION_SAFE_CAPS.maxDeployArtifactsJsonBytes, true);

for (const page of finalized.pages) {
  assert.match(page.html, /<meta name="robots" content="index,follow,max-image-preview:large">/, `${page.path}: indexable robots metadata`);
  assert.doesNotMatch(page.html, /<meta\b[^>]*\bname="robots"[^>]*\bcontent="[^"]*(?:noindex|nofollow)/i, `${page.path}: preview robots state`);
  assert.match(page.html, /<body\b[^>]*data-arc-site-mode="production"/, `${page.path}: production mode`);
  assert.doesNotMatch(page.html, /<aside\b[^>]*\bclass="[^"]*arc-preview-toolbar/i, `${page.path}: preview toolbar markup`);
  assert.ok(page.html.includes(`<meta http-equiv="Content-Security-Policy" content="${V11_PRODUCTION_CONTENT_SECURITY_POLICY}">`), `${page.path}: production CSP`);
  assert.doesNotMatch(page.html, /https:\/\/uploads\.example\.test/, `${page.path}: receipt URL must not survive`);
}
assert.equal(finalized.pages.reduce((count, page) => count + (page.html.match(/<form\b/gi) || []).length, 0), 1);
const contactPage = finalized.pages.find(page => page.path === "contact/index.html");
assert.equal((contactPage.html.match(/action="\/contact\/\?submitted=1"/g) || []).length, 1, "Contact action must be exact");
assert.equal(finalized.pages.filter(page => page.path !== "contact/index.html").some(page => /<form\b/i.test(page.html)), false);
assert.ok(finalized.pages.some(page => page.html.includes(`src="/${assetPath}"`)), "uploaded image must become a root-relative asset");
assert.ok(finalized.pages.some(page => page.html.includes(`srcset="/${assetPath} 1x"`)), "srcset must become root-relative too");

const productionEntries = finalized.artifactVector.filter(entry => V11_PRODUCTION_HTML_PATHS.includes(entry.path));
assert.equal(finalized.productionContentSha256, framedDigest(productionEntries), "production digest must frame all five ordered pages");
assert.equal(finalized.bundleFingerprint, framedDigest(finalized.artifactVector), "bundle fingerprint must frame the exact artifact vector");
assert.equal(finalized.artifactManifestSha256, sha256(canonicalJson(finalized.artifacts)), "manifest digest must cover canonical signed entries");
assert.equal(finalized.productionContentSha256, sha256(Buffer.concat(productionEntries.flatMap(entry => [
  Buffer.from(`${entry.path}\0`), entry.bytes, Buffer.from("\0")
]))), "streaming and concatenated whole-site digests must agree");

const evidence = createV11ArtifactEvidence(finalized, evidenceBindings, evidenceSecret);
assert.equal(evidence.canonical, canonicalJson(evidence.data));
assert.equal(evidence.data.version, V11_ARTIFACT_EVIDENCE_VERSION);
assert.equal(evidence.data.scope, V11_ARTIFACT_EVIDENCE_SCOPE);
assert.equal(evidence.data.production_content_sha256, finalized.productionContentSha256);
assert.equal(evidence.data.artifact_manifest_sha256, finalized.artifactManifestSha256);
assert.equal(evidence.data.bundle_fingerprint, finalized.bundleFingerprint);
assert.deepEqual(evidence.data.artifacts, finalized.artifacts);
assert.equal(evidence.hmacSha256, createHmac("sha256", evidenceSecret)
  .update(`${V11_ARTIFACT_SIGNATURE_PREFIX}${evidence.canonical}`, "utf8").digest("hex"));
assert.equal(signV11ArtifactEvidence(evidence.data, evidenceSecret), evidence.hmacSha256);
assert.deepEqual(createV11ArtifactEvidenceData(finalized, evidenceBindings), evidence.data);

const changedAboutContent = {
  ...mediaContent,
  ABOUT_BODY: `${mediaContent.ABOUT_BODY}<p>A secondary-page approval change that must alter the whole-site production digest.</p>`
};
const changedAbout = finalizeV11ProductionSite(render(changedAboutContent, { heroImageUrl: sourceUrl }), {
  assets: [{ path: assetPath, bytes: assetBytes, sourceUrl }]
});
assert.notEqual(changedAbout.productionContentSha256, finalized.productionContentSha256,
  "changing About must change production_content_sha256 even when index.html is unchanged");
assert.equal(changedAbout.pages.find(page => page.path === "index.html").sha256,
  finalized.pages.find(page => page.path === "index.html").sha256,
  "secondary-page digest regression must not rely on a changed root page");

const externalContent = {
  ...fixture.content,
  CONTACT_ACTION_HTML: '<a href="https://booking.example.test/start">Book through the verified scheduling service</a>'
};
const externalFinalized = finalizeV11ProductionSite(render(externalContent));
assert.equal(externalFinalized.leadRouteMode, "not_required");
assert.equal(externalFinalized.leadRouteFormName, "");
assert.equal(externalFinalized.pages.some(page => /<form\b/i.test(page.html)), false, "external CTA mode must contain zero forms");
const externalEvidence = createV11ArtifactEvidenceData(externalFinalized, {
  ...evidenceBindings,
  leadRouteRecipientHmacSha256: ""
});
assert.equal(externalEvidence.lead_route_mode, "not_required");
assert.equal(externalEvidence.lead_route_recipient_hmac_sha256, "");
assert.throws(() => createV11ArtifactEvidenceData(externalFinalized, evidenceBindings), /no-form evidence/i);

const poisonedPreviewHtml = {
  ...rendered,
  pages: rendered.pages.map(page => ({ ...page, html: `${page.html}<script>previewOnlyAttack()</script>` }))
};
const approvalOnlyFinalized = finalizeV11ProductionSite(poisonedPreviewHtml, {
  assets: [{ path: assetPath, bytes: assetBytes, sourceUrl }]
});
assert.equal(approvalOnlyFinalized.bundleFingerprint, finalized.bundleFingerprint,
  "production must derive from approvalHtml, never toolbar-bearing preview html");
assert.equal(approvalOnlyFinalized.pages.some(page => page.html.includes("previewOnlyAttack")), false);

const movedForm = withApprovalMutation(render(), (html, page) => {
  if (page.key === "contact") return html.replace(/<form\b[\s\S]*?<\/form>/i, '<a href="tel:+12065550100">Call</a>');
  if (page.key === "about") return html.replace("</main>", `${fixture.content.CONTACT_ACTION_HTML.replace('action="/?submitted=1"', 'action="./?submitted=1"')}</main>`);
  return html;
});
assert.throws(() => finalizeV11ProductionSite(movedForm), /Contact only/i);

const duplicateContact = withApprovalMutation(render(), (html, page) => page.key === "contact"
  ? html.replace("</main>", `${fixture.content.CONTACT_ACTION_HTML.replace('action="/?submitted=1"', 'action="./?submitted=1"')}</main>`)
  : html);
assert.throws(() => finalizeV11ProductionSite(duplicateContact), /exactly one form/i);

const wrongContactAction = withApprovalMutation(render(), (html, page) => page.key === "contact"
  ? html.replace('action="./?submitted=1"', 'action="https://attacker.example/collect"')
  : html);
assert.throws(() => finalizeV11ProductionSite(wrongContactAction), /approval Contact form action/i);

function invalidContactForm(mutate) {
  return withApprovalMutation(render(), (html, page) => page.key === "contact" ? mutate(html) : html);
}

const formactionOverride = invalidContactForm(html => html.replace(
  '<button type="submit">',
  '<button type="submit" formaction="/elsewhere/">'
));
assert.throws(() => finalizeV11ProductionSite(formactionOverride), /formaction overrides/i);

for (const attribute of ["name", "method", "data-netlify", "netlify-honeypot", "action"]) {
  const duplicateAssignment = invalidContactForm(html => html.replace(
    new RegExp(`<form ([^>]*?)${attribute}="([^"]*)"`),
    `<form $1${attribute}="$2" ${attribute}="$2"`
  ));
  assert.throws(() => finalizeV11ProductionSite(duplicateAssignment), /exactly one quoted/i,
    `duplicate ${attribute} assignment must fail at the producer`);
  const bareMention = invalidContactForm(html => html.replace(
    new RegExp(`<form ([^>]*?)${attribute}="`),
    `<form $1${attribute} ${attribute}="`
  ));
  assert.throws(() => finalizeV11ProductionSite(bareMention), /exactly one quoted/i,
    `bare ${attribute} mention must fail at the producer`);
}

const nonHiddenFormName = invalidContactForm(html => html.replace(
  '<input type="hidden" name="form-name"',
  '<input type="text" name="form-name"'
));
assert.throws(() => finalizeV11ProductionSite(nonHiddenFormName), /hidden bindings/i);
const missingHiddenType = invalidContactForm(html => html.replace(
  '<input type="hidden" name="form-name"',
  '<input name="form-name"'
));
assert.throws(() => finalizeV11ProductionSite(missingHiddenType), /quoted type|hidden bindings/i);
const duplicateHiddenFormName = invalidContactForm(html => html.replace(
  '<input type="hidden" name="form-name" value="roofing-lead">',
  '<input type="hidden" name="form-name" value="roofing-lead"><input type="hidden" name="form-name" value="roofing-lead">'
));
assert.throws(() => finalizeV11ProductionSite(duplicateHiddenFormName), /hidden bindings/i);
const bareHiddenFormName = invalidContactForm(html => html.replace(
  'name="form-name" value="roofing-lead"',
  'name="form-name" name value="roofing-lead"'
));
assert.throws(() => finalizeV11ProductionSite(bareHiddenFormName), /quoted name|hidden bindings/i);

const wrongHoneypotInput = invalidContactForm(html => html.replace(
  '<input name="bot-field">',
  '<input name="wrong-field">'
));
assert.throws(() => finalizeV11ProductionSite(wrongHoneypotInput), /honeypot input binding/i);
const missingHoneypotInput = invalidContactForm(html => html.replace(
  '<p hidden><label>Leave blank<input name="bot-field"></label></p>',
  ''
));
assert.throws(() => finalizeV11ProductionSite(missingHoneypotInput), /honeypot input binding/i);
const duplicateHoneypotInput = invalidContactForm(html => html.replace(
  '<input name="bot-field">',
  '<input name="bot-field"><input name="bot-field">'
));
assert.throws(() => finalizeV11ProductionSite(duplicateHoneypotInput), /honeypot input binding/i);

const noFormFormaction = withApprovalMutation(render(externalContent), (html, page) => page.key === "contact"
  ? html.replace("</main>", '<button formaction="/elsewhere/">Override</button></main>')
  : html);
assert.throws(() => finalizeV11ProductionSite(noFormFormaction), /formaction overrides/i,
  "formaction is forbidden even when the site otherwise has no form");

assert.throws(() => finalizeV11ProductionSite(rendered), /image sources must use root-relative/i,
  "an unmapped remote receipt URL must fail closed");
assert.throws(() => finalizeV11ProductionSite(render(), {
  assets: [{ path: assetPath, bytes: assetBytes }]
}), /site-wide asset references/i, "an orphan bundled asset must fail closed");
assert.throws(() => finalizeV11ProductionSite(rendered, {
  assets: [{ path: `assets/${"0".repeat(64)}.jpg`, bytes: assetBytes, sourceUrl }]
}), /path digest/i);

const relativeAsset = withApprovalMutation(rendered, html => html.replaceAll(sourceUrl.replaceAll("&", "&amp;"), assetPath));
assert.throws(() => finalizeV11ProductionSite(relativeAsset, {
  assets: [{ path: assetPath, bytes: assetBytes }]
}), /non-root/i, "relative local assets are forbidden even when content-addressed");

const malformedAsset = withApprovalMutation(render(), (html, page) => page.key === "process"
  ? html.replace("</main>", '<img src="/assets/logo.png" alt="Logo"></main>')
  : html);
assert.throws(() => finalizeV11ProductionSite(malformedAsset), /non-content-addressed/i);

const oversizedAsset = boundedJpeg(V11_PRODUCTION_SAFE_CAPS.maxAssetBytes + 1, 0x51);
assert.throws(() => finalizeV11ProductionSite(render(), {
  assets: [{ path: `assets/${sha256(oversizedAsset)}.jpg`, bytes: oversizedAsset }]
}), /1250000 bytes/i);

const aggregateAssets = [0x61, 0x62, 0x63].map(fill => boundedJpeg(1_000_001, fill));
assert.throws(() => finalizeV11ProductionSite(render(), {
  assets: aggregateAssets.map(bytes => ({ path: `assets/${sha256(bytes)}.jpg`, bytes }))
}), /3000000 bytes/i);

const fourAssets = [0x71, 0x72, 0x73, 0x74].map(fill => boundedJpeg(128, fill));
assert.throws(() => finalizeV11ProductionSite(render(), {
  assets: fourAssets.map(bytes => ({ path: `assets/${sha256(bytes)}.jpg`, bytes }))
}), /asset count exceeds 3/i);

const oversizedPage = withApprovalMutation(render(), (html, page) => page.key === "services"
  ? padHtml(html, V11_PRODUCTION_SAFE_CAPS.maxHtmlBytes + 100)
  : html);
assert.throws(() => finalizeV11ProductionSite(oversizedPage), /services\/index\.html exceeds 150000 bytes/i);

const aggregateHtml = withApprovalMutation(render(), html => padHtml(html, 105_000));
assert.throws(() => finalizeV11ProductionSite(aggregateHtml), /aggregate HTML exceeds 500000 bytes/i);

const siblingCorePath = path.resolve(root, "../arc-site/netlify/lib/arc2-handoff-core.mjs");
let siblingCrossCheck = "skipped (arc-site sibling is not present)";
try {
  await access(siblingCorePath);
  const core = await import(pathToFileURL(siblingCorePath).href);
  assert.equal(core.ARTIFACT_EVIDENCE_VERSION, V11_ARTIFACT_EVIDENCE_VERSION);
  assert.equal(core.ARTIFACT_EVIDENCE_SCOPE, V11_ARTIFACT_EVIDENCE_SCOPE);
  assert.equal(core.ARTIFACT_SIGNATURE_PREFIX, V11_ARTIFACT_SIGNATURE_PREFIX);
  assert.equal(core.ARC2_CONTENT_SECURITY_POLICY, V11_PRODUCTION_CONTENT_SECURITY_POLICY);
  assert.equal(core.ARC2_PRODUCTION_HEADERS_FILE, V11_PRODUCTION_HEADERS_FILE);
  const normalizedEvidence = core.normalizeArtifactEvidence(evidence.canonical, evidenceSecret, new Date(issuedAt));
  assert.equal(core.verifyArtifactSignature(normalizedEvidence.canonical, evidence.hmacSha256, evidenceSecret), true);
  const normalizedDeploy = core.normalizeDeployArtifacts(finalized.deployArtifactsJson, normalizedEvidence.artifacts);
  assert.deepEqual(normalizedDeploy.map(entry => entry.path), finalized.artifacts.map(entry => entry.path));
  assert.equal(framedDigest(normalizedDeploy.filter(entry => V11_PRODUCTION_HTML_PATHS.includes(entry.path))),
    evidence.data.production_content_sha256, "arc-site must receive the exact ordered five-page production digest");
  siblingCrossCheck = "passed against arc-site v4 evidence/deploy normalizers";
} catch (error) {
  if (!String(error?.message || error).includes("ENOENT")) throw error;
}

console.log(`ARC v11 production finalizer passed: exact five-page v4 vector, whole-site digest, form/no-form routing, asset union, safe caps, and canonical evidence; sibling cross-check ${siblingCrossCheck}.`);
