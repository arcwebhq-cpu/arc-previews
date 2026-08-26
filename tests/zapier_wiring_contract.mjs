import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ARC1_GENERATION_CONTRACT_SHA256,
  ARC1_GENERATION_CONTRACT_VERSION,
  ARC1_GENERATION_EVALUATION_VERSION,
  ARC1_GENERATION_INSTRUCTIONS_SHA256,
  ARC1_GENERATION_OUTPUT_SCHEMA_SHA256,
  ARC1_GENERATION_REQUEST_VERSION,
  ARC1_GENERATION_RETRY_STATE_VERSION,
  ARC1_PRIVATE_OR_OPERATIONAL_FIELDS,
  ARC1_PUBLIC_BRIEF_FIELDS
} from "../scripts/arc1_generation_contract.mjs";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");
const contractText = await read("../zapier/wiring-contract.json");
const contract = JSON.parse(contractText);
const receiptCutoverText = await read("../zapier/receipt-v1-clean-cutover.json");
const receiptCutoverSha256 = createHash("sha256").update(receiptCutoverText).digest("hex");
const [
  arc1IntakeSource,
  arc1FunctionIntakeSource,
  arc1FunctionAssetSource,
  arc1FunctionAssetPublisherSource,
  arc1FunctionAckSource,
  arc1ConsumerSource,
  arc1ConsumerRuntimeSource,
  arc1ConsumerBundle,
  arc1ConsumerManifestSource,
  arc1ConsumerDeploymentContract,
  arc1PaymentLinkSource,
  arc1InjectSource,
  arc1PrivateCheckoutSource,
  arc1PrivateCheckoutLifecycleSource,
  arc2ResolverSource,
  leadRouteSource,
  emailGateSource,
  legacyPublishSource,
  legacyMergeSource,
  legacyControlSource,
  activationRunbook
] = await Promise.all([
  "../zapier/arc1_verify_intake_and_assets.js",
  "../zapier/arc1_verify_function_intake.js",
  "../zapier/arc1_retrieve_function_assets.js",
  "../zapier/arc1_publish_function_assets.js",
  "../zapier/arc1_ack_function_intake.js",
  "../scripts/arc1_consumer_contract.mjs",
  "../scripts/arc1_consumer_runtime.mjs",
  "../zapier/arc1_consumer_runtime.js",
  "../zapier/arc1_consumer_runtime.manifest.json",
  "../zapier/arc1-consumer-runtime-deployment.md",
  "../zapier/arc1_verify_payment_link.js",
  "../zapier/arc1_inject.js",
  "../zapier/arc1_private_checkout_link.js",
  "../zapier/arc1_private_checkout_lifecycle.js",
  "../zapier/arc2_resolve_and_finalize.js",
  "../zapier/arc2_verify_lead_route_staging.js",
  "../zapier/arc2_delivery_email_gate.js",
  "../zapier/arc2_publish_delivery_pr.js",
  "../zapier/arc2_merge_delivery_pr.js",
  "../zapier/arc2_verify_customer_control.js",
  "../zapier/activation-runbook.md"
].map(read));

assert.equal(contract.schema, "arc-zapier-wiring-contract-v3");
assert.equal(contract.live_complete, false);
assert.equal(contract.configuration_state, "local-contract-not-applied");
assert.equal(Object.values(contract.observed_external_state).every(value => value === false), true);
assert.deepEqual(contract.safety, {
  apollo_enabled: false,
  outreach_allowed: false,
  stripe_mode: "test",
  allow_test_mode_events: true,
  allow_live_mode_events: false,
  real_charges_allowed: false
});
assert.deepEqual(contract.documented_deployment_configuration, {
  alert_email: "arcwebhq@gmail.com",
  netlify_site_name: "arcsites",
  netlify_site_id: "8f9d462c-952f-42fc-a3a0-50a2529e8f5d",
  netlify_form_name: "arc-preview",
  netlify_form_id: "6a483964f58804000839c2de",
  customer_artifact_embedding_allowed: false
});

assert.equal(contract.secrets.repository_values_present, false);
assert.equal(contract.secrets.credential_values_present, false);
for (const name of [
  "STRIPE_TEST_API_KEY", "STRIPE_LIVE_API_KEY", "ARC_STRIPE_LIVE_MODE_ENABLED",
  "ARC_EXPECTED_STRIPE_ACCOUNT_ID_SHA256", "ARC_EXPECTED_STRIPE_PRODUCT_TAX_CODE",
  "ARC_EXPECTED_STRIPE_TAX_REGISTRATIONS_JSON", "ARC_CHECKOUT_BINDING_SECRET", "ARC_PAYMENT_LINK_EVIDENCE_SECRET",
    "ARC_PRIVATE_CHECKOUT_PROVIDER_ADAPTER_EVIDENCE_SECRET",
  "ARC_HANDOFF_ARTIFACT_EVIDENCE_SECRET", "ARC_LEAD_ROUTE_EVIDENCE_SECRET",
  "ARC_INBOX_RECEIPT_EVIDENCE_SECRET", "ARC_CLAIM_STATE_EVIDENCE_SECRET",
    "NETLIFY_OAUTH_CLIENT_ID", "NETLIFY_OAUTH_CLIENT_SECRET"
    , "ARC_INTAKE_ARC1_DESTINATION_BEARER", "ARC_INTAKE_ARC1_EVIDENCE_SECRET", "ARC_INTAKE_ARC1_ACK_SECRET",
    "ARC_INTAKE_ARC1_STATE_SECRET", "ARC_INTAKE_ARC1_ADAPTER_PROOF_SECRET", "ARC_INTAKE_ARC1_ADAPTER_ENABLED",
    "ARC_INTAKE_ARC1_DOWNSTREAM_ENABLED", "ARC_INTAKE_ARC1_ENDPOINT", "ARC_INTAKE_ARC1_DOWNSTREAM_ENDPOINT",
    "ARC_INTAKE_ARC1_DOWNSTREAM_BEARER", "ARC_INTAKE_ARC1_DISPATCH_SECRET", "ARC_INTAKE_ASSET_RETRIEVAL_SECRET",
    "ARC_INTAKE_ARC1_PACKET_SECRET", "ARC_INTAKE_ARC1_CONSUMER_BEARER",
    "ARC_INTAKE_ARC1_CONSUMER_RECEIPT_SECRET", "ARC_INTAKE_ARC1_DURABLE_RESULT_SECRET",
    "ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED", "ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED",
    "ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED", "ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED",
    "ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED", "ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED",
    "ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED",
    "ARC_INTAKE_ARC1_LEGACY_MIGRATION_ENABLED", "ARC_INTAKE_ARC1_CONSUMER_TIMEOUT_MS",
    "ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_TIMEOUT_MS",
    "ARC1_ASSET_RECEIPT_SECRET", "ARC1_ASSET_PUBLICATION_RECEIPT_SECRET",
    "ARC1_ASSET_VISUAL_REVIEW_SECRET", "ARC1_ASSET_VISUAL_REVIEW_KEY_ID",
    "ARC1_AUTHORIZED_IMAGE_REVIEWER_ID_SHA256", "ARC1_ASSET_VISUAL_REVIEW_AUTHORITY_VERIFIED",
    "ARC1_ASSET_VISUAL_REVIEW_PRIVATE_SECRET_BROKER_VERIFIED",
    "ARC1_ASSET_VISUAL_REVIEW_PROVIDER_HISTORY_REDACTION_VERIFIED",
    "ARC1_ASSET_VISUAL_REVIEW_SECRET_DELIVERY_MODE"
]) assert.ok(contract.secrets.required_runtime_names.includes(name), `${name} must remain runtime-only`);
assert.equal(contract.secrets.customer_authorization.source, "netlify-official-deploy-and-claim");
assert.equal(contract.secrets.customer_authorization.customer_authorization_code_expected, false);
assert.equal(contract.secrets.customer_authorization.customer_oauth_access_token_expected, false);
assert.equal(contract.secrets.customer_authorization.oauth_client_id_and_secret_used_only_for_signed_netlify_claim_jwt, true);
assert.equal(contract.secrets.customer_authorization.claim_webhook_is_unsigned_hint_requiring_netlify_reverification, true);

