import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc1_preview_review_outbox.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("inputData", source);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha = value => createHash("sha256").update(value).digest("hex");
const hmac = (secret, value) => createHmac("sha256", secret).update(value).digest("hex");

assert.doesNotMatch(source, /\bfetch\s*\(|api\.stripe\.com|buy\.stripe\.com|payment_method_types/i);
await assert.rejects(run({ phase: "PREPARE" }), /prepare gate is off/);
await assert.rejects(run({ phase: "BIND_INVITE" }), /state commit gate is off/);
await assert.rejects(run({ phase: "AUTHORIZE_SEND" }), /transactional email send gate is off/);
await assert.rejects(run({ phase: "ACK_DELIVERY" }), /delivery acknowledgement gate is off/);

const checkoutSecret = "arc-checkout-binding-secret-v2-0123456789abcdef";
const outboxSecret = "arc-preview-email-outbox-secret-v1-0123456789";
const inviteSecret = "arc-review-invite-evidence-secret-v1-0123456789";
const deliverySecret = "arc-email-delivery-evidence-secret-v1-0123456789";
const mode = "test", kid = "01", customerEmail = "customer@example.test", previewFolder = "summit-roofing-a1b2c3d4";
const previewPaths = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"].map(path => `${previewFolder}/${path}`);
const core = canonical({
  version: "arc1-preview-readiness-core-v2", scope: "immutable-five-page-private-checkout-content-and-recipient-readiness",
  repository: "arcwebhq-cpu/arc-previews", preview_folder: previewFolder, preview_paths: previewPaths,
  preview_url: `https://arcwebhq-cpu.github.io/arc-previews/${previewFolder}/`, offer_contract_id: "arc-fixed-five-page-offer-v1",
  deliverable: "fixed-five-page-marketing-website-v1", page_count: 5, approval_content_sha256: "a".repeat(64),
  content_sha256: "b".repeat(64), published_preview_bundle_sha256: "b".repeat(64), published_site_sha256: "c".repeat(64),
  render_bundle_sha256: "d".repeat(64), customer_email_sha256: sha(customerEmail), email_state_token_sha256: "e".repeat(64),
  checkout_offer_snapshot_sha256: "f".repeat(64), checkout_recipient_reservation_sha256: "1".repeat(64),
  asset_publication_receipt_sha256: "2".repeat(64), lead_route_mode: "netlify_form", lead_route_form_name: "summit-lead",
  lead_route_recipient_hmac_sha256: "3".repeat(64), script_manifest_sha256: "1ef7f0088cdcf042b1593fbc11d7ea2d3c47e9ff92c94caf2f578179e3993685",
  head_sha: "4".repeat(40), merge_commit_sha: "5".repeat(40), source_tree_sha: "6".repeat(40), pr_number: 42,
  check_name: "ARC preview quality/preview-quality", check_app_slug: "github-actions", check_app_id: 15368,
  merged_at: "2026-08-27T12:00:00.000Z"
});
const coreSha = sha(core), briefSha = "7".repeat(64), now = Date.now();
const createdAt = new Date(now - 1_000).toISOString(), expiresAt = new Date(now + 60 * 60_000).toISOString();
const common = {
  checkout_binding_key_id: kid, checkout_binding_secret: checkoutSecret, stripe_mode: mode,
  preview_email_outbox_secret: outboxSecret, checkout_readiness_core_private: core, checkout_readiness_core_sha256: coreSha,
  checkout_readiness_core_hmac_sha256: hmac(checkoutSecret, `arc1-preview-readiness-core-signature-v2\n${mode}\n${core}`),
  customer_email: customerEmail, brief_sha256: briefSha, outbox_created_at: createdAt, outbox_expires_at: expiresAt
};

const prepared = await run({ ...common, phase: "PREPARE", preview_review_outbox_prepare_enabled: "true" });
assert.equal(prepared.status, "PREVIEW_REVIEW_OUTBOX_PENDING_PREPARED");
assert.equal(prepared.send_preview_email, false);
assert.equal(prepared.checkout_creation_allowed, false);
assert.equal(prepared.outbox_state_write_required, true);
assert.equal(JSON.parse(prepared.outbox_state_private).status, "PENDING");
assert.equal(JSON.stringify(prepared).includes(customerEmail), false, "PREPARE must expose no raw recipient");
assert.doesNotMatch(JSON.stringify(prepared), /review\/#invite|checkout_url|buy\.stripe\.com/i);
const reused = await run({ ...common, phase: "PREPARE", preview_review_outbox_prepare_enabled: "true", outbox_state_private: prepared.outbox_state_private });
assert.equal(reused.status, "PREVIEW_REVIEW_OUTBOX_PENDING_REUSED");
assert.equal(reused.outbox_state_write_required, false);

const pendingSha = sha(prepared.outbox_state_private), outboxKey = prepared.outbox_record_key_hmac_sha256;
const claimedAt = new Date(now).toISOString(), leaseExpiresAt = new Date(now + 30 * 60_000).toISOString(), claimIdSha = "8".repeat(64);
const claimReceipt = canonical({ version: "arc-preview-review-email-outbox-claim-v1", scope: "atomic-create-or-exact-private-outbox-claim",
  outbox_key_hmac_sha256: outboxKey, pending_state_sha256: pendingSha, claim_id_sha256: claimIdSha,
  provider_record_version: 1, claimed_at: claimedAt, lease_expires_at: leaseExpiresAt });
const claimReceiptHmac = hmac(outboxSecret, `arc-preview-review-email-outbox-claim-signature-v1\n${claimReceipt}`);
const claimedState = canonical({ ...JSON.parse(prepared.outbox_state_private), status: "CLAIMED", claim_id_sha256: claimIdSha,
  claim_receipt_hmac_sha256: claimReceiptHmac, claim_receipt_sha256: sha(claimReceipt), claimed_at: claimedAt, lease_expires_at: leaseExpiresAt });
const reviewUrl = `https://arcweb.onl/review/#invite=${"A".repeat(43)}`, inviteIssuedAt = new Date(now).toISOString(), inviteExpiresAt = new Date(now + 7 * 24 * 60 * 60_000).toISOString();
const inviteEvidence = canonical({ version: "arc-preview-review-invite-evidence-v1", scope: "private-five-page-preview-review-invite",
  outbox_key_hmac_sha256: outboxKey, recipient_email_sha256: sha(customerEmail), readiness_core_sha256: coreSha,
  preview_source_repository: "arcwebhq-cpu/arc-previews", preview_source_commit_sha: "5".repeat(40), preview_manifest_sha256: "b".repeat(64),
  preview_content_sha256: "b".repeat(64), brief_sha256: briefSha, page_count: 5, review_url_sha256: sha(reviewUrl),
  invite_hmac_sha256: "9".repeat(64), issued_at: inviteIssuedAt, expires_at: inviteExpiresAt, revision_round: 0,
  prior_invite_hmac_sha256: null });
const inviteHmac = hmac(inviteSecret, `arc-preview-review-invite-evidence-signature-v1\n${inviteEvidence}`);
const inviteInputs = { outbox_claim_receipt_private: claimReceipt, outbox_claim_receipt_hmac_sha256: claimReceiptHmac,
  private_review_url: reviewUrl, review_invite_evidence_private: inviteEvidence, review_invite_evidence_hmac_sha256: inviteHmac,
  review_invite_evidence_secret: inviteSecret };

await assert.rejects(run({ ...common, ...inviteInputs, phase: "BIND_INVITE", preview_review_outbox_state_commit_enabled: "true",
  outbox_state_private: prepared.outbox_state_private }), /CLAIMED state|required|CONFLICT/);
const bound = await run({ ...common, ...inviteInputs, phase: "BIND_INVITE", preview_review_outbox_state_commit_enabled: "true",
  outbox_state_private: claimedState });
assert.equal(bound.status, "PREVIEW_REVIEW_INVITE_BINDING_PREPARED");
assert.equal(JSON.parse(bound.outbox_state_private).status, "INVITE_BOUND");
assert.equal(bound.send_preview_email, false);
assert.equal(bound.checkout_creation_allowed, false);

const boundSha = sha(bound.outbox_state_private), readbackAt = new Date(now + 500).toISOString();
const readback = canonical({ version: "arc-preview-review-email-outbox-readback-v1", scope: "authoritative-private-outbox-state-readback",
  outbox_key_hmac_sha256: outboxKey, outbox_state_sha256: boundSha, provider_record_version: 2, readback_at: readbackAt, status: "INVITE_BOUND" });
const readbackHmac = hmac(outboxSecret, `arc-preview-review-email-outbox-readback-signature-v1\n${readback}`);
const authorityInputs = { ...inviteInputs, outbox_bound_readback_evidence_private: readback,
  outbox_bound_readback_evidence_hmac_sha256: readbackHmac, outbox_state_private: bound.outbox_state_private };
const authorized = await run({ ...common, ...authorityInputs, phase: "AUTHORIZE_SEND", transactional_email_send_enabled: "true" });
assert.equal(authorized.status, "PREVIEW_REVIEW_EMAIL_SEND_AUTHORIZED");
assert.equal(authorized.send_preview_email, true);
assert.equal(authorized.checkout_creation_allowed, false);
assert.equal(authorized.recipient_email_private, customerEmail);
assert.equal(authorized.private_review_url, reviewUrl);
assert.match(authorized.email_text_body, /approve and pay, or request changes\. No reply needed\./);
assert.match(authorized.email_text_body, /Checkout is created only after approval\./);
assert.doesNotMatch(JSON.stringify(authorized), /buy\.stripe\.com|checkout_url|payment link/i);

const deliveredAt = new Date(now + 2_000).toISOString();
const deliveryEvidence = canonical({ version: "arc-transactional-email-delivery-evidence-v1", scope: "authenticated-provider-delivered-private-review-email",
  outbox_key_hmac_sha256: outboxKey, outbox_state_sha256: boundSha,
  provider_idempotency_key_sha256: authorized.email_provider_idempotency_key_sha256, recipient_email_sha256: sha(customerEmail),
  review_url_sha256: sha(reviewUrl), provider_message_id_sha256: "a".repeat(64), provider_event_id_sha256: "b".repeat(64),
  provider_status: "DELIVERED", delivered_at: deliveredAt });
const deliveryHmac = hmac(deliverySecret, `arc-transactional-email-delivery-evidence-signature-v1\n${deliveryEvidence}`);
const acknowledged = await run({ ...common, ...authorityInputs, phase: "ACK_DELIVERY", transactional_email_delivery_ack_enabled: "true",
  transactional_email_delivery_secret: deliverySecret, transactional_email_delivery_evidence_private: deliveryEvidence,
  transactional_email_delivery_evidence_hmac_sha256: deliveryHmac });
assert.equal(acknowledged.status, "PREVIEW_REVIEW_EMAIL_DELIVERY_ACK_PREPARED");
assert.equal(JSON.parse(acknowledged.outbox_state_private).status, "SENT");
assert.equal(acknowledged.send_preview_email, false);
assert.equal(acknowledged.checkout_creation_allowed, false);
const acknowledgedReplay = await run({ ...common, ...authorityInputs, phase: "ACK_DELIVERY", transactional_email_delivery_ack_enabled: "true",
  outbox_state_private: acknowledged.outbox_state_private, transactional_email_delivery_secret: deliverySecret,
  transactional_email_delivery_evidence_private: deliveryEvidence, transactional_email_delivery_evidence_hmac_sha256: deliveryHmac });
assert.equal(acknowledgedReplay.status, "PREVIEW_REVIEW_EMAIL_DELIVERY_ALREADY_RECORDED");
assert.equal(acknowledgedReplay.outbox_state_write_required, false);

const acceptedOnly = canonical({ ...JSON.parse(deliveryEvidence), provider_status: "ACCEPTED" });
await assert.rejects(run({ ...common, ...authorityInputs, phase: "ACK_DELIVERY", transactional_email_delivery_ack_enabled: "true",
  transactional_email_delivery_secret: deliverySecret, transactional_email_delivery_evidence_private: acceptedOnly,
  transactional_email_delivery_evidence_hmac_sha256: hmac(deliverySecret, `arc-transactional-email-delivery-evidence-signature-v1\n${acceptedOnly}`) }), /delivery evidence binding/);

console.log("ARC1 private-review transactional-email outbox contract passed");
