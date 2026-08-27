// ARC1 private-review transactional-email outbox. This provider-neutral Code
// step never sends email, creates checkout, or writes state. Every phase is
// fail-closed and requires a durable adapter readback before send authority.
const clean=value=>String(value==null?"":value).trim();
const phase=clean(inputData.phase).toUpperCase();
const enabled=name=>clean(inputData[name])==="true";
if(!new Set(["PREPARE","BIND_INVITE","AUTHORIZE_SEND","ACK_DELIVERY"]).has(phase))throw new Error("ARC_PREVIEW_OUTBOX_INVALID: phase");
if(phase==="PREPARE"&&!enabled("preview_review_outbox_prepare_enabled"))throw new Error("ARC_PREVIEW_OUTBOX_DISABLED: prepare gate is off");
if(phase==="BIND_INVITE"&&!enabled("preview_review_outbox_state_commit_enabled"))throw new Error("ARC_PREVIEW_OUTBOX_DISABLED: state commit gate is off");
if(phase==="AUTHORIZE_SEND"&&!enabled("transactional_email_send_enabled"))throw new Error("ARC_PREVIEW_OUTBOX_DISABLED: transactional email send gate is off");
if(phase==="ACK_DELIVERY"&&!enabled("transactional_email_delivery_ack_enabled"))throw new Error("ARC_PREVIEW_OUTBOX_DISABLED: delivery acknowledgement gate is off");
if(!globalThis.crypto?.subtle||typeof TextEncoder!=="function")throw new Error("ARC_PREVIEW_OUTBOX_INVALID: crypto/runtime");

