import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixtures as launchFixtures } from "../fixtures/v10_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v10_media_coverage.mjs";
import { buildPreviewFolder, detectMediaProfile, renderPreview } from "../scripts/arc_contract.mjs";
import { inspectPremiumContent } from "../scripts/content_quality.mjs";

const template = await readFile(new URL("../ARC_MASTER_TEMPLATE.html", import.meta.url), "utf8");
const fixtures = [...launchFixtures, ...mediaCoverageFixtures];
const normalize = value => String(value || "")
  .replace(/<[^>]+>/g, " ")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

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
  assert.ok(
    template.includes("body[data-arc-expected-media-profile=\"" + fixture.expectedProfile + "\"]"),
    fixture.expectedProfile + ": semantic local art direction is missing"
  );
}

for (const key of ["HEADLINE", "SERVICES_HEADING", "PROCESS_HEADING", "ABOUT_QUOTE", "CONTACT_HEADING"]) {
  const values = fixtures.map(fixture => normalize(fixture.content[key]));
  assert.equal(new Set(values).size, fixtures.length, key + " must be differentiated across all 19 niches");
}
for (const key of ["SERVICES_HTML", "DIFFERENTIATORS_HTML", "PROCESS_HTML", "PROOF_HTML", "FAQ_HTML"]) {
  const values = fixtures.map(fixture => normalize(fixture.content[key]));
  assert.equal(new Set(values).size, fixtures.length, key + " must have a distinct full-section fingerprint for every niche");
}
const deprecatedBoilerplate = /presented with clarity|customer guidance|share the need|review the fit|quality assurance market/i;
for (const fixture of mediaCoverageFixtures) {
  const visibleCopy = Object.values(fixture.content).join(" ");
  assert.doesNotMatch(visibleCopy, deprecatedBoilerplate, fixture.expectedProfile + ": generic QA boilerplate returned");
}
assert.ok(new Set(fixtures.map(fixture => fixture.content.STYLE_MODE)).size >= 4, "niche set lost its typography/shape direction variety");

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
  { ABOUT_BODY: base.ABOUT_BODY + "<p>Rated 4.9/5 by 600 customers.</p>" },
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
