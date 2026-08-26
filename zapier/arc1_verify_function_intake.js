// ARC1 fail-closed adapter for the first-party ARC intake Function.
// It authenticates one exact bridge envelope, validates its immutable payload,
// and issues ARC1 v2 evidence. It never writes state or acknowledges delivery.
const clean = value => String(value == null ? "" : value).trim();
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC1_BRIDGE_CRYPTO_UNAVAILABLE");
}
const encoder = new TextEncoder();
const bytesToHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const sha256Text = async value => bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value)));
const sha256Bytes = async value => bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", value));
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ARC1_BRIDGE_INVALID: non-finite JSON value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC1_BRIDGE_INVALID: plain JSON required");
};
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort());
const importHmac = async secret => globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const hmacHex = async (key, value) => bytesToHex(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(value)));
const safeSecret = (value, label) => {
  const secret = String(value == null ? "" : value);
  const length = encoder.encode(secret).length;
  if (length < 32 || length > 256) throw new Error(`ARC1_BRIDGE_INVALID: ${label} secret length`);
  return secret;
};
const externalUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clean(value));
const sha = value => /^[a-f0-9]{64}$/.test(clean(value));
const iso = value => {
  const text = clean(value);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== text) throw new Error("ARC1_BRIDGE_INVALID: timestamp");
  return { text, ms };
};

const BRIDGE_CONTRACT_SHA256 = "c4ab396bf04464629624dd19a37602755c8d429db0bf729b49bbfdfdba3ae20c";
const BRIDGE_SCHEMA = "arc-intake-arc1-bridge-envelope-v1";
const SOURCE_SCHEMA = "arc-intake-function-submission-v1";
const CONSUMER_SCHEMA = "arc1-function-intake-adapter-v1";
const CURRENT_OFFER_CONTRACT_ID = "arc-fixed-five-page-offer-v1";
const CURRENT_BUDGET = "Yes, understands the finished ARC website is a fixed five-page website with a $5,000 subtotal plus applicable sales tax only after preview approval";
const CURRENT_TERMS = "Accepted ARC preview terms, privacy policy, refund policy, and fixed five-page service scope dated 2026-08-25; separate adult checkout acceptance required";
const EVIDENCE_FIELDS = [
  "asset_manifest", "asset_retrieval_endpoint", "bridge_contract_sha256", "data", "delivery_id", "evidence_expires_at",
  "evidence_issued_at", "received_at", "scope", "site_id_sha256", "source_form_name", "source_key_hmac_sha256",
  "source_schema", "submission_data_sha256", "submission_id", "version"
];
const DATA_FIELDS = new Set([
  "asset_folder_link", "asset_permission", "assets", "brand_tone", "budget_confirmed", "business", "business_hours",
  "business_story", "city", "colors", "competitor_sites", "cta_destination", "design_dislikes", "domain_status", "email",
  "faqs_and_objections", "features", "final_notes", "first_cta", "form_started_at", "goals", "highest_profit_service",
  "industry", "intake_version", "offer_contract_id", "landing_path", "last_step_reached", "lead_form_fields", "lead_form_needed",
  "lead_notification_email", "main_call_to_action", "main_offer", "main_services", "name", "primary_style", "proof",
  "proof_details", "public_address", "public_email", "public_phone", "reference_site_likes", "referrer_host", "sections",
  "social_links", "target_customer", "terms_accepted", "utm_campaign", "utm_content", "utm_medium", "utm_source",
  "utm_term", "website", "why_choose_you"
]);
// This is the only bridge projection that may be mapped into the generator.
// Operational/attribution fields and private recipients stay in the signed
// intake envelope and must be mapped only to the dedicated private gates.
const PUBLIC_CONTENT_FIELDS = new Set([
  "brand_tone", "business", "business_hours", "business_story", "city", "colors", "competitor_sites",
  "cta_destination", "design_dislikes", "domain_status", "faqs_and_objections", "features", "final_notes",
  "first_cta", "goals", "highest_profit_service", "industry", "lead_form_fields", "lead_form_needed",
  "main_call_to_action", "main_offer", "main_services", "primary_style", "proof", "proof_details",
  "public_address", "public_email", "public_phone", "reference_site_likes", "sections", "social_links",
  "target_customer", "website", "why_choose_you"
]);
const MULTI_FIELDS = new Set(["assets", "goals", "lead_form_fields", "proof", "sections"]);
const ASSET_FIELDS = ["hero_image_file", "logo_file", "supporting_image_file"];

