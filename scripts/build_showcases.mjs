import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fixtures as launchFixtures } from "../fixtures/v11_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v11_media_coverage.mjs";
import {
  V11_PAGES,
  V11_SITE_CONTRACT_VERSION,
  V11_TEMPLATE_VERSION,
  relativePageHref,
  renderV11Site
} from "./v11_site_contract.mjs";
import { assertNoRemoteRuntimeDependencies } from "./no_egress_contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE_V11.html"), "utf8");
const sha256 = value => createHash("sha256").update(value, typeof value === "string" ? "utf8" : undefined).digest("hex");
const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const disclosure = "Fictional ARC design concept — not a real business. Checkout and lead collection are disabled.";
const disabledLeadCopy = "Lead collection is intentionally disabled in this fictional ARC design concept.";
const pagePaths = V11_PAGES.map(page => page.path);

const normalizePublicSurface=value=>{let current=String(value??"");for(let pass=0;pass<5;pass+=1){let next=current.replace(/&#(\d+);?/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);?/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&(amp|period|colon|sol|percnt|num|tab|newline);/gi,(_,name)=>({amp:"&",period:".",colon:":",sol:"/",percnt:"%",num:"#",tab:"\t",newline:"\n"})[name.toLowerCase()]).replace(/\/\*[\s\S]*?\*\//g,"").replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/[\u3002\uff0e\uff61]/g,".").replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));}});if(next===current)break;current=next;}return current.normalize("NFKC").toLowerCase();};
const privateCheckoutPattern=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v[34]_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v[12]|arc1-checkout-recipient-reservation-v[12]|arc1-preview-readiness-(?:core|observation)-v[12]|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v[12]/i;
const assertNoPrivateCheckoutSurface=(html,label)=>{const raw=String(html??""),decoded=normalizePublicSurface(raw),compact=decoded.replace(/[\s\u0000-\u001f\u007f]+/g,"");if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(raw)||privateCheckoutPattern.test(decoded)||privateCheckoutPattern.test(compact)||/<[A-Za-z][^>]*\son[a-z0-9_-]+\s*=/i.test(raw))throw new Error(`ARC_SHOWCASE_INVALID: ${label} contains private checkout evidence`);for(const match of raw.matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){const attr=match[1]??match[2]??match[3]??"",normalized=normalizePublicSurface(attr);let parsed;try{parsed=new URL(normalized,"https://arc.invalid/");}catch{}const host=parsed?.hostname?.toLowerCase()||"";if(/%(?![0-9a-f]{2})/i.test(attr)||/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(attr)||/\p{Default_Ignorable_Code_Point}/u.test(normalized)||host==="buy.stripe.com"||host.endsWith(".buy.stripe.com")||/^(?:javascript|vbscript):/i.test(normalized)||privateCheckoutPattern.test(normalized))throw new Error(`ARC_SHOWCASE_INVALID: ${label} contains private checkout evidence`);}};

const showcaseDefinitions = Object.freeze([
  Object.freeze({ profile: "roofing", name: "Ironwood Roofing Concept", fixtureId: "a1000001", fixtureSource: "fixtures/v11_industries.mjs" }),
  Object.freeze({ profile: "dental", name: "Cedar Dental Concept", fixtureId: "b2000001", fixtureSource: "fixtures/v11_media_coverage.mjs" }),
  Object.freeze({ profile: "finance", name: "Clearwater Finance Concept", fixtureId: "b2000010", fixtureSource: "fixtures/v11_media_coverage.mjs" })
]);

/* ARC-owned project-bound photos, named by the SHA-256 of their WebP bytes. */
const showcaseHeroAssets = Object.freeze({
  roofing: Object.freeze({
    file: "showcases/assets/3f8f6dcbc44f0bb37c1dccfad999f20a8a80213486c3c31dc438e89d1be887cb.webp",
    width: 1122,
    height: 1402,
    alt: "Roofer working on a residential roof in a fictional ARC design concept"
  }),
  dental: Object.freeze({
    file: "showcases/assets/1db7b49151bb0a391d616b8658ab15cdd1d6949426d4e8c96eb12787fb553ce7.webp",
    width: 1122,
    height: 1402,
    alt: "Dental professional preparing a treatment room in a fictional ARC design concept"
  }),
  finance: Object.freeze({
    file: "showcases/assets/c99014acba5ec713042002cda67c4efbbf7c0ecffcb4f6044b3a76134496aa5c.webp",
    width: 1122,
    height: 1402,
    alt: "Financial professional reviewing a planning chart in a fictional ARC design concept"
  })
});

const fixtureById = new Map([...launchFixtures, ...mediaCoverageFixtures].map(fixture => [fixture.id, fixture]));
const showcaseProvenance = JSON.parse(await readFile(path.join(root, "showcases/assets/provenance.json"), "utf8"));
const requiredProvenanceConstraints = [
  "fictional ARC design concept",
  "no real client or business",
  "no logos",
  "no embedded text",
  "no customer claims"
];
if (
  showcaseProvenance?.version !== "arc-showcase-asset-provenance-v1" ||
  showcaseProvenance?.generated_on !== "2026-08-24" ||
  showcaseProvenance?.generator !== "OpenAI built-in image generator" ||
  JSON.stringify(showcaseProvenance?.constraints) !== JSON.stringify(requiredProvenanceConstraints) ||
  !Array.isArray(showcaseProvenance?.assets) ||
  showcaseProvenance.assets.length !== showcaseDefinitions.length
) throw new Error("ARC_SHOWCASE_INVALID: ARC-owned image provenance is incomplete");
const showcaseProvenanceByProfile = new Map(showcaseProvenance.assets.map(item => [item?.profile, item]));

const replaceExactlyOnce = (html, pattern, replacement, label) => {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) throw new Error(`ARC_SHOWCASE_INVALID: expected exactly one ${label}; found ${matches.length}`);
  return html.replace(pattern, replacement);
};

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? "";
}

