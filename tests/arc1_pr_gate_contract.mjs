import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createTestIntakeEvidence } from "./fixtures/intake_evidence.mjs";

const publisherSource = await readFile(new URL("../zapier/arc1_publish_preview_pr.js", import.meta.url), "utf8");
const mergeSource = await readFile(new URL("../zapier/arc1_merge_preview_pr.js", import.meta.url), "utf8");
const emailGateSource = await readFile(new URL("../zapier/arc1_preview_email_gate.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runPublisher = new AsyncFunction("inputData", "fetch", "Buffer", publisherSource);
const runMerge = new AsyncFunction("inputData", "fetch", "Buffer", mergeSource);
const runEmailGate = new AsyncFunction("inputData", "fetch", "Buffer", emailGateSource);

const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const intakeContext = createTestIntakeEvidence();
const trustedEventPrefix = intakeContext.publicFolderPrefix;
const folder = `summit-roofing-${trustedEventPrefix}`;
const filePath = `${folder}/index.html`;
const previewBranch = `arc-preview/${trustedEventPrefix}`;
const encodedPreviewBranch = encodeURIComponent(previewBranch);
const makeResponse = (status, body = {}, url = "") => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 404 ? "Not Found" : "OK",
  url,
  json: async () => body,
  text: async () => typeof body === "string" ? body : JSON.stringify(body)
});

class MockGitHubAndPages {
  constructor() {
    this.mainHead = "1".repeat(40);
    this.mainTree = "2".repeat(40);
    this.branchHead = "";
    this.branchHtml = "";
    this.nextSha = 16;
    this.blobs = new Map();
    this.trees = new Map();
    this.commits = new Map([[this.mainHead, { tree: this.mainTree, content: "" }]]);
    this.prs = [];
    this.prFiles = [{ filename: filePath, status: "added" }];
    this.checkRuns = [];
    this.claimRefs = new Map();
    this.branchCreateRace = "";
    this.liveStatus = 503;
    this.liveHtml = "";
    this.liveUrl = "";
    this.requests = [];
  }

  sha() {
    return (this.nextSha++).toString(16).padStart(40, "0");
  }

  syncPrHead() {
    for (const pr of this.prs) {
      if (pr.head.ref === previewBranch) pr.head.sha = this.branchHead;
    }
  }

