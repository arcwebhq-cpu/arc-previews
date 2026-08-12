// ARC1 fail-closed, read-only intake and asset verifier.
// This Zapier Code step trusts only authenticated Netlify API reads. It never builds,
// claims state, writes to Netlify, or treats browser-supplied identity/timestamps as authority.
const clean = value => String(value == null ? "" : value).trim();
const netlifyToken = clean(inputData.netlify_access_token);
const evidenceSecret = clean(inputData.intake_evidence_secret);
const expectedSiteId = clean(inputData.expected_netlify_site_id).toLowerCase();
const expectedFormId = clean(inputData.expected_netlify_form_id).toLowerCase();
const expectedFormName = clean(inputData.expected_netlify_form_name);
const triggerSubmissionId = clean(inputData.trigger_submission_id).toLowerCase();
const requiredBudgetConfirmation = "Yes, understands the finished ARC website is $5,000 only after preview approval";
const requiredTermsAcceptance = "Accepted ARC preview terms, privacy policy, refund policy, and service scope dated 2026-08-11; separate adult checkout acceptance required";

if (!netlifyToken) throw new Error("ARC1_INTAKE_INVALID: Netlify access token is required");
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC1_CRYPTO_UNAVAILABLE: SHA-256 and HMAC-SHA-256 are required");
}
const encoder = new TextEncoder();
const secretBytes = encoder.encode(evidenceSecret);
if (secretBytes.length < 32 || secretBytes.length > 256) {
  throw new Error("ARC1_INTAKE_INVALID: evidence secret must be 32–256 UTF-8 bytes");
}
const externalId = value => /^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
if (!externalId(expectedSiteId)) throw new Error("ARC1_INTAKE_INVALID: exact Netlify site id is required");
if (!externalId(expectedFormId)) throw new Error("ARC1_INTAKE_INVALID: exact Netlify form id is required");
if (!externalId(triggerSubmissionId)) throw new Error("ARC1_INTAKE_INVALID: Netlify trigger submission id is required");
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(expectedFormName)) {
  throw new Error("ARC1_INTAKE_INVALID: exact Netlify form name is required");
}

const falseLike = value => value == null || value === false || value === 0 || ["", "false", "0", "no", "none"].includes(clean(value).toLowerCase());
for (const field of [
  "preexisting_claim",
  "preexisting_state_claim",
  "state_claim_exists",
  "claim_exists",
  "public_folder_collision",
  "folder_collision",
  "folder_collision_exists"
]) {
  if (!falseLike(inputData[field])) {
    throw new Error(`ARC1_INTAKE_REPLAY_BLOCKED: ${field} indicates an existing claim or folder collision`);
  }
}

const bytesToHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const sha256Text = async value => bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value)));
const sha256Bytes = async value => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
};
const hmacKey = await globalThis.crypto.subtle.importKey(
  "raw",
  secretBytes,
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const hmacHex = async value => bytesToHex(await globalThis.crypto.subtle.sign("HMAC", hmacKey, encoder.encode(value)));

const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ARC1_INTAKE_INVALID: non-finite JSON value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC1_INTAKE_INVALID: submission data must be plain JSON");
};

const isSafeDnsHost = hostname => {
  const host = hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host.includes(":") || /^\[.*\]$/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)) return false;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) return false;
  return !host.split(".").every(label => /^\d+$/.test(label));
};
const parsePlainHttpsRoot = (value, label) => {
  let url;
  try {
    url = new URL(clean(value));
  } catch (error) {
    throw new Error(`ARC1_INTAKE_INVALID: ${label} URL`);
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
    url.pathname !== "/" || !isSafeDnsHost(url.hostname)
  ) {
    throw new Error(`ARC1_INTAKE_INVALID: ${label} must be a plain public HTTPS root URL`);
  }
  return url.toString();
};

