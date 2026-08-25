// ARC1 private asset consumer. Run after bridge verification and before the
// durable ingress claim/ack. It retrieves exact grants by authenticated POST,
// validates bytes server-to-server, and emits a signed deterministic receipt.
const clean = value => String(value == null ? "" : value).trim();
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof Buffer !== "function") {
  throw new Error("ARC1_ASSET_CRYPTO_UNAVAILABLE");
}
const encoder = new TextEncoder();
const bytesToHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const sha256Text = async value => bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value)));
const sha256Bytes = async value => bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", value));
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ARC1_ASSET_INVALID: non-finite JSON");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC1_ASSET_INVALID: plain JSON required");
};
const exactKeys = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields.slice().sort());
const safeSecret = (value, label) => {
  const secret = String(value == null ? "" : value);
  const size = encoder.encode(secret).length;
  if (size < 32 || size > 256) throw new Error(`ARC1_ASSET_INVALID: ${label} secret length`);
  return secret;
};
const sha = value => /^[a-f0-9]{64}$/.test(clean(value));
const BRIDGE_CONTRACT_SHA256 = "e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841";
const bearer = safeSecret(inputData.asset_retrieval_bearer, "retrieval bearer");
const receiptSecret = safeSecret(inputData.asset_receipt_secret, "receipt");
if (bearer === receiptSecret) throw new Error("ARC1_ASSET_INVALID: secrets must be distinct");
const deliveryId = clean(inputData.bridge_delivery_id).toLowerCase();
const evidenceSha256 = clean(inputData.bridge_evidence_sha256).toLowerCase();
if (!sha(deliveryId) || !sha(evidenceSha256) || clean(inputData.bridge_contract_sha256) !== BRIDGE_CONTRACT_SHA256) {
  throw new Error("ARC1_ASSET_INVALID: bridge binding");
}
let endpoint;
try { endpoint = new URL(clean(inputData.asset_retrieval_endpoint)); } catch { throw new Error("ARC1_ASSET_INVALID: retrieval endpoint"); }
if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash ||
    endpoint.pathname !== "/internal/intake/arc1/assets/retrieve" ||
    !["arcweb.onl", "arcsites.netlify.app"].includes(endpoint.hostname) || endpoint.toString() !== clean(inputData.asset_retrieval_endpoint)) {
  throw new Error("ARC1_ASSET_INVALID: retrieval endpoint");
}
const endpointSha256 = await sha256Text(endpoint.toString());
let grants;
try { grants = JSON.parse(clean(inputData.private_asset_grants_json)); } catch { throw new Error("ARC1_ASSET_INVALID: grants JSON"); }
if (!Array.isArray(grants) || grants.length > 3 || canonicalJson(grants) !== clean(inputData.private_asset_grants_json) ||
    await sha256Text(canonicalJson(grants)) !== clean(inputData.private_asset_grants_sha256).toLowerCase()) {
  throw new Error("ARC1_ASSET_INVALID: grants binding");
}
if (grants.some(grant => grant?.kind === "FOLDER_LINK" || grant?.role === "asset_folder_link")) {
  throw new Error("ARC1_ASSET_UNSUPPORTED: folder links require a private provider adapter");
}
const requestedOperationTimeout = clean(inputData.provider_operation_timeout_ms);
const operationTimeoutMs = requestedOperationTimeout ? Number(requestedOperationTimeout) : 25000;
if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 100 || operationTimeoutMs > 25000) {
  throw new Error("ARC1_ASSET_INVALID: provider operation timeout");
}
const operationDeadline = Date.now() + operationTimeoutMs;
const providerTimeout = () => new Error("ARC1_ASSET_INVALID: provider operation timeout");

