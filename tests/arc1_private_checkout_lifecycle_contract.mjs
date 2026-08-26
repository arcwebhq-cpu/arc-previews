import assert from "node:assert/strict";
import {createHash,createHmac} from "node:crypto";
import {readFile} from "node:fs/promises";

const source=await readFile(new URL("../zapier/arc1_private_checkout_lifecycle.js",import.meta.url),"utf8");
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const runStep=new AsyncFunction("inputData","Buffer",source);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`:JSON.stringify(value);
const sha=value=>createHash("sha256").update(value).digest("hex");
const mac=(secret,message)=>createHmac("sha256",secret).update(message).digest("hex");
const iso=milliseconds=>new Date(milliseconds).toISOString();

const now=Date.now(),mode="test",kid="01";
const bindingSecret="arc-lifecycle-binding-secret-at-least-thirty-two-bytes";
const offerEvidenceSecret="arc-lifecycle-offer-evidence-secret-at-least-thirty-two";
const providerEvidenceSecret="arc-lifecycle-provider-evidence-secret-at-least-thirty-two";
const accountSha=sha("acct_ArcLifecycle"),referenceSha="a".repeat(64),readinessCoreSha="b".repeat(64);
const taxRegistrations=[{country:"US",id:"taxreg_ArcWashington",state:"WA",type:"state_sales_tax"}],taxRegistrationsSha=sha(canonical(taxRegistrations));
const previewFolder="summit-roofing-a1b2c3d4";
const previewPaths=["about/index.html","contact/index.html","process/index.html","services/index.html","index.html"].map(path=>`${previewFolder}/${path}`);
const approvalSha="7".repeat(64),publishedPreviewBundleSha="8".repeat(64),publishedSiteSha="9".repeat(64);
const stableConfiguration={stripe_account_id_sha256:accountSha,livemode:false,price_id:"price_ArcLifecycle5000",product_id:"prod_ArcLifecycleWebsite",
  amount_subtotal_minor_units:500000,currency:"usd",quantity:1,terms_version:"2026-08-25",terms_document_sha256:"c".repeat(64),automatic_tax_enabled:true,
  customer_address_source:"stripe_checkout_customer_details.address",price_tax_behavior:"exclusive",product_tax_code:"txcd_12345678",tax_contract_version:"arc-tax-v1",
  tax_settings_status:"active",tax_registrations:taxRegistrations,tax_registrations_sha256:taxRegistrationsSha,adult_acknowledgement_key:"adultpurchaserack",
  name_collection_required:true,submit_type:"auto",checkout_redirect_url:"https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}",stripe_api_version:"2026-07-29.dahlia"};
const offer=canonical({version:"arc-checkout-offer-snapshot-v2",scope:"immutable-approved-five-page-preview-private-checkout-offer",environment:"arc-production",checkout_binding_key_id:kid,
  offer_contract_id:"arc-fixed-five-page-offer-v1",deliverable:"fixed-five-page-marketing-website-v1",page_count:5,preview_folder:previewFolder,preview_paths:previewPaths,
  preview_source_repository:"arcwebhq-cpu/arc-previews",public_folder_prefix:"a1b2c3d4",approval_content_sha256:approvalSha,
  published_preview_bundle_sha256:publishedPreviewBundleSha,production_content_sha256:publishedSiteSha,render_bundle_sha256:"6".repeat(64),
  lead_route_mode:"netlify_form",lead_route_form_name:"summit-lead",
  lead_route_recipient_hmac_sha256:"d".repeat(64),asset_publication_receipt_sha256:"e".repeat(64),...stableConfiguration,
  configuration_sha256:sha(canonical(stableConfiguration))});
const offerSha=sha(offer),offerObject=JSON.parse(offer);
const policy=canonical({version:"arc-private-checkout-policy-v2",scope:"one-approved-five-page-preview-one-private-payment-link",checkout_binding_key_id:kid,stripe_mode:mode,
  stripe_account_id_sha256:accountSha,price_id:offerObject.price_id,product_id:offerObject.product_id,amount_subtotal_minor_units:500000,currency:"usd",quantity:1,
  terms_version:offerObject.terms_version,terms_document_sha256:offerObject.terms_document_sha256,automatic_tax_enabled:true,
  customer_address_source:offerObject.customer_address_source,price_tax_behavior:offerObject.price_tax_behavior,product_tax_code:offerObject.product_tax_code,
  tax_contract_version:offerObject.tax_contract_version,tax_registrations:taxRegistrations,tax_registrations_sha256:taxRegistrationsSha,
  adult_acknowledgement_key:"adultpurchaserack",name_collection_required:true,checkout_redirect_url:offerObject.checkout_redirect_url,completed_sessions_limit:1,
  stripe_api_version:"2026-07-29.dahlia",offer_contract_id:"arc-fixed-five-page-offer-v1",deliverable:"fixed-five-page-marketing-website-v1",page_count:5,
  preview_source_repository:"arcwebhq-cpu/arc-previews",preview_folder:previewFolder,preview_paths:previewPaths,approval_content_sha256:approvalSha,
  content_sha256:publishedPreviewBundleSha,published_site_sha256:publishedSiteSha,source_commit_sha:"1".repeat(40),source_tree_sha:"2".repeat(40),
  asset_publication_receipt_sha256:offerObject.asset_publication_receipt_sha256,lead_route_recipient_hmac_sha256:offerObject.lead_route_recipient_hmac_sha256,
  claim_recipient_email_sha256:"f".repeat(64),readiness_core_sha256:readinessCoreSha,offer_snapshot_sha256:offerSha,recipient_reservation_sha256:"0".repeat(64)});
const policySha=sha(policy),initialLinkId="plink_ArcLifecycleInitial";
const receipt=canonical({version:"arc-private-checkout-link-receipt-v1",scope:"validated-one-use-private-payment-link",payment_link_id:initialLinkId,
  payment_link_url_sha256:"f".repeat(64),checkout_reference_sha256:referenceSha,checkout_policy_sha256:policySha,provider_intent_sha256:"1".repeat(64),
  create_request_sha256:"2".repeat(64),stripe_mode:mode,stripe_account_id_sha256:accountSha,credential_key_id:"arc-test-rak-v1",readback_sha256:"3".repeat(64)});

const offerEvidenceAt=(issuedMs,overrides={})=>{
  const raw=canonical({version:"arc1-checkout-offer-template-evidence-v1",scope:"authoritative-private-checkout-offer-template-preflight",
    ...stableConfiguration,configuration_sha256:offerObject.configuration_sha256,issued_at:iso(issuedMs),...overrides});
  return{raw,hmac:mac(offerEvidenceSecret,`arc1-checkout-offer-template-evidence-signature-v1\n${raw}`)};
};
const readinessAt=(issuedMs,currentMainTreeSha="2".repeat(40))=>{
  const raw=canonical({version:"arc1-preview-readiness-observation-v2",scope:"renewable-five-page-private-checkout-readiness-observation",readiness_core_sha256:readinessCoreSha,
    repository:"arcwebhq-cpu/arc-previews",preview_folder:previewFolder,preview_paths:previewPaths,current_main_sha:"4".repeat(40),current_main_tree_sha:currentMainTreeSha,
    current_main_published_preview_bundle_sha256:publishedPreviewBundleSha,pages_published_preview_bundle_sha256:publishedPreviewBundleSha,published_site_sha256:publishedSiteSha,
    issued_at:iso(issuedMs),expires_at:iso(issuedMs+10*60*1000)});
  return{raw,hmac:mac(bindingSecret,`arc1-preview-readiness-observation-signature-v2\n${mode}\n${raw}`)};
};
const providerEvidence=({operation,paymentLinkId=initialLinkId,predecessor="",active,observedMs,generation=0,commandSha="",completed=0,overrides={}})=>{
  const raw=canonical({version:"arc-private-checkout-provider-adapter-evidence-v1",scope:"private-unpaid-link-lifecycle-provider-readback",operation,
    operation_command_sha256:commandSha,generation,stripe_mode:mode,stripe_account_id_sha256:accountSha,checkout_reference_sha256:referenceSha,
    checkout_policy_sha256:policySha,configuration_sha256:offerObject.configuration_sha256,payment_link_id:paymentLinkId,predecessor_payment_link_id:predecessor,
    active,completed_sessions_count:completed,completed_sessions_limit:1,automatic_tax_enabled:true,dynamic_payment_methods:true,price_id:offerObject.price_id,
    product_id:offerObject.product_id,product_tax_code:offerObject.product_tax_code,url_sha256:"6".repeat(64),observed_at:iso(observedMs),...overrides});
  return{raw,hmac:mac(providerEvidenceSecret,`arc-private-checkout-provider-adapter-evidence-signature-v1\n${mode}\n${raw}`)};
};
const base={checkout_binding_key_id:kid,checkout_binding_secret:bindingSecret,payment_link_evidence_secret:offerEvidenceSecret,
  provider_adapter_evidence_secret:providerEvidenceSecret,checkout_offer_snapshot_private:offer,checkout_offer_snapshot_sha256:offerSha,
  checkout_offer_snapshot_hmac_sha256:mac(bindingSecret,`arc-checkout-offer-snapshot-signature-v2\n${mode}\n${offer}`),checkout_policy_private:policy,
  active_link_receipt_private:receipt,active_link_receipt_sha256:sha(receipt),
  active_link_receipt_hmac_sha256:mac(bindingSecret,`arc-private-checkout-link-receipt-signature-v1\n${mode}\n${receipt}`)};

assert.doesNotMatch(source,/api\.stripe\.com|stripe_api_key|\bfetch\s*\(|payment_method_types/i,"lifecycle step must be a pure adapter contract with dynamic methods");
const legacyOffer=canonical({...JSON.parse(offer),version:"arc-checkout-offer-snapshot-v1",scope:"immutable-approved-preview-private-checkout-offer"});
await assert.rejects(runStep({...base,phase:"ENROLL_ACTIVE",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  checkout_offer_snapshot_private:legacyOffer,checkout_offer_snapshot_sha256:sha(legacyOffer),
  checkout_offer_snapshot_hmac_sha256:mac(bindingSecret,`arc-checkout-offer-snapshot-signature-v1\n${mode}\n${legacyOffer}`)},Buffer),/offer snapshot/);
const legacyPolicy=canonical({...JSON.parse(policy),version:"arc-private-checkout-policy-v1",scope:"one-approved-preview-one-private-payment-link"});
await assert.rejects(runStep({...base,phase:"ENROLL_ACTIVE",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  checkout_policy_private:legacyPolicy},Buffer),/checkout policy/);
const initialObservation=providerEvidence({operation:"OBSERVE_ACTIVE",active:true,observedMs:now-2*60*60*1000});
await assert.rejects(runStep({...base,phase:"ENROLL_ACTIVE",provider_link_evidence_private:initialObservation.raw,
  provider_link_evidence_hmac_sha256:initialObservation.hmac},Buffer),/lifecycle gate is off/);
const enrolled=await runStep({...base,phase:"ENROLL_ACTIVE",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  private_checkout_link_ttl_seconds:"3600",provider_link_evidence_private:initialObservation.raw,provider_link_evidence_hmac_sha256:initialObservation.hmac},Buffer);
assert.equal(enrolled.status,"PRIVATE_UNPAID_LINK_LIFECYCLE_ENROLLED");
assert.equal(enrolled.provider_call_allowed,false);
assert.equal(enrolled.url_exposure_allowed,false);
const enrolledState=JSON.parse(enrolled.private_checkout_lifecycle_state);
assert.equal(enrolledState.status,"ACTIVE");
assert.equal(Date.parse(enrolledState.link_expires_at),Date.parse(enrolledState.link_activated_at)+3600_000);
assert.equal(enrolledState.offer_expires_at,enrolledState.link_expires_at,"the private commercial offer and unpaid Link must expire together");
assert.ok(Date.parse(enrolledState.link_expires_at)<now,"fixture Link must be explicitly expired and still require deactivation evidence");

await assert.rejects(runStep({...base,phase:"REQUEST_DEACTIVATION",private_checkout_lifecycle_enabled:"true",
  private_checkout_lifecycle_state:enrolled.private_checkout_lifecycle_state},Buffer),/deactivation adapter gate is off/);
const deactivationAuthorized=await runStep({...base,phase:"REQUEST_DEACTIVATION",private_checkout_lifecycle_enabled:"true",private_checkout_deactivation_adapter_enabled:"true",
  private_checkout_lifecycle_state:enrolled.private_checkout_lifecycle_state},Buffer);
assert.equal(deactivationAuthorized.provider_call_allowed,false);
assert.equal(deactivationAuthorized.provider_adapter_call_allowed_after_state_persist,true);
const deactivationCommand=JSON.parse(deactivationAuthorized.deactivation_adapter_command_private);
assert.equal(deactivationCommand.operation,"DEACTIVATE_UNPAID_LINK");
assert.equal(deactivationCommand.expected_completed_sessions_count,0);
assert.equal(deactivationCommand.requested_active,false);
assert.equal(deactivationCommand.dynamic_payment_methods_required,true);
assert.doesNotMatch(deactivationAuthorized.deactivation_adapter_command_private,/buy\.stripe\.com/);

const tampered=JSON.parse(deactivationAuthorized.private_checkout_lifecycle_state);tampered.link_expires_at=iso(now+86400_000);
await assert.rejects(runStep({...base,phase:"CONFIRM_DEACTIVATION",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  private_checkout_lifecycle_state:canonical(tampered),provider_link_evidence_private:initialObservation.raw,provider_link_evidence_hmac_sha256:initialObservation.hmac},Buffer),/state HMAC/);
const badPaidEvidence=providerEvidence({operation:"DEACTIVATE",active:false,observedMs:now-50000,commandSha:deactivationAuthorized.deactivation_adapter_command_sha256,completed:1});
await assert.rejects(runStep({...base,phase:"CONFIRM_DEACTIVATION",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  private_checkout_lifecycle_state:deactivationAuthorized.private_checkout_lifecycle_state,provider_link_evidence_private:badPaidEvidence.raw,
  provider_link_evidence_hmac_sha256:badPaidEvidence.hmac},Buffer),/exact unpaid Link state/);
const deactivatedEvidence=providerEvidence({operation:"DEACTIVATE",active:false,observedMs:now-50000,commandSha:deactivationAuthorized.deactivation_adapter_command_sha256});
const deactivated=await runStep({...base,phase:"CONFIRM_DEACTIVATION",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  private_checkout_lifecycle_state:deactivationAuthorized.private_checkout_lifecycle_state,provider_link_evidence_private:deactivatedEvidence.raw,
  provider_link_evidence_hmac_sha256:deactivatedEvidence.hmac},Buffer);
assert.equal(deactivated.status,"PRIVATE_UNPAID_LINK_DEACTIVATED");
assert.match(deactivated.deactivation_evidence_sha256,/^[a-f0-9]{64}$/);
assert.match(deactivated.deactivation_transition_receipt_sha256,/^[a-f0-9]{64}$/);

const predecessorInactive=providerEvidence({operation:"OBSERVE_INACTIVE",active:false,observedMs:now-40000,commandSha:deactivationAuthorized.deactivation_adapter_command_sha256});
const precreateOffer=offerEvidenceAt(now-35000),precreateReadiness=readinessAt(now-30000);
const legacyReadiness=canonical({version:"arc1-preview-readiness-observation-v1",scope:"renewable-private-checkout-readiness-observation",readiness_core_sha256:readinessCoreSha,
  current_main_sha:"4".repeat(40),current_main_html_sha256:publishedPreviewBundleSha,pages_content_sha256:publishedPreviewBundleSha,
  issued_at:iso(now-30000),expires_at:iso(now+9*60*1000)});
await assert.rejects(runStep({...base,phase:"AUTHORIZE_RENEWAL",private_checkout_lifecycle_enabled:"true",private_checkout_renewal_adapter_enabled:"true",
  private_checkout_lifecycle_state:deactivated.private_checkout_lifecycle_state,provider_link_evidence_private:predecessorInactive.raw,
  provider_link_evidence_hmac_sha256:predecessorInactive.hmac,payment_link_evidence_private:precreateOffer.raw,payment_link_evidence_hmac_sha256:precreateOffer.hmac,
  checkout_readiness_observation_private:legacyReadiness,
  checkout_readiness_observation_hmac_sha256:mac(bindingSecret,`arc1-preview-readiness-observation-signature-v1\n${mode}\n${legacyReadiness}`)},Buffer),/readiness observation/);
await assert.rejects(runStep({...base,phase:"AUTHORIZE_RENEWAL",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state:deactivated.private_checkout_lifecycle_state,
  provider_link_evidence_private:predecessorInactive.raw,provider_link_evidence_hmac_sha256:predecessorInactive.hmac,payment_link_evidence_private:precreateOffer.raw,
  payment_link_evidence_hmac_sha256:precreateOffer.hmac,checkout_readiness_observation_private:precreateReadiness.raw,
  checkout_readiness_observation_hmac_sha256:precreateReadiness.hmac},Buffer),/renewal adapter gate is off/);
const staleOffer=offerEvidenceAt(now-10*60*1000);
await assert.rejects(runStep({...base,phase:"AUTHORIZE_RENEWAL",private_checkout_lifecycle_enabled:"true",private_checkout_renewal_adapter_enabled:"true",
  private_checkout_lifecycle_state:deactivated.private_checkout_lifecycle_state,provider_link_evidence_private:predecessorInactive.raw,
  provider_link_evidence_hmac_sha256:predecessorInactive.hmac,payment_link_evidence_private:staleOffer.raw,payment_link_evidence_hmac_sha256:staleOffer.hmac,
  checkout_readiness_observation_private:precreateReadiness.raw,checkout_readiness_observation_hmac_sha256:precreateReadiness.hmac},Buffer),/rerun offer and tax readiness/);
const renewalAuthorized=await runStep({...base,phase:"AUTHORIZE_RENEWAL",private_checkout_lifecycle_enabled:"true",private_checkout_renewal_adapter_enabled:"true",
  private_checkout_lifecycle_state:deactivated.private_checkout_lifecycle_state,provider_link_evidence_private:predecessorInactive.raw,
  provider_link_evidence_hmac_sha256:predecessorInactive.hmac,payment_link_evidence_private:precreateOffer.raw,payment_link_evidence_hmac_sha256:precreateOffer.hmac,
  checkout_readiness_observation_private:precreateReadiness.raw,checkout_readiness_observation_hmac_sha256:precreateReadiness.hmac},Buffer);
assert.equal(renewalAuthorized.status,"PRIVATE_UNPAID_LINK_RENEWAL_AUTHORIZED");
assert.equal(renewalAuthorized.provider_call_allowed,false);
const renewalCommand=JSON.parse(renewalAuthorized.renewal_adapter_command_private);
assert.equal(renewalCommand.operation,"CREATE_RENEWED_UNPAID_LINK");
assert.equal(renewalCommand.dynamic_payment_methods_required,true);
assert.equal(renewalCommand.automatic_tax_enabled,true);
assert.equal(renewalCommand.expected_completed_sessions_count,0);
assert.ok(Date.parse(renewalCommand.expires_at)-Date.parse(renewalCommand.issued_at)<=120000);

const renewedLinkId="plink_ArcLifecycleRenewed",createdAt=now-10000;
const createdEvidence=providerEvidence({operation:"CREATE_RENEWAL",paymentLinkId:renewedLinkId,predecessor:initialLinkId,active:true,observedMs:createdAt,
  generation:1,commandSha:renewalAuthorized.renewal_adapter_command_sha256});
await assert.rejects(runStep({...base,phase:"FINALIZE_RENEWAL",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  private_checkout_lifecycle_state:renewalAuthorized.private_checkout_lifecycle_state,provider_link_evidence_private:createdEvidence.raw,
  provider_link_evidence_hmac_sha256:createdEvidence.hmac,payment_link_evidence_private:precreateOffer.raw,payment_link_evidence_hmac_sha256:precreateOffer.hmac,
  checkout_readiness_observation_private:precreateReadiness.raw,checkout_readiness_observation_hmac_sha256:precreateReadiness.hmac},Buffer),/rerun offer and tax readiness/,
  "pre-create proofs must not authorize finalization after provider creation");
const finalOffer=offerEvidenceAt(now-5000),finalReadiness=readinessAt(now-4000,"5".repeat(40));
const finalized=await runStep({...base,phase:"FINALIZE_RENEWAL",private_checkout_lifecycle_enabled:"true",private_checkout_lifecycle_state_commit_enabled:"true",
  private_checkout_lifecycle_state:renewalAuthorized.private_checkout_lifecycle_state,provider_link_evidence_private:createdEvidence.raw,
  provider_link_evidence_hmac_sha256:createdEvidence.hmac,payment_link_evidence_private:finalOffer.raw,payment_link_evidence_hmac_sha256:finalOffer.hmac,
  checkout_readiness_observation_private:finalReadiness.raw,checkout_readiness_observation_hmac_sha256:finalReadiness.hmac},Buffer);
assert.equal(finalized.status,"PRIVATE_UNPAID_LINK_RENEWAL_FINALIZED");
assert.equal(finalized.provider_call_allowed,false);
assert.equal(finalized.url_exposure_allowed,false);
const finalState=JSON.parse(finalized.private_checkout_lifecycle_state);
assert.equal(finalState.status,"ACTIVE");
assert.equal(finalState.generation,1);
assert.equal(finalState.payment_link_id,renewedLinkId);
assert.equal(finalState.previous_link_id_hmac_sha256,enrolledState.payment_link_id_hmac_sha256);
assert.equal(Date.parse(finalState.link_expires_at),createdAt+3600_000);
assert.equal(finalState.offer_expires_at,finalState.link_expires_at);
assert.match(finalized.renewal_transition_receipt_sha256,/^[a-f0-9]{64}$/);
assert.notEqual(finalized.final_offer_evidence_sha256,renewalCommand.offer_evidence_sha256,"finalization must retain a distinct post-create offer/tax proof");
assert.notEqual(finalized.final_readiness_observation_sha256,renewalCommand.readiness_observation_sha256,"finalization must retain a distinct post-create readiness proof");
assert.doesNotMatch(JSON.stringify(finalized),/buy\.stripe\.com/);

console.log("ARC1 unpaid private Link lifecycle contract passed: explicit expiry, signed deactivation, and double-fresh safe renewal remain provider-adapter-only and OFF.");
