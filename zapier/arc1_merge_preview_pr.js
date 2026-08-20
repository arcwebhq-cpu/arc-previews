// ARC1 merge step — after the exact quality check succeeds, ready and squash-merge one bound preview PR.
// This step never authorizes or sends customer email.
const clean = value => String(value == null ? "" : value).trim();
const decodeCheckoutSurface=value=>{let current=String(value==null?"":value);for(let pass=0;pass<5;pass+=1){let next=current.replace(/&#(\d+);?/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);?/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&(amp|period|colon|sol|percnt|num|tab|newline);/gi,(_,name)=>({amp:"&",period:".",colon:":",sol:"/",percnt:"%",num:"#",tab:"\t",newline:"\n"})[name.toLowerCase()]).replace(/\/\*[\s\S]*?\*\//g,"").replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16))).replace(/[\u3002\uff0e\uff61]/g,".").replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded.replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));}});if(next===current)break;current=next;}return current.normalize("NFKC").toLowerCase();};
const hasCheckoutCapability=value=>{const raw=String(value==null?"":value),decoded=decodeCheckoutSurface(raw),compact=decoded.replace(/[\s\u0000-\u001f\u007f]+/g,""),forbidden=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v3_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v1|arc1-checkout-recipient-reservation-v1|arc1-preview-readiness-(?:core|observation)-v1|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v1|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;if(forbidden.test(decoded)||forbidden.test(compact)||/<[A-Za-z][^>]*\son[a-z0-9_-]+\s*=/i.test(raw)||(raw.match(/<script\b/gi)||[]).length!==3||(raw.match(/<\/script\b/gi)||[]).length!==3||/<\/script\s+>/i.test(raw))return true;for(const match of raw.matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){const attr=match[1]??match[2]??match[3]??"",normalized=decodeCheckoutSurface(attr);let parsed;try{parsed=new URL(normalized,"https://arc.invalid/");}catch{}const host=parsed?.hostname?.toLowerCase()||"";if(/%(?![0-9a-f]{2})/i.test(attr)||/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(attr)||/\p{Default_Ignorable_Code_Point}/u.test(normalized)||host==="buy.stripe.com"||host.endsWith(".buy.stripe.com")||/^(?:javascript|vbscript):/i.test(normalized)||forbidden.test(normalized)||forbidden.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g,"")))return true;}return false;};
const hasUnsafeBrowserMarkup=value=>{const raw=String(value==null?"":value),decoded=decodeCheckoutSurface(raw),nonScript=decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"");return /&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(raw)||/\p{Default_Ignorable_Code_Point}/u.test(nonScript)||/<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(raw)||/<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style\s*>/i.test(decoded)||/\bstyle\s*=\s*(?:"[^"]*\\|'[^']*\\)/i.test(decoded);};
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
const assetPublicationReceiptSha256 = clean(inputData.asset_publication_receipt_sha256).toLowerCase();
const checkoutOfferSnapshotSha256 = clean(inputData.checkout_offer_snapshot_sha256 || inputData.checkout_config_snapshot_sha256).toLowerCase();
const approvalContentSha256 = clean(inputData.approval_content_sha256).toLowerCase();

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
if (!/^[a-f0-9]{64}$/.test(checkoutOfferSnapshotSha256) || !/^[a-f0-9]{64}$/.test(approvalContentSha256)) {
  throw new Error("ARC_PREVIEW_MERGE_INVALID: private checkout offer/approval binding");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
  throw new Error("ARC_PREVIEW_MERGE_INVALID: SHA-256 runtime unavailable");
}
const sha256Hex = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC_PREVIEW_MERGE_INVALID: publication receipt JSON");
};
let publicAssetEntries = [];
if (assetPublicationReceiptSha256) {
  const secret = String(inputData.asset_publication_receipt_secret == null ? "" : inputData.asset_publication_receipt_secret);
  const receiptRaw = clean(inputData.asset_publication_receipt_private);
  let receipt;
  try { receipt = JSON.parse(receiptRaw); } catch { throw new Error("ARC_PREVIEW_MERGE_INVALID: publication receipt JSON"); }
  const fields = ["version","scope","bridge_contract_sha256","delivery_id","bridge_evidence_sha256","private_asset_receipt_sha256",
    "intake_evidence_sha256","intake_state_digest_sha256","asset_manifest_sha256","asset_permission","repository","base_branch",
    "preview_branch","pages_base_url","public_folder_prefix","preview_folder","entries","status"];
  const entryFields = ["asset_id","content_type","git_blob_sha1","public_url","repository_path","role","sha256","size_bytes"];
  if (new TextEncoder().encode(secret).length < 32 || new TextEncoder().encode(secret).length > 256 || !receipt ||
      canonicalJson(receipt) !== receiptRaw || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(fields.slice().sort()) ||
      receipt.version !== "arc1-public-asset-publication-receipt-v1" || receipt.scope !== "github-content-addressed-preview-assets" ||
      receipt.bridge_contract_sha256 !== "e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841" ||
      !/^[a-f0-9]{64}$/.test(receipt.delivery_id) || !/^[a-f0-9]{64}$/.test(receipt.bridge_evidence_sha256) ||
      !/^[a-f0-9]{64}$/.test(receipt.private_asset_receipt_sha256) || !/^[a-f0-9]{64}$/.test(receipt.intake_evidence_sha256) ||
      !/^[a-f0-9]{64}$/.test(receipt.intake_state_digest_sha256) || !/^[a-f0-9]{64}$/.test(receipt.asset_manifest_sha256) ||
      receipt.repository !== `${owner}/${repository}` || receipt.base_branch !== baseBranch || receipt.preview_branch !== previewBranch ||
      receipt.preview_folder !== previewFolder || receipt.public_folder_prefix !== suffix || !Array.isArray(receipt.entries) || receipt.entries.length > 3 ||
      receipt.status !== (receipt.entries.length ? "VERIFIED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS") ||
      receipt.asset_permission !== (receipt.entries.length ? "Confirmed" : "") ||
      await sha256Hex(receiptRaw) !== assetPublicationReceiptSha256) throw new Error("ARC_PREVIEW_MERGE_INVALID: publication receipt binding");
  const roles = new Set(); let totalBytes = 0;
  for (const entry of receipt.entries) {
    if (!entry || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(entryFields.slice().sort()) ||
        !/^[a-f0-9]{40}$/.test(entry.git_blob_sha1) || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        entry.repository_path !== `${previewFolder}/assets/${entry.sha256}.${({"image/png":"png","image/jpeg":"jpg","image/webp":"webp"})[entry.content_type]}` ||
        entry.public_url !== `https://${owner}.github.io/${repository}/${entry.repository_path}` ||
        !/^[a-f0-9]{64}$/.test(entry.asset_id) || !new Set(["hero_image_file","logo_file","supporting_image_file"]).has(entry.role) || roles.has(entry.role) ||
        !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 1 || entry.size_bytes > 1250000) throw new Error("ARC_PREVIEW_MERGE_INVALID: publication receipt entry");
    roles.add(entry.role); totalBytes += entry.size_bytes;
  }
  if (totalBytes > 3000000) throw new Error("ARC_PREVIEW_MERGE_INVALID: publication receipt aggregate size");
  const signature = clean(inputData.asset_publication_receipt_hmac_sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error("ARC_PREVIEW_MERGE_INVALID: publication receipt HMAC");
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g), byte => Number.parseInt(byte, 16));
  if (!await globalThis.crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`arc1-public-asset-publication-receipt-v1\n${receiptRaw}`))) {
    throw new Error("ARC_PREVIEW_MERGE_INVALID: publication receipt HMAC mismatch");
  }
  publicAssetEntries = receipt.entries;
}

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
  const expected = new Set([filePath, ...new Set(publicAssetEntries.map(entry => entry.repository_path))]);
  if (!Array.isArray(files) || files.length !== expected.size || files.some(file => !expected.has(clean(file.filename)) ||
      !new Set(["added", "modified"]).has(clean(file.status)) || file.previous_filename)) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: PR exact file scope changed");
  }
};
const verifyAssetTree = async commitSha => {
  if (!publicAssetEntries.length) return;
  const commit = await request(`${api}/git/commits/${commitSha}`);
  let treeSha = clean(commit.tree?.sha);
  if (!/^[a-f0-9]{40}$/.test(treeSha)) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: commit tree");
  let tree = await request(`${api}/git/trees/${treeSha}`);
  let matches = (Array.isArray(tree.tree) ? tree.tree : []).filter(item => item.path === previewFolder && item.type === "tree" && item.mode === "040000");
  if (matches.length !== 1) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: exact preview tree");
  const folder = await request(`${api}/git/trees/${matches[0].sha}`);
  const folderItems = Array.isArray(folder.tree) ? folder.tree : [];
  const assets = folderItems.filter(item => item.path === "assets" && item.type === "tree" && item.mode === "040000");
  const index = folderItems.filter(item => item.path === "index.html" && item.type === "blob" && item.mode === "100644");
  if (folderItems.length !== 2 || assets.length !== 1 || index.length !== 1) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: exact preview root tree");
  const leaf = await request(`${api}/git/trees/${assets[0].sha}`);
  const items = Array.isArray(leaf.tree) ? leaf.tree : [];
  const unique = new Map(publicAssetEntries.map(entry => [entry.repository_path.split("/").at(-1), entry]));
  if (items.length !== unique.size || items.some(item => item.type !== "blob" || item.mode !== "100644" || !unique.has(item.path))) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: exact asset tree");
  }
  for (const item of items) {
    const entry = unique.get(item.path);
    if (item.sha !== entry.git_blob_sha1 || item.size !== entry.size_bytes) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: asset blob identity");
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
  if (hasCheckoutCapability(sourceHtml) || hasUnsafeBrowserMarkup(sourceHtml)) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: public preview contains a checkout capability or private offer evidence");
  }
  const trusted=["55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870","98cbb58e3ec829ddaec61983333a8bb500b91558625a346350bfc8fe4842b860"].sort();
  const hashes=[];for(const script of sourceHtml.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[])hashes.push(await sha256Hex(script));hashes.sort();
  if(hashes.length!==3||JSON.stringify(hashes)!==JSON.stringify(trusted)||await sha256Hex(hashes.join("\n"))!=="8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b")throw new Error("ARC_PREVIEW_MERGE_MISMATCH: reviewed script manifest changed");
  const terminalNotice = sourceHtml.match(/<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview<\/strong>Built for this business\. Purchase only if approved\.<\/span><span data-arc-checkout-private>Checkout is available only through the private approval email\.<\/span><\/aside>\n<\/body>\n<\/html>$/)?.[0] || "";
  if (!terminalNotice) throw new Error("ARC_PREVIEW_MERGE_MISMATCH: exact inert checkout notice missing");
  const approvalHtml = sourceHtml.slice(0, -terminalNotice.length) + "</body>\n</html>";
  if (await sha256Hex(approvalHtml) !== approvalContentSha256) {
    throw new Error("ARC_PREVIEW_MERGE_MISMATCH: approved bytes differ from private checkout approval digest");
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
    asset_publication_receipt_sha256: assetPublicationReceiptSha256,
    checkout_offer_snapshot_sha256: checkoutOfferSnapshotSha256,
    script_manifest_sha256:"8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b",
    approval_content_sha256:approvalContentSha256,
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
await verifyAssetTree(expectedHeadSha);

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
  await verifyAssetTree(clean(pull.merge_commit_sha).toLowerCase());
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
await verifyAssetTree(clean(merged.sha).toLowerCase());

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
