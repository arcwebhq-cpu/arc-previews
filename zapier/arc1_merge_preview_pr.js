// ARC1 merge step — after the exact quality check succeeds, ready and squash-merge one bound preview PR.
// This step never authorizes or sends customer email.
const clean = value => String(value == null ? "" : value).trim();
const owner = clean(inputData.github_owner || "arcwebhq-cpu");
const repository = clean(inputData.github_repo || "arc-previews");
const baseBranch = clean(inputData.github_base_branch || "main");
const token = clean(inputData.github_token);
const previewFolder = clean(inputData.preview_folder).replace(/^\/+|\/+$/g, "").toLowerCase();
const previewBranch = clean(inputData.preview_branch);
const filePath = clean(inputData.file_path).replace(/^\/+/, "");
const contentSha256 = clean(inputData.content_sha256).toLowerCase();
const expectedHeadSha = clean(inputData.head_sha).toLowerCase();
const prNumber = Number(inputData.pr_number);
const requiredCheckName = "ARC preview quality/preview-quality";
const requiredCheckAppSlug = "github-actions";
const requiredCheckAppId = 15368;

if (!token) throw new Error("ARC_GITHUB_INVALID: github_token is required");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("ARC_GITHUB_INVALID: owner or repository");
}
if (baseBranch !== "main") throw new Error("ARC_PREVIEW_MERGE_INVALID: base branch must be main");
const suffix = previewFolder.match(/-([a-f0-9]{8})$/)?.[1] || "";
if (!suffix || previewBranch !== `arc-preview/${suffix}`) {
  throw new Error("ARC_PREVIEW_MERGE_INVALID: deterministic preview branch mismatch");
}
if (filePath !== `${previewFolder}/index.html`) throw new Error("ARC_PREVIEW_MERGE_INVALID: exact preview index path required");
if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw new Error("ARC_PREVIEW_MERGE_INVALID: source SHA-256");
if (!/^[a-f0-9]{40}$/.test(expectedHeadSha)) throw new Error("ARC_PREVIEW_MERGE_INVALID: head SHA");
if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("ARC_PREVIEW_MERGE_INVALID: PR number");
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
  throw new Error("ARC_PREVIEW_MERGE_INVALID: SHA-256 runtime unavailable");
}
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};

