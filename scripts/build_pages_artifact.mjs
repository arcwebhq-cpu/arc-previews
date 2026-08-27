import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNoRemoteRuntimeDependencies } from "./no_egress_contract.mjs";
import { assertSafeImageAsset } from "./image_asset_contract.mjs";
import { V11_PAGES, V11_SITE_CONTRACT_VERSION, V11_TEMPLATE_VERSION, relativePageHref } from "./v11_site_contract.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customerFolderPattern = /^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/;
const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const expectedShowcases = new Map([
  ["roofing", Object.freeze({ name: "Ironwood Roofing Concept", fixtureId: "a1000001", fixtureSource: "fixtures/v11_industries.mjs" })],
  ["dental", Object.freeze({ name: "Cedar Dental Concept", fixtureId: "b2000001", fixtureSource: "fixtures/v11_media_coverage.mjs" })],
  ["finance", Object.freeze({ name: "Clearwater Finance Concept", fixtureId: "b2000010", fixtureSource: "fixtures/v11_media_coverage.mjs" })]
]);
const expectedShowcaseAssets = new Map([
  ["roofing", Object.freeze({ file: "showcases/assets/3f8f6dcbc44f0bb37c1dccfad999f20a8a80213486c3c31dc438e89d1be887cb.webp", sha256: "3f8f6dcbc44f0bb37c1dccfad999f20a8a80213486c3c31dc438e89d1be887cb", width: 1122, height: 1402, ownership: "arc-generated-project-bound", provider: "arc-generated" })],
  ["dental", Object.freeze({ file: "showcases/assets/1db7b49151bb0a391d616b8658ab15cdd1d6949426d4e8c96eb12787fb553ce7.webp", sha256: "1db7b49151bb0a391d616b8658ab15cdd1d6949426d4e8c96eb12787fb553ce7", width: 1122, height: 1402, ownership: "arc-generated-project-bound", provider: "arc-generated" })],
  ["finance", Object.freeze({ file: "showcases/assets/c99014acba5ec713042002cda67c4efbbf7c0ecffcb4f6044b3a76134496aa5c.webp", sha256: "c99014acba5ec713042002cda67c4efbbf7c0ecffcb4f6044b3a76134496aa5c", width: 1122, height: 1402, ownership: "arc-generated-project-bound", provider: "arc-generated" })]
]);
const pagesIndex = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <title>ARC Fictional Design Concepts</title>
  <style>body{max-width:44rem;margin:0 auto;padding:4rem 1.25rem;background:#f8fafc;color:#0f172a;font:1rem/1.6 system-ui,sans-serif}h1{font-size:clamp(2rem,7vw,3.5rem);line-height:1.05}ul{padding-left:1.25rem}a{color:#17443a;font-weight:700}</style>
</head>
<body>
  <main>
    <p>ARC showcase directory</p>
    <h1>Fictional design concepts</h1>
    <p>These are fictional quality-assurance concepts, not real businesses. Checkout and lead collection are disabled.</p>
    <ul>
      <li><a href="./showcases/roofing/">Roofing concept</a></li>
      <li><a href="./showcases/dental/">Dental concept</a></li>
      <li><a href="./showcases/finance/">Finance concept</a></li>
    </ul>
  </main>
</body>
</html>
`;

const slashPath = value => String(value ?? "").split(path.sep).join("/");
const sha256 = value => createHash("sha256").update(value, typeof value === "string" ? "utf8" : undefined).digest("hex");
const privateCheckoutPattern=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v[34]_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v[12]|arc1-checkout-recipient-reservation-v[12]|arc1-preview-readiness-(?:core|observation)-v[12]|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v[12]|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;
const normalizePublicSurface=value=>{let current=String(value??"");for(let pass=0;pass<5;pass+=1){let next=current.replace(/&#(\d+);?/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);?/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&(amp|period|colon|sol|percnt|num|tab|newline|commat|lowbar);/gi,(_,name)=>({amp:"&",period:".",colon:":",sol:"/",percnt:"%",num:"#",tab:"\t",newline:"\n",commat:"@",lowbar:"_"})[name.toLowerCase()]).replace(/\/\*[\s\S]*?\*\//g,"").replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/[\u3002\uff0e\uff61]/g,".").replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));}});if(next===current)break;current=next;}return current.normalize("NFKC").toLowerCase();};
function assertNoPrivateCheckoutSurface(html,label){const raw=String(html??""),decoded=normalizePublicSurface(raw),compact=decoded.replace(/[\s\u0000-\u001f\u007f]+/g,"");if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(raw)||privateCheckoutPattern.test(decoded)||privateCheckoutPattern.test(compact)||/<[A-Za-z][^>]*\son[a-z0-9_-]+\s*=/i.test(raw))throw new Error(`ARC_PAGES_INVALID: ${label} contains private checkout capability/evidence`);for(const match of raw.matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){const attr=match[1]??match[2]??match[3]??"",normalized=normalizePublicSurface(attr);let parsed;try{parsed=new URL(normalized,"https://arc.invalid/");}catch{}const host=parsed?.hostname?.toLowerCase()||"";if(/%(?![0-9a-f]{2})/i.test(attr)||/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(attr)||/\p{Default_Ignorable_Code_Point}/u.test(normalized)||host==="buy.stripe.com"||host.endsWith(".buy.stripe.com")||new Set(["javascript:","vbscript:"]).has(parsed?.protocol)||/^(?:javascript|vbscript):/i.test(normalized)||privateCheckoutPattern.test(normalized)||privateCheckoutPattern.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g,"")))throw new Error(`ARC_PAGES_INVALID: ${label} contains private checkout capability/evidence`);}}
const trustedScriptManifests=Object.freeze({
  customerV10:Object.freeze({ hashes:["55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870","98cbb58e3ec829ddaec61983333a8bb500b91558625a346350bfc8fe4842b860"].sort(), manifest:"8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b" }),
  customerV11:Object.freeze({ hashes:["36441ce93ccc1f13622e64f34ba6e43a039cdb453e1f40010dd8c399c97751f4"], manifest:"1ef7f0088cdcf042b1593fbc11d7ea2d3c47e9ff92c94caf2f578179e3993685" })
});
function assertTrustedScripts(html,label,kind){const expected=trustedScriptManifests[kind];const scripts=html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)||[],hashes=scripts.map(sha256).sort();if(!expected||(html.match(/<script\b/gi)||[]).length!==scripts.length||(html.match(/<\/script\b/gi)||[]).length!==scripts.length||hashes.length!==expected.hashes.length||JSON.stringify(hashes)!==JSON.stringify(expected.hashes)||sha256(hashes.join("\n"))!==expected.manifest)throw new Error(`ARC_PAGES_INVALID: ${label} reviewed script manifest changed`);}
function assertNoUnsafeExecutableSurface(html,label){const raw=String(html??""),nonScript=raw.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,""),decodedNonScript=normalizePublicSurface(nonScript);if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScript)||/\p{Default_Ignorable_Code_Point}/u.test(decodedNonScript)||/<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(raw)||/<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style\s*>/i.test(decodedNonScript)||/\bstyle\s*=\s*(?:"[^"]*\\|'[^']*\\)/i.test(decodedNonScript))throw new Error(`ARC_PAGES_INVALID: ${label} contains an unreviewed executable/encoded surface`);}

function attribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? "";
}

function metaContents(html, name) {
  return (html.match(/<meta\b[^>]*>/gi) || [])
    .filter(tag => attribute(tag, "name").toLowerCase() === name.toLowerCase())
    .map(tag => attribute(tag, "content"));
}

function oneMetaContent(html, name, label) {
  const values = metaContents(html, name);
  if (values.length !== 1 || !values[0]) {
    throw new Error(`ARC_PAGES_INVALID: ${label} must contain exactly one ${name} meta value`);
  }
  return values[0];
}

function assertNoEmail(html, label) {
  if (emailAddressPattern.test(html) || emailAddressPattern.test(normalizePublicSurface(html))) {
    throw new Error(`ARC_PAGES_PRIVACY_FAILED: ${label} contains an email address`);
  }
}

function assertPagesImageAsset(bytes, contentType, label) {
  try {
    assertSafeImageAsset(bytes, contentType, label);
  } catch (error) {
    throw new Error(`ARC_PAGES_INVALID: ${error?.message || `${label} image validation failed`}`);
  }
}

function assertPrivateRobots(html, label) {
  const tokens = oneMetaContent(html, "robots", label)
    .toLowerCase()
    .split(",")
    .map(token => token.trim())
    .filter(Boolean);
  if (!tokens.includes("noindex") || !tokens.includes("nofollow")) {
    throw new Error(`ARC_PAGES_INVALID: ${label} must be noindex,nofollow`);
  }
}

function assertV10(html, label) {
  if (oneMetaContent(html, "arc-template-version", label) !== "10.0") {
    throw new Error(`ARC_PAGES_INVALID: ${label} must use the ARC v10 contract`);
  }
}

function assertV11(html, label, page) {
  if (
    oneMetaContent(html, "arc-template-version", label) !== V11_TEMPLATE_VERSION ||
    oneMetaContent(html, "arc-site-contract", label) !== V11_SITE_CONTRACT_VERSION ||
    oneMetaContent(html, "arc-page-key", label) !== page.key ||
    oneMetaContent(html, "arc-page-path", label) !== page.path
  ) throw new Error(`ARC_PAGES_INVALID: ${label} must use the exact ARC v11 page contract`);
}

function assertShowcaseNavigation(html, page, label) {
  const expected = V11_PAGES.map(destination => ({
    href: relativePageHref(page.key, destination.key),
    label: destination.label,
    current: destination.key === page.key
  }));
  for (const className of ["nav-links", "footer-links"]) {
    const navs = html.match(new RegExp(`<nav class="${className}"[\\s\\S]*?<\\/nav>`, "g")) || [];
    const links = (navs[0]?.match(/<a\b[^>]*>[^<]*<\/a>/g) || []).map(tag => ({
      href: attribute(tag, "href"),
      label: tag.replace(/^<a\b[^>]*>|<\/a>$/g, ""),
      current: attribute(tag, "aria-current") === "page"
    }));
    if (navs.length !== 1 || JSON.stringify(links) !== JSON.stringify(expected)) {
      throw new Error(`ARC_PAGES_INVALID: ${label} ${className} escaped the fixed five-page route order`);
    }
  }
}

function validateShowcase(html, profile, relative, page) {
  assertNoRemoteRuntimeDependencies(html);
  assertNoPrivateCheckoutSurface(html,relative);
  assertNoUnsafeExecutableSurface(html,relative);
  assertV11(html, relative, page);
  assertPrivateRobots(html, relative);
  assertNoEmail(html, relative);
  if (oneMetaContent(html, "arc-showcase-profile", relative) !== profile) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} showcase profile mismatch`);
  }
  if (
    oneMetaContent(html, "arc-site-mode", relative) !== "showcase" ||
    oneMetaContent(html, "arc-showcase-page-count", relative) !== String(V11_PAGES.length)
  ) throw new Error(`ARC_PAGES_INVALID: ${relative} showcase metadata mismatch`);
  const bodyTags = html.match(/<body\b[^>]*>/gi) || [];
  if (
    bodyTags.length !== 1 ||
    attribute(bodyTags[0], "data-arc-site-mode") !== "showcase" ||
    attribute(bodyTags[0], "data-arc-page") !== page.key ||
    attribute(bodyTags[0], "data-arc-expected-media-profile") !== profile
  ) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} must be in inert showcase mode`);
  }
  if (!html.includes("Fictional ARC design concept — not a real business. Checkout and lead collection are disabled.")) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} is missing its visible fictional-concept disclosure`);
  }
  if (/<script\b|<form\b|\bdata-netlify\b|\bnetlify-honeypot\b|\bdata-arc-checkout\b|buy\.stripe\.com|\bplink_[A-Za-z0-9]+|client_reference_id|arc-checkout-config|v[34]_[A-Za-z0-9_-]{135}/i.test(html)) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} contains an active form or checkout`);
  }
  assertShowcaseNavigation(html, page, relative);
  const nonScriptHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const expectedAsset = expectedShowcaseAssets.get(profile);
  const photoTags = (nonScriptHtml.match(/<img\b[^>]*>/gi) || [])
    .filter(tag => attribute(tag, "data-arc-showcase-photo") === profile);
  const expectedSource = `../assets/${path.basename(expectedAsset?.file || "")}`;
  if (!expectedAsset || /<(?:picture|source|video|svg)\b/i.test(nonScriptHtml)) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} contains an unallowlisted media surface`);
  }
  if (page.key === "home") {
    if (
      photoTags.length !== 1 ||
      (nonScriptHtml.match(/<img\b/gi) || []).length !== 1 ||
      attribute(photoTags[0], "data-arc-owned-asset") !== "true" ||
      attribute(photoTags[0], "data-arc-media-provider") !== expectedAsset.provider ||
      attribute(photoTags[0], "src") !== expectedSource ||
      attribute(photoTags[0], "width") !== String(expectedAsset.width) ||
      attribute(photoTags[0], "height") !== String(expectedAsset.height) ||
      !/fictional ARC design concept/i.test(attribute(photoTags[0], "alt"))
    ) throw new Error(`ARC_PAGES_INVALID: ${relative} must use one profile-matched ARC-owned content-addressed photo`);
  } else if ((nonScriptHtml.match(/<img\b/gi) || []).length !== 0) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} contains an image outside the fixed home-page allowlist`);
  }
  if (page.key === "contact" && !html.includes("Lead collection is intentionally disabled in this fictional ARC design concept.")) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} lacks the disabled lead-collection state`);
  }
}

