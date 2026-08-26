import { createHash, createHmac } from "node:crypto";

export const TEST_INTAKE_EVIDENCE_SECRET = "arc-test-intake-evidence-secret-32-bytes-minimum";
export const TEST_NETLIFY_SITE_ID = "123e4567-e89b-42d3-a456-426614174000";
export const TEST_NETLIFY_FORM_ID = "a".repeat(40);
export const TEST_NETLIFY_FORM_NAME = "arc-preview";
export const TEST_NETLIFY_SUBMISSION_ID = "5231110b5803540aeb000019";
export const TEST_OFFER_CONTRACT_ID = "arc-fixed-five-page-offer-v1";
export const TEST_BUDGET_CONFIRMATION = "Yes, understands the finished ARC website is a fixed five-page website with a $5,000 subtotal plus applicable sales tax only after preview approval";
export const TEST_TERMS_ACCEPTANCE = "Accepted ARC preview terms, privacy policy, refund policy, and fixed five-page service scope dated 2026-08-25; separate adult checkout acceptance required";

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite test evidence value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("test evidence must be plain JSON");
}

export const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");

export function createTestIntakeEvidence({
  assetManifest = [],
  receivedAt = new Date(Date.now() - 60_000).toISOString(),
  issuedAt = new Date().toISOString(),
  submissionId = TEST_NETLIFY_SUBMISSION_ID,
  siteId = TEST_NETLIFY_SITE_ID,
  formId = TEST_NETLIFY_FORM_ID,
  formName = TEST_NETLIFY_FORM_NAME,
  evidenceSecret = TEST_INTAKE_EVIDENCE_SECRET,
  submissionDataSha256 = "b".repeat(64)
} = {}) {
  const publicFolderPrefix = sha256([
    "arc-preview-folder-v1",
    siteId,
    formId,
    submissionId,
    receivedAt
  ].join("\n")).slice(0, 8);
  const stateBinding = {
    version: "arc1-intake-state-v1",
    site_id: siteId,
    form_id: formId,
    submission_id: submissionId,
    received_at: receivedAt,
    public_folder_prefix: publicFolderPrefix,
    submission_data_sha256: submissionDataSha256,
    asset_manifest: assetManifest
  };
  const stateDigestSha256 = sha256(canonicalJson(stateBinding));
  const stateKey = `arc1-intake-claim-v1:${stateDigestSha256}`;
  const totalAssetBytes = assetManifest.reduce((total, entry) => total + entry.size_bytes, 0);
  const assetManifestText = canonicalJson(assetManifest);
  const assetManifestSha256 = sha256(assetManifestText);
  const evidence = {
    version: "arc1-intake-evidence-v1",
    scope: "authoritative-netlify-intake-and-assets",
    site_id: siteId,
    site_url: "https://arc-intake-test.netlify.app/",
    form_id: formId,
    form_name: formName,
    submission_id: submissionId,
    received_at: receivedAt,
    intake_version: "arc-intake-v8",
    offer_contract_id: TEST_OFFER_CONTRACT_ID,
    budget_confirmed: TEST_BUDGET_CONFIRMATION,
    terms_accepted: TEST_TERMS_ACCEPTANCE,
    public_folder_prefix: publicFolderPrefix,
    submission_data_sha256: submissionDataSha256,
    asset_manifest: assetManifest,
    asset_manifest_sha256: assetManifestSha256,
    total_asset_bytes: totalAssetBytes,
    state_key: stateKey,
    state_digest_sha256: stateDigestSha256,
    claim_required_before_build: true,
    issued_at: issuedAt
  };
  const intakeEvidencePrivate = canonicalJson(evidence);
  const intakeEvidenceSha256 = sha256(intakeEvidencePrivate);
  const intakeEvidenceHmacSha256 = createHmac("sha256", evidenceSecret)
    .update(`arc1-intake-evidence-signature-v1\n${intakeEvidencePrivate}`, "utf8")
    .digest("hex");
  const claimCreatedAt = new Date(Math.max(Date.parse(issuedAt), Date.now() - 1_000)).toISOString();
  return {
    evidence,
    publicFolderPrefix,
    intakeEvidencePrivate,
    intakeEvidenceSha256,
    intakeEvidenceHmacSha256,
    assetManifestText,
    assetManifestSha256,
    privateInputs: {
      intake_evidence_secret: evidenceSecret,
      intake_evidence_private: intakeEvidencePrivate,
      intake_evidence_hmac_sha256: intakeEvidenceHmacSha256,
      expected_netlify_site_id: siteId,
      expected_netlify_form_id: formId,
      expected_netlify_form_name: formName,
      intake_claim_status: "CLAIMED",
      intake_claim_state_key: stateKey,
      intake_claim_state_digest_sha256: stateDigestSha256,
      intake_claim_evidence_sha256: intakeEvidenceSha256,
      intake_claim_public_folder_prefix: publicFolderPrefix,
      intake_claim_asset_manifest_sha256: assetManifestSha256,
      intake_claim_existing_preview_folder: "",
      intake_claim_created_at: claimCreatedAt
    },
    injectorOutputs: {
      trusted_event_prefix: publicFolderPrefix,
      intake_state_key: stateKey,
      intake_state_digest_sha256: stateDigestSha256,
      intake_evidence_sha256: intakeEvidenceSha256,
      submission_data_sha256: submissionDataSha256,
      asset_manifest_sha256: assetManifestSha256,
      validated_asset_manifest: assetManifestText
    }
  };
}