const apiBase = "https://api.netlify.com/api/v1";
const apiHeaders = { Accept: "application/json", Authorization: `Bearer ${netlifyToken}` };
const readJson = async path => {
  const requestUrl = `${apiBase}${path}`;
  const response = await fetch(requestUrl, { method: "GET", headers: apiHeaders, redirect: "error" });
  if (response.url && response.url !== requestUrl) throw new Error("ARC1_NETLIFY_READ_FAILED: API redirect rejected");
  if (!response.ok) throw new Error(`ARC1_NETLIFY_READ_FAILED: ${response.status} ${path}`);
  return response.json();
};

const site = await readJson(`/sites/${encodeURIComponent(expectedSiteId)}`);
if (!site || clean(site.id).toLowerCase() !== expectedSiteId) {
  throw new Error("ARC1_INTAKE_INVALID: Netlify site identity mismatch");
}
const trustedSiteUrl = parsePlainHttpsRoot(site.ssl_url || site.url, "Netlify site");
if (clean(site.state).toLowerCase() === "disabled") {
  throw new Error("ARC1_INTAKE_INVALID: Netlify site is disabled");
}

const forms = await readJson(`/sites/${encodeURIComponent(expectedSiteId)}/forms`);
const exactForms = (Array.isArray(forms) ? forms : []).filter(form =>
  clean(form.id).toLowerCase() === expectedFormId &&
  clean(form.site_id).toLowerCase() === expectedSiteId &&
  clean(form.name) === expectedFormName
);
if (exactForms.length !== 1) {
  throw new Error(`ARC1_INTAKE_INVALID: expected one exact Netlify form; found ${exactForms.length}`);
}

const allSubmissions = [];
const maxSubmissionPages = 20;
for (let page = 1; page <= maxSubmissionPages; page += 1) {
  const batch = await readJson(`/forms/${encodeURIComponent(expectedFormId)}/submissions?per_page=100&page=${page}`);
  if (!Array.isArray(batch)) throw new Error("ARC1_INTAKE_INVALID: Netlify submissions response is not a list");
  allSubmissions.push(...batch);
  if (batch.length < 100) break;
  if (page === maxSubmissionPages) {
    throw new Error("ARC1_INTAKE_INVALID: too many submissions to establish unique intake identity");
  }
}

const isPlainObject = value => value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const triggerMatches = allSubmissions.filter(submission =>
  submission && typeof submission === "object" && clean(submission.id).toLowerCase() === triggerSubmissionId
);
if (triggerMatches.length !== 1) {
  throw new Error(`ARC1_INTAKE_INVALID: expected exactly one server submission matching trigger id; found ${triggerMatches.length}`);
}
const submission = triggerMatches[0];
const trustedSubmissionId = clean(submission.id).toLowerCase();
if (trustedSubmissionId !== triggerSubmissionId || !externalId(trustedSubmissionId)) {
  throw new Error("ARC1_INTAKE_INVALID: trigger submission identity mismatch");
}
const submissionData = submission.data;
if (!isPlainObject(submissionData)) throw new Error("ARC1_INTAKE_INVALID: trigger submission data is not an object");
const submissionSiteUrl = parsePlainHttpsRoot(submission.site_url, "submission site");
if (
  submissionSiteUrl !== trustedSiteUrl ||
  (submission.site_id != null && clean(submission.site_id).toLowerCase() !== expectedSiteId)
) {
  throw new Error("ARC1_INTAKE_INVALID: trigger submission site binding mismatch");
}
if (
  (submission.form_id != null && clean(submission.form_id).toLowerCase() !== expectedFormId) ||
  (submission.form_name != null && clean(submission.form_name) !== expectedFormName) ||
  submissionData["form-name"] !== expectedFormName
) {
  throw new Error("ARC1_INTAKE_INVALID: trigger submission form binding mismatch");
}
if (submissionData.intake_version !== "arc-intake-v7") {
  throw new Error("ARC1_INTAKE_INVALID: intake_version must exactly match arc-intake-v7");
}
if (submissionData.budget_confirmed !== requiredBudgetConfirmation) {
  throw new Error("ARC1_INTAKE_INVALID: budget_confirmed does not match the current ARC intake disclosure");
}
if (submissionData.terms_accepted !== requiredTermsAcceptance) {
  throw new Error("ARC1_INTAKE_INVALID: terms_accepted does not match the current ARC intake disclosure");
}
const trustedReceivedRaw = clean(submission.created_at);
const trustedReceivedMs = Date.parse(trustedReceivedRaw);
if (!Number.isFinite(trustedReceivedMs) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(trustedReceivedRaw)) {
  throw new Error("ARC1_INTAKE_INVALID: server submission received time is invalid");
}
const nowMs = Date.now();
if (trustedReceivedMs < nowMs - 24 * 60 * 60 * 1000) {
  throw new Error("ARC1_INTAKE_INVALID: server submission is stale (>24h)");
}
if (trustedReceivedMs > nowMs + 5 * 60 * 1000) {
  throw new Error("ARC1_INTAKE_INVALID: server submission is in the future (>5m)");
}
const trustedReceivedAt = new Date(trustedReceivedMs).toISOString();
const publicFolderPrefix = (await sha256Text([
  "arc-preview-folder-v1",
  expectedSiteId,
  expectedFormId,
  trustedSubmissionId,
  trustedReceivedAt
].join("\n"))).slice(0, 8);

