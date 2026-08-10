import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const robotsMeta = '<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">';
const emailAddressSource = "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}";
const retiredFiles = new Set([
  "previews/01KXJB41TM7W31VTN7FTHR7V59/index.html",
  "previews/1784229608227-8hd6gnkc/index.html"
]);
const hardeningMarker = "ARC production hardening v9.6";
const adaptiveGridMarker = "ARC adaptive mobile grid fix v9.6";
const hardeningCss = `

    /* ${hardeningMarker}: dark contrast and phone readability. */
    .why,.gallery,.contact-card{background-color:#0b0b0c!important}
    .hero-grid>*,.about-grid>*,.contact-grid>*,.section-head>*{min-width:0}
    h1,h2,h3{max-width:100%;overflow-wrap:normal!important;word-break:normal!important;hyphens:none!important}
    .btn,button,input,textarea,select{min-height:44px}
    @media(max-width:660px){
      .hero h1{font-size:clamp(34px,10.2vw,46px)!important;line-height:1.02!important;text-wrap:pretty}
      .section-head h2,.about-copy h2,.faq-copy h2{font-size:clamp(31px,9.2vw,43px)!important;line-height:1.04!important;text-wrap:pretty}
      .contact h2{font-size:clamp(32px,9.5vw,44px)!important;line-height:1.03!important;text-wrap:pretty}
      .hero-visual{min-height:0!important;height:clamp(250px,74vw,310px)!important}
      .about-media{min-height:0!important;height:clamp(240px,72vw,300px)!important}
      .gallery-grid>*,.gallery-grid>*:first-child,.gallery-grid>*:nth-child(2){height:clamp(200px,62vw,240px)!important;min-height:0!important}
      .contact-actions form input,.contact-actions form textarea,.contact-actions form select{font-size:16px!important}
      .hero-photo-caption strong{font-size:clamp(23px,7.4vw,32px)!important;line-height:1.08!important}
      .mobile-cta{max-width:calc(100% - 28px);min-height:48px;white-space:normal;text-align:center}
    }
`;
const adaptiveGridCss = `

    /* ${adaptiveGridMarker} */
    @media(max-width:1000px){
      body.arc-layout-impact .hero-grid,
      body.arc-layout-editorial .hero-grid,
      body.arc-layout-trusted .hero-grid{grid-template-columns:minmax(0,1fr)!important}
    }
`;

const retiredPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  ${robotsMeta}
  <title>Preview retired</title>
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b0b0c;color:#fff;font:16px/1.6 Arial,sans-serif}main{max-width:520px}h1{font-size:clamp(34px,9vw,56px);line-height:1;margin:0 0 18px}p{color:#b8b8bc}</style>
</head>
<body><main><h1>Preview retired.</h1><p>This temporary ARC test preview is no longer available.</p></main></body>
</html>
`;

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listHtmlFiles(absolute));
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolute);
  }
  return files;
}

function setPrivateRobots(html) {
  const robotsPattern = /<meta\s+name=["']robots["'][^>]*>/i;
  if (robotsPattern.test(html)) return html.replace(robotsPattern, robotsMeta);

  const viewportPattern = /<meta\s+name=["']viewport["'][^>]*>/i;
  if (viewportPattern.test(html)) {
    return html.replace(viewportPattern, match => `${match}\n  ${robotsMeta}`);
  }

  return html.replace(/<head\b[^>]*>/i, match => `${match}\n  ${robotsMeta}`);
}

function removePrivateEmails(html) {
  return html
    .replace(new RegExp(`mailto:${emailAddressSource}`, "gi"), "#contact")
    .replace(new RegExp(emailAddressSource, "gi"), "Use the contact form");
}

function hardenV9Page(html) {
  if (!/ARC Client Master Template v9\.5/i.test(html) && !/ARC Client Master Template v9\.6/i.test(html)) {
    return html;
  }

  let next = html.replace(/ARC Client Master Template v9\.5/gi, "ARC Client Master Template v9.6");
  let additions = "";
  if (!next.includes(hardeningMarker)) additions += hardeningCss;
  if (!next.includes(adaptiveGridMarker)) additions += adaptiveGridCss;
  if (!additions) return next;
  const styleEnd = next.indexOf("</style>");
  if (styleEnd === -1) throw new Error("v9 preview has no closing style tag");
  return `${next.slice(0, styleEnd)}${additions}${next.slice(styleEnd)}`;
}

const files = (await listHtmlFiles(root))
  .filter(file => path.basename(file) !== "ARC_MASTER_TEMPLATE.html")
  .sort();

let changed = 0;
for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const original = await readFile(file, "utf8");
  let updated = retiredFiles.has(relative) ? retiredPage : original;
  updated = setPrivateRobots(updated);
  updated = removePrivateEmails(updated);
  updated = updated.replace(/https:\/\/example\.com\/arc-qa-(?:booking|reserve)/gi, "#contact");
  updated = hardenV9Page(updated);
  updated = updated.replace(/[ \t]+$/gm, "");

  if (updated !== original) {
    await writeFile(file, updated);
    changed += 1;
  }
}

console.log(`Hardened ${changed} of ${files.length} public preview files.`);
