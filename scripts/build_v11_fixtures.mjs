import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fixtures as launchFixtures } from "../fixtures/v11_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v11_media_coverage.mjs";
import { renderV11Site } from "./v11_site_contract.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function safeOutputPath(root, output) {
  const resolvedRoot = path.resolve(root);
  const resolvedOutput = path.resolve(output);
  if (resolvedOutput === path.parse(resolvedOutput).root || resolvedOutput === resolvedRoot || resolvedOutput.length < 12) {
    throw new Error("ARC_V11_FIXTURE_INVALID: unsafe output directory");
  }
  return resolvedOutput;
}

export async function buildV11Fixtures({
  root = moduleRoot,
  output = path.join(root, "qa-v11")
} = {}) {
  const sourceRoot = path.resolve(root);
  const outputRoot = safeOutputPath(sourceRoot, output);
  const template = await readFile(path.join(sourceRoot, "ARC_MASTER_TEMPLATE_V11.html"), "utf8");
  const fixtures = [...launchFixtures, ...mediaCoverageFixtures];
  const manifest = [];

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  for (const fixture of fixtures) {
    const rendered = renderV11Site(template, fixture.content, {
      trustedEventPrefix: fixture.id,
      customerEmail: fixture.customerEmail
    });
    const manifestPages = [];
    for (const page of rendered.pages) {
      const destination = path.join(outputRoot, rendered.folder, ...page.path.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, page.html, "utf8");
      manifestPages.push({
        key: page.key,
        path: page.path,
        file: `${rendered.folder}/${page.path}`,
        approvalSha256: page.approvalSha256,
        publishedSha256: page.publishedSha256,
        size: Buffer.byteLength(page.html, "utf8")
      });
    }
    manifest.push({
      folder: rendered.folder,
      expectedProfile: fixture.expectedProfile,
      isLaunch: fixture.isLaunch,
      previewUrl: rendered.previewUrl,
      pageCount: rendered.pageCount,
      approvalBundleSha256: rendered.approvalBundleSha256,
      pages: manifestPages
    });
  }

  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    output: outputRoot,
    siteCount: manifest.length,
    pageCount: manifest.reduce((total, site) => total + site.pageCount, 0),
    manifest
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("ARC_V11_FIXTURE_INVALID: build output is fixed at qa-v11");
  const result = await buildV11Fixtures();
  console.log(`Built ${result.siteCount} ARC v11 five-page fixtures (${result.pageCount} HTML documents).`);
}