const submissionDataCanonical = canonicalJson(submissionData);
if (Buffer.byteLength(submissionDataCanonical, "utf8") > 512 * 1024) {
  throw new Error("ARC1_INTAKE_INVALID: submission data is unexpectedly large");
}
const submissionDataSha256 = await sha256Text(submissionDataCanonical);

const assetRoles = ["logo_file", "hero_image_file", "supporting_image_file"];
const requestedAssets = assetRoles.flatMap(role => {
  const value = submissionData[role];
  if (value == null || value === "") return [];
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error(`ARC1_ASSET_INVALID: ${role} must be one exact upload URL`);
  }
  return [{ role, rawUrl: value }];
});

const parseAllowedOrigins = raw => {
  let values;
  try {
    values = JSON.parse(clean(raw));
  } catch (error) {
    throw new Error("ARC1_ASSET_INVALID: upload origin allowlist must be a JSON array");
  }
  if (!Array.isArray(values) || values.length < 1 || values.length > 16 || values.some(value => typeof value !== "string")) {
    throw new Error("ARC1_ASSET_INVALID: upload origin allowlist must contain 1–16 exact HTTPS origins");
  }
  const origins = values.map(value => {
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      throw new Error("ARC1_ASSET_INVALID: invalid upload allowlist origin");
    }
    if (
      url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" ||
      url.search || url.hash || !isSafeDnsHost(url.hostname)
    ) {
      throw new Error("ARC1_ASSET_INVALID: allowlist entries must be exact public HTTPS origins");
    }
    return url.origin;
  });
  if (new Set(origins).size !== origins.length) throw new Error("ARC1_ASSET_INVALID: duplicate upload allowlist origin");
  return new Set(origins);
};

