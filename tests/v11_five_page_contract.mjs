import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fixtures as launchFixtures } from "../fixtures/v11_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v11_media_coverage.mjs";
import { buildV11Fixtures } from "../scripts/build_v11_fixtures.mjs";
import {
  V11_APPROVAL_MANIFEST_VERSION,
  V11_PAGES,
  V11_SITE_CONTRACT_VERSION,
  V11_TEMPLATE_VERSION,
  canonicalJson,
  createV11ApprovalManifest,
  digestV11ApprovalManifest,
  renderV11Site
} from "../scripts/v11_site_contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE_V11.html"), "utf8");
const fixtures = [...launchFixtures, ...mediaCoverageFixtures];
const expectedPageKeys = ["home", "services", "about", "process", "contact"];
const expectedPagePaths = ["index.html", "services/index.html", "about/index.html", "process/index.html", "contact/index.html"];
const h1ByPage = new Map(expectedPageKeys.map(key => [key, new Set()]));

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(new RegExp(`\\b${escaped}="([^"]*)"`, "i"))?.[1] ?? "";
}

function oneMeta(html, name) {
  const tags = (html.match(/<meta\b[^>]*>/gi) || []).filter(tag => attribute(tag, "name") === name);
  assert.equal(tags.length, 1, `expected one ${name} meta tag`);
  return attribute(tags[0], "content");
}

function plain(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&(?:amp|lt|gt|quot|apos);/g, " ").replace(/\s+/g, " ").trim();
}

function mainNavigation(html) {
  const block = html.match(/<nav class="nav-links"[\s\S]*?<\/nav>/i)?.[0] || "";
  assert.ok(block, "main navigation is missing");
  return block.match(/<a\b[^>]*>[^<]+<\/a>/gi) || [];
}

function expectedResolvedPath(folder, targetKey) {
  return targetKey === "home" ? `/${folder}/` : `/${folder}/${targetKey}/`;
}

assert.equal(fixtures.length, 19, "v11 must cover all 19 semantic niches");
assert.equal(new Set(fixtures.map(fixture => fixture.expectedProfile)).size, 19, "v11 niche profiles must remain unique");
assert.deepEqual(V11_PAGES.map(page => page.key), expectedPageKeys);
assert.deepEqual(V11_PAGES.map(page => page.path), expectedPagePaths);