  async fetch(rawUrl, options = {}) {
    const method = options.method || "GET";
    const url = new URL(rawUrl);
    this.requests.push({ rawUrl, method, body: options.body || "", headers: options.headers || {} });

    if (url.hostname !== "api.github.com") {
      return makeResponse(this.liveStatus, this.liveHtml, this.liveUrl || rawUrl);
    }

    if (method === "GET" && /\/commits\/[a-f0-9]{40}\/check-runs$/.test(url.pathname)) {
      return makeResponse(200, { total_count: this.checkRuns.length, check_runs: this.checkRuns });
    }

    if (method === "POST" && url.pathname === "/graphql") {
      const body = JSON.parse(options.body);
      const pr = this.prs.find(item => item.node_id === body.variables.pullRequestId);
      if (!pr) return makeResponse(200, { errors: [{ message: "Not Found" }] });
      pr.draft = false;
      return makeResponse(200, {
        data: {
          markPullRequestReadyForReview: {
            pullRequest: { number: pr.number, isDraft: false, headRefOid: pr.head.sha }
          }
        }
      });
    }

    const mergeMatch = url.pathname.match(/\/pulls\/(\d+)\/merge$/);
    if (method === "PUT" && mergeMatch) {
      const pr = this.prs.find(item => item.number === Number(mergeMatch[1]));
      if (!pr) return makeResponse(404, { message: "Not Found" });
      const body = JSON.parse(options.body);
      if (body.sha !== pr.head.sha) return makeResponse(409, { message: "Head changed" });
      assert.equal(body.merge_method, "squash");
      const mergeSha = this.sha();
      this.commits.set(mergeSha, { tree: this.commits.get(this.branchHead).tree, content: this.branchHtml });
      pr.state = "closed";
      pr.merged_at = "2026-08-11T22:00:00Z";
      pr.merge_commit_sha = mergeSha;
      return makeResponse(200, { merged: true, sha: mergeSha, message: "Merged" });
    }

    const filesMatch = url.pathname.match(/\/pulls\/(\d+)\/files$/);
    if (method === "GET" && filesMatch) return makeResponse(200, this.prFiles);

    const pullMatch = url.pathname.match(/\/pulls\/(\d+)$/);
    if (method === "GET" && pullMatch) {
      const pr = this.prs.find(item => item.number === Number(pullMatch[1]));
      return pr ? makeResponse(200, pr) : makeResponse(404, { message: "Not Found" });
    }
    if (method === "PATCH" && pullMatch) {
      const pr = this.prs.find(item => item.number === Number(pullMatch[1]));
      if (!pr) return makeResponse(404, { message: "Not Found" });
      Object.assign(pr, JSON.parse(options.body));
      return makeResponse(200, pr);
    }
    if (url.pathname.endsWith("/pulls") && method === "GET") {
      return makeResponse(200, this.prs);
    }
    if (url.pathname.endsWith("/pulls") && method === "POST") {
      const body = JSON.parse(options.body);
      const pr = {
        number: 42,
        node_id: "PR_mock_node_42",
        html_url: "https://github.com/arcwebhq-cpu/arc-previews/pull/42",
        state: "open",
        draft: body.draft,
        merged_at: null,
        merge_commit_sha: null,
        base: { ref: body.base },
        head: { ref: body.head, sha: this.branchHead }
      };
      this.prs.push(pr);
      return makeResponse(201, pr);
    }

    if (method === "GET" && url.pathname.includes("/git/ref/heads%2Fmain")) {
      return makeResponse(200, { object: { sha: this.mainHead } });
    }
    if (method === "GET" && url.pathname.includes(`/git/ref/heads%2F${encodedPreviewBranch}`)) {
      return this.branchHead
        ? makeResponse(200, { object: { sha: this.branchHead } })
        : makeResponse(404, { message: "Not Found" });
    }
    if (method === "GET" && url.pathname.includes("/git/ref/tags%2Farc-preview-email%2F")) {
      const refName = decodeURIComponent(url.pathname.split("/git/ref/")[1]);
      const claimedSha = this.claimRefs.get(refName);
      return claimedSha
        ? makeResponse(200, { object: { sha: claimedSha } })
        : makeResponse(404, { message: "Not Found" });
    }
    const commitMatch = url.pathname.match(/\/git\/commits\/([a-f0-9]{40})$/);
    if (method === "GET" && commitMatch) {
      const commit = this.commits.get(commitMatch[1]);
      return commit ? makeResponse(200, { tree: { sha: commit.tree } }) : makeResponse(404, { message: "Not Found" });
    }
    if (method === "GET" && url.pathname.includes(`/contents/${filePath}`)) {
      return this.branchHtml
        ? makeResponse(200, { content: Buffer.from(this.branchHtml, "utf8").toString("base64") })
        : makeResponse(404, { message: "Not Found" });
    }
    if (method === "POST" && url.pathname.endsWith("/git/blobs")) {
      const body = JSON.parse(options.body);
      const blobSha = this.sha();
      this.blobs.set(blobSha, body.content);
      return makeResponse(201, { sha: blobSha });
    }
    if (method === "POST" && url.pathname.endsWith("/git/trees")) {
      const body = JSON.parse(options.body);
      const treeSha = this.sha();
      this.trees.set(treeSha, body);
      return makeResponse(201, { sha: treeSha });
    }
    if (method === "POST" && url.pathname.endsWith("/git/commits")) {
      const body = JSON.parse(options.body);
      const tree = this.trees.get(body.tree);
      const blobSha = tree?.tree?.[0]?.sha;
      const content = Buffer.from(this.blobs.get(blobSha), "base64").toString("utf8");
      const commitSha = this.sha();
      this.commits.set(commitSha, { tree: body.tree, content });
      return makeResponse(201, { sha: commitSha });
    }
    if (method === "POST" && url.pathname.endsWith("/git/refs")) {
      const body = JSON.parse(options.body);
      if (body.ref.startsWith("refs/tags/arc-preview-email/")) {
        const refName = body.ref.replace(/^refs\//, "");
        if (this.claimRefs.has(refName)) return makeResponse(422, { message: "Reference already exists" });
        this.claimRefs.set(refName, body.sha);
        return makeResponse(201, { ref: body.ref, object: { sha: body.sha } });
      }
      assert.equal(body.ref, `refs/heads/${previewBranch}`);
      if (this.branchCreateRace) {
        if (this.branchCreateRace === "identical") {
          this.branchHead = body.sha;
          this.branchHtml = this.commits.get(body.sha).content;
        } else {
          this.branchHead = "e".repeat(40);
          this.branchHtml = "<!doctype html><title>conflicting branch</title>";
        }
        return makeResponse(422, { message: "Reference already exists" });
      }
      this.branchHead = body.sha;
      this.branchHtml = this.commits.get(body.sha).content;
      this.syncPrHead();
      return makeResponse(201, { object: { sha: this.branchHead } });
    }
    if (method === "PATCH" && url.pathname.includes(`/git/refs/heads%2F${encodedPreviewBranch}`)) {
      const body = JSON.parse(options.body);
      assert.equal(body.force, false);
      this.branchHead = body.sha;
      this.branchHtml = this.commits.get(body.sha).content;
      this.syncPrHead();
      return makeResponse(200, { object: { sha: this.branchHead } });
    }

    return makeResponse(404, { message: `Unhandled ${method} ${rawUrl}` });
  }
}

const sourceHtml = "<!doctype html><html><head>\n<meta name=\"robots\" content=\"noindex,nofollow,noarchive\">\n<meta name=\"arc-template-version\" content=\"10.0\">\n<title>Summit Roofing</title>\n</head><body data-arc-site-mode=\"preview\"><h1>Summit Roofing</h1></body></html>";
const pagesBaseUrl = "https://arcwebhq-cpu.github.io/arc-previews";
const previewUrl = `${pagesBaseUrl}/${folder}/`;
const customerEmail = "must-not-leak@example.com";
const mock = new MockGitHubAndPages();
const publisherInput = {
  github_token: "mock-github-token",
  trusted_event_prefix: trustedEventPrefix,
  preview_folder: folder,
  file_path: filePath,
  html_content: sourceHtml,
  validation_pass: true,
  pages_base_url: pagesBaseUrl,
  customer_email: customerEmail,
  ...intakeContext.privateInputs,
  ...intakeContext.injectorOutputs
};

const publisherValidationMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, validation_pass: false }, publisherValidationMock.fetch.bind(publisherValidationMock), Buffer),
  /ARC validator pass is required/
);
const publisherOriginMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, pages_base_url: "https://example.com/arc-previews" }, publisherOriginMock.fetch.bind(publisherOriginMock), Buffer),
  /Pages base URL must match the GitHub repository/
);
const publisherPrivacyMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, html_content: sourceHtml.replace("</body>", `${customerEmail}</body>`) }, publisherPrivacyMock.fetch.bind(publisherPrivacyMock), Buffer),
  /requester email appeared in public preview HTML/
);
const publisherUnsignedIntakeMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, intake_evidence_private: "" }, publisherUnsignedIntakeMock.fetch.bind(publisherUnsignedIntakeMock), Buffer),
  /intake evidence JSON/
);
assert.equal(publisherUnsignedIntakeMock.requests.length, 0);
const publisherFakeEvidenceMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, intake_evidence_hmac_sha256: "0".repeat(64) }, publisherFakeEvidenceMock.fetch.bind(publisherFakeEvidenceMock), Buffer),
  /intake evidence HMAC mismatch/
);
assert.equal(publisherFakeEvidenceMock.requests.length, 0);
const publisherReplayClaimMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, intake_claim_status: "PENDING" }, publisherReplayClaimMock.fetch.bind(publisherReplayClaimMock), Buffer),
  /matching atomic private-state claim is required/
);
assert.equal(publisherReplayClaimMock.requests.length, 0);

