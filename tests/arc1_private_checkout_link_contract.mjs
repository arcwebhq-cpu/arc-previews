import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");
const [source, wiringRaw, cutoverRaw] = await Promise.all([
  read("../zapier/arc1_private_checkout_link.js"),
  read("../zapier/wiring-contract.json"),
  read("../zapier/receipt-v1-clean-cutover.json")
]);
const wiring = JSON.parse(wiringRaw);
const cutover = JSON.parse(cutoverRaw);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runRetiredStep = new AsyncFunction("inputData", "fetch", "Buffer", source);

assert.match(source, /^\/\/ RETIRED:/);
assert.match(source, /throw new Error\("ARC1_LEGACY_PAYMENT_LINK_RETIRED:/);
assert.doesNotMatch(source,
  /\binputData\b|\bfetch\s*\(|URLSearchParams|api\.stripe\.com|\/v1\/payment_links|stripe_api_key|\bplink_|buy\.stripe\.com|method\s*:\s*["']POST/i,
  "The retired shim must not parse input, access Stripe, or retain provider-write logic.");

let inputReads = 0;
let networkCalls = 0;
const hostileInput = new Proxy({}, {
  get() {
    inputReads += 1;
    throw new Error("retired step parsed input");
  }
});
await assert.rejects(
  runRetiredStep(hostileInput, async () => {
    networkCalls += 1;
    throw new Error("retired step accessed the network");
  }, Buffer),
  error => error?.message === "ARC1_LEGACY_PAYMENT_LINK_RETIRED: use the V11 private Checkout Session flow"
);
assert.equal(inputReads, 0, "The retirement error must be thrown before any input parsing.");
assert.equal(networkCalls, 0, "The retirement error must be thrown before any network access.");

const zapierDirectory = new URL("../zapier/", import.meta.url);
const zapierSources = await Promise.all((await readdir(zapierDirectory))
  .filter(name => name.endsWith(".js"))
  .map(async name => [name, await read(`../zapier/${name}`)]));
for (const [name, candidate] of zapierSources) {
  assert.doesNotMatch(candidate, /\/v1\/payment_links/i,
    `${name} retains an executable Stripe Payment Links provider path.`);
}

assert.deepEqual(wiring.arc1.legacy_pre_review_payment_link, {
  legacy_only: true,
  status: "retired-unconditional-fail-closed",
  allowed_in_active_v11_order: false,
  provider_execution_allowed: false,
  provider_endpoint_present: false,
  writer_source: "zapier/arc1_private_checkout_link.js",
  retirement_error: "ARC1_LEGACY_PAYMENT_LINK_RETIRED",
  compatibility_evidence: "zapier/receipt-v1-clean-cutover.json"
});
assert.equal(wiring.arc1.private_checkout_link.status, "retired-unconditional-fail-closed-shim");
assert.equal(wiring.arc1.private_checkout_link.executable, false);
assert.equal(wiring.arc1.private_checkout_link.network_access_allowed, false);
assert.equal(wiring.arc1.private_checkout_link.provider_execution_allowed, false);
assert.equal(wiring.arc1.private_checkout_link.payment_link_endpoint_present, false);
assert.equal(wiring.arc1.private_checkout_link.allowed_in_active_v11_order, false);
assert.equal(wiring.arc1.ordered_steps.some(step => /arc1_verify_payment_link|arc1_private_checkout_link/.test(step)), false);
assert.equal(wiring.arc1.ordered_steps.includes("arc-site/review-checkout:create-one-approved-private-checkout-session"), true,
  "Retiring the Payment Link writer must not remove the V11 private Checkout Session step.");

assert.equal(cutover.private_payment_link_receipt_v1.cutover_mode, "clean-cutover-no-dual-read");
assert.equal(cutover.private_payment_link_receipt_v1.legacy_receipts_accepted, false);
assert.equal(cutover.private_payment_link_receipt_v1.regeneration_required, true);

console.log("ARC1 legacy Payment Link writer retirement passed: unconditional throw, zero input/network access, no provider endpoint, V11 Checkout Session path preserved.");
