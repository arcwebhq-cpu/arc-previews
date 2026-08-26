import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixtures } from '../fixtures/v11_industries.mjs';
import { createTestPaymentLinkEvidence } from './fixtures/payment_link_evidence.mjs';

const verifierSource = await readFile(new URL('../zapier/arc1_verify_function_intake.js', import.meta.url), 'utf8');
const ackSource = await readFile(new URL('../zapier/arc1_ack_function_intake.js', import.meta.url), 'utf8');
const assetConsumerSource = await readFile(new URL('../zapier/arc1_retrieve_function_assets.js', import.meta.url), 'utf8');
const assetPublisherSource = await readFile(new URL('../zapier/arc1_publish_function_assets.js', import.meta.url), 'utf8');
const injectorSource = await readFile(new URL('../zapier/arc1_inject.js', import.meta.url), 'utf8');
const publisherSource = await readFile(new URL('../zapier/arc1_publish_preview_pr.js', import.meta.url), 'utf8');
const mergeSource = await readFile(new URL('../zapier/arc1_merge_preview_pr.js', import.meta.url), 'utf8');
const emailGateSource = await readFile(new URL('../zapier/arc1_preview_email_gate.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runVerifier = new AsyncFunction('inputData', 'fetch', 'Buffer', verifierSource);
const runAck = new AsyncFunction('inputData', 'fetch', 'Buffer', ackSource);
const runAssetConsumer = new AsyncFunction('inputData', 'fetch', 'Buffer', assetConsumerSource);
const runAssetPublisher = new AsyncFunction('inputData', 'fetch', 'Buffer', assetPublisherSource);
const runInjector = new AsyncFunction('inputData', injectorSource);
const runPublisher = new AsyncFunction('inputData', 'fetch', 'Buffer', publisherSource);
const runMerge = new AsyncFunction('inputData', 'fetch', 'Buffer', mergeSource);
const runEmailGate = new AsyncFunction('inputData', 'fetch', 'Buffer', emailGateSource);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
const canonicalJson = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};
const logicalPagePaths = ['index.html', 'services/index.html', 'about/index.html', 'process/index.html', 'contact/index.html'];
const artifactPagePaths = ['about/index.html', 'contact/index.html', 'process/index.html', 'services/index.html', 'index.html'];

const contractSha256 = 'c4ab396bf04464629624dd19a37602755c8d429db0bf729b49bbfdfdba3ae20c';
const siteId = '8f9d462c-952f-42fc-a3a0-50a2529e8f5d';
const submissionId = '11111111-1111-4111-8111-111111111111';
const bridgeSecret = 'bridge-evidence-secret-unique-0123456789';
const intakeSecret = 'intake-evidence-secret-unique-0123456789';
const bearer = 'destination-bearer-unique-0123456789';
const ackSecret = 'consumer-ack-secret-unique-0123456789';
const assetReceiptSecret = 'asset-receipt-secret-unique-0123456789';
const assetPublicationSecret = 'asset-publication-secret-unique-0123456789';
const assetBearer = 'asset-retrieval-bearer-unique-0123456789';
const assetEndpoint = 'https://arcweb.onl/internal/intake/arc1/assets/retrieve';
const now = Date.now();
const receivedAt = new Date(now - 60_000).toISOString();
const evidenceIssuedAt = new Date(now - 30_000).toISOString();
const evidenceExpiresAt = new Date(now + 60 * 60_000).toISOString();
const offerContractId = 'arc-fixed-five-page-offer-v1';
const budget = 'Yes, understands the finished ARC website is a fixed five-page website with a $5,000 subtotal plus applicable sales tax only after preview approval';
const terms = 'Accepted ARC preview terms, privacy policy, refund policy, and fixed five-page service scope dated 2026-08-25; separate adult checkout acceptance required';
const data = {
  budget_confirmed: budget,
  business: 'Private Test Roofing',
  city: 'Everett, WA',
  email: 'private-owner@example.test',
  goals: ['More calls'],
  industry: 'Roofing',
  intake_version: 'arc-intake-v8',
  offer_contract_id: offerContractId,
  main_call_to_action: 'Request Estimate',
  main_services: 'Roof replacement',
  name: 'Private Test Owner',
  lead_notification_email: 'private-leads@example.test',
  public_email: 'hello@private-test-roofing.example',
  referrer_host: 'private-referrer.example',
  terms_accepted: terms,
  utm_source: 'private-campaign-attribution',
};
const assetManifest = [];
const submissionDataSha256 = sha256(canonicalJson({ data, asset_manifest: assetManifest }));
const evidence = {
  version: 1,
  scope: 'authenticated-first-party-arc-intake',
  bridge_contract_sha256: contractSha256,
  source_schema: 'arc-intake-function-submission-v1',
  site_id_sha256: sha256(siteId),
  source_form_name: 'arc-preview-function-v1',
  source_key_hmac_sha256: 'a'.repeat(64),
  delivery_id: 'b'.repeat(64),
  submission_id: submissionId,
  received_at: receivedAt,
  submission_data_sha256: submissionDataSha256,
  data,
  asset_manifest: assetManifest,
  asset_retrieval_endpoint: assetEndpoint,
  evidence_issued_at: evidenceIssuedAt,
  evidence_expires_at: evidenceExpiresAt,
};
const evidenceRaw = canonicalJson(evidence);
const envelope = {
  schema: 'arc-intake-arc1-bridge-envelope-v1', evidence,
  hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${evidenceRaw}`),
};
const envelopeRaw = canonicalJson(envelope);
const input = {
  bridge_envelope_json: envelopeRaw,
  bridge_destination_bearer: bearer,
  expected_bridge_destination_bearer: bearer,
  bridge_evidence_secret: bridgeSecret,
  intake_evidence_secret: intakeSecret,
  expected_netlify_site_id: siteId,
};

const issued = await runVerifier(input, async () => { throw new Error('Verifier must not use the network.'); }, Buffer);
await new Promise(resolve => setTimeout(resolve, 5));
const issuedReplay = await runVerifier(input, async () => { throw new Error('Verifier must not use the network.'); }, Buffer);
for (const field of ['ingress_state_key', 'ingress_state_digest_sha256', 'intake_evidence_private', 'intake_evidence_hmac_sha256', 'intake_evidence_sha256']) {
  assert.equal(issuedReplay[field], issued[field], `${field} must be deterministic across exact envelope replay.`);
}
assert.equal(issued.status, 'ARC1_FUNCTION_INTAKE_VERIFIED');
assert.equal(issued.build_allowed_by_this_step, false);
assert.equal(issued.acknowledgement_allowed_by_this_step, false);
assert.equal(issued.bridge_contract_sha256, contractSha256);
assert.equal(issued.bridge_delivery_id, evidence.delivery_id);
assert.equal(issued.bridge_evidence_sha256, sha256(evidenceRaw));
const expectedPublicContent = {
  business: data.business,
  city: data.city,
  goals: data.goals,
  industry: data.industry,
  main_call_to_action: data.main_call_to_action,
  main_services: data.main_services,
  public_email: data.public_email,
};
assert.deepEqual(issued.submission_data, expectedPublicContent);
assert.equal(issued.submission_data_json, canonicalJson(expectedPublicContent));
for (const privateField of [
  'budget_confirmed', 'email', 'intake_version', 'name', 'lead_notification_email', 'offer_contract_id',
  'referrer_host', 'terms_accepted', 'utm_source',
]) {
  assert.equal(Object.hasOwn(issued.submission_data, privateField), false, `${privateField} must not enter the generator projection.`);
}
assert.equal(issued.trusted_netlify_submission_id, submissionId);
assert.match(issued.public_folder_prefix, /^[a-f0-9]{8}$/);
assert.equal(issued.asset_manifest_sha256, sha256('[]'));
assert.equal(issued.asset_retrieval_endpoint, assetEndpoint);
assert.match(issued.ingress_state_key, /^arc1-function-ingress-v1:[a-f0-9]{64}$/);
const downstream = JSON.parse(issued.intake_evidence_private);
assert.equal(downstream.version, 'arc1-intake-evidence-v2');
assert.equal(downstream.scope, 'authoritative-first-party-function-intake');
assert.equal(downstream.intake_version, 'arc-intake-v8');
assert.equal(downstream.offer_contract_id, offerContractId);
assert.equal(downstream.budget_confirmed, budget);
assert.equal(downstream.terms_accepted, terms);
assert.equal(downstream.site_id_sha256, sha256(siteId));
assert.equal(downstream.delivery_id, evidence.delivery_id);
assert.equal(
  issued.intake_evidence_hmac_sha256,
  hmac(intakeSecret, `arc1-intake-evidence-signature-v2\n${issued.intake_evidence_private}`),
);

// The existing injector and publisher must accept the exact v2 evidence only
// after the normal create-only ARC1 claim, without pretending it was a Form.
const template = await readFile(new URL('../ARC_MASTER_TEMPLATE_V11.html', import.meta.url), 'utf8');
const payment = createTestPaymentLinkEvidence();
const fixture = fixtures[0];
assert.equal(Object.keys(fixture.content).length, 58, 'The V11 migration must preserve the exact 58-key generator contract.');
const claimCreatedAtForBuild = new Date().toISOString();
const claimInputs = {
  intake_claim_status: 'CLAIMED',
  intake_claim_state_key: issued.state_key,
  intake_claim_state_digest_sha256: issued.state_digest_sha256,
  intake_claim_evidence_sha256: issued.intake_evidence_sha256,
  intake_claim_public_folder_prefix: issued.public_folder_prefix,
  intake_claim_asset_manifest_sha256: issued.asset_manifest_sha256,
  intake_claim_existing_preview_folder: '',
  intake_claim_created_at: claimCreatedAtForBuild,
};
const emptyAssetReceipt = await runAssetConsumer({
  bridge_contract_sha256: contractSha256, bridge_delivery_id: issued.bridge_delivery_id,
  bridge_evidence_sha256: issued.bridge_evidence_sha256, asset_retrieval_endpoint: assetEndpoint,
  private_asset_grants_json: '[]', private_asset_grants_sha256: sha256('[]'),
  asset_retrieval_bearer: assetBearer, asset_receipt_secret: assetReceiptSecret,
  asset_folder_origin_allowlist_json: JSON.stringify(['https://drive.google.com']),
}, async () => { throw new Error('An empty grant list must not access the network.'); }, Buffer);
const publishedEmptyAssets = await runAssetPublisher({
  github_token: 'mock-github-token', github_owner: 'arcwebhq-cpu', github_repo: 'arc-previews', github_base_branch: 'main',
  pages_base_url: 'https://arcwebhq-cpu.github.io/arc-previews', raw_json: JSON.stringify(fixture.content),
  intake_evidence_secret: intakeSecret, intake_evidence_private: issued.intake_evidence_private,
  intake_evidence_hmac_sha256: issued.intake_evidence_hmac_sha256, intake_evidence_sha256: issued.intake_evidence_sha256,
  asset_receipt_secret: assetReceiptSecret, asset_receipt_private: emptyAssetReceipt.asset_receipt_private,
  asset_receipt_hmac_sha256: emptyAssetReceipt.asset_receipt_hmac_sha256, asset_receipt_sha256: emptyAssetReceipt.asset_receipt_sha256,
  asset_payloads_private_json: emptyAssetReceipt.asset_payloads_private_json, asset_publication_receipt_secret: assetPublicationSecret,
  ingress_state_key: issued.ingress_state_key, ingress_state_digest_sha256: issued.ingress_state_digest_sha256,
  ingress_claim_mode: 'CREATED', ingress_claim_status: 'CLAIMED', ingress_claim_state_key: issued.ingress_state_key,
  ingress_claim_state_digest_sha256: issued.ingress_state_digest_sha256, ingress_claim_bridge_delivery_id: issued.bridge_delivery_id,
  ingress_claim_bridge_evidence_sha256: issued.bridge_evidence_sha256,
  ingress_claim_asset_receipt_sha256: emptyAssetReceipt.asset_receipt_sha256, ingress_claim_created_at: new Date().toISOString(),
  ...claimInputs,
}, async () => { throw new Error('No-upload publication must not access GitHub.'); }, Buffer);
const emptyReceiptInputs = {
  asset_publication_receipt_secret: assetPublicationSecret,
  asset_publication_receipt_private: publishedEmptyAssets.asset_publication_receipt_private,
  asset_publication_receipt_hmac_sha256: publishedEmptyAssets.asset_publication_receipt_hmac_sha256,
  asset_publication_receipt_sha256: publishedEmptyAssets.asset_publication_receipt_sha256,
  ingress_claim_asset_receipt_sha256: emptyAssetReceipt.asset_receipt_sha256,
};
const injectorInputs = {
  template_content: template,
  raw_json: JSON.stringify(fixture.content),
  customer_email: fixture.customerEmail,
  private_claim_recipient_email: fixture.customerEmail,
  checkout_binding_secret: 'checkout-binding-secret-unique-0123456789',
  checkout_binding_key_id: '01',
  private_lead_notification_email: 'leads@example.test',
  expected_netlify_site_id: siteId,
  expected_netlify_form_id: '6a483964f58804000839c2de',
  expected_netlify_form_name: 'arc-preview',
  intake_evidence_secret: intakeSecret,
  intake_evidence_private: issued.intake_evidence_private,
  intake_evidence_hmac_sha256: issued.intake_evidence_hmac_sha256,
  logo_file_url: '', hero_image_url: '', supporting_image_url: '',
  ...emptyReceiptInputs,
  ...claimInputs,
  ...payment.privateInputs,
};
const rendered = await runInjector(injectorInputs);
assert.equal(rendered.trusted_event_prefix, issued.public_folder_prefix);
assert.equal(rendered.trusted_netlify_submission_id, submissionId);
assert.equal(rendered.intake_evidence_sha256, issued.intake_evidence_sha256);
assert.equal(rendered.intake_state_key, issued.state_key);
assert.equal(rendered.validated_asset_manifest, '[]');
assert.equal(rendered.asset_publication_receipt_sha256, publishedEmptyAssets.asset_publication_receipt_sha256);
assert.equal(JSON.parse(rendered.render_evidence_private).asset_publication_receipt_sha256,
  publishedEmptyAssets.asset_publication_receipt_sha256,
  'NO_PUBLIC_UPLOADS must remain exactly bound from publication through render evidence.');
assert.equal(rendered.page_count, 5);
assert.deepEqual(rendered.preview_paths, artifactPagePaths.map(path => `${rendered.preview_folder}/${path}`));
assert.deepEqual(JSON.parse(rendered.render_bundle_private).logical_page_paths, logicalPagePaths);
for (const legacy of ['html_content', 'file_path', 'preview_path']) {
  assert.equal(Object.hasOwn(rendered, legacy), false, `V11 injector output must not expose legacy ${legacy}.`);
}

const previewInputFor = ({ verified, renderedOutput, receiptInputs, claim, assetUrls = {} }) => ({
  github_token: 'mock-github-token', github_owner: 'arcwebhq-cpu', github_repo: 'arc-previews', github_base_branch: 'main',
  pages_base_url: 'https://arcwebhq-cpu.github.io/arc-previews', validation_pass: true,
  trusted_event_prefix: renderedOutput.trusted_event_prefix, preview_folder: renderedOutput.preview_folder,
  render_bundle_private: renderedOutput.render_bundle_private, render_bundle_sha256: renderedOutput.render_bundle_sha256,
  render_content_sha256: renderedOutput.render_content_sha256, script_manifest_sha256: renderedOutput.script_manifest_sha256,
  checkout_offer_snapshot_private: renderedOutput.checkout_offer_snapshot_private,
  checkout_offer_snapshot_sha256: renderedOutput.checkout_offer_snapshot_sha256,
  checkout_offer_snapshot_hmac_sha256: renderedOutput.checkout_offer_snapshot_hmac_sha256,
  checkout_recipient_reservation_private: renderedOutput.checkout_recipient_reservation_private,
  checkout_recipient_reservation_sha256: renderedOutput.checkout_recipient_reservation_sha256,
  checkout_recipient_reservation_hmac_sha256: renderedOutput.checkout_recipient_reservation_hmac_sha256,
  checkout_binding_key_id: '01', checkout_binding_secret: 'checkout-binding-secret-unique-0123456789',
  retired_checkout_binding_keys_json: '{}', customer_email: fixture.customerEmail,
  private_claim_recipient_email: fixture.customerEmail, private_lead_notification_email: 'leads@example.test',
  intake_evidence_secret: intakeSecret, intake_evidence_private: verified.intake_evidence_private,
  intake_evidence_hmac_sha256: verified.intake_evidence_hmac_sha256,
  intake_evidence_sha256: renderedOutput.intake_evidence_sha256,
  intake_state_key: renderedOutput.intake_state_key, intake_state_digest_sha256: renderedOutput.intake_state_digest_sha256,
  submission_data_sha256: renderedOutput.submission_data_sha256,
  asset_manifest_sha256: renderedOutput.asset_manifest_sha256,
  validated_asset_manifest: renderedOutput.validated_asset_manifest,
  render_evidence_private: renderedOutput.render_evidence_private,
  render_evidence_hmac_sha256: renderedOutput.render_evidence_hmac_sha256,
  ...assetUrls, ...receiptInputs, ...claim,
});
const emptyPreviewInput = previewInputFor({
  verified: issued, renderedOutput: rendered, receiptInputs: emptyReceiptInputs, claim: claimInputs,
  assetUrls: { logo_file_url: '', hero_image_url: '', supporting_image_url: '' },
});

const encodedPrivacyCases = [
  ['requester email', 'customer_email', fixture.customerEmail],
  ['private phone', 'private_contact_phone', '+1 (425) 555-0199'],
  ['private address', 'private_contact_address', '123 Private Lane, Everett WA 98201'],
];
for (const [label, inputField, privateValue] of encodedPrivacyCases) {
  const encoded = encodeURIComponent(encodeURIComponent(privateValue));
  await assert.rejects(runInjector({
    ...injectorInputs,
    [inputField]: privateValue,
    raw_json: JSON.stringify({
      ...fixture.content,
      ABOUT_BODY: `${fixture.content.ABOUT_BODY}<p><a href="https://example.test/path?next=${encoded}#${encoded}">Details</a></p>`,
    }),
  }), /ARC_PRIVACY_FAILED/, `${label} must be rejected after recursive URL decoding before render evidence is signed.`);
}
let privacyPublisherNetworkCalls = 0;
await assert.rejects(runPublisher({ ...emptyPreviewInput, customer_email: fixture.content.BUSINESS_NAME }, async () => {
  privacyPublisherNetworkCalls += 1;
  throw new Error('Privacy rejection must precede GitHub access.');
}, Buffer), /ARC_PRIVACY_FAILED/, 'The publisher must independently reject private data in any page before GitHub access.');
assert.equal(privacyPublisherNetworkCalls, 0);

let publisherReachedGitHub = false;
await assert.rejects(runPublisher(emptyPreviewInput, async url => {
  publisherReachedGitHub = true;
  const response = new Response(JSON.stringify({ message: 'expected test stop' }), {
    status: 500, headers: { 'content-type': 'application/json' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}, Buffer), /ARC_GITHUB_FAILED: 500/);
assert.equal(publisherReachedGitHub, true, 'Publisher must fully validate the V11 bundle and v2 evidence before the first GitHub read.');

await assert.rejects(runVerifier({ ...input, bridge_destination_bearer: 'wrong-secret-that-is-long-enough-0123456789' }, null, Buffer), /bearer mismatch/);
await assert.rejects(runVerifier({ ...input, bridge_envelope_json: envelopeRaw.replace('Private Test Roofing', 'Tampered Roofing') }, null, Buffer), /HMAC mismatch/);
const oldConsentEvidence = { ...evidence, data: { ...data, budget_confirmed: 'Yes, understands the finished ARC website is $5,000 only after preview approval' } };
oldConsentEvidence.submission_data_sha256 = sha256(canonicalJson({ data: oldConsentEvidence.data, asset_manifest: [] }));
const oldConsentRaw = canonicalJson(oldConsentEvidence);
const oldConsentEnvelope = canonicalJson({
  schema: envelope.schema, evidence: oldConsentEvidence,
  hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${oldConsentRaw}`),
});
await assert.rejects(runVerifier({ ...input, bridge_envelope_json: oldConsentEnvelope }, null, Buffer), /consent mismatch/,
  'The old tax-omitting disclosure must not be accepted as current consent.');
