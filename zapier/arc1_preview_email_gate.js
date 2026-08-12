// ARC1 polling/status step — fail closed until CI, merge, Pages, and private email state all prove ready.
// A token-bound Git ref is the atomic one-time claim; persist next_email_state before invoking email for auditability.
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
const emailStateToken = clean(inputData.email_state_token);
const customerEmail = clean(inputData.customer_email).toLowerCase();

if (!token) throw new Error("ARC_GITHUB_INVALID: github_token is required");
if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error("ARC_GITHUB_INVALID: owner or repository");
}
if (baseBranch !== "main") throw new Error("ARC_PREVIEW_GATE_INVALID: base branch must be main");
const suffix = previewFolder.match(/-([a-f0-9]{8})$/)?.[1] || "";
if (!suffix || previewBranch !== `arc-preview/${suffix}`) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: deterministic preview branch mismatch");
}
if (filePath !== `${previewFolder}/index.html`) throw new Error("ARC_PREVIEW_GATE_INVALID: exact preview index path required");
if (!/^[a-f0-9]{64}$/.test(contentSha256)) throw new Error("ARC_PREVIEW_GATE_INVALID: source SHA-256");
if (!/^[a-f0-9]{40}$/.test(expectedHeadSha)) throw new Error("ARC_PREVIEW_GATE_INVALID: head SHA");
if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("ARC_PREVIEW_GATE_INVALID: PR number");
if (!/^[A-Za-z0-9_-]{32,128}$/.test(emailStateToken)) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: private email state token");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: customer email");
}

const sha256Hex = async value => {
  if (!globalThis.crypto?.subtle) throw new Error("ARC_PREVIEW_GATE_INVALID: SHA-256 runtime unavailable");
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const tokenSha256 = await sha256Hex(emailStateToken);
const recipientSha256 = await sha256Hex(customerEmail);
let emailState;
try {
  emailState = typeof inputData.email_state === "string"
    ? JSON.parse(inputData.email_state)
    : inputData.email_state;
} catch (error) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: private email_state JSON");
}
if (!emailState || typeof emailState !== "object" || Array.isArray(emailState)) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: private email_state object");
}
if (clean(emailState.version) !== "arc-preview-email-state-v1") {
  throw new Error("ARC_PREVIEW_GATE_INVALID: email state version");
}
if (clean(emailState.token_sha256).toLowerCase() !== tokenSha256) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: email state token does not match");
}
if (
  clean(emailState.preview_folder).toLowerCase() !== previewFolder ||
  clean(emailState.content_sha256).toLowerCase() !== contentSha256 ||
  clean(emailState.head_sha).toLowerCase() !== expectedHeadSha ||
  clean(emailState.recipient_sha256).toLowerCase() !== recipientSha256 ||
  Number(emailState.pr_number) !== prNumber
) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: email state is not bound to this exact preview");
}
const emailStatus = clean(emailState.status).toUpperCase();
if (!new Set(["PENDING", "CLAIMED", "SENT"]).has(emailStatus)) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: email state status");
}
if (emailStatus !== "PENDING") {
  return {
    status: emailStatus === "SENT" ? "ALREADY_EMAILED" : "EMAIL_ALREADY_CLAIMED",
    send_preview_email: false,
    preview_folder: previewFolder,
    head_sha: expectedHeadSha,
    pr_number: prNumber,
    email_state_status: emailStatus
  };
}
const emailStateCreatedAt = Date.parse(clean(emailState.created_at));
const emailStateExpiresAt = Date.parse(clean(emailState.expires_at));
const now = Date.now();
if (
  !Number.isFinite(emailStateCreatedAt) || !Number.isFinite(emailStateExpiresAt) ||
  emailStateCreatedAt > now + 5 * 60 * 1000 ||
  emailStateExpiresAt <= now || emailStateExpiresAt <= emailStateCreatedAt
) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: email state expired");
}
if (emailStateExpiresAt - emailStateCreatedAt > 24 * 60 * 60 * 1000) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: email state TTL exceeds 24 hours");
}

