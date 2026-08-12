import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPagesArtifact } from "../scripts/build_pages_artifact.mjs";

const disclosure = "Fictional ARC design concept — not a real business. Checkout and lead collection are disabled.";
const customerFolder = "northstar-roofing-acde1234";
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function put(root, relative, content) {
  const absolute = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

function showcase(profile) {
  return `<!doctype html><html><head>
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="arc-template-version" content="10.0">
<meta name="arc-showcase-profile" content="${profile}">
</head><body data-arc-site-mode="showcase"><p>${disclosure}</p></body></html>`;
}

function customerPreview(folder, { proofFolder = folder, checkoutFolder = folder, checkoutPath = "test_safe" } = {}) {
  const unsigned = `<!doctype html><html><head>
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="arc-template-version" content="10.0">
</head><body data-arc-site-mode="preview">
<a data-arc-checkout href="https://buy.stripe.com/${checkoutPath}?client_reference_id=${checkoutFolder}.${"a".repeat(64)}">Own this website</a>
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
  for (const item of manifest) await put(root, item.file, showcase(item.profile));
  await put(root, `${customerFolder}/index.html`, customerPreview(customerFolder));

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
  await put(root, `${liveFolder}/index.html`, customerPreview(liveFolder, { checkoutPath: "live_unsafe" }));
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /Stripe test mode/
  );
  await rm(path.join(root, liveFolder), { recursive: true });

  const mismatchFolder = "mismatch-preview-acde9997";
  await put(root, `${mismatchFolder}/index.html`, customerPreview(mismatchFolder, { proofFolder: "another-preview-acde9996" }));
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /folder proof mismatch/
  );
  await rm(path.join(root, mismatchFolder), { recursive: true });

  const ambiguousFolder = "partial-v10-acde9995";
  await put(root, `${ambiguousFolder}/index.html`, `<!doctype html><html><head>
<meta name="robots" content="noindex,nofollow"><meta name="arc-template-version" content="10.0">
</head><body data-arc-site-mode="preview">Incomplete preview</body></html>`);
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /folder proof mismatch/
  );
  await rm(path.join(root, ambiguousFolder), { recursive: true });

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
