import assert from "node:assert/strict";

import {
  assertActionsOnlyPagesSite,
  verifyActionsOnlyPagesSource,
} from "../scripts/verify_pages_source.mjs";

assert.doesNotThrow(() => assertActionsOnlyPagesSite({ build_type: "workflow" }));
for (const unsafe of [
  { build_type: "legacy", source: { branch: "main", path: "/" } },
  { source: { branch: "main", path: "/" } },
  null,
]) {
  assert.throws(() => assertActionsOnlyPagesSite(unsafe),
    /GitHub Pages|settings must return an object/);
}

let observedUrl;
let observedOptions;
const result = await verifyActionsOnlyPagesSource({
  repository: "arcwebhq-cpu/arc-previews",
  token: "test-token-not-a-secret",
  fetchImpl: async (url, options) => {
    observedUrl = url;
    observedOptions = options;
    return { status: 200, json: async () => ({ build_type: "workflow" }) };
  },
});
assert.deepEqual(result, { build_type: "workflow" });
assert.equal(observedUrl, "https://api.github.com/repos/arcwebhq-cpu/arc-previews/pages");
assert.equal(observedOptions.method, "GET");
assert.equal(observedOptions.redirect, "error");
assert.equal(observedOptions.headers.Authorization, "Bearer test-token-not-a-secret");
assert.equal(observedOptions.headers["X-GitHub-Api-Version"], "2026-03-10");

await assert.rejects(verifyActionsOnlyPagesSource({
  repository: "arcwebhq-cpu/arc-previews",
  token: "test-token-not-a-secret",
  fetchImpl: async () => ({ status: 200, json: async () => ({ build_type: "legacy" }) }),
}), /GitHub Pages must use GitHub Actions only/);

await assert.rejects(verifyActionsOnlyPagesSource({
  repository: "arcwebhq-cpu/arc-previews",
  token: "test-token-not-a-secret",
  fetchImpl: async () => ({ status: 403, json: async () => ({}) }),
}), /failed closed with HTTP 403/);

await assert.rejects(verifyActionsOnlyPagesSource({
  repository: "not-a-repository",
  token: "test-token-not-a-secret",
  fetchImpl: async () => ({ status: 200, json: async () => ({ build_type: "workflow" }) }),
}), /exact owner\/repository pair/);

console.log("PASS Pages source contract: workflow-only publication is required and legacy branch publication fails closed.");