const published = await runPublisher(publisherInput, mock.fetch.bind(mock), Buffer);
assert.equal(published.status, "PR_CREATED");
assert.equal(published.send_preview_email, false);
assert.equal(published.email_gate_required, true);
assert.equal(published.preview_branch, previewBranch);
assert.equal(published.file_path, filePath);
assert.equal(published.content_sha256, sha256(sourceHtml));
assert.equal(published.preview_url, previewUrl);
assert.equal(published.pr_number, 42);
assert.equal(published.pr_draft, true);
assert.ok(mock.branchHtml.includes(`name="arc-preview-folder" content="${folder}"`));
assert.match(mock.branchHtml, new RegExp(`name="arc-preview-source-sha256" content="${published.content_sha256}"`));

const treeWrites = [...mock.trees.values()];
assert.equal(treeWrites.length, 1);
assert.deepEqual(treeWrites[0].tree, [{
  path: filePath,
  mode: "100644",
  type: "blob",
  sha: treeWrites[0].tree[0].sha
}]);
const prWrite = mock.requests.find(request => request.method === "POST" && request.rawUrl.endsWith("/pulls"));
assert.ok(prWrite, "publisher did not create the PR");
const prWriteBody = JSON.parse(prWrite.body);
assert.deepEqual({ head: prWriteBody.head, base: prWriteBody.base, draft: prWriteBody.draft }, {
  head: previewBranch,
  base: "main",
  draft: true
});
assert.equal(mock.prs.length, 1);
assert.equal(mock.requests.some(request => request.method === "PATCH" && request.rawUrl.includes("heads%2Fmain")), false);
assert.doesNotMatch(mock.requests.map(request => `${request.rawUrl}\n${request.body}`).join("\n"), /must-not-leak@example\.com/i);
assert.doesNotMatch(publisherSource, /inputData\.submission_id/);

