import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const customerFolderPattern = /^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/;
const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const expectedShowcases = new Map([
  ["roofing", "showcases/roofing/index.html"],
  ["dental", "showcases/dental/index.html"],
  ["finance", "showcases/finance/index.html"]
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
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");

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
  if (emailAddressPattern.test(html)) {
    throw new Error(`ARC_PAGES_PRIVACY_FAILED: ${label} contains an email address`);
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
  if (/<form\b|\bdata-netlify\b|\bnetlify-honeypot\b|\bdata-arc-checkout\b|buy\.stripe\.com/i.test(html)) {
    throw new Error(`ARC_PAGES_INVALID: ${relative} contains an active form or checkout`);
  }
}

function validatePagesIndex(html) {
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

  const checkoutTags = (html.match(/<a\b[^>]*>/gi) || [])
    .filter(tag => /(?:^|\s)data-arc-checkout(?:\s|=|>)/i.test(tag));
  if (checkoutTags.length !== 1) {
    throw new Error(`ARC_PAGES_INVALID: ${label} must contain exactly one bound test checkout`);
  }
  const encodedHref = attribute(checkoutTags[0], "href");
  const href = encodedHref.replaceAll("&amp;", "&");
  let checkout;
  try {
    checkout = new URL(href);
  } catch (error) {
    throw new Error(`ARC_PAGES_INVALID: ${label} checkout URL`);
  }
  const references = checkout.searchParams.getAll("client_reference_id");
  if (
    checkout.origin !== "https://buy.stripe.com" ||
    checkout.username ||
    checkout.password ||
    !/^\/test_[A-Za-z0-9]+$/.test(checkout.pathname) ||
    references.length !== 1 ||
    references[0].length !== 138 ||
    !new RegExp(`^${folder.slice(-8)}_[a-f0-9]{64}_[a-f0-9]{64}$`).test(references[0])
  ) {
    throw new Error(`ARC_PAGES_INVALID: ${label} checkout is not bound to this preview in Stripe test mode`);
  }
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

async function writeArtifactFile(outputRoot, relative, content) {
  const normalized = slashPath(path.normalize(relative));
  if (normalized.startsWith("../") || path.isAbsolute(normalized)) {
    throw new Error(`ARC_PAGES_INVALID: artifact path escaped output: ${relative}`);
  }
  const destination = path.join(outputRoot, ...normalized.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
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
  const seenProfiles = new Set();
  validatePagesIndex(pagesIndex);
  const artifactFiles = [{ relative: "index.html", content: pagesIndex }];
  for (const item of manifest) {
    const profile = String(item?.profile ?? "");
    const relative = slashPath(item?.file);
    if (seenProfiles.has(profile) || expectedShowcases.get(profile) !== relative) {
      throw new Error("ARC_PAGES_INVALID: showcase manifest escaped the fixed public allowlist");
    }
    seenProfiles.add(profile);
    const html = await readRegularFile(sourceRoot, relative);
    validateShowcase(html, profile, relative);
    artifactFiles.push({ relative, content: html });
  }
  if (seenProfiles.size !== expectedShowcases.size) {
    throw new Error("ARC_PAGES_INVALID: one or more fixed showcases are missing");
  }

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
    validateCustomerPreview(html, entry.name);
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
    fileCount: 2 + seenProfiles.size + customerPreviews.length
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("ARC_PAGES_INVALID: build output is fixed at .pages-dist");
  const result = await buildPagesArtifact();
  console.log(`Built Pages allowlist: ${result.showcases.length} inert showcases, ${result.customerPreviews.length} customer previews, ${result.fileCount} files.`);
}
