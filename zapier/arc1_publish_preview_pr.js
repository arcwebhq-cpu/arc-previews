// ARC1 Code step — atomically publish one preview candidate to a deterministic branch.
// This step never authorizes or sends customer email. A separate proof gate does that.
const clean = value => String(value == null ? "" : value).trim();
const owner = clean(inputData.github_owner || "arcwebhq-cpu");
const repository = clean(inputData.github_repo || "arc-previews");
const baseBranch = clean(inputData.github_base_branch || "main");
const token = clean(inputData.github_token);
const trustedEventPrefix = clean(inputData.trusted_event_prefix).toLowerCase();
const previewFolder = clean(inputData.preview_folder).replace(/^\/+|\/+$/g, "").toLowerCase();
const filePath = clean(inputData.file_path).replace(/^\/+/, "");
const sourceHtml = clean(inputData.html_content);
const customerEmail = clean(inputData.customer_email).toLowerCase();
const previewBranch = `arc-preview/${trustedEventPrefix}`;
const expectedFilePath = `${previewFolder}/index.html`;
const validationPass = inputData.validation_pass === true || clean(inputData.validation_pass).toLowerCase() === "true";

if (!token) throw new Error("ARC_GITHUB_INVALID: github_token is required");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("ARC_GITHUB_INVALID: owner or repository");
}
if (baseBranch !== "main") throw new Error("ARC_GITHUB_INVALID: ARC preview PRs must target main");
if (!/^[a-f0-9]{8}$/.test(trustedEventPrefix)) throw new Error("ARC_PREVIEW_PUBLISH_INVALID: trusted event prefix must be exactly eight hexadecimal characters");
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder) || !previewFolder.endsWith(`-${trustedEventPrefix}`)) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: preview folder must end in the trusted event prefix");
}
if (filePath !== expectedFilePath) throw new Error("ARC_PREVIEW_PUBLISH_INVALID: exact preview index path required");
if (!validationPass) throw new Error("ARC_PREVIEW_PUBLISH_INVALID: ARC validator pass is required");
if (!sourceHtml || !/<meta\s+name=["']arc-template-version["'][^>]*content=["']10\.0["']/i.test(sourceHtml)) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: verified ARC v10 marker required");
}
if (customerEmail && sourceHtml.toLowerCase().includes(customerEmail)) {
  throw new Error("ARC_PRIVACY_FAILED: requester email appeared in public preview HTML");
}
const robotsTag = sourceHtml.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "";
if (!/content=["'][^"']*\bnoindex\b/i.test(robotsTag)) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: preview must remain noindex");
}
if (!/<\/head>/i.test(sourceHtml)) throw new Error("ARC_PREVIEW_PUBLISH_INVALID: closing head tag required");
if (/ARC_PREVIEW_PROOF_(?:START|END)|arc-preview-(?:folder|source-sha256)/i.test(sourceHtml)) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: source already contains a publish proof marker");
}

