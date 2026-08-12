import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// tar-fs attempts chown when tests run as root, which some CI/container filesystems reject.
if (process.getuid?.() === 0) process.getuid = () => 1000;
const { default: serverlessChromium } = await import("@sparticuz/chromium");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "test-results");
const legacyQaFiles = [
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
const v10Manifest = JSON.parse(await readFile(path.join(root, "qa-v10/manifest.json"), "utf8"));
const showcaseManifest = JSON.parse(await readFile(path.join(root, "showcases/manifest.json"), "utf8"));
const mediaManifest = JSON.parse(await readFile(path.join(root, "config/media-manifest.json"), "utf8"));
const v10ByFile = new Map(v10Manifest.map(item => [item.file, item]));
const showcaseByFile = new Map(showcaseManifest.map(item => [item.file, item]));
const launchV10Manifest = v10Manifest.filter(item => item.isLaunch);

async function discoverV10Files(directory, ignoredDirectories = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if ([".git", ".pages-dist", "node_modules", "test-results", ...ignoredDirectories].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await discoverV10Files(absolute, ignoredDirectories));
    } else if (entry.isFile() && entry.name === "index.html") {
      const html = await readFile(absolute, "utf8");
      if (/<meta\s+name=["']arc-template-version["']\s+content=["']10\.0["']/i.test(html)) {
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }
  return files;
}

const discoveredV10Files = (await discoverV10Files(root, ["deliveries", "showcases"])).sort();
const discoveredV10DeliveryFiles = (await discoverV10Files(path.join(root, "deliveries"))).sort();
const showcaseFiles = showcaseManifest.map(item => item.file);
for (const fixture of v10Manifest) {
  assert.ok(discoveredV10Files.includes(fixture.file), `v10 fixture is missing from browser discovery: ${fixture.file}`);
}
const qaFiles = process.env.ARC_QA_V10_ONLY === "1"
  ? [...discoveredV10Files, ...discoveredV10DeliveryFiles]
  : [...legacyQaFiles, ...discoveredV10Files, ...showcaseFiles, ...discoveredV10DeliveryFiles];
const qaLimit = Math.max(1, Math.min(qaFiles.length, Number(process.env.ARC_QA_LIMIT || qaFiles.length)));
const filesToTest = qaFiles.slice(0, qaLimit);
const viewports = [
  { name: "desktop", width: 1440, height: 900, isMobile: false, isPhone: false },
  { name: "tablet", width: 768, height: 1024, isMobile: true, isPhone: false },
  { name: "small-phone", width: 320, height: 740, isMobile: true, isPhone: true },
  { name: "iphone", width: 390, height: 844, isMobile: true, isPhone: true }
].filter(item => process.env.ARC_QA_DESKTOP_ONLY !== "1" || !item.isMobile);
const useRealImages = process.env.ARC_QA_REAL_IMAGES === "1";
const saveScreenshots = process.env.ARC_QA_SAVE_SCREENSHOTS === "1";
const compositionOrders = {
  impact: ["top", "ticker", "services", "why", "process", "gallery", "about", "proof", "faq", "contact"],
  trusted: ["top", "ticker", "proof", "services", "process", "about", "why", "faq", "gallery", "contact"],
  editorial: ["top", "ticker", "about", "gallery", "services", "why", "process", "proof", "faq", "contact"],
  balanced: ["top", "ticker", "services", "about", "why", "process", "proof", "gallery", "faq", "contact"]
};
const seenV10Compositions = new Set();
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
        });
        const revealCount = await page.evaluate(() => {
          let visibleIndex = 0;
          for (const element of document.querySelectorAll(".reveal")) {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden") {
              element.dataset.arcQaReveal = String(visibleIndex);
              visibleIndex += 1;
            }
          }
          return visibleIndex;
        });
        for (let index = 0; index < revealCount; index += 1) {
          await page.evaluate(position => {
            document.querySelector(`[data-arc-qa-reveal="${position}"]`)?.scrollIntoView({ block: "center" });
          }, index);
          const revealIsVisible = position => {
            const element = document.querySelector(`[data-arc-qa-reveal="${position}"]`);
            return !element
              || element.classList.contains("is-visible")
              || matchMedia("(prefers-reduced-motion: reduce)").matches;
          };
          try {
            await page.waitForFunction(revealIsVisible, index, { timeout: 5_000 });
          } catch (error) {
            // A real scroll away and back retriggers IntersectionObserver in slow CI
            // without bypassing the same visibility condition.
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForTimeout(50);
            await page.evaluate(position => {
              document.querySelector(`[data-arc-qa-reveal="${position}"]`)?.scrollIntoView({ block: "center" });
            }, index);
            await page.waitForFunction(revealIsVisible, index, { timeout: 5_000 });
          }
        }
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
          const mobileGridItems = [...document.querySelectorAll(".service-grid>*,.why-grid>*,.process-list>*,.proof-grid>*,.about-grid>*")]
            .filter(visible)
            .map(element => ({ className: element.className, width: element.getBoundingClientRect().width }));
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
            arcTemplateVersion: document.querySelector('meta[name="arc-template-version"]')?.content || "",
            arcShowcaseProfile: document.querySelector('meta[name="arc-showcase-profile"]')?.content || "",
            arcSiteMode: document.body.dataset.arcSiteMode || "",
            arcMediaProfile: document.body.dataset.arcMediaProfile || "",
            arcMediaProvider: document.body.dataset.arcMediaProvider || "",
            arcMediaVersion: document.body.dataset.arcMediaVersion || "",
            arcExpectedMediaProfile: document.body.dataset.arcExpectedMediaProfile || "",
            arcLayout: document.body.dataset.arcLayout || "",
            arcVariant: document.body.dataset.arcVariant || "",
            mainOrder: [...(document.querySelector("#content")?.children || [])].map(element => element.id || (element.classList.contains("ticker") ? "ticker" : "")),
            hiddenReveals: [...document.querySelectorAll(".reveal")].filter(element => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) < 0.9;
            }).map(element => element.className),
            overflow: document.documentElement.scrollWidth - innerWidth,
            unresolved: document.documentElement.innerHTML.match(/\[\[[A-Z0-9_]+\]\]/g) || [],
            headings,
            media,
            controls,
            mobileGridItems,
            darkSections,
            images,
            links,
            formCount: document.querySelectorAll("form").length,
            showcaseDisclosure: document.body.innerText.includes("Fictional ARC design concept — not a real business. Checkout and lead collection are disabled."),
            showcaseChrome: document.body.dataset.arcSiteMode === "showcase" ? (() => {
              const notice = document.querySelector(".arc-showcase-notice")?.getBoundingClientRect();
              const header = document.querySelector(".site-header")?.getBoundingClientRect();
              return notice && header ? { noticeBottom: notice.bottom, headerTop: header.top } : null;
            })() : null,
            curatedImages: [...document.images].filter(visible).map(image => ({
              profile: image.dataset.arcMediaProfile || "",
              provider: image.dataset.arcMediaProvider || "",
              version: image.dataset.arcMediaVersion || "",
              source: (image.currentSrc || image.src).split("?")[0]
            })),
            privateEmail: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(document.documentElement.innerHTML)
          };
        });

        const isDelivery = file.startsWith("deliveries/");
        const showcase = showcaseByFile.get(file);
        if (isDelivery) {
          assert.match(report.robots, /(?:^|,)\s*index\s*,\s*follow(?:,|$)/i, "production index/follow metadata missing");
          assert.doesNotMatch(report.robots, /noindex/i, "production delivery remained noindex");
        } else {
          assert.match(report.robots, /noindex/i, "noindex missing");
          assert.match(report.robots, /nofollow/i, "nofollow missing");
        }
        assert.ok(report.overflow <= 1, `horizontal overflow is ${report.overflow}px`);
        assert.equal(report.unresolved.length, 0, "unresolved placeholders remain");
        assert.equal(report.privateEmail, false, "private requester email is visible");
        assert.equal(report.hiddenReveals.length, 0, `scroll-reveal content remained hidden: ${JSON.stringify(report.hiddenReveals)}`);
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
        if (viewport.isPhone) {
          assert.ok(report.media.every(item => item.height <= 320), "a phone media block is taller than 320px");
        }
        if (viewport.isMobile) {
          assert.ok(report.mobileGridItems.every(item => item.width >= 250), `a phone content card collapsed below 250px: ${JSON.stringify(report.mobileGridItems.filter(item => item.width < 250))}`);
        }
        const v10Fixture = v10ByFile.get(file);
        if (report.arcTemplateVersion === "10.0") {
          const expectedProfile = v10Fixture?.expectedProfile || showcase?.profile || report.arcExpectedMediaProfile;
          const profile = mediaManifest.profiles.find(item => item.key === expectedProfile);
          assert.ok(profile, `media manifest profile ${expectedProfile} is missing`);
          assert.equal(report.arcSiteMode, isDelivery ? "production" : showcase ? "showcase" : "preview", "v10 site mode does not match its audit class");
          assert.equal(report.arcMediaProfile, expectedProfile, "semantic media profile mismatch");
          assert.equal(report.arcExpectedMediaProfile, expectedProfile, "server-selected media profile mismatch");
          assert.equal(report.arcMediaProvider, profile.provider, "media provider mismatch");
          assert.equal(report.arcMediaVersion, mediaManifest.version, "media manifest version mismatch");
          assert.equal(report.arcLayout, profile.layout, "industry composition layout mismatch");
          assert.equal(report.arcVariant, String(profile.variant), "industry composition variant mismatch");
          assert.deepEqual(report.mainOrder, compositionOrders[profile.layout], "industry section order mismatch");
          if (v10Fixture?.isLaunch) seenV10Compositions.add(`${report.arcLayout}:${report.arcVariant}`);
          assert.ok(report.curatedImages.every(item => item.profile === expectedProfile), "an image escaped the selected media profile");
          assert.ok(report.curatedImages.every(item => item.provider === profile.provider), "an image has the wrong provider tag");
          assert.ok(report.curatedImages.every(item => item.version === mediaManifest.version), "an image has a stale manifest tag");
          const allowed = profile.provider === "pexels"
            ? new Set(profile.photo_ids.map(id => `/photos/${id}/pexels-photo-${id}.jpeg`))
            : profile.provider === "unsplash"
              ? new Set(profile.photo_ids.map(id => `/${id}`))
              : new Set(profile.urls.map(value => new URL(value).pathname));
          assert.ok(report.curatedImages.every(item => allowed.has(new URL(item.source).pathname)), "an image URL is outside the selected profile pool");
          const checkout = report.links.find(href => href?.includes("buy.stripe.com"));
          if (v10Fixture) {
            assert.ok(checkout, "bound Stripe checkout link is missing");
            const checkoutReference = new URL(checkout).searchParams.get("client_reference_id") || "";
            assert.match(checkoutReference, new RegExp(`^${v10Fixture.folder.slice(-8)}_[a-f0-9]{64}_[a-f0-9]{64}$`), "checkout immutable approval binding mismatch");
            assert.equal(checkoutReference.length, 138, "checkout binding must use the fixed Stripe-safe v2 length");
          } else {
            assert.equal(checkout, undefined, "a non-preview page exposed a Stripe checkout link");
          }
          if (showcase) {
            assert.equal(report.arcShowcaseProfile, showcase.profile, "showcase profile metadata mismatch");
            assert.equal(report.formCount, 0, "showcase retained a customer lead submission form");
            assert.equal(report.showcaseDisclosure, true, "visible fictional-concept disclosure missing");
            assert.ok(report.showcaseChrome, "showcase notice or site header is missing");
            assert.ok(report.showcaseChrome.headerTop >= report.showcaseChrome.noticeBottom - 1, `showcase notice overlaps the site header: ${JSON.stringify(report.showcaseChrome)}`);
          }
        }
        if (saveScreenshots) {
          const slug = file.replace(/\/index\.html$/i, "").replace(/[^a-z0-9_-]+/gi, "-");
          await page.screenshot({ path: path.join(output, `${slug}-${viewport.name}.png`), fullPage: true });
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

if (launchV10Manifest.every(item => filesToTest.includes(item.file))) {
  assert.equal(seenV10Compositions.size, 5, "the five launch niches must retain five distinct layout/variant compositions");
}

console.log(`Browser audit passed: ${filesToTest.length * viewports.length}/${filesToTest.length * viewports.length} requested renders.`);
