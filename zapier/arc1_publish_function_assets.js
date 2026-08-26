// ARC1 Function asset publisher. Run only after private retrieval and both
// create-only intake claims. It publishes verified uploads to one deterministic
// preview branch and signs an exact URL map. Folder links fail closed before
// any durable claim is consumed or any Git provider request can occur.
const clean = value => String(value == null ? "" : value).trim();
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: cryptographic runtime unavailable");
}
const encoder = new TextEncoder();
const bytesToHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const digest = async (algorithm, bytes) => bytesToHex(await globalThis.crypto.subtle.digest(algorithm, bytes));
const sha256Text = value => digest("SHA-256", encoder.encode(value));
const sha256Bytes = value => digest("SHA-256", value);
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: non-finite JSON");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: plain JSON required");
};
const exactKeys = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields.slice().sort());
const safeSecret = (value, label) => {
  const secret = String(value == null ? "" : value);
  const size = encoder.encode(secret).length;
  if (size < 32 || size > 256) throw new Error(`ARC1_ASSET_PUBLICATION_INVALID: ${label} secret length`);
  return secret;
};
const importHmac = secret => globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const hmacHex = async (key, value) => bytesToHex(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(value)));
const verifyHmac = async (key, signature, value) => {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return globalThis.crypto.subtle.verify("HMAC", key,
    Uint8Array.from(signature.match(/../g), byte => Number.parseInt(byte, 16)), encoder.encode(value));
};
const sha = value => /^[a-f0-9]{64}$/.test(clean(value));
const gitSha = value => /^[a-f0-9]{40}$/.test(clean(value));
const BRIDGE_CONTRACT_SHA256 = "c4ab396bf04464629624dd19a37602755c8d429db0bf729b49bbfdfdba3ae20c";
const OWNER = "arcwebhq-cpu";
const REPOSITORY = "arc-previews";
const BASE_BRANCH = "main";
const PAGES_BASE = `https://${OWNER}.github.io/${REPOSITORY}`;
const CURRENT_OFFER_CONTRACT_ID = "arc-fixed-five-page-offer-v1";
const CURRENT_BUDGET = "Yes, understands the finished ARC website is a fixed five-page website with a $5,000 subtotal plus applicable sales tax only after preview approval";
const CURRENT_TERMS = "Accepted ARC preview terms, privacy policy, refund policy, and fixed five-page service scope dated 2026-08-25; separate adult checkout acceptance required";
const EXTENSION = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const roleOrder = ["hero_image_file", "logo_file", "supporting_image_file"];
const slugify = value => clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const token = clean(inputData.github_token);
if (!token || clean(inputData.github_owner || OWNER) !== OWNER || clean(inputData.github_repo || REPOSITORY) !== REPOSITORY ||
    clean(inputData.github_base_branch || BASE_BRANCH) !== BASE_BRANCH || clean(inputData.pages_base_url || PAGES_BASE).replace(/\/+$/, "") !== PAGES_BASE) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: exact ARC preview repository required");
}
const intakeSecret = safeSecret(inputData.intake_evidence_secret, "intake evidence");
const assetReceiptSecret = safeSecret(inputData.asset_receipt_secret, "private receipt");
const publicationSecret = safeSecret(inputData.asset_publication_receipt_secret, "publication receipt");
if (new Set([intakeSecret, assetReceiptSecret, publicationSecret]).size !== 3) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: receipt secrets must be distinct");
}

const evidenceRaw = clean(inputData.intake_evidence_private);
let evidence;
try { evidence = JSON.parse(evidenceRaw); } catch { throw new Error("ARC1_ASSET_PUBLICATION_INVALID: intake evidence JSON"); }
const evidenceFields = [
  "version", "scope", "bridge_contract_sha256", "site_id_sha256", "source_schema", "source_form_name", "source_key_hmac_sha256",
  "delivery_id", "submission_id", "received_at", "intake_version", "offer_contract_id", "budget_confirmed", "terms_accepted", "asset_permission",
  "public_folder_prefix", "submission_data_sha256", "asset_manifest", "asset_manifest_sha256", "total_asset_bytes", "state_key",
  "state_digest_sha256", "claim_required_before_build", "issued_at"
];
if (!exactKeys(evidence, evidenceFields) || canonicalJson(evidence) !== evidenceRaw || evidence.version !== "arc1-intake-evidence-v2" ||
    evidence.scope !== "authoritative-first-party-function-intake" || evidence.bridge_contract_sha256 !== BRIDGE_CONTRACT_SHA256 ||
    evidence.source_schema !== "arc-intake-function-submission-v1" || evidence.source_form_name !== "arc-preview-function-v1" ||
    !sha(evidence.site_id_sha256) || !sha(evidence.source_key_hmac_sha256) || !sha(evidence.delivery_id) || !sha(evidence.submission_data_sha256) ||
    !sha(evidence.asset_manifest_sha256) || !sha(evidence.state_digest_sha256) || evidence.state_key !== `arc1-intake-claim-v2:${evidence.state_digest_sha256}` ||
    evidence.claim_required_before_build !== true || !/^[a-f0-9]{8}$/.test(evidence.public_folder_prefix) ||
    evidence.intake_version !== "arc-intake-v8" || evidence.offer_contract_id !== CURRENT_OFFER_CONTRACT_ID ||
    evidence.budget_confirmed !== CURRENT_BUDGET || evidence.terms_accepted !== CURRENT_TERMS) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: canonical Function intake evidence");
}
const receivedMs = Date.parse(evidence.received_at), issuedMs = Date.parse(evidence.issued_at), nowMs = Date.now();
if (!Number.isFinite(receivedMs) || !Number.isFinite(issuedMs) || new Date(receivedMs).toISOString() !== evidence.received_at ||
    new Date(issuedMs).toISOString() !== evidence.issued_at || receivedMs > nowMs + 5 * 60 * 1000 || issuedMs > nowMs + 5 * 60 * 1000 ||
    issuedMs < receivedMs - 5 * 60 * 1000) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: evidence timestamp order");