for (const fixture of fixtures) {
  assert.equal(fixture.contractVersion, V11_SITE_CONTRACT_VERSION);
  assert.equal(fixture.expectedPageCount, 5);
  const options = { trustedEventPrefix: fixture.id, customerEmail: fixture.customerEmail };
  const rendered = renderV11Site(template, fixture.content, options);
  const repeated = renderV11Site(template, fixture.content, options);

  assert.equal(rendered.contractVersion, V11_SITE_CONTRACT_VERSION);
  assert.equal(rendered.templateVersion, V11_TEMPLATE_VERSION);
  assert.equal(rendered.expectedMediaProfile, fixture.expectedProfile);
  assert.equal(rendered.pageCount, 5);
  assert.deepEqual(rendered.pages.map(page => page.key), expectedPageKeys);
  assert.deepEqual(rendered.pages.map(page => page.path), expectedPagePaths);
  assert.deepEqual(rendered.pages.map(page => page.filePath), expectedPagePaths.map(pagePath => `${rendered.folder}/${pagePath}`));
  assert.equal(rendered.approvalManifest.version, V11_APPROVAL_MANIFEST_VERSION);
  assert.equal(rendered.approvalManifestJson, canonicalJson(rendered.approvalManifest));
  assert.equal(rendered.approvalBundleSha256, digestV11ApprovalManifest(rendered.approvalManifest));
  assert.deepEqual(rendered.approvalManifest.pages.map(page => page.sha256), rendered.pages.map(page => page.approvalSha256),
    "manifest entries must hash the exact approval bytes, including canonical final newlines");
  assert.equal(rendered.approvalBundleSha256, repeated.approvalBundleSha256, "exact retries must retain one bundle digest");
  assert.deepEqual(rendered.pages.map(page => page.publishedSha256), repeated.pages.map(page => page.publishedSha256));

  const titles = new Set();
  const descriptions = new Set();
  const headings = new Set();
  let formCount = 0;
  for (const page of rendered.pages) {
    const html = page.html;
    assert.equal(oneMeta(html, "arc-template-version"), V11_TEMPLATE_VERSION, `${page.path}: template version`);
    assert.equal(oneMeta(html, "arc-site-contract"), V11_SITE_CONTRACT_VERSION, `${page.path}: site contract`);
    assert.equal(oneMeta(html, "arc-page-key"), page.key, `${page.path}: page key`);
    assert.equal(oneMeta(html, "arc-page-path"), page.path, `${page.path}: page path`);
    assert.match(oneMeta(html, "robots"), /(?:^|,)noindex(?:,|$)/, `${page.path}: noindex`);
    assert.match(oneMeta(html, "robots"), /(?:^|,)nofollow(?:,|$)/, `${page.path}: nofollow`);
    assert.match(html, /connect-src 'none'/, `${page.path}: no-egress CSP`);
    assert.doesNotMatch(html, /buy\.stripe\.com|client_reference_id|\bplink_[A-Za-z0-9]+|v3_[A-Za-z0-9_-]{135}/i, `${page.path}: private checkout escaped`);
    assert.equal((html.match(/<aside class="arc-preview-toolbar"/g) || []).length, 1, `${page.path}: inert preview status`);
    assert.doesNotMatch(html, new RegExp(fixture.customerEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${page.path}: private fixture email`);

    const title = oneMeta(html, "arc-page-title");
    const description = oneMeta(html, "description");
    const h1Blocks = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
    assert.equal(h1Blocks.length, 1, `${page.path}: exactly one h1`);
    const h1 = plain(h1Blocks[0]);
    assert.ok(h1, `${page.path}: h1 cannot be empty`);
    titles.add(title);
    descriptions.add(description);
    headings.add(h1);
    h1ByPage.get(page.key).add(h1.toLowerCase());

    const links = mainNavigation(html);
    assert.equal(links.length, 5, `${page.path}: exact five-link navigation`);
    assert.equal(links.filter(link => attribute(link, "aria-current") === "page").length, 1, `${page.path}: one active navigation item`);
    const pageUrl = `https://preview.test/${rendered.folder}/${page.path}`;
    links.forEach((link, index) => {
      const target = V11_PAGES[index];
      assert.equal(plain(link), target.label, `${page.path}: navigation label order`);
      assert.equal(new URL(attribute(link, "href"), pageUrl).pathname, expectedResolvedPath(rendered.folder, target.key), `${page.path}: ${target.key} route`);
      assert.equal(attribute(link, "aria-current"), target.key === page.key ? "page" : "", `${page.path}: active ${target.key} route`);
    });

    const forms = html.match(/<form\b[^>]*>/gi) || [];
    formCount += forms.length;
    if (page.key === "contact") {
      assert.equal(forms.length, 1, "contact page must contain the fixture lead form");
      assert.equal(attribute(forms[0], "action"), "./?submitted=1", "contact action must be relative to the contact route");
      assert.equal(attribute(forms[0], "method"), "POST", "contact form method");
      assert.equal(attribute(forms[0], "data-netlify"), "true", "contact form Netlify marker");
    } else {
      assert.equal(forms.length, 0, `${page.path}: form must remain contact-only`);
    }
  }
  assert.equal(formCount, 1, "exactly one form must exist across a fixture site");
  assert.equal(titles.size, 5, "every page needs a unique title");
  assert.equal(descriptions.size, 5, "every page needs a unique description");
  assert.equal(headings.size, 5, "every page needs a distinct h1 role");

  const rebuiltManifest = createV11ApprovalManifest(rendered.pages);
  assert.deepEqual(rebuiltManifest, rendered.approvalManifest, "bundle manifest must derive only from exact page bytes");
  const mutatedPages = rendered.pages.map(page => page.key === "services"
    ? { ...page, approvalHtml: page.approvalHtml.replace("</body>", "<p>tampered</p></body>") }
    : page);
  assert.notEqual(
    digestV11ApprovalManifest(createV11ApprovalManifest(mutatedPages)),
    rendered.approvalBundleSha256,
    "tampering with a secondary page must change the site approval digest"
  );
  assert.throws(
    () => createV11ApprovalManifest([...rendered.pages].reverse()),
    /approval manifest page set/,
    "page-order ambiguity must fail closed"
  );
}

for (const [pageKey, values] of h1ByPage) {
  assert.equal(values.size, 19, `${pageKey}: all 19 niches need distinct page headlines`);
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "arc-v11-fixtures-"));
try {
  const output = path.join(temporaryRoot, "rendered");
  const built = await buildV11Fixtures({ root, output });
  assert.equal(built.siteCount, 19, "fixture builder site count");
  assert.equal(built.pageCount, 95, "fixture builder page count");
  assert.equal(built.manifest.length, 19, "fixture manifest site count");
  const diskManifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
  assert.deepEqual(diskManifest, built.manifest, "disk and returned fixture manifests must match");
  for (const site of diskManifest) {
    assert.equal(site.pageCount, 5);
    assert.deepEqual(site.pages.map(page => page.path), expectedPagePaths);
    for (const page of site.pages) {
      const absolute = path.join(output, ...page.file.split("/"));
      assert.equal((await stat(absolute)).isFile(), true, `${page.file}: generated fixture file`);
      const html = await readFile(absolute, "utf8");
      assert.equal(oneMeta(html, "arc-page-key"), page.key, `${page.file}: generated page key`);
    }
    const rootEntries = (await readdir(path.join(output, site.folder))).sort();
    assert.deepEqual(rootEntries, ["about", "contact", "index.html", "process", "services"], `${site.folder}: exact generated subtree`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("ARC v11 five-page contract passed: 19 niches, 95 documents, exact navigation, unique metadata, contact-only forms, and whole-site approval digests.");