const destinationBearer = safeSecret(inputData.bridge_destination_bearer, "mapped destination bearer");
const expectedDestinationBearer = safeSecret(inputData.expected_bridge_destination_bearer, "expected destination bearer");
if (destinationBearer !== expectedDestinationBearer) throw new Error("ARC1_BRIDGE_INVALID: destination bearer mismatch");
const bridgeSecret = safeSecret(inputData.bridge_evidence_secret, "bridge evidence");
const intakeSecret = safeSecret(inputData.intake_evidence_secret, "ARC1 intake evidence");
if (bridgeSecret === intakeSecret || bridgeSecret === destinationBearer || intakeSecret === destinationBearer) {
  throw new Error("ARC1_BRIDGE_INVALID: bridge secrets must be distinct");
}
const expectedSiteId = clean(inputData.expected_netlify_site_id).toLowerCase();
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(expectedSiteId)) {
  throw new Error("ARC1_BRIDGE_INVALID: exact Netlify site id required");
}

const envelopeRaw = clean(inputData.bridge_envelope_json);
let envelope;
try { envelope = JSON.parse(envelopeRaw); } catch (error) { throw new Error("ARC1_BRIDGE_INVALID: envelope JSON"); }
if (!exactKeys(envelope, ["schema", "evidence", "hmac_sha256"]) || canonicalJson(envelope) !== envelopeRaw ||
    envelope.schema !== BRIDGE_SCHEMA || !sha(envelope.hmac_sha256) || !exactKeys(envelope.evidence, EVIDENCE_FIELDS)) {
  throw new Error("ARC1_BRIDGE_INVALID: canonical envelope fields");
}
const evidence = envelope.evidence;
const evidenceRaw = canonicalJson(evidence);
const bridgeKey = await importHmac(bridgeSecret);
if (await hmacHex(bridgeKey, `arc-intake-arc1-bridge-evidence-v1\n${evidenceRaw}`) !== envelope.hmac_sha256) {
  throw new Error("ARC1_BRIDGE_INVALID: evidence HMAC mismatch");
}
const expectedSiteHash = await sha256Text(expectedSiteId);
if (evidence.version !== 1 || evidence.scope !== "authenticated-first-party-arc-intake" ||
    evidence.bridge_contract_sha256 !== BRIDGE_CONTRACT_SHA256 || evidence.source_schema !== SOURCE_SCHEMA ||
    evidence.source_form_name !== "arc-preview-function-v1" || evidence.site_id_sha256 !== expectedSiteHash ||
    !externalUuid(evidence.submission_id) || !sha(evidence.delivery_id) || !sha(evidence.source_key_hmac_sha256) ||
    !sha(evidence.submission_data_sha256) || !exactKeys(evidence.data, Object.keys(evidence.data)) ||
    !Array.isArray(evidence.asset_manifest) || evidence.asset_manifest.length > 3 ||
    Object.hasOwn(evidence.data, "asset_folder_link")) throw new Error("ARC1_BRIDGE_INVALID: source binding");
const received = iso(evidence.received_at);
const issued = iso(evidence.evidence_issued_at);
const expires = iso(evidence.evidence_expires_at);
const nowMs = Date.now();
if (received.ms < nowMs - 24 * 60 * 60 * 1000 || received.ms > nowMs + 5 * 60 * 1000 ||
    issued.ms < received.ms - 5 * 60 * 1000 || issued.ms > nowMs + 5 * 60 * 1000 || expires.ms <= nowMs ||
    expires.ms > issued.ms + 24 * 60 * 60 * 1000) throw new Error("ARC1_BRIDGE_INVALID: evidence stale or out of order");
for (const [field, value] of Object.entries(evidence.data)) {
  if (!DATA_FIELDS.has(field)) throw new Error("ARC1_BRIDGE_INVALID: unexpected data field");
  if (MULTI_FIELDS.has(field)) {
    if (!Array.isArray(value) || value.length > 16 || value.some(item => typeof item !== "string")) throw new Error("ARC1_BRIDGE_INVALID: multi-value data");
  } else if (typeof value !== "string") throw new Error("ARC1_BRIDGE_INVALID: scalar data");
}
if (evidence.data.intake_version !== "arc-intake-v8" || evidence.data.offer_contract_id !== CURRENT_OFFER_CONTRACT_ID ||
    evidence.data.budget_confirmed !== CURRENT_BUDGET ||
    evidence.data.terms_accepted !== CURRENT_TERMS) throw new Error("ARC1_BRIDGE_INVALID: immutable consent mismatch");

