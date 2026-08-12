import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const legacyScripts = [
  "arc2_publish_delivery_pr.js",
  "arc2_merge_delivery_pr.js"
];

for (const filename of legacyScripts) {
  const source = await readFile(new URL(`../zapier/${filename}`, import.meta.url), "utf8");
  const run = new AsyncFunction("inputData", "fetch", "Buffer", source);
  let networkCalls = 0;
  await assert.rejects(
    run({}, async () => {
      networkCalls += 1;
      throw new Error("legacy ARC2 step reached the network");
    }, Buffer),
    /ARC_LEGACY_HANDOFF_DISABLED/
  );
  assert.equal(networkCalls, 0, `${filename} must fail before any network access`);
  assert.match(source.split("\n").slice(0, 4).join("\n"), /throw new Error\("ARC_LEGACY_HANDOFF_DISABLED:/);
}

console.log("ARC2 legacy PR and merge steps fail closed before network access");
