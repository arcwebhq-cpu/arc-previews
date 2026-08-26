// ARC1 acknowledgement producer. Run only after the verifier output has been
// bound to a durable create-only private ingress claim. The result is the exact
// body for Zapier's Respond to Webhook step.
const clean = value => String(value == null ? "" : value).trim();
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") throw new Error("ARC1_ACK_CRYPTO_UNAVAILABLE");
const encoder = new TextEncoder();
const bytesToHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ARC1_ACK_INVALID: non-finite value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC1_ACK_INVALID: plain JSON required");
};
const sha = value => /^[a-f0-9]{64}$/.test(clean(value));
const iso = value => {
  const text = clean(value), ms = Date.parse(text);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== text) throw new Error("ARC1_ACK_INVALID: timestamp");
  return { text, ms };
};
const secret = String(inputData.arc1_ack_secret == null ? "" : inputData.arc1_ack_secret);
if (encoder.encode(secret).length < 32 || encoder.encode(secret).length > 256) throw new Error("ARC1_ACK_INVALID: ack secret length");
const assetReceiptSecret = String(inputData.asset_receipt_secret == null ? "" : inputData.asset_receipt_secret);
if (encoder.encode(assetReceiptSecret).length < 32 || encoder.encode(assetReceiptSecret).length > 256 || assetReceiptSecret === secret) {
  throw new Error("ARC1_ACK_INVALID: asset receipt secret");
}
const BRIDGE_CONTRACT_SHA256 = "c4ab396bf04464629624dd19a37602755c8d429db0bf729b49bbfdfdba3ae20c";
const deliveryId = clean(inputData.bridge_delivery_id).toLowerCase();
const bridgeEvidenceSha256 = clean(inputData.bridge_evidence_sha256).toLowerCase();
const ingressStateKey = clean(inputData.ingress_state_key);
const ingressStateDigest = clean(inputData.ingress_state_digest_sha256).toLowerCase();
const claimCreated = iso(inputData.ingress_claim_created_at);
const evidenceExpires = iso(inputData.bridge_evidence_expires_at);
const nowMs = Date.now();
if (!sha(deliveryId) || !sha(bridgeEvidenceSha256) || !sha(ingressStateDigest) ||
    clean(inputData.bridge_contract_sha256) !== BRIDGE_CONTRACT_SHA256 ||
    clean(inputData.consumer_schema) !== "arc1-function-intake-adapter-v1" ||
    !/^arc1-function-ingress-v1:[a-f0-9]{64}$/.test(ingressStateKey) ||
    ingressStateKey !== `arc1-function-ingress-v1:${ingressStateDigest}` ||
    !["CREATED", "EXACT_REPLAY"].includes(clean(inputData.ingress_claim_mode)) ||
    clean(inputData.ingress_claim_status) !== "CLAIMED" ||
    clean(inputData.ingress_claim_state_key) !== ingressStateKey ||
    clean(inputData.ingress_claim_state_digest_sha256).toLowerCase() !== ingressStateDigest ||
    clean(inputData.ingress_claim_bridge_delivery_id).toLowerCase() !== deliveryId ||
    clean(inputData.ingress_claim_bridge_evidence_sha256).toLowerCase() !== bridgeEvidenceSha256 ||
    claimCreated.ms > nowMs + 60_000 || claimCreated.ms < nowMs - 24 * 60 * 60 * 1000 || evidenceExpires.ms <= nowMs) {
  throw new Error("ARC1_ACK_INVALID: exact durable ingress claim required");
}
const assetReceiptRaw = clean(inputData.asset_receipt_private);
let assetReceipt;
try { assetReceipt = JSON.parse(assetReceiptRaw); } catch { throw new Error("ARC1_ACK_INVALID: asset receipt JSON"); }
const assetReceiptFields = ["asset_count", "asset_manifest_sha256", "bridge_contract_sha256", "bridge_evidence_sha256",
  "delivery_id", "retrieval_endpoint_sha256", "scope", "status", "total_asset_bytes", "version"];