function validatePagesIndex(html) {
  assertNoRemoteRuntimeDependencies(html);
  assertPrivateRobots(html, "index.html");
  assertNoEmail(html, "index.html");
  const links = (html.match(/<a\b[^>]*>/gi) || []).map(tag => attribute(tag, "href")).sort();
  const expectedLinks = [...expectedShowcases.keys()]
    .map(profile => `./showcases/${profile}/`)
    .sort();
  if (
    JSON.stringify(links) !== JSON.stringify(expectedLinks) ||
    /<form\b|\bdata-netlify\b|\bdata-arc-checkout\b|buy\.stripe\.com|<script\b/i.test(html)
  ) {
    throw new Error("ARC_PAGES_INVALID: root directory escaped the inert showcase allowlist");
  }
}

function customerPreviewSignal(html) {
  return /ARC_PREVIEW_PROOF_START|name=["']arc-preview-folder["']|name=["']arc-template-version["'][^>]*content=["']10\.0["']|data-arc-site-mode=["']preview["']/i.test(html);
}

function customerAssetPaths(html, folder, label) {
  const expectedPrefix = `https://arcwebhq-cpu.github.io/arc-previews/${folder}/assets/`;
  const paths = new Set();
  for (const tag of html.match(/<(?:img|source)\b[^>]*>/gi) || []) {
    for (const name of ["src", "srcset"]) {
      const raw = attribute(tag, name);
      if (!raw) continue;
      for (const candidate of (name === "srcset" ? raw.split(",").map(item => item.trim().split(/\s+/)[0]) : [raw])) {
        if (!candidate.includes(`/${folder}/assets/`)) continue;
        if (!candidate.startsWith(expectedPrefix)) throw new Error(`ARC_PAGES_INVALID: ${label} asset URL origin or path mismatch`);
        const relative = candidate.slice("https://arcwebhq-cpu.github.io/arc-previews/".length);
        if (!new RegExp(`^${folder}/assets/[a-f0-9]{64}\\.(?:png|jpg|webp)$`).test(relative)) {
          throw new Error(`ARC_PAGES_INVALID: ${label} asset URL is not content-addressed`);
        }
        paths.add(relative);
      }
    }
  }
  return [...paths].sort();
}

function validateV10CustomerPreview(html, folder) {
  const label = `${folder}/index.html`;
  assertV10(html, label);
  assertPrivateRobots(html, label);
  assertNoEmail(html, label);
  assertNoPrivateCheckoutSurface(html,label);
  assertNoUnsafeExecutableSurface(html,label);
  assertTrustedScripts(html.replace(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/i,""),label,"customerV10");

  const bodyTags = html.match(/<body\b[^>]*>/gi) || [];
  if (bodyTags.length !== 1 || attribute(bodyTags[0], "data-arc-site-mode") !== "preview") {
    throw new Error(`ARC_PAGES_INVALID: ${label} must be in preview mode`);
  }

  const proofPattern = /<!-- ARC_PREVIEW_PROOF_START -->\r?\n<meta name="arc-preview-folder" content="([a-z0-9][a-z0-9-]*-[a-f0-9]{8})">\r?\n<meta name="arc-preview-source-sha256" content="([a-f0-9]{64})">\r?\n<!-- ARC_PREVIEW_PROOF_END -->\r?\n/g;
  const proofs = [...html.matchAll(proofPattern)];
  if (
    proofs.length !== 1 ||
    proofs[0][1] !== folder ||
    oneMetaContent(html, "arc-preview-folder", label) !== folder ||
    oneMetaContent(html, "arc-preview-source-sha256", label) !== proofs[0][2] ||
    !/^<\/head>/i.test(html.slice(proofs[0].index + proofs[0][0].length))
  ) {
    throw new Error(`ARC_PAGES_INVALID: ${label} folder proof mismatch`);
  }
  const sourceHtml = html.replace(proofPattern, "");
  if (sha256(sourceHtml) !== proofs[0][2]) {
    throw new Error(`ARC_PAGES_INVALID: ${label} source proof hash mismatch`);
  }

  const inertNotice=(html.match(/<span data-arc-checkout-private>Review and payment are available through your private review link\.<\/span>/g)||[]).length;
  if(inertNotice!==1||/buy\.stripe\.com|\bplink_[A-Za-z0-9]+|client_reference_id|arc-checkout-config|v[34]_[A-Za-z0-9_-]{135}/i.test(html)){
    throw new Error(`ARC_PAGES_INVALID: ${label} must contain one inert checkout notice and no private checkout capability/evidence`);
  }
  return customerAssetPaths(html, folder, label);
}

function validateV11CustomerPreview(pages, folder) {
  if (!Array.isArray(pages) || pages.length !== V11_PAGES.length ||
      JSON.stringify(pages.map(item => item.page.path)) !== JSON.stringify(V11_PAGES.map(page => page.path))) {
    throw new Error(`ARC_PAGES_INVALID: ${folder} must contain the exact five-page v11 route vector`);
  }
  const assetPaths = new Set();
  let aggregateBytes = 0;
  let formCount = 0;
  for (const { page, html } of pages) {
    const label = `${folder}/${page.path}`;
    const bytes = Buffer.byteLength(html, "utf8");
    if (!bytes || bytes > 150_000) throw new Error(`ARC_PAGES_INVALID: ${label} exceeds the 150000-byte page cap`);
    aggregateBytes += bytes;
    assertV11(html, label, page);
    assertPrivateRobots(html, label);
    // V11 may contain an explicitly source-authorized public business email.
    // Requester, lead-recipient, and claim-recipient addresses are rejected by
    // the signed injector/publication gates before these exact bytes reach main.
    assertNoPrivateCheckoutSurface(html, label);
    assertNoUnsafeExecutableSurface(html, label);
    assertTrustedScripts(html, label, "customerV11");
    const bodyTags = html.match(/<body\b[^>]*>/gi) || [];
    if (bodyTags.length !== 1 || attribute(bodyTags[0], "data-arc-site-mode") !== "preview" ||
        attribute(bodyTags[0], "data-arc-page") !== page.key) {
      throw new Error(`ARC_PAGES_INVALID: ${label} must be the bound v11 preview page`);
    }
    const inertNotice = (html.match(/<span data-arc-checkout-private>Review and payment are available through your private review link\.<\/span>/g) || []).length;
    const toolbarCount = (html.match(/<aside class="arc-preview-toolbar"/g) || []).length;
    if (inertNotice !== 1 || toolbarCount !== 1) {
      throw new Error(`ARC_PAGES_INVALID: ${label} must contain one exact inert checkout notice`);
    }
    assertShowcaseNavigation(html, page, label);
    const forms = html.match(/<form\b[^>]*>/gi) || [];
    if (forms.length && page.key !== "contact") throw new Error(`ARC_PAGES_INVALID: ${label} contains a non-Contact form`);
    formCount += forms.length;
    for (const assetPath of customerAssetPaths(html, folder, label)) assetPaths.add(assetPath);
  }
  if (aggregateBytes > 500_000) throw new Error(`ARC_PAGES_INVALID: ${folder} exceeds the 500000-byte five-page cap`);
  if (formCount > 1) throw new Error(`ARC_PAGES_INVALID: ${folder} contains more than one Contact form`);
  const exactReceiptUrls = [...assetPaths].map(assetPath => `https://arcwebhq-cpu.github.io/arc-previews/${assetPath}`);
  for (const { page, html } of pages) assertNoRemoteRuntimeDependencies(html, { exactReceiptUrls });
  return [...assetPaths].sort();
}

async function readRegularFile(root, relative) {
  const normalized = slashPath(path.normalize(relative));
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`ARC_PAGES_INVALID: source path escaped repository: ${relative}`);
  }
  let absolute = root;
  let stats;
  for (const segment of normalized.split("/")) {
    absolute = path.join(absolute, segment);
    stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      throw new Error(`ARC_PAGES_INVALID: ${normalized} may not use symlinks`);
    }
  }
  if (!stats?.isFile()) {
    throw new Error(`ARC_PAGES_INVALID: ${normalized} must be a regular file`);
  }
  return readFile(absolute, "utf8");
}
async function readRegularBytes(root, relative) {
  const normalized = slashPath(path.normalize(relative));
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) throw new Error(`ARC_PAGES_INVALID: source path escaped repository: ${relative}`);
  let absolute = root, stats;
  for (const segment of normalized.split("/")) {
    absolute = path.join(absolute, segment); stats = await lstat(absolute);
    if (stats.isSymbolicLink()) throw new Error(`ARC_PAGES_INVALID: ${normalized} may not use symlinks`);
  }
  if (!stats?.isFile()) throw new Error(`ARC_PAGES_INVALID: ${normalized} must be a regular file`);
  return readFile(absolute);
}

