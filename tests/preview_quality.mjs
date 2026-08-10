import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// tar-fs attempts chown when tests run as root, which some CI/container filesystems reject.
if (process.getuid?.() === 0) process.getuid = () => 1000;
const { default: serverlessChromium } = await import("@sparticuz/chromium");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "test-results");
const qaFiles = [
  "northline-roofing-qa-6a776d95/index.html",
  "harborview-dental-qa-6a776c67/index.html",
  "evergreen-injury-law-qa-6a776e0e/index.html",
  "sound-stone-realty-qa-6a776e44/index.html",
  "aurora-aesthetics-qa-6a7770a4/index.html",
  "cascade-comfort-hvac-qa-6a776ecd/index.html",
  "sorella-table-qa-6a776f2a/index.html",
  "forge-strength-club-qa-6a776f52/index.html",
  "northwest-ledger-cpa-qa-6a7770f1/index.html",
  "prism-auto-detail-qa-6a77713f/index.html"
];
const qaLimit = Math.max(1, Math.min(qaFiles.length, Number(process.env.ARC_QA_LIMIT || qaFiles.length)));
const filesToTest = qaFiles.slice(0, qaLimit);
const viewports = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "iphone", width: 390, height: 844, isMobile: true }
];
const useRealImages = process.env.ARC_QA_REAL_IMAGES === "1";
const mockImage = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#2a2d33"/><path d="M0 760 410 420l270 240 260-330 660 670H0Z" fill="#414650"/></svg>`;
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded.replace(/^\/+/, "");
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) return null;
  return absolute;
}

const server = http.createServer(async (request, response) => {
  try {
    const file = safeFilePath(request.url || "/");
    if (!file || !(await stat(file)).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": contentTypes[path.extname(file)] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
await mkdir(output, { recursive: true });

const failures = [];
const useInstalledPlaywrightBrowser = process.env.ARC_QA_PLAYWRIGHT_BROWSER === "1";
const browser = await chromium.launch(useInstalledPlaywrightBrowser
  ? { headless: true }
  : {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      executablePath: await serverlessChromium.executablePath(),
      headless: true
    });

try {
  for (const file of filesToTest) {
    for (const viewport of viewports) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.isMobile,
        hasTouch: viewport.isMobile
      });
      const pageErrors = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      if (!useRealImages) {
        await page.route("**/*", route => {
          if (route.request().resourceType() === "image") {
            return route.fulfill({ status: 200, contentType: "image/svg+xml", body: mockImage });
          }
          return route.continue();
        });
      }

      try {
        await page.goto(`${baseUrl}/${file}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.addStyleTag({ content: "html{scroll-behavior:auto!important}*,*:before,*:after{animation:none!important;transition:none!important}" });
        await page.waitForFunction(() => document.images.length >= 5, null, { timeout: 5_000 });
        await page.evaluate(() => {
          for (const image of document.images) image.loading = "eager";
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        await page.waitForFunction(() => {
          const images = [...document.images];
          return images.length >= 5 && images.every(image => image.complete && image.naturalWidth > 0);
        }, null, { timeout: 8_000 });
        await page.evaluate(() => window.scrollTo(0, 0));

        const report = await page.evaluate(() => {
          const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          const luminance = value => {
            const channels = rgb(value).map(channel => {
              const normalized = channel / 255;
              return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
          };
          const contrast = (a, b) => {
            const first = luminance(a);
            const second = luminance(b);
            return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
          };

          const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).map(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              text: element.textContent.trim(),
              left: rect.left,
              right: rect.right,
              overflowWrap: style.overflowWrap,
              wordBreak: style.wordBreak
            };
          });
          const media = [...document.querySelectorAll(".hero-visual,.about-media,.gallery-grid>*")]
            .filter(visible)
            .map(element => ({ selector: element.className, height: element.getBoundingClientRect().height }));
          const controls = [...document.querySelectorAll(".btn,button,input,textarea,select")]
            .filter(visible)
            .map(element => ({ label: element.textContent.trim() || element.getAttribute("aria-label") || element.tagName, height: element.getBoundingClientRect().height }));
          const darkSections = [...document.querySelectorAll(".why,.gallery,.contact-card")]
            .filter(visible)
            .map(element => {
              const style = getComputedStyle(element);
              return { className: element.className, ratio: contrast(style.color, style.backgroundColor), background: style.backgroundColor };
            });
          const images = [...document.images].filter(visible).map(image => ({
            alt: image.alt,
            source: (image.currentSrc || image.src).split("?")[0],
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight
          }));
          const links = [...document.querySelectorAll("a[href]")].map(link => link.getAttribute("href"));
          return {
            robots: document.querySelector('meta[name="robots"]')?.content || "",
            overflow: document.documentElement.scrollWidth - innerWidth,
            unresolved: document.documentElement.innerHTML.match(/\[\[[A-Z0-9_]+\]\]/g) || [],
            headings,
            media,
            controls,
            darkSections,
            images,
            links,
            privateEmail: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(document.documentElement.innerHTML)
          };
        });

        assert.match(report.robots, /noindex/i, "noindex missing");
        assert.match(report.robots, /nofollow/i, "nofollow missing");
        assert.ok(report.overflow <= 1, `horizontal overflow is ${report.overflow}px`);
        assert.equal(report.unresolved.length, 0, "unresolved placeholders remain");
        assert.equal(report.privateEmail, false, "private requester email is visible");
        assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(" | ")}`);
        const escapedHeadings = report.headings.filter(item => item.left < -1 || item.right > viewport.width + 1);
        assert.equal(escapedHeadings.length, 0, `heading leaves the viewport: ${JSON.stringify(escapedHeadings)}`);
        assert.ok(report.headings.every(item => item.overflowWrap === "normal" && item.wordBreak === "normal"), "a heading may split inside a word");
        assert.ok(report.controls.every(item => item.height >= 43.5), "an important control is smaller than 44px");
        assert.ok(report.darkSections.every(item => item.ratio >= 4.5), "dark-section text contrast is below 4.5:1");
        assert.ok(report.images.length >= 5, "fewer than five industry images rendered");
        assert.ok(report.images.every(item => item.naturalWidth > 0 && item.naturalHeight > 0), "a rendered image is broken");
        assert.ok(report.images.every(item => item.alt.length > 0 && item.alt.length <= 160), "image alt text is empty or too long");
        assert.equal(new Set(report.images.map(item => item.source)).size, report.images.length, "an image is duplicated");
        assert.ok(report.links.every(href => !/^https?:\/\/(?:www\.)?example\.(?:com|org|net)/i.test(href)), "dummy external CTA remains");
        if (viewport.isMobile) {
          assert.ok(report.media.every(item => item.height <= 320), "a phone media block is taller than 320px");
        }
        console.log(`PASS ${file} [${viewport.name}]`);
      } catch (error) {
        const slug = file.split("/")[0];
        const debug = await page.evaluate(() => ({
          readyState: document.readyState,
          imageCount: document.images.length,
          images: [...document.images].map(image => ({ src: image.currentSrc || image.src, complete: image.complete, naturalWidth: image.naturalWidth }))
        })).catch(() => null);
        await page.screenshot({ path: path.join(output, `${slug}-${viewport.name}.png`), fullPage: true }).catch(() => {});
        const detail = debug ? ` ${JSON.stringify(debug)}` : "";
        failures.push(`${file} [${viewport.name}]: ${error.message}${detail}`);
        console.error(`FAIL ${file} [${viewport.name}]: ${error.message}${detail}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Browser audit passed: ${filesToTest.length * viewports.length}/${filesToTest.length * 2} desktop and iPhone renders.`);
