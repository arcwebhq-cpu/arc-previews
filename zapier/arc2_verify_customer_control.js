// ARC2 read-only customer-control verifier.
// A separately approved secure handoff must first place the exact bundle in a
// repository and Netlify site already controlled by the customer. This step performs GET requests only and issues
// short-lived signed evidence; it never creates, transfers, deploys, publishes,
// emails, or changes either account.
const clean = value => String(value == null ? "" : value).trim();
const githubToken = clean(inputData.customer_github_token);
const netlifyToken = clean(inputData.customer_netlify_access_token);
const evidenceSecret = clean(inputData.customer_control_evidence_secret);
const customerEmail = clean(inputData.customer_email).toLowerCase();
const previewFolder = clean(inputData.preview_folder).replace(/^\/+|\/+$/g, "").toLowerCase();
const bundleFingerprint = clean(inputData.bundle_fingerprint).toLowerCase();
const paymentEvidenceSha256 = clean(inputData.payment_evidence_sha256).toLowerCase();
const mergeCommitSha = clean(inputData.merge_commit_sha).toLowerCase();
const repositoryOwner = clean(inputData.customer_github_owner).toLowerCase();
const repositoryName = clean(inputData.customer_github_repo).toLowerCase();
const netlifyAccountId = clean(inputData.customer_netlify_account_id);
const netlifySiteId = clean(inputData.customer_netlify_site_id).toLowerCase();
const netlifyDeployId = clean(inputData.customer_netlify_deploy_id).toLowerCase();

if (!githubToken || !netlifyToken) throw new Error("ARC_CUSTOMER_CONTROL_INVALID: customer GitHub and Netlify tokens are required");
if (evidenceSecret.length < 32 || evidenceSecret.length > 256) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: evidence secret must be 32–256 characters");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error("ARC_CUSTOMER_CONTROL_INVALID: customer email");
if (!/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder)) throw new Error("ARC_CUSTOMER_CONTROL_INVALID: preview folder");
if (!/^[a-f0-9]{64}$/.test(bundleFingerprint) || !/^[a-f0-9]{64}$/.test(paymentEvidenceSha256) || !/^[a-f0-9]{40}$/.test(mergeCommitSha)) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: delivery proof digest");
}
if (!/^[a-z0-9_.-]+$/.test(repositoryOwner) || !/^[a-z0-9_.-]+$/.test(repositoryName) || repositoryOwner === "arcwebhq-cpu") {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: customer repository identity");
}
const externalId = value => /^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|[A-Za-z0-9][A-Za-z0-9_-]{5,127})$/i.test(clean(value));
if (!externalId(netlifyAccountId) || !externalId(netlifySiteId) || !externalId(netlifyDeployId)) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: Netlify identity");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC_CRYPTO_UNAVAILABLE: HMAC-SHA-256, SHA-256, and base64 decoding are required");
}
const encoder = new TextEncoder();
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const sha1Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-1", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const evidenceKey = await globalThis.crypto.subtle.importKey(
  "raw", encoder.encode(evidenceSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
);
const hmacHex = async value => {
  const signature = await globalThis.crypto.subtle.sign("HMAC", evidenceKey, encoder.encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const decodeBase64 = (value, label) => {
  const normalized = clean(value).replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error(`ARC_CUSTOMER_CONTROL_INVALID: ${label} base64`);
  return Buffer.from(normalized, "base64").toString("utf8");
};
const productionHtml = decodeBase64(inputData.production_content_base64, "production HTML");
const netlifyConfig = decodeBase64(inputData.netlify_config_base64, "Netlify config");
const usageGuide = decodeBase64(inputData.usage_guide_base64, "usage guide");
const deliveryRoot = `deliveries/${previewFolder}`;
const artifacts = [
  { sourcePath: `${deliveryRoot}/index.html`, customerPath: "index.html", content: productionHtml },
  { sourcePath: `${deliveryRoot}/netlify.toml`, customerPath: "netlify.toml", content: netlifyConfig },
  { sourcePath: `${deliveryRoot}/USAGE.md`, customerPath: "USAGE.md", content: usageGuide }
];
const calculatedBundleFingerprint = await sha256Hex(artifacts.map(artifact => `${artifact.sourcePath}\0${artifact.content}\0`).join(""));
if (calculatedBundleFingerprint !== bundleFingerprint) throw new Error("ARC_CUSTOMER_CONTROL_INVALID: delivery bundle bytes changed");
const marker = `${JSON.stringify({
  version: "arc-handoff-v2",
  preview_folder: previewFolder,
  fingerprint_algorithm: "sha256",
  bundle_fingerprint: bundleFingerprint,
  files: [...artifacts.map(artifact => artifact.sourcePath), `${deliveryRoot}/.arc-handoff.json`]
}, null, 2)}\n`;
artifacts.push({ sourcePath: `${deliveryRoot}/.arc-handoff.json`, customerPath: ".arc-handoff.json", content: marker });

const githubHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${githubToken}`,
  "X-GitHub-Api-Version": "2022-11-28"
};
const githubRead = async path => {
  const response = await fetch(`https://api.github.com${path}`, { method: "GET", headers: githubHeaders, redirect: "error" });
  if (!response.ok) throw new Error(`ARC_CUSTOMER_CONTROL_READ_FAILED: GitHub ${response.status} ${path}`);
  return response.json();
};
const githubUser = await githubRead("/user");
const repository = await githubRead(`/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`);
const githubUserId = clean(githubUser.id);
const repositoryFullName = `${repositoryOwner}/${repositoryName}`;
const defaultBranch = clean(repository.default_branch);
if (!/^\d+$/.test(githubUserId) || clean(repository.full_name).toLowerCase() !== repositoryFullName ||
    clean(repository.owner?.login).toLowerCase() !== repositoryOwner || repository.permissions?.admin !== true ||
    !/^[A-Za-z0-9._/-]{1,255}$/.test(defaultBranch)) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: authenticated GitHub user lacks admin control of the exact repository");
}
const branch = await githubRead(`/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/branches/${encodeURIComponent(defaultBranch)}`);
const customerCommitSha = clean(branch.commit?.sha).toLowerCase();
if (!/^[a-f0-9]{40}$/.test(customerCommitSha)) throw new Error("ARC_CUSTOMER_CONTROL_INVALID: customer repository commit");
const customerCommit = await githubRead(`/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/commits/${customerCommitSha}`);
const customerTreeSha = clean(customerCommit.tree?.sha).toLowerCase();
if (clean(customerCommit.sha).toLowerCase() !== customerCommitSha || !/^[a-f0-9]{40}$/.test(customerTreeSha)) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: customer repository tree identity");
}
const tree = await githubRead(`/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/git/trees/${customerTreeSha}?recursive=1`);
const repositoryFiles = (Array.isArray(tree.tree) ? tree.tree : []).filter(entry => clean(entry.type) === "blob");
if (tree.truncated === true || repositoryFiles.length !== artifacts.length ||
    artifacts.some(artifact => repositoryFiles.filter(entry => clean(entry.path) === artifact.customerPath).length !== 1)) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: customer repository must contain only the exact four-file delivery bundle");
}
for (const artifact of artifacts) {
  const content = await githubRead(`/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/contents/${encodeURIComponent(artifact.customerPath)}?ref=${encodeURIComponent(customerCommitSha)}`);
  if (clean(content.type) !== "file" || Buffer.from(clean(content.content).replace(/\s/g, ""), "base64").toString("utf8") !== artifact.content) {
    throw new Error(`ARC_CUSTOMER_CONTROL_INVALID: customer repository bytes changed for ${artifact.customerPath}`);
  }
}
const repositoryTreeSha256 = await sha256Hex(JSON.stringify(repositoryFiles.map(entry => ({
  path: clean(entry.path), sha: clean(entry.sha).toLowerCase(), size: Number(entry.size)
})).sort((left, right) => left.path.localeCompare(right.path))));

