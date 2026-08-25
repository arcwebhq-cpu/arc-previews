const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_WIDTH = 12_000;
const MAX_IMAGE_HEIGHT = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;

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
  let animated = false;
  let primary = false;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid("truncated WebP chunk");
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const next = start + length + (length & 1);
    if (next > bytes.length) invalid("malformed WebP chunk");
    if (forbidden.has(type) || !allowed.has(type)) invalid("embedded WebP metadata is not allowed");
    if ((length & 1) && bytes[next - 1] !== 0) invalid("invalid WebP padding");
    const data = bytes.subarray(start, start + length);

    if (type === "VP8X") {
      if (!first || extended || length !== 10 || (data[0] & 193)) invalid("invalid WebP VP8X");
      extended = true;
      animated = Boolean(data[0] & 2);
      assertDimensions(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3), invalid);
    } else if (type === "VP8 ") {
      if (primary || animated || length < 10 || data[3] !== 157 || data[4] !== 1 || data[5] !== 42) invalid("invalid WebP VP8");
      assertDimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff, invalid);
      primary = true;
    } else if (type === "VP8L") {
      if (primary || animated || length < 5 || data[0] !== 47 || (data[4] & 224)) invalid("invalid WebP VP8L");
      const bits = data.readUInt32LE(1);
      assertDimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff), invalid);
      primary = true;
    } else if (type === "ANIM") {
      if (!extended || !animated || length !== 6 || primary) invalid("invalid WebP animation");
    } else if (type === "ANMF") {
      if (!extended || !animated || length < 16) invalid("invalid WebP frame");
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
  if (contentType === "image/jpeg") assertJpeg(bytes, invalid);
  else if (contentType === "image/png") assertPng(bytes, invalid);
  else assertWebp(bytes, invalid);
  return true;
}