if (!assetReceipt || typeof assetReceipt !== "object" || Array.isArray(assetReceipt) ||
    canonicalJson(assetReceipt) !== assetReceiptRaw || JSON.stringify(Object.keys(assetReceipt).sort()) !== JSON.stringify(assetReceiptFields.slice().sort()) ||
    assetReceipt.version !== "arc1-private-asset-receipt-v1" || assetReceipt.scope !== "authenticated-content-addressed-intake-assets" ||
    assetReceipt.status !== "VERIFIED" || assetReceipt.bridge_contract_sha256 !== BRIDGE_CONTRACT_SHA256 ||
    assetReceipt.delivery_id !== deliveryId || assetReceipt.bridge_evidence_sha256 !== bridgeEvidenceSha256 ||
    !sha(assetReceipt.asset_manifest_sha256) || !sha(assetReceipt.retrieval_endpoint_sha256) ||
    !Number.isSafeInteger(assetReceipt.asset_count) || assetReceipt.asset_count < 0 || assetReceipt.asset_count > 4 ||
    !Number.isSafeInteger(assetReceipt.total_asset_bytes) || assetReceipt.total_asset_bytes < 0 || assetReceipt.total_asset_bytes > 3020000) {
  throw new Error("ARC1_ACK_INVALID: exact asset receipt required");
}
const receiptKey = await globalThis.crypto.subtle.importKey("raw", encoder.encode(assetReceiptSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
const receiptSignature = clean(inputData.asset_receipt_hmac_sha256).toLowerCase();
const receiptSignatureBytes = /^[a-f0-9]{64}$/.test(receiptSignature) ?
  Uint8Array.from(receiptSignature.match(/../g), byte => Number.parseInt(byte, 16)) : new Uint8Array();
if (receiptSignatureBytes.length !== 32 || !(await globalThis.crypto.subtle.verify("HMAC", receiptKey, receiptSignatureBytes,
  encoder.encode(`arc1-private-asset-receipt-signature-v1\n${assetReceiptRaw}`)))) {
  throw new Error("ARC1_ACK_INVALID: asset receipt signature");
}
const assetReceiptSha256 = await bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(assetReceiptRaw)));
if (clean(inputData.ingress_claim_asset_receipt_sha256).toLowerCase() !== assetReceiptSha256) {
  throw new Error("ARC1_ACK_INVALID: asset receipt is not bound to durable ingress claim");
}
const key = await globalThis.crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const hmacHex = async value => bytesToHex(await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(value)));
const consumerClaimKeyHmac = await hmacHex(`arc1-function-intake-consumer-claim-v1\n${ingressStateKey}`);
const ackIdentity = await hmacHex(`arc1-function-intake-ack-id-v1\n${deliveryId}\n${bridgeEvidenceSha256}\n${assetReceiptSha256}`);
const acknowledgement = {
  schema: "arc-intake-arc1-consumer-ack-v1",
  version: 1,
  status: "ACCEPTED",
  consumer_schema: "arc1-function-intake-adapter-v1",
  bridge_contract_sha256: BRIDGE_CONTRACT_SHA256,
  delivery_id: deliveryId,
  evidence_sha256: bridgeEvidenceSha256,
  asset_receipt_sha256: assetReceiptSha256,
  consumer_claim_key_hmac_sha256: consumerClaimKeyHmac,
  ack_id: `arc1ack_${ackIdentity.slice(0, 40)}`,
  received_at: clean(inputData.bridge_evidence_issued_at)
};
const acknowledgementRaw = canonicalJson(acknowledgement);
const acknowledgementHmac = await hmacHex(`arc-intake-arc1-consumer-ack-v1\n${acknowledgementRaw}`);
const responseBody = canonicalJson({ acknowledgement, hmac_sha256: acknowledgementHmac });
return {
  status: "ARC1_FUNCTION_INTAKE_ACK_READY",
  acknowledgement_allowed_by_this_step: true,
  acknowledgement_json: responseBody,
  acknowledgement_hmac_sha256: acknowledgementHmac,
  acknowledgement_id_sha256: await bytesToHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(acknowledgement.ack_id))),
  bridge_delivery_id: deliveryId,
  bridge_evidence_sha256: bridgeEvidenceSha256,
  asset_receipt_sha256: assetReceiptSha256,
  consumer_claim_key_hmac_sha256: consumerClaimKeyHmac
};