const readBounded = async (response, expectedSize, controller) => {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("ARC1_ASSET_INVALID: streaming response required");
  const cancelOnAbort = () => {
    try { void reader.cancel().catch(() => {}); } catch {}
  };
  controller.signal.addEventListener("abort", cancelOnAbort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (controller.signal.aborted || Date.now() >= operationDeadline) {
        if (!controller.signal.aborted) controller.abort();
        throw providerTimeout();
      }
      const { done, value } = await reader.read();
      if (controller.signal.aborted || Date.now() >= operationDeadline) {
        if (!controller.signal.aborted) controller.abort();
        throw providerTimeout();
      }
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("ARC1_ASSET_INVALID: response body");
      total += value.byteLength;
      if (total > expectedSize) {
        try { await reader.cancel(); } catch {}
        throw new Error("ARC1_ASSET_INVALID: response exceeds immutable size");
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    controller.signal.removeEventListener("abort", cancelOnAbort);
    try { reader.releaseLock(); } catch {}
  }
  if (total !== expectedSize) throw new Error("ARC1_ASSET_INVALID: response size mismatch");
  return Buffer.concat(chunks, total);
};
// Validate metadata at the private retrieval boundary, before this step can
// sign a receipt that a durable ingress claim or acknowledgement could bind.
// The public publisher repeats the same checks as defense in depth.
const rejectEmbeddedMetadata = (bytes, contentType) => {
  if (contentType === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error("ARC1_ASSET_INVALID: malformed JPEG");
    let offset = 2;
    while (offset < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 255) offset += 1;
      if (offset >= bytes.length) break;
      while (offset < bytes.length && bytes[offset] === 255) offset += 1;
      if (offset >= bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed JPEG marker");
      const marker = bytes[offset++];
      if (marker === 217) {
        if (offset !== bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed JPEG end marker");
        return;
      }
      if (marker === 0 || marker === 1 || marker === 216 || (marker >= 208 && marker <= 215)) {
        throw new Error("ARC1_ASSET_INVALID: malformed JPEG marker order");
      }
      if (offset + 2 > bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed JPEG segment");
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed JPEG segment");
      const data = bytes.subarray(offset + 2, offset + length);
      if (marker === 218) {
        let scanOffset = offset + length;
        while (scanOffset < bytes.length) {
          if (bytes[scanOffset] !== 255) { scanOffset += 1; continue; }
          let markerOffset = scanOffset + 1;
          while (markerOffset < bytes.length && bytes[markerOffset] === 255) markerOffset += 1;
          if (markerOffset >= bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed JPEG entropy");
          const scanMarker = bytes[markerOffset];
          if (scanMarker === 0) { scanOffset = markerOffset + 1; continue; }
          if (scanMarker >= 208 && scanMarker <= 215) { scanOffset = markerOffset + 1; continue; }
          if (scanMarker === 217 && markerOffset + 1 === bytes.length) return;
          throw new Error("ARC1_ASSET_INVALID: embedded JPEG metadata or multiple scans are not allowed");
        }
        throw new Error("ARC1_ASSET_INVALID: missing JPEG end marker");
      }
      if (marker === 254) throw new Error("ARC1_ASSET_INVALID: embedded JPEG metadata is not allowed");
      if (marker >= 224 && marker <= 239) {
        const jfif = marker === 224 && data.length >= 14 && data.subarray(0, 5).toString("latin1") === "JFIF\0" &&
          data[5] === 1 && data.length === 14 + (3 * data[12] * data[13]);
        const adobe = marker === 238 && data.length === 12 && data.subarray(0, 5).toString("latin1") === "Adobe";
        if (!jfif && !adobe) throw new Error("ARC1_ASSET_INVALID: embedded JPEG metadata is not allowed");
      }
      offset += length;
    }
    throw new Error("ARC1_ASSET_INVALID: malformed JPEG container");
  }
  if (contentType === "image/png") {
    if (bytes.length < 20 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      throw new Error("ARC1_ASSET_INVALID: malformed PNG");
    }
    const forbidden = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "iCCP", "tIME"]);
    const allowed = new Set(["IHDR", "PLTE", "IDAT", "IEND", "cHRM", "gAMA", "sBIT", "sRGB", "bKGD", "hIST", "tRNS", "pHYs"]);
    let offset = 8, ended = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed PNG chunk");
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      const next = offset + 12 + length;
      if (!/^[A-Za-z]{4}$/.test(type) || next > bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed PNG chunk");
      if (forbidden.has(type)) throw new Error("ARC1_ASSET_INVALID: embedded PNG metadata is not allowed");
      if (!allowed.has(type)) {
        if (/^[a-z]/.test(type)) throw new Error("ARC1_ASSET_INVALID: embedded PNG metadata is not allowed");
        throw new Error("ARC1_ASSET_INVALID: unsupported critical PNG chunk");
      }
      offset = next;
      if (type === "IEND") { ended = true; break; }
    }
    if (!ended || offset !== bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed PNG container");
    return;
  }
  if (contentType === "image/webp") {
    if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
        bytes.subarray(8, 12).toString("ascii") !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) {
      throw new Error("ARC1_ASSET_INVALID: malformed WebP");
    }
    const forbidden = new Set(["EXIF", "XMP ", "ICCP"]);
    const allowed = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
    let offset = 12;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed WebP chunk");
      const type = bytes.subarray(offset, offset + 4).toString("ascii");
      const length = bytes.readUInt32LE(offset + 4);
      const next = offset + 8 + length + (length & 1);
      if (next > bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed WebP chunk");
      if (forbidden.has(type) || !allowed.has(type)) throw new Error("ARC1_ASSET_INVALID: embedded WebP metadata is not allowed");
      offset = next;
    }
    if (offset !== bytes.length) throw new Error("ARC1_ASSET_INVALID: malformed WebP container");
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
const roleOrder = ["hero_image_file", "logo_file", "supporting_image_file"];
const payloads = [];
let previousRole = -1;
let totalBytes = 0;
for (const grant of grants) {
  if (!exactKeys(grant, ["asset_id", "content_type", "kind", "retrieval_endpoint_sha256", "role", "schema", "sha256", "size"]) ||
      grant.schema !== "arc-intake-private-asset-grant-v1" || !sha(grant.asset_id) || !sha(grant.sha256) ||
      grant.retrieval_endpoint_sha256 !== endpointSha256 || grant.kind !== "UPLOAD" ||
      roleOrder.indexOf(grant.role) <= previousRole || !Number.isSafeInteger(grant.size) || grant.size < 1 || grant.size > 1250000 ||
      !["image/png", "image/jpeg", "image/webp"].includes(grant.content_type)) {
    throw new Error("ARC1_ASSET_INVALID: grant fields");
  }
  previousRole = roleOrder.indexOf(grant.role);
  totalBytes += grant.size;
  if (totalBytes > 3020000) throw new Error("ARC1_ASSET_INVALID: aggregate size");
  const requestBody = canonicalJson({
    schema: "arc-intake-private-asset-request-v1", asset_id: grant.asset_id,
    delivery_id: deliveryId, evidence_sha256: evidenceSha256
  });
  const remaining = operationDeadline - Date.now();
  if (remaining <= 0) throw providerTimeout();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(10000, remaining)));
  let bytes;
  try {
    const response = await fetch(endpoint.toString(), {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json; charset=utf-8" },
      body: requestBody
    });
    if (controller.signal.aborted || Date.now() >= operationDeadline) throw providerTimeout();
    const declared = response.headers?.get?.("content-length");
    if (!response || response.status !== 200 || response.url !== endpoint.toString() ||
        (declared && (!/^\d{1,8}$/.test(declared) || Number(declared) !== grant.size)) ||
        clean(response.headers?.get?.("content-type")).toLowerCase() !== grant.content_type ||
        clean(response.headers?.get?.("x-arc-asset-id")) !== grant.asset_id ||
        clean(response.headers?.get?.("x-arc-asset-kind")) !== grant.kind ||
        clean(response.headers?.get?.("x-arc-asset-role")) !== grant.role ||
        clean(response.headers?.get?.("x-arc-asset-sha256")) !== grant.sha256) {
      throw new Error("ARC1_ASSET_INVALID: retrieval response binding");
    }
    bytes = await readBounded(response, grant.size, controller);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") throw providerTimeout();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (await sha256Bytes(bytes) !== grant.sha256) throw new Error("ARC1_ASSET_INVALID: digest mismatch");
  const magic = grant.content_type === "image/png" ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
    grant.content_type === "image/jpeg" ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!magic) throw new Error("ARC1_ASSET_INVALID: media signature");
  rejectEmbeddedMetadata(bytes, grant.content_type);
  validateImageStructure(bytes, grant.content_type, "ARC1_ASSET_INVALID");
  payloads.push({ asset_id: grant.asset_id, kind: grant.kind, role: grant.role, content_type: grant.content_type,
    size_bytes: grant.size, sha256: grant.sha256, content_base64: bytes.toString("base64") });
}
const assetManifest = grants.map(grant => ({ asset_id: grant.asset_id, kind: grant.kind, role: grant.role,
  content_type: grant.content_type, size_bytes: grant.size, sha256: grant.sha256,
  retrieval_endpoint_sha256: grant.retrieval_endpoint_sha256 }));
const assetManifestSha256 = await sha256Text(canonicalJson(assetManifest));
const receipt = {
  version: "arc1-private-asset-receipt-v1",
  scope: "authenticated-content-addressed-intake-assets",
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  delivery_id: deliveryId,
  bridge_evidence_sha256: evidenceSha256,
  retrieval_endpoint_sha256: endpointSha256,
  asset_manifest_sha256: assetManifestSha256,
  asset_count: assetManifest.length,
  total_asset_bytes: totalBytes,
  status: "VERIFIED"
};
const receiptRaw = canonicalJson(receipt);
const receiptKey = await globalThis.crypto.subtle.importKey("raw", encoder.encode(receiptSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const receiptHmac = bytesToHex(await globalThis.crypto.subtle.sign("HMAC", receiptKey,
  encoder.encode(`arc1-private-asset-receipt-signature-v1\n${receiptRaw}`)));
return {
  status: "ARC1_PRIVATE_ASSETS_VERIFIED",
  acknowledgement_allowed_by_this_step: false,
  asset_payloads_private_json: canonicalJson(payloads),
  asset_manifest: assetManifest,
  asset_manifest_sha256: assetManifestSha256,
  total_asset_bytes: totalBytes,
  asset_receipt_private: receiptRaw,
  asset_receipt_hmac_sha256: receiptHmac,
  asset_receipt_sha256: await sha256Text(receiptRaw)
};
