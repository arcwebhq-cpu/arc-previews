// Regression sentinel kept outside zapier/: direct-to-main delivery publishing
// is permanently disabled. Production delivery must pass signed live-staging
// evidence, a draft PR, the named CI check, merge-byte verification, and the
// dedicated delivery-email gate.
throw new Error("ARC_DELIVERY_PR_REQUIRED: direct-main publisher is disabled; use the ARC2 delivery PR gates");
