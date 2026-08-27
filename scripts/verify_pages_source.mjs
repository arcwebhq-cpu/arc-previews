import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const API_VERSION = "2026-03-10";

export function assertActionsOnlyPagesSite(site) {
  assert.ok(site && typeof site === "object" && !Array.isArray(site),
    "GitHub Pages settings must return an object.");
  assert.equal(site.build_type, "workflow",
    "GitHub Pages must use GitHub Actions only; branch/root publication is forbidden.");
}

export async function verifyActionsOnlyPagesSource({
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
} = {}) {
  assert.match(String(repository || ""), REPOSITORY,
    "GITHUB_REPOSITORY must be an exact owner/repository pair.");
  assert.ok(typeof token === "string" && token.length > 0,
    "GITHUB_TOKEN is required for the Pages settings readback.");
  assert.equal(typeof fetchImpl, "function");

  const response = await fetchImpl(`https://api.github.com/repos/${repository}/pages`, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "arc-pages-source-contract",
    },
  });
  assert.equal(response.status, 200,
    `GitHub Pages settings readback failed closed with HTTP ${response.status}.`);
  const site = await response.json();
  assertActionsOnlyPagesSite(site);
  return Object.freeze({ build_type: site.build_type });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await verifyActionsOnlyPagesSource();
  process.stdout.write(`ARC Pages source contract passed: ${result.build_type}.\n`);
}