assert.deepEqual(contract.arc1.ordered_steps, [
  "arc-site/intake-arc1-adapter:verify-envelope-assets-and-create-only-claim",
  "arc-site/intake-arc1-adapter:return-exact-signed-acknowledgement",
  "arc-site/intake-arc1-adapter:retryable-catch-raw-hook-dispatch",
  "zapier/arc1_consumer_runtime.js#CLAIM",
  "private-state/create-or-exact-and-authoritative-readback",
  "zapier/arc1_consumer_runtime.js#AUTHORIZE",
  "zapier/arc1_verify_function_intake.js#DOWNSTREAM_REVERIFY",
  "zapier/arc1_retrieve_function_assets.js#DOWNSTREAM_RETRIEVE",
  "private-state/commit-immutable-result-and-authoritative-readback",
  "zapier/arc1_consumer_runtime.js#COMPLETE",
  "zapier/arc1_verify_payment_link.js",
  "zapier/arc1_publish_function_assets.js",
  "zapier/arc1_inject.js",
  "arc_step7_validator.js",
  "zapier/arc1_publish_preview_pr.js",
  "zapier/arc1_merge_preview_pr.js",
  "zapier/arc1_preview_email_gate.js",
  "zapier/arc1_private_checkout_link.js#PREPARE",
  "private-state/create-or-exact-private-checkout-intent",
  "zapier/arc1_private_checkout_link.js#AUTHORIZE_MUTATION",
  "private-state/CAS-PREPARED-to-MUTATION_STARTED",
  "zapier/arc1_private_checkout_link.js#CREATE",
  "private-state/persist-LINK_CREATED",
  "zapier/arc1_private_checkout_link.js#PERSIST_REVERSE",
  "private-state/create-or-exact-link-id-reverse",
  "zapier/arc1_private_checkout_link.js#ACTIVATE",
  "private-state/CAS-LINK_CREATED-to-ACTIVE",
  "zapier/arc1_private_checkout_link.js#FINALIZE"
]);
assert.equal(contract.arc1.publish_mode, "pull-request-only");
assert.equal(contract.arc1.direct_main_publish_allowed, false);
assert.deepEqual(contract.arc1.generation, {
  contract_version: ARC1_GENERATION_CONTRACT_VERSION,
  request_version: ARC1_GENERATION_REQUEST_VERSION,
  evaluation_version: ARC1_GENERATION_EVALUATION_VERSION,
  retry_state_version: ARC1_GENERATION_RETRY_STATE_VERSION,
  source: "scripts/arc1_generation_contract.mjs",
  test: "tests/arc1_generation_contract.mjs",
  contract_sha256: ARC1_GENERATION_CONTRACT_SHA256,
  output_schema_sha256: ARC1_GENERATION_OUTPUT_SCHEMA_SHA256,
  instructions_sha256: ARC1_GENERATION_INSTRUCTIONS_SHA256,
  offline_contract_verified: true,
  exact_58_key_string_schema_verified: true,
  all_19_media_profiles_verified: true,
  positive_public_brief_projection_verified: true,
  deterministic_provider_neutral_request_verified: true,
  authoritative_submission_digest_bound_verified: true,
  authoritative_business_location_industry_style_service_and_cta_bindings_verified: true,
  sanitizer_quality_profile_and_render_gate_verified: true,
  offline_retry_state_verified: true,
  maximum_attempts: 3,
  terminal_failure_state: "HALT_MANUAL_REVIEW",
  network_calls_allowed: false,
  external_state_mutation_allowed: false,
  provider_adapter_configured: false,
  provider_identity_verified: false,
  model_id_pinned_and_verified: false,
  provider_structured_output_mode_verified: false,
  signed_generation_request_evidence_verified: false,
  signed_generation_response_evidence_verified: false,
  provider_retry_state_verified: false,
  live_generation_e2e_verified: false,
  activation_allowed: false
});
assert.deepEqual(contract.arc1.injector_v11, {
  runtime_version: "arc1-inject-v11-render-runtime-v1",
  site_contract_version: "arc-five-page-site-v1",
  template_version: "11.0",
  render_bundle_version: "arc1-five-page-render-bundle-v1",
  render_evidence_version: "arc1-render-evidence-v2",
  checkout_offer_snapshot_version: "arc-checkout-offer-snapshot-v2",
  checkout_recipient_reservation_version: "arc1-checkout-recipient-reservation-v2",
  offer_contract_id: "arc-fixed-five-page-offer-v1",
  deliverable: "fixed-five-page-marketing-website-v1",
  runtime_source: "scripts/arc1_inject_v11_runtime.mjs",
  runtime_builder: "scripts/build_arc1_inject_v11_runtime.mjs",
  runtime_manifest: "zapier/arc1_inject_v11_runtime.manifest.json",
  template: "ARC_MASTER_TEMPLATE_V11.html",
  injector: "zapier/arc1_inject.js",
  test: "tests/arc1_inject_v11_contract.mjs",
  page_count: 5,
  logical_page_paths: ["index.html", "services/index.html", "about/index.html", "process/index.html", "contact/index.html"],
  artifact_page_paths: ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"],
  generated_runtime_reproducible: true,
  actual_injector_executed_for_all_19_profiles: true,
  exact_58_key_string_schema_verified: true,
  whole_site_digest_and_secondary_page_tamper_verified: true,
  legacy_singular_output_absent: true,
  downstream_publication_migrated: true,
  live_wiring_complete: false,
  automation_enabled: false,
  activation_allowed: false
});
assert.deepEqual(contract.arc1.function_intake_bridge.generator_projection, {
  mode: "positive-public-content-allowlist",
  public_fields: [
    "brand_tone", "business", "business_hours", "business_story", "city", "colors", "competitor_sites",
    "cta_destination", "design_dislikes", "domain_status", "faqs_and_objections", "features", "final_notes",
    "first_cta", "goals", "highest_profit_service", "industry", "lead_form_fields", "lead_form_needed",
    "main_call_to_action", "main_offer", "main_services", "primary_style", "proof", "proof_details",
    "public_address", "public_email", "public_phone", "reference_site_likes", "sections", "social_links",
    "target_customer", "website", "why_choose_you"
  ],
  private_or_operational_fields_never_generator_mapped: [
    "email", "name", "lead_notification_email", "referrer_host", "utm_campaign", "utm_content", "utm_medium",
    "utm_source", "utm_term"
  ],
  recursive_entity_and_url_decode_privacy_scan_before_render_signature: true,
  recursive_entity_and_url_decode_privacy_scan_before_git_write: true,
  recursive_entity_and_url_decode_privacy_scan_before_arc2_signature: true
});
assert.deepEqual(contract.arc1.function_intake_bridge.generator_projection.public_fields, ARC1_PUBLIC_BRIEF_FIELDS);
assert.deepEqual(
  contract.arc1.function_intake_bridge.generator_projection.private_or_operational_fields_never_generator_mapped,
  ARC1_PRIVATE_OR_OPERATIONAL_FIELDS
);
assert.equal(contract.arc1.authoritative_intake.source, "authenticated-netlify-api");
assert.match(activationRunbook, /normal Catch Hook cannot be the ARC1 destination/);
assert.match(activationRunbook, /Pointing\s+`ARC_INTAKE_ARC1_ENDPOINT` directly at a Zapier hook/);
assert.match(activationRunbook, /first-party adapter is code-complete only/i);
assert.match(activationRunbook, /actual downstream bearer.not the producer-to-adapter bearer/is);
assert.match(activationRunbook, /HTTP 200 only as `HOOK_ACCEPTED`/);
assert.match(activationRunbook, /all three are OFF/);
assert.deepEqual(contract.arc1.authoritative_intake, {
  legacy_adapter_only: true,
  production_source_allowed: false,
  source: "authenticated-netlify-api",
  site_id: "8f9d462c-952f-42fc-a3a0-50a2529e8f5d",
  form_id: "6a483964f58804000839c2de",
  form_name: "arc-preview",
  trigger_submission_id_must_resolve_exactly_once: true,
  trusted_received_at_source: "submission.created_at",
  public_folder_prefix_derivation: 'sha256("arc-preview-folder-v1\\n" + site_id + "\\n" + form_id + "\\n" + submission_id + "\\n" + received_at)[0:8]',
  client_submission_id_authoritative: false,
  client_received_at_authoritative: false,
  client_form_started_at_authoritative: false,
  client_lead_route_status_authoritative: false,
  required_intake_version: "arc-intake-v8",
  required_offer_contract_id: "arc-fixed-five-page-offer-v1",
  required_budget_confirmation: "Yes, understands the finished ARC website is a fixed five-page website with a $5,000 subtotal plus applicable sales tax only after preview approval",
  required_terms_acceptance: "Accepted ARC preview terms, privacy policy, refund policy, and fixed five-page service scope dated 2026-08-25; separate adult checkout acceptance required",
  maximum_submission_age_seconds: 86400,
  maximum_future_clock_skew_seconds: 300
});
assert.deepEqual(contract.arc1.function_intake_bridge, {
  live_wiring_complete: false,
  automation_enabled: false,
  source_schema: "arc-intake-function-submission-v1",
  bridge_schema: "arc-intake-arc1-bridge-evidence-v1",
  consumer_schema: "arc1-function-intake-adapter-v1",
  bridge_contract_version: "arc-intake-to-arc1-contract-v2",
  bridge_contract_sha256: "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2",
  folder_link_contract_clause: "folder-link-intake-rejected-until-private-provider-adapter",
  generator_projection: {
    mode: "positive-public-content-allowlist",
    public_fields: [
      "brand_tone", "business", "business_hours", "business_story", "city", "colors", "competitor_sites",
      "cta_destination", "design_dislikes", "domain_status", "faqs_and_objections", "features", "final_notes",
      "first_cta", "goals", "highest_profit_service", "industry", "lead_form_fields", "lead_form_needed",
      "main_call_to_action", "main_offer", "main_services", "primary_style", "proof", "proof_details",
      "public_address", "public_email", "public_phone", "reference_site_likes", "sections", "social_links",
      "target_customer", "website", "why_choose_you"
    ],
    private_or_operational_fields_never_generator_mapped: [
      "email", "name", "lead_notification_email", "referrer_host", "utm_campaign", "utm_content", "utm_medium",
      "utm_source", "utm_term"
    ],
    recursive_entity_and_url_decode_privacy_scan_before_render_signature: true,
    recursive_entity_and_url_decode_privacy_scan_before_git_write: true,
    recursive_entity_and_url_decode_privacy_scan_before_arc2_signature: true
  },
  delivery_authentication: ["exact-destination-bearer", "canonical-envelope-hmac-sha256"],
  ingress_claim: {
    producer_provider: "Netlify Blobs first-party adapter",
    producer_mode: "atomic-create-only-and-CAS-or-exact-replay",
    producer_record_key: "HMAC(delivery_id)",
    producer_contains_raw_customer_content: false,
    producer_retains_pseudonymous_source_pointer: true,
    consumer_provider: "Netlify Blobs first-party adapter",
    consumer_contract_tested: true,
    consumer_dedupe_verified: false,
    ack_before_claim_allowed: false,
    required_fields: ["ingress_state_key", "ingress_state_digest_sha256", "bridge_delivery_id", "bridge_evidence_sha256", "asset_receipt_sha256", "created_at", "status"]
  },
  acknowledgement: {
    producer: "arc-site-launch/netlify/lib/intake-arc1-adapter-core.mjs",
    cross_repository_equivalent: "zapier/arc1_ack_function_intake.js",
    cross_repository_byte_equivalence_tested: true,
    deployed_round_trip_verified: false,
    schema: "arc-intake-arc1-consumer-ack-v1",
    exact_webhook_response_required: true,
    durable_claim_required_before_ack: true,
    signed_asset_receipt_required_before_claim_and_ack: true,
    raw_pii_allowed: false
  },
  downstream_consumer_runtime: {
    source: "scripts/arc1_consumer_runtime.mjs",
    core: "scripts/arc1_consumer_contract.mjs",
    bundle: "zapier/arc1_consumer_runtime.js",
    manifest: "zapier/arc1_consumer_runtime.manifest.json",
    deployment_contract: "zapier/arc1-consumer-runtime-deployment.md",
    test: "tests/arc1_consumer_runtime_bundle_contract.mjs",
    cross_repository_test: "tests/arc1_site_packet_runtime_contract.mjs",
    pinned_arc_site_commit: "f7ee8e69962bba3010bb2c32c4bff4d22c1fb8cc",
    phases: ["CLAIM", "AUTHORIZE", "COMPLETE"],
    generated_bundle_reproducible: true,
    actual_bundle_executed_in_tests: true,
    actual_site_packet_executed_through_bundle: true,
    private_state_contains_direct_customer_content: false,
    raw_packet_or_claim_token_log_allowed: false,
    raw_private_state_output_private_only: true,
    encrypted_host_secret_injection_required: true,
    ordinary_input_data_secret_mapping_allowed: false,
    provider_input_output_history_redaction_verified: false,
    private_state_provider_configured: false,
    private_state_create_or_exact_readback_verified: false,
    private_state_commit_readback_verified: false,
    private_state_operation_timeout_default_ms: 5000,
    private_state_operation_timeout_maximum_ms: 5000,
    private_state_timeout_capped_by_claim_deadline: true,
    private_state_abort_signal_propagated: true,
    hung_create_releases_provider_work: false,
    hung_commit_posts_completion: false,
    crash_replay_exact_state_tested: true,
    locally_signed_receipt_is_persistence_proof: false,
    provider_mutation_configured: false,
    live_end_to_end_verified: false,
    activation_allowed: false,
    activation_flags_default: {
      ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED: false,
      ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED: false,
      ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED: false,
      ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED: false,
      ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED: false
    }
  },
  zapier_provider_constraints: {
    official_catch_hook_custom_response_supported: false,
    direct_catch_hook_endpoint_allowed: false,
    durable_synchronous_ack_adapter_or_two_phase_callback_required: true,
    first_party_adapter_repo_implemented: true,
    first_party_adapter_deployed_and_attested: false,
    first_party_blob_create_only_and_cas_tested: true,
    standard_tables_atomic_create_only_or_cas_verified: false,
    find_then_create_or_find_then_update_allowed: false,
    code_step_input_secret_storage_verified: false,
    private_secret_broker_or_private_integration_verified: false,
    catch_hook_http_200_means_ingress_only: true,
    adapter_packet_single_signature_contract_tested: true,
    adapter_packet_single_signature_verified: false,
    downstream_consumer_dedupe_contract_tested: true,
    downstream_consumer_dedupe_verified: false,
    signed_downstream_completion_receipt_contract_tested: true,
    signed_downstream_completion_receipt_verified: false,
    reviewed_at: "2026-08-25"
  },
  retry_and_alert_authority: "arc-site-private-blob-producer-and-adapter-state",
  inline_asset_private_retrieval_supported: true,
  asset_folder_private_retrieval_supported: false,
  folder_link_policy: {
    accepted: false,
    reject_step: "arc-site-launch/netlify/lib/intake-arc1-adapter-core.mjs",
    rejection_before_private_retrieval: true,
    rejection_before_durable_ingress_claim: true,
    rejection_before_acknowledgement: true,
    state_mutation_allowed: false,
    reason: "private-provider-per-file-expansion-is-not-implemented"
  },
  pre_ack_private_asset_consumer: "arc-site-launch/netlify/lib/intake-arc1-adapter-core.mjs",
  downstream_private_asset_revalidator: "zapier/arc1_retrieve_function_assets.js",
  public_asset_publisher: "zapier/arc1_publish_function_assets.js",
  public_asset_publication: {
    automation_enabled: false,
    accepted_kind: "UPLOAD",
    folder_link_accepted: false,
    repository: "arcwebhq-cpu/arc-previews",
    branch: "arc-preview/{public_folder_prefix}",
    path: "{preview_folder}/assets/{sha256}.{validated_extension}",
    mode: "create-only-or-exact-tree-replay",
    signed_receipt_schema: "arc1-public-asset-publication-receipt-v1",
    nonempty_receipt_status: "HUMAN_REVIEWED_CONTENT_ADDRESSED",
    legacy_nonempty_receipt_status_accepted: false,
    legacy_intake_evidence_accepted_by_injector: false,
    asset_permission: "Confirmed rights and no visible watermark v1",
    image_review_protocol: "arc1-asset-visual-review-v1",
    automated_screening_protocol: "arc-deterministic-image-screen-v1",
    animated_webp_accepted: false,
    injector_and_publisher_exact_receipt_required: true,
    receipt_consumers_atomic_cutover_required: true,
    clean_cutover_contract: "zapier/receipt-v1-clean-cutover.json",
    clean_cutover_contract_sha256: receiptCutoverSha256,
    cleanup_action_allowed: false,
    git_history_retention_and_purge_verified: false,
    arc2_local_asset_migration_implemented: true,
    paid_site_preview_host_dependency_allowed: false
  },
  visual_review_authority: {
    gate_input: "asset_visual_review_authority_verified",
    gate_default: false,
    gate_required_normalized_value: "true",
    zapier_code_input_data_string_true_supported: true,
    non_string_non_boolean_values_accepted: false,
    gate_source: "verified-review-provider-output-only",
    review_secret_input: "asset_visual_review_secret",
    review_key_id_input: "asset_visual_review_key_id",
    authorized_reviewer_id_input: "authorized_image_reviewer_id_sha256",
    review_secret_mapping: "verified-private-integration-secret-store-only",
    review_key_id_mapping: "verified-private-integration-secret-store-only",
    authorized_reviewer_id_mapping: "verified-private-integration-secret-store-only",
    secret_delivery_mode_input: "asset_visual_review_secret_delivery_mode",
    secret_delivery_mode_required: "PRIVATE_INTEGRATION_REDACTED",
    private_secret_broker_gate_input: "asset_visual_review_private_secret_broker_verified",
    provider_history_redaction_gate_input: "asset_visual_review_provider_history_redaction_verified",
    ordinary_input_data_mapping_allowed: false,
    code_by_zapier_input_data_secret_custody_allowed: false,
    private_integration_or_secret_broker_required: true,
    private_integration_or_secret_broker_verified: false,
    provider_history_redaction_verified: false,
    secret_store_mappings_implemented: false,
    review_key_id_bound_into_signature: true,
    review_key_id_bound_into_receipt: true,
    reviewer_id_must_match_signed_review: true,
    provider_authority_verified: false,
    provider_authority_enabled: false,
    review_secret_and_key_custody_verified: false,
    operator_configuration_cryptographically_proves_human_review: false,
    activation_allowed: false
  },
  external_producer_consumer_wiring_proof_required: true,
  downstream_bound_asset_url_publication_implemented: true,
  cross_repository_commit_pin_implemented: true,
  cross_repository_commit_pin_required_before_activation: true,
  public_intake_activation_allowed: false,
  remaining_external_wiring: [
    "first-party-adapter-disabled-deployment-and-runtime-attestation-proof",
    "bounded-24-hour-adapter-attestation-rotation-proof",
    "downstream-private-state-create-or-exact-and-authoritative-readback-proof",
    "downstream-private-state-result-commit-and-authoritative-readback-proof",
    "encrypted-host-secret-injection-and-provider-history-redaction-proof",
    "private-secret-broker-or-zapier-private-integration-proof",
    "catch-raw-hook-exact-200-and-header-envelope-mapping-behind-adapter",
    "signed-downstream-completion-receipt-and-ambiguous-hook-retry-reconciliation",
    "exact-signed-acknowledgement-round-trip-proof", "content-addressed-private-asset-retrieval-wiring-proof",
    "content-addressed-public-asset-publication-wiring-proof",
    "verified-image-review-provider-authority-and-secret-key-custody-proof",
    "secret-store-only-image-review-key-id-and-reviewer-id-mapping-proof",
    "image-review-private-secret-broker-and-redacted-provider-history-proof",
    "arc1-publication-receipt-to-arc2-private-input-mapping-proof",
    "adult-reviewed-git-history-asset-retention-and-purge-protocol",
    "failure-alert-recipient-proof", "end-to-end-disabled-synthetic-test"
  ]
});
assert.deepEqual(contract.arc1.receipt_v1_clean_cutover, {
  contract: "zapier/receipt-v1-clean-cutover.json",
  contract_sha256: receiptCutoverSha256,
  document: "zapier/receipt-v1-clean-cutover.md",
  asset_publication_receipt_included: true,
  private_payment_link_receipt_included: true,
  arc2_payment_evidence_v4_included: true,
  bridge_contract_version: "arc-intake-to-arc1-contract-v2",
  bridge_contract_sha256: "da1bb4fc84f9871bdec1029d90ff21dfbdabd1e92fe14e838779f06578e426c2",
  legacy_receipts_accepted: false,
  producer_consumer_atomic_deploy_required: true,
  customer_or_live_receipt_inventory_at_freeze: 0,
  pending_function_intake_evidence_or_submissions_at_freeze: 0,
  inventory_is_cryptographic_proof: false,
  external_provider_zero_state_verified: false,
  activation_allowed: false
});
assert.equal(contract.arc1.function_intake_bridge.public_asset_publication.clean_cutover_contract_sha256,
  receiptCutoverSha256, "both wiring cutover pins must equal the actual frozen contract bytes");
