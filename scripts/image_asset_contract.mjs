const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_WIDTH = 12_000;
const MAX_IMAGE_HEIGHT = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const STOCK_PREVIEW_HOSTS = Object.freeze([
  "123rf.com",
  "alamy.com",
  "bigstockphoto.com",
  "depositphotos.com",
  "dreamstime.com",
  "freepik.com",
  "gettyimages.com",
  "istockphoto.com",
  "shutterstock.com",
  "stock.adobe.com",
  "vecteezy.com"
]);
const WATERMARK_MARKER_PATTERN = /(?:^|[^a-z0-9])(?:123rf|alamy|bigstock|depositphotos|dreamstime|freepik|getty(?:images)?|istock(?:photo)?|shutterstock|stock[ _-]?preview|vecteezy|watermark(?:ed)?)(?:[^a-z0-9]|$)/i;

export const IMAGE_VISUAL_REVIEW_VERSION = "arc-customer-image-visual-review-v1";
export const IMAGE_VISUAL_REVIEW_SCOPE = "human-visible-watermark-and-rights-review";
export const IMAGE_AUTOMATED_SCREENING_VERSION = "arc-deterministic-image-screen-v1";

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  return current >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function asBuffer(value, invalid) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  invalid("asset bytes must be a Buffer or Uint8Array");
}

function assertDimensions(width, height, invalid) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_WIDTH ||
    height > MAX_IMAGE_HEIGHT ||
    width * height > MAX_IMAGE_PIXELS
  ) invalid("invalid image dimensions");
}

function exactKeys(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function stockPreviewHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return STOCK_PREVIEW_HOSTS.some(blocked => host === blocked || host.endsWith(`.${blocked}`));
}

function safeSourceFilename(url, contentType, invalid) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { invalid("source filename encoding is invalid"); }
  if (/%[0-9a-f]{2}/i.test(pathname) || /[\u0000-\u001f\u007f]/.test(pathname)) {
    invalid("source filename encoding is invalid");
  }
  const filename = pathname.split("/").filter(Boolean).at(-1) || "";
  if (!filename || filename.length > 180 || WATERMARK_MARKER_PATTERN.test(filename.normalize("NFKC"))) {
    invalid("source filename contains a stock-preview or watermark marker");
  }
  let sourceMetadata;
  try { sourceMetadata = decodeURIComponent(url.search); } catch { invalid("source URL metadata encoding is invalid"); }
  if (/[\u0000-\u001f\u007f]/.test(sourceMetadata) || WATERMARK_MARKER_PATTERN.test(sourceMetadata.normalize("NFKC"))) {
    invalid("source URL metadata contains a stock-preview or watermark marker");
  }
  const extension = filename.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] || "";
  const expected = contentType === "image/png" ? new Set(["png"])
    : contentType === "image/jpeg" ? new Set(["jpg", "jpeg"])
      : new Set(["webp"]);
  if (extension && !expected.has(extension)) invalid("source filename extension does not match image content type");
}

