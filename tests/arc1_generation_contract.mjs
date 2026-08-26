import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixtures } from "../fixtures/v10_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v10_media_coverage.mjs";
import { REQUIRED_KEYS } from "../scripts/arc_contract.mjs";
import {
  ARC1_GENERATION_CONTRACT_SHA256,
  ARC1_GENERATION_CONTRACT_VERSION,
  ARC1_GENERATION_EVALUATION_VERSION,
  ARC1_GENERATION_INSTRUCTIONS,
  ARC1_GENERATION_INSTRUCTIONS_SHA256,
  ARC1_GENERATION_MAX_ATTEMPTS,
  ARC1_GENERATION_MAX_FIELD_BYTES,
  ARC1_GENERATION_MAX_PAGE_HTML_BYTES,
  ARC1_GENERATION_MAX_TOTAL_HTML_BYTES,
  ARC1_GENERATION_OUTPUT_SCHEMA,
  ARC1_GENERATION_OUTPUT_SCHEMA_SHA256,
  ARC1_GENERATION_PROFILES,
  ARC1_GENERATION_REQUEST_VERSION,
  ARC1_GENERATION_RETRY_STATE_VERSION,
  ARC1_PRIVATE_OR_OPERATIONAL_FIELDS,
  ARC1_PUBLIC_BRIEF_FIELDS,
  buildArc1GenerationRequest,
  canonicalJson,
  createArc1GenerationRetryState,
  evaluateArc1GenerationCandidate,
  projectPublicBrief,
  recordArc1GenerationAttempt
} from "../scripts/arc1_generation_contract.mjs";
import {
  V11_PAGES,
  V11_SITE_CONTRACT_VERSION,
  V11_TEMPLATE_VERSION,
  createV11ApprovalManifest,
  digestV11ApprovalManifest,
  renderV11Site
} from "../scripts/v11_site_contract.mjs";

const sha256 = value => createHash("sha256").update(String(value), "utf8").digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const allFixtures = [...fixtures, ...mediaCoverageFixtures];
const template = await readFile(new URL("../ARC_MASTER_TEMPLATE_V11.html", import.meta.url), "utf8");
const expectedPagePaths = ["index.html", "services/index.html", "about/index.html", "process/index.html", "contact/index.html"];

function sourceIntake(fixture) {
  return {
    name: `Private owner for ${fixture.expectedProfile}`,
    email: fixture.customerEmail,
    lead_notification_email: `private-leads-${fixture.expectedProfile}@example.test`,
    referrer_host: "private-referrer.example.test",
    utm_source: "private-campaign",
    business: fixture.content.BUSINESS_NAME,
    city: fixture.content.LOCATION,
    industry: fixture.content.INDUSTRY_LABEL,
    main_call_to_action: fixture.content.PRIMARY_CTA_LABEL,
    main_services: fixture.content.SERVICES_INTRO,
    primary_style: fixture.content.STYLE_MODE,
    goals: ["More calls", "Explain services"],
    highest_profit_service: fixture.content.HIGHEST_PROFIT_SERVICE,
    lead_form_needed: "Yes",
    lead_form_fields: ["Name", "Email", "Phone", "Project details"]
  };
}

function requestFor(fixture, expectedMediaProfile = fixture.expectedProfile, intake = sourceIntake(fixture)) {
  return buildArc1GenerationRequest({
    sourceIntake: intake,
    expectedMediaProfile,
    submissionDataSha256: sha256(canonicalJson(intake))
  });
}

function evaluate(fixture, candidate = fixture.content, options = {}) {
  const intake = options.sourceIntake || sourceIntake(fixture);
  const generationRequest = options.generationRequest || requestFor(fixture, options.expectedMediaProfile || fixture.expectedProfile, intake);
  return evaluateArc1GenerationCandidate({
    generationRequest,
    candidate,
    sourceIntake: intake,
    template,
    renderOptions: { trustedEventPrefix: fixture.id, customerEmail: intake.email }
  });
}

