import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixtures as launchFixtures } from "../fixtures/v10_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v10_media_coverage.mjs";
import { buildPreviewFolder, detectMediaProfile, renderPreview } from "../scripts/arc_contract.mjs";
import { inspectPremiumContent } from "../scripts/content_quality.mjs";

const template = await readFile(new URL("../ARC_MASTER_TEMPLATE.html", import.meta.url), "utf8");
const fixtures = [...launchFixtures, ...mediaCoverageFixtures];

assert.equal(fixtures.length, 19, "ARC must keep one deterministic fixture for each of the 19 semantic niches");
assert.equal(new Set(fixtures.map(item => item.expectedProfile)).size, 19, "semantic niche profiles must be unique");
assert.equal(new Set(fixtures.map(item => item.id)).size, 19, "trusted fixture event prefixes must be unique");

const folders = new Set();
const urls = new Set();
for (const fixture of fixtures) {
  const report = inspectPremiumContent(fixture.content);
  assert.deepEqual(report.errors, [], `${fixture.expectedProfile}: premium content errors`);
  assert.deepEqual(report.unsupportedClaims, [], `${fixture.expectedProfile}: unsupported marketing claim`);
  assert.equal(detectMediaProfile(fixture.content), fixture.expectedProfile, `${fixture.expectedProfile}: semantic media mismatch`);
  const rendered = renderPreview(template, fixture.content, {
    trustedEventPrefix: fixture.id,
    customerEmail: fixture.customerEmail
  });
  assert.ok(!folders.has(rendered.folder), `${fixture.expectedProfile}: duplicate preview folder`);
  assert.ok(!urls.has(rendered.previewUrl), `${fixture.expectedProfile}: duplicate preview URL`);
  folders.add(rendered.folder);
  urls.add(rendered.previewUrl);
}

assert.notEqual(
  buildPreviewFolder("Same Business", "a1000001"),
  buildPreviewFolder("Same Business", "a1000002"),
  "different trusted events must not reuse one preview path"
);
assert.equal(
  buildPreviewFolder("Same Business", "a1000001"),
  buildPreviewFolder("Same Business", "a1000001"),
  "exact retries must resolve to one deterministic preview path"
);
assert.throws(() => buildPreviewFolder("Same Business", "not-safe"), /trusted event prefix/);

const base = launchFixtures[0].content;
const unsupportedClaims = [
  { PROOF_HTML: base.PROOF_HTML.replace("No customer quote, rating, certification, or performance number appears without source material.", "Rated 4.9/5 by 600 customers.") },
  { HERO_PROOF_LINE: "24/7 service • Licensed and insured • Guaranteed results" },
  { ABOUT_STATS_HTML: "<article><h3>42%</h3><p>Improved customer conversion across completed projects.</p></article>" }
];
for (const mutation of unsupportedClaims) {
  assert.throws(
    () => renderPreview(template, { ...base, ...mutation }, { trustedEventPrefix: "deadbeef", customerEmail: "qa@example.test" }),
    /ARC_CLAIM_EVIDENCE_REQUIRED/,
    "unsupported proof must fail before a preview can be published"
  );
}

console.log("ARC premium content contract passed: 19 unique semantic niches, deterministic paths, substantial sections, and no unsupported marketing proof.");