const maxAssetBytes = Math.floor(2.5 * 1024 * 1024);
const maxTotalAssetBytes = Math.floor(7.5 * 1024 * 1024);
const allowedOrigins = requestedAssets.length ? parseAllowedOrigins(inputData.asset_upload_origin_allowlist_json) : new Set();
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const readAscii = (bytes, start, end) => bytes.subarray(start, end).toString("ascii");
const rejectActiveContent = bytes => {
  const lower = bytes.toString("latin1").toLowerCase();
  if (
    /<(?:!doctype|html|head|body|svg|script|iframe|object|embed|meta|link)\b/.test(lower) ||
    /<\?(?:xml|php)\b/.test(lower) || /javascript\s*:/.test(lower) || /data\s*:\s*text\/html/.test(lower) ||
    lower.includes("%pdf-") || lower.includes("pk\u0003\u0004") || lower.startsWith("mz") ||
    lower.includes("gif87a") || lower.includes("gif89a")
  ) {
    throw new Error("ARC1_ASSET_INVALID: active-content or polyglot signature detected");
  }
};
const validatePng = bytes => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)) throw new Error("ARC1_ASSET_INVALID: PNG signature");
  let offset = 8;
  let chunkIndex = 0;
  let sawIend = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("ARC1_ASSET_INVALID: truncated PNG chunk");
    const length = bytes.readUInt32BE(offset);
    const type = readAscii(bytes, offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("ARC1_ASSET_INVALID: truncated PNG data");
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) throw new Error("ARC1_ASSET_INVALID: PNG must begin with IHDR");
    if (type === "IHDR" && chunkIndex === 0 && (bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0)) {
      throw new Error("ARC1_ASSET_INVALID: PNG dimensions");
    }
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) throw new Error("ARC1_ASSET_INVALID: PNG must end exactly at IEND");
      sawIend = true;
    }
    offset = end;
    chunkIndex += 1;
  }
  if (!sawIend) throw new Error("ARC1_ASSET_INVALID: PNG IEND missing");
};
const validateJpeg = bytes => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error("ARC1_ASSET_INVALID: JPEG must begin at SOI and end exactly at EOI");
  }
};
const validateWebp = bytes => {
  if (
    bytes.length < 20 || readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  ) {
    throw new Error("ARC1_ASSET_INVALID: WEBP RIFF envelope");
  }
  let offset = 12;
  let sawVp8Marker = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("ARC1_ASSET_INVALID: truncated WEBP chunk");
    const type = readAscii(bytes, offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const paddedLength = length + (length % 2);
    const end = offset + 8 + paddedLength;
    if (end > bytes.length) throw new Error("ARC1_ASSET_INVALID: truncated WEBP data");
    if (["VP8 ", "VP8L", "VP8X"].includes(type)) sawVp8Marker = true;
    if (length % 2 && bytes[end - 1] !== 0) throw new Error("ARC1_ASSET_INVALID: WEBP padding");
    offset = end;
  }
  if (offset !== bytes.length || !sawVp8Marker || !["VP8 ", "VP8L", "VP8X"].includes(readAscii(bytes, 12, 16))) {
    throw new Error("ARC1_ASSET_INVALID: WEBP VP8 marker/end");
  }
};

