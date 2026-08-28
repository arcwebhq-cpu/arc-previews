import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");
const [source, wiringRaw] = await Promise.all([
  read("../zapier/arc2_delivery_email_gate.js"),
  read("../zapier/wiring-contract.json")
]);
const wiring = JSON.parse(wiringRaw);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runRetiredGate = new AsyncFunction("inputData", "fetch", "Buffer", source);

assert.match(source, /throw new Error\("ARC2_LEGACY_DELIVERY_EMAIL_GATE_RETIRED:/);
assert.doesNotMatch(source,
  /\binputData\b|\bfetch\s*\(|api\.stripe\.com|stripe_api_key|payment_link_id|\bplink_|buy\.stripe\.com|send_delivery_email/i,
  "The retired Zapier delivery gate must retain no executable legacy policy.");
let inputReads = 0;
let networkCalls = 0;
await assert.rejects(runRetiredGate(new Proxy({}, {
  get() {
    inputReads += 1;
    throw new Error("retired delivery gate parsed input");
  }
}), async () => {
  networkCalls += 1;
  throw new Error("retired delivery gate accessed the network");
}, Buffer), /ARC2_LEGACY_DELIVERY_EMAIL_GATE_RETIRED/);
assert.equal(inputReads, 0);
assert.equal(networkCalls, 0);

assert.deepEqual(wiring.arc2.retired_delivery_email_gate, {
  source: "zapier/arc2_delivery_email_gate.js",
  status: "retired-unconditional-fail-closed-shim",
  retirement_error: "ARC2_LEGACY_DELIVERY_EMAIL_GATE_RETIRED",
  allowed_in_active_v11_flow: false,
  executable: false,
  replacement: "arc-site/netlify/lib/arc2-transactional-email-worker-core.mjs"
});
assert.equal(wiring.arc2.final_delivery_email.source,
  "arc-site/netlify/lib/arc2-transactional-email-worker-core.mjs");
assert.equal(wiring.arc2.required_future_flow.includes("zapier/arc2_delivery_email_gate.js"), false);
assert.equal(wiring.arc2.required_future_flow.includes("arc-site/resend-transactional-worker:send-final-delivery-with-durable-idempotency"), true);

console.log("ARC2 legacy Zapier delivery-email gate retirement passed; first-party V11 worker remains authoritative.");
