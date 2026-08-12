import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const publisherSource = await readFile(new URL("../zapier/arc2_publish_delivery_pr.js", import.meta.url), "utf8");
const mergeSource = await readFile(new URL("../zapier/arc2_merge_delivery_pr.js", import.meta.url), "utf8");
const emailGateSource = await readFile(new URL("../zapier/arc2_delivery_email_gate.js", import.meta.url), "utf8");
const resolverSource = await readFile(new URL("../zapier/arc2_resolve_and_finalize.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runPublisher = new AsyncFunction("inputData", "fetch", "Buffer", publisherSource);
const runMerge = new AsyncFunction("inputData", "fetch", "Buffer", mergeSource);
const runEmailGate = new AsyncFunction("inputData", "fetch", "Buffer", emailGateSource);

const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const makeResponse = (status, body = {}, url = "", headerValues = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 404 ? "Not Found" : "OK",
  url,
  headers: { get: name => headerValues[String(name).toLowerCase()] || "" },
  json: async () => body,
  text: async () => typeof body === "string" ? body : JSON.stringify(body)
});

const folder = "summit-roofing-a1b2c3d4";
const deliveryRoot = `deliveries/${folder}`;
const paths = [
  `${deliveryRoot}/index.html`,
  `${deliveryRoot}/netlify.toml`,
  `${deliveryRoot}/USAGE.md`,
  `${deliveryRoot}/.arc-handoff.json`
];
const pagesBaseUrl = "https://arcwebhq-cpu.github.io/arc-previews";
const productionUrl = `${pagesBaseUrl}/${deliveryRoot}/`;
const deployUrl = `https://app.netlify.com/start/deploy?repository=${encodeURIComponent("https://github.com/arcwebhq-cpu/arc-previews")}&create_from_path=${encodeURIComponent(deliveryRoot)}`;
const productionHtml = `<!doctype html><html><head>
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="arc-template-version" content="10.0">
<meta name="arc-preview-folder" content="${folder}">
<meta name="arc-preview-source-sha256" content="${"a".repeat(64)}">
<link rel="canonical" href="${productionUrl}">
<meta property="og:url" content="${productionUrl}">
</head><body data-arc-site-mode="production"><main><h1>Summit Roofing</h1><form name="summit-lead" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="/?submitted=1"><input type="hidden" name="form-name" value="summit-lead"><p hidden><label>Leave blank<input name="bot-field"></label></p><label>Name<input type="text" name="name" required></label><label>Email<input type="email" name="email" required></label><label>Phone<input type="tel" name="phone"></label><label>Project details<textarea name="project_details" required></textarea></label><button type="submit">Send</button></form></main></body></html>
`;
const processedStagingHtml = productionHtml
  .replace(' data-netlify="true"', "")
  .replace(' netlify-honeypot="bot-field"', "");
const netlifyConfig = `[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    X-Robots-Tag = "noindex, nofollow, noarchive"
`;
const usageGuide = `# Launch checklist

Verify the lead route before launch.
`;
const baseArtifacts = [
  { path: paths[0], content: productionHtml },
  { path: paths[1], content: netlifyConfig },
  { path: paths[2], content: usageGuide }
];
const fingerprint = sha256(baseArtifacts.map(artifact => `${artifact.path}\0${artifact.content}\0`).join(""));
const marker = `${JSON.stringify({
  version: "arc-handoff-v2",
  preview_folder: folder,
  fingerprint_algorithm: "sha256",
  bundle_fingerprint: fingerprint,
  files: paths
}, null, 2)}\n`;
const expectedFiles = new Map([...baseArtifacts, { path: paths[3], content: marker }].map(item => [item.path, item.content]));
const customerEmail = "buyer@example.com";
const leadEmail = "verified-leads@example.com";
const checkoutSession = "cs_test_arc2_contract_123";
const checkoutSecret = "arc2-contract-secret-that-is-at-least-32-chars";
const emailClaimBindingSecret = "arc2-static-email-claim-binding-secret-v1";
const leadRouteEvidenceSecret = "arc2-static-lead-route-evidence-secret-v1";
const netlifyAccountId = "arc_account_123456";
const stagingSiteId = "123e4567-e89b-42d3-a456-426614174000";
const stagingDeployId = "223e4567-e89b-42d3-a456-426614174000";
const stagingFormId = "323e4567-e89b-42d3-a456-426614174000";
const notificationHookId = "423e4567-e89b-42d3-a456-426614174000";
const syntheticSubmissionId = "523e4567-e89b-42d3-a456-426614174000";
const stagingSiteUrl = "https://arc-lead-route-a1b2c3d4.netlify.app/";
const stagingDeployUrl = `https://${stagingDeployId}--arc-lead-route-a1b2c3d4.netlify.app/`;
const formName = "summit-lead";
const netlifyToken = "mock-netlify-token-never-public";
const netlifyFiles = [
  { path: "/USAGE.md", sha: "1".repeat(40), size: Buffer.byteLength(usageGuide), mime_type: "text/markdown" },
  { path: "/index.html", sha: "2".repeat(40), size: Buffer.byteLength(productionHtml), mime_type: "text/html" },
  { path: "/netlify.toml", sha: "3".repeat(40), size: Buffer.byteLength(netlifyConfig), mime_type: "text/plain" }
];
const deployFileManifestSha256 = sha256(JSON.stringify(netlifyFiles.slice().sort((first, second) => first.path.localeCompare(second.path))));
const servedHtmlSha256 = sha256(processedStagingHtml);
const stagingRobotsHeaderSha256 = sha256("noarchive,nofollow,noindex");
const syntheticProbeSha256 = sha256("ARC_SYNTHETIC_PROBE_1234567890abcdef");
const rawRecipientSha256 = sha256(customerEmail);
const recipientBindingHmacSha256 = createHmac("sha256", emailClaimBindingSecret).update(customerEmail).digest("hex");
const leadRouteRecipientHmacSha256 = createHmac("sha256", leadRouteEvidenceSecret)
  .update(`arc-lead-route-recipient-v1\n${leadEmail}`)
  .digest("hex");
const inboxProvider = "mock-inbox";
const inboxAccountHmacSha256 = sha256("authoritative-inbox-account-binding");
const inboxMessageIdHmacSha256 = sha256("authoritative-inbox-message-id-binding");
const inboxReceiptEvidenceSha256 = sha256("canonical-authoritative-inbox-receipt-evidence");
const clientReferenceId = `${folder}.${createHmac("sha256", checkoutSecret).update(folder).digest("hex")}`;
const folderSuffix = folder.slice(-8);
const suffixClientReferenceId = `${folderSuffix}.${createHmac("sha256", checkoutSecret).update(folderSuffix).digest("hex")}`;
const evidenceFields = overrides => {
  const inboxReceivedTimestamp = new Date().toISOString();
  return {
    version: "arc-lead-route-evidence-v1",
    scope: "arc-controlled-netlify-staging",
    preview_folder: folder,
    production_content_sha256: sha256(productionHtml),
    bundle_fingerprint: fingerprint,
    netlify_account_id: netlifyAccountId,
    staging_site_id: stagingSiteId,
    staging_site_url: stagingSiteUrl,
    staging_deploy_id: stagingDeployId,
    staging_deploy_url: stagingDeployUrl,
    deploy_file_manifest_sha256: deployFileManifestSha256,
    served_html_sha256: servedHtmlSha256,
    staging_robots_header_sha256: stagingRobotsHeaderSha256,
    staging_form_id: stagingFormId,
    notification_hook_id: notificationHookId,
    form_name: formName,
    recipient_hmac_sha256: leadRouteRecipientHmacSha256,
    synthetic_submission_id: syntheticSubmissionId,
    synthetic_probe_sha256: syntheticProbeSha256,
    netlify_submission_timestamp: new Date(Date.parse(inboxReceivedTimestamp) - 5 * 1000).toISOString(),
    inbox_provider: inboxProvider,
    inbox_account_hmac_sha256: inboxAccountHmacSha256,
    inbox_message_id_hmac_sha256: inboxMessageIdHmacSha256,
    inbox_received_timestamp: inboxReceivedTimestamp,
    inbox_receipt_evidence_sha256: inboxReceiptEvidenceSha256,
    ...overrides
  };
};
const signEvidence = (overrides = {}) => {
  const evidence = evidenceFields(overrides);
  const canonical = JSON.stringify(evidence);
  return {
    evidence,
    canonical,
    signature: createHmac("sha256", leadRouteEvidenceSecret)
      .update(`arc-lead-route-evidence-signature-v1\n${canonical}`)
      .digest("hex"),
    digest: sha256(canonical)
  };
};
const signedLeadRouteEvidence = signEvidence();

class MockGitHubAndPages {
  constructor() {
    this.nextSha = 32;
    this.mainHead = "1".repeat(40);
    this.mainTree = "2".repeat(40);
    this.mainFiles = new Map();
    this.branchExists = false;
    this.branchHead = "";
    this.blobs = new Map();
    this.trees = new Map([[this.mainTree, new Map()]]);
    this.commits = new Map([[
      this.mainHead,
      { tree: this.mainTree, message: "Initial", parents: [], files: new Map() }
    ]]);
    this.prs = [];
    this.prFiles = [];
    this.checkRuns = [];
    this.claimRefs = new Map();
    this.liveFiles = new Map();
    this.liveStatus = new Map();
    this.requests = [];
    this.createdPublicPayloads = [];
    this.hideClaimRefReads = 0;
    this.netlifySite = {
      id: stagingSiteId,
      account_id: netlifyAccountId,
      published_deploy: { id: stagingDeployId }
    };
    this.netlifyDeploy = {
      id: stagingDeployId,
      site_id: stagingSiteId,
      state: "ready",
      deploy_ssl_url: stagingDeployUrl
    };
    this.netlifyFiles = netlifyFiles.map(file => ({ ...file, id: file.path }));
    this.netlifySnippets = [];
    this.netlifyForms = [{ id: stagingFormId, site_id: stagingSiteId, name: formName, paths: ["/"] }];
    this.netlifyHooks = [{
      id: notificationHookId,
      site_id: stagingSiteId,
      type: "email",
      event: "submission_created",
      disabled: false,
      data: { email: leadEmail, form_id: stagingFormId, form_name: formName }
    }];
    this.netlifySubmissions = [{
      id: syntheticSubmissionId,
      created_at: signedLeadRouteEvidence.evidence.netlify_submission_timestamp,
      site_url: stagingSiteUrl,
      data: { "form-name": formName, project_details: "ARC_SYNTHETIC_PROBE_1234567890abcdef" }
    }];
    this.liveFiles.set(stagingDeployUrl, processedStagingHtml);
  }

  sha() {
    return (this.nextSha++).toString(16).padStart(40, "0");
  }

  filesForRef(ref) {
    if (ref === "main") return this.mainFiles;
    if (ref === `arc-delivery/${folder}` && this.branchExists) return this.commits.get(this.branchHead)?.files;
    return this.commits.get(ref)?.files;
  }

  currentPr() {
    return this.prs[0];
  }

  async fetch(rawUrl, options = {}) {
    const method = options.method || "GET";
    const url = new URL(rawUrl);
    const bodyText = options.body || "";
    this.requests.push({ rawUrl, method, body: bodyText, headers: options.headers || {} });

    if (url.hostname === "api.netlify.com") {
      assert.equal(options.headers?.Authorization, `Bearer ${netlifyToken}`);
      if (method !== "GET") return makeResponse(405, { message: "read only" }, rawUrl);
      if (url.pathname === `/api/v1/sites/${stagingSiteId}`) return makeResponse(200, this.netlifySite, rawUrl);
      if (url.pathname === `/api/v1/sites/${stagingSiteId}/deploys/${stagingDeployId}`) return makeResponse(200, this.netlifyDeploy, rawUrl);
      if (url.pathname === `/api/v1/sites/${stagingSiteId}/files`) return makeResponse(200, this.netlifyFiles, rawUrl);
      if (url.pathname === `/api/v1/sites/${stagingSiteId}/snippets`) return makeResponse(200, this.netlifySnippets, rawUrl);
      if (url.pathname === `/api/v1/sites/${stagingSiteId}/forms`) return makeResponse(200, this.netlifyForms, rawUrl);
      if (url.pathname === "/api/v1/hooks" && url.searchParams.get("site_id") === stagingSiteId) return makeResponse(200, this.netlifyHooks, rawUrl);
      if (url.pathname === `/api/v1/forms/${stagingFormId}/submissions`) return makeResponse(200, this.netlifySubmissions, rawUrl);
      return makeResponse(404, { message: `Unhandled ${method} ${rawUrl}` }, rawUrl);
    }

    if (url.hostname !== "api.github.com") {
      const status = this.liveStatus.get(rawUrl) ?? 200;
      const body = this.liveFiles.get(rawUrl) ?? "";
      return makeResponse(status, body, rawUrl, rawUrl === stagingDeployUrl ? {
        "x-robots-tag": "noindex, nofollow, noarchive",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY"
      } : {});
    }

    if (method === "POST" && url.pathname === "/graphql") {
      const body = JSON.parse(bodyText);
      const pr = this.prs.find(item => item.node_id === body.variables.pullRequestId);
      if (!pr) return makeResponse(200, { errors: [{ message: "Not Found" }] });
      pr.draft = false;
      return makeResponse(200, {
        data: { markPullRequestReadyForReview: { pullRequest: { number: pr.number, isDraft: false, headRefOid: pr.head.sha } } }
      });
    }

    if (method === "GET" && /\/commits\/[a-f0-9]{40}\/check-runs$/.test(url.pathname)) {
      return makeResponse(200, { total_count: this.checkRuns.length, check_runs: this.checkRuns });
    }

    const mergeMatch = url.pathname.match(/\/pulls\/(\d+)\/merge$/);
    if (method === "PUT" && mergeMatch) {
      const pr = this.prs.find(item => item.number === Number(mergeMatch[1]));
      if (!pr) return makeResponse(404, { message: "Not Found" });
      const body = JSON.parse(bodyText);
      if (body.sha !== pr.head.sha) return makeResponse(409, { message: "Head changed" });
      assert.equal(body.merge_method, "squash");
      const branchCommit = this.commits.get(pr.head.sha);
      const mergeSha = this.sha();
      const mergeTree = this.sha();
      this.trees.set(mergeTree, new Map(branchCommit.files));
      this.commits.set(mergeSha, {
        tree: mergeTree,
        message: body.commit_title,
        parents: [{ sha: this.mainHead }],
        files: new Map(branchCommit.files)
      });
      this.mainHead = mergeSha;
      this.mainTree = mergeTree;
      this.mainFiles = new Map(branchCommit.files);
      pr.state = "closed";
      pr.draft = false;
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
    if (url.pathname.endsWith("/pulls") && method === "GET") return makeResponse(200, this.prs);
    if (url.pathname.endsWith("/pulls") && method === "POST") {
      const body = JSON.parse(bodyText);
      this.createdPublicPayloads.push(body.title, body.body, body.head);
      const pr = {
        number: 77,
        node_id: "PR_arc2_mock_77",
        html_url: "https://github.com/arcwebhq-cpu/arc-previews/pull/77",
        state: "open",
        draft: body.draft,
        merged_at: null,
        merge_commit_sha: null,
        base: { ref: body.base },
        head: { ref: body.head, sha: this.branchHead }
      };
      this.prs.push(pr);
      this.prFiles = paths.map(filename => ({ filename, status: "added" }));
      return makeResponse(201, pr);
    }

    if (method === "GET" && url.pathname.includes("/git/ref/heads%2Fmain")) {
      return makeResponse(200, { object: { sha: this.mainHead } });
    }
    if (method === "GET" && url.pathname.includes(`/git/ref/heads%2Farc-delivery%2F${folder}`)) {
      return this.branchExists
        ? makeResponse(200, { object: { sha: this.branchHead } })
        : makeResponse(404, { message: "Not Found" });
    }
    if (method === "GET" && url.pathname.includes("/git/ref/tags%2Farc-delivery-email%2F")) {
      const refName = decodeURIComponent(url.pathname.split("/git/ref/")[1]);
      const sha = this.claimRefs.get(refName);
      if (sha && this.hideClaimRefReads > 0) {
        this.hideClaimRefReads -= 1;
        return makeResponse(404, { message: "Not Found" });
      }
      return sha ? makeResponse(200, { object: { sha } }) : makeResponse(404, { message: "Not Found" });
    }

    const commitMatch = url.pathname.match(/\/git\/commits\/([a-f0-9]{40})$/);
    if (method === "GET" && commitMatch) {
      const commit = this.commits.get(commitMatch[1]);
      return commit
        ? makeResponse(200, { tree: { sha: commit.tree }, message: commit.message, parents: commit.parents })
        : makeResponse(404, { message: "Not Found" });
    }

    const contentsPrefix = "/repos/arcwebhq-cpu/arc-previews/contents/";
    if (method === "GET" && url.pathname.startsWith(contentsPrefix)) {
      const path = url.pathname.slice(contentsPrefix.length).split("/").map(decodeURIComponent).join("/");
      const ref = url.searchParams.get("ref") || "main";
      const content = this.filesForRef(ref)?.get(path);
      return content == null
        ? makeResponse(404, { message: "Not Found" })
        : makeResponse(200, { content: Buffer.from(content, "utf8").toString("base64") });
    }

    if (method === "POST" && url.pathname.endsWith("/git/blobs")) {
      const body = JSON.parse(bodyText);
      const blobSha = this.sha();
      this.blobs.set(blobSha, Buffer.from(body.content, "base64").toString("utf8"));
      return makeResponse(201, { sha: blobSha });
    }
    if (method === "POST" && url.pathname.endsWith("/git/trees")) {
      const body = JSON.parse(bodyText);
      const treeSha = this.sha();
      const baseFiles = new Map(this.trees.get(body.base_tree) || []);
      for (const entry of body.tree) baseFiles.set(entry.path, this.blobs.get(entry.sha));
      this.trees.set(treeSha, baseFiles);
      return makeResponse(201, { sha: treeSha });
    }
    if (method === "POST" && url.pathname.endsWith("/git/commits")) {
      const body = JSON.parse(bodyText);
      const commitSha = this.sha();
      const files = new Map(this.trees.get(body.tree) || []);
      this.commits.set(commitSha, {
        tree: body.tree,
        message: String(body.message).trimEnd(),
        parents: (body.parents || []).map(sha => ({ sha })),
        files
      });
      this.createdPublicPayloads.push(String(body.message));
      return makeResponse(201, { sha: commitSha });
    }
    if (method === "POST" && url.pathname.endsWith("/git/refs")) {
      const body = JSON.parse(bodyText);
      this.createdPublicPayloads.push(body.ref);
      if (body.ref.startsWith("refs/tags/arc-delivery-email/")) {
        const name = body.ref.replace(/^refs\//, "");
        if (this.claimRefs.has(name)) return makeResponse(422, { message: "Reference exists" });
        this.claimRefs.set(name, body.sha);
        return makeResponse(201, { ref: body.ref, object: { sha: body.sha } });
      }
      assert.equal(body.ref, `refs/heads/arc-delivery/${folder}`);
      if (this.branchExists) return makeResponse(422, { message: "Reference exists" });
      this.branchExists = true;
      this.branchHead = body.sha;
      return makeResponse(201, { ref: body.ref, object: { sha: body.sha } });
    }

    return makeResponse(404, { message: `Unhandled ${method} ${rawUrl}` });
  }

  publishPages() {
    this.liveFiles.set(productionUrl, expectedFiles.get(paths[0]));
    for (const path of paths.slice(1)) {
      this.liveFiles.set(`${productionUrl}${path.split("/").pop()}`, expectedFiles.get(path));
    }
  }
}

const publisherInput = {
  github_token: "publisher-token-one",
  github_owner: "arcwebhq-cpu",
  github_repo: "arc-previews",
  github_base_branch: "main",
  payment_verification_status: "verified_test_payment",
  checkout_session_id: checkoutSession,
  client_reference_id: clientReferenceId,
  checkout_binding_secret: checkoutSecret,
  livemode: false,
  payment_status: "paid",
  currency: "usd",
  amount_total_minor_units: 500000,
  payment_link_id: "plink_arc2test123",
  expected_payment_link_id: "plink_arc2test123",
  terms_of_service_consent: "accepted",
  terms_version: "2026-08-11",
  expected_terms_version: "2026-08-11",
  preview_folder: folder,
  production_file_path: paths[0],
  production_content_base64: Buffer.from(productionHtml).toString("base64"),
  production_content_sha256: sha256(productionHtml),
  netlify_config_path: paths[1],
  netlify_config_base64: Buffer.from(netlifyConfig).toString("base64"),
  usage_guide_path: paths[2],
  usage_guide_base64: Buffer.from(usageGuide).toString("base64"),
  bundle_fingerprint: fingerprint,
  pages_base_url: pagesBaseUrl,
  production_url: productionUrl,
  deploy_url: deployUrl,
  customer_email: customerEmail,
  lead_route_status: "verified",
  verified_lead_notification_email: leadEmail,
  lead_route_evidence_secret: leadRouteEvidenceSecret,
  netlify_access_token: netlifyToken,
  expected_netlify_account_id: netlifyAccountId,
  lead_route_form_name: formName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
  lead_route_evidence: JSON.stringify(signedLeadRouteEvidence.evidence),
  lead_route_evidence_hmac_sha256: signedLeadRouteEvidence.signature
};
const mergeInput = published => ({
  github_token: "merge-token-one",
  preview_folder: folder,
  delivery_branch: published.delivery_branch,
  head_sha: published.head_sha,
  bundle_fingerprint: fingerprint,
  pr_number: published.pr_number,
  verified_lead_notification_email: leadEmail,
  lead_route_evidence_secret: leadRouteEvidenceSecret,
  netlify_access_token: netlifyToken,
  expected_netlify_account_id: netlifyAccountId,
  lead_route_form_name: formName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
  lead_route_evidence: JSON.stringify(signedLeadRouteEvidence.evidence),
  lead_route_evidence_hmac_sha256: signedLeadRouteEvidence.signature,
  lead_route_evidence_sha256: published.lead_route_evidence_sha256
});
const gateInput = (published, merged, overrides = {}) => ({
  github_token: "gate-token-one",
  preview_folder: folder,
  delivery_branch: published.delivery_branch,
  head_sha: published.head_sha,
  bundle_fingerprint: fingerprint,
  pr_number: published.pr_number,
  merge_proof: merged.merge_proof,
  production_file_path: paths[0],
  production_content_base64: Buffer.from(productionHtml).toString("base64"),
  netlify_config_path: paths[1],
  netlify_config_base64: Buffer.from(netlifyConfig).toString("base64"),
  usage_guide_path: paths[2],
  usage_guide_base64: Buffer.from(usageGuide).toString("base64"),
  pages_base_url: pagesBaseUrl,
  production_url: productionUrl,
  deploy_url: deployUrl,
  customer_email: customerEmail,
  email_claim_binding_secret: emailClaimBindingSecret,
  checkout_session_id: checkoutSession,
  verified_lead_notification_email: leadEmail,
  lead_route_evidence_secret: leadRouteEvidenceSecret,
  netlify_access_token: netlifyToken,
  expected_netlify_account_id: netlifyAccountId,
  lead_route_form_name: formName,
  lead_route_recipient_hmac_sha256: leadRouteRecipientHmacSha256,
  lead_route_evidence: JSON.stringify(signedLeadRouteEvidence.evidence),
  lead_route_evidence_hmac_sha256: signedLeadRouteEvidence.signature,
  lead_route_evidence_sha256: published.lead_route_evidence_sha256,
  ...overrides
});
const successCheck = (id, status = "completed", conclusion = "success") => ({
  id,
  name: "ARC preview quality/preview-quality",
  head_sha: "",
  status,
  conclusion,
  app: { id: 15368, slug: "github-actions" }
});

// Signed test-payment and exact artifact inputs are mandatory before any GitHub writes.
const badSignatureMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, client_reference_id: `${folder}.${"0".repeat(64)}` }, badSignatureMock.fetch.bind(badSignatureMock), Buffer),
  /checkout reference signature mismatch/
);
assert.equal(badSignatureMock.requests.length, 0);