const intakeKey = await importHmac(intakeSecret);
if (!await verifyHmac(intakeKey, clean(inputData.intake_evidence_hmac_sha256).toLowerCase(), `arc1-intake-evidence-signature-v2\n${evidenceRaw}`)) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: intake evidence HMAC mismatch");
}
const intakeEvidenceSha256 = await sha256Text(evidenceRaw);
if (clean(inputData.intake_evidence_sha256).toLowerCase() !== intakeEvidenceSha256) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: intake evidence digest mismatch");
}
if (!Array.isArray(evidence.asset_manifest) || evidence.asset_manifest.length > 3 ||
    await sha256Text(canonicalJson(evidence.asset_manifest)) !== evidence.asset_manifest_sha256 ||
    (evidence.asset_manifest.length > 0 && evidence.asset_permission !== "Confirmed")) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: signed asset permission or manifest");
}
if (evidence.asset_manifest.some(manifest => manifest?.kind === "FOLDER_LINK" || manifest?.role === "asset_folder_link")) {
  throw new Error("ARC1_ASSET_PUBLICATION_UNSUPPORTED: folder links require a private provider adapter");
}
let generated;
try {
  generated = JSON.parse(clean(inputData.raw_json || inputData.generated_json).replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, ""));
} catch { throw new Error("ARC1_ASSET_PUBLICATION_INVALID: generated JSON"); }
const businessSlug = slugify(generated?.BUSINESS_NAME).slice(0, 64).replace(/-+$/g, "");
const previewFolder = `${businessSlug}-${evidence.public_folder_prefix}`;
if (!businessSlug || !/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder)) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: deterministic preview folder");
}
const claimCreatedAt = clean(inputData.intake_claim_created_at);
const claimCreatedMs = Date.parse(claimCreatedAt);
if (clean(inputData.intake_claim_status).toLowerCase() !== "claimed" || inputData.intake_claim_state_key !== evidence.state_key ||
    clean(inputData.intake_claim_state_digest_sha256).toLowerCase() !== evidence.state_digest_sha256 ||
    clean(inputData.intake_claim_evidence_sha256).toLowerCase() !== intakeEvidenceSha256 ||
    clean(inputData.intake_claim_public_folder_prefix).toLowerCase() !== evidence.public_folder_prefix ||
    clean(inputData.intake_claim_asset_manifest_sha256).toLowerCase() !== evidence.asset_manifest_sha256 ||
    clean(inputData.intake_claim_existing_preview_folder) || !Number.isFinite(claimCreatedMs) || new Date(claimCreatedMs).toISOString() !== claimCreatedAt ||
    claimCreatedMs < issuedMs - 5 * 60 * 1000 || claimCreatedMs > nowMs + 5 * 60 * 1000) {
  throw new Error("ARC1_ASSET_PUBLICATION_BLOCKED: exact create-only intake claim required");
}

const privateReceiptRaw = clean(inputData.asset_receipt_private);
let privateReceipt;
try { privateReceipt = JSON.parse(privateReceiptRaw); } catch { throw new Error("ARC1_ASSET_PUBLICATION_INVALID: private receipt JSON"); }
const privateReceiptFields = ["version", "scope", "bridge_contract_sha256", "delivery_id", "bridge_evidence_sha256",
  "retrieval_endpoint_sha256", "asset_manifest_sha256", "asset_count", "total_asset_bytes", "status"];
