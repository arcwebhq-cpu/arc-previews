import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { chromium } from "playwright";
import { fixtures } from "../fixtures/v10_industries.mjs";
import { buildPreviewFolder, loadMasterTemplate, renderPreview } from "../scripts/arc_contract.mjs";

// tar-fs attempts chown when tests run as root, which some CI/container filesystems reject.
if (process.getuid?.() === 0) process.getuid = () => 1000;
const { default: serverlessChromium } = await import("@sparticuz/chromium");

const PAGES_ORIGIN = "https://arcwebhq-cpu.github.io";
const PAGES_REPOSITORY_PATH = "/arc-previews";
const mediaManifest = JSON.parse(await readFile(new URL("../config/media-manifest.json", import.meta.url), "utf8"));
const trustedEventPrefix = "a1b2c3d4";
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const pngSha256 = createHash("sha256").update(pngBytes).digest("hex");
const roofingFixture = fixtures.find(fixture => fixture.expectedProfile === "roofing");
assert.ok(roofingFixture, "the existing roofing v10 fixture is required");

const previewFolder = buildPreviewFolder(roofingFixture.content.BUSINESS_NAME, trustedEventPrefix);
const assetPath = `${PAGES_REPOSITORY_PATH}/${previewFolder}/assets/${pngSha256}.png`;
const assetUrl = `${PAGES_ORIGIN}${assetPath}`;
const content = {
  ...roofingFixture.content,
  HERO_MEDIA_HTML: `<img src="${assetUrl}" alt="Customer-supplied roof" width="1" height="1" loading="eager" decoding="async" referrerpolicy="no-referrer">`
};
const rendered = renderPreview(await loadMasterTemplate(), content, {
  trustedEventPrefix,
  customerEmail: roofingFixture.customerEmail,
  heroImageUrl: assetUrl
});
// On GitHub Pages the preview HTML and its customer assets are same-origin. The
// loopback document needs this one QA-only CSP source so it can exercise that
// production request shape; the browser router below still blocks every URL
// except the exact content-addressed asset.
const qaHtml = rendered.html.replace(
  "img-src 'self' data:",
  `img-src 'self' ${PAGES_ORIGIN} data:`
);

assert.equal(rendered.folder, previewFolder);
assert.equal(rendered.expectedMediaProfile, "roofing");
assert.match(rendered.html, new RegExp(assetUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.notEqual(qaHtml, rendered.html, "QA-only Pages image CSP source was not installed");

/**
 * This deliberately is not a filesystem proxy. Only the one content-addressed,
 * production-shaped URL can resolve, and its digest is rechecked against the
 * in-memory bytes. Traversal and symlink aliases therefore have no local path
 * that could be opened accidentally.
 */
function exactPublishedAssetBytes(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("ARC_CUSTOMER_ASSET_PROXY_REJECTED: malformed URL");
  }
  if (
    rawUrl !== assetUrl ||
    parsed.origin !== PAGES_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== assetPath
  ) {
    throw new Error("ARC_CUSTOMER_ASSET_PROXY_REJECTED: URL is not the exact approved asset");
  }
  const pathDigest = parsed.pathname.match(/\/assets\/([a-f0-9]{64})\.png$/)?.[1] || "";
  const bytesDigest = createHash("sha256").update(pngBytes).digest("hex");
  if (pathDigest !== bytesDigest) {
    throw new Error("ARC_CUSTOMER_ASSET_PROXY_REJECTED: content address mismatch");
  }
  return pngBytes;
}

assert.strictEqual(exactPublishedAssetBytes(assetUrl), pngBytes);
for (const attack of [
  `${assetUrl}?download=1`,
  `${assetUrl}#fragment`,
  assetUrl.replace(PAGES_ORIGIN, "https://example.test"),
  assetUrl.replace(PAGES_ORIGIN, "https://arcwebhq-cpu.github.io.example.test"),
  `${PAGES_ORIGIN}${PAGES_REPOSITORY_PATH}/${previewFolder}/assets/%2e%2e/${pngSha256}.png`,
  `${PAGES_ORIGIN}${PAGES_REPOSITORY_PATH}/${previewFolder}/assets/../${pngSha256}.png`,
  `${PAGES_ORIGIN}${PAGES_REPOSITORY_PATH}/${previewFolder}/assets/current.png`,
  `${PAGES_ORIGIN}${PAGES_REPOSITORY_PATH}/${previewFolder}/assets/symlink/${pngSha256}.png`,
  `file:///tmp/${pngSha256}.png`
]) {
  assert.throws(
    () => exactPublishedAssetBytes(attack),
    /ARC_CUSTOMER_ASSET_PROXY_REJECTED/,
    `unsafe asset proxy candidate was accepted: ${attack}`
  );
}

const unexpectedLoopbackRequests = [];
const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/customer-upload-contract/") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8"
    });
    response.end(qaHtml);
    return;
  }
  unexpectedLoopbackRequests.push(`${request.method} ${request.url}`);
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const pageUrl = `http://127.0.0.1:${address.port}/customer-upload-contract/`;
const pageOrigin = new URL(pageUrl).origin;
const useInstalledPlaywrightBrowser = process.env.ARC_QA_PLAYWRIGHT_BROWSER === "1";
const browser = await chromium.launch(useInstalledPlaywrightBrowser
  ? { headless: true }
  : {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      executablePath: await serverlessChromium.executablePath(),
      headless: true
    });

