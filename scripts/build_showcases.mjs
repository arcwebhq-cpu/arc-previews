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
    sourceFile: "qa-v10/ironwood-roofing-concept-a1000001/index.html"
  },
  {
    profile: "dental",
    name: "Cedar Dental Concept",
    sourceFile: "qa-v10/cedar-dental-concept-b2000001/index.html"
  },
  {
    profile: "finance",
    name: "Clearwater Finance Concept",
    sourceFile: "qa-v10/clearwater-finance-concept-b2000010/index.html"
  }
];

const replaceExactlyOnce = (html, pattern, replacement, label) => {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) throw new Error(`ARC_SHOWCASE_INVALID: expected exactly one ${label}; found ${matches.length}`);
  return html.replace(pattern, replacement);
};

const manifest = [];
for (const showcase of showcases) {
  let html = await readFile(path.join(root, showcase.sourceFile), "utf8");
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

  const file = `showcases/${showcase.profile}/index.html`;
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), html);
  manifest.push({ ...showcase, file });
  console.log(`Built inert public showcase alias: ${file}`);
}

await mkdir(path.join(root, "showcases"), { recursive: true });
await writeFile(path.join(root, "showcases/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built and classified ${manifest.length} ARC v10 showcase aliases.`);