assert.equal(REQUIRED_KEYS.length, 58);
assert.equal(ARC1_GENERATION_OUTPUT_SCHEMA.type, "object");
assert.equal(ARC1_GENERATION_OUTPUT_SCHEMA.additionalProperties, false);
assert.deepEqual(ARC1_GENERATION_OUTPUT_SCHEMA.required, REQUIRED_KEYS);
assert.deepEqual(Object.keys(ARC1_GENERATION_OUTPUT_SCHEMA.properties), REQUIRED_KEYS);
assert.equal(Object.values(ARC1_GENERATION_OUTPUT_SCHEMA.properties).every(property =>
  Object.keys(property).length === 1 && property.type === "string"), true);
assert.equal(ARC1_GENERATION_OUTPUT_SCHEMA_SHA256, sha256(canonicalJson(ARC1_GENERATION_OUTPUT_SCHEMA)));
assert.equal(ARC1_GENERATION_OUTPUT_SCHEMA_SHA256, "264ffa8d53897ea23e66a5b45d82d006910446423578a100426b94c0f609f55f",
  "the v11 migration must not change the byte-exact 58-string model output schema");
assert.equal(ARC1_GENERATION_INSTRUCTIONS_SHA256, sha256(ARC1_GENERATION_INSTRUCTIONS));
assert.match(ARC1_GENERATION_CONTRACT_SHA256, /^[a-f0-9]{64}$/);
assert.equal(ARC1_GENERATION_CONTRACT_VERSION, "arc1-generation-contract-v2");
assert.equal(ARC1_GENERATION_REQUEST_VERSION, "arc1-generation-request-v2");
assert.equal(ARC1_GENERATION_EVALUATION_VERSION, "arc1-generation-evaluation-v2");
assert.equal(ARC1_GENERATION_RETRY_STATE_VERSION, "arc1-generation-retry-state-v2");
assert.equal(ARC1_GENERATION_MAX_ATTEMPTS, 3);
assert.equal(ARC1_GENERATION_MAX_PAGE_HTML_BYTES, 150_000);
assert.equal(ARC1_GENERATION_MAX_TOTAL_HTML_BYTES, 500_000);
assert.equal(ARC1_PUBLIC_BRIEF_FIELDS.length, 34);
assert.equal(ARC1_PRIVATE_OR_OPERATIONAL_FIELDS.length, 9);
assert.match(ARC1_GENERATION_INSTRUCTIONS, /fixed five-page site: Home, Services, About, Process, and Contact/);
assert.match(ARC1_GENERATION_INSTRUCTIONS, /Proof must remain source-authorized/);
assert.match(ARC1_GENERATION_INSTRUCTIONS, /one form is Contact-only/);

assert.equal(allFixtures.length, 19);
assert.deepEqual(new Set(allFixtures.map(item => item.expectedProfile)), new Set(ARC1_GENERATION_PROFILES));
assert.deepEqual(V11_PAGES.map(page => page.path), expectedPagePaths);

const projectionInput = {
  utm_term: "must-not-map",
  email: "private-owner@example.test",
  name: "Private Owner",
  lead_notification_email: "private-leads@example.test",
  primary_style: "Modern",
  main_services: "Roof replacement and repair",
  industry: "Roofing",
  city: "Tacoma, Washington",
  business: "Projection Roofing",
  main_call_to_action: "Request Estimate",
  goals: ["More calls", "Explain services"],
  public_email: "hello@projection-roofing.example",
  unsupported_field: "must-not-map"
};
const projection = projectPublicBrief(projectionInput);
assert.deepEqual(Object.keys(projection), [
  "business", "city", "goals", "industry", "main_call_to_action", "main_services", "primary_style", "public_email"
]);
for (const field of [...ARC1_PRIVATE_OR_OPERATIONAL_FIELDS, "unsupported_field"]) {
  assert.equal(Object.hasOwn(projection, field), false, `${field} must not enter the public brief`);
}
assert.throws(() => projectPublicBrief({ ...projectionInput, business_story: "Write to private-owner@example.test" }),
  /ARC1_GENERATION_PRIVACY_FAILED/);