export function assertSafeImageSource(sourceUrl, contentType, label = "image source") {
  const invalid = detail => { throw new Error(`ARC_IMAGE_SOURCE_INVALID: ${String(label || "image source")}: ${detail}`); };
  if (typeof sourceUrl !== "string" || sourceUrl !== sourceUrl.trim()) invalid("source URL is invalid");
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { invalid("source URL is invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash || parsed.toString() !== sourceUrl) {
    invalid("source URL must be an exact public HTTPS URL");
  }
  if (stockPreviewHost(parsed.hostname)) invalid("stock-preview source hosts are forbidden");
  safeSourceFilename(parsed, contentType, invalid);
  return true;
}

export function assertHumanImageReview(review, assets, label = "customer image review") {
  const invalid = detail => { throw new Error(`ARC_IMAGE_REVIEW_REQUIRED: ${String(label || "customer image review")}: ${detail}`); };
  if (!Array.isArray(assets)) invalid("asset set is invalid");
  if (!assets.length) {
    if (review !== undefined && review !== null) invalid("review must be absent when there are no customer images");
    return true;
  }
  const fields = ["assets", "automated_screening", "automated_screening_version", "decision", "filename_screening",
    "pixel_level_watermark_certainty", "policy_version", "review_method", "review_validity", "reviewed_at", "reviewer_id_sha256",
    "reviewer_type", "rights_basis", "scope", "source_host_screening", "stock_preview_screening", "version",
    "visible_watermark_screening", "watermark_free_guarantee"];
  if (!exactKeys(review, fields) || review.version !== IMAGE_VISUAL_REVIEW_VERSION || review.scope !== IMAGE_VISUAL_REVIEW_SCOPE ||
      review.decision !== "APPROVED_FOR_PUBLICATION" || review.reviewer_type !== "AUTHORIZED_HUMAN" ||
      review.policy_version !== "arc-image-provenance-policy-v1" || review.review_method !== "HUMAN_VISUAL_INSPECTION_FULL_RESOLUTION" ||
      review.review_validity !== "CONTENT_DIGEST_BOUND_NO_EXPIRY" || !/^[a-f0-9]{64}$/.test(review.reviewer_id_sha256) ||
      review.automated_screening !== "PASSED_DETERMINISTIC_INDICATORS_ONLY" ||
      review.automated_screening_version !== IMAGE_AUTOMATED_SCREENING_VERSION ||
      review.rights_basis !== "CUSTOMER_CONFIRMED_OWNERSHIP_OR_LICENSE" ||
      review.filename_screening !== "PASSED_OR_UNAVAILABLE_FROM_FIRST_PARTY_INTAKE" ||
      review.source_host_screening !== "HTTPS_SYNTAX_AND_STOCK_HOST_DENYLIST_SCREENED" ||
      review.visible_watermark_screening !== "NO_VISIBLE_WATERMARK_FOUND" ||
      review.stock_preview_screening !== "NO_VISIBLE_STOCK_PREVIEW_MARKER_FOUND" ||
      review.pixel_level_watermark_certainty !== false || review.watermark_free_guarantee !== false ||
      typeof review.reviewed_at !== "string" || !Number.isFinite(Date.parse(review.reviewed_at)) ||
      new Date(Date.parse(review.reviewed_at)).toISOString() !== review.reviewed_at || !Array.isArray(review.assets)) {
    invalid("an exact authorized-human approval is required");
  }
  const expected = assets.map(asset => ({ content_type: asset.contentType, path: asset.path, sha256: asset.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (review.assets.some(item => !exactKeys(item, ["content_type", "path", "sha256"])) ||
      JSON.stringify(review.assets) !== JSON.stringify(expected)) {
    invalid("reviewed assets do not match the exact content-addressed asset set");
  }
  return true;
}

function assertJpeg(bytes, invalid) {
  if (bytes.length < 30 || bytes[0] !== 255 || bytes[1] !== 216) invalid("malformed JPEG");
  let offset = 2;
  let sawFrame = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 255) invalid("JPEG marker alignment");
    while (offset < bytes.length && bytes[offset] === 255) offset += 1;
    if (offset >= bytes.length) invalid("truncated JPEG marker");
    const marker = bytes[offset++];
    if (marker === 0 || marker === 1 || marker === 216 || marker === 217 || (marker >= 208 && marker <= 215)) {
      invalid("malformed JPEG marker order");
    }
    if (offset + 2 > bytes.length) invalid("truncated JPEG segment");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalid("malformed JPEG segment");
    const data = bytes.subarray(offset + 2, offset + length);

    if (marker === 254) invalid("embedded JPEG metadata is not allowed");
    if (marker >= 224 && marker <= 239) {
      const jfif = marker === 224 && data.length >= 14 &&
        data.subarray(0, 5).toString("latin1") === "JFIF\0" &&
        data[5] === 1 && data.length === 14 + (3 * data[12] * data[13]);
      const adobe = marker === 238 && data.length === 12 && data.subarray(0, 5).toString("latin1") === "Adobe";
      if (!jfif && !adobe) invalid("embedded JPEG metadata is not allowed");
    }

    if (marker === 192) {
      const components = data[5];
      if (sawFrame || data.length < 9 || data[0] !== 8 || components < 1 || components > 4 || length !== 8 + 3 * components) {
        invalid("unsupported JPEG frame");
      }
      assertDimensions(data.readUInt16BE(3), data.readUInt16BE(1), invalid);
      sawFrame = true;
    } else if (marker >= 193 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      invalid("unsupported JPEG frame");
    }

    if (marker === 218) {
      const components = data[0];
      if (!sawFrame || components < 1 || components > 4 || length !== 6 + 2 * components) invalid("invalid JPEG scan");
      let scan = offset + length;
      let entropyBytes = 0;
      while (scan < bytes.length) {
        if (bytes[scan] !== 255) {
          entropyBytes += 1;
          scan += 1;
          continue;
        }
        let markerOffset = scan + 1;
        while (markerOffset < bytes.length && bytes[markerOffset] === 255) markerOffset += 1;
        if (markerOffset >= bytes.length) invalid("truncated JPEG entropy");
        const scanMarker = bytes[markerOffset];
        if (scanMarker === 0) {
          entropyBytes += 1;
          scan = markerOffset + 1;
          continue;
        }
        if (scanMarker >= 208 && scanMarker <= 215) {
          scan = markerOffset + 1;
          continue;
        }
        if (scanMarker === 217 && markerOffset + 1 === bytes.length && entropyBytes > 0) return;
        invalid("invalid JPEG entropy, metadata, or multiple scans");
      }
      invalid("missing JPEG end marker");
    }
    offset += length;
  }
  invalid("missing JPEG scan");
}

function assertPng(bytes, invalid) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalid("malformed PNG");
  const forbidden = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "iCCP", "tIME"]);
  const allowed = new Set(["IHDR", "PLTE", "IDAT", "IEND", "cHRM", "gAMA", "sBIT", "sRGB", "bKGD", "hIST", "tRNS", "pHYs"]);
  let offset = 8;
  let index = 0;
  let sawData = false;
  let dataEnded = false;
  let dataBytes = 0;
  let color = -1;
  let palette = false;

  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid("truncated PNG chunk");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const next = crcOffset + 4;
    if (!/^[A-Za-z]{4}$/.test(type) || next > bytes.length) invalid("malformed PNG chunk");
    if (crc32(bytes.subarray(offset + 4, crcOffset)) !== bytes.readUInt32BE(crcOffset)) invalid("PNG CRC mismatch");
    if (forbidden.has(type) || (!allowed.has(type) && /^[a-z]/.test(type))) invalid("embedded PNG metadata is not allowed");
    if (!allowed.has(type)) invalid("unsupported critical PNG chunk");
    const data = bytes.subarray(dataStart, crcOffset);

    if (type === "IHDR") {
      const legalDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      color = data[9];
      if (
        index !== 0 || length !== 13 || !legalDepths[color]?.includes(data[8]) ||
        data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])
      ) invalid("invalid PNG IHDR");
      assertDimensions(data.readUInt32BE(0), data.readUInt32BE(4), invalid);
    } else if (index === 0) invalid("PNG IHDR must be first");

    if (type === "PLTE") {
      if (sawData || palette || length < 3 || length > 768 || length % 3) invalid("invalid PNG palette");
      palette = true;
    } else if (type === "IDAT") {
      if (dataEnded || length < 1) invalid("invalid PNG IDAT");
      sawData = true;
      dataBytes += length;
    } else if (sawData && type !== "IEND") {
      dataEnded = true;
    }

    if (type === "IEND") {
      if (!sawData || dataBytes < 2 || length !== 0 || next !== bytes.length || (color === 3 && !palette)) {
        invalid("incomplete PNG image data");
      }
      return;
    }
    offset = next;
    index += 1;
  }
  invalid("missing PNG end");
}

