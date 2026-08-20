import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPagesArtifact } from "../scripts/build_pages_artifact.mjs";

const disclosure = "Fictional ARC design concept — not a real business. Checkout and lead collection are disabled.";
const customerFolder = "northstar-roofing-acde1234";
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template=await readFile(path.join(projectRoot,"ARC_MASTER_TEMPLATE.html"),"utf8");
const trustedScripts=(template.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[]).join("\n");

async function put(root, relative, content) {
  const absolute = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

function customerPreview(folder, { proofFolder = folder, injectedCheckout = "", assetUrl = "" } = {}) {
  const unsigned = `<!doctype html><html><head>
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="arc-template-version" content="10.0">
</head><body data-arc-site-mode="preview">${trustedScripts}${assetUrl ? `<img src="${assetUrl}" alt="Customer asset">` : ""}${injectedCheckout}
<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview</strong>Built for this business. Purchase only if approved.</span><span data-arc-checkout-private>Checkout is available only through the private approval email.</span></aside>
</body></html>`;
  const proof = `<!-- ARC_PREVIEW_PROOF_START -->\n<meta name="arc-preview-folder" content="${proofFolder}">\n<meta name="arc-preview-source-sha256" content="${sha256(unsigned)}">\n<!-- ARC_PREVIEW_PROOF_END -->\n`;
  return unsigned.replace("</head>", `${proof}</head>`);
}

async function listFiles(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, absolute));
    if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return result.sort();
}