const writeCountAfterPublish = mock.requests.filter(request => request.method !== "GET").length;
const replay = await runPublisher(publisherInput, mock.fetch.bind(mock), Buffer);
assert.equal(replay.status, "PR_REUSED");
assert.equal(replay.send_preview_email, false);
assert.equal(replay.head_sha, published.head_sha);
assert.equal(replay.pr_number, published.pr_number);
assert.equal(mock.prs.length, 1);
assert.equal(mock.requests.filter(request => request.method !== "GET").length, writeCountAfterPublish, "idempotent replay performed a write");

const updateMock = new MockGitHubAndPages();
const updateFirst = await runPublisher(publisherInput, updateMock.fetch.bind(updateMock), Buffer);
const changedSourceHtml = sourceHtml.replace("<h1>Summit Roofing</h1>", "<h1>Summit Roofing & Exteriors</h1>");
const updateSecond = await runPublisher({ ...publisherInput, html_content: changedSourceHtml }, updateMock.fetch.bind(updateMock), Buffer);
assert.equal(updateSecond.status, "PR_UPDATED");
assert.equal(updateSecond.pr_number, updateFirst.pr_number);
assert.notEqual(updateSecond.head_sha, updateFirst.head_sha);
assert.notEqual(updateSecond.content_sha256, updateFirst.content_sha256);
assert.equal(updateMock.prs.length, 1, "changed preview created a second PR");
assert.equal(updateMock.trees.size, 2);

const identicalRaceMock = new MockGitHubAndPages();
identicalRaceMock.branchCreateRace = "identical";
const identicalRace = await runPublisher(publisherInput, identicalRaceMock.fetch.bind(identicalRaceMock), Buffer);
assert.equal(identicalRace.status, "PR_CREATED");
assert.equal(identicalRace.send_preview_email, false);
assert.equal(identicalRaceMock.prs.length, 1);