function assertNavigation(html, page, label) {
  const expected = V11_PAGES.map(destination => ({
    href: relativePageHref(page.key, destination.key),
    label: destination.label,
    current: destination.key === page.key
  }));
  for (const className of ["nav-links", "footer-links"]) {
    const navs = html.match(new RegExp(`<nav class="${className}"[\\s\\S]*?<\\/nav>`, "g")) || [];
    if (navs.length !== 1) throw new Error(`ARC_SHOWCASE_INVALID: ${label} must contain one ${className} navigation`);
    const links = (navs[0].match(/<a\b[^>]*>[^<]*<\/a>/g) || []).map(tag => ({
      href: attribute(tag, "href"),
      label: tag.replace(/^<a\b[^>]*>|<\/a>$/g, ""),
      current: attribute(tag, "aria-current") === "page"
    }));
    if (JSON.stringify(links) !== JSON.stringify(expected)) {
      throw new Error(`ARC_SHOWCASE_INVALID: ${label} ${className} route order changed`);
    }
  }
}

const showcaseStyle = `  <style data-arc-showcase-style>
    body[data-arc-site-mode="showcase"]{--arc-showcase-notice-height:38px;padding-top:var(--arc-showcase-notice-height)}
    body[data-arc-site-mode="showcase"] .site-header{top:var(--arc-showcase-notice-height)}
    .arc-showcase-notice{position:fixed;z-index:1000;inset:0 0 auto;display:grid;place-items:center;min-height:var(--arc-showcase-notice-height);padding:6px 20px;text-align:center;background:#111;color:#fff;font:700 12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.02em}
    .showcase-form-disabled{padding:18px;border:1px solid currentColor;border-radius:12px;font-weight:700;line-height:1.5}
    .showcase-hero-photo{object-fit:cover}
    body[data-arc-expected-media-profile="roofing"] .showcase-hero-photo{object-position:52% center}
    body[data-arc-expected-media-profile="dental"] .showcase-hero-photo{object-position:50% center}
    body[data-arc-expected-media-profile="finance"] .showcase-hero-photo{object-position:53% center}
    @media(max-width:600px){body[data-arc-site-mode="showcase"]{--arc-showcase-notice-height:60px}.arc-showcase-notice{padding-inline:14px;font-size:11px}body[data-arc-site-mode="showcase"] h1{font-size:clamp(36px,11vw,52px)}}
  </style>`;

