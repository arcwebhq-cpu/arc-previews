# Frozen receipt-v1 clean cutover

This document freezes the clean cutover described by
`zapier/receipt-v1-clean-cutover.json`. It is not a backward-compatibility
promise and it does not authorize live provider activity.

The cutover is valid only for the recorded operational inventory of zero
customer image-publication receipts, zero live private Payment Link receipts,
zero in-flight jobs for either protocol, and zero pending Function intake
evidence or submissions. That inventory is an operator declaration, not
cryptographic proof, and the external provider zero-state has not been
verified. If any contrary receipt, evidence, submission, or queued job is
found, activation must stop until it is discarded or regenerated under the
current contracts.

For `arc1-public-asset-publication-receipt-v1`, there is no dual reader. The
old `VERIFIED_CONTENT_ADDRESSED` meaning and the old `Confirmed` permission
literal fail closed. The current receipt requires
`HUMAN_REVIEWED_CONTENT_ADDRESSED`, the exact `Confirmed rights and no visible
watermark v1` permission, a true default-off review-authority gate, the review
key ID, the configured reviewer digest, and the digest of the signed review.
Legacy `arc1-intake-evidence-v1` is non-activatable at the injector.
The intake bridge is cleanly pinned to
`arc-intake-to-arc1-contract-v2` / `da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2`;
the prior bridge digest is not accepted. Animated WebP is rejected because a
single full-resolution visual inspection cannot cover later frames.

For `arc-private-checkout-link-receipt-v1`, there is also no dual reader. The
current authenticated readback digest includes the Product tax code and the
receipt carries `readback_contract: product-tax-code-bound-v1`. A receipt
without that marker is pre-cutover and fails closed, even if it has a valid
old HMAC.

For `arc2-payment-evidence-v4`, the current exact audit shape requires both
`taxability_reasons` and `line_item_taxes_sha256`. Old signed V4 evidence that
omits either field fails closed and must be regenerated; the V4 name does not
imply dual-read compatibility across this zero-live clean cutover.

Deploy each changed producer with every exact-key consumer atomically. Drain
or discard pre-cutover queues, regenerate both receipt types, and rerun the
disabled synthetic checks before considering activation. Rollback must not
restore acceptance of either old receipt meaning or the old Payment Evidence
V4 audit shape.

An operator-set flag, reviewer digest, key ID, or valid HMAC does not
cryptographically prove that a human inspected the pixels. That assurance
requires independently verified provider authority plus controlled reviewer
identity, secret, and key custody. Those capabilities remain unverified and
off. Code by Zapier Input Data is not accepted as secret custody: a verified
private integration or secret broker and verified provider-history redaction
are mandatory gates. Live activation remains prohibited.