const encoder=new TextEncoder();
const canonicalJson=value=>{
  if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"&&Number.isFinite(value))return JSON.stringify(Object.is(value,-0)?0:value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype)return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new Error("ARC_PREVIEW_OUTBOX_INVALID: canonical JSON");
};
const parseCanonical=(raw,label,maximum=262144)=>{if(!raw||encoder.encode(raw).length>maximum)throw new Error(`ARC_PREVIEW_OUTBOX_INVALID: ${label} size`);let value;try{value=JSON.parse(raw);}catch{throw new Error(`ARC_PREVIEW_OUTBOX_INVALID: ${label} JSON`);}if(!value||typeof value!=="object"||Array.isArray(value)||canonicalJson(value)!==raw)throw new Error(`ARC_PREVIEW_OUTBOX_INVALID: ${label} canonical JSON`);return value;};
const exactKeys=(value,keys,label)=>{if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))throw new Error(`ARC_PREVIEW_OUTBOX_INVALID: ${label} fields`);};
const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const hexBytes=hex=>Uint8Array.from((hex.match(/../g)||[]),byte=>Number.parseInt(byte,16));
const importHmac=secret=>crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
const hmacHex=async(key,message)=>[...new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(message)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const verifyHmac=async(key,hex,message,label)=>{if(!/^[a-f0-9]{64}$/.test(hex)||!await crypto.subtle.verify("HMAC",key,hexBytes(hex),encoder.encode(message)))throw new Error(`ARC_PREVIEW_OUTBOX_INVALID: ${label} HMAC`);};
const requireSecret=(name,label)=>{const value=clean(inputData[name]);if(value.length<32||value.length>512)throw new Error(`ARC_PREVIEW_OUTBOX_INVALID: ${label} secret`);return value;};
const iso=value=>typeof value==="string"&&value.length>=20&&value.length<=32&&new Date(value).toISOString()===value;
const hex40=value=>/^[a-f0-9]{40}$/.test(value),hex64=value=>/^[a-f0-9]{64}$/.test(value);

const mode=clean(inputData.stripe_mode).toLowerCase();
if(!new Set(["test","live"]).has(mode)||(mode==="live"&&!enabled("stripe_live_mode_enabled")))throw new Error("ARC_PREVIEW_OUTBOX_DISABLED: Stripe mode gate is off");
const checkoutKid=clean(inputData.checkout_binding_key_id).toLowerCase(),checkoutSecret=requireSecret("checkout_binding_secret","checkout binding");
if(!/^[a-f0-9]{2}$/.test(checkoutKid))throw new Error("ARC_PREVIEW_OUTBOX_INVALID: checkout key id");
const checkoutKey=await importHmac(checkoutSecret),outboxKey=await importHmac(requireSecret("preview_email_outbox_secret","outbox"));

const coreRaw=clean(inputData.checkout_readiness_core_private),core=parseCanonical(coreRaw,"readiness core"),coreSha=await sha256(coreRaw);
const coreFields=["approval_content_sha256","asset_publication_receipt_sha256","check_app_id","check_app_slug","check_name","checkout_offer_snapshot_sha256","checkout_recipient_reservation_sha256","content_sha256","customer_email_sha256","deliverable","email_state_token_sha256","head_sha","lead_route_form_name","lead_route_mode","lead_route_recipient_hmac_sha256","merge_commit_sha","merged_at","offer_contract_id","page_count","preview_folder","preview_paths","preview_url","pr_number","published_preview_bundle_sha256","published_site_sha256","render_bundle_sha256","repository","scope","script_manifest_sha256","source_tree_sha","version"];
exactKeys(core,coreFields,"readiness core");
const expectedPaths=["about/index.html","contact/index.html","process/index.html","services/index.html","index.html"].map(path=>`${core.preview_folder}/${path}`);
if(core.version!=="arc1-preview-readiness-core-v2"||core.scope!=="immutable-five-page-private-checkout-content-and-recipient-readiness"||core.repository!=="arcwebhq-cpu/arc-previews"||
  core.offer_contract_id!=="arc-fixed-five-page-offer-v1"||core.deliverable!=="fixed-five-page-marketing-website-v1"||core.page_count!==5||canonicalJson(core.preview_paths)!==canonicalJson(expectedPaths)||
  !/^[a-z0-9][a-z0-9-]{1,119}-[a-f0-9]{8}$/.test(core.preview_folder)||!/^https:\/\/arcwebhq-cpu\.github\.io\/arc-previews\/[a-z0-9][a-z0-9-]{1,119}-[a-f0-9]{8}\/$/.test(core.preview_url)||
  ![core.approval_content_sha256,core.asset_publication_receipt_sha256,core.checkout_offer_snapshot_sha256,core.checkout_recipient_reservation_sha256,core.content_sha256,core.customer_email_sha256,core.email_state_token_sha256,core.published_preview_bundle_sha256,core.published_site_sha256,core.render_bundle_sha256].every(hex64)||
  core.content_sha256!==core.published_preview_bundle_sha256||![core.head_sha,core.merge_commit_sha,core.source_tree_sha].every(hex40)||core.check_name!=="ARC preview quality/preview-quality"||core.check_app_slug!=="github-actions"||core.check_app_id!==15368)
  throw new Error("ARC_PREVIEW_OUTBOX_INVALID: readiness core binding");
if(clean(inputData.checkout_readiness_core_sha256).toLowerCase()!==coreSha)throw new Error("ARC_PREVIEW_OUTBOX_INVALID: readiness core digest");
await verifyHmac(checkoutKey,clean(inputData.checkout_readiness_core_hmac_sha256).toLowerCase(),`arc1-preview-readiness-core-signature-v2\n${mode}\n${coreRaw}`,"readiness core");

const customerEmail=clean(inputData.customer_email).toLowerCase(),recipientSha=await sha256(customerEmail),briefSha=clean(inputData.brief_sha256).toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)||recipientSha!==core.customer_email_sha256||!hex64(briefSha))throw new Error("ARC_PREVIEW_OUTBOX_INVALID: recipient/brief binding");
const createdAt=clean(inputData.outbox_created_at),expiresAt=clean(inputData.outbox_expires_at),createdMs=Date.parse(createdAt),expiresMs=Date.parse(expiresAt),now=Date.now();
if(!iso(createdAt)||!iso(expiresAt)||createdMs>now+300000||expiresMs<=createdMs||expiresMs-createdMs>24*60*60*1000||expiresMs<=now)throw new Error("ARC_PREVIEW_OUTBOX_INVALID: outbox timestamps");
const outboxIdentity=canonicalJson({version:"arc-preview-review-email-outbox-key-v1",scope:"one-recipient-one-immutable-five-page-review-invite",checkout_binding_key_id:checkoutKid,stripe_mode:mode,recipient_email_sha256:recipientSha,readiness_core_sha256:coreSha,preview_source_repository:core.repository,preview_source_commit_sha:core.merge_commit_sha,preview_manifest_sha256:core.published_preview_bundle_sha256,preview_content_sha256:core.content_sha256,brief_sha256:briefSha,email_template_version:"arc-preview-ready-email-v1"});
const outboxKeyHmac=await hmacHex(outboxKey,`arc-preview-review-email-outbox-key-v1\n${outboxIdentity}`);
const baseState={version:"arc-preview-review-email-outbox-v1",scope:"durable-private-review-invitation-email",status:"PENDING",outbox_key_hmac_sha256:outboxKeyHmac,checkout_binding_key_id:checkoutKid,stripe_mode:mode,recipient_email_sha256:recipientSha,readiness_core_sha256:coreSha,preview_source_repository:core.repository,preview_source_commit_sha:core.merge_commit_sha,preview_manifest_sha256:core.published_preview_bundle_sha256,preview_content_sha256:core.content_sha256,brief_sha256:briefSha,page_count:5,email_template_version:"arc-preview-ready-email-v1",created_at:createdAt,expires_at:expiresAt};
const baseFields=Object.keys(baseState),claimExtra=["claim_id_sha256","claim_receipt_hmac_sha256","claim_receipt_sha256","claimed_at","lease_expires_at"],boundExtra=["invite_evidence_hmac_sha256","invite_evidence_sha256","invite_expires_at","invite_hmac_sha256","review_url_sha256"],sentExtra=["delivered_at","delivery_evidence_hmac_sha256","delivery_evidence_sha256","provider_event_id_sha256","provider_message_id_sha256"];
const stateRaw=clean(inputData.outbox_state_private),state=stateRaw?parseCanonical(stateRaw,"outbox state"):null;
const exactBase=(value,status,label)=>{exactKeys(value,baseFields,label);if(canonicalJson(value)!==canonicalJson({...baseState,status}))throw new Error(`ARC_PREVIEW_OUTBOX_CONFLICT: ${label}`);};
const validatePending=value=>exactBase(value,"PENDING","PENDING state");

