import { createHash, createHmac } from "node:crypto";

export const TEST_INTAKE_EVIDENCE_SECRET = "arc-test-intake-evidence-secret-32-bytes-minimum";
export const TEST_ASSET_PUBLICATION_RECEIPT_SECRET = "arc-test-asset-publication-secret-32-bytes-minimum";
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
  assetGitBlobSha1ByRole = {},
  businessName = "Ironwood Roofing Concept",
  receivedAt = new Date(Date.now() - 60_000).toISOString(),
  issuedAt = new Date().toISOString(),
  submissionId = "223e4567-e89b-42d3-a456-426614174000",
  siteId = TEST_NETLIFY_SITE_ID,
  formId = TEST_NETLIFY_FORM_ID,
  formName = TEST_NETLIFY_FORM_NAME,
  evidenceSecret = TEST_INTAKE_EVIDENCE_SECRET,
  publicationReceiptSecret = TEST_ASSET_PUBLICATION_RECEIPT_SECRET,
  submissionDataSha256 = "b".repeat(64)
} = {}) {
  const bridgeContractSha256 = "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2";
  const siteIdSha256 = sha256(siteId);
  const deliveryId = sha256("arc-test-function-delivery");
  const bridgeEvidenceSha256 = sha256("arc-test-function-bridge-evidence");
  const privateAssetReceiptSha256 = sha256("arc-test-private-asset-receipt");
  const publicFolderPrefix = sha256([
    "arc-preview-folder-v2",
    bridgeContractSha256,
    siteIdSha256,
    submissionId,
    receivedAt
  ].join("\n")).slice(0, 8);
  const stateBinding = {
    version: "arc1-intake-state-v2",
    bridge_contract_sha256: bridgeContractSha256,
    site_id_sha256: siteIdSha256,
    delivery_id: deliveryId,
    submission_id: submissionId,
    received_at: receivedAt,
    public_folder_prefix: publicFolderPrefix,
    submission_data_sha256: submissionDataSha256,
    asset_manifest: assetManifest
  };
  const stateDigestSha256 = sha256(canonicalJson(stateBinding));
  const stateKey = `arc1-intake-claim-v2:${stateDigestSha256}`;
  const totalAssetBytes = assetManifest.reduce((total, entry) => total + entry.size_bytes, 0);
  const assetManifestText = canonicalJson(assetManifest);
  const assetManifestSha256 = sha256(assetManifestText);
  const evidence = {
    version: "arc1-intake-evidence-v2",
    scope: "authoritative-first-party-function-intake",
    bridge_contract_sha256: bridgeContractSha256,
    site_id_sha256: siteIdSha256,
    source_schema: "arc-intake-function-submission-v1",
    source_form_name: "arc-preview-function-v1",
    source_key_hmac_sha256: sha256("arc-test-source-key"),
    delivery_id: deliveryId,
    submission_id: submissionId,
    received_at: receivedAt,
    intake_version: "arc-intake-v8",
    offer_contract_id: TEST_OFFER_CONTRACT_ID,
    budget_confirmed: TEST_BUDGET_CONFIRMATION,
    terms_accepted: TEST_TERMS_ACCEPTANCE,
    asset_permission: assetManifest.length ? "Confirmed rights and no visible watermark v1" : "",
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
    .update(`arc1-intake-evidence-signature-v2\n${intakeEvidencePrivate}`, "utf8")
    .digest("hex");
  const slug = String(businessName).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/g, "");
  const previewFolder = `${slug}-${publicFolderPrefix}`;
  const pagesBaseUrl = "https://arcwebhq-cpu.github.io/arc-previews";
  const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const publicationEntries = assetManifest.map(asset => {
    const extension = extensions[asset.content_type];
    if (!extension || asset.kind !== "UPLOAD" || !/^[a-f0-9]{64}$/.test(asset.asset_id)) {
      throw new Error("test Function asset manifest is invalid");
    }
    const repositoryPath = `${previewFolder}/assets/${asset.sha256}.${extension}`;
    return {
      asset_id: asset.asset_id,
      content_type: asset.content_type,
      git_blob_sha1: assetGitBlobSha1ByRole[asset.role] || "c".repeat(40),
      public_url: `${pagesBaseUrl}/${repositoryPath}`,
      repository_path: repositoryPath,
      role: asset.role,
      sha256: asset.sha256,
      size_bytes: asset.size_bytes
    };
  });
  const authorizedReviewerIdSha256 = sha256("arc-test-authorized-image-reviewer");
  const publicationReceipt = canonicalJson({
    version: "arc1-public-asset-publication-receipt-v1",
    scope: "github-content-addressed-preview-assets",
    bridge_contract_sha256: bridgeContractSha256,
    delivery_id: deliveryId,
    bridge_evidence_sha256: bridgeEvidenceSha256,
    private_asset_receipt_sha256: privateAssetReceiptSha256,
    intake_evidence_sha256: intakeEvidenceSha256,
    intake_state_digest_sha256: stateDigestSha256,
    asset_manifest_sha256: assetManifestSha256,
    asset_permission: assetManifest.length ? "Confirmed rights and no visible watermark v1" : "",
    asset_visual_review_authority_verified: assetManifest.length > 0,
    asset_visual_review_key_id: assetManifest.length ? "01" : "",
    asset_visual_review_reviewer_id_sha256: assetManifest.length ? authorizedReviewerIdSha256 : "",
    asset_visual_review_sha256: assetManifest.length ? sha256(`arc-test-asset-review:${assetManifestSha256}`) : "",
    repository: "arcwebhq-cpu/arc-previews",
    base_branch: "main",
    preview_branch: `arc-preview/${publicFolderPrefix}`,
    pages_base_url: pagesBaseUrl,
    public_folder_prefix: publicFolderPrefix,
    preview_folder: previewFolder,
    entries: publicationEntries,
    status: assetManifest.length ? "HUMAN_REVIEWED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS"
  });
  const assetPublicationReceiptSha256 = sha256(publicationReceipt);
  const assetPublicationReceiptHmacSha256 = createHmac("sha256", publicationReceiptSecret)
    .update(`arc1-public-asset-publication-receipt-v1\n${publicationReceipt}`, "utf8").digest("hex");
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
      asset_publication_receipt_secret: publicationReceiptSecret,
      asset_publication_receipt_private: publicationReceipt,
      asset_publication_receipt_hmac_sha256: assetPublicationReceiptHmacSha256,
      asset_publication_receipt_sha256: assetPublicationReceiptSha256,
      ingress_claim_asset_receipt_sha256: privateAssetReceiptSha256,
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
      validated_asset_manifest: assetManifestText,
      asset_publication_receipt_sha256: assetPublicationReceiptSha256
    }
  };
}
