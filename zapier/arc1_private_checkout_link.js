// RETIRED: V11 creates approval-bound private Checkout Sessions only through
// arc-site /api/review/checkout. Static legacy compatibility evidence remains
// in receipt-v1-clean-cutover.json; this Zapier step can never execute it.
throw new Error("ARC1_LEGACY_PAYMENT_LINK_RETIRED: use the V11 private Checkout Session flow");