const root = await mkdtemp(path.join(os.tmpdir(), "arc-pages-contract-"));
try {
  const manifest = [
    { profile: "roofing", file: "showcases/roofing/index.html" },
    { profile: "dental", file: "showcases/dental/index.html" },
    { profile: "finance", file: "showcases/finance/index.html" }
  ];
  await put(root, "showcases/manifest.json", `${JSON.stringify(manifest)}\n`);
  for (const item of manifest) await put(root,item.file,await readFile(path.join(projectRoot,item.file),"utf8"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const assetSha = createHash("sha256").update(png).digest("hex");
  const assetRelative = `${customerFolder}/assets/${assetSha}.png`;
  const assetUrl = `https://arcwebhq-cpu.github.io/arc-previews/${assetRelative}`;
  await put(root, `${customerFolder}/index.html`, customerPreview(customerFolder, { assetUrl }));
  await mkdir(path.dirname(path.join(root, assetRelative)), { recursive: true });
  await writeFile(path.join(root, assetRelative), png);

  // These deliberately contain publishable-looking or sensitive content, but
  // none belongs to one of the two allowed public classes.
  await put(root, "qa-v10/fixture/index.html", customerPreview("fixture-deadbeef"));
  await put(root, "legacy-client-deadbeef/index.html", "<html><meta name=\"robots\" content=\"noindex,nofollow\"><body>v9 history</body></html>");
  await put(root, "deliveries/northstar-roofing-acde1234/index.html", "PRIVATE DELIVERY");
  await put(root, "previews/private/index.html", "PRIVATE PREVIEW");
  await put(root, "zapier/private-token.txt", "PRIVATE SOURCE");
  await put(root, "ARC_MASTER_TEMPLATE.html", "PRIVATE TEMPLATE");
  await put(root, "package.json", "{\"private\":true}\n");

  const output = path.join(root, ".pages-dist");
  const result = await buildPagesArtifact({ root, output });
  const expectedArtifactFiles = [
    ".nojekyll",
    "index.html",
    assetRelative,
    `${customerFolder}/index.html`,
    "showcases/dental/index.html",
    "showcases/finance/index.html",
    "showcases/roofing/index.html"
  ];
  assert.deepEqual(result.customerPreviews, [customerFolder]);
  assert.deepEqual(result.showcases, ["dental", "finance", "roofing"]);
  assert.deepEqual(await listFiles(output), expectedArtifactFiles);
  const pagesIndex = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(pagesIndex, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(pagesIndex, /fictional quality-assurance concepts, not real businesses/i);
  assert.doesNotMatch(pagesIndex, /<form\b|data-netlify|data-arc-checkout|buy\.stripe\.com/i);
  assert.deepEqual([...pagesIndex.matchAll(/href="([^"]+)"/g)].map(match => match[1]).sort(), [
    "./showcases/dental/",
    "./showcases/finance/",
    "./showcases/roofing/"
  ]);
  assert.equal((await readFile(path.join(output, customerFolder, "index.html"), "utf8")).includes("PRIVATE"), false);
  assert.deepEqual(await readFile(path.join(output, assetRelative)), png);
  await assert.rejects(
    buildPagesArtifact({ root, output: path.join(root, "unsafe-output") }),
    /unsafe source or output directory/
  );

  const invalidFolder = "tampered-preview-acde9999";
  const tampered = customerPreview(invalidFolder).replace(/arc-preview-source-sha256" content="[a-f0-9]{64}/, `arc-preview-source-sha256" content="${"0".repeat(64)}`);
  await put(root, `${invalidFolder}/index.html`, tampered);
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /source proof hash mismatch/
  );
  assert.deepEqual(await listFiles(output), expectedArtifactFiles, "failed validation replaced the last complete artifact");
  await rm(path.join(root, invalidFolder), { recursive: true });

  const liveFolder = "live-checkout-acde9998";
  await put(root, `${liveFolder}/index.html`, customerPreview(liveFolder, { injectedCheckout:'<a href="https://buy。stripe。com/live_unsafe">Buy</a>' }));
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /private checkout capability/
  );
  await rm(path.join(root, liveFolder), { recursive: true });

  for (const [suffix, injectedCheckout] of [
    ["tab", '<a href="https://buy&Tab;.stripe.com/test_x">Buy</a>'],
    ["newline", '<a href="https://buy&NewLine;.stripe.com/test_x">Buy</a>'],
    ["mixed-percent", '<a href="https://buy%2estripe.com/test%ZZ">Buy</a>'],
    ["formaction", '<button formaction="https://buy%2estripe.com/test_x">Buy</button>'],
    ["soft-hyphen", '<a href="https://bu\u00ady.stripe.com/test_x">Buy</a>'],
    ["soft-hyphen-entity", '<a href="https://bu&shy;y.stripe.com/test_x">Buy</a>'],
    ["named-id", '<span data-note="client&lowbar;reference&lowbar;id">private</span>'],
    ["javascript-tab", '<a href="java\tscript:location=\'https://buy.stripe.com/test_x\'">Buy</a>'],
    ["solidus-handler", '<svg/onload="location=\'https://bu\'+\'y.stripe.com/test_x\'"></svg>'],
    ["style-escape", '<div style="background:u&#92;rl(\'https://buy&#92;.stripe&#92;.com/test_x\')"></div>'],
    ["extra-script", '<script>location=\'https://bu\'+\'y.stripe.com/test_x\'</script >']
  ]) {
    const folder = `encoded-${suffix}-abcde${String(100 + suffix.length).slice(-3)}`;
    await put(root, `${folder}/index.html`, customerPreview(folder, { injectedCheckout }));
    await assert.rejects(buildPagesArtifact({ root, output }), /private checkout capability|unreviewed executable|reviewed script manifest/, `must reject ${suffix}`);
    await rm(path.join(root, folder), { recursive: true });
  }

  const mismatchFolder = "mismatch-preview-acde9997";
  await put(root, `${mismatchFolder}/index.html`, customerPreview(mismatchFolder, { proofFolder: "another-preview-acde9996" }));
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /folder proof mismatch|reviewed script manifest changed/
  );
  await rm(path.join(root, mismatchFolder), { recursive: true });

  const ambiguousFolder = "partial-v10-acde9995";
  await put(root, `${ambiguousFolder}/index.html`, `<!doctype html><html><head>
<meta name="robots" content="noindex,nofollow"><meta name="arc-template-version" content="10.0">
</head><body data-arc-site-mode="preview">Incomplete preview</body></html>`);
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /folder proof mismatch|reviewed script manifest changed/
  );
  await rm(path.join(root, ambiguousFolder), { recursive: true });

  const originalAsset = await readFile(path.join(root, assetRelative));
  const tamperedAsset = Buffer.from(originalAsset); tamperedAsset[20] ^= 1;
  await writeFile(path.join(root, assetRelative), tamperedAsset);
  await assert.rejects(buildPagesArtifact({ root, output }), /asset size or digest mismatch/);
  await writeFile(path.join(root, assetRelative), originalAsset);
  const unused = `${customerFolder}/assets/${"f".repeat(64)}.png`;
  await writeFile(path.join(root, unused), png);
  await assert.rejects(buildPagesArtifact({ root, output }), /extra, missing, or non-regular/);
  await rm(path.join(root, unused));
  await rm(path.join(root, assetRelative));
  await symlink(path.join(root, "showcases/roofing/index.html"), path.join(root, assetRelative));
  await assert.rejects(buildPagesArtifact({ root, output }), /extra, missing, or non-regular|may not use symlinks/);
  await rm(path.join(root, assetRelative));
  await writeFile(path.join(root, assetRelative), originalAsset);

  const unsafeShowcase = manifest[0].file;
  const safeShowcase = await readFile(path.join(root, ...unsafeShowcase.split("/")), "utf8");
  await put(root, unsafeShowcase, safeShowcase.replace("</body>", '<form data-netlify="true"></form></body>'));
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /active form or checkout/
  );
  await put(root, unsafeShowcase, safeShowcase);

  await put(root, "showcases/manifest.json", `${JSON.stringify([...manifest, { profile: "extra", file: "showcases/extra/index.html" }])}\n`);
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /exactly three entries/
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

const workflow = await readFile(path.join(projectRoot, ".github/workflows/preview-quality.yml"), "utf8");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
assert.equal(
  packageJson.scripts["build:pages"],
  "npm run build:showcases && node scripts/build_pages_artifact.mjs",
  "Pages must regenerate v10-derived showcases in its own fresh runner before allowlisting them"
);
assert.match(workflow, /deploy-pages:[\s\S]*if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'[\s\S]*needs: preview-quality/);
assert.match(workflow, /run: npm run build:pages/);
assert.match(workflow, /uses: actions\/upload-pages-artifact@v3[\s\S]*path: \.pages-dist/);
assert.match(workflow, /uses: actions\/deploy-pages@v4/);
assert.doesNotMatch(workflow, /uses: actions\/upload-pages-artifact@v3[\s\S]{0,120}path:\s*["']?\.["']?\s*$/m);

console.log("PASS Pages publish allowlist: only three inert showcases and proof-bound root v10 previews are deployable.");
console.log("PASS Pages workflow contract: deployment waits for quality and uploads only .pages-dist.");
