import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const implementations = [
  "arc1_publish_preview_pr.js",
  "arc1_merge_preview_pr.js",
  "arc1_preview_email_gate.js",
  "arc1_publish_function_assets.js"
];

for (const name of implementations) {
  const source = await readFile(new URL(`../zapier/${name}`, import.meta.url), "utf8");
  assert.match(source, /provider_operation_timeout_ms/, `${name} must expose the bounded operation deadline input.`);
  assert.match(source, /operationDeadline\s*=\s*Date\.now\(\)\s*\+\s*operationTimeoutMs/, `${name} must use one total provider-operation deadline.`);
  assert.match(source, /new AbortController\(\)/, `${name} must abort stalled provider reads.`);
  assert.match(source, /redirect:\s*["']error["']/, `${name} must reject redirects.`);
  assert.match(source, /response\.url\s*!==\s*requestedUrl\.toString\(\)/, `${name} must bind each response to the exact requested URL.`);
  assert.match(source, /content-length/, `${name} must reject oversized declared bodies.`);
  assert.match(source, /\.body\?\.getReader\?\.\(\)/, `${name} must stream provider bodies under a byte limit.`);
  assert.match(source, /reader\.cancel\(\)/, `${name} must cancel oversized streamed bodies.`);
  assert.match(source, /streamed response exceeds limit/, `${name} must fail closed on chunked overflow.`);
  assert.match(source, /malformed JSON response/, `${name} must fail closed on malformed provider JSON.`);
}

const emailGateSource = await readFile(new URL("../zapier/arc1_preview_email_gate.js", import.meta.url), "utf8");
assert.doesNotMatch(emailGateSource, /redirect:\s*["']follow["']/, "The Pages readiness probe must never follow redirects.");
assert.match(emailGateSource, /fetchBounded\(previewUrl\.toString\(\)/, "The live Pages HTML must use the bounded fetch path.");
assert.match(emailGateSource, /fetchBounded\(assetUrl\.toString\(\)/, "Every live customer asset must use the bounded fetch path.");

const assetRetrieverSource = await readFile(new URL("../zapier/arc1_retrieve_function_assets.js", import.meta.url), "utf8");
assert.match(assetRetrieverSource, /provider_operation_timeout_ms/, "Private asset retrieval must expose a bounded operation deadline input.");
assert.match(assetRetrieverSource, /operationDeadline\s*=\s*Date\.now\(\)\s*\+\s*operationTimeoutMs/,
  "Private asset retrieval must establish one total operation deadline.");
assert.ok(assetRetrieverSource.indexOf("const operationDeadline") < assetRetrieverSource.indexOf("for (const grant of grants)"),
  "The private-asset deadline must be shared across every grant, not recreated per asset.");
assert.match(assetRetrieverSource, /new AbortController\(\)/, "Every private asset request must be abortable.");
assert.match(assetRetrieverSource, /Math\.min\(10000,\s*remaining\)/,
  "Each private asset request must keep the reviewed ten-second ceiling inside the shared deadline.");
assert.match(assetRetrieverSource, /readBounded\(response,\s*grant\.size,\s*controller\)/,
  "The shared provider deadline must cover streamed asset body reads.");
assert.match(assetRetrieverSource, /reader\.cancel\(\)/, "A timed-out private asset stream must be cancelled.");
assert.doesNotMatch(assetRetrieverSource, /AbortSignal\.timeout\(/,
  "Private asset retrieval must not reset an independent timeout for each asset.");

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runAssetRetriever = new AsyncFunction("inputData", "fetch", "Buffer", assetRetrieverSource);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
};
const assetEndpoint = "https://arcweb.onl/internal/intake/arc1/assets/retrieve";
const assetInput = (grants, timeout) => ({
  bridge_contract_sha256: "e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841",
  bridge_delivery_id: "a".repeat(64),
  bridge_evidence_sha256: "b".repeat(64),
  asset_retrieval_endpoint: assetEndpoint,
  private_asset_grants_json: canonicalJson(grants),
  private_asset_grants_sha256: sha256(canonicalJson(grants)),
  asset_retrieval_bearer: "retrieval-bearer-secret-unique-0123456789",
  asset_receipt_secret: "receipt-signing-secret-unique-0123456789",
  ...(timeout === undefined ? {} : { provider_operation_timeout_ms: timeout })
});

for (const timeout of ["99", "25001", "100.5", "not-a-number"]) {
  let providerCalls = 0;
  await assert.rejects(runAssetRetriever(assetInput([], timeout), async () => {
    providerCalls += 1;
    throw new Error("Invalid timeout validation must precede provider access.");
  }, Buffer), /provider operation timeout/, `invalid provider timeout ${timeout} must fail closed`);
  assert.equal(providerCalls, 0, `invalid provider timeout ${timeout} must make zero provider calls`);
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const makeGrant = (role, label) => ({
  schema: "arc-intake-private-asset-grant-v1",
  asset_id: sha256(`asset-${label}`),
  kind: "UPLOAD",
  role,
  content_type: "image/png",
  size: png.length,
  sha256: sha256(png),
  retrieval_endpoint_sha256: sha256(assetEndpoint)
});
const timedGrants = [makeGrant("hero_image_file", "hero"), makeGrant("logo_file", "logo")];
const responseFor = (grant, body) => {
  const response = new Response(body, { status: 200, headers: {
    "content-type": grant.content_type,
    "content-length": String(grant.size),
    "x-arc-asset-id": grant.asset_id,
    "x-arc-asset-kind": grant.kind,
    "x-arc-asset-role": grant.role,
    "x-arc-asset-sha256": grant.sha256
  } });
  Object.defineProperty(response, "url", { value: assetEndpoint });
  return response;
};
let assetCalls = 0;
let hangingStreamCancelled = false;
const startedAt = Date.now();
await assert.rejects(runAssetRetriever(assetInput(timedGrants, "200"), async (_url, options) => {
  const request = JSON.parse(options.body);
  const grant = timedGrants.find(candidate => candidate.asset_id === request.asset_id);
  assert.ok(grant, "The timed retrieval request must remain bound to a signed grant.");
  assetCalls += 1;
  if (assetCalls === 1) {
    let delayedChunk;
    return responseFor(grant, new ReadableStream({
      start(controller) {
        delayedChunk = setTimeout(() => { controller.enqueue(new Uint8Array(png)); controller.close(); }, 120);
      },
      cancel() { clearTimeout(delayedChunk); }
    }));
  }
  return responseFor(grant, new ReadableStream({
    start() {},
    cancel() { hangingStreamCancelled = true; }
  }));
}, Buffer), /provider operation timeout/,
"The second body read must inherit the first asset's elapsed time and fail at the shared operation deadline.");
const elapsedMs = Date.now() - startedAt;
assert.equal(assetCalls, 2, "The cumulative timeout regression must reach the second asset before the shared deadline expires.");
assert.equal(hangingStreamCancelled, true, "A hanging private asset body must be cancelled when the shared deadline expires.");
assert.ok(elapsedMs >= 150 && elapsedMs < 2000, `The shared 200ms deadline must bound the complete multi-asset operation (elapsed ${elapsedMs}ms).`);

const behavioralSource = await readFile(new URL("./arc1_pr_gate_contract.mjs", import.meta.url), "utf8");
for (const behavior of [
  "declared response exceeds limit",
  "streamed response exceeds limit",
  "response URL changed",
  "malformed JSON response",
  "request timeout"
]) {
  assert.ok(behavioralSource.includes(behavior), `The PR gate must retain a behavioral regression for ${behavior}.`);
}

console.log("ARC1 network response contract passed: shared deadlines, cancellation, redirect rejection, exact URLs, and bounded streaming are enforced across all provider reads.");
