import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc1_verify_payment_link.js", import.meta.url), "utf8");
const activeOfferSource = await readFile(new URL("../zapier/arc1_verify_checkout_offer.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runRetiredVerifier = new AsyncFunction("inputData", "fetch", "Buffer", source);

assert.match(source, /throw new Error\("ARC1_LEGACY_PAYMENT_LINK_VERIFIER_RETIRED:/);
assert.doesNotMatch(source,
  /\binputData\b|\bfetch\s*\(|URLSearchParams|api\.stripe\.com|\/v1\/payment_links|stripe_api_key|\bplink_|buy\.stripe\.com/i,
  "The retired verifier must contain no input parsing or Stripe access.");
let inputReads = 0;
let networkCalls = 0;
await assert.rejects(runRetiredVerifier(new Proxy({}, {
  get() {
    inputReads += 1;
    throw new Error("retired verifier parsed input");
  }
}), async () => {
  networkCalls += 1;
  throw new Error("retired verifier accessed the network");
}, Buffer), /ARC1_LEGACY_PAYMENT_LINK_VERIFIER_RETIRED/);
assert.equal(inputReads, 0);
assert.equal(networkCalls, 0);

assert.match(activeOfferSource, /PRIVATE_CHECKOUT_SESSION_OFFER_VERIFIED/);
assert.match(activeOfferSource, /checkout_offer_evidence_private/);
assert.doesNotMatch(activeOfferSource, /payment[_ -]?link|buy\.stripe\.com|\bplink_|\/v1\/checkout\/sessions/i,
  "The V11 offer verifier must stay read-only and Checkout-Session-specific.");

console.log("ARC1 legacy Payment Link verifier retirement passed; active V11 Checkout Session offer verifier preserved.");