let mergeProof;
try {
  mergeProof = typeof inputData.merge_proof === "string"
    ? JSON.parse(inputData.merge_proof)
    : inputData.merge_proof;
} catch (error) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: merge proof JSON");
}
if (!mergeProof || typeof mergeProof !== "object" || Array.isArray(mergeProof)) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: merge proof object");
}
if (
  clean(mergeProof.version) !== "arc-preview-merge-proof-v1" ||
  clean(mergeProof.preview_folder).toLowerCase() !== previewFolder ||
  clean(mergeProof.preview_branch) !== previewBranch ||
  clean(mergeProof.file_path) !== filePath ||
  clean(mergeProof.content_sha256).toLowerCase() !== contentSha256 ||
  clean(mergeProof.head_sha).toLowerCase() !== expectedHeadSha ||
  Number(mergeProof.pr_number) !== prNumber ||
  clean(mergeProof.check_name) !== requiredCheckName ||
  clean(mergeProof.check_app_slug) !== requiredCheckAppSlug ||
  Number(mergeProof.check_app_id) !== requiredCheckAppId
) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: merge proof is not bound to this exact preview");
}
const mergeCommitSha = clean(mergeProof.merge_commit_sha).toLowerCase();
if (!/^[a-f0-9]{40}$/.test(mergeCommitSha) || !clean(mergeProof.merged_at)) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: merge proof completion fields");
}

const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
const githubHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28"
};
const request = async (url, options = {}, allowed = []) => {
  const response = await fetch(url, { ...options, headers: { ...githubHeaders, ...(options.headers || {}) } });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
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

const pull = await request(`${api}/pulls/${prNumber}`);
if (clean(pull.base?.ref) !== baseBranch || clean(pull.head?.ref) !== previewBranch) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: PR base or head changed");
}
if (clean(pull.head?.sha).toLowerCase() !== expectedHeadSha) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: PR head SHA changed after validation");
}
const pullFiles = await request(`${api}/pulls/${prNumber}/files?per_page=100`);
if (!Array.isArray(pullFiles) || pullFiles.length !== 1) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: PR must change exactly one file");
}
if (
  clean(pullFiles[0].filename) !== filePath ||
  !new Set(["added", "modified"]).has(clean(pullFiles[0].status)) ||
  pullFiles[0].previous_filename
) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: PR file scope changed");
}
if (!pull.merged_at || clean(pull.state) !== "closed") {
  return wait("WAITING_FOR_PR_MERGE", { quality_check: "success", pr_merged: false });
}
if (clean(pull.merge_commit_sha).toLowerCase() !== mergeCommitSha || clean(pull.merged_at) !== clean(mergeProof.merged_at)) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: merge proof changed");
}

