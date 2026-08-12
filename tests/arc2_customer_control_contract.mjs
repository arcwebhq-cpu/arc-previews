import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc2_verify_customer_control.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("inputData", "fetch", "Buffer", source);
let networkCalls = 0;

await assert.rejects(
  run({}, async () => {
    networkCalls += 1;
    throw new Error("legacy customer-control verifier reached the network");
  }, Buffer),
  /ARC_LEGACY_HANDOFF_DISABLED/
);
assert.equal(networkCalls, 0, "legacy customer-control verifier must fail before network access");
assert.match(source.split("\n").slice(0, 4).join("\n"), /throw new Error\("ARC_LEGACY_HANDOFF_DISABLED:/);

console.log("ARC2 legacy customer GitHub/token verifier fails closed before network access");
