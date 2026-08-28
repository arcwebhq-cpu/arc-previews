import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc1_private_checkout_lifecycle.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runRetiredLifecycle = new AsyncFunction("inputData", "fetch", "Buffer", source);

assert.match(source, /throw new Error\("ARC1_LEGACY_PAYMENT_LINK_LIFECYCLE_RETIRED:/);
assert.doesNotMatch(source,
  /\binputData\b|\bfetch\s*\(|api\.stripe\.com|\/v1\/payment_links|stripe_api_key|payment_link_id|\bplink_|buy\.stripe\.com|ENROLL_ACTIVE|REQUEST_DEACTIVATION|AUTHORIZE_RENEWAL/i,
  "The retired lifecycle shim must contain no executable legacy state machine.");
let inputReads = 0;
let networkCalls = 0;
await assert.rejects(runRetiredLifecycle(new Proxy({}, {
  get() {
    inputReads += 1;
    throw new Error("retired lifecycle parsed input");
  }
}), async () => {
  networkCalls += 1;
  throw new Error("retired lifecycle accessed the network");
}, Buffer), /ARC1_LEGACY_PAYMENT_LINK_LIFECYCLE_RETIRED/);
assert.equal(inputReads, 0);
assert.equal(networkCalls, 0);

console.log("ARC1 legacy Payment Link lifecycle retirement passed: unconditional throw and zero input/network access.");
