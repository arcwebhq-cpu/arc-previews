import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures } from "../fixtures/v10_industries.mjs";
import { renderPreview } from "../scripts/arc_contract.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const siteRoot=path.resolve(root,process.env.ARC_SITE_DIR||"../arc-site");
const read=(base,relative)=>readFile(path.join(base,relative),"utf8");
const [template,injector,privateCheckout,privateCheckoutLifecycle,artifactAdapter,retiredResolver,deliveryGate,wiringText,siteCore,siteService,siteStart]=await Promise.all([
  read(root,"ARC_MASTER_TEMPLATE.html"),read(root,"zapier/arc1_inject.js"),read(root,"zapier/arc1_private_checkout_link.js"),
  read(root,"zapier/arc1_private_checkout_lifecycle.js"),read(root,"zapier/arc2_checkout_session_artifact_adapter.js"),
  read(root,"zapier/arc2_resolve_and_finalize.js"),read(root,"zapier/arc2_delivery_email_gate.js"),read(root,"zapier/wiring-contract.json"),
  read(siteRoot,"netlify/lib/arc2-handoff-core.mjs"),read(siteRoot,"netlify/lib/arc2-handoff-service.mjs"),read(siteRoot,"netlify/functions/arc2-handoff-start.mjs")
]);
const wiring=JSON.parse(wiringText),sha=value=>createHash("sha256").update(value).digest("hex");

for(const fixture of fixtures){
  const rendered=renderPreview(template,fixture.content,{trustedEventPrefix:"a1b2c3d4",customerEmail:fixture.customerEmail,
    leadNotificationEmail:`verified-${fixture.expectedProfile}@example.test`});
  assert.match(rendered.html,/data-arc-checkout-private/);
  assert.doesNotMatch(rendered.html,/buy\.stripe\.com|\bplink_|client_reference_id|v[34]_[A-Za-z0-9_-]{135}|arc-private-checkout-policy-v[12]/i);
  assert.equal(rendered.checkoutUrl,undefined);
  assert.equal(rendered.checkoutReference,undefined);
}

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const [name,source,args] of [
  ["injector",injector,["inputData"]],
  ["private checkout",privateCheckout,["inputData","fetch","Buffer"]],
  ["private checkout lifecycle",privateCheckoutLifecycle,["inputData","Buffer"]],
  ["Checkout Session artifact adapter",artifactAdapter,["inputData","fetch","Buffer"]],
  ["retired resolver shim",retiredResolver,["inputData","fetch","Buffer"]],
  ["delivery gate",deliveryGate,["inputData","Buffer"]]
])assert.doesNotThrow(()=>new AsyncFunction(...args,source),`${name} Code step must compile`);