assert.match(arc1FunctionIntakeSource, /arc-intake-arc1-bridge-evidence-v1/);
assert.match(arc1FunctionIntakeSource, /arc-intake-private-asset-grant-v1/);
assert.match(arc1FunctionAckSource, /exact durable ingress claim required/);
assert.match(arc1ConsumerSource, /arc-intake-arc1-downstream-packet-v2/);
assert.match(arc1ConsumerSource, /arc-intake-arc1-consumer-completion-v1/);
assert.match(arc1ConsumerSource, /ARC1_CONSUMER_DURABILITY_REQUIRED/);
assert.doesNotMatch(arc1ConsumerSource, /console\.(?:log|error|warn)/);
assert.match(arc1ConsumerRuntimeSource, /runArc1PrivateStateConsumerJob/);
assert.match(arc1ConsumerRuntimeSource, /ARC1_CONSUMER_HISTORY_REDACTION_NOT_ATTESTED/);
assert.match(arc1ConsumerRuntimeSource, /CREATE_OR_EXACT/);
assert.match(arc1ConsumerBundle, /return await runArc1ConsumerCodeStep/);
assert.doesNotMatch(arc1ConsumerBundle, /console\.(?:log|error|warn|info|debug)/);
const arc1ConsumerManifest = JSON.parse(arc1ConsumerManifestSource);
assert.equal(arc1ConsumerManifest.bundle_sha256, createHash("sha256").update(arc1ConsumerBundle).digest("hex"));
assert.equal(arc1ConsumerManifest.execution.private_history_redaction_required, true);
assert.equal(arc1ConsumerManifest.execution.encrypted_host_secret_injection_required, true);
assert.equal(arc1ConsumerManifest.execution.local_hmac_receipt_alone_proves_persistence, false);
assert.equal(arc1ConsumerManifest.execution.private_state_operation_timeout_maximum_ms, 5000);
assert.equal(arc1ConsumerManifest.execution.private_state_timeout_capped_by_claim_deadline, true);
assert.equal(arc1ConsumerManifest.execution.private_state_abort_signal_propagated, true);
assert.equal(Object.values(arc1ConsumerManifest.activation_flags).every(value => value === false), true);
assert.match(arc1ConsumerDeploymentContract, /activation prohibited; provider capabilities unverified/i);
assert.match(arc1ConsumerDeploymentContract, /authoritative provider write and readback is not durability/i);
assert.match(arc1FunctionAssetPublisherSource, /arc1-public-asset-publication-receipt-v1/);
assert.match(arc1FunctionAssetPublisherSource, /configuredTrue\(inputData\.asset_visual_review_authority_verified\)/);
assert.match(arc1FunctionAssetPublisherSource, /asset_visual_review_private_secret_broker_verified/);
assert.match(arc1FunctionAssetPublisherSource, /asset_visual_review_provider_history_redaction_verified/);
assert.doesNotMatch(arc1FunctionAssetPublisherSource, /console\.(?:log|error|warn)/);
assert.equal(contract.arc1.authoritative_intake.client_submission_id_authoritative, false);
assert.equal(contract.arc1.asset_validation.signed_intake_evidence_required_by_injector_and_publisher, true);
assert.deepEqual(contract.arc1.asset_validation, {
  before_build_required: true,
  exact_https_origin_allowlist_required: true,
  customer_upload_url_query_userinfo_fragment_allowed: false,
  redirects_allowed: false,
  allowed_content_types: ["image/png", "image/jpeg", "image/webp"],
  magic_byte_and_container_validation_required: true,
  bounded_full_raster_decode_before_first_storage_required: true,
  maximum_decoded_pixels: 16000000,
  downstream_bytes_must_match_first_storage_sha256: true,
  active_content_and_polyglot_rejected: true,
  embedded_metadata_rejected_before_content_addressing: {
    jpeg: ["all-APPn-except-exact-JFIF-APP0-and-Adobe-APP14", "COM"],
    png: ["eXIf", "tEXt", "zTXt", "iTXt", "iCCP", "tIME", "unrecognized-ancillary-chunks"],
    webp: ["EXIF", "XMP", "ICCP", "unrecognized-chunks"]
  },
  animated_webp_allowed: false,
  accepted_images_have_exactly_one_visual_frame: true,
  maximum_file_bytes: 2621440,
  maximum_total_bytes: 7864320,
  function_bridge_maximum_file_bytes: 1250000,
  function_bridge_maximum_total_bytes: 3020000,
  folder_link_accepted_by_arc1: false,
  folder_link_fail_closed_before_claim_and_ack: true,
  authenticated_private_post_retrieval_required: true,
  per_asset_sha256_private_state_required: true,
  signed_intake_evidence_required_by_injector_and_publisher: true
});
assert.equal(contract.arc1.private_state.claim_mode, "atomic-create-only-before-build");
assert.deepEqual(contract.arc1.private_state.required_fields, [
  "state_key", "state_digest_sha256", "intake_evidence_sha256", "trusted_netlify_submission_id",
  "trusted_received_at", "public_folder_prefix", "submission_data_sha256", "asset_manifest_sha256",
  "preview_folder", "content_sha256", "head_sha", "pr_number", "recipient_sha256", "token_sha256",
  "created_at", "expires_at", "status"
]);
assert.equal(contract.arc1.private_state.provider, "Zapier Tables");
assert.equal(contract.arc1.private_state.record_key, "state_key");
assert.equal(contract.arc1.private_state.initial_status, "PENDING");
assert.equal(contract.arc1.private_state.maximum_pending_ttl_hours, 24);
assert.equal(contract.arc1.abuse_controls.fail_closed_when_limit_state_is_unavailable, true);
assert.deepEqual(contract.arc1.abuse_controls, {
  per_submission_replay_claim_required: true,
  unique_submission_rate_limit_required_before_build: true,
  authoritative_rate_limit_provider: null,
  maximum_builds_per_rolling_window: null,
  maximum_builds_per_day: null,
  live_configuration_verified: false,
  fail_closed_when_limit_state_is_unavailable: true
});
assert.equal(contract.arc1.preview_email.gate_must_verify_pages_live_bytes, true);
assert.deepEqual(contract.arc1.preview_email, {
  allowed_before_gate: false,
  gate_must_bind_exact_pr_head_sha: true,
  gate_must_bind_exact_pr_head_tree_sha: true,
  gate_must_require_latest_named_check_success: true,
  gate_must_verify_merged_main_content: true,
  gate_must_verify_pages_live_bytes: true,
  gate_must_verify_all_five_merged_main_raw_bytes: true,
  gate_must_verify_all_five_pages_clean_routes: true,
  gate_must_bind_v2_whole_site_evidence: true,
  gate_must_verify_preview_noindex: true,
  gate_must_claim_private_outbox_first: false,
  outbox_and_email_authority_enabled: false
});
assert.equal(contract.arc1.payment_link_preflight.source, "zapier/arc1_verify_payment_link.js");
assert.equal(contract.arc1.payment_link_preflight.expected_checkout_redirect_url, "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}");
assert.equal(contract.arc1.payment_link_preflight.injector_must_consume_exact_signed_offer_template, true);
assert.equal(contract.arc1.payment_link_preflight.active_shared_payment_link_required, false);
assert.equal(contract.arc1.payment_link_preflight.live_configuration_verified, false);
assert.equal(contract.arc1.payment_link_preflight.stripe_mode_source, "ARC_STRIPE_LIVE_MODE_ENABLED (missing or false means test; exact true means live)");
assert.equal(contract.arc1.payment_link_preflight.authenticated_account_resource, "/v1/account");
assert.equal(contract.arc1.payment_link_preflight.raw_account_id_public_output_allowed, false);
assert.equal(contract.arc1.payment_link_preflight.tax_settings_resource, "/v1/tax/settings");
assert.equal(contract.arc1.payment_link_preflight.active_tax_settings_required, true);
assert.equal(contract.arc1.payment_link_preflight.automatic_tax_enabled_required, true);
assert.equal(contract.arc1.payment_link_preflight.active_expected_tax_registration_readback_required, true);
assert.equal(contract.arc1.payment_link_preflight.stripe_api_version, "2026-07-29.dahlia");
assert.equal(contract.arc1.payment_link_preflight.required_terms_version, "2026-08-25");
assert.match(arc1IntakeSource, /https:\/\/api\.netlify\.com\/api\/v1/);
assert.match(arc1PaymentLinkSource, /const stripeApiVersion = "2026-07-29\.dahlia"/);
assert.match(arc1PaymentLinkSource, /"Stripe-Version": stripeApiVersion/);
assert.match(arc1PaymentLinkSource, /arc1-checkout-offer-template-evidence-signature-v1/);
assert.match(arc1PaymentLinkSource, /https:\/\/api\.stripe\.com\/v1\/account/);
assert.match(arc1PaymentLinkSource, /https:\/\/api\.stripe\.com\/v1\/tax\/settings/);
assert.match(arc1PaymentLinkSource, /taxSettings\.status\) !== "active"/);
assert.match(arc1PaymentLinkSource, /tax\/registrations/);
assert.match(arc1PaymentLinkSource, /adultpurchaserack/);
assert.doesNotMatch(arc1PaymentLinkSource, /\/v1\/payment_links/);
assert.match(arc1InjectSource, /payment_link_evidence_private/);
assert.match(arc1InjectSource, /paymentLinkEvidenceIssuedMs<Date\.now\(\)-5\*60\*1000/);