const conflictingRaceMock = new MockGitHubAndPages();
conflictingRaceMock.branchCreateRace = "different";
await assert.rejects(
  runPublisher(publisherInput, conflictingRaceMock.fetch.bind(conflictingRaceMock), Buffer),
  /deterministic preview branch already contains different content/
);

const folderCollisionMock = new MockGitHubAndPages();
await runPublisher(publisherInput, folderCollisionMock.fetch.bind(folderCollisionMock), Buffer);
await assert.rejects(
  runPublisher({
    ...publisherInput,
    preview_folder: `different-business-${trustedEventPrefix}`,
    file_path: `different-business-${trustedEventPrefix}/index.html`
  }, folderCollisionMock.fetch.bind(folderCollisionMock), Buffer),
  /deterministic preview branch already belongs to another folder/
);

const mergeInput = {
  github_token: "mock-github-token",
  preview_folder: folder,
  preview_branch: published.preview_branch,
  file_path: filePath,
  content_sha256: published.content_sha256,
  head_sha: published.head_sha,
  pr_number: published.pr_number
};
const mergeMissingCheck = await runMerge(mergeInput, mock.fetch.bind(mock), Buffer);
assert.equal(mergeMissingCheck.status, "WAITING_FOR_PREVIEW_QUALITY");
assert.equal(mergeMissingCheck.send_preview_email, false);
assert.equal(mock.prs[0].draft, true);

mock.prFiles = [
  { filename: filePath, status: "added" },
  { filename: "unrelated.txt", status: "added" }
];
await assert.rejects(
  runMerge(mergeInput, mock.fetch.bind(mock), Buffer),
  /PR must change exactly one file/
);
mock.prFiles = [{ filename: filePath, status: "added" }];

const approvedCandidateHtml = mock.branchHtml;
mock.branchHtml = mock.branchHtml.replace("<h1>Summit Roofing</h1>", "<h1>Tampered candidate</h1>");
await assert.rejects(
  runMerge(mergeInput, mock.fetch.bind(mock), Buffer),
  /candidate source bytes changed/
);
mock.branchHtml = approvedCandidateHtml;

mock.checkRuns = [{
  id: 90,
  name: "ARC preview quality/preview-quality",
  head_sha: published.head_sha,
  status: "completed",
  conclusion: "failure",
  app: { slug: "github-actions", id: 15368 }
}];
const failedQuality = await runMerge(mergeInput, mock.fetch.bind(mock), Buffer);
assert.equal(failedQuality.status, "BLOCKED_BY_PREVIEW_QUALITY");
assert.equal(failedQuality.send_preview_email, false);
assert.equal(mock.prs[0].draft, true);

mock.checkRuns = [
  {
    id: 91,
    name: "ARC preview quality/preview-quality",
    head_sha: published.head_sha,
    status: "completed",
    conclusion: "success",
    app: { slug: "github-actions", id: 15368 }
  },
  {
    id: 92,
    name: "ARC preview quality/preview-quality",
    head_sha: published.head_sha,
    status: "in_progress",
    conclusion: null,
    app: { slug: "github-actions", id: 15368 }
  }
];
const newerPendingCheck = await runMerge(mergeInput, mock.fetch.bind(mock), Buffer);
assert.equal(newerPendingCheck.status, "WAITING_FOR_PREVIEW_QUALITY");
assert.equal(newerPendingCheck.send_preview_email, false);
assert.equal(mock.prs[0].draft, true);