assert.throws(() => projectPublicBrief({ ...projectionInput, goals: [{ text: "More calls" }] }),
  /ARC1_GENERATION_BRIEF_INVALID/);
assert.throws(() => projectPublicBrief({ ...projectionInput, primary_style: "" }),
  /ARC1_GENERATION_BRIEF_INVALID/);
assert.doesNotThrow(() => projectPublicBrief({
  ...projectionInput,
  email: "hello@projection-roofing.example",
  public_email: "hello@projection-roofing.example"
}));

const projectionSubmissionSha256 = sha256(canonicalJson(projectionInput));
const deterministicLeft = buildArc1GenerationRequest({
  sourceIntake: projectionInput,
  expectedMediaProfile: "roofing",
  submissionDataSha256: projectionSubmissionSha256
});
const deterministicRight = buildArc1GenerationRequest({
  sourceIntake: Object.fromEntries(Object.entries(projectionInput).reverse()),
  expectedMediaProfile: "roofing",
  submissionDataSha256: projectionSubmissionSha256
});
assert.equal(deterministicLeft.request_json, deterministicRight.request_json);
assert.equal(deterministicLeft.request_sha256, deterministicRight.request_sha256);
assert.equal(deterministicLeft.request_sha256, sha256(deterministicLeft.request_json));
assert.equal(deterministicLeft.request.version, ARC1_GENERATION_REQUEST_VERSION);
assert.equal(deterministicLeft.request.contract_sha256, ARC1_GENERATION_CONTRACT_SHA256);
assert.equal(deterministicLeft.request.output_schema_sha256, ARC1_GENERATION_OUTPUT_SCHEMA_SHA256);
assert.equal(deterministicLeft.request.instructions_sha256, ARC1_GENERATION_INSTRUCTIONS_SHA256);
assert.equal(deterministicLeft.request.site_contract_version, V11_SITE_CONTRACT_VERSION);
assert.equal(deterministicLeft.request.template_version, V11_TEMPLATE_VERSION);
assert.equal(deterministicLeft.request.authoritative_submission_data_sha256, projectionSubmissionSha256);
assert.equal(deterministicLeft.request.constraints.network_calls_allowed, false);
assert.equal(deterministicLeft.request.constraints.external_state_mutation_allowed, false);
assert.equal(deterministicLeft.request.constraints.maximum_page_html_bytes, ARC1_GENERATION_MAX_PAGE_HTML_BYTES);
assert.equal(deterministicLeft.request.constraints.maximum_total_html_bytes, ARC1_GENERATION_MAX_TOTAL_HTML_BYTES);
assert.equal(deterministicLeft.request.constraints.page_count, 5);
assert.deepEqual(deterministicLeft.request.constraints.page_paths, expectedPagePaths);
assert.equal(Object.hasOwn(deterministicLeft.request, "provider"), false);
assert.equal(Object.hasOwn(deterministicLeft.request, "model"), false);
assert.throws(() => buildArc1GenerationRequest({
  sourceIntake: projectionInput,
  expectedMediaProfile: "unknown",
  submissionDataSha256: projectionSubmissionSha256
}),
  /ARC1_GENERATION_BRIEF_INVALID/);
assert.throws(() => buildArc1GenerationRequest({
  sourceIntake: projectionInput,
  expectedMediaProfile: "roofing",
  submissionDataSha256: "not-a-digest"
}), /ARC1_GENERATION_REQUEST_INVALID/);