assert.deepEqual(contract.arc2.trigger.events, [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded"
]);
assert.equal(contract.arc2.trigger.async_payment_failed_alert_event, "checkout.session.async_payment_failed");
assert.equal(contract.arc2.trigger.durable_fulfillment_claim_before_authenticated_paid_validation_allowed, false);
assert.equal(contract.arc2.authoritative_session_retrieval.resource, "/v1/checkout/sessions/{CHECKOUT_SESSION_ID}?expand[]=line_items.data.price.product&expand[]=line_items.data.taxes&expand[]=payment_intent.latest_charge");
assert.equal(contract.arc2.authoritative_session_retrieval.stripe_api_version, "2026-07-29.dahlia");
assert.equal(contract.arc2.expected_payment_link_id, null);
assert.equal(contract.arc2.expected_price_id, null);
assert.equal(contract.arc2.required_session_contract.amount_subtotal, 500000);
assert.equal(contract.arc2.required_session_contract.amount_tax_minimum, 0);
assert.equal(contract.arc2.required_session_contract.amount_total_rule, "amount_subtotal + amount_tax");
assert.equal(contract.arc2.required_session_contract.line_item_total_rule, "amount_subtotal + amount_tax");
assert.equal(contract.arc2.required_session_contract.line_item_tax_rule, "expanded taxes sum equals Checkout Session total_details.amount_tax");
assert.equal(contract.arc2.required_session_contract.line_item_taxes_expand_required, true);
assert.equal(contract.arc2.required_session_contract.zero_tax_requires_known_taxability_reason, true);
assert.deepEqual(contract.arc2.required_session_contract.known_taxability_reasons,
  ["customer_exempt", "not_collecting", "not_subject_to_tax", "not_supported", "portion_product_exempt", "portion_reduced_rated", "portion_standard_rated",
    "product_exempt", "product_exempt_holiday", "proportionally_rated", "reduced_rated", "reverse_charge", "standard_rated", "taxable_basis_reduced", "zero_rated"]);
