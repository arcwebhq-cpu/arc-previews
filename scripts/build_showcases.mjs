import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const normalizePublicSurface=value=>{let current=String(value??"");for(let pass=0;pass<5;pass+=1){let next=current.replace(/&#(\d+);?/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);?/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&(amp|period|colon|sol|percnt|num|tab|newline);/gi,(_,name)=>({amp:"&",period:".",colon:":",sol:"/",percnt:"%",num:"#",tab:"\t",newline:"\n"})[name.toLowerCase()]).replace(/\/\*[\s\S]*?\*\//g,"").replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/[\u3002\uff0e\uff61]/g,".").replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));}});if(next===current)break;current=next;}return current.normalize("NFKC").toLowerCase();};
const privateCheckoutPattern=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v3_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v1|arc1-checkout-recipient-reservation-v1|arc1-preview-readiness-(?:core|observation)-v1|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v1/i;
const assertNoPrivateCheckoutSurface=(html,label)=>{const raw=String(html??""),decoded=normalizePublicSurface(raw),compact=decoded.replace(/[\s\u0000-\u001f\u007f]+/g,"");if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(raw)||privateCheckoutPattern.test(decoded)||privateCheckoutPattern.test(compact)||/<[A-Za-z][^>]*\son[a-z0-9_-]+\s*=/i.test(raw))throw new Error(`ARC_SHOWCASE_INVALID: ${label} contains private checkout evidence`);for(const match of raw.matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){const attr=match[1]??match[2]??match[3]??"",normalized=normalizePublicSurface(attr);let parsed;try{parsed=new URL(normalized,"https://arc.invalid/");}catch{}const host=parsed?.hostname?.toLowerCase()||"";if(/%(?![0-9a-f]{2})/i.test(attr)||/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(attr)||/\p{Default_Ignorable_Code_Point}/u.test(normalized)||host==="buy.stripe.com"||host.endsWith(".buy.stripe.com")||/^(?:javascript|vbscript):/i.test(normalized)||privateCheckoutPattern.test(normalized))throw new Error(`ARC_SHOWCASE_INVALID: ${label} contains private checkout evidence`);}};
const showcases = [
  {
    profile: "roofing",
    name: "Ironwood Roofing Concept",
    sourceFile: "qa-v10/ironwood-roofing-concept-a1000001/index.html",
    sourceProvenanceCopy: "The local art direction reflects the roofing category without presenting concept imagery as completed client work."
  },
  {
    profile: "dental",
    name: "Cedar Dental Concept",
    sourceFile: "qa-v10/cedar-dental-concept-b2000001/index.html",
    sourceProvenanceCopy: "Clean curves, measured spacing, and warm clinical color suggest dental care without presenting concept art as patient work."
  },
  {
    profile: "finance",
    name: "Clearwater Finance Concept",
    sourceFile: "qa-v10/clearwater-finance-concept-b2000010/index.html",
    sourceProvenanceCopy: "Grid, ledger, and directional motifs evoke financial planning without presenting simulated account data or results."
  }
];

/*
 * ARC-owned, project-bound hero photos. The filename is the SHA-256 digest
 * of the optimized WebP bytes, so the public allowlist can prove integrity.
 */
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
  showcaseProvenance.assets.length !== showcases.length
) throw new Error("ARC_SHOWCASE_INVALID: ARC-owned image provenance is incomplete");
const showcaseProvenanceByProfile = new Map(showcaseProvenance.assets.map(item => [item?.profile, item]));

const replaceExactlyOnce = (html, pattern, replacement, label) => {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) throw new Error(`ARC_SHOWCASE_INVALID: expected exactly one ${label}; found ${matches.length}`);
  return html.replace(pattern, replacement);
};
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const manifest = [];
for (const showcase of showcases) {
  let html = await readFile(path.join(root, showcase.sourceFile), "utf8");
  const heroAsset = showcaseHeroAssets[showcase.profile];
  if (!heroAsset) throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} lacks an ARC-owned hero asset`);
  const heroAssetName = path.basename(heroAsset.file);
  const heroAssetSha256 = heroAssetName.replace(/\.webp$/i, "");
  const provenance = showcaseProvenanceByProfile.get(showcase.profile);
  if (
    !provenance ||
    provenance.file !== heroAssetName ||
    provenance.sha256 !== heroAssetSha256 ||
    !/^exec-[a-f0-9-]{36}$/.test(provenance.source_generation_id || "") ||
    typeof provenance.prompt_summary !== "string" ||
    provenance.prompt_summary.length < 40 ||
    provenance.prompt_summary.length > 300
  ) throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} image provenance does not match its content-addressed asset`);
  const heroAssetBytes = await readFile(path.join(root, heroAsset.file));
  if (
    !/^[a-f0-9]{64}\.webp$/.test(heroAssetName) ||
    createHash("sha256").update(heroAssetBytes).digest("hex") !== heroAssetSha256 ||
    heroAssetBytes.length < 1 ||
    heroAssetBytes.length > 1_250_000 ||
    heroAssetBytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    heroAssetBytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} hero asset failed content-addressed WebP integrity`);
  const heroAssetSrc = `../assets/${heroAssetName}`;
  const heroPhoto = `<img class="showcase-hero-photo" data-arc-showcase-photo="${showcase.profile}" data-arc-owned-asset="true" data-arc-media-provider="arc-generated" src="${heroAssetSrc}" alt="${heroAsset.alt}" width="${heroAsset.width}" height="${heroAsset.height}" loading="eager" decoding="async">`;
  if (!/arc-template-version["']\s+content=["']10\.0/i.test(html) || !/noindex[^"']*nofollow/i.test(html)) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.sourceFile} is not a private v10 source`);
  }
  if (!/fictional/i.test(html)) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.sourceFile} lacks a fictional-concept disclosure`);
  }

  html = replaceExactlyOnce(
    html,
    /(<body\b[^>]*\bdata-arc-site-mode=)["']preview["']/i,
    '$1"showcase"',
    "preview body mode"
  );
  html = replaceExactlyOnce(
    html,
    /(<meta\s+name=["']arc-site-mode["']\s+content=)["']preview["']/i,
    '$1"showcase"',
    "preview metadata mode"
  );
  html = replaceExactlyOnce(
    html,
    /<aside\b[^>]*class=["'][^"']*\barc-preview-toolbar\b[^"']*["'][^>]*>[\s\S]*?<\/aside>/i,
    "",
    "preview checkout toolbar"
  );
  html = replaceExactlyOnce(
    html,
    /<form\b[\s\S]*?<\/form>/i,
    '<div class="showcase-form-disabled" role="note">Lead collection is intentionally disabled in this fictional design concept.</div>',
    "customer lead form"
  );
  html = replaceExactlyOnce(
    html,
    new RegExp(escapeRegExp(showcase.sourceProvenanceCopy), "i"),
    "Original ARC-generated concept imagery is used to demonstrate this design direction; it is not client work.",
    "reviewed image-provenance copy"
  );
  html = html
    .replace(
      /Licensed stock imagery is selected from the [^<]+ media profile for this fictional concept\./gi,
      "Original ARC-generated concept imagery is used to demonstrate this design direction; it is not client work."
    )
    .replace(
      /without presenting stock imagery as client work\./gi,
      "without presenting generated concept imagery as client work."
    )
    .replace(
      /No\. Licensed stock imagery is used only as visual direction in this fictional QA concept\./gi,
      "No. Original ARC-generated concept imagery is used only as visual direction in this fictional QA concept."
    );
  if (/(?:stock imagery|stock photographs|local art direction reflects|concept art as patient work|simulated account data)/i.test(html) || !/Original ARC-generated concept imagery/i.test(html)) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} retained inaccurate stock-image provenance copy`);
  }
  html = replaceExactlyOnce(
    html,
    /<div\s+class=["']hero-media["']>\s*<\/div>/i,
    `<div class="hero-media">${heroPhoto}</div>`,
    "ARC-owned showcase hero photo"
  );
  html = replaceExactlyOnce(
    html,
    /document\.body\.dataset\.arcMediaProvider=document\.querySelector\("img"\)\?"customer-upload":"local-css";/,
    'document.body.dataset.arcMediaProvider=document.querySelector(\'img[data-arc-owned-asset="true"]\')?"arc-generated":document.querySelector("img")?"customer-upload":"local-css";',
    "truthful showcase document media provider"
  );
  html = replaceExactlyOnce(
    html,
    /node\.dataset\.arcMediaProvider="customer-upload";/,
    'node.dataset.arcMediaProvider=node.dataset.arcOwnedAsset==="true"?"arc-generated":"customer-upload";',
    "truthful showcase image media provider"
  );
  html = replaceExactlyOnce(
    html,
    /(<meta\s+name=["']arc-template-version["']\s+content=["']10\.0["']\s*\/?>)/i,
    `$1\n  <meta name="arc-showcase-profile" content="${showcase.profile}">`,
    "template version metadata"
  );
  html = replaceExactlyOnce(
    html,
    /(<body\b[^>]*>)/i,
    `$1\n<div class="arc-showcase-notice" role="note">Fictional ARC design concept — not a real business. Checkout and lead collection are disabled.</div>`,
    "body opening tag"
  );
  html = replaceExactlyOnce(
    html,
    /<\/head>/i,
    `  <style>
    body[data-arc-site-mode="showcase"]{--arc-showcase-notice-height:38px;padding-top:var(--arc-showcase-notice-height)}
    body[data-arc-site-mode="showcase"] .site-header{top:var(--arc-showcase-notice-height)}
    body[data-arc-site-mode="showcase"] .progress{top:var(--arc-showcase-notice-height)}
    .arc-showcase-notice{position:fixed;z-index:1000;inset:0 0 auto;display:grid;place-items:center;min-height:var(--arc-showcase-notice-height);padding:6px 20px;text-align:center;background:#111;color:#fff;font:700 12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.02em}
    .showcase-form-disabled{padding:18px;border:1px solid currentColor;border-radius:12px;font-weight:700;line-height:1.5}
    body[data-arc-site-mode="showcase"] .showcase-hero-photo{object-fit:cover}
    body[data-arc-site-mode="showcase"][data-arc-expected-media-profile="roofing"] .showcase-hero-photo{object-position:52% center}
    body[data-arc-site-mode="showcase"][data-arc-expected-media-profile="dental"] .showcase-hero-photo{object-position:50% center}
    body[data-arc-site-mode="showcase"][data-arc-expected-media-profile="finance"] .showcase-hero-photo{object-position:53% center}
    @media(max-width:600px){body[data-arc-site-mode="showcase"]{--arc-showcase-notice-height:60px}.arc-showcase-notice{padding-inline:14px;font-size:11px}}
  </style>
</head>`,
    "head closing tag"
  );

  const decodedPublic=normalizePublicSurface(html);
  const nonScriptHtml=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"");
  if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScriptHtml)||/\p{Default_Ignorable_Code_Point}/u.test(nonScriptHtml)||/<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(html)||/<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style\s*>/i.test(html))throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} contains an unreviewed encoded/executable surface`);
  assertNoPrivateCheckoutSurface(html,showcase.profile);
  if (/<form\b|\bdata-netlify\b|\bnetlify-honeypot\b|data-arc-checkout/i.test(decodedPublic)||privateCheckoutPattern.test(decodedPublic)||privateCheckoutPattern.test(decodedPublic.replace(/\s+/g,""))) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} retained a checkout or lead submission control`);
  }
  if (!/data-arc-site-mode=["']showcase["']/i.test(html) || !/noindex[^"']*nofollow/i.test(html)) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} lost its showcase privacy classification`);
  }
  const photoMatches = html.match(new RegExp(`data-arc-showcase-photo=["']${showcase.profile}["']`, "g")) || [];
  if (
    photoMatches.length !== 1 ||
    !nonScriptHtml.includes(`data-arc-owned-asset="true"`) ||
    !nonScriptHtml.includes(`data-arc-media-provider="arc-generated"`) ||
    !nonScriptHtml.includes(`src="${heroAssetSrc}"`) ||
    /<(?:picture|source|video|svg)\b/i.test(nonScriptHtml)
  ) {
    throw new Error(`ARC_SHOWCASE_INVALID: ${showcase.profile} must use exactly one ARC-owned content-addressed hero photo`);
  }

  const file = `showcases/${showcase.profile}/index.html`;
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), html);
  manifest.push({
    profile: showcase.profile,
    name: showcase.name,
    sourceFile: showcase.sourceFile,
    file,
    heroAsset: {
      file: heroAsset.file,
      sha256: heroAssetSha256,
      width: heroAsset.width,
      height: heroAsset.height,
      ownership: "arc-generated-project-bound",
      provider: "arc-generated"
    }
  });
  console.log(`Built inert public showcase alias: ${file}`);
}

await mkdir(path.join(root, "showcases"), { recursive: true });
await writeFile(path.join(root, "showcases/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built and classified ${manifest.length} ARC v10 showcase aliases.`);