const wrongOfferEvidence = { ...evidence, data: { ...data, offer_contract_id: 'arc-fixed-five-page-offer-v0' } };
wrongOfferEvidence.submission_data_sha256 = sha256(canonicalJson({ data: wrongOfferEvidence.data, asset_manifest: [] }));
const wrongOfferRaw = canonicalJson(wrongOfferEvidence);
const wrongOfferEnvelope = canonicalJson({
  schema: envelope.schema, evidence: wrongOfferEvidence,
  hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${wrongOfferRaw}`),
});
await assert.rejects(runVerifier({ ...input, bridge_envelope_json: wrongOfferEnvelope }, null, Buffer), /consent mismatch/,
  'A different fixed-offer contract must fail closed even when the bridge envelope is correctly signed.');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89', 'base64');
const withAssetManifest = [{
  schema: 'arc-intake-private-asset-grant-v1', asset_id: 'e'.repeat(64), kind: 'UPLOAD', role: 'logo_file',
  content_type: 'image/png', size: png.length, sha256: sha256(png), retrieval_endpoint_sha256: sha256(assetEndpoint),
}];
const withAssetData = { ...data, asset_permission: 'Confirmed' };
const withAssetEvidence = {
  ...evidence,
  data: withAssetData,
  asset_manifest: withAssetManifest,
  submission_data_sha256: sha256(canonicalJson({ data: withAssetData, asset_manifest: withAssetManifest })),
};
const withAssetRaw = canonicalJson(withAssetEvidence);
const withAssetEnvelope = canonicalJson({
  schema: envelope.schema, evidence: withAssetEvidence,
  hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${withAssetRaw}`),
});
const verifiedAssetEnvelope = await runVerifier({ ...input, bridge_envelope_json: withAssetEnvelope }, null, Buffer);
assert.equal(verifiedAssetEnvelope.asset_manifest[0].asset_id, 'e'.repeat(64));
assert.equal(Object.hasOwn(JSON.parse(withAssetEnvelope).evidence, 'assets'), false, 'Bridge evidence must contain no inline asset bytes.');
const folderLink = 'https://drive.google.com/drive/folders/private?resourcekey=opaque';
const withFolderData = { ...data, asset_permission: 'Confirmed' };
const folderGrant = {
  schema: 'arc-intake-private-asset-grant-v1', asset_id: 'f'.repeat(64), kind: 'FOLDER_LINK', role: 'asset_folder_link',
  content_type: 'text/uri-list', size: Buffer.byteLength(folderLink), sha256: sha256(folderLink), retrieval_endpoint_sha256: sha256(assetEndpoint),
};
const withFolderEvidence = {
  ...evidence, data: withFolderData, asset_manifest: [folderGrant],
  submission_data_sha256: sha256(canonicalJson({ data: withFolderData, asset_manifest: [folderGrant] })),
};
const withFolderRaw = canonicalJson(withFolderEvidence);
const withFolderEnvelope = canonicalJson({
  schema: envelope.schema, evidence: withFolderEvidence,
  hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${withFolderRaw}`),
});
let folderVerifierNetworkCalls = 0;
let folderDurableClaimMutations = 0;
let folderAcknowledgementCalls = 0;
const runFolderPipeline = async () => {
  const verified = await runVerifier({ ...input, bridge_envelope_json: withFolderEnvelope }, async () => {
    folderVerifierNetworkCalls += 1;
    throw new Error('Folder rejection must precede all network access.');
  }, Buffer);
  // These counters model the next two durable orchestration actions. They can
  // increment only if the verifier incorrectly returns a claim-capable result.
  folderDurableClaimMutations += 1;
  folderAcknowledgementCalls += 1;
  return verified;
};
await assert.rejects(runFolderPipeline(), /FOLDER_LINK|folder links require a private provider adapter/,
  'Folder-only intake must fail closed before any durable state or ACK action.');
assert.equal(folderVerifierNetworkCalls, 0);
assert.equal(folderDurableClaimMutations, 0, 'Folder-only intake must make zero durable claim mutations.');
assert.equal(folderAcknowledgementCalls, 0, 'Folder-only intake must produce no acknowledgement.');

const bodyResponse = (bytes, grant) => {
  const headers = new Headers({
    'content-type': grant.content_type, 'content-length': String(bytes.length), 'x-arc-asset-id': grant.asset_id,
    'x-arc-asset-kind': grant.kind, 'x-arc-asset-role': grant.role, 'x-arc-asset-sha256': grant.sha256,
  });
  const response = new Response(bytes, { status: 200, headers });
  Object.defineProperty(response, 'url', { value: assetEndpoint });
  return response;
};
const assetInput = (verified, grants) => ({
  bridge_contract_sha256: contractSha256, bridge_delivery_id: verified.bridge_delivery_id,
  bridge_evidence_sha256: verified.bridge_evidence_sha256, asset_retrieval_endpoint: assetEndpoint,
  private_asset_grants_json: canonicalJson(grants), private_asset_grants_sha256: sha256(canonicalJson(grants)),
  asset_retrieval_bearer: assetBearer, asset_receipt_secret: assetReceiptSecret,
  asset_folder_origin_allowlist_json: JSON.stringify(['https://drive.google.com']),
});
let uploadRetrievals = 0;
const retrievedUpload = await runAssetConsumer(assetInput(verifiedAssetEnvelope, withAssetManifest), async (url, options) => {
  uploadRetrievals += 1;
  assert.equal(url, assetEndpoint); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${assetBearer}`);
  assert.deepEqual(JSON.parse(options.body), { schema: 'arc-intake-private-asset-request-v1', asset_id: 'e'.repeat(64),
    delivery_id: verifiedAssetEnvelope.bridge_delivery_id, evidence_sha256: verifiedAssetEnvelope.bridge_evidence_sha256 });
  assert.doesNotMatch(`${url}\n${JSON.stringify(options.headers)}\n${options.body}`, /private-owner|Private Test Roofing/);
  return bodyResponse(png, withAssetManifest[0]);
}, Buffer);
assert.equal(retrievedUpload.status, 'ARC1_PRIVATE_ASSETS_VERIFIED');
assert.equal(JSON.parse(retrievedUpload.asset_payloads_private_json)[0].content_base64, png.toString('base64'));
const replayedUpload = await runAssetConsumer(assetInput(verifiedAssetEnvelope, withAssetManifest), async () => bodyResponse(png, withAssetManifest[0]), Buffer);
assert.equal(replayedUpload.asset_receipt_private, retrievedUpload.asset_receipt_private, 'Exact replay must issue an identical asset receipt.');
assert.equal(uploadRetrievals, 1);
let folderRetrievalCalls = 0;
await assert.rejects(runAssetConsumer(assetInput(issued, [folderGrant]), async () => {
  folderRetrievalCalls += 1;
  return bodyResponse(Buffer.from(folderLink), folderGrant);
}, Buffer), /folder links require a private provider adapter/,
'The retriever must independently reject a folder grant before fetching private bytes.');
assert.equal(folderRetrievalCalls, 0, 'Folder rejection must precede private provider access.');
const tamperedPng = Buffer.from(png); tamperedPng[tamperedPng.length - 1] ^= 1;
await assert.rejects(runAssetConsumer(assetInput(verifiedAssetEnvelope, withAssetManifest), async () =>
  bodyResponse(tamperedPng, withAssetManifest[0]), Buffer), /digest mismatch/);