const netlifyHeaders = { Accept: "application/json", Authorization: `Bearer ${netlifyToken}` };
const netlifyRead = async path => {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, { method: "GET", headers: netlifyHeaders, redirect: "error" });
  if (!response.ok) throw new Error(`ARC_CUSTOMER_CONTROL_READ_FAILED: Netlify ${response.status} ${path}`);
  return response.json();
};
const netlifyRaw = async path => {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
    method: "GET",
    headers: { ...netlifyHeaders, Accept: "application/vnd.bitballoon.v1.raw", "Content-Type": "application/vnd.bitballoon.v1.raw" },
    redirect: "error"
  });
  if (!response.ok) throw new Error(`ARC_CUSTOMER_CONTROL_READ_FAILED: Netlify ${response.status} ${path}`);
  return response.text();
};
const netlifyUser = await netlifyRead("/user");
const account = await netlifyRead(`/accounts/${encodeURIComponent(netlifyAccountId)}`);
const netlifyUserId = clean(netlifyUser.id);
if (!externalId(netlifyUserId) || clean(account.id) !== netlifyAccountId ||
    !Array.isArray(account.owner_ids) || !account.owner_ids.map(clean).includes(netlifyUserId)) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: authenticated Netlify user is not an owner of the exact account");
}
const site = await netlifyRead(`/sites/${encodeURIComponent(netlifySiteId)}`);
const deploy = await netlifyRead(`/sites/${encodeURIComponent(netlifySiteId)}/deploys/${encodeURIComponent(netlifyDeployId)}`);
const repoInfo = site.build_settings && typeof site.build_settings === "object" ? site.build_settings : site.repo;
const siteUrl = new URL(clean(site.ssl_url || site.url));
const immutableDeployUrl = new URL(clean(deploy.deploy_ssl_url || deploy.deploy_url));
if (clean(site.id).toLowerCase() !== netlifySiteId || clean(site.account_id) !== netlifyAccountId ||
    clean(site.published_deploy?.id).toLowerCase() !== netlifyDeployId || clean(site.state).toLowerCase() === "disabled" ||
    clean(deploy.id).toLowerCase() !== netlifyDeployId || clean(deploy.site_id).toLowerCase() !== netlifySiteId ||
    clean(deploy.state).toLowerCase() !== "ready" || clean(deploy.commit_ref).toLowerCase() !== customerCommitSha ||
    clean(repoInfo?.provider).toLowerCase() !== "github" || clean(repoInfo?.repo_path).toLowerCase() !== repositoryFullName ||
    clean(repoInfo?.repo_branch) !== defaultBranch || !["", ".", "/"].includes(clean(repoInfo?.dir)) ||
    siteUrl.protocol !== "https:" || siteUrl.pathname !== "/" || siteUrl.username || siteUrl.password || siteUrl.search || siteUrl.hash ||
    immutableDeployUrl.protocol !== "https:" || immutableDeployUrl.pathname !== "/" || immutableDeployUrl.username || immutableDeployUrl.password || immutableDeployUrl.search || immutableDeployUrl.hash) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: exact customer-owned Netlify site, deploy, and repository link mismatch");
}
const deployFiles = await netlifyRead(`/sites/${encodeURIComponent(netlifySiteId)}/files`);
if (!Array.isArray(deployFiles) || deployFiles.length !== artifacts.length) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: customer Netlify deploy is not the exact four-file bundle");
}
const normalizedDeployFiles = [];
for (const artifact of artifacts) {
  const path = `/${artifact.customerPath}`;
  const expectedSha = await sha1Hex(artifact.content);
  const expectedSize = encoder.encode(artifact.content).length;
  const matches = deployFiles.filter(file => clean(file.path || file.id) === path);
  if (matches.length !== 1 || clean(matches[0].sha).toLowerCase() !== expectedSha || Number(matches[0].size) !== expectedSize ||
      await netlifyRaw(`/sites/${encodeURIComponent(netlifySiteId)}/files/${artifact.customerPath.split("/").map(encodeURIComponent).join("/")}`) !== artifact.content) {
    throw new Error(`ARC_CUSTOMER_CONTROL_INVALID: customer Netlify source bytes changed for ${path}`);
  }
  normalizedDeployFiles.push({ path, sha: expectedSha, size: expectedSize, mime_type: clean(matches[0].mime_type).toLowerCase() });
}
normalizedDeployFiles.sort((left, right) => left.path.localeCompare(right.path));
const deployFileManifestSha256 = await sha256Hex(JSON.stringify(normalizedDeployFiles));
const expectedServedHtml = productionHtml
  .replace(/\sdata-netlify="true"/i, "")
  .replace(/\snetlify-honeypot="bot-field"/i, "");