let retrievalEndpoint;
try { retrievalEndpoint = new URL(evidence.asset_retrieval_endpoint); } catch { throw new Error("ARC1_BRIDGE_ASSET_INVALID: retrieval endpoint"); }
if (retrievalEndpoint.protocol !== "https:" || retrievalEndpoint.username || retrievalEndpoint.password || retrievalEndpoint.port ||
    retrievalEndpoint.search || retrievalEndpoint.hash || retrievalEndpoint.pathname !== "/internal/intake/arc1/assets/retrieve" ||
    !["arcweb.onl", "arcsites.netlify.app"].includes(retrievalEndpoint.hostname) || retrievalEndpoint.toString() !== evidence.asset_retrieval_endpoint) {
  throw new Error("ARC1_BRIDGE_ASSET_INVALID: retrieval endpoint");
}
const retrievalEndpointSha256 = await sha256Text(evidence.asset_retrieval_endpoint);
let previousField = "";
let totalAssetBytes = 0;
for (const grant of evidence.asset_manifest) {
  // Folder URLs are rejected here, before this adapter can emit any state key
  // that a durable claim or acknowledgement step could consume. Supporting
  // them requires a private provider adapter that expands and validates every
  // file; silently treating a folder as an empty upload set is forbidden.
  if (grant?.kind === "FOLDER_LINK" || grant?.role === "asset_folder_link") {
    throw new Error("ARC1_BRIDGE_ASSET_UNSUPPORTED: folder links require a private provider adapter");
  }
  if (!exactKeys(grant, ["asset_id", "content_type", "kind", "retrieval_endpoint_sha256", "role", "schema", "sha256", "size"]) ||
      grant.schema !== "arc-intake-private-asset-grant-v1" || !sha(grant.asset_id) || !sha(grant.sha256) ||
      grant.retrieval_endpoint_sha256 !== retrievalEndpointSha256 || !ASSET_FIELDS.includes(grant.role) || grant.role <= previousField ||
      grant.kind !== "UPLOAD" || !Number.isSafeInteger(grant.size) || grant.size < 1 || grant.size > 1250000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(grant.content_type)) {
    throw new Error("ARC1_BRIDGE_ASSET_INVALID: immutable grant fields");
  }
  totalAssetBytes += grant.size;
  if (totalAssetBytes > 3020000) throw new Error("ARC1_BRIDGE_ASSET_INVALID: total bytes");
  previousField = grant.role;
}
if (evidence.asset_manifest.length > 0 && evidence.data.asset_permission !== "Confirmed") {
  throw new Error("ARC1_BRIDGE_ASSET_INVALID: exact permission required");
}
if (await sha256Text(canonicalJson({ data: evidence.data, asset_manifest: evidence.asset_manifest })) !== evidence.submission_data_sha256) {
  throw new Error("ARC1_BRIDGE_INVALID: submission digest mismatch");
}