for(const source of [privateCheckout,siteCore,deliveryGate]){
  assert.match(source,/arc-private-checkout-policy-v2/);
  assert.match(source,/arc2-payment-evidence-v4|arc-checkout-reference-v4/);
}
assert.doesNotMatch(privateCheckout,/payment_method_types/);
assert.doesNotMatch(artifactAdapter,/api\.stripe\.com|stripe_api_key|private_link_reverse_state|payment_link_id|buy\.stripe\.com|\bplink_|payment_method_types/i);
assert.match(retiredResolver,/throw new Error\("ARC2_RETIRED_RESOLVER:/);
assert.doesNotMatch(retiredResolver,/api\.stripe\.com|stripe_api_key|private_link_reverse_state|payment_link_id|buy\.stripe\.com|\bplink_/i);
assert.doesNotMatch(siteCore,/payment_method_types|payment_methods/);
assert.match(privateCheckout,/completed_sessions\]\[limit\].*1/s);
assert.match(privateCheckout,/state_hmac_sha256/);
assert.match(privateCheckout,/starting_after/);
assert.match(privateCheckoutLifecycle,/DEACTIVATION_AUTHORIZED/);
assert.match(privateCheckoutLifecycle,/rerun offer and tax readiness immediately before/);
assert.doesNotMatch(privateCheckoutLifecycle,/api\.stripe\.com|stripe_api_key|\bfetch\s*\(|payment_method_types/i);
assert.match(artifactAdapter,/arc-checkout-offer-snapshot-v2/);
assert.match(artifactAdapter,/arc2-handoff-artifact-evidence-v4/);
assert.match(artifactAdapter,/https:\/\/arcweb\.onl\/internal\/payment-arc2\/start/);
assert.match(artifactAdapter,/ARC2_CHECKOUT_SESSION_ADAPTER_PAUSED/);
assert.match(artifactAdapter,/checkout_session_id:\s*sessionId/);
assert.match(artifactAdapter,/claim_token:\s*claimToken/);
assert.match(artifactAdapter,/artifact_evidence:\s*artifactEvidence/);
assert.doesNotMatch(artifactAdapter,/payment_evidence\s*:/,
  "Artifact adapter must delegate payment evidence to the first-party worker.");
assert.doesNotMatch(siteCore,/ARC_EXPECTED_(?:PAYMENT_LINK_ID|PRICE_ID|PRODUCT_TAX_CODE)/);
assert.match(siteCore,/claim_recipient_email_sha256/);
assert.match(siteCore,/historical_precheckout_snapshot/);
assert.match(siteCore,/script-src-attr 'none'/);
assert.match(siteService,/checkout-reference-index/);
assert.match(siteService,/duplicate-payment-review/);
assert.match(siteService,/assertHandoffFulfillmentAllowed/);
assert.match(siteStart,/reversal_control_ready/);
assert.match(deliveryGate,/retired_checkout_binding_keys_json/);
assert.match(deliveryGate,/selectedCheckoutSecret/);
assert.match(deliveryGate,/reserved claim recipient/);
assert.doesNotMatch(deliveryGate,/expected_payment_link_id|expectedPriceId|arc2-payment-evidence-signature-v[23]/);

assert.equal(wiring.live_complete,false);
assert.equal(wiring.arc1.private_checkout_link.automation_enabled,false);
assert.equal(wiring.arc1.private_checkout_link.provider_mutation_enabled,false);
assert.equal(wiring.arc1.private_checkout_link.private_url_exposure_enabled,false);
assert.equal(wiring.arc1.private_checkout_link.ready_tag_mutation_enabled,false);
assert.equal(wiring.arc1.private_checkout_link.durable_cas_adapter_verified,false);
assert.deepEqual(wiring.arc1.private_checkout_link.phases,["PREPARE","AUTHORIZE_MUTATION","CREATE","PERSIST_REVERSE","ACTIVATE","FINALIZE"]);
assert.equal(wiring.arc1.private_checkout_link.payment_method_selection,"dynamic");
assert.equal(wiring.arc1.private_checkout_link.unpaid_link_lifecycle.lifecycle_enabled,false);
assert.equal(wiring.arc1.private_checkout_link.unpaid_link_lifecycle.deactivation_adapter_enabled,false);
assert.equal(wiring.arc1.private_checkout_link.unpaid_link_lifecycle.renewal_adapter_enabled,false);
assert.equal(wiring.arc1.private_checkout_link.unpaid_link_lifecycle.provider_adapter_live_verified,false);
assert.equal(wiring.arc2.payment_evidence_gate.evidence_version,"arc2-payment-evidence-v4");
assert.equal(wiring.arc2.artifact_evidence_gate.evidence_version,"arc2-handoff-artifact-evidence-v4");
assert.equal(wiring.provider_deployment_v11.roles.arc2.checkout_session_evidence_adapter,
  "zapier/arc2_checkout_session_artifact_adapter.js");
assert.equal(wiring.arc2.required_future_flow.includes("zapier/arc2_checkout_session_artifact_adapter.js"),true);
assert.equal(wiring.arc2.required_future_flow.includes("zapier/arc2_resolve_and_finalize.js"),false);
assert.equal(wiring.arc2.required_session_contract.checkout_reference_exact_length,138);
assert.equal(wiring.arc2.required_session_contract.checkout_reference_pattern,"^v4_[A-Za-z0-9_-]{135}$");
assert.equal(wiring.arc2.required_session_contract.checkout_identity_source,
  "approval-bound private Checkout Session binding with authenticated session.payment_link required null");
assert.equal(Object.values(wiring.external_verification).every(value=>value===false),true);
assert.equal(wiring.gates.every(item=>item.complete===false),true);

const publicSourceDigest=sha(fixtures.map(fixture=>renderPreview(template,fixture.content,{trustedEventPrefix:"a1b2c3d4"}).html).join("\n"));
assert.match(publicSourceDigest,/^[a-f0-9]{64}$/);
console.log(`ARC private-checkout pipeline contract passed (${fixtures.length} inert previews; ${publicSourceDigest.slice(0,12)})`);