const assetReceiptKey = await importHmac(assetReceiptSecret);
const privateReceiptSha256 = await sha256Text(privateReceiptRaw);
if (!exactKeys(privateReceipt, privateReceiptFields) || canonicalJson(privateReceipt) !== privateReceiptRaw ||
    privateReceipt.version !== "arc1-private-asset-receipt-v1" || privateReceipt.scope !== "authenticated-content-addressed-intake-assets" ||
    privateReceipt.bridge_contract_sha256 !== BRIDGE_CONTRACT_SHA256 || privateReceipt.delivery_id !== evidence.delivery_id ||
    !sha(privateReceipt.bridge_evidence_sha256) || !sha(privateReceipt.retrieval_endpoint_sha256) ||
    privateReceipt.asset_manifest_sha256 !== evidence.asset_manifest_sha256 || privateReceipt.asset_count !== evidence.asset_manifest.length ||
    privateReceipt.total_asset_bytes !== evidence.total_asset_bytes || privateReceipt.status !== "VERIFIED" ||
    clean(inputData.asset_receipt_sha256).toLowerCase() !== privateReceiptSha256 ||
    clean(inputData.ingress_claim_asset_receipt_sha256).toLowerCase() !== privateReceiptSha256 ||
    !await verifyHmac(assetReceiptKey, clean(inputData.asset_receipt_hmac_sha256).toLowerCase(),
      `arc1-private-asset-receipt-signature-v1\n${privateReceiptRaw}`)) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: exact durable private receipt required");
}
const expectedIngressDigestSha256 = await sha256Text(canonicalJson({
  version: "arc1-function-intake-adapter-v1",
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  delivery_id: evidence.delivery_id,
  bridge_evidence_sha256: privateReceipt.bridge_evidence_sha256,
  arc1_evidence_sha256: intakeEvidenceSha256,
  state_key: evidence.state_key,
  state_digest_sha256: evidence.state_digest_sha256
}));
const expectedIngressKey = `arc1-function-ingress-v1:${expectedIngressDigestSha256}`;
const ingressClaimCreatedAt = clean(inputData.ingress_claim_created_at);
const ingressClaimCreatedMs = Date.parse(ingressClaimCreatedAt);
if (clean(inputData.ingress_claim_status).toLowerCase() !== "claimed" ||
    !new Set(["CREATED", "EXACT_REPLAY"]).has(clean(inputData.ingress_claim_mode).toUpperCase()) ||
    clean(inputData.ingress_state_key) !== expectedIngressKey || clean(inputData.ingress_state_digest_sha256).toLowerCase() !== expectedIngressDigestSha256 ||
    clean(inputData.ingress_claim_state_key) !== expectedIngressKey ||
    clean(inputData.ingress_claim_state_digest_sha256).toLowerCase() !== expectedIngressDigestSha256 ||
    clean(inputData.ingress_claim_bridge_delivery_id).toLowerCase() !== evidence.delivery_id ||
    clean(inputData.ingress_claim_bridge_evidence_sha256).toLowerCase() !== privateReceipt.bridge_evidence_sha256 ||
    clean(inputData.ingress_claim_asset_receipt_sha256).toLowerCase() !== privateReceiptSha256 ||
    !Number.isFinite(ingressClaimCreatedMs) || new Date(ingressClaimCreatedMs).toISOString() !== ingressClaimCreatedAt ||
    ingressClaimCreatedMs < issuedMs - 5 * 60 * 1000 || ingressClaimCreatedMs > nowMs + 5 * 60 * 1000) {
  throw new Error("ARC1_ASSET_PUBLICATION_BLOCKED: exact create-only ingress claim required");
}

