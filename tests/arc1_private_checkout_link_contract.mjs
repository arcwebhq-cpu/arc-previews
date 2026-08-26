import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const source=await readFile(new URL("../zapier/arc1_private_checkout_link.js",import.meta.url),"utf8");
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const runStep=new AsyncFunction("inputData","fetch","Buffer",source);
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`:JSON.stringify(value);
const sha=value=>createHash("sha256").update(value).digest("hex");
const mac=(secret,message)=>createHmac("sha256",secret).update(message).digest("hex");
const secret="checkout-binding-test-secret-at-least-thirty-two-bytes";
const kid="01";
const mode="test";
const accountId="acct_ArcPrivateCheckout";
const accountSha=sha(accountId);
const taxRegistrations=[{country:"US",id:"taxreg_ArcWashington",state:"WA",type:"state_sales_tax"}];
const taxRegistrationsSha=sha(canonical(taxRegistrations));
const previewFolder="summit-roofing-a1b2c3d4";
const previewPaths=["about/index.html","contact/index.html","process/index.html","services/index.html","index.html"].map(path=>`${previewFolder}/${path}`);
const approvalSha="c".repeat(64),publishedPreviewBundleSha="d".repeat(64),publishedSiteSha="e".repeat(64);
const stableConfiguration={stripe_account_id_sha256:accountSha,livemode:false,price_id:"price_ArcPrivateCheckout",product_id:"prod_ArcWebsiteService",
  amount_subtotal_minor_units:500000,currency:"usd",quantity:1,terms_version:"2026-08-25",terms_document_sha256:"a".repeat(64),automatic_tax_enabled:true,
  customer_address_source:"stripe_checkout_customer_details.address",price_tax_behavior:"exclusive",product_tax_code:"txcd_12345678",tax_contract_version:"arc-tax-v1",
  tax_settings_status:"active",tax_registrations:taxRegistrations,tax_registrations_sha256:taxRegistrationsSha,adult_acknowledgement_key:"adultpurchaserack",
  name_collection_required:true,submit_type:"auto",checkout_redirect_url:"https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}",stripe_api_version:"2026-07-29.dahlia"};
const offer=canonical({version:"arc-checkout-offer-snapshot-v2",scope:"immutable-approved-five-page-preview-private-checkout-offer",checkout_binding_key_id:kid,
  environment:"arc-production",offer_contract_id:"arc-fixed-five-page-offer-v1",deliverable:"fixed-five-page-marketing-website-v1",page_count:5,
  preview_folder:previewFolder,preview_paths:previewPaths,preview_source_repository:"arcwebhq-cpu/arc-previews",
  public_folder_prefix:"a1b2c3d4",lead_route_recipient_hmac_sha256:mac(secret,"arc-checkout-lead-recipient-v1\ntest\nleads@example.com"),
  lead_route_mode:"netlify_form",lead_route_form_name:"summit-lead",render_bundle_sha256:"6".repeat(64),
  approval_content_sha256:approvalSha,published_preview_bundle_sha256:publishedPreviewBundleSha,production_content_sha256:publishedSiteSha,
  asset_publication_receipt_sha256:"b".repeat(64),...stableConfiguration,configuration_sha256:sha(canonical(stableConfiguration))});
const offerSha=sha(offer);
const recipient=canonical({version:"arc1-checkout-recipient-reservation-v2",scope:"private-recipients-for-approved-five-page-checkout",
  offer_contract_id:"arc-fixed-five-page-offer-v1",deliverable:"fixed-five-page-marketing-website-v1",page_count:5,preview_folder:previewFolder,preview_paths:previewPaths,
  approval_content_sha256:approvalSha,published_preview_bundle_sha256:publishedPreviewBundleSha,production_content_sha256:publishedSiteSha,
  checkout_offer_snapshot_sha256:offerSha,checkout_binding_key_id:kid,stripe_mode:mode,lead_route_mode:"netlify_form",lead_route_form_name:"summit-lead",
  lead_route_recipient_hmac_sha256:JSON.parse(offer).lead_route_recipient_hmac_sha256,
  lead_notification_email:"leads@example.com",claim_recipient_email:"customer@example.com",claim_recipient_email_sha256:sha("customer@example.com")});
const recipientSha=sha(recipient),email="customer@example.com",emailToken="email-state-token";
const core=canonical({version:"arc1-preview-readiness-core-v2",scope:"immutable-five-page-private-checkout-content-and-recipient-readiness",repository:"arcwebhq-cpu/arc-previews",
  offer_contract_id:"arc-fixed-five-page-offer-v1",deliverable:"fixed-five-page-marketing-website-v1",page_count:5,
  preview_folder:previewFolder,preview_paths:previewPaths,preview_url:"https://arcwebhq-cpu.github.io/arc-previews/summit-roofing-a1b2c3d4/",
  approval_content_sha256:approvalSha,asset_publication_receipt_sha256:"b".repeat(64),checkout_offer_snapshot_sha256:offerSha,checkout_recipient_reservation_sha256:recipientSha,
  content_sha256:publishedPreviewBundleSha,published_preview_bundle_sha256:publishedPreviewBundleSha,published_site_sha256:publishedSiteSha,
  render_bundle_sha256:"6".repeat(64),lead_route_mode:"netlify_form",lead_route_form_name:"summit-lead",
  lead_route_recipient_hmac_sha256:JSON.parse(offer).lead_route_recipient_hmac_sha256,
  customer_email_sha256:sha(email),email_state_token_sha256:sha(emailToken),
  script_manifest_sha256:"1ef7f0088cdcf042b1593fbc11d7ea2d3c47e9ff92c94caf2f578179e3993685",
  head_sha:"1".repeat(40),merge_commit_sha:"2".repeat(40),source_tree_sha:"3".repeat(40),merged_at:"2026-08-13T20:00:00.000Z",pr_number:42,
  check_name:"ARC preview quality/preview-quality",check_app_slug:"github-actions",check_app_id:15368});
const coreSha=sha(core);
const observationAt=(issuedMs,expiresMs,currentMainSha="4".repeat(40),currentMainTreeSha="3".repeat(40))=>{
  const raw=canonical({version:"arc1-preview-readiness-observation-v2",scope:"renewable-five-page-private-checkout-readiness-observation",readiness_core_sha256:coreSha,
    repository:"arcwebhq-cpu/arc-previews",preview_folder:previewFolder,preview_paths:previewPaths,current_main_sha:currentMainSha,current_main_tree_sha:currentMainTreeSha,
    current_main_published_preview_bundle_sha256:publishedPreviewBundleSha,pages_published_preview_bundle_sha256:publishedPreviewBundleSha,published_site_sha256:publishedSiteSha,
    issued_at:new Date(issuedMs).toISOString(),expires_at:new Date(expiresMs).toISOString()});
  return {raw,hmac:mac(secret,`arc1-preview-readiness-observation-signature-v2\n${mode}\n${raw}`)};
};
const fresh=observationAt(Date.now()-1000,Date.now()+9*60*1000);
const base={checkout_binding_key_id:kid,checkout_binding_secret:secret,retired_checkout_binding_keys_json:"{}",checkout_offer_snapshot_private:offer,
  checkout_offer_snapshot_sha256:offerSha,checkout_offer_snapshot_hmac_sha256:mac(secret,`arc-checkout-offer-snapshot-signature-v2\n${mode}\n${offer}`),
  checkout_recipient_reservation_private:recipient,checkout_recipient_reservation_hmac_sha256:mac(secret,`arc1-checkout-recipient-reservation-signature-v2\n${mode}\n${recipient}`),
  checkout_readiness_core_private:core,checkout_readiness_core_sha256:coreSha,checkout_readiness_core_hmac_sha256:mac(secret,`arc1-preview-readiness-core-signature-v2\n${mode}\n${core}`),
  checkout_readiness_observation_private:fresh.raw,checkout_readiness_observation_hmac_sha256:fresh.hmac,stripe_credential_key_id:"arc-test-rak-v1",
  stripe_api_key:"rk_test_arc_private_checkout_1234567890",provider_operation_timeout_ms:"20000"};

await assert.rejects(runStep({...base,phase:"PREPARE"},()=>{throw new Error("network");},Buffer),/prepare gate is off/);
const prepared=await runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true"},()=>{throw new Error("network");},Buffer);
assert.equal(prepared.status,"PRIVATE_CHECKOUT_INTENT_PREPARE");
assert.equal(prepared.provider_write_allowed,false);
assert.equal(prepared.checkout_reference.length,138);
assert.match(prepared.checkout_reference,/^v4_[A-Za-z0-9_-]{135}$/);
assert.doesNotMatch(prepared.checkout_policy_private,/buy\.stripe\.com|plink_/i);
const preparedPolicy=JSON.parse(prepared.checkout_policy_private);
const packedReference=Buffer.from(prepared.checkout_reference.slice(3),"base64url"),referencePayload=packedReference.subarray(0,69);
assert.equal(packedReference.length,101);
assert.equal(referencePayload.subarray(0,1).toString("hex"),kid);
assert.equal(referencePayload.subarray(1,5).toString("hex"),"a1b2c3d4");
assert.equal(referencePayload.subarray(5,37).toString("hex"),approvalSha);
assert.equal(referencePayload.subarray(37,69).toString("hex"),prepared.checkout_policy_sha256);
assert.deepEqual(packedReference.subarray(69),createHmac("sha256",secret).update(`arc-checkout-reference-v4\narcwebhq-cpu/arc-previews\narc-production\nstripe-${mode}\n`).update(referencePayload).digest());
assert.equal(preparedPolicy.version,"arc-private-checkout-policy-v2");
assert.equal(preparedPolicy.scope,"one-approved-five-page-preview-one-private-payment-link");
assert.deepEqual(preparedPolicy.preview_paths,previewPaths);
assert.equal(preparedPolicy.offer_contract_id,"arc-fixed-five-page-offer-v1");
assert.equal(preparedPolicy.deliverable,"fixed-five-page-marketing-website-v1");
assert.equal(preparedPolicy.page_count,5);
assert.equal(preparedPolicy.published_site_sha256,publishedSiteSha);
assert.equal(Object.hasOwn(preparedPolicy,"preview_path"),false);
assert.equal(Object.hasOwn(preparedPolicy,"published_html_sha256"),false);
assert.equal(Object.hasOwn(preparedPolicy,"payment_method_types"),false);
assert.deepEqual(Object.keys(preparedPolicy).sort(),["adult_acknowledgement_key","amount_subtotal_minor_units","approval_content_sha256","asset_publication_receipt_sha256","automatic_tax_enabled","checkout_binding_key_id","checkout_redirect_url","claim_recipient_email_sha256","completed_sessions_limit","content_sha256","currency","customer_address_source","deliverable","lead_route_recipient_hmac_sha256","name_collection_required","offer_contract_id","offer_snapshot_sha256","page_count","preview_folder","preview_paths","preview_source_repository","price_id","price_tax_behavior","product_id","product_tax_code","published_site_sha256","quantity","readiness_core_sha256","recipient_reservation_sha256","scope","source_commit_sha","source_tree_sha","stripe_account_id_sha256","stripe_api_version","stripe_mode","tax_contract_version","tax_registrations","tax_registrations_sha256","terms_document_sha256","terms_version","version"].sort());
const noFormOffer=canonical({...JSON.parse(offer),lead_route_mode:"not_required",lead_route_form_name:"",lead_route_recipient_hmac_sha256:""});
const noFormOfferSha=sha(noFormOffer);
const noFormRecipient=canonical({...JSON.parse(recipient),checkout_offer_snapshot_sha256:noFormOfferSha,lead_route_mode:"not_required",lead_route_form_name:"",
  lead_route_recipient_hmac_sha256:"",lead_notification_email:""});
const noFormRecipientSha=sha(noFormRecipient);
const noFormCore=canonical({...JSON.parse(core),checkout_offer_snapshot_sha256:noFormOfferSha,checkout_recipient_reservation_sha256:noFormRecipientSha,
  lead_route_mode:"not_required",lead_route_form_name:"",lead_route_recipient_hmac_sha256:""});
const noFormCoreSha=sha(noFormCore);
const noFormObservation=canonical({...JSON.parse(fresh.raw),readiness_core_sha256:noFormCoreSha});
const noFormPrepared=await runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",checkout_offer_snapshot_private:noFormOffer,
  checkout_offer_snapshot_sha256:noFormOfferSha,checkout_offer_snapshot_hmac_sha256:mac(secret,`arc-checkout-offer-snapshot-signature-v2\n${mode}\n${noFormOffer}`),
  checkout_recipient_reservation_private:noFormRecipient,checkout_recipient_reservation_hmac_sha256:mac(secret,`arc1-checkout-recipient-reservation-signature-v2\n${mode}\n${noFormRecipient}`),
  checkout_readiness_core_private:noFormCore,checkout_readiness_core_sha256:noFormCoreSha,
  checkout_readiness_core_hmac_sha256:mac(secret,`arc1-preview-readiness-core-signature-v2\n${mode}\n${noFormCore}`),
  checkout_readiness_observation_private:noFormObservation,
  checkout_readiness_observation_hmac_sha256:mac(secret,`arc1-preview-readiness-observation-signature-v2\n${mode}\n${noFormObservation}`)},()=>{throw new Error("network");},Buffer);
assert.equal(JSON.parse(noFormPrepared.checkout_policy_private).lead_route_recipient_hmac_sha256,"");
let crossPairNetworkCalls=0;
const legacyOfferObject={...JSON.parse(offer),version:"arc-checkout-offer-snapshot-v1",scope:"immutable-approved-preview-private-checkout-offer"};
const legacyOffer=canonical(legacyOfferObject);
await assert.rejects(runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",checkout_offer_snapshot_private:legacyOffer,
  checkout_offer_snapshot_sha256:sha(legacyOffer),checkout_offer_snapshot_hmac_sha256:mac(secret,`arc-checkout-offer-snapshot-signature-v1\n${mode}\n${legacyOffer}`)},()=>{crossPairNetworkCalls+=1;throw new Error("network");},Buffer),/offer snapshot/);
const legacyCoreObject={...JSON.parse(core),version:"arc1-preview-readiness-core-v1"};
const legacyCore=canonical(legacyCoreObject);
await assert.rejects(runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",checkout_readiness_core_private:legacyCore,
  checkout_readiness_core_sha256:sha(legacyCore),checkout_readiness_core_hmac_sha256:mac(secret,`arc1-preview-readiness-core-signature-v1\n${mode}\n${legacyCore}`)},()=>{crossPairNetworkCalls+=1;throw new Error("network");},Buffer),/readiness core/);
for(const mismatchedCoreObject of [
  {...JSON.parse(core),offer_contract_id:"arc-wrong-offer-v1"},
  {...JSON.parse(core),deliverable:"wrong-deliverable-v1"},
  {...JSON.parse(core),page_count:1},
  {...JSON.parse(core),lead_route_recipient_hmac_sha256:"0".repeat(64)}
]){
  const mismatchedCore=canonical(mismatchedCoreObject);
  await assert.rejects(runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",checkout_readiness_core_private:mismatchedCore,
    checkout_readiness_core_sha256:sha(mismatchedCore),checkout_readiness_core_hmac_sha256:mac(secret,`arc1-preview-readiness-core-signature-v2\n${mode}\n${mismatchedCore}`)},
  ()=>{crossPairNetworkCalls+=1;throw new Error("network");},Buffer),/readiness core/);
}
const legacyRecipient=canonical({...JSON.parse(recipient),version:"arc1-checkout-recipient-reservation-v1",scope:"private-lead-recipient-for-approved-checkout"});
await assert.rejects(runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",checkout_recipient_reservation_private:legacyRecipient,
  checkout_recipient_reservation_hmac_sha256:mac(secret,`arc1-checkout-recipient-reservation-signature-v1\n${mode}\n${legacyRecipient}`)},()=>{crossPairNetworkCalls+=1;throw new Error("network");},Buffer),/recipient reservation/);
const reorderedOffer=canonical({...JSON.parse(offer),preview_paths:[...previewPaths].reverse()});
await assert.rejects(runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",checkout_offer_snapshot_private:reorderedOffer,
  checkout_offer_snapshot_sha256:sha(reorderedOffer),checkout_offer_snapshot_hmac_sha256:mac(secret,`arc-checkout-offer-snapshot-signature-v2\n${mode}\n${reorderedOffer}`)},()=>{crossPairNetworkCalls+=1;throw new Error("network");},Buffer),/offer snapshot/);
assert.equal(crossPairNetworkCalls,0,"all v1/v2 and path-order cross-pairs must fail before provider access");
const preparedReplay=await runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",private_checkout_intent_state:prepared.private_checkout_intent_state},()=>{throw new Error("network");},Buffer);
assert.equal(preparedReplay.status,"PRIVATE_CHECKOUT_INTENT_REUSED");
const v3Intent=canonical({...JSON.parse(prepared.private_checkout_intent_state),checkout_reference:`v3_${prepared.checkout_reference.slice(3)}`});
await assert.rejects(runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",private_checkout_intent_state:v3Intent},()=>{crossPairNetworkCalls+=1;throw new Error("network");},Buffer),/replay|CONFLICT/);
assert.equal(crossPairNetworkCalls,0,"a v3 reference cannot replay against the v4 policy");
const renewedAfterUnrelatedMain=observationAt(Date.now()-500,Date.now()+9*60*1000,"5".repeat(40),"6".repeat(40));
const renewedPrepared=await runStep({...base,phase:"PREPARE",private_checkout_prepare_enabled:"true",checkout_readiness_observation_private:renewedAfterUnrelatedMain.raw,
  checkout_readiness_observation_hmac_sha256:renewedAfterUnrelatedMain.hmac,private_checkout_intent_state:prepared.private_checkout_intent_state},()=>{throw new Error("network");},Buffer);
assert.equal(renewedPrepared.checkout_reference,prepared.checkout_reference,"unrelated main movement must not change the private reference");
assert.equal(renewedPrepared.checkout_policy_private,prepared.checkout_policy_private,"renewed observation must preserve the immutable policy");
assert.equal(renewedPrepared.private_checkout_intent_state,prepared.private_checkout_intent_state,"renewed observation must preserve the provider intent/idempotency identity");

const authorized=await runStep({...base,phase:"AUTHORIZE_MUTATION",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:prepared.private_checkout_intent_state},()=>{throw new Error("network");},Buffer);
assert.equal(authorized.status,"PRIVATE_CHECKOUT_MUTATION_AUTHORIZATION_PREPARED");
const requests=[];
for(const mutate of [
  state=>({...state,provider_idempotency_reconcile_after:new Date(Date.parse(state.provider_idempotency_reconcile_after)+60_000).toISOString()}),
  state=>({...state,unexpected:"caller-controlled"})
]){
  const tampered=canonical(mutate(JSON.parse(authorized.private_checkout_intent_state)));
  requests.length=0;
  await assert.rejects(runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:tampered},()=>{requests.push("network");throw new Error("network");},Buffer),/MUTATION_STARTED|fields|HMAC|timestamps/);
  assert.equal(requests.length,0,"tampered mutation latch must fail before provider access");
}
const adult=[{key:"adultpurchaserack",type:"dropdown",optional:false,label:{type:"custom",custom:"I am 18+ and authorized to buy for this business"},dropdown:{options:[{label:"I confirm",value:"accepted"}]}}];
const linkBase={object:"payment_link",id:"plink_ArcPrivateOneUse",livemode:false,active:true,url:"https://buy.stripe.com/test_ArcPrivateOneUse",
  restrictions:{completed_sessions:{limit:1}},automatic_tax:{enabled:true},billing_address_collection:"required",consent_collection:{terms_of_service:"required"},
  allow_promotion_codes:false,custom_fields:adult,name_collection:{business:{enabled:true,optional:false},individual:{enabled:true,optional:false}},submit_type:"auto",
  after_completion:{type:"redirect",redirect:{url:stableConfiguration.checkout_redirect_url}},customer_creation:"if_required",invoice_creation:{enabled:false},phone_number_collection:{enabled:false},
  tax_id_collection:{enabled:false},shipping_address_collection:null,optional_items:[]};
const readbackProduct={id:stableConfiguration.product_id,tax_code:stableConfiguration.product_tax_code};
let readback={...linkBase,metadata:{},line_items:{object:"list",has_more:false,data:[{quantity:1,price:{id:stableConfiguration.price_id,product:readbackProduct}}]}};
let reconcileCandidates=[];
let reconcilePages=null;
const providerFetch=async(url,options={})=>{
  requests.push({url,method:options.method||"GET",body:String(options.body||""),headers:options.headers||{}});
  let payload;
  if(url.endsWith("/v1/account"))payload={object:"account",id:accountId};
  else if(url.endsWith("/v1/payment_links")&&options.method==="POST")payload={object:"payment_link",id:linkBase.id};
  else if(url.includes("/v1/payment_links?limit=100")){
    if(reconcilePages){
      const page=url.includes("starting_after=")?1:0;payload=reconcilePages[page];
    }else payload={object:"list",has_more:false,data:reconcileCandidates};
  }
  else if(url.includes(`/v1/payment_links/${linkBase.id}`))payload=readback;
  else throw new Error(`unexpected ${url}`);
  return new Response(JSON.stringify(payload),{status:200,headers:{"content-type":"application/json"}});
};
const expiredBeforeCreate=observationAt(Date.now()-10*60*1000,Date.now()-1000);
requests.length=0;
await assert.rejects(runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state,
  checkout_readiness_observation_private:expiredBeforeCreate.raw,checkout_readiness_observation_hmac_sha256:expiredBeforeCreate.hmac},providerFetch,Buffer),/exact read-only reconciliation/);
assert.equal(requests.some(item=>item.method==="POST"),false,"expired readiness must never make a first provider POST");
// Obtain the exact self-bound metadata from the deterministic POST body.
let created;
try{created=await runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state},providerFetch,Buffer);}catch(error){
  assert.match(error.message,/Payment Link readback/);
}
const createRequest=requests.find(item=>item.method==="POST");
const params=new URLSearchParams(createRequest.body),metadata={};
assert.equal(createRequest.headers["Stripe-Version"],"2026-07-29.dahlia");
assert.equal([...params.keys()].some(name=>name.startsWith("payment_method_types")),false,"Payment Link create must omit payment_method_types so Stripe can use dynamic methods");
assert.equal(params.get("billing_address_collection"),"required","Payment Link create must require the customer's full billing address");
for(const [name,value] of params)if(name.startsWith("metadata["))metadata[name.slice(9,-1)]=value;
assert.equal(metadata.arc_v4_ref,prepared.checkout_reference);
assert.equal(metadata.arc_v4_ref_sha256,prepared.checkout_reference_sha256);
assert.equal(Object.hasOwn(metadata,"arc_v3_ref"),false);
readback={...linkBase,metadata,line_items:{object:"list",has_more:false,data:[{quantity:1,price:{id:stableConfiguration.price_id,product:readbackProduct}}]}};
reconcileCandidates=[{id:linkBase.id,metadata}];
requests.length=0;
const recoveredAfterExpiredObservation=await runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state,
  checkout_readiness_observation_private:expiredBeforeCreate.raw,checkout_readiness_observation_hmac_sha256:expiredBeforeCreate.hmac},providerFetch,Buffer);
assert.equal(recoveredAfterExpiredObservation.status,"PRIVATE_CHECKOUT_LINK_VALIDATED","expired observation must allow exact read-only recovery of a lost successful POST");
assert.equal(requests.some(item=>item.method==="POST"),false,"expired observation recovery must stay read-only");
reconcilePages=[
  {object:"list",has_more:true,data:Array.from({length:100},(_,index)=>({id:`plink_Filler${String(index).padStart(3,"0")}`,metadata:{arc_intent_sha256:"0".repeat(64)}}))},
  {object:"list",has_more:false,data:[{id:linkBase.id,metadata}]}
];
requests.length=0;
const pageTwoRecovery=await runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state,
  checkout_readiness_observation_private:expiredBeforeCreate.raw,checkout_readiness_observation_hmac_sha256:expiredBeforeCreate.hmac},providerFetch,Buffer);
assert.equal(pageTwoRecovery.private_checkout_intent_state,recoveredAfterExpiredObservation.private_checkout_intent_state,"page-two reconciliation must recover the identical Link state");
assert.equal(requests.filter(item=>item.url.includes("/v1/payment_links?limit=100")).length,2,"reconciliation must follow a bounded provider cursor");
assert.equal(requests.some(item=>item.method==="POST"),false);
reconcilePages=[
  {object:"list",has_more:true,data:[{id:"plink_FirstMatch",metadata}]},
  {object:"list",has_more:false,data:[{id:"plink_SecondMatch",metadata}]}
];
await assert.rejects(runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state,
  checkout_readiness_observation_private:expiredBeforeCreate.raw,checkout_readiness_observation_hmac_sha256:expiredBeforeCreate.hmac},providerFetch,Buffer),/multiple provider Links/);
reconcilePages=null;
requests.length=0;
created=await runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state},providerFetch,Buffer);
assert.equal(created.status,"PRIVATE_CHECKOUT_LINK_VALIDATED");
assert.equal(JSON.parse(created.private_checkout_intent_state).status,"LINK_CREATED");
assert.equal(created.link_reverse_state_write_required,false);
const badReadback={...readback,after_completion:{type:"redirect",redirect:{url:"https://attacker.invalid/"}}};
readback=badReadback;
await assert.rejects(runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state},providerFetch,Buffer),/Payment Link readback/);
readback={...linkBase,metadata,line_items:{object:"list",has_more:false,data:[{quantity:1,price:{id:stableConfiguration.price_id,product:{...readbackProduct,tax_code:"txcd_99999999"}}}]}};
await assert.rejects(runStep({...base,phase:"CREATE",private_checkout_provider_mutation_enabled:"true",private_checkout_intent_state:authorized.private_checkout_intent_state},providerFetch,Buffer),/line item readback/);
readback={...linkBase,metadata,line_items:{object:"list",has_more:false,data:[{quantity:1,price:{id:stableConfiguration.price_id,product:readbackProduct}}]}};

const reversePrepared=await runStep({...base,phase:"PERSIST_REVERSE",private_checkout_state_commit_enabled:"true",private_checkout_intent_state:created.private_checkout_intent_state},()=>{throw new Error("network");},Buffer);
assert.equal(reversePrepared.status,"PRIVATE_CHECKOUT_REVERSE_PREPARED");
const reverseReplay=await runStep({...base,phase:"PERSIST_REVERSE",private_checkout_state_commit_enabled:"true",private_checkout_intent_state:created.private_checkout_intent_state,
  private_link_reverse_state:reversePrepared.private_link_reverse_state},()=>{throw new Error("network");},Buffer);
assert.equal(reverseReplay.status,"PRIVATE_CHECKOUT_REVERSE_REUSED");
const active=await runStep({...base,phase:"ACTIVATE",private_checkout_state_commit_enabled:"true",private_checkout_intent_state:created.private_checkout_intent_state,
  private_link_reverse_state:reversePrepared.private_link_reverse_state},()=>{throw new Error("network");},Buffer);
assert.equal(JSON.parse(active.private_checkout_intent_state).status,"ACTIVE");

const gitRefs=new Map(),finalFetch=async(url,options={})=>{
  if(url.startsWith("https://api.stripe.com/"))return providerFetch(url,options);
  const parsed=new URL(url),method=options.method||"GET";
  if(method==="POST"&&parsed.pathname.endsWith("/git/refs")){
    const body=JSON.parse(options.body),name=body.ref.replace("refs/tags/","");
    if(gitRefs.has(name))return new Response(JSON.stringify({message:"Reference already exists"}),{status:422,headers:{"content-type":"application/json"}});
    gitRefs.set(name,body.sha);return new Response(JSON.stringify({ref:body.ref,object:{type:"commit",sha:body.sha}}),{status:201,headers:{"content-type":"application/json"}});
  }
  if(method==="GET"&&parsed.pathname.includes("/git/ref/")){
    const ref=decodeURIComponent(parsed.pathname.split("/git/ref/")[1]),name=ref.replace(/^tags\//,""),value=gitRefs.get(name);
    return new Response(JSON.stringify(value?{ref:`refs/tags/${name}`,object:{type:"commit",sha:value}}:{message:"missing"}),{status:value?200:404,headers:{"content-type":"application/json"}});
  }
  throw new Error(`unexpected final fetch ${method} ${url}`);
};
const emailStateCreatedAt=new Date(Date.now()-1000).toISOString();
const emailStateObject={version:"arc-preview-email-state-v1",status:"PENDING",token_sha256:sha(emailToken),recipient_sha256:sha(email),
  created_at:emailStateCreatedAt,expires_at:new Date(Date.parse(emailStateCreatedAt)+60*60*1000).toISOString(),preview_folder:JSON.parse(core).preview_folder,
  content_sha256:JSON.parse(core).content_sha256,asset_publication_receipt_sha256:JSON.parse(core).asset_publication_receipt_sha256,
  head_sha:JSON.parse(core).head_sha,pr_number:JSON.parse(core).pr_number};
const emailState=canonical(emailStateObject);
const finalInput={...base,phase:"FINALIZE",private_checkout_url_exposure_enabled:"true",private_checkout_ready_tag_mutation_enabled:"true",
  private_checkout_intent_state:active.private_checkout_intent_state,private_link_reverse_state:reversePrepared.private_link_reverse_state,
  github_token:"github-test",email_state:emailState,email_state_token:emailToken,customer_email:email};
const finalized=await runStep(finalInput,finalFetch,Buffer);
assert.equal(finalized.send_preview_email,true);
assert.equal(finalized.email_state_write_required_before_email,true);
assert.equal(finalized.checkout_url_private,linkBase.url);
assert.equal(finalized.ready_tag,`arc-checkout-ready-v4/${prepared.checkout_reference_sha256}`);
const claimed=await runStep({...finalInput,email_state:finalized.next_email_state},finalFetch,Buffer);
assert.equal(claimed.send_preview_email,true);
assert.equal(claimed.email_state_write_required_before_email,false);
assert.equal(claimed.email_provider_idempotency_key,finalized.email_provider_idempotency_key);
let expiredEmailFetches=0;
await assert.rejects(runStep({...finalInput,email_state:canonical({...emailStateObject,expires_at:new Date(Date.now()-1000).toISOString()})},()=>{expiredEmailFetches+=1;throw new Error("network");},Buffer),/email state expired or invalid/);
assert.equal(expiredEmailFetches,0,"expired private email authority must fail before Stripe, Git, or URL exposure");
const expired=observationAt(Date.now()-10*60*1000,Date.now()-1000);
await assert.rejects(runStep({...finalInput,checkout_readiness_observation_private:expired.raw,checkout_readiness_observation_hmac_sha256:expired.hmac},finalFetch,Buffer),/refresh readiness/);
await assert.rejects(runStep({...finalInput,private_checkout_ready_tag_mutation_enabled:"false"},finalFetch,Buffer),/ready-tag mutation gate is off/);

console.log("ARC1 private checkout Link contract passed");