mock.checkRuns = [{
  id: 93,
  name: "ARC preview quality/preview-quality",
  head_sha: published.head_sha,
  status: "completed",
  conclusion: "success",
  app: { slug: "github-actions", id: 15368 }
}];
const merged = await runMerge(mergeInput, mock.fetch.bind(mock), Buffer);
assert.equal(merged.status, "MERGED");
assert.equal(merged.send_preview_email, false);
assert.equal(merged.marked_ready, true);
assert.match(merged.merge_commit_sha, /^[a-f0-9]{40}$/);
const mergeProof = JSON.parse(merged.merge_proof);
assert.equal(mergeProof.version, "arc-preview-merge-proof-v1");
assert.equal(mergeProof.head_sha, published.head_sha);
assert.equal(mergeProof.file_path, filePath);
assert.equal(mergeProof.check_name, "ARC preview quality/preview-quality");
assert.equal(mergeProof.check_app_slug, "github-actions");
assert.equal(mergeProof.check_app_id, 15368);
assert.equal(mergeProof.merge_commit_sha, merged.merge_commit_sha);
const mergeWriteCount = mock.requests.filter(request => request.method !== "GET").length;
const mergeReplay = await runMerge(mergeInput, mock.fetch.bind(mock), Buffer);
assert.equal(mergeReplay.status, "ALREADY_MERGED");
assert.equal(mergeReplay.send_preview_email, false);
assert.equal(mergeReplay.merge_commit_sha, merged.merge_commit_sha);
assert.equal(mock.requests.filter(request => request.method !== "GET").length, mergeWriteCount, "merged replay performed a write");

mock.branchHead = "";
const writesBeforeDeletedBranchReplay = mock.requests.filter(request => request.method !== "GET").length;
const deletedBranchReplay = await runPublisher(publisherInput, mock.fetch.bind(mock), Buffer);
assert.equal(deletedBranchReplay.status, "PR_REUSED");
assert.equal(deletedBranchReplay.head_sha, published.head_sha);
assert.equal(deletedBranchReplay.send_preview_email, false);
assert.equal(mock.requests.filter(request => request.method !== "GET").length, writesBeforeDeletedBranchReplay, "merged/deleted-branch replay performed a write");
await assert.rejects(
  runPublisher({
    ...publisherInput,
    preview_folder: `different-business-${trustedEventPrefix}`,
    file_path: `different-business-${trustedEventPrefix}/index.html`
  }, mock.fetch.bind(mock), Buffer),
  /merged preview content differs from this replay/
);

const privateToken = "private_state_token_1234567890abcdef";
const emailStateCreatedAt = new Date().toISOString();
const pendingEmailState = {
  version: "arc-preview-email-state-v1",
  status: "PENDING",
  token_sha256: sha256(privateToken),
  recipient_sha256: sha256(customerEmail),
  created_at: emailStateCreatedAt,
  expires_at: new Date(Date.parse(emailStateCreatedAt) + 60 * 60 * 1000).toISOString(),
  preview_folder: folder,
  content_sha256: published.content_sha256,
  head_sha: published.head_sha,
  pr_number: published.pr_number
};
const gateInput = {
  github_token: "mock-github-token",
  preview_folder: folder,
  preview_branch: published.preview_branch,
  file_path: filePath,
  content_sha256: published.content_sha256,
  head_sha: published.head_sha,
  pr_number: published.pr_number,
  preview_url: previewUrl,
  pages_base_url: pagesBaseUrl,
  customer_email: customerEmail,
  email_state: JSON.stringify(pendingEmailState),
  email_state_token: privateToken,
  merge_proof: merged.merge_proof
};

await assert.rejects(
  runEmailGate({ ...gateInput, email_state_token: `${privateToken}x` }, mock.fetch.bind(mock), Buffer),
  /email state token does not match/
);
await assert.rejects(
  runEmailGate({ ...gateInput, customer_email: "wrong-recipient@example.test" }, mock.fetch.bind(mock), Buffer),
  /email state is not bound to this exact preview/
);
await assert.rejects(
  runEmailGate({
    ...gateInput,
    email_state: JSON.stringify({ ...pendingEmailState, expires_at: "2000-01-01T00:00:00Z" })
  }, mock.fetch.bind(mock), Buffer),
  /email state expired/
);
await assert.rejects(
  runEmailGate({
    ...gateInput,
    email_state: JSON.stringify({
      ...pendingEmailState,
      expires_at: new Date(Date.parse(emailStateCreatedAt) + 25 * 60 * 60 * 1000).toISOString()
    })
  }, mock.fetch.bind(mock), Buffer),
  /TTL exceeds 24 hours/
);