const sha256Hex = async value => {
  if (!globalThis.crypto?.subtle) throw new Error("ARC_PREVIEW_PUBLISH_INVALID: SHA-256 runtime unavailable");
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ARC1_INTAKE_INVALID: non-finite evidence value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC1_INTAKE_INVALID: evidence must be plain JSON");
};
const intakeEvidenceSecret = clean(inputData.intake_evidence_secret);
const evidenceEncoder = new TextEncoder();
if (evidenceEncoder.encode(intakeEvidenceSecret).length < 32 || evidenceEncoder.encode(intakeEvidenceSecret).length > 256) {
  throw new Error("ARC1_INTAKE_INVALID: intake evidence secret must be 32–256 UTF-8 bytes");
}
const evidenceRaw = clean(inputData.intake_evidence_private);
let intakeEvidence;
try {
  intakeEvidence = JSON.parse(evidenceRaw);
} catch (error) {
  throw new Error("ARC1_INTAKE_INVALID: intake evidence JSON");
}
const evidenceFields = [
  "version", "scope", "site_id", "site_url", "form_id", "form_name", "submission_id", "received_at",
  "intake_version", "budget_confirmed", "terms_accepted", "public_folder_prefix", "submission_data_sha256",
  "asset_manifest", "total_asset_bytes", "state_key", "state_digest_sha256", "claim_required_before_build", "issued_at"
];
if (
  !intakeEvidence || typeof intakeEvidence !== "object" || Array.isArray(intakeEvidence) ||
  canonicalJson(intakeEvidence) !== evidenceRaw ||
  JSON.stringify(Object.keys(intakeEvidence).sort()) !== JSON.stringify(evidenceFields.slice().sort())
) {
  throw new Error("ARC1_INTAKE_INVALID: canonical intake evidence fields");
}
const externalId = value => /^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
const expectedSiteId = clean(inputData.expected_netlify_site_id).toLowerCase();
const expectedFormId = clean(inputData.expected_netlify_form_id).toLowerCase();
const expectedFormName = clean(inputData.expected_netlify_form_name);
const requiredBudgetConfirmation = "Yes, understands the finished ARC website is $5,000 only after preview approval";
const requiredTermsAcceptance = "Accepted ARC preview terms, privacy policy, refund policy, and service scope dated 2026-08-11; separate adult checkout acceptance required";
const receivedAt = clean(intakeEvidence.received_at);
const issuedAt = clean(intakeEvidence.issued_at);
const receivedMs = Date.parse(receivedAt);
const issuedMs = Date.parse(issuedAt);
const nowMs = Date.now();
const derivedPublicFolderPrefix = (await sha256Hex([
  "arc-preview-folder-v1", expectedSiteId, expectedFormId, clean(intakeEvidence.submission_id).toLowerCase(), receivedAt
].join("\n"))).slice(0, 8);
if (
  intakeEvidence.version !== "arc1-intake-evidence-v1" || intakeEvidence.scope !== "authoritative-netlify-intake-and-assets" ||
  !externalId(expectedSiteId) || !externalId(expectedFormId) || clean(intakeEvidence.site_id).toLowerCase() !== expectedSiteId ||
  clean(intakeEvidence.form_id).toLowerCase() !== expectedFormId || clean(intakeEvidence.form_name) !== expectedFormName ||
  !externalId(intakeEvidence.submission_id) || clean(intakeEvidence.public_folder_prefix) !== derivedPublicFolderPrefix ||
  derivedPublicFolderPrefix !== trustedEventPrefix ||
  intakeEvidence.intake_version !== "arc-intake-v7" || intakeEvidence.budget_confirmed !== requiredBudgetConfirmation ||
  intakeEvidence.terms_accepted !== requiredTermsAcceptance || !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.submission_data_sha256)) ||
  !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.state_digest_sha256)) ||
  clean(intakeEvidence.state_key) !== `arc1-intake-claim-v1:${clean(intakeEvidence.state_digest_sha256)}` ||
  intakeEvidence.claim_required_before_build !== true || !Number.isFinite(receivedMs) || !Number.isFinite(issuedMs) ||
  new Date(receivedMs).toISOString() !== receivedAt || new Date(issuedMs).toISOString() !== issuedAt ||
  receivedMs < nowMs - 24 * 60 * 60 * 1000 || receivedMs > nowMs + 5 * 60 * 1000 ||
  issuedMs < receivedMs - 5 * 60 * 1000 || issuedMs > nowMs + 5 * 60 * 1000
) {
  throw new Error("ARC1_INTAKE_INVALID: signed intake identity, consent, or timestamp binding");
}
const evidenceSignature = clean(inputData.intake_evidence_hmac_sha256).toLowerCase();
if (!/^[a-f0-9]{64}$/.test(evidenceSignature)) throw new Error("ARC1_INTAKE_INVALID: intake evidence HMAC");
const evidenceKey = await globalThis.crypto.subtle.importKey(
  "raw",
  evidenceEncoder.encode(intakeEvidenceSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["verify"]
);
const evidenceSignatureBytes = Uint8Array.from(evidenceSignature.match(/../g), byte => Number.parseInt(byte, 16));
if (!(await globalThis.crypto.subtle.verify(
  "HMAC",
  evidenceKey,
  evidenceSignatureBytes,
  evidenceEncoder.encode(`arc1-intake-evidence-signature-v1\n${evidenceRaw}`)
))) {
  throw new Error("ARC1_INTAKE_INVALID: intake evidence HMAC mismatch");
}
const intakeEvidenceSha256 = await sha256Hex(evidenceRaw);
const assetManifest = Array.isArray(intakeEvidence.asset_manifest) ? intakeEvidence.asset_manifest : null;
if (!assetManifest || assetManifest.length > 3 || canonicalJson(assetManifest) !== clean(inputData.validated_asset_manifest)) {
  throw new Error("ARC1_ASSET_INVALID: exact signed asset manifest");
}
const assetManifestSha256 = await sha256Hex(canonicalJson(assetManifest));
if (
  clean(inputData.intake_evidence_sha256).toLowerCase() !== intakeEvidenceSha256 ||
  clean(inputData.asset_manifest_sha256).toLowerCase() !== assetManifestSha256 ||
  clean(inputData.intake_state_key) !== clean(intakeEvidence.state_key) ||
  clean(inputData.intake_state_digest_sha256).toLowerCase() !== clean(intakeEvidence.state_digest_sha256) ||
  clean(inputData.submission_data_sha256).toLowerCase() !== clean(intakeEvidence.submission_data_sha256)
) {
  throw new Error("ARC1_INTAKE_INVALID: injector evidence outputs changed");
}
const assetInputs = {
  logo_file: inputData.logo_file_url,
  hero_image_file: inputData.hero_image_url,
  supporting_image_file: inputData.supporting_image_url
};
const roleOrder = ["logo_file", "hero_image_file", "supporting_image_file"];
let lastRoleIndex = -1;
let manifestTotal = 0;
for (const entry of assetManifest) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["content_type", "role", "sha256", "size_bytes", "source_url_sha256"].sort())) {
    throw new Error("ARC1_ASSET_INVALID: asset evidence fields");
  }
  const roleIndex = roleOrder.indexOf(clean(entry.role));
  const exactUrl = String(assetInputs[entry.role] == null ? "" : assetInputs[entry.role]);
  if (roleIndex <= lastRoleIndex || exactUrl !== exactUrl.trim() || !exactUrl ||
      await sha256Hex(exactUrl) !== clean(entry.source_url_sha256) || !/^[a-f0-9]{64}$/.test(clean(entry.sha256)) ||
      !new Set(["image/png", "image/jpeg", "image/webp"]).has(entry.content_type) ||
      !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 1 || entry.size_bytes > 2621440) {
    throw new Error("ARC1_ASSET_INVALID: asset URL/hash/type/size binding");
  }
  lastRoleIndex = roleIndex;
  manifestTotal += entry.size_bytes;
}
if (!Number.isSafeInteger(intakeEvidence.total_asset_bytes) || manifestTotal !== intakeEvidence.total_asset_bytes || manifestTotal > 7864320) {
  throw new Error("ARC1_ASSET_INVALID: asset manifest total mismatch");
}
for (const role of roleOrder) {
  if (Boolean(clean(assetInputs[role])) !== assetManifest.some(entry => entry.role === role)) {
    throw new Error("ARC1_ASSET_INVALID: unverified or missing mapped asset URL");
  }
}
const claimCreatedAt = clean(inputData.intake_claim_created_at);
const claimCreatedMs = Date.parse(claimCreatedAt);
if (
  clean(inputData.intake_claim_status).toLowerCase() !== "claimed" ||
  clean(inputData.intake_claim_state_key) !== clean(intakeEvidence.state_key) ||
  clean(inputData.intake_claim_state_digest_sha256).toLowerCase() !== clean(intakeEvidence.state_digest_sha256) ||
  clean(inputData.intake_claim_evidence_sha256).toLowerCase() !== intakeEvidenceSha256 ||
  clean(inputData.intake_claim_public_folder_prefix).toLowerCase() !== trustedEventPrefix ||
  clean(inputData.intake_claim_asset_manifest_sha256).toLowerCase() !== assetManifestSha256 ||
  clean(inputData.intake_claim_existing_preview_folder) || !Number.isFinite(claimCreatedMs) ||
  new Date(claimCreatedMs).toISOString() !== claimCreatedAt || claimCreatedMs < issuedMs - 5 * 60 * 1000 || claimCreatedMs > nowMs + 5 * 60 * 1000
) {
  throw new Error("ARC1_INTAKE_REPLAY_BLOCKED: matching atomic private-state claim is required before GitHub write");
}
for (const privateValue of [
  clean(intakeEvidence.submission_id), intakeEvidenceSecret, evidenceRaw, clean(intakeEvidence.state_key)
].filter(Boolean)) {
  if (sourceHtml.toLowerCase().includes(privateValue.toLowerCase())) {
    throw new Error("ARC_PRIVACY_FAILED: authoritative intake evidence appeared in public preview HTML");
  }
}
const contentSha256 = await sha256Hex(sourceHtml);
const renderEvidenceRaw = clean(inputData.render_evidence_private);
const renderEvidenceSignature = clean(inputData.render_evidence_hmac_sha256).toLowerCase();
let renderEvidence;
try {
  renderEvidence = JSON.parse(renderEvidenceRaw);
} catch (error) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: render evidence JSON");
}
const renderEvidenceFields = [
  "version", "scope", "preview_folder", "content_sha256", "intake_evidence_sha256",
  "state_digest_sha256", "submission_data_sha256", "asset_manifest_sha256"
];
if (
  !renderEvidence || typeof renderEvidence !== "object" || Array.isArray(renderEvidence) ||
  JSON.stringify(Object.keys(renderEvidence)) !== JSON.stringify(renderEvidenceFields) ||
  JSON.stringify(renderEvidence) !== renderEvidenceRaw ||
  !/^[a-f0-9]{64}$/.test(renderEvidenceSignature)
) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: canonical render evidence fields");
}
const renderEvidenceSignatureBytes = Uint8Array.from(
  renderEvidenceSignature.match(/../g),
  byte => Number.parseInt(byte, 16)
);
if (!(await globalThis.crypto.subtle.verify(
  "HMAC",
  evidenceKey,
  renderEvidenceSignatureBytes,
  evidenceEncoder.encode(`arc1-render-evidence-signature-v1\n${renderEvidenceRaw}`)
))) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: render evidence HMAC mismatch");
}
if (
  renderEvidence.version !== "arc1-render-evidence-v1" ||
  renderEvidence.scope !== "signed-sanitized-preview-render" ||
  renderEvidence.preview_folder !== previewFolder ||
  renderEvidence.content_sha256 !== contentSha256 ||
  clean(inputData.render_content_sha256).toLowerCase() !== contentSha256 ||
  renderEvidence.intake_evidence_sha256 !== intakeEvidenceSha256 ||
  renderEvidence.state_digest_sha256 !== clean(intakeEvidence.state_digest_sha256) ||
  renderEvidence.submission_data_sha256 !== clean(intakeEvidence.submission_data_sha256) ||
  renderEvidence.asset_manifest_sha256 !== assetManifestSha256
) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: render evidence is not bound to the exact sanitized preview");
}
const proofBlock = `<!-- ARC_PREVIEW_PROOF_START -->\n<meta name="arc-preview-folder" content="${previewFolder}">\n<meta name="arc-preview-source-sha256" content="${contentSha256}">\n<!-- ARC_PREVIEW_PROOF_END -->\n`;
const publishedHtml = sourceHtml.replace(/<\/head>/i, `${proofBlock}</head>`);