await assert.rejects(runAssetConsumer(assetInput(verifiedAssetEnvelope, withAssetManifest), async () =>
  new Response(null, { status: 404 }), Buffer), /retrieval response binding/);
let cancelled = false;
const oversizedStream = new ReadableStream({
  start(controller) { controller.enqueue(new Uint8Array(png)); controller.enqueue(new Uint8Array([1])); },
  cancel() { cancelled = true; },
});
await assert.rejects(runAssetConsumer(assetInput(verifiedAssetEnvelope, withAssetManifest), async () => {
  const response = new Response(oversizedStream, { status: 200, headers: {
    'content-type': 'image/png', 'x-arc-asset-id': withAssetManifest[0].asset_id, 'x-arc-asset-kind': 'UPLOAD',
    'x-arc-asset-role': 'logo_file', 'x-arc-asset-sha256': withAssetManifest[0].sha256,
  } }); Object.defineProperty(response, 'url', { value: assetEndpoint }); return response;
}, Buffer), /exceeds immutable size/);
assert.equal(cancelled, true, 'Oversized chunked asset retrieval must be cancelled immediately.');
// Private retrieval must flow through a create-only, content-addressed Git
// publication before either injector or preview publisher accepts an upload.
const makeGitHubMock = () => {
  const baseCommit = '1'.repeat(40), baseTree = '2'.repeat(40);
  let sequence = 10;
  const nextSha = () => (sequence++).toString(16).padStart(40, '0');
  const state = {
    refs: new Map([['main', baseCommit]]), commits: new Map([[baseCommit, baseTree]]), trees: new Map(), blobs: new Map(),
    pulls: [], calls: [], extraAsset: false, extraFolderSibling: false, checkRuns: [], prFiles: null, claimRefs: new Map(),
    pagesReadbacks: [], contentReadbacks: [], pagesTamperPath: '', extraRouteFile: '',
  };
  let currentResponseUrl = '';
  const response = (status, body) => {
    const payload = JSON.stringify(body);
    const result = new Response(payload, {
      status,
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) },
    });
    Object.defineProperty(result, 'url', { value: currentResponseUrl });
    return result;
  };
  const treeView = treeSha => {
    if (treeSha === baseTree) return { tree: [] };
    const direct = state.trees.get(treeSha);
    if (direct) {
      return { tree: [{ path: direct.previewFolder, type: 'tree', mode: '040000', sha: direct.folderSha }] };
    }
    for (const tree of state.trees.values()) {
      if (treeSha === tree.folderSha) {
        const items = [];
        if (tree.assets.size) items.push({ path: 'assets', type: 'tree', mode: '040000', sha: tree.assetsSha });
        for (const name of ['about', 'contact', 'process', 'services']) {
          if (tree.pages.has(`${name}/index.html`)) items.push({ path: name, type: 'tree', mode: '040000', sha: tree.pageDirectoryShas.get(name) });
        }
        const home = tree.pages.get('index.html');
        if (home) items.push({ path: 'index.html', type: 'blob', mode: '100644', sha: home.sha, size: home.size });
        if (state.extraFolderSibling) items.push({ path: 'unexpected.txt', type: 'blob', mode: '100644', sha: 'e'.repeat(40), size: 1 });
        return { tree: items };
      }
      if (treeSha === tree.assetsSha) {
        const items = [...tree.assets.values()].map(asset => ({ path: asset.name, type: 'blob', mode: '100644', sha: asset.sha, size: asset.size }));
        if (state.extraAsset) items.push({ path: 'unexpected.png', type: 'blob', mode: '100644', sha: 'f'.repeat(40), size: 1 });
        return { tree: items };
      }
      for (const [name, sha] of tree.pageDirectoryShas) {
        if (treeSha === sha) {
          const page = tree.pages.get(`${name}/index.html`);
          const items = page ? [{ path: 'index.html', type: 'blob', mode: '100644', sha: page.sha, size: page.size }] : [];
          if (state.extraRouteFile === name) items.push({ path: 'unexpected.html', type: 'blob', mode: '100644', sha: 'd'.repeat(40), size: 1 });
          return { tree: items };
        }
      }
    }
    return null;
  };
  const treeForRef = ref => state.trees.get(state.commits.get(state.refs.get(ref) || ref));
  const pageFor = (tree, repositoryPath) => {
    if (!tree || !repositoryPath.startsWith(`${tree.previewFolder}/`)) return null;
    return tree.pages.get(repositoryPath.slice(tree.previewFolder.length + 1)) || null;
  };
  const exactPrFiles = () => {
    const pull = state.pulls[0], tree = treeForRef(pull?.head?.ref || '');
    if (!tree) return [];
    return [
      ...artifactPagePaths.filter(path => tree.pages.has(path)).map(path => ({ filename: `${tree.previewFolder}/${path}`, status: 'added' })),
      ...[...tree.assets.values()].map(asset => ({ filename: `${tree.previewFolder}/assets/${asset.name}`, status: 'added' })),
    ];
  };
  const fetch = async (url, options = {}) => {
    currentResponseUrl = url;
    const method = String(options.method || 'GET').toUpperCase();
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    const bodyText = String(options.body || '');
    state.calls.push({ method, url, body: bodyText });
    if (parsed.hostname === 'arcwebhq-cpu.github.io') {
      const tree = treeForRef('main');
      let relative = path.replace(/^\/arc-previews\//, '');
      if (relative.endsWith('/')) relative += 'index.html';
      const page = pageFor(tree, relative);
      const assetName = relative.startsWith(`${tree?.previewFolder}/assets/`) ? relative.split('/').at(-1) : '';
      const asset = assetName ? tree?.assets.get(assetName) : null;
      let bytes = page?.bytes || (asset && state.blobs.get(asset.sha)) || null;
      if (page) {
        const logicalPath = relative.slice(tree.previewFolder.length + 1);
        state.pagesReadbacks.push(logicalPath);
        if (state.pagesTamperPath === logicalPath) bytes = Buffer.concat([bytes, Buffer.from('tamper')]);
      }
      const type = page ? 'text/html' : assetName.endsWith('.png') ? 'image/png' : assetName.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
      const result = new Response(bytes, { status: bytes ? 200 : 404, headers: { 'content-type': type, 'content-length': String(bytes?.length || 0) } });
      Object.defineProperty(result, 'url', { value: url }); return result;
    }
    if (method === 'GET' && path.includes('/check-runs')) return response(200, { check_runs: state.checkRuns });
    if (method === 'POST' && parsed.pathname === '/graphql') {
      const pr = state.pulls[0]; pr.draft = false;
      return response(200, { data: { markPullRequestReadyForReview: { pullRequest: {
        number: pr.number, isDraft: false, headRefOid: pr.head.sha,
      } } } });
    }
    const filesMatch = path.match(/\/pulls\/(\d+)\/files$/);
    if (method === 'GET' && filesMatch) return response(200, state.prFiles || exactPrFiles());
    const mergeMatch = path.match(/\/pulls\/(\d+)\/merge$/);
    if (method === 'PUT' && mergeMatch) {
      const pr = state.pulls[0], body = JSON.parse(bodyText);
      if (body.sha !== pr.head.sha || body.merge_method !== 'squash') return response(409, {});
      const sha = nextSha(); state.commits.set(sha, state.commits.get(pr.head.sha)); state.refs.set('main', sha);
      pr.state = 'closed'; pr.draft = false; pr.merged_at = new Date().toISOString(); pr.merge_commit_sha = sha;
      return response(200, { merged: true, sha, message: 'Merged' });
    }
    const pullMatch = path.match(/\/pulls\/(\d+)$/);
    if (method === 'GET' && pullMatch) return state.pulls[0] ? response(200, state.pulls[0]) : response(404, {});
    if (method === 'POST' && path.endsWith('/git/refs') && JSON.parse(bodyText).ref?.startsWith('refs/tags/arc-preview-email/')) {
      const body = JSON.parse(bodyText), name = body.ref.replace(/^refs\//, '');
      if (state.claimRefs.has(name)) return response(422, {});
      state.claimRefs.set(name, body.sha); return response(201, { object: { sha: body.sha } });
    }
    if (method === 'GET' && path.includes('/git/ref/tags/arc-preview-email/')) {
      const name = path.split('/git/ref/')[1], sha = state.claimRefs.get(name);
      return sha ? response(200, { object: { sha } }) : response(404, {});
    }
    if (method === 'GET' && path.includes('/git/ref/heads/')) {
      const branch = path.split('/git/ref/heads/')[1];
      const sha = state.refs.get(branch);
      return sha ? response(200, { object: { sha } }) : response(404, { message: 'missing' });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      const commit = path.split('/git/commits/')[1];
      const tree = state.commits.get(commit);
      return tree ? response(200, { tree: { sha: tree } }) : response(404, {});
    }
    if (method === 'GET' && path.includes('/git/trees/')) {
      const tree = path.split('/git/trees/')[1];
      const view = treeView(tree);
      return view ? response(200, view) : response(404, {});
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      const body = JSON.parse(bodyText);
      const bytes = Buffer.from(body.content, body.encoding);
      const sha = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
      state.blobs.set(sha, bytes);
      return response(201, { sha });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      const body = JSON.parse(bodyText);
      const inherited = state.trees.get(body.base_tree);
      const assets = new Map(inherited ? inherited.assets : []);
      const pages = new Map(inherited ? inherited.pages : []);
      let previewFolder = inherited?.previewFolder || '';
      for (const item of body.tree || []) {
        const parts = String(item.path).split('/');
        previewFolder ||= parts[0];
        if (parts.length === 3 && parts[1] === 'assets') {
          const bytes = state.blobs.get(item.sha);
          assets.set(parts[2], { name: parts[2], sha: item.sha, size: bytes?.length });
        } else {
          const logicalPath = parts.slice(1).join('/');
          const bytes = state.blobs.get(item.sha);
          if (artifactPagePaths.includes(logicalPath)) pages.set(logicalPath, { sha: item.sha, size: bytes?.length, bytes });
        }
      }
      const sha = nextSha();
      state.trees.set(sha, {
        previewFolder, assets, pages, folderSha: nextSha(), assetsSha: nextSha(),
        pageDirectoryShas: new Map(['about', 'contact', 'process', 'services'].map(name => [name, nextSha()])),
      });
      return response(201, { sha });
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      const body = JSON.parse(bodyText), sha = nextSha();
      state.commits.set(sha, body.tree);
      return response(201, { sha });
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      const body = JSON.parse(bodyText), branch = body.ref.replace(/^refs\/heads\//, '');
      if (state.refs.has(branch)) return response(422, {});
      state.refs.set(branch, body.sha);
      return response(201, { object: { sha: body.sha } });
    }
    if (method === 'PATCH' && path.includes('/git/refs/heads/')) {
      const branch = path.split('/git/refs/heads/')[1], body = JSON.parse(bodyText);
      if (!state.refs.has(branch)) return response(404, {});
      state.refs.set(branch, body.sha);
      return response(200, { object: { sha: body.sha } });
    }
    if (method === 'GET' && path.includes('/contents/')) {
      const branchOrCommit = parsed.searchParams.get('ref');
      const tree = treeForRef(branchOrCommit);
      const repositoryPath = path.split('/contents/')[1];
      const page = pageFor(tree, repositoryPath);
      const assetName = repositoryPath.startsWith(`${tree?.previewFolder}/assets/`) ? repositoryPath.split('/').at(-1) : '';
      const asset = assetName ? tree?.assets.get(assetName) : null;
      const bytes = page?.bytes || (asset && state.blobs.get(asset.sha));
      state.contentReadbacks.push({ ref: branchOrCommit, repositoryPath });
      if (!bytes) return response(404, {});
      return response(200, { content: bytes.toString('base64') });
    }
    if (path.endsWith('/pulls') && method === 'GET') return response(200, state.pulls);
    if (path.endsWith('/pulls') && method === 'POST') {
      const body = JSON.parse(bodyText);
      const pr = { number: 7, node_id: 'PR_asset_7', html_url: 'https://github.com/arcwebhq-cpu/arc-previews/pull/7', state: 'open', draft: true,
        merged_at: null, merge_commit_sha: null, base: { ref: body.base }, head: { ref: body.head, sha: state.refs.get(body.head) } };
      state.pulls = [pr];
      return response(201, pr);
    }
    throw new Error(`Unexpected mocked GitHub request: ${method} ${url}`);
  };
  return { fetch, state };
};
const intakeClaimFor = verified => ({
  intake_claim_status: 'CLAIMED', intake_claim_state_key: verified.state_key,
  intake_claim_state_digest_sha256: verified.state_digest_sha256,
  intake_claim_evidence_sha256: verified.intake_evidence_sha256,
  intake_claim_public_folder_prefix: verified.public_folder_prefix,
  intake_claim_asset_manifest_sha256: verified.asset_manifest_sha256,
  intake_claim_existing_preview_folder: '', intake_claim_created_at: new Date().toISOString(),
});
const publicationInput = (verified, retrieved) => ({
  github_token: 'mock-github-token', github_owner: 'arcwebhq-cpu', github_repo: 'arc-previews', github_base_branch: 'main',
  pages_base_url: 'https://arcwebhq-cpu.github.io/arc-previews', raw_json: JSON.stringify(fixture.content),
  intake_evidence_secret: intakeSecret, intake_evidence_private: verified.intake_evidence_private,
  intake_evidence_hmac_sha256: verified.intake_evidence_hmac_sha256, intake_evidence_sha256: verified.intake_evidence_sha256,
  asset_receipt_secret: assetReceiptSecret, asset_receipt_private: retrieved.asset_receipt_private,
  asset_receipt_hmac_sha256: retrieved.asset_receipt_hmac_sha256, asset_receipt_sha256: retrieved.asset_receipt_sha256,
  asset_payloads_private_json: retrieved.asset_payloads_private_json, asset_publication_receipt_secret: assetPublicationSecret,
  ingress_state_key: verified.ingress_state_key, ingress_state_digest_sha256: verified.ingress_state_digest_sha256,
  ingress_claim_mode: 'CREATED', ingress_claim_status: 'CLAIMED', ingress_claim_state_key: verified.ingress_state_key,
  ingress_claim_state_digest_sha256: verified.ingress_state_digest_sha256,
  ingress_claim_bridge_delivery_id: verified.bridge_delivery_id,
  ingress_claim_bridge_evidence_sha256: verified.bridge_evidence_sha256,
  ingress_claim_asset_receipt_sha256: retrieved.asset_receipt_sha256, ingress_claim_created_at: new Date().toISOString(),
  ...intakeClaimFor(verified),
});
// A valid no-upload submission still gets a signed NO_PUBLIC_UPLOADS receipt;
// that exact empty receipt must survive PR, squash merge, Pages, and email.
assert.equal(publishedEmptyAssets.status, 'ARC1_FUNCTION_ASSETS_NONE');
const emptyPublicationReceipt = JSON.parse(publishedEmptyAssets.asset_publication_receipt_private);
assert.equal(emptyPublicationReceipt.status, 'NO_PUBLIC_UPLOADS');
assert.deepEqual(emptyPublicationReceipt.entries, []);
assert.equal(emptyPublicationReceipt.asset_permission, '');
const emptyGitHub = makeGitHubMock();
const emptyPreview = await runPublisher(emptyPreviewInput, emptyGitHub.fetch, Buffer);
assert.equal(emptyPreview.asset_publication_receipt_sha256, publishedEmptyAssets.asset_publication_receipt_sha256);
assert.deepEqual(emptyPreview.preview_paths, rendered.preview_paths);
assert.equal(Object.hasOwn(emptyPreview, 'file_path'), false);
const emptyPageBlobWrites = emptyGitHub.state.calls.filter(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/git/blobs'));
assert.equal(emptyPageBlobWrites.length, 5, 'The no-upload publisher must create exactly five page blobs.');
const emptyPageTreeWrite = emptyGitHub.state.calls.find(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/git/trees'));
assert.deepEqual(JSON.parse(emptyPageTreeWrite.body).tree.map(entry => entry.path), rendered.preview_paths,
  'The page tree write must use the exact artifact-ordered five-page vector.');
emptyGitHub.state.checkRuns = [{ id: 91, name: 'ARC preview quality/preview-quality', head_sha: emptyPreview.head_sha,
  status: 'completed', conclusion: 'success', app: { slug: 'github-actions', id: 15368 } }];
const emptyMergeInput = {
  ...emptyPreviewInput, preview_branch: emptyPreview.preview_branch, head_sha: emptyPreview.head_sha,
  head_tree_sha: emptyPreview.head_tree_sha, pr_number: emptyPreview.pr_number,
};
const mergedEmpty = await runMerge(emptyMergeInput, emptyGitHub.fetch, Buffer);
assert.equal(mergedEmpty.status, 'MERGED');
assert.equal(JSON.parse(mergedEmpty.merge_proof).asset_publication_receipt_sha256,
  publishedEmptyAssets.asset_publication_receipt_sha256);
const emptyEmailToken = 'private_empty_email_token_1234567890abcdef';
const pagesReadsBeforeEmptyGate = emptyGitHub.state.pagesReadbacks.length;
const readyEmptyEmail = await runEmailGate({
  ...emptyMergeInput, preview_url: emptyPreview.preview_url, email_state_token: emptyEmailToken,
  merge_proof: mergedEmpty.merge_proof,
}, emptyGitHub.fetch, Buffer);
assert.equal(readyEmptyEmail.status, 'PRIVATE_CHECKOUT_CONTENT_READY');
assert.equal(readyEmptyEmail.send_preview_email, false);
assert.equal(readyEmptyEmail.outbox_write_allowed, false);
assert.equal(readyEmptyEmail.checkout_url_exposure_allowed, false);
assert.deepEqual(emptyGitHub.state.pagesReadbacks.slice(pagesReadsBeforeEmptyGate), artifactPagePaths,
  'The email gate must read back exactly five clean-route Pages artifacts in canonical artifact order.');
// Simulate a previously signed/bypassed downstream envelope to prove the
// publisher itself also fails before reading or mutating GitHub. This defense
// is independent of the primary verifier and retriever rejections above.
const legacyFolderManifest = [{
  asset_id: folderGrant.asset_id, kind: folderGrant.kind, role: folderGrant.role,
  content_type: folderGrant.content_type, size_bytes: folderGrant.size, sha256: folderGrant.sha256,
  retrieval_endpoint_sha256: folderGrant.retrieval_endpoint_sha256,
}];
const legacyFolderEvidence = {
  ...JSON.parse(verifiedAssetEnvelope.intake_evidence_private),
  asset_manifest: legacyFolderManifest,
  asset_manifest_sha256: sha256(canonicalJson(legacyFolderManifest)),
  total_asset_bytes: folderGrant.size,
  state_digest_sha256: 'c'.repeat(64),
  state_key: `arc1-intake-claim-v2:${'c'.repeat(64)}`,
};
const legacyFolderEvidenceRaw = canonicalJson(legacyFolderEvidence);
let folderPublisherProviderCalls = 0;
await assert.rejects(runAssetPublisher({
  github_token: 'mock-github-token', intake_evidence_secret: intakeSecret,
  asset_receipt_secret: assetReceiptSecret, asset_publication_receipt_secret: assetPublicationSecret,
  intake_evidence_private: legacyFolderEvidenceRaw,
  intake_evidence_hmac_sha256: hmac(intakeSecret, `arc1-intake-evidence-signature-v2\n${legacyFolderEvidenceRaw}`),
  intake_evidence_sha256: sha256(legacyFolderEvidenceRaw),
}, async () => {
  folderPublisherProviderCalls += 1;
  throw new Error('Folder rejection must precede provider access.');
}, Buffer), /folder links require a private provider adapter/);
assert.equal(folderPublisherProviderCalls, 0, 'Folder rejection must precede every GitHub read or write.');
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
};
const pngWithMetadata = (type, data) => {
  const typeBytes = Buffer.from(type, 'ascii'), payload = Buffer.from(data);
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0); typeBytes.copy(chunk, 4); payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.length);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
};
const jpegWithMetadata = (marker, data) => {
  const payload = Buffer.from(data), segment = Buffer.alloc(4 + payload.length);
  segment[0] = 255; segment[1] = marker; segment.writeUInt16BE(payload.length + 2, 2); payload.copy(segment, 4);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
};
const webpWithMetadata = (type, data) => {
  const payload = Buffer.from(data), chunk = Buffer.alloc(8 + payload.length + (payload.length & 1));
  chunk.write(type, 0, 4, 'ascii'); chunk.writeUInt32LE(payload.length, 4); payload.copy(chunk, 8);
  const result = Buffer.concat([webp, chunk]); result.writeUInt32LE(result.length - 8, 4); return result;
};
const assertMetadataRejected = async (bytes, contentType, label,
  expectedError = /embedded (?:JPEG|PNG|WebP) metadata|embedded JPEG metadata or multiple scans/) => {
  const grant = { schema: 'arc-intake-private-asset-grant-v1', asset_id: sha256(`asset-${label}`), kind: 'UPLOAD', role: 'logo_file',
    content_type: contentType, size: bytes.length, sha256: sha256(bytes), retrieval_endpoint_sha256: sha256(assetEndpoint) };
  const metadataData = { ...data, asset_permission: 'Confirmed' };
  const metadataEvidence = { ...evidence, delivery_id: sha256(`delivery-${label}`), data: metadataData, asset_manifest: [grant],
    submission_data_sha256: sha256(canonicalJson({ data: metadataData, asset_manifest: [grant] })) };
  const metadataRaw = canonicalJson(metadataEvidence);
  const metadataEnvelope = canonicalJson({ schema: envelope.schema, evidence: metadataEvidence,
    hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${metadataRaw}`) });
  const verified = await runVerifier({ ...input, bridge_envelope_json: metadataEnvelope }, null, Buffer);
  let retrievalResult;
  let metadataDurableClaimMutations = 0;
  let metadataAcknowledgementCalls = 0;
  await assert.rejects((async () => {
    retrievalResult = await runAssetConsumer(assetInput(verified, [grant]), async () => bodyResponse(bytes, grant), Buffer);
    metadataDurableClaimMutations += 1;
    metadataAcknowledgementCalls += 1;
  })(), expectedError, `${label} metadata must fail at private retrieval before receipt, claim, or ACK.`);
  assert.equal(retrievalResult, undefined, `${label} metadata must produce no signed private receipt.`);
  assert.equal(metadataDurableClaimMutations, 0, `${label} metadata must make zero durable claim mutations.`);
  assert.equal(metadataAcknowledgementCalls, 0, `${label} metadata must produce no acknowledgement.`);

  // Simulate a compromised/bypassed retriever to prove the publisher repeats
  // validation before content addressing or any Git provider request.
  const privateReceipt = {
    version: 'arc1-private-asset-receipt-v1', scope: 'authenticated-content-addressed-intake-assets',
    bridge_contract_sha256: contractSha256, delivery_id: verified.bridge_delivery_id,
    bridge_evidence_sha256: verified.bridge_evidence_sha256, retrieval_endpoint_sha256: sha256(assetEndpoint),
    asset_manifest_sha256: verified.asset_manifest_sha256, asset_count: 1, total_asset_bytes: bytes.length, status: 'VERIFIED',
  };
  const privateReceiptRaw = canonicalJson(privateReceipt);
  const retrieved = {
    asset_payloads_private_json: canonicalJson([{ asset_id: grant.asset_id, kind: 'UPLOAD', role: grant.role,
      content_type: contentType, size_bytes: bytes.length, sha256: grant.sha256, content_base64: bytes.toString('base64') }]),
    asset_receipt_private: privateReceiptRaw,
    asset_receipt_hmac_sha256: hmac(assetReceiptSecret, `arc1-private-asset-receipt-signature-v1\n${privateReceiptRaw}`),
    asset_receipt_sha256: sha256(privateReceiptRaw),
  };
  const mock = makeGitHubMock();
  await assert.rejects(runAssetPublisher(publicationInput(verified, retrieved), mock.fetch, Buffer), expectedError,
    `${label} metadata must fail closed before content addressing.`);
  assert.equal(mock.state.calls.length, 0, `${label} metadata must fail before any Git read or write.`);
};
for (const [label, bytes] of [
  ['jpeg-exif', jpegWithMetadata(0xe1, Buffer.from('Exif\0\0private'))],
  ['jpeg-xmp', jpegWithMetadata(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'))],
  ['jpeg-iptc', jpegWithMetadata(0xed, Buffer.from('Photoshop 3.0\0private'))],
  ['jpeg-app12-vendor', jpegWithMetadata(0xec, Buffer.from('Ducky\0private-vendor-data'))],
  ['jpeg-comment', jpegWithMetadata(0xfe, Buffer.from('private comment'))],
]) await assertMetadataRejected(bytes, 'image/jpeg', label);
const postScanApp1 = jpegWithMetadata(0xe1, Buffer.from('Exif\0\0post-scan-private'));
const postScanApp1Segment = postScanApp1.subarray(2, 2 + 4 + Buffer.byteLength('Exif\0\0post-scan-private'));
await assertMetadataRejected(Buffer.concat([jpeg.subarray(0, -2), postScanApp1Segment, jpeg.subarray(-2)]),
  'image/jpeg', 'jpeg-post-sos-app1');
await assertMetadataRejected(jpeg.subarray(0, -2), 'image/jpeg', 'jpeg-missing-eoi',
  /missing JPEG end marker|embedded JPEG metadata or multiple scans/);
for (const [label, bytes] of [
  ['png-exif', pngWithMetadata('eXIf', Buffer.from('private'))],
  ['png-text', pngWithMetadata('tEXt', Buffer.from('Author\0private'))],
  ['png-xmp', pngWithMetadata('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>'))],
  ['png-comment', pngWithMetadata('zTXt', Buffer.from('Comment\0\0private'))],
  ['png-icc', pngWithMetadata('iCCP', Buffer.from('profile\0\0private'))],
  ['png-time', pngWithMetadata('tIME', Buffer.from([7, 234, 8, 13, 12, 30, 45]))],
  ['png-unknown-ancillary', pngWithMetadata('vpAg', Buffer.from('private-vendor-data'))],
]) await assertMetadataRejected(bytes, 'image/png', label);
for (const [label, bytes] of [
  ['webp-exif', webpWithMetadata('EXIF', Buffer.from('Exif\0\0private'))],
  ['webp-xmp', webpWithMetadata('XMP ', Buffer.from('<x:xmpmeta/>'))],
  ['webp-icc', webpWithMetadata('ICCP', Buffer.from('private profile'))],
  ['webp-unknown-meta', webpWithMetadata('META', Buffer.from('private vendor metadata'))],
]) await assertMetadataRejected(bytes, 'image/webp', label);
for (const [label, bytes, contentType, error] of [
  ['jpeg-empty-shell', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg', /malformed JPEG|incomplete JPEG|missing JPEG scan/],
  ['png-empty-shell', Buffer.concat([png.subarray(0, 8), png.subarray(-12)]), 'image/png', /incomplete PNG|malformed PNG|PNG IHDR/],
  ['webp-empty-shell', (() => {
    const shell = Buffer.alloc(20); shell.write('RIFF'); shell.writeUInt32LE(12, 4); shell.write('WEBP', 8); shell.write('VP8 ', 12); return shell;
  })(), 'image/webp', /incomplete WebP|missing WebP image payload/],
]) await assertMetadataRejected(bytes, contentType, label, error);
const corruptPngCrc = Buffer.from(png);
corruptPngCrc[29] ^= 1;
await assertMetadataRejected(corruptPngCrc, 'image/png', 'png-crc-tamper', /PNG CRC mismatch/);
const dimensionBombPng = Buffer.from(png);
dimensionBombPng.writeUInt32BE(12001, 16);
dimensionBombPng.writeUInt32BE(crc32(dimensionBombPng.subarray(12, 29)), 29);
await assertMetadataRejected(dimensionBombPng, 'image/png', 'png-dimension-bomb', /invalid image dimensions/);
const stuffedEntropyJpeg = Buffer.concat([jpeg.subarray(0, -2), Buffer.from([0xff, 0x00, 0x7f]), jpeg.subarray(-2)]);
const stuffedGrant = {
  schema: 'arc-intake-private-asset-grant-v1', asset_id: sha256('asset-jpeg-stuffed-entropy'), kind: 'UPLOAD', role: 'logo_file',
  content_type: 'image/jpeg', size: stuffedEntropyJpeg.length, sha256: sha256(stuffedEntropyJpeg),
  retrieval_endpoint_sha256: sha256(assetEndpoint),
};
const stuffedData = { ...data, asset_permission: 'Confirmed' };
const stuffedEvidence = { ...evidence, delivery_id: sha256('delivery-jpeg-stuffed-entropy'), data: stuffedData,
  asset_manifest: [stuffedGrant], submission_data_sha256: sha256(canonicalJson({ data: stuffedData, asset_manifest: [stuffedGrant] })) };
const stuffedEvidenceRaw = canonicalJson(stuffedEvidence);
const stuffedEnvelope = canonicalJson({ schema: envelope.schema, evidence: stuffedEvidence,
  hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${stuffedEvidenceRaw}`) });
const stuffedVerified = await runVerifier({ ...input, bridge_envelope_json: stuffedEnvelope }, null, Buffer);
const stuffedRetrieved = await runAssetConsumer(assetInput(stuffedVerified, [stuffedGrant]), async () =>
  bodyResponse(stuffedEntropyJpeg, stuffedGrant), Buffer);
const stuffedMock = makeGitHubMock();
const stuffedPublished = await runAssetPublisher(publicationInput(stuffedVerified, stuffedRetrieved), stuffedMock.fetch, Buffer);
assert.equal(stuffedPublished.status, 'ARC1_FUNCTION_ASSETS_CREATED',
  'A valid JPEG entropy scan containing an FF-stuffed byte must not be parsed as metadata segments.');
const gitHub = makeGitHubMock();
const publishedUpload = await runAssetPublisher(publicationInput(verifiedAssetEnvelope, retrievedUpload), gitHub.fetch, Buffer);
assert.equal(publishedUpload.status, 'ARC1_FUNCTION_ASSETS_CREATED');
assert.equal(publishedUpload.automation_enabled_by_this_step, false);
assert.equal(publishedUpload.cleanup_action_allowed_by_this_step, false);
assert.equal(publishedUpload.recovery_mode, 'exact-replay-only');
assert.match(publishedUpload.logo_file_url,
  new RegExp(`/ironwood-roofing-concept-${verifiedAssetEnvelope.public_folder_prefix}/assets/${withAssetManifest[0].sha256}\\.png$`));
assert.equal(Object.hasOwn(publishedUpload, 'asset_payloads_private_json'), false, 'Raw private bytes must not leave the private publication step.');
const publishedReceipt = JSON.parse(publishedUpload.asset_publication_receipt_private);
assert.equal(publishedReceipt.asset_permission, 'Confirmed');
assert.equal(publishedReceipt.private_asset_receipt_sha256, retrievedUpload.asset_receipt_sha256);
assert.equal(publishedReceipt.entries[0].public_url, publishedUpload.logo_file_url);
assert.equal(publishedReceipt.entries[0].repository_path,
  `ironwood-roofing-concept-${verifiedAssetEnvelope.public_folder_prefix}/assets/${withAssetManifest[0].sha256}.png`);
const assetPostsAfterCreate = gitHub.state.calls.filter(call => call.method !== 'GET').length;
const replayedPublication = await runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload),
  ingress_claim_mode: 'EXACT_REPLAY' }, gitHub.fetch, Buffer);