let declaredTotalBytes = 0;
let totalAssetBytes = 0;
const assetManifest = [];
for (const asset of requestedAssets) {
  let url;
  try {
    url = new URL(asset.rawUrl);
  } catch (error) {
    throw new Error(`ARC1_ASSET_INVALID: ${asset.role} URL`);
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !isSafeDnsHost(url.hostname) ||
    !allowedOrigins.has(url.origin) || url.pathname === "/"
  ) {
    throw new Error(`ARC1_ASSET_INVALID: ${asset.role} URL is outside the exact HTTPS upload-origin allowlist`);
  }
  const exactUrl = url.toString();
  const response = await fetch(exactUrl, {
    method: "GET",
    headers: { Accept: "image/png, image/jpeg, image/webp" },
    redirect: "manual"
  });
  if (response.status >= 300 && response.status < 400) throw new Error(`ARC1_ASSET_INVALID: ${asset.role} redirect rejected`);
  if (response.status !== 200) throw new Error(`ARC1_ASSET_INVALID: ${asset.role} fetch failed (${response.status})`);
  if (!response.url || response.url !== exactUrl) throw new Error(`ARC1_ASSET_INVALID: ${asset.role} response URL changed`);
  const contentType = clean(response.headers?.get?.("content-type"));
  if (!allowedTypes.has(contentType)) throw new Error(`ARC1_ASSET_INVALID: ${asset.role} Content-Type must be exactly PNG/JPEG/WEBP`);
  const contentEncoding = clean(response.headers?.get?.("content-encoding"));
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new Error(`ARC1_ASSET_INVALID: ${asset.role} encoded response rejected`);
  }
  const declaredRaw = clean(response.headers?.get?.("content-length"));
  if (!/^(?:0|[1-9]\d*)$/.test(declaredRaw)) throw new Error(`ARC1_ASSET_INVALID: ${asset.role} declared size missing`);
  const declaredBytes = Number(declaredRaw);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 1 || declaredBytes > maxAssetBytes) {
    throw new Error(`ARC1_ASSET_INVALID: ${asset.role} declared size exceeds 2.5 MiB`);
  }
  declaredTotalBytes += declaredBytes;
  if (declaredTotalBytes > maxTotalAssetBytes) throw new Error("ARC1_ASSET_INVALID: declared asset total exceeds 7.5 MiB");
  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.length !== declaredBytes) throw new Error(`ARC1_ASSET_INVALID: ${asset.role} declared/actual size mismatch`);
  if (bytes.length > maxAssetBytes) throw new Error(`ARC1_ASSET_INVALID: ${asset.role} actual size exceeds 2.5 MiB`);
  totalAssetBytes += bytes.length;
  if (totalAssetBytes > maxTotalAssetBytes) throw new Error("ARC1_ASSET_INVALID: actual asset total exceeds 7.5 MiB");
  rejectActiveContent(bytes);
  if (contentType === "image/png") validatePng(bytes);
  else if (contentType === "image/jpeg") validateJpeg(bytes);
  else validateWebp(bytes);
  assetManifest.push({
    role: asset.role,
    source_url_sha256: await sha256Text(exactUrl),
    sha256: await sha256Bytes(bytes),
    content_type: contentType,
    size_bytes: bytes.length
  });
}

const stateBinding = {
  version: "arc1-intake-state-v1",
  site_id: expectedSiteId,
  form_id: expectedFormId,
  submission_id: trustedSubmissionId,
  received_at: trustedReceivedAt,
  public_folder_prefix: publicFolderPrefix,
  submission_data_sha256: submissionDataSha256,
  asset_manifest: assetManifest
};
const assetManifestSha256 = await sha256Text(canonicalJson(assetManifest));
const stateDigestSha256 = await sha256Text(canonicalJson(stateBinding));
const stateKey = `arc1-intake-claim-v1:${stateDigestSha256}`;
const issuedAt = new Date().toISOString();
const evidence = {
  version: "arc1-intake-evidence-v1",
  scope: "authoritative-netlify-intake-and-assets",
  site_id: expectedSiteId,
  site_url: trustedSiteUrl,
  form_id: expectedFormId,
  form_name: expectedFormName,
  submission_id: trustedSubmissionId,
  received_at: trustedReceivedAt,
  intake_version: "arc-intake-v7",
  budget_confirmed: requiredBudgetConfirmation,
  terms_accepted: requiredTermsAcceptance,
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
const canonicalEvidence = canonicalJson(evidence);
const evidenceHmacSha256 = await hmacHex(`arc1-intake-evidence-signature-v1\n${canonicalEvidence}`);
const evidenceSha256 = await sha256Text(canonicalEvidence);

return {
  status: "ARC1_INTAKE_EVIDENCE_ISSUED",
  build_allowed_by_this_step: false,
  github_write_allowed_by_this_step: false,
  claim_required_before_build: true,
  trusted_netlify_submission_id: trustedSubmissionId,
  trusted_received_at: trustedReceivedAt,
  public_folder_prefix: publicFolderPrefix,
  submission_data_sha256: submissionDataSha256,
  asset_manifest: assetManifest,
  asset_manifest_sha256: assetManifestSha256,
  total_asset_bytes: totalAssetBytes,
  state_key: stateKey,
  state_digest_sha256: stateDigestSha256,
  intake_evidence_private: canonicalEvidence,
  intake_evidence_hmac_sha256: evidenceHmacSha256,
  intake_evidence_sha256: evidenceSha256
};
