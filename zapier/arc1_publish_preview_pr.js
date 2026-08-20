// ARC1 Code step — atomically publish one preview candidate to a deterministic branch.
// This step never authorizes or sends customer email. A separate proof gate does that.
const clean = value => String(value == null ? "" : value).trim();
const decodePrivacyEntities = value => String(value == null ? "" : value)
  .replace(/&#(\d+);?/g, (_, code) => { const point = Number(code); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
  .replace(/&#x([0-9a-f]+);?/gi, (_, code) => { const point = Number.parseInt(code, 16); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : ""; })
  .replace(/&(amp|quot|apos|lt|gt|colon|sol|period|commat|percnt|num|tab|newline);/gi, (_, name) => ({
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", sol: "/", period: ".", commat: "@", percnt: "%", num: "#"
    ,tab: "\t", newline: "\n"
  })[name.toLowerCase()]);
const decodePercentBytes = value => String(value).replace(/(?:%[0-9a-f]{2})+/gi, encoded => { try { return decodeURIComponent(encoded); } catch { return encoded.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))); } });
const recursivelyDecodePrivacyValue = value => {
  let current = String(value == null ? "" : value);
  for (let pass = 0; pass < 5; pass += 1) {
    let next = decodePrivacyEntities(current).replace(/\/\*[\s\S]*?\*\//g,"")
      .replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/[\u3002\uff0e\uff61]/g,".");
    next = decodePercentBytes(next.replace(/\+/g, "%20"));
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC");
};
const privacyCanonical = value => recursivelyDecodePrivacyValue(value).toLowerCase().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const privacyCompact = value => privacyCanonical(value).replace(/[^\p{L}\p{N}@]+/gu, "");
const assertPrivateValuesAbsent = (markup, privateValues, label) => {
  const decoded = recursivelyDecodePrivacyValue(markup);
  const text = recursivelyDecodePrivacyValue(decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const urlSurfaces = [...decoded.matchAll(/\b(?:href|src|srcset|action|content|style)\s*=\s*["']([^"']*)["']/gi)].map(match => recursivelyDecodePrivacyValue(match[1]));
  const surfaces = [decoded, text, ...urlSurfaces].map(value => ({ canonical: privacyCanonical(value), compact: privacyCompact(value) }));
  for (const item of privateValues) {
    const privateCanonical = privacyCanonical(item?.value);
    if (!privateCanonical) continue;
    const privateCompact = privacyCompact(privateCanonical);
    if (surfaces.some(surface => surface.canonical.includes(privateCanonical) || (privateCompact.length >= 7 && surface.compact.includes(privateCompact)))) {
      throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private ${item.label}`);
    }
  }
};
const assertNoCheckoutCapability = (markup, label) => {
  const decoded=recursivelyDecodePrivacyValue(markup).toLowerCase();
  const compact=decoded.replace(/[\s\u0000-\u001f\u007f]+/g,"");
  const nonScriptMarkup=String(markup).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"");
  const forbidden=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v3_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v1|arc1-checkout-recipient-reservation-v1|arc1-preview-readiness-(?:core|observation)-v1|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v1|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;
  if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScriptMarkup)||/\p{Default_Ignorable_Code_Point}/u.test(nonScriptMarkup)||forbidden.test(decoded)||forbidden.test(compact)||/<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(String(markup))){
    throw new Error(`ARC_PREVIEW_PUBLISH_INVALID: ${label}`);
  }
  for(const match of String(markup).matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){
    const raw=match[1]??match[2]??match[3]??"",normalized=recursivelyDecodePrivacyValue(raw).toLowerCase();
    const forbiddenNamedEntity=/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(raw),defaultIgnorable=/\p{Default_Ignorable_Code_Point}/u.test(normalized);
    let parsedUrl;try{parsedUrl=new URL(normalized,"https://arc.invalid/");}catch{}
    const canonicalHost=parsedUrl?.hostname?.toLowerCase()||"";
    if(/%(?![0-9a-f]{2})/i.test(raw)||forbiddenNamedEntity||defaultIgnorable||canonicalHost==="buy.stripe.com"||canonicalHost.endsWith(".buy.stripe.com")||new Set(["javascript:","vbscript:"]).has(parsedUrl?.protocol)||/^(?:javascript|vbscript):/i.test(normalized)||forbidden.test(normalized)||forbidden.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g,"")))throw new Error(`ARC_PREVIEW_PUBLISH_INVALID: ${label}`);
  }
  const scripts=(decoded.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[]).join("\n");
  if(/\bwindow\.open\s*\(|(?:\bwindow\.|\bdocument\.)?location(?:\.href)?\s*=|(?:\bwindow\.|\bdocument\.)?location\.(?:assign|replace)\s*\(|\.(?:href|action)\s*=|\.setattribute\s*\(\s*["'](?:href|action)["']|\b(?:window|document)\s*\[\s*["'](?:open|location)["']\s*\]|\[\s*["'](?:href|action|assign|replace)["']\s*\]\s*(?:=|\()/i.test(scripts))throw new Error(`ARC_PREVIEW_PUBLISH_INVALID: ${label}`);
};
const assertNoUnsafeBrowserMarkup=(markup,label)=>{const raw=String(markup==null?"":markup),decoded=recursivelyDecodePrivacyValue(raw),nonScript=decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"");if(/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScript)||/\p{Default_Ignorable_Code_Point}/u.test(nonScript)||/<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(raw)||/<style\b[^>]*>[\s\S]*?\\[\s\S]*?<\/style\s*>/i.test(decoded)||/\bstyle\s*=\s*(?:"[^"]*\\|'[^']*\\)/i.test(decoded))throw new Error(`ARC_PREVIEW_PUBLISH_INVALID: ${label}`);};
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
if (new TextEncoder().encode(sourceHtml).byteLength > 499500) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: source preview exceeds the bounded paid-delivery HTML size");
}
assertPrivateValuesAbsent(sourceHtml, [
  { label: "requester email", value: customerEmail },
  { label: "lead recipient", value: inputData.private_lead_notification_email || inputData.verified_lead_notification_email },
  { label: "contact phone", value: inputData.private_contact_phone },
  { label: "contact address", value: inputData.private_contact_address }
], "public preview HTML");
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
const gitBlobSha1 = async value => {
  const bytes = new TextEncoder().encode(value);
  const framed = new Uint8Array(new TextEncoder().encode(`blob ${bytes.byteLength}\0`).byteLength + bytes.byteLength);
  framed.set(new TextEncoder().encode(`blob ${bytes.byteLength}\0`));
  framed.set(bytes, framed.byteLength - bytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", framed);
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
const legacyEvidenceFields = [
  "version", "scope", "site_id", "site_url", "form_id", "form_name", "submission_id", "received_at",
  "intake_version", "budget_confirmed", "terms_accepted", "public_folder_prefix", "submission_data_sha256",
  "asset_manifest", "asset_manifest_sha256", "total_asset_bytes", "state_key", "state_digest_sha256", "claim_required_before_build", "issued_at"
];
const functionEvidenceFields = [
  "version", "scope", "bridge_contract_sha256", "site_id_sha256", "source_schema", "source_form_name", "source_key_hmac_sha256",
  "delivery_id", "submission_id", "received_at", "intake_version", "budget_confirmed", "terms_accepted", "asset_permission", "public_folder_prefix",
  "submission_data_sha256", "asset_manifest", "asset_manifest_sha256", "total_asset_bytes", "state_key", "state_digest_sha256",
  "claim_required_before_build", "issued_at"
];
const isFunctionEvidence = intakeEvidence?.version === "arc1-intake-evidence-v2";
const evidenceFields = isFunctionEvidence ? functionEvidenceFields : legacyEvidenceFields;
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
const bridgeContractSha256 = "e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841";
const requiredBudgetConfirmation = "Yes, understands the finished ARC website subtotal is $5,000 plus applicable sales tax only after preview approval";
const requiredTermsAcceptance = "Accepted ARC preview terms, privacy policy, refund policy, and service scope dated 2026-08-12; separate adult checkout acceptance required";
const receivedAt = clean(intakeEvidence.received_at);
const issuedAt = clean(intakeEvidence.issued_at);
const receivedMs = Date.parse(receivedAt);
const issuedMs = Date.parse(issuedAt);
const nowMs = Date.now();
const expectedSiteIdSha256 = await sha256Hex(expectedSiteId);
const derivedPublicFolderPrefix = (await sha256Hex((isFunctionEvidence ? [
  "arc-preview-folder-v2", bridgeContractSha256, expectedSiteIdSha256, clean(intakeEvidence.submission_id).toLowerCase(), receivedAt
] : [
  "arc-preview-folder-v1", expectedSiteId, expectedFormId, clean(intakeEvidence.submission_id).toLowerCase(), receivedAt
]).join("\n"))).slice(0, 8);
const legacyIdentityValid = !isFunctionEvidence && intakeEvidence.version === "arc1-intake-evidence-v1" &&
  intakeEvidence.scope === "authoritative-netlify-intake-and-assets" && externalId(expectedFormId) &&
  clean(intakeEvidence.site_id).toLowerCase() === expectedSiteId && clean(intakeEvidence.form_id).toLowerCase() === expectedFormId &&
  clean(intakeEvidence.form_name) === expectedFormName && externalId(intakeEvidence.submission_id) &&
  clean(intakeEvidence.state_key) === `arc1-intake-claim-v1:${clean(intakeEvidence.state_digest_sha256)}`;
const functionIdentityValid = isFunctionEvidence && intakeEvidence.scope === "authoritative-first-party-function-intake" &&
  intakeEvidence.bridge_contract_sha256 === bridgeContractSha256 && clean(intakeEvidence.site_id_sha256) === expectedSiteIdSha256 &&
  intakeEvidence.source_schema === "arc-intake-function-submission-v1" && intakeEvidence.source_form_name === "arc-preview-function-v1" &&
  /^[a-f0-9]{64}$/.test(clean(intakeEvidence.source_key_hmac_sha256)) && /^[a-f0-9]{64}$/.test(clean(intakeEvidence.delivery_id)) &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clean(intakeEvidence.submission_id)) &&
  intakeEvidence.asset_permission === (intakeEvidence.asset_manifest?.length ? "Confirmed" : "") &&
  clean(intakeEvidence.state_key) === `arc1-intake-claim-v2:${clean(intakeEvidence.state_digest_sha256)}`;
if (
  !externalId(expectedSiteId) || (!legacyIdentityValid && !functionIdentityValid) || clean(intakeEvidence.public_folder_prefix) !== derivedPublicFolderPrefix ||
  derivedPublicFolderPrefix !== trustedEventPrefix ||
  intakeEvidence.intake_version !== "arc-intake-v7" || intakeEvidence.budget_confirmed !== requiredBudgetConfirmation ||
  intakeEvidence.terms_accepted !== requiredTermsAcceptance || !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.submission_data_sha256)) ||
  !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.state_digest_sha256)) ||
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
    evidenceEncoder.encode(`${isFunctionEvidence ? "arc1-intake-evidence-signature-v2" : "arc1-intake-evidence-signature-v1"}\n${evidenceRaw}`)
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
  clean(intakeEvidence.asset_manifest_sha256).toLowerCase() !== assetManifestSha256 ||
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
const roleOrder = isFunctionEvidence ? ["hero_image_file", "logo_file", "supporting_image_file"] :
  ["logo_file", "hero_image_file", "supporting_image_file"];
let lastRoleIndex = -1;
let manifestTotal = 0;
for (const entry of assetManifest) {
  if (isFunctionEvidence && (entry?.kind === "FOLDER_LINK" || entry?.role === "asset_folder_link")) {
    throw new Error("ARC1_ASSET_UNSUPPORTED: folder links require a private provider adapter");
  }
  const expectedAssetFields = isFunctionEvidence ?
    ["asset_id", "content_type", "kind", "retrieval_endpoint_sha256", "role", "sha256", "size_bytes"] :
    ["content_type", "role", "sha256", "size_bytes", "source_url_sha256"];
  if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(expectedAssetFields.sort())) {
    throw new Error("ARC1_ASSET_INVALID: asset evidence fields");
  }
  const roleIndex = roleOrder.indexOf(clean(entry.role));
  const exactUrl = String(assetInputs[entry.role] == null ? "" : assetInputs[entry.role]);
  const legacyValid = isFunctionEvidence || (exactUrl === exactUrl.trim() && Boolean(exactUrl) &&
    await sha256Hex(exactUrl) === clean(entry.source_url_sha256));
  const functionValid = !isFunctionEvidence || (/^[a-f0-9]{64}$/.test(clean(entry.asset_id)) &&
    /^[a-f0-9]{64}$/.test(clean(entry.retrieval_endpoint_sha256)) && entry.kind === "UPLOAD" &&
    new Set(["image/png", "image/jpeg", "image/webp"]).has(entry.content_type));
  if (roleIndex <= lastRoleIndex || !legacyValid || !functionValid || !/^[a-f0-9]{64}$/.test(clean(entry.sha256)) ||
      !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 1 ||
      entry.size_bytes > (isFunctionEvidence ? 1250000 : 2621440)) {
    throw new Error("ARC1_ASSET_INVALID: asset URL/hash/type/size binding");
  }
  lastRoleIndex = roleIndex;
  manifestTotal += entry.size_bytes;
}
if (!Number.isSafeInteger(intakeEvidence.total_asset_bytes) || manifestTotal !== intakeEvidence.total_asset_bytes ||
    manifestTotal > (isFunctionEvidence ? 3020000 : 7864320)) {
  throw new Error("ARC1_ASSET_INVALID: asset manifest total mismatch");
}
let assetPublicationReceiptSha256 = "";
let publicAssetEntries = [];
if (isFunctionEvidence) {
  const publicationSecret = clean(inputData.asset_publication_receipt_secret);
  if (evidenceEncoder.encode(publicationSecret).length < 32 || evidenceEncoder.encode(publicationSecret).length > 256 || publicationSecret === intakeEvidenceSecret) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt secret");
  }
  const publicationRaw = clean(inputData.asset_publication_receipt_private);
  let publication;
  try { publication = JSON.parse(publicationRaw); } catch { throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt JSON"); }
  const publicationFields = ["version", "scope", "bridge_contract_sha256", "delivery_id", "bridge_evidence_sha256", "private_asset_receipt_sha256",
    "intake_evidence_sha256", "intake_state_digest_sha256", "asset_manifest_sha256", "asset_permission", "repository", "base_branch",
    "preview_branch", "pages_base_url", "public_folder_prefix", "preview_folder", "entries", "status"];
  const publicationEntryFields = ["asset_id", "content_type", "git_blob_sha1", "public_url", "repository_path", "role", "sha256", "size_bytes"];
  const pagesRoot = "https://arcwebhq-cpu.github.io/arc-previews";
  const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  if (!publication || typeof publication !== "object" || Array.isArray(publication) || canonicalJson(publication) !== publicationRaw ||
      JSON.stringify(Object.keys(publication).sort()) !== JSON.stringify(publicationFields.slice().sort()) ||
      publication.version !== "arc1-public-asset-publication-receipt-v1" || publication.scope !== "github-content-addressed-preview-assets" ||
      publication.bridge_contract_sha256 !== bridgeContractSha256 || publication.delivery_id !== intakeEvidence.delivery_id ||
      !/^[a-f0-9]{64}$/.test(clean(publication.bridge_evidence_sha256)) ||
      publication.private_asset_receipt_sha256 !== clean(inputData.ingress_claim_asset_receipt_sha256).toLowerCase() ||
      !/^[a-f0-9]{64}$/.test(publication.private_asset_receipt_sha256) || publication.intake_evidence_sha256 !== intakeEvidenceSha256 ||
      publication.intake_state_digest_sha256 !== clean(intakeEvidence.state_digest_sha256) || publication.asset_manifest_sha256 !== assetManifestSha256 ||
      publication.asset_permission !== intakeEvidence.asset_permission || publication.repository !== "arcwebhq-cpu/arc-previews" || publication.base_branch !== "main" ||
      publication.preview_branch !== previewBranch || publication.pages_base_url !== pagesRoot || publication.public_folder_prefix !== trustedEventPrefix ||
      publication.preview_folder !== previewFolder || !Array.isArray(publication.entries) || owner !== "arcwebhq-cpu" || repository !== "arc-previews") {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: exact publication receipt binding");
  }
  const uploads = assetManifest.filter(entry => entry.kind === "UPLOAD");
  if (publication.entries.length !== uploads.length || publication.status !== (uploads.length ? "VERIFIED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS")) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication entry count/status");
  }
  for (let index = 0; index < uploads.length; index += 1) {
    const manifest = uploads[index], entry = publication.entries[index];
    const path = `${previewFolder}/assets/${manifest.sha256}.${extensions[manifest.content_type]}`;
    const url = `${pagesRoot}/${path}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(publicationEntryFields.slice().sort()) ||
        entry.asset_id !== manifest.asset_id || entry.content_type !== manifest.content_type || entry.role !== manifest.role || entry.sha256 !== manifest.sha256 ||
        entry.size_bytes !== manifest.size_bytes || !/^[a-f0-9]{40}$/.test(entry.git_blob_sha1) || entry.repository_path !== path || entry.public_url !== url ||
        clean(assetInputs[manifest.role]) !== url) {
      throw new Error("ARC1_ASSET_PUBLICATION_INVALID: exact content-addressed URL map");
    }
  }
  for (const role of ["logo_file", "hero_image_file", "supporting_image_file"]) {
    if (Boolean(clean(assetInputs[role])) !== uploads.some(entry => entry.role === role)) {
      throw new Error("ARC1_ASSET_PUBLICATION_INVALID: missing or arbitrary mapped URL");
    }
  }
  const publicationSignature = clean(inputData.asset_publication_receipt_hmac_sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(publicationSignature)) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt HMAC");
  const publicationKey = await globalThis.crypto.subtle.importKey("raw", evidenceEncoder.encode(publicationSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const publicationSignatureBytes = Uint8Array.from(publicationSignature.match(/../g), byte => Number.parseInt(byte, 16));
  if (!(await globalThis.crypto.subtle.verify("HMAC", publicationKey, publicationSignatureBytes,
    evidenceEncoder.encode(`arc1-public-asset-publication-receipt-v1\n${publicationRaw}`)))) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt HMAC mismatch");
  }
  assetPublicationReceiptSha256 = await sha256Hex(publicationRaw);
  if (clean(inputData.asset_publication_receipt_sha256).toLowerCase() !== assetPublicationReceiptSha256) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt digest mismatch");
  }
  publicAssetEntries = publication.entries;
} else {
  for (const role of ["logo_file", "hero_image_file", "supporting_image_file"]) {
    if (Boolean(clean(assetInputs[role])) !== assetManifest.some(entry => entry.role === role)) {
      throw new Error("ARC1_ASSET_INVALID: unverified or missing mapped asset URL");
    }
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
assertNoCheckoutCapability(sourceHtml,"public preview must not contain a decoded checkout capability or private offer evidence");
assertNoUnsafeBrowserMarkup(sourceHtml,"public preview contains an unreviewed executable/encoded surface");
const trustedScriptHashes=["55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870","98cbb58e3ec829ddaec61983333a8bb500b91558625a346350bfc8fe4842b860"];
const trustedScriptManifestSha256="8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b";
const scriptBlocks=sourceHtml.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)||[],scriptHashes=[];for(const script of scriptBlocks)scriptHashes.push(await sha256Hex(script));scriptHashes.sort();
if((sourceHtml.match(/<script\b/gi)||[]).length!==scriptBlocks.length||(sourceHtml.match(/<\/script\b/gi)||[]).length!==scriptBlocks.length||scriptHashes.length!==3||JSON.stringify(scriptHashes)!==JSON.stringify([...trustedScriptHashes].sort())||await sha256Hex(scriptHashes.join("\n"))!==trustedScriptManifestSha256||clean(inputData.script_manifest_sha256).toLowerCase()!==trustedScriptManifestSha256){
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: reviewed script manifest binding");
}
const checkoutSnapshotRaw = clean(inputData.checkout_config_snapshot_private);
let checkoutSnapshot;
try {
  checkoutSnapshot = JSON.parse(checkoutSnapshotRaw);
} catch {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: private checkout offer snapshot JSON");
}
if (!checkoutSnapshot || typeof checkoutSnapshot !== "object" || Array.isArray(checkoutSnapshot) ||
    canonicalJson(checkoutSnapshot) !== checkoutSnapshotRaw ||
    checkoutSnapshot.version !== "arc-checkout-offer-snapshot-v1" ||
    checkoutSnapshot.scope !== "immutable-approved-preview-private-checkout-offer" ||
    !/^[a-f0-9]{2}$/.test(checkoutSnapshot.checkout_binding_key_id) ||
    checkoutSnapshot.public_folder_prefix !== trustedEventPrefix || checkoutSnapshot.preview_folder !== previewFolder ||
    checkoutSnapshot.preview_path !== `${previewFolder}/index.html` || checkoutSnapshot.preview_source_repository !== `${owner}/${repository}` ||
    checkoutSnapshot.environment !== "arc-production") {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: checkout offer snapshot contract");
}
const checkoutSnapshotSha256 = await sha256Hex(checkoutSnapshotRaw);
if (clean(inputData.checkout_config_snapshot_sha256).toLowerCase() !== checkoutSnapshotSha256 ||
    !/^[a-f0-9]{64}$/.test(clean(inputData.checkout_config_snapshot_hmac_sha256).toLowerCase())) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: private checkout offer snapshot digest/signature mapping");
}
const approvalContentSha256 = clean(inputData.approval_content_sha256).toLowerCase();
if(!/^[a-f0-9]{64}$/.test(approvalContentSha256))throw new Error("ARC_PREVIEW_PUBLISH_INVALID: approved public content digest");
const terminalToolbar = sourceHtml.match(/<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview<\/strong>Built for this business\. Purchase only if approved\.<\/span><span data-arc-checkout-private>Checkout is available only through the private approval email\.<\/span><\/aside>\n<\/body>\n<\/html>$/)?.[0] || "";
if (!terminalToolbar) throw new Error("ARC_PREVIEW_PUBLISH_INVALID: terminal inert checkout notice contract");
const approvalHtml = sourceHtml.slice(0, -terminalToolbar.length) + "</body>\n</html>";
if (approvalContentSha256 !== await sha256Hex(approvalHtml)) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: checkout reference approval digest binding");
}
const renderEvidenceRaw = clean(inputData.render_evidence_private);
const renderEvidenceSignature = clean(inputData.render_evidence_hmac_sha256).toLowerCase();
let renderEvidence;
try {
  renderEvidence = JSON.parse(renderEvidenceRaw);
} catch (error) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: render evidence JSON");
}
const legacyRenderEvidenceFields = [
  "version", "scope", "preview_folder", "content_sha256", "intake_evidence_sha256",
  "state_digest_sha256", "submission_data_sha256", "asset_manifest_sha256", "approval_content_sha256",
  "checkout_offer_snapshot_sha256", "script_manifest_sha256"
];
const renderEvidenceFields = isFunctionEvidence ? [...legacyRenderEvidenceFields, "asset_publication_receipt_sha256"] : legacyRenderEvidenceFields;
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
  renderEvidence.asset_manifest_sha256 !== assetManifestSha256 ||
  renderEvidence.approval_content_sha256 !== approvalContentSha256 ||
  renderEvidence.checkout_offer_snapshot_sha256 !== checkoutSnapshotSha256 ||
  renderEvidence.script_manifest_sha256 !== trustedScriptManifestSha256 ||
  (isFunctionEvidence && (renderEvidence.asset_publication_receipt_sha256 !== assetPublicationReceiptSha256 ||
    clean(inputData.asset_publication_receipt_sha256).toLowerCase() !== assetPublicationReceiptSha256))
) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: render evidence is not bound to the exact sanitized preview");
}
const proofBlock = `<!-- ARC_PREVIEW_PROOF_START -->\n<meta name="arc-preview-folder" content="${previewFolder}">\n<meta name="arc-preview-source-sha256" content="${contentSha256}">\n<!-- ARC_PREVIEW_PROOF_END -->\n`;
const publishedHtml = sourceHtml.replace(/<\/head>/i, `${proofBlock}</head>`);
if (new TextEncoder().encode(publishedHtml).byteLength > 500000) {
  throw new Error("ARC_PREVIEW_PUBLISH_INVALID: published preview proof exceeds the bounded paid-delivery HTML size");
}
const publishedHtmlGitBlobSha1 = await gitBlobSha1(publishedHtml);

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
const verifyPublishedAssets = async (commitSha, requireIndex = null) => {
  if (!publicAssetEntries.length) return;
  let treeSha = await getCommitTree(commitSha);
  let tree = await request(`${api}/git/trees/${treeSha}`);
  let matches = (Array.isArray(tree.tree) ? tree.tree : []).filter(item =>
    item.path === previewFolder && item.type === "tree" && item.mode === "040000" && validSha(item.sha));
  if (matches.length !== 1) throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: exact preview folder is missing");
  treeSha = matches[0].sha;
  const folder = await request(`${api}/git/trees/${treeSha}`);
  const folderItems = Array.isArray(folder.tree) ? folder.tree : [];
  const assetTrees = folderItems.filter(item => item.path === "assets" && item.type === "tree" && item.mode === "040000" && validSha(item.sha));
  const indexItems = folderItems.filter(item => item.path === "index.html" && item.type === "blob" && item.mode === "100644" && validSha(item.sha));
  const allowedCount = indexItems.length ? 2 : 1;
  if (assetTrees.length !== 1 || indexItems.length > 1 || folderItems.length !== allowedCount ||
      folderItems.some(item => item.path !== "assets" && item.path !== "index.html")) {
    throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: preview folder has extra or missing entries");
  }
  if ((requireIndex === true && indexItems.length !== 1) || (requireIndex === false && indexItems.length !== 0) ||
      (indexItems.length === 1 && indexItems[0].sha !== publishedHtmlGitBlobSha1)) {
    throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: exact preview index identity changed");
  }
  treeSha = assetTrees[0].sha;
  const leaf = await request(`${api}/git/trees/${treeSha}`);
  const items = Array.isArray(leaf.tree) ? leaf.tree : [];
  const expectedNames = new Set(publicAssetEntries.map(entry => entry.repository_path.split("/").at(-1)));
  if (items.length !== expectedNames.size || items.some(item => item.type !== "blob" || item.mode !== "100644" || !expectedNames.has(item.path))) {
    throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: extra or missing asset file");
  }
  for (const entry of publicAssetEntries) {
    const name = entry.repository_path.split("/").at(-1);
    const matches = items.filter(item => item.path === name && item.type === "blob" && item.mode === "100644");
    if (matches.length !== 1 || matches[0].sha !== entry.git_blob_sha1 || matches[0].size !== entry.size_bytes) {
      throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: published asset identity changed");
    }
  }
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
  const mergeCommitSha = clean(matchingPr.merge_commit_sha);
  if (!validSha(mergeCommitSha)) throw new Error("ARC_PREVIEW_PR_CONFLICT: merged PR commit SHA missing");
  const currentBaseRef = await getRef(baseBranch);
  const currentBaseSha = clean(currentBaseRef.object?.sha);
  if (!validSha(currentBaseSha)) throw new Error("ARC_GITHUB_FAILED: current base branch SHA");
  const currentBaseHtml = await readBranchHtml(currentBaseSha);
  if (currentBaseHtml !== publishedHtml) {
    throw new Error("ARC_PREVIEW_PR_CONFLICT: current main preview content differs from merged replay");
  }
  if (publicAssetEntries.length) await verifyPublishedAssets(currentBaseSha, true);
  const originalHeadSha=clean(matchingPr.head?.sha).toLowerCase();
  if(!validSha(originalHeadSha))throw new Error("ARC_PREVIEW_PR_CONFLICT: merged PR original head SHA missing");
  const originalHeadHtml=await readBranchHtml(originalHeadSha);
  if(originalHeadHtml!==publishedHtml)throw new Error("ARC_PREVIEW_PR_CONFLICT: merged PR original head bytes differ");
  if(publicAssetEntries.length)await verifyPublishedAssets(originalHeadSha,null);
  branchHeadSha = originalHeadSha;
}
if (isFunctionEvidence && publicAssetEntries.length && !branchHeadSha) {
  throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: deterministic asset branch must exist before preview publication");
}
if (branchHeadSha && publicAssetEntries.length) await verifyPublishedAssets(branchHeadSha, null);
const existingHtml = branchHeadSha ? await readBranchHtml(branchHeadSha) : null;
if (branchHeadSha && existingHtml === null && !publicAssetEntries.length) {
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
  if (publicAssetEntries.length) {
    await verifyPublishedAssets(nextHeadSha, true);
  }

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
if (publicAssetEntries.length) await verifyPublishedAssets(branchHeadSha, true);

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
  checkout_offer_snapshot_sha256: checkoutSnapshotSha256,
  script_manifest_sha256:trustedScriptManifestSha256,
  content_sha256: contentSha256,
  trusted_event_prefix: trustedEventPrefix,
  intake_state_key: clean(intakeEvidence.state_key),
  intake_state_digest_sha256: clean(intakeEvidence.state_digest_sha256),
  intake_evidence_sha256: intakeEvidenceSha256,
  submission_data_sha256: clean(intakeEvidence.submission_data_sha256),
  asset_manifest_sha256: assetManifestSha256,
  asset_publication_receipt_sha256: assetPublicationReceiptSha256,
  validated_asset_manifest: canonicalJson(assetManifest),
  preview_url: previewUrl,
  pr_number: prNumber,
  pr_url: clean(matchingPr.html_url),
  pr_state: clean(matchingPr.state),
  pr_draft: Boolean(matchingPr.draft),
  pr_merged: Boolean(matchingPr.merged_at)
};