for (const fixture of allFixtures) {
  assert.deepEqual(Object.keys(fixture.content), REQUIRED_KEYS, `${fixture.expectedProfile} fixture must keep exact key order`);
  assert.equal(Object.values(fixture.content).every(value => typeof value === "string"), true,
    `${fixture.expectedProfile} fixture must keep the exact string schema`);
  const intake = sourceIntake(fixture);
  const generationRequest = requestFor(fixture, fixture.expectedProfile, intake);
  const renderOptions = { trustedEventPrefix: fixture.id, customerEmail: intake.email };
  const rendered = renderV11Site(template, fixture.content, renderOptions);
  const result = evaluate(fixture, JSON.stringify(fixture.content), { generationRequest, sourceIntake: intake });
  assert.equal(result.status, "ACCEPTED", `${fixture.expectedProfile} failed with ${result.code}`);
  assert.equal(result.code, "OK");
  assert.equal(result.expected_media_profile, fixture.expectedProfile);
  assert.equal(result.observed_media_profile, fixture.expectedProfile);
  assert.equal(rendered.pageCount, 5, `${fixture.expectedProfile}: v11 page count`);
  assert.deepEqual(rendered.pages.map(page => page.path), expectedPagePaths, `${fixture.expectedProfile}: fixed page paths`);
  assert.equal(result.page_count, 5, `${fixture.expectedProfile}: signed evaluation page count`);
  assert.equal(result.approval_content_sha256, rendered.approvalBundleSha256,
    `${fixture.expectedProfile}: evaluation must bind the canonical whole-site approval digest`);
  const pageSizes = rendered.pages.map(page => Buffer.byteLength(page.approvalHtml, "utf8"));
  const totalHtmlBytes = pageSizes.reduce((total, size) => total + size, 0);
  assert.equal(pageSizes.every(size => size > 0 && size <= ARC1_GENERATION_MAX_PAGE_HTML_BYTES), true,
    `${fixture.expectedProfile}: every approval page must fit the production-safe page cap`);
  assert.equal(result.total_html_bytes, totalHtmlBytes, `${fixture.expectedProfile}: exact total approval HTML bytes`);
  assert.ok(result.total_html_bytes <= ARC1_GENERATION_MAX_TOTAL_HTML_BYTES,
    `${fixture.expectedProfile}: five-page approval bytes must fit the production-safe aggregate cap`);
  const privateNeedles = [intake.name, intake.email, intake.lead_notification_email, intake.referrer_host, intake.utm_source]
    .map(value => value.toLowerCase());
  for (const page of rendered.pages) {
    const pageText = `${page.approvalHtml}\n${page.html}`.toLowerCase();
    for (const needle of privateNeedles) {
      assert.equal(pageText.includes(needle), false, `${fixture.expectedProfile}/${page.path}: private intake data escaped`);
    }
    const formCount = (page.approvalHtml.match(/<form\b/gi) || []).length;
    assert.equal(formCount, page.key === "contact" ? 1 : 0,
      `${fixture.expectedProfile}/${page.path}: a requested form must remain Contact-only`);
  }
  const tamperedPages = rendered.pages.map(page => page.key === "services"
    ? { ...page, approvalHtml: page.approvalHtml.replace("</body>", "<p>secondary-page-tamper</p></body>") }
    : page);
  assert.notEqual(
    digestV11ApprovalManifest(createV11ApprovalManifest(tamperedPages)),
    result.approval_content_sha256,
    `${fixture.expectedProfile}: secondary-page tampering must change the inherited whole-site digest`
  );
  assert.match(result.evaluation_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.request_sha256, generationRequest.request_sha256);
  assert.equal(result.authoritative_submission_data_sha256, generationRequest.request.authoritative_submission_data_sha256);
  assert.deepEqual(result, evaluate(fixture, JSON.stringify(fixture.content), { generationRequest, sourceIntake: intake }),
    `${fixture.expectedProfile} evaluation must be deterministic`);
}

const roofing = fixtures[0];
const roofingIntake = sourceIntake(roofing);
const roofingRequest = requestFor(roofing, "roofing", roofingIntake);
const capRenderOptions = { trustedEventPrefix: roofing.id, customerEmail: roofingIntake.email };
const pageOversizedTemplate = template.replace("</head>", `<!--${"p".repeat(140_000)}--></head>`);
const pageOversizedRender = renderV11Site(pageOversizedTemplate, roofing.content, capRenderOptions);
assert.equal(pageOversizedRender.pages.some(page =>
  Buffer.byteLength(page.approvalHtml, "utf8") > ARC1_GENERATION_MAX_PAGE_HTML_BYTES), true);
