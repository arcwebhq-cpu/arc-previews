import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNoRemoteRuntimeDependencies } from "./no_egress_contract.mjs";
import { assertSafeImageAsset } from "./image_asset_contract.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customerFolderPattern = /^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/;
const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const expectedShowcases = new Map([
  ["roofing", "showcases/roofing/index.html"],
  ["dental", "showcases/dental/index.html"],
  ["finance", "showcases/finance/index.html"]
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
const privateCheckoutPattern=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v3_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v1|arc1-checkout-recipient-reservation-v1|arc1-preview-readiness-(?:core|observation)-v1|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v1|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;
const normalizePublicSurface=value=>{let current=String(value??"");for(let pass=0;pass<5;pass+=1){let next=current.replace(/&#(\d+);?/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);?/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&(amp|period|colon|sol|percnt|num|tab|newline|commat|lowbar);/gi,(_,name)=>({amp:"&",period:".",colon:":",sol:"/",percnt:"%",num:"#",tab:"\t",newline:"\n",commat:"@",lowbar:"_"})[name.toLowerCase()]).replace(/\/\*[\s\S]*?\*\//g,"").replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/[\u3002\uff0e\uff61]/g,".").replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));}});if(next===current)break;current=next;}return current.normalize("NFKC").toLowerCase();};
function assertNoPrivateCheckoutSurface(html,label){const raw=String(html??""),decoded=normalizePublicSurface(raw),compact=decoded.replace(/[\s\u0000-\u001f\u007f]+/g,"");if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(raw)||privateCheckoutPattern.test(decoded)||privateCheckoutPattern.test(compact)||/<[A-Za-z][^>]*\son[a-z0-9_-]+\s*=/i.test(raw))throw new Error(`ARC_PAGES_INVALID: ${label} contains private checkout capability/evidence`);for(const match of raw.matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){const attr=match[1]??match[2]??match[3]??"",normalized=normalizePublicSurface(attr);let parsed;try{parsed=new URL(normalized,"https://arc.invalid/");}catch{}const host=parsed?.hostname?.toLowerCase()||"";if(/%(?![0-9a-f]{2})/i.test(attr)||/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(attr)||/\p{Default_Ignorable_Code_Point}/u.test(normalized)||host==="buy.stripe.com"||host.endsWith(".buy.stripe.com")||new Set(["javascript:","vbscript:"]).has(parsed?.protocol)||/^(?:javascript|vbscript):/i.test(normalized)||privateCheckoutPattern.test(normalized)||privateCheckoutPattern.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g,"")))throw new Error(`ARC_PAGES_INVALID: ${label} contains private checkout capability/evidence`);}}
const trustedScriptManifests=Object.freeze({
  customer:Object.freeze({ hashes:["55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870","98cbb58e3ec829ddaec61983333a8bb500b91558625a346350bfc8fe4842b860"].sort(), manifest:"8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b" }),
  showcase:Object.freeze({ hashes:["1c1fd564bd8722132dfb2473f862a68369fff343a58ab8519196225a538de62b","55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870"].sort(), manifest:"7d0ff7ea015b764d5bc06972614fb43cc07489bff90e28dddd87ad9ca081f0af" })
});
function assertTrustedScripts(html,label,kind="customer"){const expected=trustedScriptManifests[kind];const scripts=html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)||[],hashes=scripts.map(sha256).sort();if(!expected||(html.match(/<script\b/gi)||[]).length!==scripts.length||(html.match(/<\/script\b/gi)||[]).length!==scripts.length||hashes.length!==3||JSON.stringify(hashes)!==JSON.stringify(expected.hashes)||sha256(hashes.join("\n"))!==expected.manifest)throw new Error(`ARC_PAGES_INVALID: ${label} reviewed script manifest changed`);}
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

function validateShowcase(html, profile, relative) {
  assertNoRemoteRuntimeDependencies(html);
  assertNoPrivateCheckoutSurface(html,relative);
  assertNoUnsafeExecutableSurface(html,relative);
  assertTrustedScripts(html,relative,"showcase");
  assertV10(html, relative);
  assertPrivateRobots(html, relative);
  assertNoEmail(html, relative);
  if (oneMetaContent(html, "arc-showcase-profile", relative) !== profile) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} showcase profile mismatch`);
  }
  const bodyTags = html.match(/<body\b[^>]*>/gi) || [];
  if (bodyTags.length !== 1 || attribute(bodyTags[0], "data-arc-site-mode") !== "showcase") {
    throw new Error(`ARC_PAGES_INVALID: ${relative} must be in inert showcase mode`);
  }
  if (!html.includes("Fictional ARC design concept — not a real business. Checkout and lead collection are disabled.")) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} is missing its visible fictional-concept disclosure`);
  }
  if (/<form\b|\bdata-netlify\b|\bnetlify-honeypot\b|\bdata-arc-checkout\b|buy\.stripe\.com|\bplink_[A-Za-z0-9]+|client_reference_id|arc-checkout-config|v3_[A-Za-z0-9_-]{135}/i.test(html)) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} contains an active form or checkout`);
  }
  const nonScriptHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const expectedAsset = expectedShowcaseAssets.get(profile);
  const photoTags = (nonScriptHtml.match(/<img\b[^>]*>/gi) || [])
    .filter(tag => attribute(tag, "data-arc-showcase-photo") === profile);
  const expectedSource = `../assets/${path.basename(expectedAsset?.file || "")}`;
  if (
    !expectedAsset ||
    photoTags.length !== 1 ||
    (nonScriptHtml.match(/<img\b/gi) || []).length !== 1 ||
    attribute(photoTags[0], "data-arc-owned-asset") !== "true" ||
    attribute(photoTags[0], "data-arc-media-provider") !== expectedAsset.provider ||
    attribute(photoTags[0], "src") !== expectedSource ||
    attribute(photoTags[0], "width") !== String(expectedAsset.width) ||
    attribute(photoTags[0], "height") !== String(expectedAsset.height) ||
    !/fictional ARC design concept/i.test(attribute(photoTags[0], "alt")) ||
    /<(?:picture|source|video|svg)\b/i.test(nonScriptHtml)
  ) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} must use one profile-matched ARC-owned content-addressed photo`);
  }
}

