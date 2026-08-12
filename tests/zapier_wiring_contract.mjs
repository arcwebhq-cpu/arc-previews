import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contractText = await readFile(new URL("../zapier/wiring-contract.json", import.meta.url), "utf8");
const contract = JSON.parse(contractText);
const arc1IntakeVerifierSource = await readFile(
  new URL("../zapier/arc1_verify_intake_and_assets.js", import.meta.url),
  "utf8"
);
const arc2LeadRouteVerifierSource = await readFile(
  new URL("../zapier/arc2_verify_lead_route_staging.js", import.meta.url),
  "utf8"
);
const arc2CustomerControlVerifierSource = await readFile(
  new URL("../zapier/arc2_verify_customer_control.js", import.meta.url),
  "utf8"
);
await assert.rejects(
  readFile(new URL("../zapier/arc2_publish_delivery.js", import.meta.url), "utf8"),
  error => error?.code === "ENOENT"
);
const directPublisherFixture = await readFile(
  new URL("./fixtures/arc2_publish_delivery_direct_regression.js", import.meta.url),
  "utf8"
);
assert.match(directPublisherFixture, /outside zapier\//);

assert.equal(contract.schema, "arc-zapier-wiring-contract-v1");
assert.equal(contract.live_complete, false);
assert.equal(contract.configuration_state, "local-contract-not-applied");
assert.deepEqual(contract.observed_external_state, {
  zapier_arc1_enabled: false,
  zapier_arc2_enabled: false,
  arc2_allow_test_mode_events: false,
  live_steps_match_this_contract: false,
});

assert.deepEqual(contract.safety, {
  apollo_enabled: false,
  outreach_allowed: false,
  stripe_mode: "test",
  allow_test_mode_events: true,
  allow_live_mode_events: false,
  real_charges_allowed: false,
});

assert.equal(contract.secrets.repository_values_present, false);
assert.equal(contract.secrets.credential_values_present, false);
assert.equal(contract.secrets.runtime_secret_store_required, true);
assert.deepEqual(contract.secrets.required_runtime_names, [
  "STRIPE_TEST_API_KEY",
  "ARC_CHECKOUT_BINDING_SECRET",
  "GITHUB_PREVIEW_SOURCE_READ_TOKEN",
  "GITHUB_DELIVERY_TOKEN",
  "ARC_EMAIL_CLAIM_SECRET",
  "NETLIFY_ACCESS_TOKEN",
  "ARC1_INTAKE_EVIDENCE_SECRET",
  "ARC_LEAD_ROUTE_EVIDENCE_SECRET",
  "ARC_INBOX_RECEIPT_EVIDENCE_SECRET",
  "ARC_CUSTOMER_CONTROL_EVIDENCE_SECRET",
]);
assert.deepEqual(contract.secrets.customer_authorization, {
  source: "external-secure-handoff",
  repository_storage_allowed: false,
  long_lived_shared_token_allowed: false,
  per_customer_short_lived_read_only_authorization_required: true,
  zapier_field_log_redaction_verified: false,
  revocation_after_verification_required: true,
});

assert.deepEqual(contract.arc1.ordered_steps, [
  "zapier/arc1_verify_intake_and_assets.js",
  "private-state/arc1-atomic-intake-claim",
  "zapier/arc1_inject.js",
  "arc_step7_validator.js",
  "zapier/arc1_publish_preview_pr.js",
  "zapier/arc1_merge_preview_pr.js",
  "zapier/arc1_preview_email_gate.js",
]);
assert.equal(contract.arc1.publish_mode, "pull-request-only");
assert.equal(contract.arc1.direct_main_publish_allowed, false);
assert.equal(contract.arc1.ordered_steps.indexOf("zapier/arc1_verify_intake_and_assets.js"), 0);
assert.equal(
  contract.arc1.ordered_steps.indexOf("private-state/arc1-atomic-intake-claim") <
    contract.arc1.ordered_steps.indexOf("zapier/arc1_inject.js"),
  true
);
const intake = contract.arc1.authoritative_intake;
assert.equal(intake.source, "authenticated-netlify-api");
assert.equal(intake.trigger_submission_id_must_resolve_exactly_once, true);
assert.equal(intake.trusted_received_at_source, "submission.created_at");
assert.equal(
  intake.public_folder_prefix_derivation,
  'sha256("arc-preview-folder-v1\\n" + site_id + "\\n" + form_id + "\\n" + submission_id + "\\n" + received_at)[0:8]'
);
assert.equal(intake.client_submission_id_authoritative, false);
assert.equal(intake.client_received_at_authoritative, false);
assert.equal(intake.client_form_started_at_authoritative, false);
assert.equal(intake.client_lead_route_status_authoritative, false);
assert.equal(intake.required_intake_version, "arc-intake-v7");
assert.equal(
  intake.required_budget_confirmation,
  "Yes, understands the finished ARC website is $5,000 only after preview approval"
);
assert.equal(
  intake.required_terms_acceptance,
  "Accepted ARC preview terms, privacy policy, refund policy, and service scope dated 2026-08-11; separate adult checkout acceptance required"
);
assert.equal(intake.maximum_submission_age_seconds, 86400);
assert.equal(intake.maximum_future_clock_skew_seconds, 300);

assert.deepEqual(contract.arc1.asset_validation, {
  before_build_required: true,
  exact_https_origin_allowlist_required: true,
  redirects_allowed: false,
  allowed_content_types: ["image/png", "image/jpeg", "image/webp"],
  magic_byte_and_container_validation_required: true,
  active_content_and_polyglot_rejected: true,
  maximum_file_bytes: 2621440,
  maximum_total_bytes: 7864320,
  per_asset_sha256_private_state_required: true,
  signed_intake_evidence_required_by_injector_and_publisher: true,
});

assert.equal(contract.arc1.private_state.provider, "Zapier Tables");
assert.equal(contract.arc1.private_state.record_key, "state_key");
assert.equal(contract.arc1.private_state.claim_mode, "atomic-create-only-before-build");
assert.equal(contract.arc1.private_state.initial_status, "PENDING");
assert.equal(contract.arc1.private_state.maximum_pending_ttl_hours, 24);
assert.deepEqual(contract.arc1.abuse_controls, {
  per_submission_replay_claim_required: true,
  unique_submission_rate_limit_required_before_build: true,
  authoritative_rate_limit_provider: null,
  maximum_builds_per_rolling_window: null,
  maximum_builds_per_day: null,
  live_configuration_verified: false,
  fail_closed_when_limit_state_is_unavailable: true,
});
assert.deepEqual(contract.arc1.private_state.required_fields, [
  "state_key",
  "state_digest_sha256",
  "intake_evidence_sha256",
  "trusted_netlify_submission_id",
  "trusted_received_at",
  "public_folder_prefix",
  "submission_data_sha256",
  "asset_manifest_sha256",
  "preview_folder",
  "content_sha256",
  "head_sha",
  "pr_number",
  "recipient_sha256",
  "token_sha256",
  "created_at",
  "expires_at",
  "status",
]);
assert.match(arc1IntakeVerifierSource, /inputData\.trigger_submission_id/);
assert.match(arc1IntakeVerifierSource, /https:\/\/api\.netlify\.com\/api\/v1/);
assert.match(arc1IntakeVerifierSource, /Authorization:\s*`Bearer \$\{netlifyToken\}`/);
assert.match(arc1IntakeVerifierSource, /"arc-preview-folder-v1"/);
assert.match(arc1IntakeVerifierSource, /claim_required_before_build:\s*true/);
assert.match(arc1IntakeVerifierSource, /source_url_sha256/);
assert.match(arc1IntakeVerifierSource, /redirect:\s*"manual"/);
assert.doesNotMatch(arc1IntakeVerifierSource, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
for (const clientField of ["lead_route_status", "submission_id", "received_at", "form_started_at"]) {
  assert.doesNotMatch(arc1IntakeVerifierSource, new RegExp(`inputData\\.${clientField}\\b`));
}
assert.equal(contract.arc1.preview_email.allowed_before_gate, false);
for (const [name, required] of Object.entries(contract.arc1.preview_email)) {
  if (name !== "allowed_before_gate") assert.equal(required, true, `ARC1 gate requirement ${name} must fail closed.`);
}

assert.deepEqual(contract.arc2.ordered_steps, [
  "zapier/arc2_resolve_and_finalize.js",
  "netlify/claim-arc-controlled-temporary-site",
  "netlify/deploy-exact-three-file-bundle",
  "netlify/enable-form-detection-and-configure-recipient-hook",
  "browser/submit-synthetic-probe-through-rendered-form",
  "inbox-provider/issue-authoritative-receipt-attestation",
  "zapier/arc2_verify_lead_route_staging.js",
  "zapier/arc2_publish_delivery_pr.js",
  "zapier/arc2_merge_delivery_pr.js",
  "external-secure-handoff/customer-creates-owned-github-repo-and-netlify-site",
  "zapier/arc2_verify_customer_control.js",
  "zapier/arc2_delivery_email_gate.js",
  "email-provider/send-with-durable-idempotency",
  "inbox-provider/issue-customer-delivery-receipt-attestation",
  "netlify/disable-or-delete-temporary-site",
]);
assert.equal(contract.arc2.publish_mode, "pull-request-only");
assert.equal(contract.arc2.direct_main_publish_allowed, false);
assert.deepEqual(contract.arc2.repositories, {
  preview_source: {
    access: "read-only",
    owner: "arcwebhq-cpu",
    repository: "arc-previews",
    contains_paid_delivery_artifacts: false,
  },
  delivery_target: {
    access: "write",
    visibility_required: "private",
    owner: null,
    repository: null,
    must_not_equal_preview_source: true,
    required_ci_workflow_must_already_be_installed: true,
    required_ci_workflow_verified: false,
    github_pages_delivery_allowed: false,
  },
});
assert.deepEqual(contract.arc2.handoff, {
  mode: "external-secure-manual",
  one_click_repository_transfer_claim_allowed: false,
  one_click_deploy_url_allowed: false,
  customer_accounts_must_exist_before_verification: true,
  customer_control_evidence_required_before_email: true,
});
assert.deepEqual(contract.arc2.forbidden_steps, ["zapier/arc2_publish_delivery.js"]);
assert.equal(contract.arc2.ordered_steps.includes("zapier/arc2_publish_delivery.js"), false);
assert.deepEqual(contract.arc2.legacy_direct_publisher, {
  live_script_present: false,
  regression_fixture: "tests/fixtures/arc2_publish_delivery_direct_regression.js",
  copy_to_zapier_forbidden: true,
});

assert.deepEqual(contract.arc2.trigger, {
  event: "checkout.session.completed",
  allow_test_mode_events: true,
  allow_live_mode_events: false,
  trigger_sample_is_authoritative: false,
});
assert.deepEqual(contract.arc2.authoritative_session_retrieval, {
  required: true,
  authenticated: true,
  method: "GET",
  resource: "/v1/checkout/sessions/{CHECKOUT_SESSION_ID}",
  credential_source: "runtime-secret-store",
  require_full_session_object: true,
});
assert.deepEqual(contract.arc2.required_session_contract, {
  id_pattern: "^cs_test_[A-Za-z0-9_]+$",
  livemode: false,
  amount_total: 500000,
  amount_units: "usd-minor-units",
  amount_conversion_allowed: false,
  currency: "usd",
  payment_status: "paid",
  payment_link_must_equal_expected_id: true,
  terms_consent: "accepted",
  terms_version_source: "static-config",
  expected_terms_version: "2026-08-11",
  checkout_reference_must_bind_preview_folder: true,
  checkout_binding_secret_source: "runtime-secret-store",
});
assert.equal(contract.arc2.expected_payment_link_id, null);
assert.deepEqual(contract.arc2.checkout_configuration, {
  payment_link_url: null,
  price_mode: "one-time",
  amount_total_minor_units: 500000,
  currency: "usd",
  terms_of_service_consent_required: true,
  adult_purchaser_acceptance_required: true,
  terms_version_metadata: "2026-08-11",
  scope_summary_required_before_payment: true,
  live_configuration_verified: false,
});
assert.deepEqual(contract.arc2.payment_evidence_gate, {
  evidence_version: "arc2-payment-evidence-v1",
  signature_algorithm: "HMAC-SHA-256",
  signature_secret_source: "ARC_CHECKOUT_BINDING_SECRET",
  publisher_must_verify_signature_and_exact_bindings: true,
  merge_must_verify_signature_and_exact_bindings: true,
  email_gate_must_verify_signature_and_exact_bindings: true,
  caller_digest_is_authoritative: false,
});
assert.equal(contract.arc2.delivery_email.allowed_before_gate, false);
for (const [name, required] of Object.entries(contract.arc2.delivery_email)) {
  if (name !== "allowed_before_gate") assert.equal(required, true, `ARC2 gate requirement ${name} must fail closed.`);
}
assert.deepEqual(contract.arc2.lead_route_gate, {
  required_before_delivery_pr_write: true,
  independently_reverified_before_merge: true,
  independently_reverified_before_email_claim: true,
  immutable_processed_staging_html_required_at_each_gate: true,
  current_site_deploy_manifest_form_hook_and_submission_requeried_at_each_gate: true,
  authoritative_inbox_receipt_required: true,
  caller_status_string_is_authoritative: false,
});
assert.deepEqual(contract.arc2.customer_control_gate, {
  source: "zapier/arc2_verify_customer_control.js",
  read_only: true,
  write_methods_allowed: false,
  evidence_version: "arc-customer-control-evidence-v1",
  evidence_scope: "customer-owned-github-and-netlify",
  signature_algorithm: "HMAC-SHA-256",
  signature_secret_source: "runtime-secret-store",
  maximum_evidence_age_seconds: 1800,
  required_bindings: [
    "payment_evidence_sha256",
    "merge_commit_sha",
    "recipient_hmac_sha256",
    "customer_github_repository",
    "customer_github_commit_sha",
    "customer_github_repository_tree_sha256",
    "customer_netlify_account_id",
    "customer_netlify_site_id",
    "customer_netlify_deploy_id",
    "customer_netlify_deploy_file_manifest_sha256",
    "served_html_sha256",
  ],
  exact_customer_repository_bytes_required: true,
  exact_customer_netlify_source_bytes_required: true,
  immutable_customer_netlify_served_bytes_required: true,
  customer_github_admin_control_required: true,
  customer_netlify_account_owner_control_required: true,
  caller_status_string_is_authoritative: false,
});
assert.match(arc2CustomerControlVerifierSource, /method:\s*"GET"/);
assert.doesNotMatch(arc2CustomerControlVerifierSource, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
assert.match(arc2CustomerControlVerifierSource, /arc-customer-control-evidence-signature-v1/);
assert.match(arc2CustomerControlVerifierSource, /repository\.permissions\?\.admin !== true/);
assert.match(arc2CustomerControlVerifierSource, /account\.owner_ids/);
assert.match(arc2CustomerControlVerifierSource, /payment_evidence_sha256/);

assert.equal(contract.arc2.delivery_artifacts.exact_count, 4);
assert.deepEqual(contract.arc2.delivery_artifacts.paths, [
  "index.html",
  "netlify.toml",
  "USAGE.md",
  ".arc-handoff.json",
]);
assert.equal(new Set(contract.arc2.delivery_artifacts.paths).size, 4);
assert.equal(contract.arc2.delivery_artifacts.additional_paths_allowed, false);

assert.deepEqual(contract.lead_routing, {
  source: "zapier/arc2_verify_lead_route_staging.js",
  evidence_version: "arc-lead-route-evidence-v1",
  evidence_scope: "arc-controlled-netlify-staging",
  signature_algorithm: "HMAC-SHA-256",
  signature_secret_source: "runtime-secret-store",
  caller_status_string_is_authoritative: false,
  maximum_receipt_age_seconds: 21600,
  maximum_age_when_evidence_is_issued_seconds: 1800,
  maximum_future_clock_skew_seconds: 300,
  required_evidence_fields: [
    "preview_folder",
    "production_content_sha256",
    "bundle_fingerprint",
    "netlify_account_id",
    "staging_site_id",
    "staging_site_url",
    "staging_deploy_id",
    "staging_deploy_url",
    "deploy_file_manifest_sha256",
    "served_html_sha256",
    "staging_robots_header_sha256",
    "staging_form_id",
    "notification_hook_id",
    "form_name",
    "recipient_hmac_sha256",
    "synthetic_submission_id",
    "synthetic_probe_sha256",
    "netlify_submission_timestamp",
    "inbox_provider",
    "inbox_account_hmac_sha256",
    "inbox_message_id_hmac_sha256",
    "inbox_received_timestamp",
    "inbox_receipt_evidence_sha256",
  ],
  authoritative_inbox_attestation: {
    required: true,
    source: null,
    external_configuration_verified: false,
    evidence_version: "arc-inbox-receipt-evidence-v1",
    evidence_scope: "authoritative-inbox-delivery",
    signature_algorithm: "HMAC-SHA-256",
    signature_secret_source: "runtime-secret-store",
    separate_from_lead_route_signing_secret: true,
    maximum_age_when_lead_route_evidence_is_issued_seconds: 1800,
    must_be_at_or_after_netlify_submission: true,
    required_evidence_fields: [
      "provider",
      "account_hmac_sha256",
      "recipient_hmac_sha256",
      "synthetic_submission_id",
      "synthetic_probe_sha256",
      "message_id_hmac_sha256",
      "inbox_received_timestamp",
    ],
    raw_account_id_or_message_id_allowed: false,
  },
  verifier: {
    read_only: true,
    write_methods_allowed: false,
    authoritative_netlify_api_reads_required: [
      "GET /sites/{site_id}",
      "GET /sites/{site_id}/deploys/{deploy_id}",
      "GET /sites/{site_id}/files",
      "GET /sites/{site_id}/files/{file_path} (original raw bytes)",
      "GET /sites/{site_id}/snippets",
      "GET /sites/{site_id}/forms",
      "GET /hooks?site_id={site_id}",
      "GET /forms/{form_id}/submissions",
    ],
    exact_published_deploy_required: true,
    exact_original_uploaded_artifact_bytes_required: true,
    documented_netlify_post_processing_transform_required: true,
    immutable_and_current_processed_html_must_match: true,
    exact_three_file_manifest_and_no_snippets_required: true,
    unique_exact_form_required: true,
    unique_synthetic_submission_required: true,
    enabled_exact_recipient_hook_required: true,
    synthetic_probe_submitted_through_rendered_project_details_control: true,
    raw_recipient_or_probe_in_evidence_allowed: false,
  },
  staging_site: {
    temporary: true,
    arc_account_id_must_equal_static_config: true,
    hostname_prefix: "arc-lead-route-",
    hostname_suffix: ".netlify.app",
    immutable_deploy_url_required: true,
    staging_x_robots_tag_required: "noindex,nofollow,noarchive",
    cleanup_after_customer_delivery_receipt_required: true,
    exact_source_bytes_and_expected_processed_html_required: true,
  },
  replay_policy: {
    same_exact_delivery_revalidation_allowed: true,
    cross_artifact_replay_allowed: false,
    cross_recipient_replay_allowed: false,
    cross_site_or_deploy_replay_allowed: false,
    stale_receipt_replay_allowed: false,
  },
  verified_recipient: null,
  stripe_customer_email_allowed: false,
  stripe_customer_details_email_allowed: false,
  public_artifact_recipient_allowed: false,
  public_evidence_allowed: false,
  raw_recipient_public_allowed: false,
});
assert.match(arc2LeadRouteVerifierSource, /inputData\.inbox_receipt_evidence_secret/);
assert.match(arc2LeadRouteVerifierSource, /arc-inbox-receipt-evidence-signature-v1/);
assert.match(arc2LeadRouteVerifierSource, /inboxReceivedMs < netlifySubmissionMs/);
assert.match(arc2LeadRouteVerifierSource, /inbox_receipt_evidence_sha256/);

assert.equal(contract.email_outbox.storage, "private-durable-store");
assert.equal(contract.email_outbox.provider, "Zapier Tables");
assert.equal(contract.email_outbox.atomic_claim_authority, "deterministic-github-ref");
assert.equal(contract.email_outbox.table_write_required_before_email, true);
assert.equal(contract.email_outbox.public_marker_allowed, false);
assert.deepEqual(contract.email_outbox.applies_to, ["arc1-preview-email", "arc2-delivery-email"]);
assert.deepEqual(contract.email_outbox.states, ["PENDING", "CLAIMED", "SENT"]);
assert.deepEqual(contract.email_outbox.allowed_transitions, ["PENDING->CLAIMED", "CLAIMED->SENT"]);
assert.equal(contract.email_outbox.claim_must_be_atomic, true);
assert.equal(contract.email_outbox.send_only_after_claim, true);
assert.deepEqual(contract.email_outbox.claimed_but_unsent, {
  automatic_resend_allowed: false,
  alert_required: true,
  manual_recovery_required: true,
});

assert.deepEqual(contract.github_controls, {
  main_branch_protected: false,
  required_check_configured: false,
  required_check_name: "ARC preview quality/preview-quality",
  required_check_app_slug: "github-actions",
  required_check_app_id: 15368,
  squash_merge_only_for_automation: true,
  external_verification_required: true,
});

assert.deepEqual(contract.required_test_scenarios.map(({ niche }) => niche), [
  "roofing",
  "hvac",
  "remodeling",
  "landscaping",
  "auto-detailing",
]);
assert.equal(contract.required_test_scenarios.every(({ stripe_test_e2e_verified }) => stripe_test_e2e_verified === false), true);

assert.ok(Object.keys(contract.external_verification).length > 0);
assert.equal(Object.values(contract.external_verification).every(value => value === false), true);
for (const field of [
  "zapier_arc1_wired",
  "arc1_authoritative_netlify_intake_verified",
  "arc1_asset_bytes_verified",
  "arc1_atomic_intake_claim_verified",
  "arc1_unique_submission_rate_limit_verified",
  "authoritative_inbox_receipt_attestation_verified",
  "netlify_form_postprocessing_fixture_verified",
  "netlify_staging_noindex_headers_verified",
  "netlify_gate_time_revalidation_verified",
  "netlify_staging_cleanup_verified",
  "private_delivery_repository_verified",
  "private_delivery_ci_workflow_verified",
  "secure_customer_handoff_verified",
  "customer_authorization_redaction_verified",
  "customer_control_evidence_verified",
]) {
  assert.equal(contract.external_verification[field], false, `${field} must remain externally unverified.`);
}

assert.equal(contract.unresolved.expected_payment_link_id, null);
for (const field of [
  "analytics_receiver",
  "analytics_dashboard",
  "verified_lead_routing_recipient",
  "authoritative_inbox_provider",
  "verified_test_inbox",
  "netlify_form_postprocessing_fixture",
  "netlify_staging_cleanup_authority",
  "delivery_email_idempotent_provider",
  "arc1_netlify_site_id",
  "arc1_netlify_form_id",
  "arc1_netlify_form_name",
  "arc1_asset_upload_origin_allowlist",
  "arc1_rate_limit_authority",
  "arc1_rolling_build_limit",
  "arc1_daily_build_limit",
  "arc_netlify_account_id",
  "adult_contracting_representative",
  "legal_operator",
  "legal_entity",
  "mailing_address",
  "governing_venue",
  "branded_sender",
  "private_delivery_repository_owner",
  "private_delivery_repository_name",
  "private_delivery_required_ci_workflow",
  "secure_customer_handoff_authority",
  "customer_authorization_broker",
  "customer_control_evidence_secret_configured",
  "customer_control_verifier_configuration",
]) {
  assert.equal(contract.unresolved[field], null, `${field} must remain unresolved rather than invented.`);
}

assert.deepEqual(contract.gates.map(({ gate }) => gate), [1, 2, 3, 4, 5, 6, 7]);
assert.equal(contract.gates.every(({ complete }) => complete === false), true);

assert.doesNotMatch(contractText, /\bcs_(?:test|live)_[A-Za-z0-9]{6,}\b/);
assert.doesNotMatch(contractText, /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{6,}\b/);
assert.doesNotMatch(contractText, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
assert.doesNotMatch(contractText, /(?:^|\s)Authorization\s*:/i);

console.log("ARC Zapier wiring contract passed (fail closed; 0/7 gates live-complete).");