assert.equal(evaluateArc1GenerationCandidate({
  generationRequest: roofingRequest,
  candidate: roofing.content,
  sourceIntake: roofingIntake,
  template: pageOversizedTemplate,
  renderOptions: capRenderOptions
}).code, "ARC1_GENERATION_RENDER_SIZE", "a page above 150000 UTF-8 bytes must be rejected");

const aggregateOversizedTemplate = template.replace("</head>", `<!--${"a".repeat(82_000)}--></head>`);
const aggregateOversizedRender = renderV11Site(aggregateOversizedTemplate, roofing.content, capRenderOptions);
assert.equal(aggregateOversizedRender.pages.every(page =>
  Buffer.byteLength(page.approvalHtml, "utf8") <= ARC1_GENERATION_MAX_PAGE_HTML_BYTES), true);
assert.ok(aggregateOversizedRender.pages.reduce((total, page) =>
  total + Buffer.byteLength(page.approvalHtml, "utf8"), 0) > ARC1_GENERATION_MAX_TOTAL_HTML_BYTES);
assert.equal(evaluateArc1GenerationCandidate({
  generationRequest: roofingRequest,
  candidate: roofing.content,
  sourceIntake: roofingIntake,
  template: aggregateOversizedTemplate,
  renderOptions: capRenderOptions
}).code, "ARC1_GENERATION_RENDER_SIZE", "five pages above 500000 aggregate UTF-8 bytes must be rejected");

const unsafe = clone(roofing.content);
unsafe.SERVICES_HTML = unsafe.SERVICES_HTML.replace("<article>", "<article><script>alert(1)</script>");
assert.equal(evaluate(roofing, unsafe).code, "ARC_CONTENT_UNSAFE");

const unsupportedClaim = clone(roofing.content);
unsupportedClaim.HERO_PROOF_LINE = "Rated 5 stars by local homeowners";
assert.equal(evaluate(roofing, unsupportedClaim).code, "ARC_CLAIM_EVIDENCE_REQUIRED");

assert.equal(evaluate(roofing, "{not-json").code, "ARC1_GENERATION_CANDIDATE_INVALID");
assert.equal(evaluate(roofing, `\`\`\`json\n${JSON.stringify(roofing.content)}\n\`\`\``).code,
  "ARC1_GENERATION_CANDIDATE_INVALID");

const extraKey = { ...roofing.content, EXTRA: "not allowed" };
assert.equal(evaluate(roofing, extraKey).code, "ARC_CONTRACT_INVALID");
const nonString = { ...roofing.content, HEADLINE: 42 };
assert.equal(evaluate(roofing, nonString).code, "ARC1_GENERATION_CANDIDATE_INVALID");

const privateLeak = clone(roofing.content);
privateLeak.ABOUT_BODY += "<p>Private route: arc-test-roofing%40example.test. This must never be published.</p>";
assert.equal(evaluate(roofing, privateLeak).code, "ARC1_GENERATION_PRIVACY_FAILED");

const publicEmail = "hello@ironwood-roofing.example";
const publicEmailIntake = { ...roofingIntake, public_email: publicEmail };
const publicEmailCandidate = {
  ...roofing.content,
  CONTACT_DETAILS_HTML: `${roofing.content.CONTACT_DETAILS_HTML}<p><a href="mailto:${publicEmail}">Email the public business inbox</a></p>`
};
assert.equal(evaluate(roofing, publicEmailCandidate, {
  sourceIntake: publicEmailIntake,
  generationRequest: requestFor(roofing, "roofing", publicEmailIntake)
}).status, "ACCEPTED", "the exact source-authorized public business email must remain publishable");
assert.equal(evaluate(roofing, {
  ...publicEmailCandidate,
  CONTACT_DETAILS_HTML: publicEmailCandidate.CONTACT_DETAILS_HTML.replace(publicEmail, "invented@ironwood-roofing.example")
}, {
  sourceIntake: publicEmailIntake,
  generationRequest: requestFor(roofing, "roofing", publicEmailIntake)
}).code, "ARC1_GENERATION_BINDING_MISMATCH", "an invented contact email must fail before rendering or Pages publication");