// A caller-supplied "verified" word is inert; no signed, fresh live staging proof means no GitHub access.
const statusOnlyMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({
    ...publisherInput,
    lead_route_status: "verified",
    lead_route_evidence: "",
    lead_route_evidence_hmac_sha256: ""
  }, statusOnlyMock.fetch.bind(statusOnlyMock), Buffer),
  /evidence (?:JSON|object)/
);
assert.equal(statusOnlyMock.requests.some(request => request.rawUrl.includes("api.github.com")), false);

const fakeEvidenceSignatureMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({ ...publisherInput, lead_route_evidence_hmac_sha256: "0".repeat(64) }, fakeEvidenceSignatureMock.fetch.bind(fakeEvidenceSignatureMock), Buffer),
  /evidence HMAC mismatch/
);
assert.equal(fakeEvidenceSignatureMock.requests.some(request => request.rawUrl.includes("api.github.com")), false);

const substitutedBundle = signEvidence({ bundle_fingerprint: "f".repeat(64) });
const substitutedBundleMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({
    ...publisherInput,
    lead_route_evidence: JSON.stringify(substitutedBundle.evidence),
    lead_route_evidence_hmac_sha256: substitutedBundle.signature
  }, substitutedBundleMock.fetch.bind(substitutedBundleMock), Buffer),
  /not bound to the exact artifacts/
);