assert.equal(replayedPublication.status, 'ARC1_FUNCTION_ASSETS_EXACT_REPLAY');
assert.equal(replayedPublication.asset_publication_receipt_private, publishedUpload.asset_publication_receipt_private);
assert.equal(gitHub.state.calls.filter(call => call.method !== 'GET').length, assetPostsAfterCreate,
  'Exact asset replay must perform readback only and create no new Git objects.');
const duplicateContentGrants = [
  { ...withAssetManifest[0], asset_id: 'd'.repeat(64), role: 'hero_image_file' },
  { ...withAssetManifest[0], asset_id: 'e'.repeat(64), role: 'logo_file' },
];
const duplicateData = { ...data, asset_permission: 'Confirmed' };
const duplicateEvidence = { ...evidence, delivery_id: 'c'.repeat(64), data: duplicateData, asset_manifest: duplicateContentGrants,
  submission_data_sha256: sha256(canonicalJson({ data: duplicateData, asset_manifest: duplicateContentGrants })) };
const duplicateRaw = canonicalJson(duplicateEvidence);
const duplicateEnvelope = canonicalJson({ schema: envelope.schema, evidence: duplicateEvidence,
  hmac_sha256: hmac(bridgeSecret, `arc-intake-arc1-bridge-evidence-v1\n${duplicateRaw}`) });