const liveResponse = await fetch(immutableDeployUrl.toString(), { method: "GET", headers: { Accept: "text/html" }, redirect: "manual" });
const servedHtml = await liveResponse.text();
const finalUrl = new URL(liveResponse.url || immutableDeployUrl.toString());
if (liveResponse.status !== 200 || finalUrl.toString() !== immutableDeployUrl.toString() || servedHtml !== expectedServedHtml) {
  throw new Error("ARC_CUSTOMER_CONTROL_INVALID: immutable customer Netlify deploy bytes changed");
}

const verifiedAt = new Date().toISOString();
const recipientHmacSha256 = await hmacHex(`arc-customer-control-recipient-v1\n${customerEmail}`);
const evidence = {
  version: "arc-customer-control-evidence-v1",
  scope: "customer-owned-github-and-netlify",
  preview_folder: previewFolder,
  bundle_fingerprint: bundleFingerprint,
  payment_evidence_sha256: paymentEvidenceSha256,
  merge_commit_sha: mergeCommitSha,
  recipient_hmac_sha256: recipientHmacSha256,
  github_user_id_sha256: await sha256Hex(githubUserId),
  github_repository: repositoryFullName,
  github_repository_id: Number(repository.id),
  github_default_branch: defaultBranch,
  github_commit_sha: customerCommitSha,
  github_repository_tree_sha256: repositoryTreeSha256,
  netlify_user_id_sha256: await sha256Hex(netlifyUserId),
  netlify_account_id: netlifyAccountId,
  netlify_site_id: netlifySiteId,
  netlify_site_url: siteUrl.toString(),
  netlify_deploy_id: netlifyDeployId,
  netlify_deploy_url: immutableDeployUrl.toString(),
  netlify_deploy_file_manifest_sha256: deployFileManifestSha256,
  served_html_sha256: await sha256Hex(servedHtml),
  verified_at: verifiedAt
};
const canonicalEvidence = JSON.stringify(evidence);
return {
  status: "CUSTOMER_CONTROL_EVIDENCE_ISSUED",
  send_delivery_email: false,
  write_methods_allowed: false,
  customer_control_evidence: canonicalEvidence,
  customer_control_evidence_hmac_sha256: await hmacHex(`arc-customer-control-evidence-signature-v1\n${canonicalEvidence}`),
  customer_control_evidence_sha256: await sha256Hex(canonicalEvidence),
  customer_control_recipient_hmac_sha256: recipientHmacSha256,
  customer_repository_url: `https://github.com/${repositoryFullName}`,
  customer_site_url: siteUrl.toString(),
  customer_deploy_url: immutableDeployUrl.toString(),
  verified_at: verifiedAt
};
