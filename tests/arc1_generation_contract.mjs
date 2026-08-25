import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixtures } from "../fixtures/v10_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v10_media_coverage.mjs";
import { REQUIRED_KEYS, loadMasterTemplate } from "../scripts/arc_contract.mjs";
import {
  ARC1_GENERATION_CONTRACT_SHA256,
  ARC1_GENERATION_CONTRACT_VERSION,
  ARC1_GENERATION_EVALUATION_VERSION,
  ARC1_GENERATION_INSTRUCTIONS,
  ARC1_GENERATION_INSTRUCTIONS_SHA256,
  ARC1_GENERATION_MAX_ATTEMPTS,
  ARC1_GENERATION_MAX_FIELD_BYTES,
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

const sha256 = value => createHash("sha256").update(String(value), "utf8").digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const allFixtures = [...fixtures, ...mediaCoverageFixtures];
const template = await loadMasterTemplate();

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
    renderOptions: { trustedEventPrefix: fixture.id }
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
assert.equal(ARC1_GENERATION_INSTRUCTIONS_SHA256, sha256(ARC1_GENERATION_INSTRUCTIONS));
assert.match(ARC1_GENERATION_CONTRACT_SHA256, /^[a-f0-9]{64}$/);
assert.equal(ARC1_GENERATION_CONTRACT_VERSION, "arc1-generation-contract-v1");
assert.equal(ARC1_GENERATION_REQUEST_VERSION, "arc1-generation-request-v1");
assert.equal(ARC1_GENERATION_EVALUATION_VERSION, "arc1-generation-evaluation-v1");
assert.equal(ARC1_GENERATION_RETRY_STATE_VERSION, "arc1-generation-retry-state-v1");
assert.equal(ARC1_GENERATION_MAX_ATTEMPTS, 3);
assert.equal(ARC1_PUBLIC_BRIEF_FIELDS.length, 34);
assert.equal(ARC1_PRIVATE_OR_OPERATIONAL_FIELDS.length, 9);

assert.equal(allFixtures.length, 19);
assert.deepEqual(new Set(allFixtures.map(item => item.expectedProfile)), new Set(ARC1_GENERATION_PROFILES));

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
assert.equal(deterministicLeft.request.authoritative_submission_data_sha256, projectionSubmissionSha256);
assert.equal(deterministicLeft.request.constraints.network_calls_allowed, false);
assert.equal(deterministicLeft.request.constraints.external_state_mutation_allowed, false);
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
  const generationRequest = requestFor(fixture);
  const result = evaluate(fixture, JSON.stringify(fixture.content), { generationRequest });
  assert.equal(result.status, "ACCEPTED", `${fixture.expectedProfile} failed with ${result.code}`);
  assert.equal(result.code, "OK");
  assert.equal(result.expected_media_profile, fixture.expectedProfile);
  assert.equal(result.observed_media_profile, fixture.expectedProfile);
  assert.match(result.approval_content_sha256, /^[a-f0-9]{64}$/);
  assert.match(result.evaluation_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.request_sha256, generationRequest.request_sha256);
  assert.equal(result.authoritative_submission_data_sha256, generationRequest.request.authoritative_submission_data_sha256);
  assert.deepEqual(result, evaluate(fixture, JSON.stringify(fixture.content), { generationRequest }),
    `${fixture.expectedProfile} evaluation must be deterministic`);
}

const roofing = fixtures[0];
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

const retryRequest = requestFor(roofing);
const rejection = evaluate(roofing, "{not-json", { generationRequest: retryRequest });
let retryState = createArc1GenerationRetryState(retryRequest);
assert.equal(retryState.status, "PENDING");
assert.equal(retryState.authoritative_submission_data_sha256, retryRequest.request.authoritative_submission_data_sha256);
assert.equal(retryState.expected_media_profile, "roofing");
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

const tamperedState = clone(createArc1GenerationRetryState(retryRequest));
tamperedState.attempt_count = 2;
assert.throws(() => recordArc1GenerationAttempt(tamperedState, rejection), /state contract mismatch/);
const semanticallyInvalidState = clone(createArc1GenerationRetryState(retryRequest));
semanticallyInvalidState.status = "RETRY_ALLOWED";
const { state_sha256: ignoredStateDigest, ...semanticallyInvalidCore } = semanticallyInvalidState;
void ignoredStateDigest;
semanticallyInvalidState.state_sha256 = sha256(canonicalJson(semanticallyInvalidCore));
assert.throws(() => recordArc1GenerationAttempt(semanticallyInvalidState, rejection), /state contract mismatch/);

const source = await readFile(new URL("../scripts/arc1_generation_contract.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /\bfetch\s*\(|node:https|node:http|XMLHttpRequest|WebSocket/);

console.log(`ARC1 generation contract passed: ${allFixtures.length} profiles, exact 58-string schema, deterministic offline request/evaluation, bounded ${ARC1_GENERATION_MAX_ATTEMPTS}-attempt halt`);