if(phase==="PREPARE"){
  if(state)validatePending(state);
  return{status:state?"PREVIEW_REVIEW_OUTBOX_PENDING_REUSED":"PREVIEW_REVIEW_OUTBOX_PENDING_PREPARED",send_preview_email:false,checkout_creation_allowed:false,outbox_state_write_required:!state,outbox_record_key_hmac_sha256:outboxKeyHmac,outbox_state_private:canonicalJson(baseState)};
}

const validateClaimed=value=>{
  exactKeys(value,[...baseFields,...claimExtra],"CLAIMED state");
  const staticState={...value};for(const name of claimExtra)delete staticState[name];exactBase(staticState,"CLAIMED","CLAIMED immutable state");
  if(![value.claim_id_sha256,value.claim_receipt_hmac_sha256,value.claim_receipt_sha256].every(hex64)||!iso(value.claimed_at)||!iso(value.lease_expires_at)||Date.parse(value.lease_expires_at)<=Date.parse(value.claimed_at))throw new Error("ARC_PREVIEW_OUTBOX_INVALID: CLAIMED state");
};
const claimReceiptRaw=clean(inputData.outbox_claim_receipt_private),claimReceipt=parseCanonical(claimReceiptRaw,"claim receipt"),claimReceiptSha=await sha256(claimReceiptRaw);
exactKeys(claimReceipt,["claim_id_sha256","claimed_at","lease_expires_at","outbox_key_hmac_sha256","pending_state_sha256","provider_record_version","scope","version"],"claim receipt");
if(claimReceipt.version!=="arc-preview-review-email-outbox-claim-v1"||claimReceipt.scope!=="atomic-create-or-exact-private-outbox-claim"||claimReceipt.outbox_key_hmac_sha256!==outboxKeyHmac||claimReceipt.pending_state_sha256!==await sha256(canonicalJson(baseState))||!hex64(claimReceipt.claim_id_sha256)||!Number.isSafeInteger(claimReceipt.provider_record_version)||claimReceipt.provider_record_version<1||!iso(claimReceipt.claimed_at)||!iso(claimReceipt.lease_expires_at)||Date.parse(claimReceipt.lease_expires_at)<=Date.parse(claimReceipt.claimed_at))throw new Error("ARC_PREVIEW_OUTBOX_INVALID: claim receipt binding");
const claimReceiptHmac=clean(inputData.outbox_claim_receipt_hmac_sha256).toLowerCase();
await verifyHmac(outboxKey,claimReceiptHmac,`arc-preview-review-email-outbox-claim-signature-v1\n${claimReceiptRaw}`,"claim receipt");
const expectedClaimed={...baseState,status:"CLAIMED",claim_id_sha256:claimReceipt.claim_id_sha256,claim_receipt_hmac_sha256:claimReceiptHmac,claim_receipt_sha256:claimReceiptSha,claimed_at:claimReceipt.claimed_at,lease_expires_at:claimReceipt.lease_expires_at};