mock.checkRuns = [];
const missingCheck = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(missingCheck.status, "WAITING_FOR_PREVIEW_QUALITY");
assert.equal(missingCheck.send_preview_email, false);

mock.checkRuns = [{
  id: 90,
  name: "ARC preview quality/preview-quality",
  head_sha: "f".repeat(40),
  status: "completed",
  conclusion: "success",
  app: { slug: "github-actions", id: 15368 }
}];
const staleCheck = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(staleCheck.status, "WAITING_FOR_PREVIEW_QUALITY");
assert.equal(staleCheck.send_preview_email, false);

mock.checkRuns = [{
  id: 93,
  name: "ARC preview quality/preview-quality",
  head_sha: published.head_sha,
  status: "completed",
  conclusion: "success",
  app: { slug: "untrusted-check-app", id: 15368 }
}];
const spoofedCheck = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(spoofedCheck.status, "WAITING_FOR_PREVIEW_QUALITY");
assert.equal(spoofedCheck.send_preview_email, false);

mock.checkRuns = [{
  id: 93,
  name: "ARC preview quality/preview-quality",
  head_sha: published.head_sha,
  status: "completed",
  conclusion: "success",
  app: { slug: "github-actions", id: 1 }
}];
const spoofedAppId = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(spoofedAppId.status, "WAITING_FOR_PREVIEW_QUALITY");
assert.equal(spoofedAppId.send_preview_email, false);

mock.checkRuns = [
  {
    id: 94,
    name: "ARC preview quality/preview-quality",
    head_sha: published.head_sha,
    status: "completed",
    conclusion: "success",
    app: { slug: "github-actions", id: 15368 }
  },
  {
    id: 95,
    name: "ARC preview quality/preview-quality",
    head_sha: published.head_sha,
    status: "queued",
    conclusion: null,
    app: { slug: "github-actions", id: 15368 }
  }
];
const latestPending = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(latestPending.status, "WAITING_FOR_PREVIEW_QUALITY");
assert.equal(latestPending.send_preview_email, false);

mock.checkRuns = [{
  id: 96,
  name: "ARC preview quality/preview-quality",
  head_sha: published.head_sha,
  status: "completed",
  conclusion: "success",
  app: { slug: "github-actions", id: 15368 }
}];
const savedMergedAt = mock.prs[0].merged_at;
const savedMergeCommit = mock.prs[0].merge_commit_sha;
mock.prs[0].state = "open";
mock.prs[0].merged_at = null;
const unmerged = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(unmerged.status, "WAITING_FOR_PR_MERGE");
assert.equal(unmerged.send_preview_email, false);

mock.prs[0].state = "closed";
mock.prs[0].merged_at = savedMergedAt;
mock.prs[0].merge_commit_sha = savedMergeCommit;
const approvedMergedHtml = mock.branchHtml;
mock.branchHtml = mock.branchHtml.replace("<h1>Summit Roofing</h1>", "<h1>Tampered after merge</h1>");
await assert.rejects(
  runEmailGate(gateInput, mock.fetch.bind(mock), Buffer),
  /merged preview content source-bytes/
);
mock.branchHtml = approvedMergedHtml;
mock.liveStatus = 503;
const pagesPending = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(pagesPending.status, "WAITING_FOR_PAGES");
assert.equal(pagesPending.send_preview_email, false);

mock.liveStatus = 200;
mock.liveUrl = previewUrl;
mock.liveHtml = mock.branchHtml.replace("noindex,nofollow,noarchive", "index,follow");
const liveIndexable = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(liveIndexable.status, "WAITING_FOR_PAGES");
assert.equal(liveIndexable.send_preview_email, false);
assert.equal(liveIndexable.proof.live_proof, "noindex");