const verifiedDuplicate = await runVerifier({ ...input, bridge_envelope_json: duplicateEnvelope }, null, Buffer);
const retrievedDuplicate = await runAssetConsumer(assetInput(verifiedDuplicate, duplicateContentGrants), async (url, options) => {
  const requested = JSON.parse(options.body);
  return bodyResponse(png, duplicateContentGrants.find(grant => grant.asset_id === requested.asset_id));
}, Buffer);
const duplicateGitHub = makeGitHubMock();
const publishedDuplicate = await runAssetPublisher(publicationInput(verifiedDuplicate, retrievedDuplicate), duplicateGitHub.fetch, Buffer);
const duplicateReceipt = JSON.parse(publishedDuplicate.asset_publication_receipt_private);
assert.equal(duplicateReceipt.entries.length, 2, 'Both roles must remain exactly mapped in the signed receipt.');
assert.equal(new Set(duplicateReceipt.entries.map(entry => entry.repository_path)).size, 1,
  'Identical bytes must map to one deterministic content-addressed repository path.');
const duplicateTreeWrite = duplicateGitHub.state.calls.find(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/git/trees'));
assert.equal(JSON.parse(duplicateTreeWrite.body).tree.length, 1,
  'Identical uploads across roles must create one Git tree entry, never duplicate paths.');
gitHub.state.extraAsset = true;
await assert.rejects(runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload), ingress_claim_mode: 'EXACT_REPLAY' },
  gitHub.fetch, Buffer), /extra or missing asset file/);