const reviewUrlRaw=clean(inputData.private_review_url);let reviewUrl;try{reviewUrl=new URL(reviewUrlRaw);}catch{throw new Error("ARC_PREVIEW_OUTBOX_INVALID: private review URL");}
if(reviewUrl.href!==reviewUrlRaw||reviewUrl.origin!=="https://arcweb.onl"||reviewUrl.pathname!=="/review/"||reviewUrl.search||!/^#invite=[A-Za-z0-9_-]{43,128}$/.test(reviewUrl.hash)||reviewUrl.username||reviewUrl.password)throw new Error("ARC_PREVIEW_OUTBOX_INVALID: private review URL");
const reviewUrlSha=await sha256(reviewUrlRaw),inviteRaw=clean(inputData.review_invite_evidence_private),invite=parseCanonical(inviteRaw,"review invite evidence"),inviteSha=await sha256(inviteRaw),inviteSecret=requireSecret("review_invite_evidence_secret","review invite evidence"),inviteKey=await importHmac(inviteSecret),inviteHmac=clean(inputData.review_invite_evidence_hmac_sha256).toLowerCase();
exactKeys(invite,["brief_sha256","expires_at","invite_hmac_sha256","issued_at","outbox_key_hmac_sha256","page_count","preview_content_sha256","preview_manifest_sha256","preview_source_commit_sha","preview_source_repository","prior_invite_hmac_sha256","readiness_core_sha256","recipient_email_sha256","review_url_sha256","revision_round","scope","version"],"review invite evidence");
if(invite.version!=="arc-preview-review-invite-evidence-v1"||invite.scope!=="private-five-page-preview-review-invite"||invite.outbox_key_hmac_sha256!==outboxKeyHmac||invite.recipient_email_sha256!==recipientSha||invite.readiness_core_sha256!==coreSha||invite.preview_source_repository!==core.repository||invite.preview_source_commit_sha!==core.merge_commit_sha||invite.preview_manifest_sha256!==core.published_preview_bundle_sha256||invite.preview_content_sha256!==core.content_sha256||invite.brief_sha256!==briefSha||invite.page_count!==5||invite.review_url_sha256!==reviewUrlSha||!hex64(invite.invite_hmac_sha256)||!iso(invite.issued_at)||!iso(invite.expires_at)||Date.parse(invite.expires_at)<=Date.parse(invite.issued_at)||Date.parse(invite.expires_at)>Date.parse(invite.issued_at)+30*24*60*60*1000||!Number.isSafeInteger(invite.revision_round)||invite.revision_round<0||invite.revision_round>2||(invite.revision_round===0?invite.prior_invite_hmac_sha256!==null:!hex64(invite.prior_invite_hmac_sha256)))throw new Error("ARC_PREVIEW_OUTBOX_INVALID: review invite evidence binding");
await verifyHmac(inviteKey,inviteHmac,`arc-preview-review-invite-evidence-signature-v1\n${inviteRaw}`,"review invite evidence");
const expectedBound={...expectedClaimed,status:"INVITE_BOUND",invite_evidence_hmac_sha256:inviteHmac,invite_evidence_sha256:inviteSha,invite_expires_at:invite.expires_at,invite_hmac_sha256:invite.invite_hmac_sha256,review_url_sha256:reviewUrlSha};
const validateBound=value=>{exactKeys(value,[...baseFields,...claimExtra,...boundExtra],"INVITE_BOUND state");if(canonicalJson(value)!==canonicalJson(expectedBound))throw new Error("ARC_PREVIEW_OUTBOX_CONFLICT: INVITE_BOUND state");};

if(phase==="BIND_INVITE"){
  if(!state)throw new Error("ARC_PREVIEW_OUTBOX_CONFLICT: persisted CLAIMED state required");
  if(state.status==="INVITE_BOUND"){validateBound(state);return{status:"PREVIEW_REVIEW_INVITE_ALREADY_BOUND",send_preview_email:false,checkout_creation_allowed:false,outbox_state_write_required:false,outbox_state_private:canonicalJson(state)};}
  validateClaimed(state);if(canonicalJson(state)!==canonicalJson(expectedClaimed))throw new Error("ARC_PREVIEW_OUTBOX_CONFLICT: claim state/receipt mismatch");
  return{status:"PREVIEW_REVIEW_INVITE_BINDING_PREPARED",send_preview_email:false,checkout_creation_allowed:false,outbox_state_write_required:true,expected_previous_state_sha256:await sha256(stateRaw),outbox_state_private:canonicalJson(expectedBound),state_adapter_contract:"compare-and-set exact CLAIMED bytes to INVITE_BOUND then authoritatively read back exact bytes"};
}

let boundState,boundRaw;
if(state?.status==="SENT"){
  exactKeys(state,[...baseFields,...claimExtra,...boundExtra,...sentExtra],"SENT state");
  boundState={...state,status:"INVITE_BOUND"};for(const name of sentExtra)delete boundState[name];validateBound(boundState);boundRaw=canonicalJson(boundState);
}else{validateBound(state);boundState=state;boundRaw=stateRaw;}
const boundSha=await sha256(boundRaw),readbackRaw=clean(inputData.outbox_bound_readback_evidence_private),readback=parseCanonical(readbackRaw,"bound readback evidence");
exactKeys(readback,["outbox_key_hmac_sha256","outbox_state_sha256","provider_record_version","readback_at","scope","status","version"],"bound readback evidence");
if(readback.version!=="arc-preview-review-email-outbox-readback-v1"||readback.scope!=="authoritative-private-outbox-state-readback"||readback.status!=="INVITE_BOUND"||readback.outbox_key_hmac_sha256!==outboxKeyHmac||readback.outbox_state_sha256!==boundSha||!Number.isSafeInteger(readback.provider_record_version)||readback.provider_record_version<2||!iso(readback.readback_at)||Date.parse(readback.readback_at)>Date.now()+300000)throw new Error("ARC_PREVIEW_OUTBOX_INVALID: bound readback evidence");
await verifyHmac(outboxKey,clean(inputData.outbox_bound_readback_evidence_hmac_sha256).toLowerCase(),`arc-preview-review-email-outbox-readback-signature-v1\n${readbackRaw}`,"bound readback evidence");
const providerIdempotencyKey=`arc_preview_${outboxKeyHmac}`,providerIdempotencySha=await sha256(providerIdempotencyKey);

if(phase==="AUTHORIZE_SEND"){
  if(state.status!=="INVITE_BOUND")throw new Error("ARC_PREVIEW_OUTBOX_CONFLICT: unsent INVITE_BOUND state required");
  if(Date.parse(state.expires_at)<=Date.now()||Date.parse(state.invite_expires_at)<=Date.now()||Date.parse(state.lease_expires_at)<=Date.now())throw new Error("ARC_PREVIEW_OUTBOX_WAIT: refresh outbox claim/invite before send");
  const subject="Your ARC website preview is ready";
  const textBody=`Your complete five-page ARC preview is ready.\n\nOpen your private review link to view it, approve and pay, or request changes. No reply needed.\n\n${reviewUrlRaw}\n\nDo not forward this private link. Checkout is created only after approval.`;
  return{status:"PREVIEW_REVIEW_EMAIL_SEND_AUTHORIZED",send_preview_email:true,checkout_creation_allowed:false,email_provider_idempotency_key:providerIdempotencyKey,email_provider_idempotency_key_sha256:providerIdempotencySha,recipient_email_private:customerEmail,private_review_url:reviewUrlRaw,email_subject:subject,email_text_body:textBody,outbox_record_key_hmac_sha256:outboxKeyHmac,outbox_state_sha256:boundSha};
}

const deliveryRaw=clean(inputData.transactional_email_delivery_evidence_private),delivery=parseCanonical(deliveryRaw,"delivery evidence"),deliverySha=await sha256(deliveryRaw),deliveryKey=await importHmac(requireSecret("transactional_email_delivery_secret","transactional email delivery")),deliveryHmac=clean(inputData.transactional_email_delivery_evidence_hmac_sha256).toLowerCase();
exactKeys(delivery,["delivered_at","outbox_key_hmac_sha256","outbox_state_sha256","provider_event_id_sha256","provider_idempotency_key_sha256","provider_message_id_sha256","provider_status","recipient_email_sha256","review_url_sha256","scope","version"],"delivery evidence");
if(delivery.version!=="arc-transactional-email-delivery-evidence-v1"||delivery.scope!=="authenticated-provider-delivered-private-review-email"||delivery.provider_status!=="DELIVERED"||delivery.outbox_key_hmac_sha256!==outboxKeyHmac||delivery.outbox_state_sha256!==boundSha||delivery.provider_idempotency_key_sha256!==providerIdempotencySha||delivery.recipient_email_sha256!==recipientSha||delivery.review_url_sha256!==reviewUrlSha||![delivery.provider_event_id_sha256,delivery.provider_message_id_sha256].every(hex64)||!iso(delivery.delivered_at))throw new Error("ARC_PREVIEW_OUTBOX_INVALID: delivery evidence binding");
await verifyHmac(deliveryKey,deliveryHmac,`arc-transactional-email-delivery-evidence-signature-v1\n${deliveryRaw}`,"delivery evidence");
const sentState={...boundState,status:"SENT",delivered_at:delivery.delivered_at,delivery_evidence_hmac_sha256:deliveryHmac,delivery_evidence_sha256:deliverySha,provider_event_id_sha256:delivery.provider_event_id_sha256,provider_message_id_sha256:delivery.provider_message_id_sha256};
if(state.status==="SENT"){
  if(canonicalJson(state)!==canonicalJson(sentState))throw new Error("ARC_PREVIEW_OUTBOX_CONFLICT: SENT replay");
  return{status:"PREVIEW_REVIEW_EMAIL_DELIVERY_ALREADY_RECORDED",send_preview_email:false,checkout_creation_allowed:false,outbox_state_write_required:false,outbox_state_private:canonicalJson(state)};
}
return{status:"PREVIEW_REVIEW_EMAIL_DELIVERY_ACK_PREPARED",send_preview_email:false,checkout_creation_allowed:false,outbox_state_write_required:true,expected_previous_state_sha256:boundSha,outbox_state_private:canonicalJson(sentState),delivery_evidence_sha256:deliverySha};