let payloads;
const payloadsRaw = clean(inputData.asset_payloads_private_json);
try { payloads = JSON.parse(payloadsRaw); } catch { throw new Error("ARC1_ASSET_PUBLICATION_INVALID: private payload JSON"); }
if (!Array.isArray(payloads) || payloads.length !== evidence.asset_manifest.length || canonicalJson(payloads) !== payloadsRaw) {
  throw new Error("ARC1_ASSET_PUBLICATION_INVALID: private payload set");
}
const mediaDimensions = bytes => {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
    bytes.readUInt32BE(bytes.length - 12) === 0 && bytes.subarray(bytes.length - 8, bytes.length - 4).toString("ascii") === "IEND") {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 255) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 217 || marker === 218) break;
      if (marker === 0 || marker === 1 || (marker >= 208 && marker <= 215)) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (new Set([192,193,194,195,197,198,199,201,202,203,205,206,207]).has(marker) && length >= 7) {
        return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      }
      offset += 2 + length;
    }
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) {
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
    if (chunk === "VP8L" && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
    }
    if (chunk === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    }
  }
  return null;
};
const rejectEmbeddedMetadata = (bytes, contentType) => {
  if (contentType === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG");
    let offset = 2;
    while (offset < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 255) offset += 1;
      if (offset >= bytes.length) break;
      while (offset < bytes.length && bytes[offset] === 255) offset += 1;
      if (offset >= bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG marker");
      const marker = bytes[offset++];
      if (marker === 217) {
        if (offset !== bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG end marker");
        return;
      }
      if (marker === 0 || marker === 1 || marker === 216 || (marker >= 208 && marker <= 215)) {
        throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG marker order");
      }
      if (offset + 2 > bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG segment");
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG segment");
      const data = bytes.subarray(offset + 2, offset + length);
      if (marker === 218) {
        // Accept one baseline scan only. Entropy may contain FF00-stuffed data
        // and restart markers, but any other marker (including a progressive
        // second scan or post-scan APP metadata) fails closed. EOI is required
        // at the exact end of the file.
        let scanOffset = offset + length;
        while (scanOffset < bytes.length) {
          if (bytes[scanOffset] !== 255) { scanOffset += 1; continue; }
          let markerOffset = scanOffset + 1;
          while (markerOffset < bytes.length && bytes[markerOffset] === 255) markerOffset += 1;
          if (markerOffset >= bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG entropy");
          const scanMarker = bytes[markerOffset];
          if (scanMarker === 0) { scanOffset = markerOffset + 1; continue; }
          if (scanMarker >= 208 && scanMarker <= 215) { scanOffset = markerOffset + 1; continue; }
          if (scanMarker === 217 && markerOffset + 1 === bytes.length) return;
          throw new Error("ARC1_ASSET_PUBLICATION_INVALID: embedded JPEG metadata or multiple scans are not allowed");
        }
        throw new Error("ARC1_ASSET_PUBLICATION_INVALID: missing JPEG end marker");
      }
      if (marker === 254) {
        throw new Error("ARC1_ASSET_PUBLICATION_INVALID: embedded JPEG metadata is not allowed");
      }
      if (marker >= 224 && marker <= 239) {
        const jfif = marker === 224 && data.length >= 14 && data.subarray(0, 5).toString("latin1") === "JFIF\0" &&
          data[5] === 1 && data.length === 14 + (3 * data[12] * data[13]);
        const adobe = marker === 238 && data.length === 12 && data.subarray(0, 5).toString("latin1") === "Adobe";
        if (!jfif && !adobe) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: embedded JPEG metadata is not allowed");
      }
      offset += length;
    }
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed JPEG container");
  }
  if (contentType === "image/png") {
    if (bytes.length < 20 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed PNG");
    }
    const forbidden = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "iCCP", "tIME"]);
    const allowed = new Set(["IHDR", "PLTE", "IDAT", "IEND", "cHRM", "gAMA", "sBIT", "sRGB", "bKGD", "hIST", "tRNS", "pHYs"]);
    let offset = 8, ended = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed PNG chunk");
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      const next = offset + 12 + length;
      if (!/^[A-Za-z]{4}$/.test(type) || next > bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed PNG chunk");
      if (forbidden.has(type)) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: embedded PNG metadata is not allowed");
      if (!allowed.has(type)) {
        if (/^[a-z]/.test(type)) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: embedded PNG metadata is not allowed");
        throw new Error("ARC1_ASSET_PUBLICATION_INVALID: unsupported critical PNG chunk");
      }
      offset = next;
      if (type === "IEND") { ended = true; break; }
    }
    if (!ended || offset !== bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed PNG container");
    return;
  }
  if (contentType === "image/webp") {
    if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
        bytes.subarray(8, 12).toString("ascii") !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) {
      throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed WebP");
    }
    const forbidden = new Set(["EXIF", "XMP ", "ICCP"]);
    const allowed = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
    let offset = 12;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed WebP chunk");
      const type = bytes.subarray(offset, offset + 4).toString("ascii");
      const length = bytes.readUInt32LE(offset + 4);
      const next = offset + 8 + length + (length & 1);
      if (next > bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed WebP chunk");
      if (forbidden.has(type)) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: embedded WebP metadata is not allowed");
      if (!allowed.has(type)) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: embedded WebP metadata is not allowed");
      offset = next;
    }
    if (offset !== bytes.length) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed WebP container");
  }
};
const validateImageStructure = (bytes, contentType, prefix) => {
  const invalid = detail => { throw new Error(`${prefix}: ${detail}`); };
  const dimension = (width, height) => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > 12000 || height > 12000 || width * height > 40000000) invalid("invalid image dimensions");
  };
  if (contentType === "image/jpeg") {
    if (bytes.length < 30) invalid("incomplete JPEG structure");
    let offset = 2, sawFrame = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 255) invalid("JPEG marker alignment");
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset++];
      if (offset + 2 > bytes.length) invalid("truncated JPEG segment");
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) invalid("malformed JPEG segment");
      const data = bytes.subarray(offset + 2, offset + length);
      if (marker === 192) {
        const components = data[5];
        if (sawFrame || data.length < 9 || data[0] !== 8 || components < 1 || components > 4 || length !== 8 + 3 * components) {
          invalid("unsupported JPEG frame");
        }
        dimension(data.readUInt16BE(3), data.readUInt16BE(1)); sawFrame = true;
      } else if (marker >= 193 && marker <= 207 && ![196, 200, 204].includes(marker)) invalid("unsupported JPEG frame");
      if (marker === 218) {
        const components = data[0];
        if (!sawFrame || components < 1 || components > 4 || length !== 6 + 2 * components) invalid("invalid JPEG scan");
        let scan = offset + length, entropy = 0;
        while (scan < bytes.length) {
          if (bytes[scan] !== 255) { entropy += 1; scan += 1; continue; }
          let next = scan + 1; while (bytes[next] === 255) next += 1;
          if (next >= bytes.length) invalid("truncated JPEG entropy");
          if (bytes[next] === 0) { entropy += 1; scan = next + 1; continue; }
          if (bytes[next] >= 208 && bytes[next] <= 215) { scan = next + 1; continue; }
          if (bytes[next] === 217 && next + 1 === bytes.length && entropy > 0) return;
          invalid("invalid JPEG entropy or multiple scans");
        }
        invalid("missing JPEG end marker");
      }
      offset += length;
    }
    invalid("missing JPEG scan");
  }
  if (contentType === "image/png") {
    const table = Array.from({ length: 256 }, (_, value) => {
      let current = value; for (let bit = 0; bit < 8; bit += 1) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
      return current >>> 0;
    });
    const crc32 = data => {
      let value = 0xffffffff; for (const byte of data) value = table[(value ^ byte) & 255] ^ (value >>> 8);
      return (value ^ 0xffffffff) >>> 0;
    };
    if (bytes.length < 57) invalid("incomplete PNG structure");
    let offset = 8, index = 0, sawData = false, dataEnded = false, dataBytes = 0, color = -1, palette = false;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      const dataStart = offset + 8, crcOffset = dataStart + length, next = crcOffset + 4;
      if (next > bytes.length || crc32(bytes.subarray(offset + 4, crcOffset)) !== bytes.readUInt32BE(crcOffset)) invalid("PNG CRC mismatch");
      const data = bytes.subarray(dataStart, crcOffset);
      if (type === "IHDR") {
        const legal = { 0:[1,2,4,8,16], 2:[8,16], 3:[1,2,4,8], 4:[8,16], 6:[8,16] };
        color = data[9];
        if (index !== 0 || length !== 13 || !legal[color]?.includes(data[8]) || data[10] !== 0 || data[11] !== 0 || ![0,1].includes(data[12])) invalid("invalid PNG IHDR");
        dimension(data.readUInt32BE(0), data.readUInt32BE(4));
      } else if (index === 0) invalid("PNG IHDR must be first");
      if (type === "PLTE") {
        if (sawData || palette || length < 3 || length > 768 || length % 3) invalid("invalid PNG palette");
        palette = true;
      } else if (type === "IDAT") {
        if (dataEnded || length < 1) invalid("invalid PNG IDAT");
        sawData = true; dataBytes += length;
      } else if (sawData && type !== "IEND") dataEnded = true;
      if (type === "IEND") {
        if (!sawData || dataBytes < 2 || length !== 0 || next !== bytes.length || (color === 3 && !palette)) invalid("incomplete PNG image data");
        return;
      }
      offset = next; index += 1;
    }
    invalid("missing PNG end");
  }
  if (contentType === "image/webp") {
    if (bytes.length < 25) invalid("incomplete WebP structure");
    let offset = 12, first = true, extended = false, animated = false, primary = false;
    while (offset < bytes.length) {
      const type = bytes.subarray(offset, offset + 4).toString("ascii"), length = bytes.readUInt32LE(offset + 4);
      const start = offset + 8, next = start + length + (length & 1), data = bytes.subarray(start, start + length);
      if (next > bytes.length) invalid("malformed WebP chunk");
      if (type === "VP8X") {
        if (!first || extended || length !== 10 || (data[0] & 193)) invalid("invalid WebP VP8X");
        extended = true; animated = Boolean(data[0] & 2);
        dimension(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3));
      } else if (type === "VP8 ") {
        if (primary || animated || length < 10 || data[3] !== 157 || data[4] !== 1 || data[5] !== 42) invalid("invalid WebP VP8");
        dimension(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff); primary = true;
      } else if (type === "VP8L") {
        if (primary || animated || length < 5 || data[0] !== 47 || (data[4] & 224)) invalid("invalid WebP VP8L");
        const bits = data.readUInt32LE(1); dimension(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)); primary = true;
      } else if (type === "ANIM") {
        if (!extended || !animated || length !== 6 || primary) invalid("invalid WebP animation");
      } else if (type === "ANMF") {
        if (!extended || !animated || length < 16) invalid("invalid WebP frame"); primary = true;
      } else if (type === "ALPH" && (!extended || primary || length < 1)) invalid("invalid WebP alpha");
      offset = next; first = false;
    }
    if (offset !== bytes.length || !primary) invalid("missing WebP image payload");
  }
};
const entries = [];
const bytesByPath = new Map();
let previousRole = -1;
let total = 0;
for (let index = 0; index < evidence.asset_manifest.length; index += 1) {
  const manifest = evidence.asset_manifest[index];
  const payload = payloads[index];
  const payloadFields = ["asset_id", "kind", "role", "content_type", "size_bytes", "sha256", "content_base64"];
  const manifestFields = ["asset_id", "content_type", "kind", "retrieval_endpoint_sha256", "role", "sha256", "size_bytes"];
  const roleIndex = roleOrder.indexOf(clean(manifest?.role));
  if (!exactKeys(manifest, manifestFields) || !exactKeys(payload, payloadFields) || roleIndex <= previousRole ||
      manifest.asset_id !== payload.asset_id || manifest.kind !== payload.kind || manifest.role !== payload.role ||
      manifest.content_type !== payload.content_type || manifest.size_bytes !== payload.size_bytes || manifest.sha256 !== payload.sha256 ||
      !sha(manifest.asset_id) || !sha(manifest.sha256) || !sha(manifest.retrieval_endpoint_sha256) ||
      !Number.isSafeInteger(manifest.size_bytes) || manifest.size_bytes < 1 || manifest.kind !== "UPLOAD") {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: payload/manifest binding");
  }
  previousRole = roleIndex;
  total += manifest.size_bytes;
  if (!Object.hasOwn(EXTENSION, manifest.content_type) || manifest.size_bytes > 1250000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.content_base64)) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: upload encoding/type/size");
  }
  const bytes = Buffer.from(payload.content_base64, "base64");
  if (bytes.toString("base64") !== payload.content_base64 || bytes.length !== manifest.size_bytes || await sha256Bytes(bytes) !== manifest.sha256) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: upload bytes/digest");
  }
  rejectEmbeddedMetadata(bytes, manifest.content_type);
  validateImageStructure(bytes, manifest.content_type, "ARC1_ASSET_PUBLICATION_INVALID");
  const dimensions = mediaDimensions(bytes);
  const activeMarker = bytes.toString("latin1").toLowerCase();
  if (!dimensions || dimensions[0] < 1 || dimensions[1] < 1 || dimensions[0] > 12000 || dimensions[1] > 12000 ||
      dimensions[0] * dimensions[1] > 40000000 ||
      /<(?:script|svg|html|iframe|object|embed)\b|javascript\s*:/.test(activeMarker)) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: malformed or active-content media");
  }
  const repositoryPath = `${previewFolder}/assets/${manifest.sha256}.${EXTENSION[manifest.content_type]}`;
  const publicUrl = `${PAGES_BASE}/${repositoryPath}`;
  const gitBlobSha1 = await digest("SHA-1", Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, "utf8"), bytes]));
  if (bytesByPath.has(repositoryPath) && !bytesByPath.get(repositoryPath).equals(bytes)) {
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: content-address collision");
  }
  bytesByPath.set(repositoryPath, bytes);
  entries.push({ asset_id: manifest.asset_id, content_type: manifest.content_type, git_blob_sha1: gitBlobSha1,
    public_url: publicUrl, repository_path: repositoryPath, role: manifest.role, sha256: manifest.sha256, size_bytes: manifest.size_bytes });
}
if (total !== evidence.total_asset_bytes) throw new Error("ARC1_ASSET_PUBLICATION_INVALID: total asset bytes");

