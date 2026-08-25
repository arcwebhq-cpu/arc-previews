// ARC1 polling/status step — fail closed until CI, merge, Pages, and private email state all prove ready.
// A token-bound Git ref is the atomic one-time claim; persist next_email_state before invoking email for auditability.
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
const emailStateToken = clean(inputData.email_state_token);
const customerEmail = clean(inputData.customer_email).toLowerCase();
const assetPublicationReceiptSha256 = clean(inputData.asset_publication_receipt_sha256).toLowerCase();
const checkoutOfferSnapshotRaw = clean(inputData.checkout_config_snapshot_private || inputData.checkout_offer_snapshot_private);
const checkoutOfferSnapshotSha256 = clean(inputData.checkout_config_snapshot_sha256 || inputData.checkout_offer_snapshot_sha256).toLowerCase();
const checkoutOfferSnapshotHmacSha256 = clean(inputData.checkout_config_snapshot_hmac_sha256 || inputData.checkout_offer_snapshot_hmac_sha256).toLowerCase();
const checkoutRecipientReservationRaw = clean(inputData.checkout_recipient_reservation_private);
const checkoutRecipientReservationHmacSha256 = clean(inputData.checkout_recipient_reservation_hmac_sha256).toLowerCase();

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
const sha256Bytes = async value => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const recipientSha256 = await sha256Hex(customerEmail);
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value,-0)?0:value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new Error("ARC_PREVIEW_GATE_INVALID: publication receipt JSON");
};
const approvalContentSha256=clean(inputData.approval_content_sha256).toLowerCase();
let checkoutOfferSnapshot, checkoutRecipientReservation;
try {
  checkoutOfferSnapshot = JSON.parse(checkoutOfferSnapshotRaw);
  checkoutRecipientReservation = JSON.parse(checkoutRecipientReservationRaw);
} catch { throw new Error("ARC_PREVIEW_GATE_INVALID: private checkout offer/reference/reservation encoding"); }
if (!/^[a-f0-9]{64}$/.test(approvalContentSha256) || !checkoutOfferSnapshot || canonicalJson(checkoutOfferSnapshot) !== checkoutOfferSnapshotRaw ||
    checkoutOfferSnapshot.version !== "arc-checkout-offer-snapshot-v1" || checkoutOfferSnapshot.scope !== "immutable-approved-preview-private-checkout-offer" ||
    checkoutOfferSnapshot.preview_folder !== previewFolder || checkoutOfferSnapshot.preview_path !== filePath ||
    checkoutOfferSnapshot.preview_source_repository !== `${owner}/${repository}` || checkoutOfferSnapshot.public_folder_prefix !== suffix ||
    !/^[a-f0-9]{64}$/.test(checkoutOfferSnapshotSha256) || await sha256Hex(checkoutOfferSnapshotRaw) !== checkoutOfferSnapshotSha256 ||
    !/^[a-f0-9]{64}$/.test(checkoutOfferSnapshotHmacSha256) ||
    !checkoutRecipientReservation || canonicalJson(checkoutRecipientReservation) !== checkoutRecipientReservationRaw ||
    checkoutRecipientReservation.version !== "arc1-checkout-recipient-reservation-v1" ||
    checkoutRecipientReservation.scope !== "private-lead-recipient-for-approved-checkout" ||
    checkoutRecipientReservation.approval_content_sha256 !== approvalContentSha256 ||
    checkoutRecipientReservation.checkout_offer_snapshot_sha256 !== checkoutOfferSnapshotSha256 ||
    checkoutRecipientReservation.checkout_binding_key_id !== checkoutOfferSnapshot.checkout_binding_key_id ||
    checkoutRecipientReservation.lead_route_recipient_hmac_sha256 !== checkoutOfferSnapshot.lead_route_recipient_hmac_sha256 ||
    clean(checkoutRecipientReservation.claim_recipient_email).toLowerCase() !== customerEmail ||
    checkoutRecipientReservation.claim_recipient_email_sha256 !== recipientSha256 ||
    !/^[a-f0-9]{64}$/.test(checkoutRecipientReservationHmacSha256)) {
  throw new Error("ARC_PREVIEW_GATE_INVALID: private checkout offer/reference/reservation binding");
}
const currentCheckoutBindingKeyId=clean(inputData.checkout_binding_key_id).toLowerCase();
const currentCheckoutBindingSecret=clean(inputData.checkout_binding_secret);
const retiredCheckoutBindingKeysRaw=clean(inputData.retired_checkout_binding_keys_json);
let retiredCheckoutBindingKeys;
try { retiredCheckoutBindingKeys=JSON.parse(retiredCheckoutBindingKeysRaw); } catch {}
if(!/^[a-f0-9]{2}$/.test(currentCheckoutBindingKeyId)||currentCheckoutBindingSecret.length<32||currentCheckoutBindingSecret.length>256||
  !retiredCheckoutBindingKeys||typeof retiredCheckoutBindingKeys!=="object"||Array.isArray(retiredCheckoutBindingKeys)||canonicalJson(retiredCheckoutBindingKeys)!==retiredCheckoutBindingKeysRaw||
  Object.entries(retiredCheckoutBindingKeys).some(([id,value])=>!/^[a-f0-9]{2}$/.test(id)||id===currentCheckoutBindingKeyId||typeof value!=="string"||value.length<32||value.length>256)){
  throw new Error("ARC_PREVIEW_GATE_INVALID: checkout binding key registry");
}
const selectedCheckoutBindingSecret=checkoutOfferSnapshot.checkout_binding_key_id===currentCheckoutBindingKeyId?currentCheckoutBindingSecret:retiredCheckoutBindingKeys[checkoutOfferSnapshot.checkout_binding_key_id];
if(!selectedCheckoutBindingSecret)throw new Error("ARC_PREVIEW_GATE_INVALID: checkout binding key is not retained");
const checkoutMode=checkoutOfferSnapshot.livemode?"live":"test";
const checkoutKey=await globalThis.crypto.subtle.importKey("raw",new TextEncoder().encode(selectedCheckoutBindingSecret),{name:"HMAC",hash:"SHA-256"},false,["verify","sign"]);
const hexBytes=hex=>Uint8Array.from(hex.match(/../g)||[],byte=>Number.parseInt(byte,16));
if(!await globalThis.crypto.subtle.verify("HMAC",checkoutKey,hexBytes(checkoutOfferSnapshotHmacSha256),new TextEncoder().encode(`arc-checkout-offer-snapshot-signature-v1\n${checkoutMode}\n${checkoutOfferSnapshotRaw}`))||
  !await globalThis.crypto.subtle.verify("HMAC",checkoutKey,hexBytes(checkoutRecipientReservationHmacSha256),new TextEncoder().encode(`arc1-checkout-recipient-reservation-signature-v1\n${checkoutMode}\n${checkoutRecipientReservationRaw}`))){
  throw new Error("ARC_PREVIEW_GATE_INVALID: private checkout offer/reference/reservation HMAC");
}
let publicAssetEntries=[];
if(assetPublicationReceiptSha256){
  const secret=String(inputData.asset_publication_receipt_secret==null?"":inputData.asset_publication_receipt_secret),raw=clean(inputData.asset_publication_receipt_private);
  let receipt;try{receipt=JSON.parse(raw);}catch{throw new Error("ARC_PREVIEW_GATE_INVALID: publication receipt JSON");}
  const fields=["version","scope","bridge_contract_sha256","delivery_id","bridge_evidence_sha256","private_asset_receipt_sha256","intake_evidence_sha256","intake_state_digest_sha256","asset_manifest_sha256","asset_permission","repository","base_branch","preview_branch","pages_base_url","public_folder_prefix","preview_folder","entries","status"];
  const entryFields=["asset_id","content_type","git_blob_sha1","public_url","repository_path","role","sha256","size_bytes"];
  if(new TextEncoder().encode(secret).length<32||new TextEncoder().encode(secret).length>256||!receipt||canonicalJson(receipt)!==raw||JSON.stringify(Object.keys(receipt).sort())!==JSON.stringify(fields.slice().sort())||receipt.version!=="arc1-public-asset-publication-receipt-v1"||receipt.scope!=="github-content-addressed-preview-assets"||receipt.bridge_contract_sha256!=="e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841"||![receipt.delivery_id,receipt.bridge_evidence_sha256,receipt.private_asset_receipt_sha256,receipt.intake_evidence_sha256,receipt.intake_state_digest_sha256,receipt.asset_manifest_sha256].every(value=>/^[a-f0-9]{64}$/.test(value))||receipt.repository!==`${owner}/${repository}`||receipt.base_branch!==baseBranch||receipt.preview_branch!==previewBranch||receipt.preview_folder!==previewFolder||!Array.isArray(receipt.entries)||receipt.entries.length>3||receipt.status!==(receipt.entries.length?"VERIFIED_CONTENT_ADDRESSED":"NO_PUBLIC_UPLOADS")||receipt.asset_permission!==(receipt.entries.length?"Confirmed":"")||await sha256Hex(raw)!==assetPublicationReceiptSha256)throw new Error("ARC_PREVIEW_GATE_INVALID: publication receipt binding");
  const roles=new Set();let totalBytes=0;
  for(const entry of receipt.entries){if(!entry||JSON.stringify(Object.keys(entry).sort())!==JSON.stringify(entryFields.slice().sort())||!/^[a-f0-9]{40}$/.test(entry.git_blob_sha1)||!/^[a-f0-9]{64}$/.test(entry.sha256)||!/^[a-f0-9]{64}$/.test(entry.asset_id)||!new Set(["hero_image_file","logo_file","supporting_image_file"]).has(entry.role)||roles.has(entry.role)||entry.repository_path!==`${previewFolder}/assets/${entry.sha256}.${({"image/png":"png","image/jpeg":"jpg","image/webp":"webp"})[entry.content_type]}`||entry.public_url!==`https://${owner}.github.io/${repository}/${entry.repository_path}`||!Number.isSafeInteger(entry.size_bytes)||entry.size_bytes<1||entry.size_bytes>1250000)throw new Error("ARC_PREVIEW_GATE_INVALID: publication receipt entry");roles.add(entry.role);totalBytes+=entry.size_bytes;}if(totalBytes>3000000)throw new Error("ARC_PREVIEW_GATE_INVALID: publication receipt aggregate size");
  const signature=clean(inputData.asset_publication_receipt_hmac_sha256).toLowerCase(),key=await globalThis.crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  if(!/^[a-f0-9]{64}$/.test(signature)||!await globalThis.crypto.subtle.verify("HMAC",key,Uint8Array.from(signature.match(/../g),b=>Number.parseInt(b,16)),new TextEncoder().encode(`arc1-public-asset-publication-receipt-v1\n${raw}`)))throw new Error("ARC_PREVIEW_GATE_INVALID: publication receipt HMAC");
  publicAssetEntries=receipt.entries;
}
const tokenSha256 = await sha256Hex(emailStateToken);
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
  || (assetPublicationReceiptSha256 && clean(emailState.asset_publication_receipt_sha256).toLowerCase() !== assetPublicationReceiptSha256)
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
  || clean(mergeProof.asset_publication_receipt_sha256).toLowerCase() !== assetPublicationReceiptSha256
  || clean(mergeProof.checkout_offer_snapshot_sha256).toLowerCase() !== checkoutOfferSnapshotSha256
  || clean(mergeProof.approval_content_sha256).toLowerCase() !== approvalContentSha256
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
const requestedOperationTimeout = clean(inputData.provider_operation_timeout_ms);
const operationTimeoutMs = requestedOperationTimeout ? Number(requestedOperationTimeout) : 25000;
if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 100 || operationTimeoutMs > 25000) {
  throw new Error("ARC_PROVIDER_READ_FAILED: operation timeout is invalid");
}
const operationDeadline = Date.now() + operationTimeoutMs;
const fetchBounded = async (url, options, maximumBytes, expectedOrigin, label) => {
  const requestedUrl = new URL(url);
  if (requestedUrl.origin !== expectedOrigin || requestedUrl.username || requestedUrl.password || requestedUrl.port) {
    throw new Error(`${label}: invalid request origin`);
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024) {
    throw new Error(`${label}: invalid response limit`);
  }
  const remaining = operationDeadline - Date.now();
  if (remaining <= 0) throw new Error(`${label}: operation deadline exceeded`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(10000, remaining)));
  let reader;
  try {
    const response = await fetch(requestedUrl.toString(), {
      ...options,
      redirect: "error",
      signal: controller.signal
    });
    if (!response.url || response.url !== requestedUrl.toString()) {
      throw new Error(`${label}: response URL changed`);
    }
    const declared = clean(response.headers?.get?.("content-length"));
    if (declared && (!/^\d{1,10}$/.test(declared) || Number(declared) > maximumBytes)) {
      throw new Error(`${label}: declared response exceeds limit`);
    }
    if (response.status === 204) return { response, bytes: Buffer.alloc(0) };
    reader = response.body?.getReader?.();
    if (!reader) throw new Error(`${label}: streaming response required`);
    let total = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error(`${label}: streamed response exceeds limit`);
      }
      chunks.push(Buffer.from(value));
    }
    return { response, bytes: Buffer.concat(chunks, total) };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label}: request timeout`);
    throw error;
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock?.(); } catch {}
  }
};
const request = async (url, options = {}, allowed = []) => {
  const { response, bytes } = await fetchBounded(url, {
    ...options,
    headers: { ...githubHeaders, ...(options.headers || {}) }
  }, 4 * 1024 * 1024, "https://api.github.com", "ARC_GITHUB_FAILED");
  let body = {};
  if (response.status !== 204) {
    try { body = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error("ARC_GITHUB_FAILED: malformed JSON response"); }
  }
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
const expectedFiles=new Set([filePath,...new Set(publicAssetEntries.map(entry=>entry.repository_path))]);
if (!Array.isArray(pullFiles)||pullFiles.length!==expectedFiles.size||pullFiles.some(file=>!expectedFiles.has(clean(file.filename))||!new Set(["added","modified"]).has(clean(file.status))||file.previous_filename)) {
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
if (Buffer.byteLength(mergedHtml, "utf8") > 2097152) throw new Error("ARC_PREVIEW_GATE_MISMATCH: merged preview HTML exceeds limit");
const mergedInspection = await inspectPublishedHtml(mergedHtml);
if (!mergedInspection.ok) {
  throw new Error(`ARC_PREVIEW_GATE_MISMATCH: merged preview content ${mergedInspection.reason}`);
}
const proofFreeMergedHtml=mergedHtml.replace(/<!-- ARC_PREVIEW_PROOF_START -->[\s\S]*?<!-- ARC_PREVIEW_PROOF_END -->\r?\n?/i,"");
if (hasCheckoutCapability(proofFreeMergedHtml) || hasUnsafeBrowserMarkup(proofFreeMergedHtml)) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: public merged preview contains private checkout capability or evidence");
}
const trustedScriptHashes=["55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870","98cbb58e3ec829ddaec61983333a8bb500b91558625a346350bfc8fe4842b860"].sort();
const observedScriptHashes=[];for(const script of proofFreeMergedHtml.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[])observedScriptHashes.push(await sha256Hex(script));observedScriptHashes.sort();
if(observedScriptHashes.length!==3||JSON.stringify(observedScriptHashes)!==JSON.stringify(trustedScriptHashes)||await sha256Hex(observedScriptHashes.join("\n"))!=="8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b")throw new Error("ARC_PREVIEW_GATE_MISMATCH: reviewed script manifest changed");
const terminalNotice=proofFreeMergedHtml.match(/<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview<\/strong>Built for this business\. Purchase only if approved\.<\/span><span data-arc-checkout-private>Checkout is available only through the private approval email\.<\/span><\/aside>\n<\/body>\n<\/html>$/)?.[0]||"";
if(!terminalNotice)throw new Error("ARC_PREVIEW_GATE_MISMATCH: exact inert checkout notice missing");
const approvalHtml=proofFreeMergedHtml.slice(0,-terminalNotice.length)+"</body>\n</html>";
if(await sha256Hex(approvalHtml)!==approvalContentSha256){
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: approved preview bytes differ from private approval digest");
}
const currentMainRef = await request(`${api}/git/ref/${encodeURIComponent(`heads/${baseBranch}`)}`);
const currentMainSha = clean(currentMainRef.object?.sha).toLowerCase();
if (!/^[a-f0-9]{40}$/.test(currentMainSha)) throw new Error("ARC_PREVIEW_GATE_MISMATCH: current main SHA");
const mainContent = await request(
  `${api}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(currentMainSha)}`
);
const mainHtml = Buffer.from(clean(mainContent.content).replace(/\s/g, ""), "base64").toString("utf8");
if (Buffer.byteLength(mainHtml, "utf8") > 2097152 || mainHtml !== mergedHtml) {
  throw new Error("ARC_PREVIEW_GATE_MISMATCH: current main preview bytes differ from approved merge");
}
const mainInspection = await inspectPublishedHtml(mainHtml);
if (!mainInspection.ok) {
  throw new Error(`ARC_PREVIEW_GATE_MISMATCH: current main preview content ${mainInspection.reason}`);
}
const verifyAssetTree=async commitSha=>{
  if(!publicAssetEntries.length)return;
  const commit=await request(`${api}/git/commits/${commitSha}`);let treeSha=clean(commit.tree?.sha);if(!/^[a-f0-9]{40}$/.test(treeSha))throw new Error("ARC_PREVIEW_GATE_MISMATCH: commit tree");
  let tree=await request(`${api}/git/trees/${treeSha}`),matches=(Array.isArray(tree.tree)?tree.tree:[]).filter(item=>item.path===previewFolder&&item.type==="tree"&&item.mode==="040000");if(matches.length!==1)throw new Error("ARC_PREVIEW_GATE_MISMATCH: preview asset tree");
  const folder=await request(`${api}/git/trees/${matches[0].sha}`),folderItems=Array.isArray(folder.tree)?folder.tree:[],assets=folderItems.filter(item=>item.path==="assets"&&item.type==="tree"&&item.mode==="040000"),index=folderItems.filter(item=>item.path==="index.html"&&item.type==="blob"&&item.mode==="100644");if(folderItems.length!==2||assets.length!==1||index.length!==1)throw new Error("ARC_PREVIEW_GATE_MISMATCH: exact preview root tree");
  const leaf=await request(`${api}/git/trees/${assets[0].sha}`),items=Array.isArray(leaf.tree)?leaf.tree:[],unique=new Map(publicAssetEntries.map(entry=>[entry.repository_path.split("/").at(-1),entry]));if(items.length!==unique.size||items.some(item=>item.type!=="blob"||item.mode!=="100644"||!unique.has(item.path)))throw new Error("ARC_PREVIEW_GATE_MISMATCH: exact asset tree");for(const item of items){const entry=unique.get(item.path);if(item.sha!==entry.git_blob_sha1||item.size!==entry.size_bytes)throw new Error("ARC_PREVIEW_GATE_MISMATCH: asset blob identity");}
};
await verifyAssetTree(mergeCommitSha);
await verifyAssetTree(currentMainSha);

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
const { response: liveResponse, bytes: liveBytes } = await fetchBounded(previewUrl.toString(), {
  method: "GET",
  headers: { Accept: "text/html" }
}, 2097152, previewUrl.origin, "ARC_PREVIEW_GATE_MISMATCH");
if (liveResponse.status !== 200) {
  return wait("WAITING_FOR_PAGES", { quality_check: "success", pr_merged: true, live_status: liveResponse.status });
}
let liveHtml;
try { liveHtml = new TextDecoder("utf-8", { fatal: true }).decode(liveBytes); }
catch { throw new Error("ARC_PREVIEW_GATE_MISMATCH: live preview HTML is not valid UTF-8"); }
if (liveHtml !== mergedHtml) {
  return wait("WAITING_FOR_PAGES", { quality_check: "success", pr_merged: true, live_status: 200, live_proof: "exact-merged-bytes" });
}
const liveInspection = await inspectPublishedHtml(liveHtml);
if (!liveInspection.ok) {
  return wait("WAITING_FOR_PAGES", {
    quality_check: "success",
    pr_merged: true,
    live_status: 200,
    live_proof: liveInspection.reason
  });
}
for(const entry of publicAssetEntries){
  const assetUrl=new URL(entry.public_url);const {response,bytes}=await fetchBounded(assetUrl.toString(),{method:"GET",headers:{Accept:entry.content_type}},entry.size_bytes,assetUrl.origin,"ARC_PREVIEW_GATE_MISMATCH");
  if(response.status!==200||clean(response.headers?.get?.("content-type")).toLowerCase()!==entry.content_type||bytes.length!==entry.size_bytes)return wait("WAITING_FOR_PAGES",{quality_check:"success",pr_merged:true,live_asset:entry.repository_path});
  if(await sha256Bytes(bytes)!==entry.sha256)return wait("WAITING_FOR_PAGES",{quality_check:"success",pr_merged:true,live_asset:entry.repository_path});
}

const sourceCommit=await request(`${api}/git/commits/${mergeCommitSha}`);
const sourceTreeSha=clean(sourceCommit.tree?.sha).toLowerCase();
if(!/^[a-f0-9]{40}$/.test(sourceTreeSha))throw new Error("ARC_PREVIEW_GATE_MISMATCH: immutable source tree SHA");
const issuedAt=new Date().toISOString();
const expiresAt=new Date(Date.parse(issuedAt)+10*60*1000).toISOString();
const readinessCore=canonicalJson({
  version:"arc1-preview-readiness-core-v1",scope:"immutable-private-checkout-content-and-recipient-readiness",
  repository:`${owner}/${repository}`,preview_folder:previewFolder,preview_path:filePath,preview_url:previewUrl.toString(),
  approval_content_sha256:approvalContentSha256,content_sha256:contentSha256,published_html_sha256:await sha256Hex(mergedHtml),
  script_manifest_sha256:"8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b",
  asset_publication_receipt_sha256:assetPublicationReceiptSha256,checkout_offer_snapshot_sha256:checkoutOfferSnapshotSha256,
  checkout_recipient_reservation_sha256:await sha256Hex(checkoutRecipientReservationRaw),
  customer_email_sha256:recipientSha256,email_state_token_sha256:tokenSha256,head_sha:expectedHeadSha,
  merge_commit_sha:mergeCommitSha,source_tree_sha:sourceTreeSha,pr_number:prNumber,
  check_name:requiredCheckName,check_app_slug:requiredCheckAppSlug,check_app_id:requiredCheckAppId,
  merged_at:clean(pull.merged_at)
});
const readinessCoreSha256=await sha256Hex(readinessCore);
const readinessCoreSignature=await globalThis.crypto.subtle.sign("HMAC",checkoutKey,new TextEncoder().encode(`arc1-preview-readiness-core-signature-v1\n${checkoutMode}\n${readinessCore}`));
const readinessCoreHmacSha256=[...new Uint8Array(readinessCoreSignature)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const readinessObservation=canonicalJson({version:"arc1-preview-readiness-observation-v1",scope:"renewable-private-checkout-readiness-observation",readiness_core_sha256:readinessCoreSha256,
  current_main_sha:currentMainSha,current_main_html_sha256:await sha256Hex(mainHtml),pages_content_sha256:await sha256Hex(liveHtml),issued_at:issuedAt,expires_at:expiresAt});
const readinessObservationSignature=await globalThis.crypto.subtle.sign("HMAC",checkoutKey,new TextEncoder().encode(`arc1-preview-readiness-observation-signature-v1\n${checkoutMode}\n${readinessObservation}`));
const readinessObservationHmacSha256=[...new Uint8Array(readinessObservationSignature)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
return {
  status:"PRIVATE_CHECKOUT_CONTENT_READY",send_preview_email:false,private_checkout_link_allowed:false,
  recipient_ready_state_write_required:true,checkout_readiness_core_private:readinessCore,
  checkout_readiness_core_sha256:readinessCoreSha256,checkout_readiness_core_hmac_sha256:readinessCoreHmacSha256,
  checkout_readiness_observation_private:readinessObservation,checkout_readiness_observation_hmac_sha256:readinessObservationHmacSha256,
  checkout_offer_snapshot_private:checkoutOfferSnapshotRaw,
  checkout_offer_snapshot_hmac_sha256:checkoutOfferSnapshotHmacSha256,
  checkout_recipient_reservation_private:checkoutRecipientReservationRaw,
  checkout_recipient_reservation_hmac_sha256:checkoutRecipientReservationHmacSha256,
  email_state:canonicalJson(emailState),email_state_token:emailStateToken,customer_email:customerEmail,
  preview_folder:previewFolder,preview_url:previewUrl.toString(),preview_branch:previewBranch,
  head_sha:expectedHeadSha,merge_commit_sha:mergeCommitSha,source_tree_sha:sourceTreeSha,content_sha256:contentSha256,
  pr_number:prNumber,required_check:requiredCheckName
};
