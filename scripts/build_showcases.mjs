import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    .arc-showcase-notice{position:relative;z-index:1000;padding:10px 20px;text-align:center;background:#111;color:#fff;font:700 12px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.02em}
    .showcase-form-disabled{padding:18px;border:1px solid currentColor;border-radius:12px;font-weight:700;line-height:1.5}
  </style>
</head>`,
    "head closing tag"
  );

  if (/<form\b|\bdata-netlify\b|\bnetlify-honeypot\b|data-arc-checkout|buy\.stripe\.com/i.test(html)) {
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