assert.match(contract.arc2.required_session_contract.not_collecting_rule, /without making a legal taxability conclusion/);
assert.match(contract.arc2.required_session_contract.customer_exempt_and_reverse_charge_rule, /ARC_TAX_REVIEW_REQUIRED/);
assert.match(contract.arc2.required_session_contract.not_supported_rule, /provider-support review/);
assert.equal(contract.arc2.required_session_contract.positive_tax_rule,
  "positive tax entries must use standard_rated; other recognized rated reasons require review");
assert.equal(contract.arc2.required_session_contract.livemode_rule, "must equal ARC_STRIPE_LIVE_MODE_ENABLED");
assert.deepEqual(contract.arc2.required_session_contract.id_pattern_by_mode, {
  test: "^cs_test_[A-Za-z0-9_]+$",
  live: "^cs_live_[A-Za-z0-9_]+$"
});
assert.equal(contract.arc2.required_session_contract.automatic_tax_status, "complete");
assert.equal(contract.arc2.required_session_contract.customer_address_status, "verified");
assert.equal(contract.arc2.required_session_contract.tax_registration_status, "historical_precheckout_snapshot");
assert.equal(contract.arc2.required_session_contract.product_tax_code_authority,
  "signed creation-time policy and receipt plus current authenticated Product observations on paid Link and Checkout line item");