const staleEvidence = signEvidence({ inbox_received_timestamp: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
const staleEvidenceMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({
    ...publisherInput,
    lead_route_evidence: JSON.stringify(staleEvidence.evidence),
    lead_route_evidence_hmac_sha256: staleEvidence.signature
  }, staleEvidenceMock.fetch.bind(staleEvidenceMock), Buffer),
  /timestamp is stale/
);

const preSubmissionEvidence = signEvidence({
  netlify_submission_timestamp: new Date().toISOString(),
  inbox_received_timestamp: new Date(Date.now() - 1000).toISOString()
});
const preSubmissionEvidenceMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({
    ...publisherInput,
    lead_route_evidence: JSON.stringify(preSubmissionEvidence.evidence),
    lead_route_evidence_hmac_sha256: preSubmissionEvidence.signature
  }, preSubmissionEvidenceMock.fetch.bind(preSubmissionEvidenceMock), Buffer),
  /precedes the Netlify submission/
);

const malformedInboxBinding = signEvidence({ inbox_message_id_hmac_sha256: "not-a-hmac" });
const malformedInboxBindingMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({
    ...publisherInput,
    lead_route_evidence: JSON.stringify(malformedInboxBinding.evidence),
    lead_route_evidence_hmac_sha256: malformedInboxBinding.signature
  }, malformedInboxBindingMock.fetch.bind(malformedInboxBindingMock), Buffer),
  /temporary staging identity/
);