function buildShowcasePage(renderedPage, definition, heroAsset) {
  const label = `${definition.profile}/${renderedPage.path}`;
  let html = renderedPage.approvalHtml;
  html = replaceExactlyOnce(html, /(<body\b[^>]*\bdata-arc-site-mode=)["']preview["']/i, '$1"showcase"', `${label} preview body mode`);
  html = replaceExactlyOnce(
    html,
    /(<meta\s+name="arc-site-contract"\s+content="arc-five-page-site-v1">)/i,
    `$1\n  <meta name="arc-site-mode" content="showcase">\n  <meta name="arc-showcase-profile" content="${definition.profile}">\n  <meta name="arc-showcase-page-count" content="5">`,
    `${label} site contract metadata`
  );
  html = replaceExactlyOnce(html, /script-src 'unsafe-inline'/i, "script-src 'none'", `${label} script CSP`);
  html = replaceExactlyOnce(html, /img-src 'self' data: https:/i, "img-src 'self' data:", `${label} image CSP`);
  html = replaceExactlyOnce(html, /form-action 'self'/i, "form-action 'none'", `${label} form-action CSP`);
  html = replaceExactlyOnce(html, /<script>\s*\(\(\)=>\{[\s\S]*?<\/script>\s*/i, "", `${label} preview script`);
  const previewToolbarRules = html.match(/[^{}]*\.arc-preview-toolbar[^{}]*\{[^{}]*\}/g) || [];
  if (previewToolbarRules.length < 5) throw new Error(`ARC_SHOWCASE_INVALID: ${label} preview toolbar CSS contract changed`);
  html = html.replace(/[^{}]*\.arc-preview-toolbar[^{}]*\{[^{}]*\}/g, "");
  html = replaceExactlyOnce(html, /<\/head>/i, `${showcaseStyle}\n</head>`, `${label} head closing tag`);
  html = replaceExactlyOnce(html, /(<body\b[^>]*>)/i, `$1\n  <div class="arc-showcase-notice" role="note">${disclosure}</div>`, `${label} body opening tag`);

  if (renderedPage.key === "home") {
    const heroAssetSrc = `../assets/${path.basename(heroAsset.file)}`;
    const heroPhoto = `<img class="showcase-hero-photo" data-arc-showcase-photo="${definition.profile}" data-arc-owned-asset="true" data-arc-media-provider="arc-generated" src="${heroAssetSrc}" alt="${heroAsset.alt}" width="${heroAsset.width}" height="${heroAsset.height}" loading="eager" decoding="async">`;
    html = replaceExactlyOnce(
      html,
      /<span class="visual-orbit" aria-hidden="true"><\/span><span class="visual-core" aria-hidden="true"><\/span>/,
      heroPhoto,
      `${label} local visual placeholder`
    );
  }

  if (renderedPage.key === "contact") {
    html = replaceExactlyOnce(html, /<form\b[\s\S]*?<\/form>/i, `<div class="showcase-form-disabled" role="note">${disabledLeadCopy}</div>`, `${label} lead form`);
  }

  const decoded = normalizePublicSurface(html);
  const nonScriptHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const activeSurfaceReasons = [
    /<script\b/i.test(html) && "script",
    /<form\b/i.test(html) && "form",
    /\bdata-netlify\b|\bnetlify-honeypot\b/i.test(html) && "Netlify marker",
    /\bdata-arc-checkout\b/i.test(html) && "checkout marker",
    privateCheckoutPattern.test(decoded) && "private checkout evidence",
    emailAddressPattern.test(html) && "email address",
    /<(?:picture|source|video|svg)\b/i.test(nonScriptHtml) && "unallowlisted media"
  ].filter(Boolean);
  if (activeSurfaceReasons.length) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${label} retained an active/private surface (${activeSurfaceReasons.join(", ")})`);
  }
  assertNoPrivateCheckoutSurface(html, label);
  assertNoRemoteRuntimeDependencies(html);
  if (
    !new RegExp(`<meta name="arc-page-key" content="${renderedPage.key}">`).test(html) ||
    !html.includes(`<meta name="arc-page-path" content="${renderedPage.path}">`) ||
    !/<meta name="robots" content="[^"]*noindex[^"]*nofollow/i.test(html) ||
    !html.includes(disclosure) ||
    (html.match(/arc-showcase-notice/g) || []).length < 2 ||
    !/data-arc-site-mode="showcase"/i.test(html)
  ) throw new Error(`ARC_SHOWCASE_INVALID: ${label} lost its page/privacy classification`);
  assertNavigation(html, renderedPage, label);

  const imageTags = nonScriptHtml.match(/<img\b[^>]*>/gi) || [];
  if (renderedPage.key === "home") {
    const heroAssetSrc = `../assets/${path.basename(heroAsset.file)}`;
    if (
      imageTags.length !== 1 ||
      attribute(imageTags[0], "data-arc-showcase-photo") !== definition.profile ||
      attribute(imageTags[0], "data-arc-owned-asset") !== "true" ||
      attribute(imageTags[0], "data-arc-media-provider") !== "arc-generated" ||
      attribute(imageTags[0], "src") !== heroAssetSrc ||
      attribute(imageTags[0], "width") !== String(heroAsset.width) ||
      attribute(imageTags[0], "height") !== String(heroAsset.height)
    ) throw new Error(`ARC_SHOWCASE_INVALID: ${label} must use its ARC-owned content-addressed hero photo`);
  } else if (imageTags.length) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${label} contains an unallowlisted image`);
  }
  if (renderedPage.key === "contact" && !html.includes(disabledLeadCopy)) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${label} lacks the disabled lead-collection state`);
  }
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes < 1 || bytes > 150_000) throw new Error(`ARC_SHOWCASE_INVALID: ${label} exceeds the 150000-byte page cap`);
  return { html, bytes };
}

const generated = [];
const manifest = [];
for (const definition of showcaseDefinitions) {
  const fixture = fixtureById.get(definition.fixtureId);
  if (
    !fixture || fixture.expectedProfile !== definition.profile || fixture.content.BUSINESS_NAME !== definition.name ||
    fixture.contractVersion !== V11_SITE_CONTRACT_VERSION || fixture.expectedPageCount !== V11_PAGES.length
  ) throw new Error(`ARC_SHOWCASE_INVALID: ${definition.profile} v11 fixture binding changed`);

  const heroAsset = showcaseHeroAssets[definition.profile];
  const heroAssetName = path.basename(heroAsset.file);
  const heroAssetSha256 = heroAssetName.replace(/\.webp$/i, "");
  const provenance = showcaseProvenanceByProfile.get(definition.profile);
  if (
    !provenance || provenance.file !== heroAssetName || provenance.sha256 !== heroAssetSha256 ||
    !/^exec-[a-f0-9-]{36}$/.test(provenance.source_generation_id || "") ||
    typeof provenance.prompt_summary !== "string" || provenance.prompt_summary.length < 40 || provenance.prompt_summary.length > 300
  ) throw new Error(`ARC_SHOWCASE_INVALID: ${definition.profile} image provenance does not match its content-addressed asset`);
  const heroAssetBytes = await readFile(path.join(root, heroAsset.file));
  if (
    !/^[a-f0-9]{64}\.webp$/.test(heroAssetName) || sha256(heroAssetBytes) !== heroAssetSha256 ||
    heroAssetBytes.length < 1 || heroAssetBytes.length > 1_250_000 ||
    heroAssetBytes.subarray(0, 4).toString("ascii") !== "RIFF" || heroAssetBytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) throw new Error(`ARC_SHOWCASE_INVALID: ${definition.profile} hero asset failed content-addressed WebP integrity`);

  const site = renderV11Site(template, fixture.content, { trustedEventPrefix: fixture.id, customerEmail: fixture.customerEmail });
  if (
    site.contractVersion !== V11_SITE_CONTRACT_VERSION || site.templateVersion !== V11_TEMPLATE_VERSION ||
    site.pageCount !== V11_PAGES.length || site.expectedMediaProfile !== definition.profile ||
    JSON.stringify(site.pages.map(page => page.path)) !== JSON.stringify(pagePaths)
  ) throw new Error(`ARC_SHOWCASE_INVALID: ${definition.profile} renderer did not return the canonical five-page bundle`);

  const pages = [];
  let totalBytes = 0;
  for (const renderedPage of site.pages) {
    const { html, bytes } = buildShowcasePage(renderedPage, definition, heroAsset);
    const file = `showcases/${definition.profile}/${renderedPage.path}`;
    totalBytes += bytes;
    pages.push({ key: renderedPage.key, label: renderedPage.label, path: renderedPage.path, file, sha256: sha256(html), bytes });
    generated.push({ file, html });
  }
  if (totalBytes > 500_000) throw new Error(`ARC_SHOWCASE_INVALID: ${definition.profile} exceeds the 500000-byte site cap`);
  manifest.push({
    profile: definition.profile,
    name: definition.name,
    fixtureId: definition.fixtureId,
    fixtureSource: definition.fixtureSource,
    contractVersion: V11_SITE_CONTRACT_VERSION,
    templateVersion: V11_TEMPLATE_VERSION,
    page_count: V11_PAGES.length,
    total_bytes: totalBytes,
    pages,
    heroAsset: {
      file: heroAsset.file,
      sha256: heroAssetSha256,
      width: heroAsset.width,
      height: heroAsset.height,
      ownership: "arc-generated-project-bound",
      provider: "arc-generated"
    }
  });
}

for (const definition of showcaseDefinitions) {
  await rm(path.join(root, "showcases", definition.profile), { recursive: true, force: true });
}
for (const page of generated) {
  await mkdir(path.dirname(path.join(root, page.file)), { recursive: true });
  await writeFile(path.join(root, page.file), page.html, "utf8");
  console.log(`Built inert public showcase page: ${page.file}`);
}
await writeFile(path.join(root, "showcases/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Built and classified ${manifest.length} ARC v11 showcase sites (${generated.length} pages).`);