function validatePagesIndex(html) {
  assertNoRemoteRuntimeDependencies(html);
  assertPrivateRobots(html, "index.html");
  assertNoEmail(html, "index.html");
  const links = (html.match(/<a\b[^>]*>/gi) || []).map(tag => attribute(tag, "href")).sort();
  const expectedLinks = [...expectedShowcases.values()]
    .map(relative => `./${relative.replace(/index\.html$/, "")}`)
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

function validateCustomerPreview(html, folder) {
  const label = `${folder}/index.html`;
  assertV10(html, label);
  assertPrivateRobots(html, label);
  assertNoEmail(html, label);
  assertNoPrivateCheckoutSurface(html,label);
  assertNoUnsafeExecutableSurface(html,label);
  assertTrustedScripts(html.replace(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/i,""),label);

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

  const inertNotice=(html.match(/<span data-arc-checkout-private>Checkout is available only through the private approval email\.<\/span>/g)||[]).length;
  if(inertNotice!==1||/buy\.stripe\.com|\bplink_[A-Za-z0-9]+|client_reference_id|arc-checkout-config|v3_[A-Za-z0-9_-]{135}/i.test(html)){
    throw new Error(`ARC_PAGES_INVALID: ${label} must contain one inert checkout notice and no private checkout capability/evidence`);
  }
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
  validatePagesIndex(pagesIndex);
  const artifactFiles = [{ relative: "index.html", content: pagesIndex }];
  for (const item of manifest) {
    const profile = String(item?.profile ?? "");
    const relative = slashPath(item?.file);
    const expectedAsset = expectedShowcaseAssets.get(profile);
    const manifestAsset = item?.heroAsset;
    const provenanceAsset = provenanceByProfile.get(profile);
    if (
      seenProfiles.has(profile) ||
      expectedShowcases.get(profile) !== relative ||
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
    const html = await readRegularFile(sourceRoot, relative);
    validateShowcase(html, profile, relative);
    const heroBytes = await readRegularBytes(sourceRoot, expectedAsset.file);
    if (
      heroBytes.length < 1 ||
      heroBytes.length > 1_250_000 ||
      sha256(heroBytes) !== expectedAsset.sha256
    ) throw new Error(`ARC_PAGES_INVALID: ${expectedAsset.file} asset size or digest mismatch`);
    assertPagesImageAsset(heroBytes, "image/webp", expectedAsset.file);
    artifactFiles.push({ relative: expectedAsset.file, content: heroBytes });
    artifactFiles.push({ relative, content: html });
  }
  if (seenProfiles.size !== expectedShowcases.size) {
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
    // history, but only a complete ARC1 v10 proof opts a folder into Pages.
    if (!customerPreviewSignal(html)) continue;
    const assetPaths = validateCustomerPreview(html, entry.name);
    const exactReceiptUrls = assetPaths.map(assetPath =>
      `https://arcwebhq-cpu.github.io/arc-previews/${assetPath}`
    );
    assertNoRemoteRuntimeDependencies(html, { exactReceiptUrls });
    const assetsDirectory = path.join(sourceRoot, entry.name, "assets");
    let directoryEntries = [];
    try { directoryEntries = await readdir(assetsDirectory, { withFileTypes: true }); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    if (directoryEntries.some(item => !item.isFile() || item.isSymbolicLink()) ||
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
    artifactFiles.push({ relative, content: html });
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
    customerPreviews: customerPreviews.sort(),
    fileCount: 1 + artifactFiles.length
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("ARC_PAGES_INVALID: build output is fixed at .pages-dist");
  const result = await buildPagesArtifact();
  console.log(`Built Pages allowlist: ${result.showcases.length} inert showcases, ${result.customerPreviews.length} customer previews, ${result.fileCount} files.`);
}