const wrongDomainEvidence = signEvidence({ staging_site_url: "https://arc-lead-route-a1b2c3d4.example.com/" });
const wrongDomainMock = new MockGitHubAndPages();
await assert.rejects(
  runPublisher({
    ...publisherInput,
    lead_route_evidence: JSON.stringify(wrongDomainEvidence.evidence),
    lead_route_evidence_hmac_sha256: wrongDomainEvidence.signature
  }, wrongDomainMock.fetch.bind(wrongDomainMock), Buffer),
  /temporary staging identity/
);

const mismatchedStagingMock = new MockGitHubAndPages();
mismatchedStagingMock.liveFiles.set(stagingDeployUrl, `${processedStagingHtml}tampered`);
await assert.rejects(
  runPublisher(publisherInput, mismatchedStagingMock.fetch.bind(mismatchedStagingMock), Buffer),
  /immutable staging response/
);
assert.equal(mismatchedStagingMock.requests.some(request => request.rawUrl.includes("api.github.com")), false);

const removedHookBeforePublish = new MockGitHubAndPages();
removedHookBeforePublish.netlifyHooks = [];
await assert.rejects(
  runPublisher(publisherInput, removedHookBeforePublish.fetch.bind(removedHookBeforePublish), Buffer),
  /current form, notification hook, or synthetic submission changed/
);
assert.equal(removedHookBeforePublish.requests.some(request => request.rawUrl.includes("api.github.com")), false);

