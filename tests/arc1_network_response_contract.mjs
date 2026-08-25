import assert from "node:assert/strict";
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

console.log("ARC1 network response contract passed: deadlines, redirect rejection, exact URLs, and bounded streaming are enforced across all provider reads.");