gitHub.state.extraAsset = false;
gitHub.state.extraFolderSibling = true;
await assert.rejects(runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload), ingress_claim_mode: 'EXACT_REPLAY' },
  gitHub.fetch, Buffer), /extra or missing entries/);
gitHub.state.extraFolderSibling = false;
const tamperedPayload = JSON.parse(retrievedUpload.asset_payloads_private_json);
tamperedPayload[0].content_base64 = Buffer.from(tamperedPng).toString('base64');
const callsBeforeTamper = gitHub.state.calls.length;
await assert.rejects(runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload),
  asset_payloads_private_json: canonicalJson(tamperedPayload) }, gitHub.fetch, Buffer), /upload bytes\/digest/);
assert.equal(gitHub.state.calls.length, callsBeforeTamper, 'Tampered private bytes must fail before a provider read or write.');
const staleEvidence = { ...JSON.parse(verifiedAssetEnvelope.intake_evidence_private),
  received_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(), issued_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString() };
const staleRaw = canonicalJson(staleEvidence);
const staleEvidenceSha = sha256(staleRaw);
const staleIngressDigest = sha256(canonicalJson({
  version: 'arc1-function-intake-adapter-v1', bridge_contract_sha256: contractSha256,
  delivery_id: staleEvidence.delivery_id, bridge_evidence_sha256: JSON.parse(retrievedUpload.asset_receipt_private).bridge_evidence_sha256,
  arc1_evidence_sha256: staleEvidenceSha, state_key: staleEvidence.state_key, state_digest_sha256: staleEvidence.state_digest_sha256,
}));
const staleIngressKey = `arc1-function-ingress-v1:${staleIngressDigest}`;
const staleInput = { ...publicationInput(verifiedAssetEnvelope, retrievedUpload),
  intake_evidence_private: staleRaw, intake_evidence_hmac_sha256: hmac(intakeSecret, `arc1-intake-evidence-signature-v2\n${staleRaw}`),
  intake_evidence_sha256: staleEvidenceSha, intake_claim_evidence_sha256: staleEvidenceSha,
  ingress_state_key: staleIngressKey, ingress_state_digest_sha256: staleIngressDigest,
  ingress_claim_state_key: staleIngressKey, ingress_claim_state_digest_sha256: staleIngressDigest,
  intake_claim_created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
  ingress_claim_created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
};
const staleGitHub = makeGitHubMock();
await assert.rejects(runAssetPublisher(staleInput, staleGitHub.fetch, Buffer), /stale evidence/);
assert.equal(staleGitHub.state.calls.some(call => call.method !== 'GET'), false,
  'Stale evidence must make no public Git mutation, including no blob upload.');