const suffixPublisherMock = new MockGitHubAndPages();
const suffixPublished = await runPublisher(
  { ...publisherInput, client_reference_id: suffixClientReferenceId },
  suffixPublisherMock.fetch.bind(suffixPublisherMock),
  Buffer
);
assert.equal(suffixPublished.preview_folder, folder);
assert.equal(suffixPublished.status, "PR_CREATED");

const mock = new MockGitHubAndPages();
const published = await runPublisher(publisherInput, mock.fetch.bind(mock), Buffer);
assert.equal(published.status, "PR_CREATED");
assert.equal(published.send_delivery_email, false);
assert.equal(published.delivery_branch, `arc-delivery/${folder}`);
assert.equal(published.bundle_fingerprint, fingerprint);
assert.equal(published.lead_route_evidence_sha256, signedLeadRouteEvidence.digest);
assert.equal(published.lead_route_form_name, formName);
assert.equal(published.lead_route_recipient_hmac_sha256, leadRouteRecipientHmacSha256);
assert.equal(published.recipient_sha256, sha256(customerEmail));
assert.equal(published.pr_number, 77);
assert.deepEqual([...mock.commits.get(published.head_sha).files.keys()].sort(), paths.slice().sort());
assert.equal(mock.requests.some(request => request.method === "PATCH" && request.rawUrl.includes("heads%2Fmain")), false);
assert.equal(mock.createdPublicPayloads.some(value => value.includes(customerEmail) || value.includes(leadEmail) || value.includes(checkoutSession)), false);