const profileMismatchRequest = requestFor(roofing, "hvac");
assert.equal(evaluate(roofing, roofing.content, { generationRequest: profileMismatchRequest }).code,
  "ARC1_GENERATION_PROFILE_MISMATCH");

for (const [field, value] of [
  ["BUSINESS_NAME", "Wrong Business"],
  ["LOCATION", "Wrong Location"],
  ["INDUSTRY_LABEL", "Wrong Industry"],
  ["STYLE_MODE", "Wrong Style"],
  ["PRIMARY_CTA_LABEL", "Wrong CTA"],
  ["HIGHEST_PROFIT_SERVICE", "Wrong Priority Service"]
]) {
  assert.equal(evaluate(roofing, { ...roofing.content, [field]: value }).code,
    "ARC1_GENERATION_BINDING_MISMATCH", `${field} must remain bound to authoritative intake`);
}
assert.equal(evaluate(roofing, roofing.content, {
  sourceIntake: { ...sourceIntake(roofing), lead_form_needed: "No" },
  generationRequest: requestFor(roofing, "roofing", { ...sourceIntake(roofing), lead_form_needed: "No" })
}).code, "ARC1_GENERATION_BINDING_MISMATCH");
assert.equal(evaluate(roofing, { ...roofing.content, PRIMARY_CTA_HREF: "#services" }).code,
  "ARC1_GENERATION_BINDING_MISMATCH");

const oversized = clone(roofing.content);
oversized.ABOUT_QUOTE = "x".repeat(ARC1_GENERATION_MAX_FIELD_BYTES + 1);
assert.equal(evaluate(roofing, oversized).code, "ARC1_GENERATION_CANDIDATE_SIZE");

const tamperedRequest = clone(requestFor(roofing));
tamperedRequest.request.expected_media_profile = "hvac";
assert.equal(evaluate(roofing, roofing.content, { generationRequest: tamperedRequest }).code,
  "ARC1_GENERATION_REQUEST_INVALID");
const extendedRequest = clone(requestFor(roofing));
extendedRequest.request.provider = "untrusted-extra-field";
extendedRequest.request_json = canonicalJson(extendedRequest.request);
extendedRequest.request_sha256 = sha256(extendedRequest.request_json);
assert.equal(evaluate(roofing, roofing.content, { generationRequest: extendedRequest }).code,
  "ARC1_GENERATION_REQUEST_INVALID");
const relaxedCapRequest = clone(requestFor(roofing));
relaxedCapRequest.request.constraints.maximum_total_html_bytes += 1;
relaxedCapRequest.request_json = canonicalJson(relaxedCapRequest.request);
relaxedCapRequest.request_sha256 = sha256(relaxedCapRequest.request_json);
assert.equal(evaluate(roofing, roofing.content, { generationRequest: relaxedCapRequest }).code,
  "ARC1_GENERATION_REQUEST_INVALID", "a correctly re-digested request cannot relax the production-safe HTML cap");

const retryRequest = requestFor(roofing);
const rejection = evaluate(roofing, "{not-json", { generationRequest: retryRequest });
let retryState = createArc1GenerationRetryState(retryRequest);
assert.equal(retryState.status, "PENDING");
assert.equal(retryState.authoritative_submission_data_sha256, retryRequest.request.authoritative_submission_data_sha256);
assert.equal(retryState.expected_media_profile, "roofing");
assert.equal(retryState.maximum_page_html_bytes, ARC1_GENERATION_MAX_PAGE_HTML_BYTES);
assert.equal(retryState.maximum_total_html_bytes, ARC1_GENERATION_MAX_TOTAL_HTML_BYTES);
assert.equal(retryState.accepted_approval_content_sha256, null);
assert.equal(retryState.accepted_page_count, null);
assert.equal(retryState.accepted_total_html_bytes, null);
retryState = recordArc1GenerationAttempt(retryState, rejection);
assert.equal(retryState.status, "RETRY_ALLOWED");
assert.equal(retryState.attempt_count, 1);
retryState = recordArc1GenerationAttempt(retryState, rejection);
assert.equal(retryState.status, "RETRY_ALLOWED");
assert.equal(retryState.attempt_count, 2);
retryState = recordArc1GenerationAttempt(retryState, rejection);
assert.equal(retryState.status, "HALT_MANUAL_REVIEW");
assert.equal(retryState.attempt_count, ARC1_GENERATION_MAX_ATTEMPTS);
assert.throws(() => recordArc1GenerationAttempt(retryState, rejection), /terminal state/);