mock.liveHtml = mock.branchHtml.replace("arc-template-version\" content=\"10.0", "arc-template-version\" content=\"9.6");
const liveOldVersion = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(liveOldVersion.status, "WAITING_FOR_PAGES");
assert.equal(liveOldVersion.send_preview_email, false);
assert.equal(liveOldVersion.proof.live_proof, "v10-marker");

mock.liveHtml = mock.branchHtml;
const ready = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(ready.status, "READY_TO_SEND_PREVIEW_EMAIL");
assert.equal(ready.send_preview_email, true);
assert.equal(ready.state_write_required_before_email, true);
assert.equal(ready.customer_email, customerEmail);
assert.equal(ready.required_check, "ARC preview quality/preview-quality");
const claimedEmailState = JSON.parse(ready.next_email_state);
assert.equal(claimedEmailState.status, "CLAIMED");
assert.equal(claimedEmailState.token_sha256, sha256(privateToken));
assert.equal(claimedEmailState.proof.head_sha, published.head_sha);
assert.equal(claimedEmailState.proof.preview_url, previewUrl);
assert.equal(claimedEmailState.proof.merge_commit_sha, merged.merge_commit_sha);
assert.doesNotMatch(ready.next_email_state, new RegExp(privateToken));
assert.equal(mock.claimRefs.size, 1);
assert.equal([...mock.claimRefs.values()][0], merged.merge_commit_sha);

const pendingReplay = await runEmailGate(gateInput, mock.fetch.bind(mock), Buffer);
assert.equal(pendingReplay.status, "EMAIL_ALREADY_CLAIMED");
assert.equal(pendingReplay.send_preview_email, false, "atomic claim replay attempted a second email");
assert.equal(mock.claimRefs.size, 1);

const rotatedToken = "rotated_private_state_token_0987654321abcd";
const rotatedState = { ...pendingEmailState, token_sha256: sha256(rotatedToken) };
const rotatedTokenReplay = await runEmailGate({
  ...gateInput,
  email_state_token: rotatedToken,
  email_state: JSON.stringify(rotatedState)
}, mock.fetch.bind(mock), Buffer);
assert.equal(rotatedTokenReplay.status, "EMAIL_ALREADY_CLAIMED");
assert.equal(rotatedTokenReplay.send_preview_email, false, "rotating the private token authorized a duplicate email");
assert.equal(mock.claimRefs.size, 1);

const requestsBeforeClaimedReplay = mock.requests.length;
const claimedReplay = await runEmailGate({
  ...gateInput,
  email_state: ready.next_email_state
}, mock.fetch.bind(mock), Buffer);
assert.equal(claimedReplay.status, "EMAIL_ALREADY_CLAIMED");
assert.equal(claimedReplay.send_preview_email, false);
assert.equal(mock.requests.length, requestsBeforeClaimedReplay, "claimed replay should stop before external checks");

const gateRequests = mock.requests.slice(writeCountAfterPublish);
assert.doesNotMatch(gateRequests.map(request => `${request.rawUrl}\n${request.body}`).join("\n"), new RegExp(privateToken));
assert.doesNotMatch(gateRequests.map(request => `${request.rawUrl}\n${request.body}`).join("\n"), new RegExp(customerEmail));
const checkRequests = mock.requests.filter(request => request.rawUrl.includes("/check-runs"));
assert.ok(checkRequests.length >= 1);
for (const request of checkRequests) {
  assert.equal(new URL(request.rawUrl).searchParams.get("check_name"), "ARC preview quality/preview-quality");
  assert.match(request.rawUrl, new RegExp(`/commits/${published.head_sha}/check-runs`));
}

console.log("ARC1 PR/email gate contract passed: atomic one-file branch commit, one reusable PR, exact CI/merge/Pages proof, and private one-shot email claim.");