// An extra PR file is a hard scope failure.
mock.prFiles.push({ filename: "unexpected.txt", status: "added" });
await assert.rejects(
  runMerge(mergeInput(published), mock.fetch.bind(mock), Buffer),
  /exactly four files/
);
mock.prFiles.pop();

// A newer pending run blocks an older success; only the latest exact Actions app run counts.
const oldSuccess = successCheck(100);
oldSuccess.head_sha = published.head_sha;
const latestPending = successCheck(101, "in_progress", null);
latestPending.head_sha = published.head_sha;
const spoofedSuccess = successCheck(999);
spoofedSuccess.head_sha = published.head_sha;
spoofedSuccess.app = { id: 99999, slug: "github-actions" };
const wrongHeadSuccess = successCheck(1000);
wrongHeadSuccess.head_sha = "f".repeat(40);
mock.checkRuns = [oldSuccess, latestPending, spoofedSuccess, wrongHeadSuccess];
const waitingCheck = await runMerge(mergeInput(published), mock.fetch.bind(mock), Buffer);
assert.equal(waitingCheck.status, "WAITING_FOR_DELIVERY_QUALITY");
assert.equal(waitingCheck.send_delivery_email, false);
const latestSuccess = successCheck(102);
latestSuccess.head_sha = published.head_sha;
mock.checkRuns.push(latestSuccess);