const publicFolderPrefix = (await sha256Text([
  "arc-preview-folder-v2", BRIDGE_CONTRACT_SHA256, expectedSiteHash, evidence.submission_id, evidence.received_at
].join("\n"))).slice(0, 8);
const assetManifest = evidence.asset_manifest.map(grant => ({
  asset_id: grant.asset_id,
  kind: grant.kind,
  role: grant.role,
  content_type: grant.content_type,
  size_bytes: grant.size,
  sha256: grant.sha256,
  retrieval_endpoint_sha256: grant.retrieval_endpoint_sha256
}));
const assetManifestSha256 = await sha256Text(canonicalJson(assetManifest));
const stateBinding = {
  version: "arc1-intake-state-v2",
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  site_id_sha256: expectedSiteHash,
  delivery_id: evidence.delivery_id,
  submission_id: evidence.submission_id,
  received_at: evidence.received_at,
  public_folder_prefix: publicFolderPrefix,
  submission_data_sha256: evidence.submission_data_sha256,
  asset_manifest: assetManifest
};
const stateDigestSha256 = await sha256Text(canonicalJson(stateBinding));
const stateKey = `arc1-intake-claim-v2:${stateDigestSha256}`;
// Exact delivery retries must produce byte-identical evidence and claim keys.
const issuedAt = evidence.evidence_issued_at;
const arc1Evidence = {
  version: "arc1-intake-evidence-v2",
  scope: "authoritative-first-party-function-intake",
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  site_id_sha256: expectedSiteHash,
  source_schema: SOURCE_SCHEMA,
  source_form_name: evidence.source_form_name,
  source_key_hmac_sha256: evidence.source_key_hmac_sha256,
  delivery_id: evidence.delivery_id,
  submission_id: evidence.submission_id,
  received_at: evidence.received_at,
  intake_version: evidence.data.intake_version,
  offer_contract_id: evidence.data.offer_contract_id,
  budget_confirmed: evidence.data.budget_confirmed,
  terms_accepted: evidence.data.terms_accepted,
  asset_permission: evidence.asset_manifest.length > 0 ? evidence.data.asset_permission : "",
  public_folder_prefix: publicFolderPrefix,
  submission_data_sha256: evidence.submission_data_sha256,
  asset_manifest: assetManifest,
  asset_manifest_sha256: assetManifestSha256,
  total_asset_bytes: totalAssetBytes,
  state_key: stateKey,
  state_digest_sha256: stateDigestSha256,
  claim_required_before_build: true,
  issued_at: issuedAt
};
const arc1EvidenceRaw = canonicalJson(arc1Evidence);
const intakeKey = await importHmac(intakeSecret);
const arc1EvidenceHmac = await hmacHex(intakeKey, `arc1-intake-evidence-signature-v2\n${arc1EvidenceRaw}`);
const bridgeEvidenceSha256 = await sha256Text(evidenceRaw);
const arc1EvidenceSha256 = await sha256Text(arc1EvidenceRaw);
const ingressStateDigestSha256 = await sha256Text(canonicalJson({
  version: CONSUMER_SCHEMA,
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  delivery_id: evidence.delivery_id,
  bridge_evidence_sha256: bridgeEvidenceSha256,
  arc1_evidence_sha256: arc1EvidenceSha256,
  state_key: stateKey,
  state_digest_sha256: stateDigestSha256
}));
const ingressStateKey = `arc1-function-ingress-v1:${ingressStateDigestSha256}`;
const publicContentData = Object.fromEntries(Object.entries(evidence.data)
  .filter(([field]) => PUBLIC_CONTENT_FIELDS.has(field))
  .sort(([left], [right]) => left.localeCompare(right)));

return {
  status: "ARC1_FUNCTION_INTAKE_VERIFIED",
  build_allowed_by_this_step: false,
  acknowledgement_allowed_by_this_step: false,
  consumer_schema: CONSUMER_SCHEMA,
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  bridge_delivery_id: evidence.delivery_id,
  bridge_evidence_sha256: bridgeEvidenceSha256,
  bridge_evidence_expires_at: evidence.evidence_expires_at,
  bridge_evidence_issued_at: evidence.evidence_issued_at,
  bridge_source_key_hmac_sha256: evidence.source_key_hmac_sha256,
  asset_retrieval_endpoint: evidence.asset_retrieval_endpoint,
  private_asset_grants_json: canonicalJson(evidence.asset_manifest),
  private_asset_grants_sha256: await sha256Text(canonicalJson(evidence.asset_manifest)),
  private_asset_retrieval_required: true,
  ingress_state_key: ingressStateKey,
  ingress_state_digest_sha256: ingressStateDigestSha256,
  trusted_netlify_submission_id: evidence.submission_id,
  trusted_received_at: evidence.received_at,
  public_folder_prefix: publicFolderPrefix,
  submission_data: publicContentData,
  submission_data_json: canonicalJson(publicContentData),
  submission_data_sha256: evidence.submission_data_sha256,
  asset_manifest: assetManifest,
  asset_manifest_sha256: assetManifestSha256,
  total_asset_bytes: totalAssetBytes,
  state_key: stateKey,
  state_digest_sha256: stateDigestSha256,
  intake_evidence_private: arc1EvidenceRaw,
  intake_evidence_hmac_sha256: arc1EvidenceHmac,
  intake_evidence_sha256: arc1EvidenceSha256,
  claim_required_before_build: true
};