const pagesBaseUrl = new URL(clean(inputData.pages_base_url || `https://${owner}.github.io/${repository}`));
if (pagesBaseUrl.protocol !== "https:") throw new Error("ARC_PREVIEW_PUBLISH_INVALID: Pages base URL must use HTTPS");
if (
  pagesBaseUrl.username ||
  pagesBaseUrl.password ||
  pagesBaseUrl.search ||
  pagesBaseUrl.hash ||
  pagesBaseUrl.origin.toLowerCase() !== `https://${owner.toLowerCase()}.github.io` ||
  decodeURIComponent(pagesBaseUrl.pathname).replace(/\/+$/, "").toLowerCase() !== `/${repository.toLowerCase()}`
) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: Pages base URL must match the GitHub repository");
}
pagesBaseUrl.search = "";
pagesBaseUrl.hash = "";
pagesBaseUrl.pathname = `${pagesBaseUrl.pathname.replace(/\/+$/, "")}/${previewFolder}/`;
const previewUrl = pagesBaseUrl.toString();

const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28"
};
const responseBody = async response => {
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
};
const request = async (url, options = {}, allowed = []) => {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (response.ok) return responseBody(response);
  if (allowed.includes(response.status)) return { _status: response.status, _body: await responseBody(response) };
  const body = await response.text().catch(() => "");
  throw new Error(`ARC_GITHUB_FAILED: ${response.status} ${body.slice(0, 240)}`);
};
const validSha = value => /^[a-f0-9]{40}$/i.test(clean(value));
const branchRefPath = branch => encodeURIComponent(`heads/${branch}`);
const getRef = async (branch, allowed = []) => request(`${api}/git/ref/${branchRefPath(branch)}`, {}, allowed);
const getCommitTree = async commitSha => {
  const commit = await request(`${api}/git/commits/${commitSha}`);
  const treeSha = clean(commit.tree?.sha);
  if (!validSha(treeSha)) throw new Error("ARC_GITHUB_FAILED: commit tree SHA");
  return treeSha;
};
const contentUrl = branch => `${api}/contents/${expectedFilePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`;
const readBranchHtml = async branch => {
  const content = await request(contentUrl(branch), {}, [404]);
  if (content._status) return null;
  const encoded = clean(content.content).replace(/\s/g, "");
  if (!encoded) throw new Error("ARC_GITHUB_FAILED: existing preview content is empty");
  return Buffer.from(encoded, "base64").toString("utf8");
};
const listMatchingPrs = async () => {
  const head = encodeURIComponent(`${owner}:${previewBranch}`);
  const pulls = await request(`${api}/pulls?state=all&head=${head}&base=${encodeURIComponent(baseBranch)}&per_page=100`);
  const exact = (Array.isArray(pulls) ? pulls : []).filter(pr =>
    clean(pr.base?.ref) === baseBranch && clean(pr.head?.ref) === previewBranch
  );
  if (exact.length > 1) throw new Error("ARC_PREVIEW_PR_CONFLICT: more than one matching PR exists");
  return exact[0] || null;
};