const liveHooksBeforeMerge = mock.netlifyHooks;
mock.netlifyHooks = [];
await assert.rejects(
  runMerge(mergeInput(published), mock.fetch.bind(mock), Buffer),
  /current form, notification hook, or synthetic submission changed/
);
mock.netlifyHooks = liveHooksBeforeMerge;

// A different validly signed receipt cannot be replayed against the publisher-bound evidence digest.
const replayedReceipt = signEvidence({ synthetic_submission_id: "423e4567-e89b-42d3-a456-426614174000" });
await assert.rejects(
  runMerge({
    ...mergeInput(published),
    lead_route_evidence: JSON.stringify(replayedReceipt.evidence),
    lead_route_evidence_hmac_sha256: replayedReceipt.signature
  }, mock.fetch.bind(mock), Buffer),
  /publisher evidence digest mismatch/
);

// Head-byte tampering is rejected even when the PR metadata and check are otherwise valid.
const originalHeadFiles = mock.commits.get(published.head_sha).files;
const tamperedHeadFiles = new Map(originalHeadFiles);
tamperedHeadFiles.set(paths[2], `${usageGuide}tampered\n`);
mock.commits.get(published.head_sha).files = tamperedHeadFiles;
await assert.rejects(
  runMerge(mergeInput(published), mock.fetch.bind(mock), Buffer),
  /delivery bundle bytes changed/
);
mock.commits.get(published.head_sha).files = originalHeadFiles;

const merged = await runMerge(mergeInput(published), mock.fetch.bind(mock), Buffer);
assert.equal(merged.status, "MERGED");
assert.equal(merged.send_delivery_email, false);
assert.equal(merged.marked_ready, true);
assert.match(merged.merge_proof, /arc-delivery-merge-proof-v1/);
assert.equal(mock.claimRefs.size, 0);

// Pages delay is safe: every durable proof exists, but no email claim is created yet.
const delayed = await runEmailGate(gateInput(published, merged), mock.fetch.bind(mock), Buffer);
assert.equal(delayed.status, "WAITING_FOR_PAGES");
assert.equal(delayed.send_delivery_email, false);
assert.equal(mock.claimRefs.size, 0);

// Current-main tampering is a hard mismatch, not a send/retry signal.
const originalMainUsage = mock.mainFiles.get(paths[2]);
mock.mainFiles.set(paths[2], `${originalMainUsage}tampered\n`);
await assert.rejects(
  runEmailGate(gateInput(published, merged), mock.fetch.bind(mock), Buffer),
  /current main .* bytes changed/
);
mock.mainFiles.set(paths[2], originalMainUsage);

mock.publishPages();
await assert.rejects(
  runEmailGate(gateInput(published, merged, { email_claim_binding_secret: "too-short" }), mock.fetch.bind(mock), Buffer),
  /email claim binding secret must be 32–256 characters/
);
const claimsBeforeBadEvidence = mock.claimRefs.size;
await assert.rejects(
  runEmailGate(gateInput(published, merged, { lead_route_evidence_hmac_sha256: "0".repeat(64) }), mock.fetch.bind(mock), Buffer),
  /evidence HMAC mismatch/
);
assert.equal(mock.claimRefs.size, claimsBeforeBadEvidence);
const liveHooksBeforeEmail = mock.netlifyHooks;
mock.netlifyHooks = [];
await assert.rejects(
  runEmailGate(gateInput(published, merged), mock.fetch.bind(mock), Buffer),
  /current form, notification hook, or synthetic submission changed/
);
assert.equal(mock.claimRefs.size, claimsBeforeBadEvidence);
mock.netlifyHooks = liveHooksBeforeEmail;
mock.liveStatus.set(stagingDeployUrl, 404);
await assert.rejects(
  runEmailGate(gateInput(published, merged), mock.fetch.bind(mock), Buffer),
  /staging site is not live/
);
assert.equal(mock.claimRefs.size, claimsBeforeBadEvidence);
mock.liveStatus.delete(stagingDeployUrl);
const ready = await runEmailGate(gateInput(published, merged), mock.fetch.bind(mock), Buffer);
assert.equal(ready.status, "READY_TO_SEND_DELIVERY_EMAIL");
assert.equal(ready.send_delivery_email, true);
assert.equal(ready.email_claim_committed, true);
assert.equal(ready.state_write_required_before_email, true);
assert.equal(ready.customer_email, customerEmail);
assert.equal(ready.recipient_hmac_sha256, recipientBindingHmacSha256);
assert.equal(ready.lead_route_evidence_sha256, signedLeadRouteEvidence.digest);
assert.equal(ready.lead_route_recipient_hmac_sha256, leadRouteRecipientHmacSha256);
assert.equal(mock.claimRefs.size, 1);