const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28"
};
const readBody = async response => {
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
};
const request = async (url, options = {}, allowed = []) => {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const body = await readBody(response);
  if (response.ok) return body;
  if (allowed.includes(response.status)) return { _status: response.status, _body: body };
  throw new Error(`ARC_GITHUB_FAILED: ${response.status} ${JSON.stringify(body).slice(0, 240)}`);
};
const wait = (status, proof) => ({
  status,
  send_preview_email: false,
  preview_folder: previewFolder,
  preview_branch: previewBranch,
  head_sha: expectedHeadSha,
  pr_number: prNumber,
  required_check: requiredCheckName,
  proof
});
const validatePull = pull => {
  if (clean(pull.base?.ref) !== baseBranch || clean(pull.head?.ref) !== previewBranch) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: PR base or head changed");
  }
  if (clean(pull.head?.sha).toLowerCase() !== expectedHeadSha) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: PR head SHA changed");
  }
};
const validateFiles = files => {
  if (!Array.isArray(files) || files.length !== 1) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: PR must change exactly one file");
  }
  const file = files[0];
  if (clean(file.filename) !== filePath || !new Set(["added", "modified"]).has(clean(file.status)) || file.previous_filename) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: PR file scope changed");
  }
};
const verifyHeadHtml = async () => {
  const content = await request(
    `${api}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(expectedHeadSha)}`
  );
  const encoded = clean(content.content).replace(/\s/g, "");
  if (!encoded) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: candidate preview content is empty");
  const html = Buffer.from(encoded, "base64").toString("utf8");
  if (!/<meta\s+name=["']arc-template-version["'][^>]*content=["']10\.0["']/i.test(html)) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: candidate is not ARC v10");
  }
  const robots = html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "";
  if (!/content=["'][^"']*\bnoindex\b/i.test(robots)) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: candidate preview is indexable");
  }
  const proofBlocks = html.match(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/gi) || [];
  const proofFolder = html.match(/<meta\s+name=["']arc-preview-folder["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] || "";
  const proofSha = html.match(/<meta\s+name=["']arc-preview-source-sha256["'][^>]*content=["']([a-f0-9]{64})["'][^>]*>/i)?.[1] || "";
  if (proofBlocks.length !== 1 || proofFolder !== previewFolder || proofSha.toLowerCase() !== contentSha256) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: candidate proof is not bound to this preview");
  }
  const sourceHtml = html.replace(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/i, "");
  if (await sha256Hex(sourceHtml) !== contentSha256) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: candidate source bytes changed");
  }
};
const buildMergeProof = pull => {
  const mergeCommitSha = clean(pull.merge_commit_sha).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(mergeCommitSha)) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: merge commit SHA");
  if (!pull.merged_at || clean(pull.state) !== "closed") throw new Error("ARC_PREVIEW_MERGE_MISMATCH: PR is not merged");
  return JSON.stringify({
    version: "arc-preview-merge-proof-v1",
    preview_folder: previewFolder,
    preview_branch: previewBranch,
    file_path: filePath,
    content_sha256: contentSha256,
    head_sha: expectedHeadSha,
    pr_number: prNumber,
    check_name: requiredCheckName,
    check_app_slug: requiredCheckAppSlug,
    check_app_id: requiredCheckAppId,
    merge_commit_sha: mergeCommitSha,
    merged_at: clean(pull.merged_at)
  });
};

let pull = await request(`${api}/pulls/${prNumber}`);
validatePull(pull);
const files = await request(`${api}/pulls/${prNumber}/files?per_page=100`);
validateFiles(files);
await verifyHeadHtml();

const checks = await request(
  `${api}/commits/${expectedHeadSha}/check-runs?check_name=${encodeURIComponent(requiredCheckName)}&filter=latest&per_page=100`
);
const matchingChecks = (Array.isArray(checks.check_runs) ? checks.check_runs : [])
  .filter(check =>
    clean(check.name) === requiredCheckName &&
    clean(check.head_sha).toLowerCase() === expectedHeadSha &&
    clean(check.app?.slug) === requiredCheckAppSlug &&
    Number(check.app?.id) === requiredCheckAppId &&
    Number.isInteger(Number(check.id)) && Number(check.id) > 0
  )
  .sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
const latestCheck = matchingChecks[0];
if (!latestCheck) return wait("WAITING_FOR_PREVIEW_QUALITY", { quality_check: "missing" });
if (clean(latestCheck.status) !== "completed" || clean(latestCheck.conclusion) !== "success") {
  const terminalFailure = clean(latestCheck.status) === "completed" &&
    !["", "neutral", "skipped", "success"].includes(clean(latestCheck.conclusion));
  return wait(terminalFailure ? "BLOCKED_BY_PREVIEW_QUALITY" : "WAITING_FOR_PREVIEW_QUALITY", {
    quality_check: terminalFailure ? clean(latestCheck.conclusion) : "pending"
  });
}

if (pull.merged_at) {
  return {
    status: "ALREADY_MERGED",
    send_preview_email: false,
    preview_folder: previewFolder,
    preview_branch: previewBranch,
    head_sha: expectedHeadSha,
    pr_number: prNumber,
    merge_commit_sha: clean(pull.merge_commit_sha).toLowerCase(),
    merge_proof: buildMergeProof(pull)
  };
}
if (clean(pull.state) !== "open") throw new Error("ARC_PREVIEW_MERGE_MISMATCH: unmerged PR is not open");

let markedReady = false;
if (pull.draft) {
  const nodeId = clean(pull.node_id);
  if (!nodeId) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: draft PR node id missing");
  const readyResult = await request("https://api.github.com/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: "mutation MarkArcPreviewReady($pullRequestId: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) { pullRequest { number isDraft headRefOid } } }",
      variables: { pullRequestId: nodeId }
    })
  });
  if (Array.isArray(readyResult.errors) && readyResult.errors.length) {
    throw new Error(`ARC_GITHUB_FAILED: ready-for-review ${JSON.stringify(readyResult.errors).slice(0, 200)}`);
  }
  const readyPull = readyResult.data?.markPullRequestReadyForReview?.pullRequest;
  if (Number(readyPull?.number) !== prNumber || readyPull?.isDraft !== false || clean(readyPull?.headRefOid).toLowerCase() !== expectedHeadSha) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: ready-for-review proof");
  }
  markedReady = true;
  pull = await request(`${api}/pulls/${prNumber}`);
  validatePull(pull);
  if (pull.draft) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: PR remained draft");
}

const merged = await request(`${api}/pulls/${prNumber}/merge`, {
  method: "PUT",
  body: JSON.stringify({
    sha: expectedHeadSha,
    merge_method: "squash",
    commit_title: `ARC preview: ${previewFolder}`,
    commit_message: `Validated by ${requiredCheckName} for ${expectedHeadSha}.`
  })
}, [405, 409]);
if (merged._status === 405) {
  return wait("WAITING_FOR_MERGE_REQUIREMENTS", { quality_check: "success", marked_ready: markedReady });
}
if (merged._status === 409) {
  throw new Error("ARC_PREVIEW_MERGE_CONFLICT: PR head changed before squash merge");
}
if (merged.merged !== true || !/^[a-f0-9]{40}$/i.test(clean(merged.sha))) {
  throw new Error(`ARC_PREVIEW_MERGE_FAILED: ${clean(merged.message) || "GitHub did not confirm merge"}`);
}

pull = await request(`${api}/pulls/${prNumber}`);
validatePull(pull);
if (clean(pull.merge_commit_sha).toLowerCase() !== clean(merged.sha).toLowerCase()) {
  throw new Error("ARC_PREVIEW_MERGE_MISMATCH: merge commit read-back changed");
}

return {
  status: "MERGED",
  send_preview_email: false,
  marked_ready: markedReady,
  preview_folder: previewFolder,
  preview_branch: previewBranch,
  head_sha: expectedHeadSha,
  pr_number: prNumber,
  merge_commit_sha: clean(merged.sha).toLowerCase(),
  merge_proof: buildMergeProof(pull)
};