async function writeArtifactFile(outputRoot, relative, content) {
  const normalized = slashPath(path.normalize(relative));
  if (normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`ARC_PAGES_INVALID: artifact path escaped output: ${relative}`);
  }
  const destination = path.join(outputRoot, ...normalized.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, typeof content === "string" ? "utf8" : undefined);
}

export async function buildPagesArtifact({ root = moduleRoot, output = path.join(root, ".pages-dist") } = {}) {
  const sourceRoot = path.resolve(root);
  const outputRoot = path.resolve(output);
  if (sourceRoot === path.parse(sourceRoot).root || outputRoot !== path.join(sourceRoot, ".pages-dist")) {
    throw new Error("ARC_PAGES_INVALID: unsafe source or output directory");
  }

  const manifest = JSON.parse(await readRegularFile(sourceRoot, "showcases/manifest.json"));
  if (!Array.isArray(manifest) || manifest.length !== expectedShowcases.size) {
    throw new Error("ARC_PAGES_INVALID: showcase manifest must contain exactly three entries");
  }
  const provenance = JSON.parse(await readRegularFile(sourceRoot, "showcases/assets/provenance.json"));
  const provenanceConstraints = ["fictional ARC design concept", "no real client or business", "no logos", "no embedded text", "no customer claims"];
  if (
    provenance?.version !== "arc-showcase-asset-provenance-v1" ||
    provenance?.generated_on !== "2026-08-24" ||
    provenance?.generator !== "OpenAI built-in image generator" ||
    JSON.stringify(provenance?.constraints) !== JSON.stringify(provenanceConstraints) ||
    !Array.isArray(provenance?.assets) ||
    provenance.assets.length !== expectedShowcaseAssets.size
  ) throw new Error("ARC_PAGES_INVALID: showcase asset provenance is incomplete");
  const provenanceByProfile = new Map(provenance.assets.map(item => [item?.profile, item]));
  const seenProfiles = new Set();
  const seenShowcasePages = new Set();
  validatePagesIndex(pagesIndex);
  const artifactFiles = [{ relative: "index.html", content: pagesIndex }];
  for (const item of manifest) {
    const profile = String(item?.profile ?? "");
    const expectedShowcase = expectedShowcases.get(profile);
    const expectedAsset = expectedShowcaseAssets.get(profile);
    const manifestAsset = item?.heroAsset;
    const provenanceAsset = provenanceByProfile.get(profile);
    if (
      seenProfiles.has(profile) ||
      !expectedShowcase ||
      item?.name !== expectedShowcase.name ||
      item?.fixtureId !== expectedShowcase.fixtureId ||
      item?.fixtureSource !== expectedShowcase.fixtureSource ||
      item?.contractVersion !== V11_SITE_CONTRACT_VERSION ||
      item?.templateVersion !== V11_TEMPLATE_VERSION ||
      item?.page_count !== V11_PAGES.length ||
      !Number.isSafeInteger(item?.total_bytes) || item.total_bytes < 1 || item.total_bytes > 500_000 ||
      Object.keys(item || {}).sort().join(",") !== "contractVersion,fixtureId,fixtureSource,heroAsset,name,page_count,pages,profile,templateVersion,total_bytes" ||
      !Array.isArray(item?.pages) || item.pages.length !== V11_PAGES.length ||
      !expectedAsset ||
      !manifestAsset ||
      manifestAsset.file !== expectedAsset.file ||
      manifestAsset.sha256 !== expectedAsset.sha256 ||
      manifestAsset.width !== expectedAsset.width ||
      manifestAsset.height !== expectedAsset.height ||
      manifestAsset.ownership !== expectedAsset.ownership ||
      manifestAsset.provider !== expectedAsset.provider ||
      Object.keys(manifestAsset).sort().join(",") !== "file,height,ownership,provider,sha256,width" ||
      !provenanceAsset ||
      provenanceAsset.file !== path.basename(expectedAsset.file) ||
      provenanceAsset.sha256 !== expectedAsset.sha256 ||
      !/^exec-[a-f0-9-]{36}$/.test(provenanceAsset.source_generation_id || "") ||
      typeof provenanceAsset.prompt_summary !== "string" ||
      provenanceAsset.prompt_summary.length < 40 ||
      provenanceAsset.prompt_summary.length > 300
    ) {
      throw new Error("ARC_PAGES_INVALID: showcase manifest escaped the fixed public allowlist");
    }
    seenProfiles.add(profile);
    let totalBytes = 0;
    for (let index = 0; index < V11_PAGES.length; index += 1) {
      const expectedPage = V11_PAGES[index];
      const page = item.pages[index];
      const relative = slashPath(page?.file);
      const expectedRelative = `showcases/${profile}/${expectedPage.path}`;
      if (
        !page ||
        Object.keys(page).sort().join(",") !== "bytes,file,key,label,path,sha256" ||
        page.key !== expectedPage.key || page.label !== expectedPage.label || page.path !== expectedPage.path ||
        relative !== expectedRelative || seenShowcasePages.has(relative) ||
        !/^[a-f0-9]{64}$/.test(page.sha256 || "") ||
        !Number.isSafeInteger(page.bytes) || page.bytes < 1 || page.bytes > 150_000
      ) throw new Error("ARC_PAGES_INVALID: showcase manifest page set escaped the fixed public allowlist");
      const html = await readRegularFile(sourceRoot, relative);
      const bytes = Buffer.byteLength(html, "utf8");
      if (bytes !== page.bytes || sha256(html) !== page.sha256) {
        throw new Error(`ARC_PAGES_INVALID: ${relative} manifest size or digest mismatch`);
      }
      validateShowcase(html, profile, relative, expectedPage);
      totalBytes += bytes;
      seenShowcasePages.add(relative);
      artifactFiles.push({ relative, content: html });
    }
    if (totalBytes !== item.total_bytes || totalBytes > 500_000) {
      throw new Error(`ARC_PAGES_INVALID: ${profile} manifest total byte binding mismatch`);
    }
    const heroBytes = await readRegularBytes(sourceRoot, expectedAsset.file);
    if (
      heroBytes.length < 1 ||
      heroBytes.length > 1_250_000 ||
      sha256(heroBytes) !== expectedAsset.sha256
    ) throw new Error(`ARC_PAGES_INVALID: ${expectedAsset.file} asset size or digest mismatch`);
    assertPagesImageAsset(heroBytes, "image/webp", expectedAsset.file);
    artifactFiles.push({ relative: expectedAsset.file, content: heroBytes });
  }
  if (seenProfiles.size !== expectedShowcases.size || seenShowcasePages.size !== expectedShowcases.size * V11_PAGES.length) {
    throw new Error("ARC_PAGES_INVALID: one or more fixed showcases are missing");
  }
  const showcaseAssetEntries = await readdir(path.join(sourceRoot, "showcases/assets"), { withFileTypes: true });
  const expectedShowcaseAssetFiles = ["provenance.json", ...[...expectedShowcaseAssets.values()].map(item => path.basename(item.file))].sort();
  if (
    showcaseAssetEntries.some(item => !item.isFile() || item.isSymbolicLink()) ||
    showcaseAssetEntries.map(item => item.name).sort().join("\n") !== expectedShowcaseAssetFiles.join("\n")
  ) throw new Error("ARC_PAGES_INVALID: showcases/assets contains extra, missing, or non-regular files");

  const customerPreviews = [];
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !customerFolderPattern.test(entry.name)) continue;
    const relative = `${entry.name}/index.html`;
    let html;
    try {
      html = await readRegularFile(sourceRoot, relative);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    // Old v9 folders share the deterministic path shape. They remain in git for
    // history, but only a complete ARC1 v10 proof or exact V11 site opts a folder
    // into Pages.
    if (!customerPreviewSignal(html)) continue;
    const templateVersions = metaContents(html, "arc-template-version");
    const isV11 = templateVersions.length === 1 && templateVersions[0] === V11_TEMPLATE_VERSION;
    let assetPaths;
    if (isV11) {
      const folderRoot = path.join(sourceRoot, entry.name);
      const rootEntries = await readdir(folderRoot, { withFileTypes: true });
      const allowedRootNames = new Set(["about", "assets", "contact", "index.html", "process", "services"]);
      const requiredRootNames = new Set(["about", "contact", "index.html", "process", "services"]);
      if (rootEntries.some(item => item.isSymbolicLink() || !allowedRootNames.has(item.name)) ||
          [...requiredRootNames].some(name => !rootEntries.some(item => item.name === name)) ||
          rootEntries.some(item => item.name === "index.html" ? !item.isFile() : item.name === "assets" ? !item.isDirectory() : !item.isDirectory())) {
        throw new Error(`ARC_PAGES_INVALID: ${entry.name} has extra, missing, or non-regular v11 root entries`);
      }
      const pages = [];
      for (const page of V11_PAGES) {
        if (page.path !== "index.html") {
          const directory = path.join(folderRoot, page.key);
          const pageEntries = await readdir(directory, { withFileTypes: true });
          if (pageEntries.length !== 1 || pageEntries[0].name !== "index.html" || !pageEntries[0].isFile() || pageEntries[0].isSymbolicLink()) {
            throw new Error(`ARC_PAGES_INVALID: ${entry.name}/${page.key} must contain exactly one regular index.html`);
          }
        }
        pages.push({ page, html: page.path === "index.html" ? html : await readRegularFile(sourceRoot, `${entry.name}/${page.path}`) });
      }
      assetPaths = validateV11CustomerPreview(pages, entry.name);
      for (const item of pages) artifactFiles.push({ relative: `${entry.name}/${item.page.path}`, content: item.html });
    } else {
      assetPaths = validateV10CustomerPreview(html, entry.name);
      const exactReceiptUrls = assetPaths.map(assetPath =>
        `https://arcwebhq-cpu.github.io/arc-previews/${assetPath}`
      );
      assertNoRemoteRuntimeDependencies(html, { exactReceiptUrls });
      artifactFiles.push({ relative, content: html });
    }
    const assetsDirectory = path.join(sourceRoot, entry.name, "assets");
    let directoryEntries = [], assetsDirectoryPresent = false;
    try { directoryEntries = await readdir(assetsDirectory, { withFileTypes: true }); assetsDirectoryPresent = true; } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (assetsDirectoryPresent !== Boolean(assetPaths.length) || directoryEntries.some(item => !item.isFile() || item.isSymbolicLink()) ||
        directoryEntries.map(item => `${entry.name}/assets/${item.name}`).sort().join("\n") !== assetPaths.join("\n")) {
      throw new Error(`ARC_PAGES_INVALID: ${entry.name}/assets contains extra, missing, or non-regular files`);
    }
    let totalAssetBytes = 0;
    for (const assetPath of assetPaths) {
      const bytes = await readRegularBytes(sourceRoot, assetPath);
      const match = assetPath.match(/\/([a-f0-9]{64})\.(png|jpg|webp)$/);
      totalAssetBytes += bytes.length;
      if (!match || bytes.length < 1 || bytes.length > 1250000 || totalAssetBytes > 3000000 || sha256(bytes) !== match[1]) {
        throw new Error(`ARC_PAGES_INVALID: ${assetPath} asset size or digest mismatch`);
      }
      const contentType = ({ png: "image/png", jpg: "image/jpeg", webp: "image/webp" })[match[2]];
      assertPagesImageAsset(bytes, contentType, assetPath);
      artifactFiles.push({ relative: assetPath, content: bytes });
    }
    customerPreviews.push(entry.name);
  }

  // Validate every source before replacing the previous artifact so a failed
  // build cannot leave a partially refreshed public directory behind.
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8");
  for (const artifact of artifactFiles) {
    await writeArtifactFile(outputRoot, artifact.relative, artifact.content);
  }

  return {
    output: outputRoot,
    showcases: [...seenProfiles].sort(),
    showcasePageCount: seenShowcasePages.size,
    customerPreviews: customerPreviews.sort(),
    fileCount: 1 + artifactFiles.length
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("ARC_PAGES_INVALID: build output is fixed at .pages-dist");
  const result = await buildPagesArtifact();
  console.log(`Built Pages allowlist: ${result.showcases.length} inert showcases (${result.showcasePageCount} pages), ${result.customerPreviews.length} customer previews, ${result.fileCount} files.`);
}