// Caller token/session rotation cannot create a second claim for immutable delivery identity.
const claimCommitPostsBeforeReplay = mock.requests.filter(request =>
  request.method === "POST" && request.rawUrl.endsWith("/git/commits") && request.body.includes("arc-delivery-email-claim-v1")
).length;
const replay = await runEmailGate(gateInput(published, merged, {
  github_token: "rotated-github-token",
  checkout_session_id: "cs_test_rotated_caller_context"
}), mock.fetch.bind(mock), Buffer);
assert.equal(replay.status, "DELIVERY_EMAIL_ALREADY_CLAIMED");
assert.equal(replay.send_delivery_email, false);
assert.equal(replay.email_claim_identity_sha256, ready.email_claim_identity_sha256);
assert.equal(mock.claimRefs.size, 1);
assert.equal(mock.requests.filter(request =>
  request.method === "POST" && request.rawUrl.endsWith("/git/commits") && request.body.includes("arc-delivery-email-claim-v1")
).length, claimCommitPostsBeforeReplay);

// If two callers race after the preflight GET, the losing POST 422 verifies the winning claim.
mock.hideClaimRefReads = 1;
const racedReplay = await runEmailGate(gateInput(published, merged, {
  github_token: "race-github-token",
  checkout_session_id: "cs_test_raced_context"
}), mock.fetch.bind(mock), Buffer);
assert.equal(racedReplay.status, "DELIVERY_EMAIL_ALREADY_CLAIMED");
assert.equal(racedReplay.send_delivery_email, false);
assert.equal(racedReplay.email_claim_identity_sha256, ready.email_claim_identity_sha256);
assert.equal(mock.claimRefs.size, 1);
assert.equal(mock.requests.filter(request =>
  request.method === "POST" && request.rawUrl.endsWith("/git/commits") && request.body.includes("arc-delivery-email-claim-v1")
).length, claimCommitPostsBeforeReplay + 1);

// A recipient change cannot reuse or create another delivery claim.
const wrongRecipient = "other-buyer@example.com";
await assert.rejects(
  runEmailGate(gateInput(published, merged, {
    customer_email: wrongRecipient,
    checkout_session_id: "cs_test_other_session"
  }), mock.fetch.bind(mock), Buffer),
  /email claim is bound to another recipient/
);
assert.equal(mock.claimRefs.size, 1);

// A merged PR remains safely replayable after its deterministic branch is deleted.
mock.branchExists = false;
const deletedBranchReplay = await runPublisher({ ...publisherInput, github_token: "rotated-publisher-token" }, mock.fetch.bind(mock), Buffer);
assert.equal(deletedBranchReplay.status, "ALREADY_MERGED");
assert.equal(deletedBranchReplay.send_delivery_email, false);
assert.equal(deletedBranchReplay.head_sha, published.head_sha);

// No implementation path directly patches main, and public payloads contain no raw private values.
assert.equal(mock.requests.some(request => request.method === "PATCH" && /heads%2Fmain/.test(request.rawUrl)), false);
const privateSessionValues = [
  checkoutSession,
  "cs_test_rotated_caller_context",
  "cs_test_raced_context",
  "cs_test_other_session"
];
assert.equal(mock.createdPublicPayloads.some(value =>
  value.includes(customerEmail) || value.includes(leadEmail) || privateSessionValues.some(session => value.includes(session))
), false);
assert.equal(mock.createdPublicPayloads.some(value =>
  value.includes(rawRecipientSha256) ||
  value.includes(emailClaimBindingSecret) ||
  value.includes(wrongRecipient) ||
  value.includes(sha256(wrongRecipient))
), false);
assert.equal(mock.createdPublicPayloads.some(value => value.includes(recipientBindingHmacSha256)), true);
assert.equal(publisherSource.includes("method: \"PATCH\""), false);
assert.equal(publisherSource.includes("leadRouteStatus"), false);
assert.equal(mergeSource.includes("lead_route_status"), false);
assert.equal(emailGateSource.includes("lead_route_status"), false);
assert.doesNotMatch(resolverSource, /inputData\.lead_route_status/);
assert.match(resolverSource, /pending_live_staging_evidence/);

await import("./arc2_lead_route_staging_contract.mjs");

console.log("PASS ARC2 PR/CI/merge/Pages/email gate contract");