const receipt = {
  version: "arc1-public-asset-publication-receipt-v1",
  scope: "github-content-addressed-preview-assets",
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  delivery_id: evidence.delivery_id,
  bridge_evidence_sha256: privateReceipt.bridge_evidence_sha256,
  private_asset_receipt_sha256: privateReceiptSha256,
  intake_evidence_sha256: intakeEvidenceSha256,
  intake_state_digest_sha256: evidence.state_digest_sha256,
  asset_manifest_sha256: evidence.asset_manifest_sha256,
  asset_permission: evidence.asset_permission,
  repository: `${OWNER}/${REPOSITORY}`,
  base_branch: BASE_BRANCH,
  preview_branch: `arc-preview/${evidence.public_folder_prefix}`,
  pages_base_url: PAGES_BASE,
  public_folder_prefix: evidence.public_folder_prefix,
  preview_folder: previewFolder,
  entries,
  status: entries.length ? "VERIFIED_CONTENT_ADDRESSED" : "NO_PUBLIC_UPLOADS"
};
const receiptRaw = canonicalJson(receipt);
const publicationKey = await importHmac(publicationSecret);
const receiptHmac = await hmacHex(publicationKey, `arc1-public-asset-publication-receipt-v1\n${receiptRaw}`);
const receiptSha256 = await sha256Text(receiptRaw);