assert.equal(contract.arc2.required_session_contract.authenticated_product_tax_code_readback_required, true);
assert.equal(contract.arc2.required_session_contract.product_tax_code_drift_allowed, false);
assert.equal(contract.arc2.required_session_contract.exactly_one_line_item_required, true);
assert.equal(contract.arc2.required_session_contract.checkout_reference_must_bind_immutable_approval_content_sha256, true);
assert.equal(contract.arc2.required_session_contract.checkout_reference_version, "arc-checkout-reference-v4");
assert.match(contract.arc2.required_session_contract.checkout_reference_hmac_message, /arc-checkout-reference-v4/);
assert.equal(contract.arc2.required_session_contract.checkout_reference_pattern, "^v4_[A-Za-z0-9_-]{135}$");
assert.equal(contract.arc2.required_session_contract.checkout_reference_exact_length, 138);
assert.equal(contract.arc2.required_session_contract.checkout_ready_tag, "arc-checkout-ready-v4/{checkout_reference_sha256}");
assert.equal(contract.arc2.required_session_contract.checkout_policy_version, "arc-private-checkout-policy-v2");
assert.equal(contract.arc2.required_session_contract.checkout_policy_scope, "one-approved-five-page-preview-one-private-payment-link");
assert.equal(contract.arc2.required_session_contract.offer_contract_id, "arc-fixed-five-page-offer-v1");
assert.equal(contract.arc2.required_session_contract.deliverable, "fixed-five-page-marketing-website-v1");
assert.equal(contract.arc2.required_session_contract.page_count, 5);
assert.deepEqual(contract.arc2.required_session_contract.preview_path_order,
  ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"]);
assert.equal(contract.arc2.required_session_contract.fresh_v3_or_mixed_pair_allowed, false);
assert.equal(contract.arc2.required_session_contract.exact_frozen_existing_v3_replay_only, true);
assert.equal(contract.arc2.required_session_contract.adult_acknowledgement_key, "adultpurchaserack");
assert.deepEqual(contract.arc2.required_session_contract.required_collected_names, ["business_name", "individual_name"]);
assert.equal(contract.arc2.checkout_configuration.automatic_tax_enabled, true);
assert.equal(contract.arc2.checkout_configuration.amount_subtotal_minor_units, 500000);
assert.equal(contract.arc2.checkout_configuration.active_tax_registration_readback_required, true);
assert.equal(contract.arc2.checkout_configuration.washington_sales_tax_registration_required_before_arc_sale, true);
assert.equal(contract.arc2.checkout_configuration.destination_address_source, "stripe_checkout_customer_details.address");
assert.equal(contract.arc2.checkout_configuration.price_active_required_at_preflight, true);
assert.equal(contract.arc2.checkout_configuration.submit_type, "auto");
assert.equal(contract.arc2.checkout_configuration.payment_method_selection, "dynamic");
assert.equal(contract.arc2.checkout_configuration.completed_session_limit, 1);
assert.deepEqual(contract.arc2.checkout_configuration.name_collection, {
  business: { enabled: true, optional: false },
  individual: { enabled: true, optional: false }
});
assert.deepEqual(contract.arc2.stripe_public_details_urls, {
  terms_path: "/terms/",
  privacy_path: "/privacy/",
  live_configuration_verified: false
});
assert.match(arc2ResolverSource, /expand%5B%5D=line_items\.data\.price\.product/);
assert.match(arc2ResolverSource, /const STRIPE_API_VERSION = "2026-07-29\.dahlia"/);
assert.match(arc2ResolverSource, /https:\/\/api\.stripe\.com\/v1\/account/);
assert.match(arc2ResolverSource, /ARC_STRIPE_ACCOUNT_INVALID/);
assert.match(arc2ResolverSource, /automatic_tax\?\.status !== "complete"/);
assert.match(arc2ResolverSource, /adultpurchaserack/);
assert.match(arc2ResolverSource, /arc-checkout-reference-v4/);
assert.match(arc2ResolverSource, /private_link_reverse_state/);
assert.match(arc2ResolverSource, /arc-checkout-ready-v4/);
assert.match(arc2ResolverSource, /one-approved-five-page-preview-one-private-payment-link/);
assert.match(arc2ResolverSource, /arc2-handoff-artifact-evidence-v4/);
assert.match(arc2ResolverSource, /arc2-payment-evidence-v4/);
assert.doesNotMatch(arc2ResolverSource, /arc-checkout-reference-v3|arc-checkout-ready-v3|production_content_base64/);
assert.match(arc1PrivateCheckoutSource, /MUTATION_STARTED/);
assert.match(arc1PrivateCheckoutSource, /starting_after/);
assert.doesNotMatch(arc1PrivateCheckoutSource,/payment_method_types/);
assert.equal(contract.arc1.private_checkout_link.automation_enabled,false);
assert.equal(contract.arc1.private_checkout_link.durable_cas_adapter_verified,false);
assert.equal(contract.arc1.private_checkout_link.payment_method_selection,"dynamic");
assert.equal(contract.arc1.private_checkout_link.offer_snapshot_version,"arc-checkout-offer-snapshot-v2");
assert.equal(contract.arc1.private_checkout_link.recipient_reservation_version,"arc1-checkout-recipient-reservation-v2");
assert.equal(contract.arc1.private_checkout_link.readiness_core_version,"arc1-preview-readiness-core-v2");
assert.equal(contract.arc1.private_checkout_link.readiness_observation_version,"arc1-preview-readiness-observation-v2");
assert.equal(contract.arc1.private_checkout_link.checkout_policy_version,"arc-private-checkout-policy-v2");
assert.equal(contract.arc1.private_checkout_link.checkout_reference_version,"arc-checkout-reference-v4");
assert.equal(contract.arc1.private_checkout_link.offer_contract_id,"arc-fixed-five-page-offer-v1");
assert.equal(contract.arc1.private_checkout_link.deliverable,"fixed-five-page-marketing-website-v1");
assert.equal(contract.arc1.private_checkout_link.page_count,5);
assert.deepEqual(contract.arc1.private_checkout_link.preview_path_order,["about/index.html","contact/index.html","process/index.html","services/index.html","index.html"]);
assert.equal(contract.arc1.private_checkout_link.reverse_index_authority,"authenticated-session-payment-link-id-to-v4-reference");
assert.match(arc1PrivateCheckoutSource,/arc-checkout-offer-snapshot-signature-v2/);
assert.match(arc1PrivateCheckoutSource,/arc1-checkout-recipient-reservation-signature-v2/);
assert.match(arc1PrivateCheckoutSource,/arc1-preview-readiness-core-signature-v2/);
assert.match(arc1PrivateCheckoutSource,/arc1-preview-readiness-observation-signature-v2/);
assert.match(arc1PrivateCheckoutSource,/arc-checkout-reference-v4/);
assert.match(arc1PrivateCheckoutSource,/arc-checkout-ready-v4/);
assert.doesNotMatch(arc1PrivateCheckoutSource,/arc-checkout-reference-v3|arc-checkout-ready-v3|arc_v3_ref/);
assert.equal(contract.arc1.private_checkout_link.renewable_provider_offer_readiness_verified,true);
assert.equal(contract.arc1.private_checkout_link.offer_expiry_and_link_deactivation_verified,true);
assert.deepEqual(contract.arc1.private_checkout_link.unpaid_link_lifecycle.phases,["ENROLL_ACTIVE","REQUEST_DEACTIVATION","CONFIRM_DEACTIVATION","AUTHORIZE_RENEWAL","FINALIZE_RENEWAL"]);
assert.deepEqual(contract.arc1.private_checkout_link.unpaid_link_lifecycle.states,["ACTIVE","DEACTIVATION_AUTHORIZED","DEACTIVATED","RENEWAL_AUTHORIZED"]);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.contract_verified,true);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.lifecycle_enabled,false);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.state_commit_enabled,false);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.deactivation_adapter_enabled,false);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.renewal_adapter_enabled,false);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.provider_adapter_live_verified,false);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.provider_adapter_direct_network_access_allowed,false);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.checkout_url_output_allowed,false);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.maximum_renewal_preflight_age_seconds,120);
assert.equal(contract.arc1.private_checkout_link.unpaid_link_lifecycle.payment_method_selection,"dynamic");
assert.match(arc1PrivateCheckoutLifecycleSource,/DEACTIVATION_AUTHORIZED/);
assert.match(arc1PrivateCheckoutLifecycleSource,/rerun offer and tax readiness immediately before/);
assert.match(arc1PrivateCheckoutLifecycleSource,/post-create offer\/tax and preview-readiness reruns/);
assert.doesNotMatch(arc1PrivateCheckoutLifecycleSource,/api\.stripe\.com|stripe_api_key|\bfetch\s*\(|payment_method_types/i);

const flow = contract.arc2.required_future_flow;
assert.deepEqual(flow, [
  "zapier/arc2_resolve_and_finalize.js",
  "private-state/create-or-exact-client-reference-mismatch-review-if-required",
  "/internal/stripe/reversal-binding from signed payment_intent_id+charge_id",
  "/internal/stripe/reversal-recheck authenticated-current-provider-state",
  "private-state/PAYMENT_VERIFIED-to-SITE_INTENT",
  "netlify/create-arc-controlled-site",
  "private-state/SITE_CREATED",
  "netlify/deploy-signed-claimable-bundle",
  "private-state/PRECLAIM_DEPLOY_READY",
  "netlify/enable-form-detection-and-configure-recipient-hook",
  "browser/submit-synthetic-probe-through-rendered-form",
  "inbox-provider/issue-authoritative-receipt-attestation",
  "zapier/arc2_verify_lead_route_staging.js",
  "private-state/LEAD_ROUTE_VERIFIED",
  "claim-service/atomically-reserve-invitation-ready-outbox-and-recoverable-bearer",
  "private-state/INVITATION_READY",
  "email-provider/send-claim-invitation-with-durable-idempotency",
  "future-claim-wrapper/replay-safe-bearer-exchange",
  "future-private-state/CLAIM_WRAPPER_CONSUMED",
  "netlify/unsigned-claim-webhook-hint",
  "private-state/CLAIM_CALLBACK_RECEIVED",
  "netlify/verify-claimed-destination-account",
  "private-state/CLAIMED_VERIFIED",
  "netlify/redeploy-and-reverify-exact-final-bundle",
  "private-state/FINAL_DEPLOY_READY",
  "zapier/arc2_delivery_email_gate.js",
  "email-provider/send-final-delivery-with-durable-idempotency",
  "private-state/DELIVERED"
]);
assert.deepEqual(contract.arc2.conditional_lead_route.not_required,[
  "resolver-proves-no-form-and-empty-lead-route-fields",
  "site-skips-arc2_verify_lead_route_staging",
  "site-transitions-PRECLAIM_DEPLOY_READY-directly-to-INVITATION_READY"
]);
assert.equal(contract.arc2.conditional_lead_route.caller_lead_route_status_authoritative,false);
assert.deepEqual(contract.arc2.reversal_binding_and_recheck.signed_payment_fields,["checkout_session_id","payment_intent_id","charge_id","stripe_account_id_sha256","livemode"]);
assert.equal(contract.arc2.reversal_binding_and_recheck.binding_enabled,false);
assert.equal(contract.arc2.reversal_binding_and_recheck.recheck_enabled,false);
assert.equal(contract.arc2.reversal_binding_and_recheck.binding_endpoint,"/internal/stripe/reversal-binding");
assert.equal(contract.arc2.reversal_binding_and_recheck.recheck_endpoint,"/internal/stripe/reversal-recheck");
assert.equal(contract.arc2.reversal_binding_and_recheck.producer,null);
assert.equal(contract.arc2.reversal_binding_and_recheck.caller_verified,false);
assert.equal(contract.arc2.reversal_binding_and_recheck.live_configuration_verified,false);
for (const legacy of contract.arc2.legacy_steps_not_in_live_flow) assert.equal(flow.includes(legacy), false);
assert.equal(contract.arc2.legacy_steps_fail_closed, true);
for (const source of [legacyPublishSource, legacyMergeSource, legacyControlSource]) {
  assert.match(source.split("\n").slice(0, 4).join("\n"), /throw new Error\("ARC_LEGACY_HANDOFF_DISABLED:/);
}
assert.deepEqual(contract.arc2.fulfillment_idempotency, {
  dedupe_key: "arc2:{checkout_session_id}",
  authenticated_paid_validation_required_before_claim: true,
  atomic_create_or_compare_and_set_required: true,
  authoritative_private_state_provider: null,
  live_configuration_verified: false,
  duplicate_delivery_allowed: false
});
assert.deepEqual(contract.arc2.payment_reversal_handling, {
  required_events: ["charge.dispute.closed", "charge.dispute.created", "charge.dispute.funds_reinstated", "charge.dispute.funds_withdrawn", "charge.dispute.updated", "charge.refunded", "refund.created", "refund.failed", "refund.updated"],
  automatic_refund_or_dispute_actions_enabled: false,
  halt_undelivered_fulfillment_on_verified_reversal_required: true,
  post_delivery_incident_review_required: true,
  authoritative_event_and_state_provider: null,
  live_configuration_verified: false
});

assert.equal(contract.arc2.publish_mode, "netlify-deploy-and-claim");
assert.equal(contract.arc2.github_delivery_repository_required, false);
assert.equal(contract.arc2.github_delivery_pr_allowed, false);
assert.equal(contract.arc2.customer_github_account_required, false);
assert.equal(contract.arc2.deploy_artifacts.minimum_count, 6);
assert.equal(contract.arc2.deploy_artifacts.maximum_count, 9);
assert.deepEqual(contract.arc2.deploy_artifacts.required_paths,
  ["_headers", "about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"]);
assert.deepEqual(contract.arc2.deploy_artifacts.conditionally_allowed_paths, ["assets/{sha256}.{png|jpg|webp}"]);
assert.equal(contract.arc2.deploy_artifacts.exact_order,
  "_headers, sorted content-addressed assets, about/index.html, contact/index.html, process/index.html, services/index.html, index.html");
assert.equal(contract.arc2.deploy_artifacts.maximum_asset_count, 3);
assert.equal(contract.arc2.deploy_artifacts.maximum_asset_bytes, 1250000);
assert.equal(contract.arc2.deploy_artifacts.maximum_html_page_bytes, 150000);
assert.equal(contract.arc2.deploy_artifacts.maximum_aggregate_html_bytes, 500000);
assert.equal(contract.arc2.deploy_artifacts.maximum_headers_bytes, 10000);
assert.equal(contract.arc2.deploy_artifacts.maximum_aggregate_bytes, 3510000);
assert.equal(contract.arc2.deploy_artifacts.maximum_asset_aggregate_bytes, 3000000);
assert.equal(contract.arc2.deploy_artifacts.maximum_deploy_artifacts_json_bytes, 4700000);
assert.equal(contract.arc2.deploy_artifacts.maximum_start_request_bytes, 5000000);
assert.equal(contract.arc2.deploy_artifacts.contact_only_exact_netlify_form_or_no_form_required, true);
assert.equal(contract.arc2.deploy_artifacts.additional_paths_require_new_signed_evidence_version, true);
assert.deepEqual(contract.arc2.deploy_artifacts.forbidden_paths, ["USAGE.md", ".arc-handoff.json", "netlify.toml"]);
assert.equal(contract.arc2.deploy_artifacts.public_artifact_pii_or_secrets_allowed, false);
assert.deepEqual(contract.arc2.artifact_evidence_gate.required_manifest_fields, ["path", "sha256", "size"]);
assert.equal(contract.arc2.artifact_evidence_gate.evidence_version, "arc2-handoff-artifact-evidence-v4");
assert.equal(contract.arc2.artifact_evidence_gate.signature_prefix, "arc2-handoff-artifact-evidence-signature-v4\\n");
assert.match(contract.arc2.artifact_evidence_gate.production_content_digest_scope, /exact five production HTML pages/);
assert.match(contract.arc2.artifact_evidence_gate.bundle_fingerprint_scope, /full exact artifact vector/);
assert.equal(contract.arc2.artifact_evidence_gate.self_contained_asset_bytes_required, true);
assert.equal(contract.arc2.artifact_evidence_gate.preview_host_references_allowed, false);
assert.equal(contract.arc2.artifact_evidence_gate.immutable_preview_source_commit_required, true);
assert.deepEqual(contract.arc2.self_contained_asset_handoff, {
  code_contract_implemented: true,
  automation_enabled: false,
  external_mapping_verified: false,
  source_step: "zapier/arc1_publish_function_assets.js",
  consumer_step: "zapier/arc2_resolve_and_finalize.js",
  required_private_inputs: [
    "asset_publication_receipt_private", "asset_publication_receipt_sha256",
    "asset_publication_receipt_hmac_sha256", "asset_publication_receipt_secret"
  ],
  resolve_main_once_to_immutable_commit: true,
  exact_receipt_tree_blob_binding_required: true,
  rewrite_to_content_addressed_local_paths: true,
  preview_host_references_allowed_after_rewrite: false,
  site_zip_raw_and_live_readback_required: true
});
assert.deepEqual(contract.arc2.state_machine.states, [
  "PAYMENT_VERIFIED", "SITE_INTENT", "SITE_CREATED", "PRECLAIM_DEPLOY_READY", "LEAD_ROUTE_VERIFIED",
  "INVITATION_READY", "CLAIM_WRAPPER_CONSUMED", "CLAIM_CALLBACK_RECEIVED", "CLAIMED_VERIFIED",
  "FINAL_DEPLOY_READY", "DELIVERED"
]);
assert.equal(contract.arc2.automatic_post_claim_transition_enabled, false);
assert.equal(contract.arc2.claim_invitation.transport, "POST Authorization: Bearer");
assert.equal(contract.arc2.claim_invitation.high_entropy_opaque_token_required, true);
assert.equal(contract.arc2.claim_invitation.deterministic_token_derivation_allowed, true);
assert.deepEqual(contract.arc2.claim_invitation.implemented_state_model, ["INVITATION_READY", "CLAIM_WRAPPER_CONSUMED"]);
assert.deepEqual(contract.arc2.claim_invitation.recommended_future_states, ["INVITATION_READY", "CLAIM_WRAPPER_CONSUMED"]);
assert.equal(contract.arc2.claim_invitation.current_state_transition_implemented, true);
assert.equal(contract.arc2.claim_invitation.token_in_url_path_allowed, false);
assert.equal(contract.arc2.claim_invitation.token_in_url_query_allowed, false);
assert.equal(contract.arc2.claim_invitation.browser_fragment_bridge_allowed, true);
assert.equal(contract.arc2.claim_invitation.fragment_must_be_cleared_before_same_origin_post, true);
assert.equal(contract.arc2.claim_invitation.invitation_ux_implemented, false);
assert.equal(contract.arc2.claim_invitation.durable_invitation_ready_outbox_implemented, true);
assert.equal(contract.arc2.claim_invitation.ready_state_is_email_delivery_proof, false);
assert.equal(contract.arc2.claim_invitation.separate_provider_delivery_receipt_required, true);
assert.equal(contract.arc2.claim_invitation.issuance_enabled, false);
assert.equal(contract.arc2.final_delivery_email.signed_claim_state_evidence_version, "arc2-claim-state-evidence-v3");
assert.equal(contract.arc2.final_delivery_email.signed_claim_state_evidence_scope, "netlify-deploy-and-claim-final-deploy");
assert.equal(contract.arc2.final_delivery_email.source_pat_post_claim_read_assumed, false);
assert.equal(contract.arc2.final_delivery_email.separate_customer_authorized_readback_or_live_capability_proof_required, true);
assert.equal(contract.arc2.final_delivery_email.signed_payment_evidence_version, "arc2-payment-evidence-v4");
assert.equal(contract.arc2.final_delivery_email.signed_artifact_evidence_version, "arc2-handoff-artifact-evidence-v4");
assert.equal(contract.arc2.final_delivery_email.private_checkout_policy_version, "arc-private-checkout-policy-v2");
assert.equal(contract.arc2.final_delivery_email.exact_five_page_manifest_and_whole_site_digest_required, true);
assert.equal(contract.arc2.final_delivery_email.claim_state_transitively_proves_fresh_final_deploy_readback, true);
assert.equal(contract.arc2.final_delivery_email.provider_send_performed_by_gate, false);
assert.equal(contract.arc2.final_delivery_email.state_write_allowed_by_gate, false);
assert.equal(contract.arc2.final_delivery_email.automation_enabled, false);
assert.equal(contract.arc2.final_delivery_email.activation_allowed, false);
assert.equal(contract.arc2.payment_evidence_gate.evidence_version, "arc2-payment-evidence-v4");
assert.equal(contract.arc2.payment_evidence_gate.evidence_scope, "authoritative-stripe-checkout-session");
assert.equal(contract.arc2.payment_evidence_gate.taxability_reasons_retained_in_signed_evidence, true);
assert.equal(contract.arc2.payment_evidence_gate.line_item_taxes_sha256_retained_in_signed_evidence, true);
assert.equal(contract.arc2.payment_evidence_gate.signature_prefix, "arc2-payment-evidence-signature-v4\\n{mode}\\n");
assert.match(emailGateSource, /FINAL_DEPLOY_READY/);
assert.match(emailGateSource, /netlify-deploy-and-claim-final-deploy/);
assert.match(emailGateSource, /claim_recipient_email_sha256/);
assert.match(emailGateSource, /retiredKeys/);
assert.doesNotMatch(emailGateSource, /businessName/);

assert.equal(contract.lead_routing.authoritative_inbox_attestation.source, null);
assert.equal(contract.lead_routing.authoritative_inbox_attestation.external_configuration_verified, false);
assert.equal(contract.lead_routing.caller_status_string_is_authoritative, false);
assert.equal(contract.lead_routing.maximum_receipt_age_seconds, 1800);
assert.equal(contract.lead_routing.maximum_age_when_evidence_is_issued_seconds, 1800);
assert.equal(contract.lead_routing.maximum_future_clock_skew_seconds, 300);
assert.equal(contract.lead_routing.handoff_artifact_evidence_version, "arc2-handoff-artifact-evidence-v4");
assert.deepEqual(contract.lead_routing.exact_five_page_path_order,
  ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"]);
assert.equal(contract.lead_routing.whole_site_production_digest_required, true);
assert.equal(contract.lead_routing.contact_only_form_action, "/contact/?submitted=1");
assert.equal(contract.lead_routing.no_form_bypass_requires_empty_route_bindings, true);
assert.deepEqual(contract.lead_routing.required_evidence_fields, [
  "preview_folder", "production_content_sha256", "artifact_manifest_sha256",
  "handoff_artifact_evidence_sha256", "bundle_fingerprint", "netlify_account_id",
  "staging_site_id", "staging_site_url", "staging_deploy_id", "staging_deploy_url",
  "deploy_file_manifest_sha256", "served_html_sha256", "staging_robots_header_sha256",
  "staging_form_id", "notification_hook_id", "form_name", "recipient_hmac_sha256",
  "synthetic_submission_id", "synthetic_probe_sha256", "netlify_submission_timestamp",
  "inbox_provider", "inbox_account_hmac_sha256", "inbox_message_id_hmac_sha256",
  "inbox_received_timestamp", "inbox_receipt_evidence_sha256"
]);
assert.deepEqual(contract.lead_routing.authoritative_inbox_attestation, {
  required: true,
  source: null,
  external_configuration_verified: false,
  evidence_version: "arc-inbox-receipt-evidence-v1",
  evidence_scope: "authoritative-inbox-delivery",
  signature_algorithm: "HMAC-SHA-256",
  signature_secret_source: "ARC_INBOX_RECEIPT_EVIDENCE_SECRET",
  separate_signing_secret_required: true,
  maximum_age_when_lead_route_evidence_is_issued_seconds: 1800,
  must_be_at_or_after_netlify_submission: true,
  required_evidence_fields: [
    "provider", "account_hmac_sha256", "recipient_hmac_sha256", "synthetic_submission_id",
    "synthetic_probe_sha256", "message_id_hmac_sha256", "inbox_received_timestamp"
  ],
  raw_account_id_or_message_id_allowed: false
});
assert.deepEqual(contract.lead_routing.verifier.authoritative_netlify_api_reads_required, [
  "GET /sites/{site_id}",
  "GET /sites/{site_id}/deploys/{deploy_id}",
  "GET /sites/{site_id}/files",
  "GET /sites/{site_id}/files/{file_path} (original raw bytes)",
  "GET /sites/{site_id}/snippets",
  "GET /sites/{site_id}/forms",
  "GET /hooks?site_id={site_id}",
  "GET /forms/{form_id}/submissions"
]);
for (const field of [
  "read_only", "exact_published_deploy_required", "exact_original_uploaded_artifact_bytes_required",
  "all_five_original_html_pages_required", "all_five_live_processed_pages_required",
  "documented_netlify_post_processing_transform_required", "immutable_and_current_processed_html_must_match",
  "exact_manifest_and_no_snippets_required", "unique_exact_form_required",
  "unique_synthetic_submission_required", "enabled_exact_recipient_hook_required",
  "synthetic_probe_submitted_through_rendered_project_details_control", "contact_only_form_required_when_mode_is_netlify_form",
  "no_form_provider_checks_bypassed_only_when_signed_mode_is_not_required"
]) assert.equal(contract.lead_routing.verifier[field], true, `lead verifier ${field} must remain required`);
assert.equal(contract.lead_routing.verifier.write_methods_allowed, false);
assert.equal(contract.lead_routing.verifier.raw_recipient_or_probe_in_evidence_allowed, false);
assert.deepEqual(contract.lead_routing.staging_site, {
  temporary: true,
  arc_account_id_must_equal_static_config: true,
  hostname_prefix: "arc-lead-route-",
  hostname_suffix: ".netlify.app",
  immutable_deploy_url_required: true,
  staging_x_robots_tag_required: "noindex,nofollow,noarchive",
  exact_source_bytes_and_expected_processed_html_required: true,
  cleanup_after_customer_delivery_receipt_required: true
});
assert.deepEqual(contract.lead_routing.replay_policy, {
  same_exact_delivery_revalidation_allowed: true,
  cross_artifact_replay_allowed: false,
  cross_recipient_replay_allowed: false,
  cross_site_or_deploy_replay_allowed: false,
  stale_receipt_replay_allowed: false
});
for (const field of [
  "stripe_customer_email_allowed", "stripe_customer_details_email_allowed", "public_artifact_recipient_allowed",
  "public_evidence_allowed", "raw_recipient_public_allowed"
]) assert.equal(contract.lead_routing[field], false);
assert.match(leadRouteSource, /exactAttribute\(attrs, "action"\) !== "\/contact\/\?submitted=1"/);
assert.match(leadRouteSource, /By submitting this form/);
assert.equal(contract.email_outbox.claim_must_be_atomic, true);
assert.equal(contract.email_outbox.send_only_after_claim, true);
assert.deepEqual(contract.email_outbox, {
  storage: "private-durable-store",
  provider: "Zapier Tables",
  table_write_required_before_email: true,
  public_marker_allowed: false,
  applies_to: ["arc1-preview-email", "arc2-claim-invitation-email", "arc2-final-delivery-email"],
  states: ["PENDING", "CLAIMED", "SENT"],
  allowed_transitions: ["PENDING->CLAIMED", "CLAIMED->SENT"],
  claim_must_be_atomic: true,
  send_only_after_claim: true,
  claimed_but_unsent: {
    automatic_resend_allowed: false,
    arc1_exact_claimed_replay_reauthorization_allowed: true,
    arc1_replay_must_reuse_email_provider_idempotency_key: true,
    alert_required: true,
    manual_recovery_required: true
  }
});
assert.deepEqual(contract.github_controls, {
  observed_at: "2026-08-25",
  ruleset_id: 20730518,
  ruleset_enforcement: "active",
  main_branch_protected: true,
  pull_request_required: true,
  required_check_configured: true,
  required_check_name: "ARC preview quality/preview-quality",
  required_check_app_slug: "github-actions",
  required_check_app_id: 15368,
  required_approving_review_count: 0,
  strict_required_check: false,
  deletions_blocked: true,
  non_fast_forward_updates_blocked: true,
  bypass_actor_count: 0,
  squash_merge_only_for_automation: true,
  observation_is_point_in_time: true,
  external_verification_required: true
});
assert.equal(contract.terms_and_legal_retention.live_retention_verified, false);
assert.equal(contract.asset_provenance.live_storage_and_license_workflow_verified, false);
assert.equal(contract.asset_provenance.remote_hotlink_only_delivery_allowed, false);
assert.equal(contract.analytics.live_configuration_verified, false);
assert.equal(contract.browser_qa.real_safari_verified, false);
assert.equal(contract.browser_qa.real_firefox_verified, false);
assert.equal(contract.post_handoff_operations.staging_cleanup_verified, false);
assert.equal(contract.post_handoff_operations.customer_delivery_receipt_verified, false);

assert.deepEqual(contract.synthetic_validation, {
  source: "tests/five_stripe_test_e2e_contract.mjs",
  simulator: "scripts/test_mode_e2e_simulator.mjs",
  provider_neutral: true,
  network_calls_allowed: false,
  external_state_mutation_allowed: false,
  external_provider_proof: false,
  satisfies_required_test_scenarios: false,
  stripe_mode: "test",
  stripe_api_version: "2026-07-29.dahlia",
  billing_address_collection: "required",
  niches: ["roofing", "hvac", "remodeling", "landscaping", "auto-detailing"],
  scenarios: ["paid-happy-path", "duplicate-replay", "unpaid-then-async-success", "expiry-deactivation-renewal", "refund-and-dispute-halt"]
});
assert.equal(contract.required_test_scenarios.every(item => item.stripe_test_e2e_verified === false), true,
  "Synthetic coverage must never be recorded as external Stripe verification");

assert.equal(Object.values(contract.external_verification).every(value => value === false), true);
for (const retiredExternalFlag of [
  "customer_authorization_redaction_verified", "customer_control_evidence_verified",
  "delivery_email_delivery_verified", "github_delivery_pr_merge_verified",
  "netlify_claim_deploy_handoff_verified", "private_delivery_ci_workflow_verified",
  "private_delivery_repository_verified", "secure_customer_handoff_verified"
]) assert.equal(contract.external_verification[retiredExternalFlag], false, `${retiredExternalFlag} must remain false`);
for (const unresolved of [
  "expected_payment_link_id", "expected_price_id", "expected_stripe_account_id_sha256",
  "expected_stripe_product_tax_code", "expected_stripe_tax_registrations_json", "stripe_public_details_terms_url",
  "stripe_public_details_privacy_url", "claim_service_origin", "claim_invitation_future_state_model",
  "arc2_private_state_provider", "payment_reversal_event_and_state_provider",
  "verified_lead_routing_recipient", "authoritative_inbox_provider", "verified_test_inbox",
  "netlify_post_claim_customer_authorized_readback_or_live_capability_proof",
  "content_addressed_asset_storage_and_license_workflow", "final_domain",
  "client_supplied_privacy_policy_url", "adult_contracting_representative", "legal_operator",
  "legal_entity", "mailing_address", "governing_venue", "branded_sender"
]) assert.equal(contract.unresolved[unresolved], null, `${unresolved} must remain unresolved`);
for (const retiredUnresolved of [
  "customer_authorization_broker", "customer_control_evidence_secret_configured",
  "customer_control_verifier_configuration", "private_delivery_repository_name",
  "private_delivery_repository_owner", "private_delivery_required_ci_workflow",
  "secure_customer_handoff_authority", "netlify_staging_cleanup_authority"
]) assert.equal(contract.unresolved[retiredUnresolved], null, `${retiredUnresolved} must remain null`);
assert.deepEqual(contract.gates.map(item => item.gate), [1, 2, 3, 4, 5, 6, 7]);
assert.equal(contract.gates.every(item => item.complete === false), true);

assert.doesNotMatch(contractText, /\bcs_(?:test|live)_[A-Za-z0-9]{6,}\b/);
assert.doesNotMatch(contractText, /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{6,}\b/);
assert.doesNotMatch(contractText, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);

console.log("ARC wiring passed: exact five-page v4 checkout evidence and claimable deploy flow remain fail-closed and all external gates unverified");