const viewports = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "phone-390", width: 390, height: 844, isMobile: true }
];

try {
  for (const assetStatus of [200, 404]) {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile
      });
      const externalEgress = [];
      const assetRequests = [];
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(error.message));

      await page.route("**/*", route => {
        const requestUrl = route.request().url();
        if (requestUrl === assetUrl) {
          assetRequests.push(requestUrl);
          const bytes = exactPublishedAssetBytes(requestUrl);
          if (assetStatus === 404) {
            return route.fulfill({ status: 404, contentType: "text/plain", body: "Missing" });
          }
          return route.fulfill({
            status: 200,
            headers: {
              "cache-control": "no-store",
              "content-length": String(bytes.length),
              "x-content-type-options": "nosniff"
            },
            contentType: "image/png",
            body: bytes
          });
        }
        if (new URL(requestUrl).origin === pageOrigin) return route.continue();
        externalEgress.push(requestUrl);
        return route.abort("blockedbyclient");
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.addStyleTag({
          content: "html{scroll-behavior:auto!important}*,*:before,*:after{animation:none!important;transition:none!important}"
        });

        if (assetStatus === 200) {
          await page.waitForFunction(expectedUrl => {
            const image = document.querySelector('.hero-media img[alt="Customer-supplied roof"]');
            return image?.complete && image.naturalWidth === 1 && image.naturalHeight === 1 && image.currentSrc === expectedUrl;
          }, assetUrl, { timeout: 8_000 });
          const report = await page.evaluate(expectedUrl => {
            const image = document.querySelector('.hero-media img[alt="Customer-supplied roof"]');
            const fallback = document.querySelector(".hero-fallback");
            const imageBox = image?.getBoundingClientRect();
            return {
              bodyProvider: document.body.dataset.arcMediaProvider,
              bodyProfile: document.body.dataset.arcMediaProfile,
              bodyExpectedProfile: document.body.dataset.arcExpectedMediaProfile,
              bodyVersion: document.body.dataset.arcMediaVersion,
              currentSrc: image?.currentSrc,
              fallbackDisplay: fallback ? getComputedStyle(fallback).display : "missing",
              hasMedia: document.querySelector(".hero-visual")?.classList.contains("has-media"),
              heroHidden: document.querySelector(".hero-media")?.hidden,
              imageProvider: image?.dataset.arcMediaProvider,
              imageProfile: image?.dataset.arcMediaProfile,
              imageVersion: image?.dataset.arcMediaVersion,
              imageAlt: image?.alt,
              naturalWidth: image?.naturalWidth || 0,
              naturalHeight: image?.naturalHeight || 0,
              imageWidth: imageBox?.width || 0,
              imageHeight: imageBox?.height || 0,
              viewportWidth: innerWidth,
              scrollWidth: document.documentElement.scrollWidth
            };
          }, assetUrl);
          assert.equal(report.currentSrc, assetUrl, `${viewport.name}: customer image URL changed`);
          assert.equal(report.bodyProvider, "customer-upload", `${viewport.name}: body provenance missing`);
          assert.equal(report.bodyProfile, "roofing", `${viewport.name}: body media profile changed`);
          assert.equal(report.bodyExpectedProfile, "roofing", `${viewport.name}: expected media profile changed`);
          assert.equal(report.bodyVersion, mediaManifest.version, `${viewport.name}: body media version changed`);
          assert.equal(report.imageProvider, "customer-upload", `${viewport.name}: image provenance missing`);
          assert.equal(report.imageProfile, "roofing", `${viewport.name}: image media profile changed`);
          assert.equal(report.imageVersion, mediaManifest.version, `${viewport.name}: image media version changed`);
          assert.equal(report.imageAlt, "Customer-supplied roof", `${viewport.name}: image alt text changed`);
          assert.equal(report.naturalWidth, 1, `${viewport.name}: decoded image width changed`);
          assert.equal(report.naturalHeight, 1, `${viewport.name}: decoded image height changed`);
          assert.equal(report.hasMedia, true, `${viewport.name}: hero did not enter media mode`);
          assert.equal(report.heroHidden, false, `${viewport.name}: loaded hero stayed hidden`);
          assert.equal(report.fallbackDisplay, "none", `${viewport.name}: fallback covered loaded media`);
          assert.ok(report.imageWidth > 0 && report.imageHeight > 0, `${viewport.name}: customer media is not visible`);
          assert.ok(report.scrollWidth <= report.viewportWidth + 1, `${viewport.name}: horizontal overflow`);
        } else {
          await page.waitForFunction(() => {
            const image = document.querySelector('.hero-media img[alt="Customer-supplied roof"]');
            const fallback = document.querySelector(".hero-fallback");
            return !image && fallback && getComputedStyle(fallback).display !== "none";
          }, null, { timeout: 8_000 });
          const report = await page.evaluate(() => ({
            bodyProvider: document.body.dataset.arcMediaProvider,
            bodyProfile: document.body.dataset.arcMediaProfile,
            bodyExpectedProfile: document.body.dataset.arcExpectedMediaProfile,
            bodyVersion: document.body.dataset.arcMediaVersion,
            fallbackDisplay: getComputedStyle(document.querySelector(".hero-fallback")).display,
            fallbackProvider: document.querySelector(".hero-fallback")?.dataset.arcMediaProvider,
            hasMedia: document.querySelector(".hero-visual")?.classList.contains("has-media"),
            heroHidden: document.querySelector(".hero-media")?.hidden,
            imageCount: document.querySelectorAll('.hero-media img[alt="Customer-supplied roof"]').length,
            viewportWidth: innerWidth,
            scrollWidth: document.documentElement.scrollWidth
          }));
          assert.equal(report.imageCount, 0, `${viewport.name}: broken customer upload remained in the DOM`);
          assert.equal(report.bodyProvider, "local-css", `${viewport.name}: page did not return to local CSS media`);
          assert.equal(report.bodyProfile, "roofing", `${viewport.name}: fallback media profile changed`);
          assert.equal(report.bodyExpectedProfile, "roofing", `${viewport.name}: fallback expected media profile changed`);
          assert.equal(report.bodyVersion, mediaManifest.version, `${viewport.name}: fallback media version changed`);
          assert.equal(report.fallbackProvider, "local-css", `${viewport.name}: fallback provenance missing`);
          assert.equal(report.hasMedia, false, `${viewport.name}: failed image left hero in media mode`);
          assert.equal(report.heroHidden, true, `${viewport.name}: empty hero media was not hidden`);
          assert.notEqual(report.fallbackDisplay, "none", `${viewport.name}: CSS fallback remained hidden`);
          assert.ok(report.scrollWidth <= report.viewportWidth + 1, `${viewport.name}: fallback caused horizontal overflow`);
        }

        assert.equal(assetRequests.length, 1, `${viewport.name}: expected exactly one approved asset request`);
        assert.deepEqual(externalEgress, [], `${viewport.name}: unexpected external egress`);
        assert.deepEqual(pageErrors, [], `${viewport.name}: browser runtime errors`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

assert.deepEqual(unexpectedLoopbackRequests, [], "browser requested an unserved loopback path");
console.log("Customer-upload browser contract passed (real bytes, 404 fallback, desktop + 390px, no egress).");