const contentWithLogo = structuredClone(fixture.content);
contentWithLogo.LOGO_HTML = `<img src="${publishedUpload.logo_file_url}" alt="Uploaded customer logo">`;
const uploadClaim = intakeClaimFor(verifiedAssetEnvelope);
const renderedUpload = await runInjector({
  template_content: template, raw_json: JSON.stringify(contentWithLogo), customer_email: fixture.customerEmail, private_claim_recipient_email: fixture.customerEmail,
  checkout_binding_secret: 'checkout-binding-secret-unique-0123456789', checkout_binding_key_id: '01', private_lead_notification_email: 'leads@example.test', expected_netlify_site_id: siteId,
  expected_netlify_form_id: '6a483964f58804000839c2de', expected_netlify_form_name: 'arc-preview',
  intake_evidence_secret: intakeSecret, intake_evidence_private: verifiedAssetEnvelope.intake_evidence_private,
  intake_evidence_hmac_sha256: verifiedAssetEnvelope.intake_evidence_hmac_sha256,
  logo_file_url: publishedUpload.logo_file_url, hero_image_url: '', supporting_image_url: '',
  asset_publication_receipt_secret: assetPublicationSecret,
  asset_publication_receipt_private: publishedUpload.asset_publication_receipt_private,
  asset_publication_receipt_hmac_sha256: publishedUpload.asset_publication_receipt_hmac_sha256,
  asset_publication_receipt_sha256: publishedUpload.asset_publication_receipt_sha256,
  ingress_claim_asset_receipt_sha256: retrievedUpload.asset_receipt_sha256,
  ...uploadClaim, ...payment.privateInputs,
});
const renderedUploadBundle = JSON.parse(renderedUpload.render_bundle_private);
const renderedUploadSite = renderedUploadBundle.pages.map(page => `${page.approval_html}\n${page.published_html}`).join('\n');
assert.match(renderedUploadSite, new RegExp(publishedUpload.logo_file_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.doesNotMatch(renderedUploadSite, /resourcekey=|iVBORw0KGgo|arc1-private-asset-receipt-v1/);
assert.deepEqual(renderedUpload.preview_paths, artifactPagePaths.map(path => `${renderedUpload.preview_folder}/${path}`));
const contentOmittingSignedUpload = structuredClone(fixture.content);
contentOmittingSignedUpload.LOGO_HTML = '';
await assert.rejects(runInjector({
  template_content: template, raw_json: JSON.stringify(contentOmittingSignedUpload), customer_email: fixture.customerEmail, private_claim_recipient_email: fixture.customerEmail,
  checkout_binding_secret: 'checkout-binding-secret-unique-0123456789', checkout_binding_key_id: '01', private_lead_notification_email: 'leads@example.test', expected_netlify_site_id: siteId,
  expected_netlify_form_id: '6a483964f58804000839c2de', expected_netlify_form_name: 'arc-preview',
  intake_evidence_secret: intakeSecret, intake_evidence_private: verifiedAssetEnvelope.intake_evidence_private,
  intake_evidence_hmac_sha256: verifiedAssetEnvelope.intake_evidence_hmac_sha256,
  logo_file_url: publishedUpload.logo_file_url, hero_image_url: '', supporting_image_url: '',
  asset_publication_receipt_secret: assetPublicationSecret,
  asset_publication_receipt_private: publishedUpload.asset_publication_receipt_private,
  asset_publication_receipt_hmac_sha256: publishedUpload.asset_publication_receipt_hmac_sha256,
  asset_publication_receipt_sha256: publishedUpload.asset_publication_receipt_sha256,
  ingress_claim_asset_receipt_sha256: retrievedUpload.asset_receipt_sha256,
  ...uploadClaim, ...payment.privateInputs,
}), /five-page rendered URL union differs from signed assets/,
  'Every signed upload must survive sanitization and appear in the final approved HTML before checkout exposure.');
const tamperedPublication = JSON.parse(publishedUpload.asset_publication_receipt_private);
tamperedPublication.entries[0].public_url = 'https://evil.example/logo.png';
const tamperedPublicationRaw = canonicalJson(tamperedPublication);
await assert.rejects(runInjector({
  template_content: template, raw_json: JSON.stringify(contentWithLogo), customer_email: fixture.customerEmail, private_claim_recipient_email: fixture.customerEmail,
  checkout_binding_secret: 'checkout-binding-secret-unique-0123456789', checkout_binding_key_id: '01', private_lead_notification_email: 'leads@example.test', expected_netlify_site_id: siteId,
  expected_netlify_form_id: '6a483964f58804000839c2de', expected_netlify_form_name: 'arc-preview',
  intake_evidence_secret: intakeSecret, intake_evidence_private: verifiedAssetEnvelope.intake_evidence_private,
  intake_evidence_hmac_sha256: verifiedAssetEnvelope.intake_evidence_hmac_sha256,
  logo_file_url: 'https://evil.example/logo.png', hero_image_url: '', supporting_image_url: '',
  asset_publication_receipt_secret: assetPublicationSecret, asset_publication_receipt_private: tamperedPublicationRaw,
  asset_publication_receipt_hmac_sha256: hmac(assetPublicationSecret, `arc1-public-asset-publication-receipt-v1\n${tamperedPublicationRaw}`),
  asset_publication_receipt_sha256: sha256(tamperedPublicationRaw), ingress_claim_asset_receipt_sha256: retrievedUpload.asset_receipt_sha256,
  ...uploadClaim, ...payment.privateInputs,
}), /exact content-addressed URL map/);

const assetReceiptInputs = {
  asset_publication_receipt_secret: assetPublicationSecret,
  asset_publication_receipt_private: publishedUpload.asset_publication_receipt_private,
  asset_publication_receipt_hmac_sha256: publishedUpload.asset_publication_receipt_hmac_sha256,
  asset_publication_receipt_sha256: publishedUpload.asset_publication_receipt_sha256,
  ingress_claim_asset_receipt_sha256: retrievedUpload.asset_receipt_sha256,
};
const previewPublishInput = previewInputFor({
  verified: verifiedAssetEnvelope, renderedOutput: renderedUpload, receiptInputs: assetReceiptInputs, claim: uploadClaim,
  assetUrls: { logo_file_url: publishedUpload.logo_file_url, hero_image_url: '', supporting_image_url: '' },
});
const pageBlobWritesBefore = gitHub.state.calls.filter(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/git/blobs')).length;
const publishedPreview = await runPublisher(previewPublishInput, gitHub.fetch, Buffer);
assert.equal(publishedPreview.status, 'PR_CREATED');
assert.equal(publishedPreview.preview_branch, `arc-preview/${verifiedAssetEnvelope.public_folder_prefix}`);
assert.equal(publishedPreview.asset_publication_receipt_sha256, publishedUpload.asset_publication_receipt_sha256);
const publishedHeadTree = gitHub.state.trees.get(gitHub.state.commits.get(publishedPreview.head_sha));
assert.deepEqual([...publishedHeadTree.pages.keys()].sort(), [...logicalPagePaths].sort(),
  'Atomic preview head must contain the exact five logical page files.');
assert.equal(publishedHeadTree.assets.size, 1, 'Atomic preview head must preserve the exact asset subtree.');
const pageBlobWritesAfter = gitHub.state.calls.filter(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/git/blobs')).length;
assert.equal(pageBlobWritesAfter - pageBlobWritesBefore, 5, 'The preview publication step must write exactly five HTML blobs.');
const exactUploadPrFiles = [
  ...renderedUpload.preview_paths.map(filename => ({ filename, status: 'added' })),
  { filename: publishedReceipt.entries[0].repository_path, status: 'added' },
];
gitHub.state.prFiles = exactUploadPrFiles;
gitHub.state.checkRuns = [{ id: 93, name: 'ARC preview quality/preview-quality', head_sha: publishedPreview.head_sha,
  status: 'completed', conclusion: 'success', app: { slug: 'github-actions', id: 15368 } }];

const secondaryPage = publishedHeadTree.pages.get('services/index.html');
publishedHeadTree.pages.set('services/index.html', { ...secondaryPage, bytes: Buffer.concat([secondaryPage.bytes, Buffer.from('tamper')]) });
await assert.rejects(runPublisher(previewPublishInput, gitHub.fetch, Buffer), /services\/index\.html bytes differ/,
  'A byte change on a secondary page must reject exact replay.');
publishedHeadTree.pages.set('services/index.html', secondaryPage);
const aboutPage = publishedHeadTree.pages.get('about/index.html');
publishedHeadTree.pages.delete('about/index.html');
await assert.rejects(runPublisher(previewPublishInput, gitHub.fetch, Buffer), /partial five-page branch|extra or missing entries/,
  'A partial five-page branch must fail closed.');
publishedHeadTree.pages.set('about/index.html', aboutPage);
gitHub.state.extraFolderSibling = true;
await assert.rejects(runPublisher(previewPublishInput, gitHub.fetch, Buffer), /extra or missing entries/,
  'An extra preview-folder sibling must fail closed.');
gitHub.state.extraFolderSibling = false;

const uploadMergeInput = {
  ...previewPublishInput, preview_branch: publishedPreview.preview_branch, head_sha: publishedPreview.head_sha,
  head_tree_sha: publishedPreview.head_tree_sha, pr_number: publishedPreview.pr_number,
};
gitHub.state.prFiles = exactUploadPrFiles.slice(0, -1);
await assert.rejects(runMerge(uploadMergeInput, gitHub.fetch, Buffer), /exact PR file vector/,
  'A missing asset or page in the PR file vector must fail closed.');
gitHub.state.prFiles = [...exactUploadPrFiles, { filename: `${renderedUpload.preview_folder}/unexpected.html`, status: 'added' }];
await assert.rejects(runMerge(uploadMergeInput, gitHub.fetch, Buffer), /exact PR file vector/,
  'An extra PR file must fail closed.');
gitHub.state.prFiles = exactUploadPrFiles;
const mergedUpload = await runMerge(uploadMergeInput, gitHub.fetch, Buffer);
assert.equal(mergedUpload.status, 'MERGED');
const uploadMergeProof = JSON.parse(mergedUpload.merge_proof);
assert.equal(uploadMergeProof.asset_publication_receipt_sha256, publishedUpload.asset_publication_receipt_sha256);
const privateEmailToken = 'private_asset_email_token_1234567890abcdef';
const uploadGateInput = {
  ...uploadMergeInput, preview_url: publishedPreview.preview_url, email_state_token: privateEmailToken,
  merge_proof: mergedUpload.merge_proof,
};
const pagesReadsBeforeUploadGate = gitHub.state.pagesReadbacks.length;
const readyUploadEmail = await runEmailGate(uploadGateInput, gitHub.fetch, Buffer);
assert.equal(readyUploadEmail.status, 'PRIVATE_CHECKOUT_CONTENT_READY');
assert.equal(readyUploadEmail.send_preview_email, false);
assert.equal(JSON.parse(readyUploadEmail.checkout_readiness_core_private).asset_publication_receipt_sha256, publishedUpload.asset_publication_receipt_sha256);
assert.deepEqual(gitHub.state.pagesReadbacks.slice(pagesReadsBeforeUploadGate), artifactPagePaths,
  'The uploaded-asset chain must still perform exactly five Pages HTML readbacks.');
gitHub.state.pagesTamperPath = 'process/index.html';
const secondaryLiveTamper = await runEmailGate({ ...uploadGateInput, email_state_token: `${privateEmailToken}x` }, gitHub.fetch, Buffer);
assert.equal(secondaryLiveTamper.status, 'WAITING_FOR_PAGES', 'A tampered secondary Pages response must block readiness.');
gitHub.state.pagesTamperPath = '';
const assetBytesBeforeTamper = gitHub.state.blobs.get(publishedReceipt.entries[0].git_blob_sha1);
gitHub.state.blobs.set(publishedReceipt.entries[0].git_blob_sha1, tamperedPng);
const tamperedLiveResult = await runEmailGate({ ...uploadGateInput, email_state_token: `${privateEmailToken}y` }, gitHub.fetch, Buffer);
assert.equal(tamperedLiveResult.status, 'WAITING_FOR_PAGES', 'Tampered live asset bytes must block customer email.');
gitHub.state.blobs.set(publishedReceipt.entries[0].git_blob_sha1, assetBytesBeforeTamper);
const completedMutationCount = gitHub.state.calls.filter(call => call.method !== 'GET').length;
const completedAssetReplay = await runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload),
  ingress_claim_mode: 'EXACT_REPLAY' }, gitHub.fetch, Buffer);
assert.equal(completedAssetReplay.status, 'ARC1_FUNCTION_ASSETS_EXACT_REPLAY',
  'Asset recovery must recognize the recursively exact completed V11 page tree.');
assert.equal(gitHub.state.calls.filter(call => call.method !== 'GET').length, completedMutationCount,
  'Completed-site asset recovery must be read-only.');
gitHub.state.extraFolderSibling = true;
await assert.rejects(runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload), ingress_claim_mode: 'EXACT_REPLAY' },
  gitHub.fetch, Buffer), /asset-stage preview folder has extra or missing entries/,
  'Completed-site asset recovery must reject an extra preview-root entry.');