let branchHeadSha = "";
let publicationMode = entries.length ? "CREATED" : "NO_PUBLIC_UPLOADS";
if (entries.length) {
  const api = `https://api.github.com/repos/${OWNER}/${REPOSITORY}`;
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28" };
  const requestedOperationTimeout = clean(inputData.provider_operation_timeout_ms);
  const operationTimeoutMs = requestedOperationTimeout ? Number(requestedOperationTimeout) : 25000;
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 100 || operationTimeoutMs > 25000) {
    throw new Error("ARC1_ASSET_GITHUB_FAILED: operation timeout is invalid");
  }
  const operationDeadline = Date.now() + operationTimeoutMs;
  const maximumResponseBytes = 4 * 1024 * 1024;
  const readBoundedBytes = async response => {
    const declared = clean(response.headers?.get?.("content-length"));
    if (declared && (!/^\d{1,10}$/.test(declared) || Number(declared) > maximumResponseBytes)) {
      throw new Error("ARC1_ASSET_GITHUB_FAILED: declared response exceeds limit");
    }
    if (response.status === 204) return Buffer.alloc(0);
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error("ARC1_ASSET_GITHUB_FAILED: streaming response required");
    let total = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumResponseBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error("ARC1_ASSET_GITHUB_FAILED: streamed response exceeds limit");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return Buffer.concat(chunks, total);
  };
  const request = async (url, options = {}, allowed = []) => {
    const requestedUrl = new URL(url);
    if (requestedUrl.origin !== "https://api.github.com" || requestedUrl.username || requestedUrl.password || requestedUrl.port) {
      throw new Error("ARC1_ASSET_GITHUB_FAILED: invalid API origin");
    }
    const remaining = operationDeadline - Date.now();
    if (remaining <= 0) throw new Error("ARC1_ASSET_GITHUB_FAILED: operation deadline exceeded");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(10000, remaining)));
    try {
      const response = await fetch(requestedUrl.toString(), {
        ...options,
        redirect: "error",
        signal: controller.signal,
        headers: { ...headers, ...(options.headers || {}) }
      });
      if (!response.url || response.url !== requestedUrl.toString()) {
        throw new Error("ARC1_ASSET_GITHUB_FAILED: response URL changed");
      }
      const bytes = await readBoundedBytes(response);
      let body = {};
      if (response.status !== 204) {
        try { body = JSON.parse(bytes.toString("utf8")); }
        catch { throw new Error("ARC1_ASSET_GITHUB_FAILED: malformed JSON response"); }
      }
      if (response.ok) return body;
      if (allowed.includes(response.status)) return { _status: response.status, _body: body };
      throw new Error(`ARC1_ASSET_GITHUB_FAILED: ${response.status}`);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("ARC1_ASSET_GITHUB_FAILED: request timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const branch = receipt.preview_branch;
  const getRef = (name, allowed = []) => request(`${api}/git/ref/${encodeURIComponent(`heads/${name}`)}`, {}, allowed);
  const getCommitTree = async commitSha => {
    const commit = await request(`${api}/git/commits/${commitSha}`);
    if (!gitSha(commit.tree?.sha)) throw new Error("ARC1_ASSET_GITHUB_FAILED: commit tree");
    return commit.tree.sha;
  };
  const verifyBranch = async (commitSha, { allowMissing = false } = {}) => {
    let treeSha = await getCommitTree(commitSha);
    let tree = await request(`${api}/git/trees/${treeSha}`);
    const rootItems = Array.isArray(tree.tree) ? tree.tree : [];
    const named = rootItems.filter(item => item.path === previewFolder);
    if (!named.length && allowMissing) return { found: false, hasIndex: false };
    let matches = named.filter(item => item.type === "tree" && item.mode === "040000" && gitSha(item.sha));
    if (matches.length !== 1) throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: preview folder missing or ambiguous");
    treeSha = matches[0].sha;
    const folder = await request(`${api}/git/trees/${treeSha}`);
    const folderItems = Array.isArray(folder.tree) ? folder.tree : [];
    const assetTrees = folderItems.filter(item => item.path === "assets" && item.type === "tree" && item.mode === "040000" && gitSha(item.sha));
    const indexItems = folderItems.filter(item => item.path === "index.html" && item.type === "blob" && item.mode === "100644" && gitSha(item.sha));
    const routeNames = ["about", "contact", "process", "services"];
    const assetStagePaths = new Set(["assets"]);
    const completedPaths = new Set(["assets", "about", "contact", "process", "services", "index.html"]);
    const isExactPathSet = expected => folderItems.length === expected.size &&
      new Set(folderItems.map(item => item.path)).size === expected.size && folderItems.every(item => expected.has(item.path));
    const assetStage = isExactPathSet(assetStagePaths);
    const completedSite = isExactPathSet(completedPaths);
    if (assetTrees.length !== 1 || (!assetStage && !completedSite) ||
        (completedSite && indexItems.length !== 1)) {
      throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: asset-stage preview folder has extra or missing entries");
    }
    if (completedSite) {
      for (const route of routeNames) {
        const routeTrees = folderItems.filter(item => item.path === route && item.type === "tree" && item.mode === "040000" && gitSha(item.sha));
        if (routeTrees.length !== 1) throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: completed five-page route missing or ambiguous");
        const routeTree = await request(`${api}/git/trees/${routeTrees[0].sha}`);
        const routeItems = Array.isArray(routeTree.tree) ? routeTree.tree : [];
        if (routeItems.length !== 1 || routeItems[0].path !== "index.html" || routeItems[0].type !== "blob" ||
            routeItems[0].mode !== "100644" || !gitSha(routeItems[0].sha)) {
          throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: completed five-page route has extra or missing entries");
        }
      }
    }
    treeSha = assetTrees[0].sha;
    const leaf = await request(`${api}/git/trees/${treeSha}`);
    const expectedNames = new Set(entries.map(entry => entry.repository_path.split("/").at(-1)));
    const leafItems = Array.isArray(leaf.tree) ? leaf.tree : [];
    if (leafItems.length !== expectedNames.size || leafItems.some(item => item.type !== "blob" || item.mode !== "100644" || !expectedNames.has(item.path))) {
      throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: extra or missing asset file");
    }
    for (const entry of entries) {
      const name = entry.repository_path.split("/").at(-1);
      const matches = leafItems.filter(item => item.path === name && item.type === "blob" && item.mode === "100644");
      if (matches.length !== 1 || matches[0].sha !== entry.git_blob_sha1 || matches[0].size !== entry.size_bytes) {
        throw new Error("ARC1_ASSET_PUBLICATION_CONFLICT: deterministic asset differs");
      }
    }
    return { found: true, hasIndex: completedSite };
  };
  let ref = await getRef(branch, [404]);
  if (!ref._status) {
    branchHeadSha = clean(ref.object?.sha);
    if (!gitSha(branchHeadSha)) throw new Error("ARC1_ASSET_GITHUB_FAILED: branch head");
    await verifyBranch(branchHeadSha);
    publicationMode = "EXACT_REPLAY";
  } else {
    const baseRef = await getRef(BASE_BRANCH);
    const parentCommit = clean(baseRef.object?.sha);
    if (!gitSha(parentCommit)) throw new Error("ARC1_ASSET_GITHUB_FAILED: base head");
    const baseTree = await getCommitTree(parentCommit);
    const baseState = await verifyBranch(parentCommit, { allowMissing: true });
    if (baseState.found && baseState.hasIndex) {
      branchHeadSha = parentCommit;
      publicationMode = "EXACT_REPLAY";
    } else {
    if (receivedMs < nowMs - 24 * 60 * 60 * 1000 || issuedMs < nowMs - 24 * 60 * 60 * 1000 ||
        claimCreatedMs < nowMs - 24 * 60 * 60 * 1000 || ingressClaimCreatedMs < nowMs - 24 * 60 * 60 * 1000) {
      throw new Error("ARC1_ASSET_PUBLICATION_BLOCKED: stale evidence cannot create a public branch");
    }
    const treeItems = [];
    for (const entry of entries.filter((candidate, index, list) => list.findIndex(item => item.repository_path === candidate.repository_path) === index)) {
      const bytes = bytesByPath.get(entry.repository_path);
      const blob = await request(`${api}/git/blobs`, { method: "POST",
        body: JSON.stringify({ content: bytes.toString("base64"), encoding: "base64" }) });
      if (blob.sha !== entry.git_blob_sha1) throw new Error("ARC1_ASSET_GITHUB_FAILED: blob identity mismatch");
      treeItems.push({ path: entry.repository_path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await request(`${api}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: treeItems }) });
    if (!gitSha(tree.sha)) throw new Error("ARC1_ASSET_GITHUB_FAILED: asset tree");
    const commit = await request(`${api}/git/commits`, { method: "POST", body: JSON.stringify({
      message: `Stage verified ARC assets ${evidence.public_folder_prefix}`, tree: tree.sha, parents: [parentCommit]
    }) });
    if (!gitSha(commit.sha)) throw new Error("ARC1_ASSET_GITHUB_FAILED: asset commit");
    const created = await request(`${api}/git/refs`, { method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) }, [422]);
    if (created._status) {
      ref = await getRef(branch);
      branchHeadSha = clean(ref.object?.sha);
      if (!gitSha(branchHeadSha)) throw new Error("ARC1_ASSET_GITHUB_FAILED: raced branch head");
      await verifyBranch(branchHeadSha);
      publicationMode = "EXACT_REPLAY";
    } else {
      branchHeadSha = clean(created.object?.sha || commit.sha);
      if (branchHeadSha !== commit.sha) throw new Error("ARC1_ASSET_GITHUB_FAILED: created branch binding");
      await verifyBranch(branchHeadSha);
    }
    }
  }
}
const urlByRole = Object.fromEntries(entries.map(entry => [entry.role, entry.public_url]));
return {
  status: entries.length ? `ARC1_FUNCTION_ASSETS_${publicationMode}` : "ARC1_FUNCTION_ASSETS_NONE",
  automation_enabled_by_this_step: false,
  cleanup_action_allowed_by_this_step: false,
  recovery_mode: "exact-replay-only",
  publication_mode: publicationMode,
  publication_branch_head_sha: branchHeadSha,
  public_asset_url_map_json: canonicalJson(urlByRole),
  logo_file_url: urlByRole.logo_file || "",
  hero_image_url: urlByRole.hero_image_file || "",
  supporting_image_url: urlByRole.supporting_image_file || "",
  asset_publication_receipt_private: receiptRaw,
  asset_publication_receipt_hmac_sha256: receiptHmac,
  asset_publication_receipt_sha256: receiptSha256,
  asset_publication_state_key: `arc1-public-assets-v1:${receiptSha256}`
};