let matchingPr = await listMatchingPrs();
let branchRef = await getRef(previewBranch, [404]);
let branchHeadSha = branchRef._status ? "" : clean(branchRef.object?.sha);
if (branchHeadSha && !validSha(branchHeadSha)) throw new Error("ARC_GITHUB_FAILED: preview branch SHA");
if (!branchHeadSha && matchingPr?.merged_at) {
  const mergedHeadSha = clean(matchingPr.head?.sha);
  if (!validSha(mergedHeadSha)) throw new Error("ARC_PREVIEW_PR_CONFLICT: merged PR head SHA missing");
  const mergedHeadHtml = await readBranchHtml(mergedHeadSha);
  if (mergedHeadHtml !== publishedHtml) {
    throw new Error("ARC_PREVIEW_PR_CONFLICT: merged preview content differs from this replay");
  }
  branchHeadSha = mergedHeadSha;
}
const existingHtml = branchHeadSha ? await readBranchHtml(branchHeadSha) : null;
if (branchHeadSha && existingHtml === null) {
  throw new Error("ARC_PREVIEW_PR_CONFLICT: deterministic preview branch already belongs to another folder");
}
let commitCreated = false;

if (existingHtml !== publishedHtml) {
  if (matchingPr?.merged_at) {
    throw new Error("ARC_PREVIEW_PR_CONFLICT: merged preview content cannot be replaced on the same branch");
  }
  const parentRef = branchHeadSha ? branchRef : await getRef(baseBranch);
  const parentCommit = clean(parentRef.object?.sha);
  if (!validSha(parentCommit)) throw new Error("ARC_GITHUB_FAILED: parent branch SHA");
  const baseTree = await getCommitTree(parentCommit);
  const blob = await request(`${api}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: Buffer.from(publishedHtml, "utf8").toString("base64"), encoding: "base64" })
  });
  if (!validSha(blob.sha)) throw new Error("ARC_GITHUB_FAILED: preview blob SHA");
  const tree = await request(`${api}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTree,
      tree: [{ path: expectedFilePath, mode: "100644", type: "blob", sha: blob.sha }]
    })
  });
  if (!validSha(tree.sha)) throw new Error("ARC_GITHUB_FAILED: preview tree SHA");
  const commit = await request(`${api}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Publish ARC preview ${previewFolder}`,
      tree: tree.sha,
      parents: [parentCommit]
    })
  });
  const nextHeadSha = clean(commit.sha);
  if (!validSha(nextHeadSha)) throw new Error("ARC_GITHUB_FAILED: preview commit SHA");

  if (branchHeadSha) {
    const update = await request(`${api}/git/refs/${branchRefPath(previewBranch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: nextHeadSha, force: false })
    }, [409, 422]);
    if (update._status) {
      const racedRef = await getRef(previewBranch);
      const racedHead = clean(racedRef.object?.sha);
      const racedHtml = await readBranchHtml(previewBranch);
      if (!validSha(racedHead) || racedHtml !== publishedHtml) {
        throw new Error("ARC_PREVIEW_PR_CONFLICT: preview branch changed during atomic update");
      }
      branchHeadSha = racedHead;
    } else {
      branchHeadSha = nextHeadSha;
      commitCreated = true;
    }
  } else {
    const created = await request(`${api}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${previewBranch}`, sha: nextHeadSha })
    }, [422]);
    if (created._status) {
      const racedRef = await getRef(previewBranch);
      const racedHead = clean(racedRef.object?.sha);
      const racedHtml = await readBranchHtml(previewBranch);
      if (!validSha(racedHead) || racedHtml !== publishedHtml) {
        throw new Error("ARC_PREVIEW_PR_CONFLICT: deterministic preview branch already contains different content");
      }
      branchHeadSha = racedHead;
    } else {
      branchHeadSha = nextHeadSha;
      commitCreated = true;
    }
  }
}

if (!validSha(branchHeadSha)) throw new Error("ARC_GITHUB_FAILED: final preview head SHA");

let prCreated = false;
if (!matchingPr) {
  const createdPr = await request(`${api}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `ARC preview: ${previewFolder}`,
      head: previewBranch,
      base: baseBranch,
      draft: true,
      body: [
        "Automated ARC preview candidate.",
        "",
        `Folder: \`${previewFolder}\``,
        `Source SHA-256: \`${contentSha256}\``,
        "",
        "Customer email remains blocked until the exact quality check, merge, and live Pages proof all pass."
      ].join("\n")
    })
  }, [422]);
  if (createdPr._status) {
    matchingPr = await listMatchingPrs();
    if (!matchingPr) throw new Error("ARC_PREVIEW_PR_CONFLICT: PR creation failed and no reusable PR exists");
  } else {
    matchingPr = createdPr;
    prCreated = true;
  }
} else if (clean(matchingPr.state) === "closed" && !matchingPr.merged_at) {
  matchingPr = await request(`${api}/pulls/${matchingPr.number}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "open" })
  });
}

const prNumber = Number(matchingPr?.number);
if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("ARC_GITHUB_FAILED: PR number");
if (clean(matchingPr.base?.ref) !== baseBranch || clean(matchingPr.head?.ref) !== previewBranch) {
  throw new Error("ARC_PREVIEW_PR_CONFLICT: PR base or head does not match the preview contract");
}

return {
  status: prCreated ? "PR_CREATED" : commitCreated ? "PR_UPDATED" : "PR_REUSED",
  send_preview_email: false,
  email_gate_required: true,
  preview_folder: previewFolder,
  file_path: expectedFilePath,
  preview_branch: previewBranch,
  base_branch: baseBranch,
  head_sha: branchHeadSha,
  content_sha256: contentSha256,
  trusted_event_prefix: trustedEventPrefix,
  intake_state_key: clean(intakeEvidence.state_key),
  intake_state_digest_sha256: clean(intakeEvidence.state_digest_sha256),
  intake_evidence_sha256: intakeEvidenceSha256,
  submission_data_sha256: clean(intakeEvidence.submission_data_sha256),
  asset_manifest_sha256: assetManifestSha256,
  validated_asset_manifest: canonicalJson(assetManifest),
  preview_url: previewUrl,
  pr_number: prNumber,
  pr_url: clean(matchingPr.html_url),
  pr_state: clean(matchingPr.state),
  pr_draft: Boolean(matchingPr.draft),
  pr_merged: Boolean(matchingPr.merged_at)
};
