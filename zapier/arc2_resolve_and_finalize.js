// Retired ARC2 compatibility surface.
//
// V11 uses arc2_checkout_session_artifact_adapter.js. That adapter consumes a
// leased first-party paid outbox, constructs the exact five-page artifact, and
// delegates payment authentication and handoff to /internal/payment-arc2/start.
// Keeping this filename fail-closed prevents an old Zap revision from silently
// regaining fulfillment authority.
throw new Error("ARC2_RETIRED_RESOLVER: use the default-off V11 Checkout Session artifact adapter");