gitHub.state.extraFolderSibling = false;
gitHub.state.extraRouteFile = 'about';
await assert.rejects(runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload), ingress_claim_mode: 'EXACT_REPLAY' },
  gitHub.fetch, Buffer), /completed five-page route has extra or missing entries/,
  'Completed-site asset recovery must reject an extra secondary-route file.');
gitHub.state.extraRouteFile = '';
const processPage = publishedHeadTree.pages.get('process/index.html');
publishedHeadTree.pages.delete('process/index.html');
await assert.rejects(runAssetPublisher({ ...publicationInput(verifiedAssetEnvelope, retrievedUpload), ingress_claim_mode: 'EXACT_REPLAY' },
  gitHub.fetch, Buffer), /asset-stage preview folder has extra or missing entries/,
  'Completed-site asset recovery must reject a missing secondary route.');
publishedHeadTree.pages.set('process/index.html', processPage);
const completedPreviewReplay = await runPublisher(previewPublishInput, gitHub.fetch, Buffer);
assert.equal(completedPreviewReplay.status, 'PR_REUSED');
assert.equal(gitHub.state.calls.filter(call => call.method !== 'GET').length, completedMutationCount,
  'Completed preview recovery must perform no mutation.');
const publicWriteBodies = gitHub.state.calls.map(call => call.body).join('\n');
assert.doesNotMatch(publicWriteBodies, /drive\.google\.com|resourcekey=/,
  'A private folder URL may not enter any Git API mutation.');
const prWriteBodies = gitHub.state.calls.filter(call => call.method === 'POST' && new URL(call.url).pathname.endsWith('/pulls'))
  .map(call => call.body).join('\n');
assert.doesNotMatch(prWriteBodies, /iVBORw0KGgo|arc1-private-asset-receipt-v1|content_base64/,
  'Raw upload bytes and private receipts may not enter a PR body.');

const claimCreatedAt = new Date().toISOString();
const ackInput = {
  arc1_ack_secret: ackSecret,
  bridge_contract_sha256: issued.bridge_contract_sha256,
  consumer_schema: issued.consumer_schema,
  bridge_delivery_id: issued.bridge_delivery_id,
  bridge_evidence_sha256: issued.bridge_evidence_sha256,
  bridge_evidence_expires_at: issued.bridge_evidence_expires_at,
  bridge_evidence_issued_at: issued.bridge_evidence_issued_at,
  ingress_state_key: issued.ingress_state_key,
  ingress_state_digest_sha256: issued.ingress_state_digest_sha256,
  ingress_claim_mode: 'CREATED',
  ingress_claim_status: 'CLAIMED',
  ingress_claim_state_key: issued.ingress_state_key,
  ingress_claim_state_digest_sha256: issued.ingress_state_digest_sha256,
  ingress_claim_bridge_delivery_id: issued.bridge_delivery_id,
  ingress_claim_bridge_evidence_sha256: issued.bridge_evidence_sha256,
  ingress_claim_asset_receipt_sha256: emptyAssetReceipt.asset_receipt_sha256,
  ingress_claim_created_at: claimCreatedAt,
  asset_receipt_secret: assetReceiptSecret,
  asset_receipt_private: emptyAssetReceipt.asset_receipt_private,
  asset_receipt_hmac_sha256: emptyAssetReceipt.asset_receipt_hmac_sha256,
};
const ack = await runAck(ackInput, null, Buffer);
assert.equal(ack.status, 'ARC1_FUNCTION_INTAKE_ACK_READY');
assert.equal(ack.acknowledgement_allowed_by_this_step, true);
const ackWrapper = JSON.parse(ack.acknowledgement_json);
assert.equal(canonicalJson(ackWrapper), ack.acknowledgement_json);
assert.equal(ackWrapper.acknowledgement.delivery_id, issued.bridge_delivery_id);
assert.equal(ackWrapper.acknowledgement.evidence_sha256, issued.bridge_evidence_sha256);
assert.equal(ackWrapper.acknowledgement.asset_receipt_sha256, emptyAssetReceipt.asset_receipt_sha256);
assert.match(ackWrapper.acknowledgement.ack_id, /^arc1ack_[a-f0-9]{40}$/);
assert.equal(
  ackWrapper.hmac_sha256,
  hmac(ackSecret, `arc-intake-arc1-consumer-ack-v1\n${canonicalJson(ackWrapper.acknowledgement)}`),
);
const ackReplay = await runAck({ ...ackInput, ingress_claim_mode: 'EXACT_REPLAY' }, null, Buffer);
assert.equal(ackReplay.acknowledgement_json, ack.acknowledgement_json, 'Exact durable claim replay must produce a byte-identical acknowledgement.');
const laterAckReplay = await runAck({
  ...ackInput, ingress_claim_mode: 'EXACT_REPLAY', ingress_claim_created_at: new Date(Date.parse(claimCreatedAt) + 1_000).toISOString(),
}, null, Buffer);
assert.equal(laterAckReplay.acknowledgement_json, ack.acknowledgement_json,
  'A later exact-claim read must not change the acknowledgement identity or timestamp.');
await assert.rejects(runAck({ ...ackInput, ingress_claim_bridge_evidence_sha256: '0'.repeat(64) }, null, Buffer), /durable ingress claim required/);
await assert.rejects(runAck({ ...ackInput, ingress_claim_asset_receipt_sha256: '0'.repeat(64) }, null, Buffer),
  /asset receipt is not bound to durable ingress claim/);
await assert.rejects(runAck({ ...ackInput, ingress_claim_asset_receipt_sha256: '' }, null, Buffer),
  /asset receipt is not bound to durable ingress claim/);

for (const source of [verifierSource, ackSource]) {
  assert.doesNotMatch(source, /console\.(?:log|error|warn)|method\s*:\s*["'](?:PUT|PATCH|DELETE)["']/,
    'The adapter must neither log private intake nor perform mutable provider calls itself.');
}
assert.match(injectorSource, /arc1-intake-evidence-v2/);
assert.match(injectorSource, /arc1-intake-evidence-signature-v2/);
assert.match(publisherSource, /arc1-intake-evidence-v2/);
assert.match(publisherSource, /arc1-intake-evidence-signature-v2/);
assert.doesNotMatch(`${verifierSource}\n${injectorSource}\n${publisherSource}`, /finished ARC website is \$5,000 only after preview approval/);

console.log('PASS ARC1 first-party Function intake bridge, durable claim acknowledgement, and v2 evidence contract');