const inspectPublishedHtml = async html => {
  if (!/<meta\s+name=["']arc-template-version["'][^>]*content=["']10\.0["']/i.test(html)) {
    return { ok: false, reason: "v10-marker" };
  }
  const robots = html.match(/<meta\s+name=["']robots["'][^>]*>/i)?.[0] || "";
  if (!/content=["'][^"']*\bnoindex\b/i.test(robots)) return { ok: false, reason: "noindex" };
  const folder = html.match(/<meta\s+name=["']arc-preview-folder["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] || "";
  const hash = html.match(/<meta\s+name=["']arc-preview-source-sha256["'][^>]*content=["']([a-f0-9]{64})["'][^>]*>/i)?.[1] || "";
  if (folder !== previewFolder || hash.toLowerCase() !== contentSha256) return { ok: false, reason: "folder-or-hash-marker" };
  const proofMatches = html.match(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/gi) || [];
  if (proofMatches.length !== 1) return { ok: false, reason: "proof-block-count" };
  const source = html.replace(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/i, "");
  if (await sha256Hex(source) !== contentSha256) return { ok: false, reason: "source-bytes" };
  return { ok: true };
};

const mergedContent = await request(
  `${api}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(mergeCommitSha)}`
);
const mergedHtml = Buffer.from(clean(mergedContent.content).replace(/\s/g, ""), "base64").toString("utf8");
const mergedInspection = await inspectPublishedHtml(mergedHtml);
if (!mergedInspection.ok) {
  throw new Error(`ARC_PREVIEW_GATE_MISMATCH: merged preview content ${mergedInspection.reason}`);
}
const mainContent = await request(
  `${api}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(baseBranch)}`
);
const mainHtml = Buffer.from(clean(mainContent.content).replace(/\s/g, ""), "base64").toString("utf8");
const mainInspection = await inspectPublishedHtml(mainHtml);
if (!mainInspection.ok) {
  throw new Error(`ARC_PREVIEW_GATE_MISMATCH: current main preview content ${mainInspection.reason}`);
}

const previewUrl = new URL(clean(inputData.preview_url));
if (previewUrl.protocol !== "https:") throw new Error("ARC_PREVIEW_GATE_INVALID: preview URL must use HTTPS");
const pagesBaseUrl = new URL(clean(inputData.pages_base_url || `https://${owner}.github.io/${repository}`));
if (
  pagesBaseUrl.protocol !== "https:" ||
  pagesBaseUrl.username ||
  pagesBaseUrl.password ||
  pagesBaseUrl.search ||
  pagesBaseUrl.hash ||
  pagesBaseUrl.origin.toLowerCase() !== `https://${owner.toLowerCase()}.github.io` ||
  decodeURIComponent(pagesBaseUrl.pathname).replace(/\/+$/, "").toLowerCase() !== `/${repository.toLowerCase()}` ||
  previewUrl.username ||
  previewUrl.password ||
  previewUrl.search ||
  previewUrl.hash ||
  previewUrl.origin !== pagesBaseUrl.origin
) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: preview URL origin mismatch");
}
const expectedPath = `${decodeURIComponent(pagesBaseUrl.pathname).replace(/\/+$/, "")}/${previewFolder}/`;
if (decodeURIComponent(previewUrl.pathname) !== expectedPath) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: live preview URL folder mismatch");
}
previewUrl.search = "";
previewUrl.hash = "";
const liveResponse = await fetch(previewUrl.toString(), {
  method: "GET",
  headers: { Accept: "text/html" },
  redirect: "follow"
});
if (liveResponse.status !== 200) {
  return wait("WAITING_FOR_PAGES", { quality_check: "success", pr_merged: true, live_status: liveResponse.status });
}
const finalUrl = new URL(liveResponse.url || previewUrl.toString());
if (finalUrl.origin !== previewUrl.origin || decodeURIComponent(finalUrl.pathname) !== expectedPath) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: Pages redirected away from the exact preview folder");
}
const liveHtml = await liveResponse.text();
const liveInspection = await inspectPublishedHtml(liveHtml);
if (!liveInspection.ok) {
  return wait("WAITING_FOR_PAGES", {
    quality_check: "success",
    pr_merged: true,
    live_status: 200,
    live_proof: liveInspection.reason
  });
}

// Bind the public claim to immutable preview identity. Rotating caller-provided
// private state cannot create a second claim for the same approved preview.
const claimToken = await sha256Hex(`arc-preview-email-v1\n${owner.toLowerCase()}/${repository.toLowerCase()}\n${previewFolder}\n${contentSha256}\n${expectedHeadSha}\n${prNumber}`);
const claimRef = `refs/tags/arc-preview-email/${claimToken}`;
const claim = await request(`${api}/git/refs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ref: claimRef, sha: mergeCommitSha })
}, [422]);
if (claim._status) {
  const existingClaim = await request(`${api}/git/ref/${encodeURIComponent(claimRef.replace(/^refs\//, ""))}`);
  if (clean(existingClaim.object?.sha).toLowerCase() !== mergeCommitSha) {
    throw new Error("ARC_PREVIEW_GATE_MISMATCH: email claim ref points to another merge");
  }
  return {
    status: "EMAIL_ALREADY_CLAIMED",
    send_preview_email: false,
    preview_folder: previewFolder,
    head_sha: expectedHeadSha,
    pr_number: prNumber,
    email_state_status: "CLAIMED",
    email_claim_token_sha256: claimToken
  };
}
const nextEmailState = {
  ...emailState,
  status: "CLAIMED",
  claim_token_sha256: claimToken,
  proof: {
    check_name: requiredCheckName,
    head_sha: expectedHeadSha,
    pr_number: prNumber,
    merged_at: clean(pull.merged_at),
    preview_url: previewUrl.toString(),
    content_sha256: contentSha256,
    merge_commit_sha: mergeCommitSha,
    claim_ref_sha256: claimToken
  }
};

return {
  status: "READY_TO_SEND_PREVIEW_EMAIL",
  send_preview_email: true,
  state_write_required_before_email: true,
  next_email_state: JSON.stringify(nextEmailState),
  email_claim_token_sha256: claimToken,
  customer_email: customerEmail,
  preview_folder: previewFolder,
  preview_url: previewUrl.toString(),
  preview_branch: previewBranch,
  head_sha: expectedHeadSha,
  content_sha256: contentSha256,
  pr_number: prNumber,
  required_check: requiredCheckName
};