function assertWebp(bytes, invalid) {
  if (
    bytes.length < 25 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) invalid("malformed WebP");
  const allowed = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);
  const forbidden = new Set(["EXIF", "XMP ", "ICCP"]);
  let offset = 12;
  let first = true;
  let extended = false;
  let primary = false;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid("truncated WebP chunk");
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const next = start + length + (length & 1);
    if (next > bytes.length) invalid("malformed WebP chunk");
    if (type === "ANIM" || type === "ANMF") invalid("animated WebP is not allowed");
    if (forbidden.has(type) || !allowed.has(type)) invalid("embedded WebP metadata is not allowed");
    if ((length & 1) && bytes[next - 1] !== 0) invalid("invalid WebP padding");
    const data = bytes.subarray(start, start + length);

    if (type === "VP8X") {
      if (!first || extended || length !== 10 || (data[0] & 193)) invalid("invalid WebP VP8X");
      if (data[0] & 2) invalid("animated WebP is not allowed");
      extended = true;
      assertDimensions(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3), invalid);
    } else if (type === "VP8 ") {
      if (primary || length < 10 || data[3] !== 157 || data[4] !== 1 || data[5] !== 42) invalid("invalid WebP VP8");
      assertDimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff, invalid);
      primary = true;
    } else if (type === "VP8L") {
      if (primary || length < 5 || data[0] !== 47 || (data[4] & 224)) invalid("invalid WebP VP8L");
      const bits = data.readUInt32LE(1);
      assertDimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff), invalid);
      primary = true;
    } else if (type === "ALPH" && (!extended || primary || length < 1)) {
      invalid("invalid WebP alpha");
    }
    offset = next;
    first = false;
  }
  if (offset !== bytes.length || !primary) invalid("missing WebP image payload");
}

export function assertSafeImageAsset(value, contentType, label = "image asset") {
  const normalizedLabel = String(label || "image asset");
  const invalid = detail => {
    throw new Error(`ARC_IMAGE_ASSET_INVALID: ${normalizedLabel}: ${detail}`);
  };
  if (!CONTENT_TYPES.has(contentType)) invalid("unsupported image content type");
  const bytes = asBuffer(value, invalid);
  if (/<(?:script|svg|html|iframe|object|embed)\b|javascript\s*:/i.test(bytes.toString("latin1"))) {
    invalid("active-content or polyglot signature detected");
  }
  if (WATERMARK_MARKER_PATTERN.test(bytes.toString("latin1"))) {
    invalid("deterministic stock-preview or watermark marker detected");
  }
  if (contentType === "image/jpeg") assertJpeg(bytes, invalid);
  else if (contentType === "image/png") assertPng(bytes, invalid);
  else assertWebp(bytes, invalid);
  return true;
}