const acceptedEvaluation = evaluate(roofing, roofing.content, { generationRequest: retryRequest });
const acceptedState = recordArc1GenerationAttempt(createArc1GenerationRetryState(retryRequest), acceptedEvaluation);
assert.equal(acceptedState.status, "ACCEPTED");
assert.equal(acceptedState.attempt_count, 1);
assert.equal(acceptedState.accepted_candidate_sha256, acceptedEvaluation.candidate_sha256);
assert.equal(acceptedState.accepted_approval_content_sha256, acceptedEvaluation.approval_content_sha256);
assert.equal(acceptedState.accepted_page_count, 5);
assert.equal(acceptedState.accepted_total_html_bytes, acceptedEvaluation.total_html_bytes);

const oversizedAcceptedEvaluation = clone(acceptedEvaluation);
oversizedAcceptedEvaluation.total_html_bytes = ARC1_GENERATION_MAX_TOTAL_HTML_BYTES + 1;
delete oversizedAcceptedEvaluation.evaluation_sha256;
oversizedAcceptedEvaluation.evaluation_sha256 = sha256(canonicalJson(oversizedAcceptedEvaluation));
assert.throws(
  () => recordArc1GenerationAttempt(createArc1GenerationRetryState(retryRequest), oversizedAcceptedEvaluation),
  /evaluation contract mismatch/,
  "a re-digested evaluation above the five-page production cap must fail closed"
);

const wrongPageCountEvaluation = clone(acceptedEvaluation);
wrongPageCountEvaluation.page_count = 4;
delete wrongPageCountEvaluation.evaluation_sha256;
wrongPageCountEvaluation.evaluation_sha256 = sha256(canonicalJson(wrongPageCountEvaluation));
assert.throws(
  () => recordArc1GenerationAttempt(createArc1GenerationRetryState(retryRequest), wrongPageCountEvaluation),
  /evaluation contract mismatch/,
  "a re-digested evaluation without exactly five pages must fail closed"
);

const tamperedState = clone(createArc1GenerationRetryState(retryRequest));
tamperedState.attempt_count = 2;
assert.throws(() => recordArc1GenerationAttempt(tamperedState, rejection), /state contract mismatch/);
const semanticallyInvalidState = clone(createArc1GenerationRetryState(retryRequest));
semanticallyInvalidState.status = "RETRY_ALLOWED";
const { state_sha256: ignoredStateDigest, ...semanticallyInvalidCore } = semanticallyInvalidState;
void ignoredStateDigest;
semanticallyInvalidState.state_sha256 = sha256(canonicalJson(semanticallyInvalidCore));
assert.throws(() => recordArc1GenerationAttempt(semanticallyInvalidState, rejection), /state contract mismatch/);
const tamperedAcceptedState = clone(acceptedState);
tamperedAcceptedState.accepted_page_count = 4;
const { state_sha256: ignoredAcceptedStateDigest, ...tamperedAcceptedStateCore } = tamperedAcceptedState;
void ignoredAcceptedStateDigest;
tamperedAcceptedState.state_sha256 = sha256(canonicalJson(tamperedAcceptedStateCore));
assert.throws(() => recordArc1GenerationAttempt(tamperedAcceptedState, rejection), /state contract mismatch/,
  "retry state must semantically bind the exact accepted five-page result");

const source = await readFile(new URL("../scripts/arc1_generation_contract.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /\bfetch\s*\(|node:https|node:http|XMLHttpRequest|WebSocket/);

console.log(`ARC1 generation v2 passed: ${allFixtures.length} profiles, exact 58-string schema, 95 v11 approval pages, canonical whole-site digests, and bounded ${ARC1_GENERATION_MAX_ATTEMPTS}-attempt halt`);
