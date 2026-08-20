// ARC1 private checkout-link state machine. This Code step is invoked in three
// separately persisted phases. Every live/provider flag defaults OFF.
// PREPARE -> persist exact intent; AUTHORIZE_MUTATION -> persist start latch;
// CREATE -> persist LINK_CREATED; PERSIST_REVERSE -> persist its reverse index;
// ACTIVATE -> CAS LINK_CREATED to ACTIVE; FINALIZE -> ready tag +
// one-shot private email authorization. No phase publishes the URL to Git/Pages.
const clean=value=>String(value==null?"":value).trim();
const phase=clean(inputData.phase).toUpperCase();
const enabled=(name)=>clean(inputData[name])==="true";
if(phase==="PREPARE"&&!enabled("private_checkout_prepare_enabled"))throw new Error("ARC_PRIVATE_CHECKOUT_DISABLED: prepare gate is off");
if(new Set(["AUTHORIZE_MUTATION","CREATE"]).has(phase)&&!enabled("private_checkout_provider_mutation_enabled"))throw new Error("ARC_PRIVATE_CHECKOUT_DISABLED: provider mutation gate is off");
if(new Set(["PERSIST_REVERSE","ACTIVATE"]).has(phase)&&!enabled("private_checkout_state_commit_enabled"))throw new Error("ARC_PRIVATE_CHECKOUT_DISABLED: state commit gate is off");
if(phase==="FINALIZE"&&!enabled("private_checkout_url_exposure_enabled"))throw new Error("ARC_PRIVATE_CHECKOUT_DISABLED: private URL exposure gate is off");
if(phase==="FINALIZE"&&!enabled("private_checkout_ready_tag_mutation_enabled"))throw new Error("ARC_PRIVATE_CHECKOUT_DISABLED: ready-tag mutation gate is off");
if(!new Set(["PREPARE","AUTHORIZE_MUTATION","CREATE","PERSIST_REVERSE","ACTIVATE","FINALIZE"]).has(phase))throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: phase");

const encoder=new TextEncoder();
const canonicalJson=value=>{
  if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"&&Number.isFinite(value))return JSON.stringify(Object.is(value,-0)?0:value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype)return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: canonical JSON");
};
const sha256Bytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const sha256=async value=>sha256Bytes(encoder.encode(value));
const hexBytes=hex=>Uint8Array.from((hex.match(/../g)||[]),byte=>Number.parseInt(byte,16));
const hmacHex=async(key,message)=>[...new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(message)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const parseCanonical=(raw,label)=>{let value;try{value=JSON.parse(raw);}catch{throw new Error(`ARC_PRIVATE_CHECKOUT_INVALID: ${label} JSON`);}if(!value||typeof value!=="object"||Array.isArray(value)||canonicalJson(value)!==raw)throw new Error(`ARC_PRIVATE_CHECKOUT_INVALID: ${label} canonical JSON`);return value;};
const exactKeys=(value,keys,label)=>{if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))throw new Error(`ARC_PRIVATE_CHECKOUT_INVALID: ${label} fields`);};
const verifyHex=async(key,hex,message,label)=>{if(!/^[a-f0-9]{64}$/.test(hex)||!await crypto.subtle.verify("HMAC",key,hexBytes(hex),encoder.encode(message)))throw new Error(`ARC_PRIVATE_CHECKOUT_INVALID: ${label} HMAC`);};
if(!crypto?.subtle||typeof Buffer!=="function")throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: crypto/runtime");

const currentKid=clean(inputData.checkout_binding_key_id).toLowerCase();
const currentSecret=clean(inputData.checkout_binding_secret);
const retiredRaw=clean(inputData.retired_checkout_binding_keys_json);
let retired;try{retired=JSON.parse(retiredRaw);}catch{}
if(!/^[a-f0-9]{2}$/.test(currentKid)||currentSecret.length<32||currentSecret.length>256||!retired||typeof retired!=="object"||Array.isArray(retired)||canonicalJson(retired)!==retiredRaw||
  Object.entries(retired).some(([id,value])=>!/^[a-f0-9]{2}$/.test(id)||id===currentKid||typeof value!=="string"||value.length<32||value.length>256)||
  new Set(Object.values(retired)).size!==Object.values(retired).length||Object.values(retired).includes(currentSecret))throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: checkout key registry");

const offerRaw=clean(inputData.checkout_offer_snapshot_private||inputData.checkout_config_snapshot_private);
const offer=parseCanonical(offerRaw,"offer snapshot");
const offerFields=["adult_acknowledgement_key","amount_subtotal_minor_units","asset_publication_receipt_sha256","automatic_tax_enabled","checkout_binding_key_id","checkout_redirect_url","configuration_sha256","currency","customer_address_source","environment","lead_route_recipient_hmac_sha256","livemode","name_collection_required","preview_folder","preview_path","preview_source_repository","price_id","price_tax_behavior","product_id","product_tax_code","public_folder_prefix","quantity","scope","stripe_account_id_sha256","stripe_api_version","submit_type","tax_contract_version","tax_registrations","tax_registrations_sha256","tax_settings_status","terms_document_sha256","terms_version","version"];
exactKeys(offer,offerFields,"offer snapshot");
if(offer.version!=="arc-checkout-offer-snapshot-v1"||offer.scope!=="immutable-approved-preview-private-checkout-offer"||offer.environment!=="arc-production"||
  !/^[a-f0-9]{2}$/.test(offer.checkout_binding_key_id)||!/^[a-f0-9]{8}$/.test(offer.public_folder_prefix)||!/^price_[A-Za-z0-9]+$/.test(offer.price_id)||!/^prod_[A-Za-z0-9]+$/.test(offer.product_id)||
  !/^[a-f0-9]{64}$/.test(offer.stripe_account_id_sha256)||!/^txcd_[0-9]{8}$/.test(offer.product_tax_code)||!/^20\d\d-\d\d-\d\d$/.test(offer.terms_version)||
  !/^[a-f0-9]{64}$/.test(offer.terms_document_sha256)||offer.amount_subtotal_minor_units!==500000||offer.currency!=="usd"||offer.quantity!==1||
  offer.automatic_tax_enabled!==true||offer.price_tax_behavior!=="exclusive"||offer.tax_contract_version!=="arc-tax-v1"||offer.tax_settings_status!=="active"||
  offer.adult_acknowledgement_key!=="adultpurchaserack"||offer.name_collection_required!==true||offer.submit_type!=="auto"||
  offer.checkout_redirect_url!=="https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}"||offer.stripe_api_version!=="2026-06-24.dahlia"||
  offer.preview_source_repository!=="arcwebhq-cpu/arc-previews"||!offer.preview_folder.endsWith(`-${offer.public_folder_prefix}`)||offer.preview_path!==`${offer.preview_folder}/index.html`||
  !/^[a-f0-9]{64}$/.test(offer.configuration_sha256)||!/^[a-f0-9]{64}$/.test(offer.asset_publication_receipt_sha256)||
  !/^$|^[a-f0-9]{64}$/.test(offer.lead_route_recipient_hmac_sha256))
  throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: offer snapshot semantics");
const mode=offer.livemode?"live":"test";
const selectedSecret=offer.checkout_binding_key_id===currentKid?currentSecret:retired[offer.checkout_binding_key_id];
if(!selectedSecret)throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: offer checkout key is not retained");
const key=await crypto.subtle.importKey("raw",encoder.encode(selectedSecret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
const offerSha=await sha256(offerRaw);
if(clean(inputData.checkout_offer_snapshot_sha256||inputData.checkout_config_snapshot_sha256).toLowerCase()!==offerSha)throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: offer snapshot digest");
await verifyHex(key,clean(inputData.checkout_offer_snapshot_hmac_sha256||inputData.checkout_config_snapshot_hmac_sha256).toLowerCase(),`arc-checkout-offer-snapshot-signature-v1\n${mode}\n${offerRaw}`,"offer snapshot");
const stableOfferConfiguration=canonicalJson({stripe_account_id_sha256:offer.stripe_account_id_sha256,livemode:offer.livemode,price_id:offer.price_id,product_id:offer.product_id,
  amount_subtotal_minor_units:offer.amount_subtotal_minor_units,currency:offer.currency,quantity:offer.quantity,terms_version:offer.terms_version,
  terms_document_sha256:offer.terms_document_sha256,automatic_tax_enabled:offer.automatic_tax_enabled,customer_address_source:offer.customer_address_source,
  price_tax_behavior:offer.price_tax_behavior,product_tax_code:offer.product_tax_code,tax_contract_version:offer.tax_contract_version,
  tax_settings_status:offer.tax_settings_status,tax_registrations:offer.tax_registrations,tax_registrations_sha256:offer.tax_registrations_sha256,
  adult_acknowledgement_key:offer.adult_acknowledgement_key,name_collection_required:offer.name_collection_required,submit_type:offer.submit_type,
  checkout_redirect_url:offer.checkout_redirect_url,stripe_api_version:offer.stripe_api_version});
if(await sha256(stableOfferConfiguration)!==offer.configuration_sha256)throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: offer configuration digest");

const recipientRaw=clean(inputData.checkout_recipient_reservation_private);
const recipient=parseCanonical(recipientRaw,"recipient reservation");
exactKeys(recipient,["approval_content_sha256","checkout_binding_key_id","checkout_offer_snapshot_sha256","claim_recipient_email","claim_recipient_email_sha256","lead_notification_email","lead_route_recipient_hmac_sha256","scope","stripe_mode","version"],"recipient reservation");
const recipientSha=await sha256(recipientRaw);
if(recipient.version!=="arc1-checkout-recipient-reservation-v1"||recipient.scope!=="private-lead-recipient-for-approved-checkout"||recipient.checkout_binding_key_id!==offer.checkout_binding_key_id||
  recipient.checkout_offer_snapshot_sha256!==offerSha||recipient.lead_route_recipient_hmac_sha256!==offer.lead_route_recipient_hmac_sha256||recipient.stripe_mode!==mode||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.claim_recipient_email)||recipient.claim_recipient_email_sha256!==await sha256(recipient.claim_recipient_email)||
  !/^[a-f0-9]{64}$/.test(recipient.approval_content_sha256)||((recipient.lead_route_recipient_hmac_sha256!=="")!==/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.lead_notification_email)))
  throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: recipient reservation binding");
await verifyHex(key,clean(inputData.checkout_recipient_reservation_hmac_sha256).toLowerCase(),`arc1-checkout-recipient-reservation-signature-v1\n${mode}\n${recipientRaw}`,"recipient reservation");

const coreRaw=clean(inputData.checkout_readiness_core_private),core=parseCanonical(coreRaw,"readiness core"),coreSha=await sha256(coreRaw);
const coreFields=["approval_content_sha256","asset_publication_receipt_sha256","check_app_id","check_app_slug","check_name","checkout_offer_snapshot_sha256","checkout_recipient_reservation_sha256","content_sha256","customer_email_sha256","email_state_token_sha256","head_sha","merge_commit_sha","merged_at","preview_folder","preview_path","preview_url","pr_number","published_html_sha256","repository","scope","script_manifest_sha256","source_tree_sha","version"];
exactKeys(core,coreFields,"readiness core");
if(core.version!=="arc1-preview-readiness-core-v1"||core.scope!=="immutable-private-checkout-content-and-recipient-readiness"||core.repository!==offer.preview_source_repository||
  core.preview_folder!==offer.preview_folder||core.preview_path!==offer.preview_path||core.approval_content_sha256!==recipient.approval_content_sha256||core.checkout_offer_snapshot_sha256!==offerSha||
  core.checkout_recipient_reservation_sha256!==recipientSha||core.asset_publication_receipt_sha256!==offer.asset_publication_receipt_sha256||
  core.customer_email_sha256!==recipient.claim_recipient_email_sha256||
  ![core.content_sha256,core.customer_email_sha256,core.email_state_token_sha256,core.published_html_sha256].every(value=>/^[a-f0-9]{64}$/.test(value))||core.script_manifest_sha256!=="8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b"||
  ![core.head_sha,core.merge_commit_sha,core.source_tree_sha].every(value=>/^[a-f0-9]{40}$/.test(value))||core.check_name!=="ARC preview quality/preview-quality"||core.check_app_slug!=="github-actions"||core.check_app_id!==15368)
  throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: readiness core binding");
if(clean(inputData.checkout_readiness_core_sha256).toLowerCase()!==coreSha)throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: readiness core digest");
await verifyHex(key,clean(inputData.checkout_readiness_core_hmac_sha256).toLowerCase(),`arc1-preview-readiness-core-signature-v1\n${mode}\n${coreRaw}`,"readiness core");

const observationRaw=clean(inputData.checkout_readiness_observation_private),observation=parseCanonical(observationRaw,"readiness observation");
exactKeys(observation,["current_main_html_sha256","current_main_sha","expires_at","issued_at","pages_content_sha256","readiness_core_sha256","scope","version"],"readiness observation");
const observationIssued=Date.parse(observation.issued_at),observationExpires=Date.parse(observation.expires_at),now=Date.now();
if(observation.version!=="arc1-preview-readiness-observation-v1"||observation.scope!=="renewable-private-checkout-readiness-observation"||observation.readiness_core_sha256!==coreSha||
  !/^[a-f0-9]{40}$/.test(observation.current_main_sha)||observation.current_main_html_sha256!==core.published_html_sha256||observation.pages_content_sha256!==core.published_html_sha256||
  !Number.isFinite(observationIssued)||!Number.isFinite(observationExpires)||new Date(observationIssued).toISOString()!==observation.issued_at||new Date(observationExpires).toISOString()!==observation.expires_at||
  observationIssued>now+300000||observationExpires<=observationIssued||observationExpires-observationIssued>600000)
  throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: readiness observation binding");
await verifyHex(key,clean(inputData.checkout_readiness_observation_hmac_sha256).toLowerCase(),`arc1-preview-readiness-observation-signature-v1\n${mode}\n${observationRaw}`,"readiness observation");
const observationSha=await sha256(observationRaw);
const requireFreshObservation=()=>{if(observationExpires<=Date.now())throw new Error("ARC_PRIVATE_CHECKOUT_WAIT: refresh readiness before first provider mutation");};

const policy=canonicalJson({version:"arc-private-checkout-policy-v1",scope:"one-approved-preview-one-private-payment-link",checkout_binding_key_id:offer.checkout_binding_key_id,
  stripe_mode:mode,stripe_account_id_sha256:offer.stripe_account_id_sha256,price_id:offer.price_id,product_id:offer.product_id,amount_subtotal_minor_units:offer.amount_subtotal_minor_units,
  currency:offer.currency,quantity:offer.quantity,terms_version:offer.terms_version,terms_document_sha256:offer.terms_document_sha256,automatic_tax_enabled:true,
  customer_address_source:offer.customer_address_source,price_tax_behavior:offer.price_tax_behavior,product_tax_code:offer.product_tax_code,tax_contract_version:offer.tax_contract_version,
  payment_method_selection:"dynamic",
  tax_registrations:offer.tax_registrations,tax_registrations_sha256:offer.tax_registrations_sha256,adult_acknowledgement_key:offer.adult_acknowledgement_key,
  name_collection_required:true,checkout_redirect_url:offer.checkout_redirect_url,completed_sessions_limit:1,stripe_api_version:offer.stripe_api_version,
  preview_source_repository:core.repository,preview_folder:core.preview_folder,preview_path:core.preview_path,approval_content_sha256:core.approval_content_sha256,
  content_sha256:core.content_sha256,published_html_sha256:core.published_html_sha256,source_commit_sha:core.merge_commit_sha,source_tree_sha:core.source_tree_sha,
  asset_publication_receipt_sha256:core.asset_publication_receipt_sha256,lead_route_recipient_hmac_sha256:offer.lead_route_recipient_hmac_sha256,
  claim_recipient_email_sha256:core.customer_email_sha256,readiness_core_sha256:coreSha,offer_snapshot_sha256:offerSha,recipient_reservation_sha256:recipientSha});
const policySha=await sha256(policy);
const referencePayload=new Uint8Array(69);referencePayload.set(hexBytes(offer.checkout_binding_key_id),0);referencePayload.set(hexBytes(offer.public_folder_prefix),1);referencePayload.set(hexBytes(core.approval_content_sha256),5);referencePayload.set(hexBytes(policySha),37);
const referenceDomain=encoder.encode(`arc-checkout-reference-v3\narcwebhq-cpu/arc-previews\narc-production\nstripe-${mode}\n`),referenceMessage=new Uint8Array(referenceDomain.length+referencePayload.length);referenceMessage.set(referenceDomain);referenceMessage.set(referencePayload,referenceDomain.length);
const referenceMac=new Uint8Array(await crypto.subtle.sign("HMAC",key,referenceMessage));
const checkoutReference=`v3_${Buffer.concat([Buffer.from(referencePayload),Buffer.from(referenceMac)]).toString("base64url")}`;
if(checkoutReference.length!==138)throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: packed reference length");
const referenceSha=await sha256(checkoutReference);
const intentKeyHmac=await hmacHex(key,`arc-private-checkout-intent-key-v1\n${mode}\n${referenceSha}`);
const linkMetadata={arc_intent_sha256:"",arc_policy_sha256:policySha,arc_preview_commit:core.merge_commit_sha,arc_v3_ref:checkoutReference,arc_v3_ref_sha256:referenceSha,tax_contract_version:offer.tax_contract_version,terms_document_sha256:offer.terms_document_sha256,terms_version:offer.terms_version};
const buildCreateBody=async()=>{
  const params=new URLSearchParams();
  const set=(key,value)=>params.append(key,String(value));
  set("line_items[0][price]",offer.price_id);set("line_items[0][quantity]","1");set("automatic_tax[enabled]","true");set("billing_address_collection","auto");
  set("consent_collection[terms_of_service]","required");set("custom_fields[0][key]","adultpurchaserack");set("custom_fields[0][label][type]","custom");
  set("custom_fields[0][label][custom]","I am 18+ and authorized to buy for this business");set("custom_fields[0][optional]","false");set("custom_fields[0][type]","dropdown");
  set("custom_fields[0][dropdown][options][0][label]","I confirm");set("custom_fields[0][dropdown][options][0][value]","accepted");
  set("name_collection[business][enabled]","true");set("name_collection[business][optional]","false");set("name_collection[individual][enabled]","true");set("name_collection[individual][optional]","false");
  set("after_completion[type]","redirect");set("after_completion[redirect][url]",offer.checkout_redirect_url);set("restrictions[completed_sessions][limit]","1");
  set("allow_promotion_codes","false");set("customer_creation","if_required");set("invoice_creation[enabled]","false");set("phone_number_collection[enabled]","false");set("tax_id_collection[enabled]","false");set("submit_type","auto");
  for(const name of Object.keys(linkMetadata).sort())if(name!=="arc_intent_sha256")set(`metadata[${name}]`,linkMetadata[name]);
  const provisional=params.toString(),intentSha=await sha256(provisional);linkMetadata.arc_intent_sha256=intentSha;set("metadata[arc_intent_sha256]",intentSha);
  return {body:params.toString(),intentSha};
};
const {body:createBody,intentSha}=await buildCreateBody();
const createRequestSha=await sha256(createBody),idempotencyKey=`arc-private-checkout-v1-${await hmacHex(key,`arc-private-checkout-idempotency-v1\n${mode}\n${referenceSha}\n${createRequestSha}`)}`;
const prepared={version:"arc-private-checkout-link-intent-v1",scope:"durable-create-before-provider-mutation",status:"PREPARED",record_key_hmac_sha256:intentKeyHmac,
  checkout_reference:checkoutReference,checkout_reference_sha256:referenceSha,checkout_policy_private:policy,checkout_policy_sha256:policySha,readiness_core_sha256:coreSha,
  offer_snapshot_sha256:offerSha,recipient_reservation_sha256:recipientSha,create_request_sha256:createRequestSha,provider_intent_sha256:intentSha,
  idempotency_key:idempotencyKey,stripe_mode:mode,stripe_account_id_sha256:offer.stripe_account_id_sha256,credential_key_id:clean(inputData.stripe_credential_key_id)};
if(!/^[a-z0-9_-]{2,64}$/.test(prepared.credential_key_id))throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: Stripe credential key id");
const preparedRaw=canonicalJson(prepared);
const preparedSha=await sha256(preparedRaw);
const parseState=(raw,label)=>raw?parseCanonical(clean(raw),label):null;
const exactState=(actual,expected,label)=>{if(!actual||canonicalJson(actual)!==canonicalJson(expected))throw new Error(`ARC_PRIVATE_CHECKOUT_CONFLICT: ${label}`);};
const preparedFields=Object.keys(prepared);
const exactPreparedBase=(state,status,label)=>{
  exactKeys(state,preparedFields,label);
  const expected={...prepared,status};
  exactState(state,expected,label);
};
const startedFields=[...preparedFields,"provider_authorization_observation_sha256","provider_mutation_started_at","provider_idempotency_reconcile_after","state_hmac_sha256"];
const validateStarted=async state=>{
  if(!state||state.status!=="MUTATION_STARTED")throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: durable MUTATION_STARTED intent required");
  exactKeys(state,startedFields,"MUTATION_STARTED state");
  const unsigned={...state};delete unsigned.state_hmac_sha256;
  const staticState={...unsigned};delete staticState.provider_authorization_observation_sha256;delete staticState.provider_mutation_started_at;delete staticState.provider_idempotency_reconcile_after;
  exactState(staticState,{...prepared,status:"MUTATION_STARTED"},"MUTATION_STARTED immutable fields");
  const startedMs=Date.parse(state.provider_mutation_started_at),reconcileMs=Date.parse(state.provider_idempotency_reconcile_after);
  if(!/^[a-f0-9]{64}$/.test(state.provider_authorization_observation_sha256)||!Number.isFinite(startedMs)||!Number.isFinite(reconcileMs)||
    new Date(startedMs).toISOString()!==state.provider_mutation_started_at||new Date(reconcileMs).toISOString()!==state.provider_idempotency_reconcile_after||
    reconcileMs!==startedMs+23*60*60*1000)throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: MUTATION_STARTED timestamps");
  if(state.provider_authorization_observation_sha256===observationSha&&state.provider_mutation_started_at!==observation.issued_at)
    throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: MUTATION_STARTED observation binding");
  await verifyHex(key,clean(state.state_hmac_sha256).toLowerCase(),`arc-private-checkout-mutation-state-v1\n${mode}\n${canonicalJson(unsigned)}`,"MUTATION_STARTED state");
  return state;
};
const receiptFields=["checkout_policy_sha256","checkout_reference_sha256","create_request_sha256","credential_key_id","payment_link_id","payment_link_url_sha256","provider_intent_sha256","readback_sha256","scope","stripe_account_id_sha256","stripe_mode","version"];
const reverseFields=["checkout_policy_private","checkout_policy_sha256","checkout_recipient_reservation_hmac_sha256","checkout_recipient_reservation_private","checkout_reference","checkout_reference_sha256","link_id_hmac_sha256","link_receipt_hmac_sha256","link_receipt_private","link_receipt_sha256","payment_link_id","scope","version"];
const linkStateFields=[...preparedFields,"link_id_hmac_sha256","link_receipt_hmac_sha256","link_receipt_private","link_receipt_sha256","payment_link_id","reverse_mapping_private","reverse_mapping_sha256"];
const validateLinkState=async(state,allowedStatuses)=>{
  if(!state||!allowedStatuses.has(state.status))throw new Error(`ARC_PRIVATE_CHECKOUT_CONFLICT: ${[...allowedStatuses].join(" or ")} state required`);
  exactKeys(state,linkStateFields,`${state.status} state`);
  const staticState={...state};for(const name of linkStateFields)if(!preparedFields.includes(name))delete staticState[name];
  exactState(staticState,{...prepared,status:state.status},`${state.status} immutable fields`);
  const linkId=clean(state.payment_link_id);
  if(!/^plink_[A-Za-z0-9]+$/.test(linkId)||state.link_id_hmac_sha256!==await hmacHex(key,`arc-private-checkout-link-id-key-v1\n${mode}\n${linkId}`))
    throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: Link identity");
  const receiptRaw=clean(state.link_receipt_private),receipt=parseCanonical(receiptRaw,"embedded Link receipt");
  exactKeys(receipt,receiptFields,"embedded Link receipt");
  if(state.link_receipt_sha256!==await sha256(receiptRaw)||receipt.version!=="arc-private-checkout-link-receipt-v1"||receipt.scope!=="validated-one-use-private-payment-link"||
    receipt.payment_link_id!==linkId||receipt.checkout_reference_sha256!==referenceSha||receipt.checkout_policy_sha256!==policySha||receipt.provider_intent_sha256!==intentSha||
    receipt.create_request_sha256!==createRequestSha||receipt.stripe_mode!==mode||receipt.stripe_account_id_sha256!==offer.stripe_account_id_sha256||
    receipt.credential_key_id!==prepared.credential_key_id||!/^([a-f0-9]{64})$/.test(receipt.payment_link_url_sha256)||!/^([a-f0-9]{64})$/.test(receipt.readback_sha256))
    throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: Link receipt binding");
  await verifyHex(key,clean(state.link_receipt_hmac_sha256).toLowerCase(),`arc-private-checkout-link-receipt-signature-v1\n${mode}\n${receiptRaw}`,"Link receipt");
  const reverseRaw=clean(state.reverse_mapping_private),reverse=parseCanonical(reverseRaw,"embedded reverse state");
  exactKeys(reverse,reverseFields,"embedded reverse state");
  if(state.reverse_mapping_sha256!==await sha256(reverseRaw)||reverse.version!=="arc-private-checkout-link-reverse-v1"||reverse.scope!=="private-link-id-to-approved-reference"||
    reverse.link_id_hmac_sha256!==state.link_id_hmac_sha256||reverse.payment_link_id!==linkId||reverse.checkout_reference!==checkoutReference||
    reverse.checkout_reference_sha256!==referenceSha||reverse.checkout_policy_private!==policy||reverse.checkout_policy_sha256!==policySha||
    reverse.checkout_recipient_reservation_private!==recipientRaw||reverse.checkout_recipient_reservation_hmac_sha256!==clean(inputData.checkout_recipient_reservation_hmac_sha256).toLowerCase()||
    reverse.link_receipt_private!==receiptRaw||reverse.link_receipt_sha256!==state.link_receipt_sha256||reverse.link_receipt_hmac_sha256!==state.link_receipt_hmac_sha256)
    throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: embedded reverse mapping");
  return {state,reverseRaw,reverse,receiptRaw,receipt};
};

if(phase==="PREPARE"){
  requireFreshObservation();
  const existing=parseState(inputData.private_checkout_intent_state,"intent state");if(existing)exactState(existing,prepared,"prepared intent replay");
  return{status:existing?"PRIVATE_CHECKOUT_INTENT_REUSED":"PRIVATE_CHECKOUT_INTENT_PREPARE",provider_write_allowed:false,url_exposure_allowed:false,
    intent_record_key_hmac_sha256:intentKeyHmac,intent_state_write_required:!existing,private_checkout_intent_state:preparedRaw,
    checkout_policy_private:policy,checkout_policy_sha256:policySha,checkout_reference:checkoutReference,checkout_reference_sha256:referenceSha};
}

const inputIntent=parseState(inputData.private_checkout_intent_state,"intent state");
if(phase==="AUTHORIZE_MUTATION"){
  requireFreshObservation();
  if(inputIntent?.status==="MUTATION_STARTED"){
    await validateStarted(inputIntent);
    return{status:"PRIVATE_CHECKOUT_MUTATION_ALREADY_AUTHORIZED",provider_write_allowed:false,mutation_state_write_required:false,private_checkout_intent_state:canonicalJson(inputIntent)};
  }
  exactState(inputIntent,prepared,"persisted PREPARED intent required");
  const startedUnsigned={...prepared,status:"MUTATION_STARTED",provider_authorization_observation_sha256:observationSha,provider_mutation_started_at:observation.issued_at,
    provider_idempotency_reconcile_after:new Date(Date.parse(observation.issued_at)+23*60*60*1000).toISOString()};
  const started={...startedUnsigned,state_hmac_sha256:await hmacHex(key,`arc-private-checkout-mutation-state-v1\n${mode}\n${canonicalJson(startedUnsigned)}`)};
  return{status:"PRIVATE_CHECKOUT_MUTATION_AUTHORIZATION_PREPARED",provider_write_allowed:false,mutation_state_write_required:true,private_checkout_intent_state:canonicalJson(started),
    expected_previous_state_sha256:preparedSha,state_adapter_contract:"compare-and-swap exact PREPARED bytes to MUTATION_STARTED then read back exact bytes before CREATE"};
}

const operationTimeout=Number(clean(inputData.provider_operation_timeout_ms)||"20000");if(!Number.isSafeInteger(operationTimeout)||operationTimeout<100||operationTimeout>25000)throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: provider deadline");
const deadline=Date.now()+operationTimeout;
const fetchBytes=async(url,options,max,label)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(10000,deadline-Date.now())));let reader;try{const response=await fetch(url,{...options,redirect:"error",signal:controller.signal});if(response.url&&response.url!==url)throw new Error(`${label}: redirect`);if(!response.ok)throw new Error(`${label}: HTTP ${response.status}`);const length=response.headers?.get?.("content-length");if(length&&(!/^\d+$/.test(length)||Number(length)>max))throw new Error(`${label}: too large`);reader=response.body?.getReader?.();if(!reader)throw new Error(`${label}: streaming required`);let total=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){try{await reader.cancel();}catch{}throw new Error(`${label}: too large`);}chunks.push(Buffer.from(value));}return Buffer.concat(chunks,total);}catch(error){if(error?.name==="AbortError")throw new Error(`${label}: timeout`);throw error;}finally{clearTimeout(timer);try{reader?.releaseLock?.();}catch{}}};
const fetchJson=async(url,options,max,label)=>{const bytes=await fetchBytes(url,options,max,label);try{return JSON.parse(bytes.toString("utf8"));}catch{throw new Error(`${label}: JSON`);}};
const fetchJsonStatus=async(url,options,max,label,allowed=[])=>{if(deadline-Date.now()<=0)throw new Error(`${label}: operation deadline exhausted`);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(10000,deadline-Date.now())));let reader;try{const response=await fetch(url,{...options,redirect:"error",signal:controller.signal});if(response.url&&response.url!==url)throw new Error(`${label}: redirect`);const length=response.headers?.get?.("content-length");if(length&&(!/^\d+$/.test(length)||Number(length)>max))throw new Error(`${label}: too large`);reader=response.body?.getReader?.();if(!reader)throw new Error(`${label}: streaming required`);let total=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){try{await reader.cancel();}catch{}throw new Error(`${label}: too large`);}chunks.push(Buffer.from(value));}let body={};if(total){try{body=JSON.parse(Buffer.concat(chunks,total).toString("utf8"));}catch{throw new Error(`${label}: JSON`);}}if(!response.ok&&!allowed.includes(response.status))throw new Error(`${label}: HTTP ${response.status}`);return{status:response.status,body};}catch(error){if(error?.name==="AbortError")throw new Error(`${label}: timeout`);throw error;}finally{clearTimeout(timer);try{reader?.releaseLock?.();}catch{}}};
const stripeKey=clean(inputData.stripe_api_key);if(!new RegExp(`^rk_${mode}_[A-Za-z0-9_]{12,}$`).test(stripeKey))throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: exact mode restricted Stripe key");
const stripeHeaders={Accept:"application/json",Authorization:`Basic ${Buffer.from(`${stripeKey}:`).toString("base64")}`,"Stripe-Version":"2026-06-24.dahlia"};
const expectedAdultField=[{key:"adultpurchaserack",type:"dropdown",optional:false,label:{type:"custom",custom:"I am 18+ and authorized to buy for this business"},dropdown:{options:[{label:"I confirm",value:"accepted"}]}}];
const expectedNameCollection={business:{enabled:true,optional:false},individual:{enabled:true,optional:false}};
const validateLink=async link=>{if(!link||link.object!=="payment_link"||!/^plink_[A-Za-z0-9]+$/.test(clean(link.id))||link.livemode!==offer.livemode||link.active!==true||
  !/^https:\/\/buy\.stripe\.com\/(?:test_)?[A-Za-z0-9]+$/.test(clean(link.url))||link.restrictions?.completed_sessions?.limit!==1||link.automatic_tax?.enabled!==true||
  link.billing_address_collection!=="auto"||link.consent_collection?.terms_of_service!=="required"||link.allow_promotion_codes!==false||
  canonicalJson(link.custom_fields)!==canonicalJson(expectedAdultField)||canonicalJson(link.name_collection)!==canonicalJson(expectedNameCollection)||link.submit_type!=="auto"||
  link.after_completion?.type!=="redirect"||clean(link.after_completion?.redirect?.url)!==offer.checkout_redirect_url||link.customer_creation!=="if_required"||
  link.invoice_creation?.enabled!==false||link.phone_number_collection?.enabled!==false||link.tax_id_collection?.enabled!==false||link.shipping_address_collection!=null||
  !Array.isArray(link.optional_items)||link.optional_items.length!==0||
  Object.entries(linkMetadata).some(([name,value])=>clean(link.metadata?.[name])!==value))throw new Error("ARC_PRIVATE_CHECKOUT_PROVIDER_MISMATCH: Payment Link readback");
  const items=link.line_items,readbackProduct=items?.data?.[0]?.price?.product;
  if(!items||items.has_more!==false||!Array.isArray(items.data)||items.data.length!==1||items.data[0]?.quantity!==1||clean(items.data[0]?.price?.id)!==offer.price_id||
    clean(readbackProduct?.id)!==offer.product_id||clean(typeof readbackProduct?.tax_code==="object"?readbackProduct.tax_code?.id:readbackProduct?.tax_code)!==offer.product_tax_code)
    throw new Error("ARC_PRIVATE_CHECKOUT_PROVIDER_MISMATCH: Payment Link line item readback");return link;};

if(phase==="CREATE"){
  await validateStarted(inputIntent);
  const account=await fetchJson("https://api.stripe.com/v1/account",{method:"GET",headers:stripeHeaders},128000,"ARC_PRIVATE_CHECKOUT_STRIPE_ACCOUNT");
  if(account.object!=="account"||await sha256(clean(account.id))!==offer.stripe_account_id_sha256)throw new Error("ARC_PRIVATE_CHECKOUT_PROVIDER_MISMATCH: Stripe account");
  let link;
  const observationFresh=observationExpires>Date.now();
  if(observationFresh&&Date.now()<Date.parse(inputIntent.provider_idempotency_reconcile_after)){
    const created=await fetchJson("https://api.stripe.com/v1/payment_links",{method:"POST",headers:{...stripeHeaders,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":idempotencyKey},body:createBody},512000,"ARC_PRIVATE_CHECKOUT_STRIPE_CREATE");
    const id=clean(created.id);if(!/^plink_[A-Za-z0-9]+$/.test(id))throw new Error("ARC_PRIVATE_CHECKOUT_PROVIDER_MISMATCH: create response Link id");
    link=await fetchJson(`https://api.stripe.com/v1/payment_links/${encodeURIComponent(id)}?expand%5B%5D=line_items.data.price.product`,{method:"GET",headers:stripeHeaders},1000000,"ARC_PRIVATE_CHECKOUT_STRIPE_READBACK");
  }else{
    const candidates=[];let startingAfter="";
    for(let page=0;page<20;page++){
      const cursor=startingAfter?`&starting_after=${encodeURIComponent(startingAfter)}`:"";
      const listing=await fetchJson(`https://api.stripe.com/v1/payment_links?limit=100${cursor}`,{method:"GET",headers:stripeHeaders},2000000,"ARC_PRIVATE_CHECKOUT_STRIPE_RECONCILE");
      if(listing?.object!=="list"||!Array.isArray(listing.data)||typeof listing.has_more!=="boolean"||listing.data.length>100)
        throw new Error("ARC_PRIVATE_CHECKOUT_AMBIGUOUS: invalid reconciliation page");
      for(const item of listing.data)if(clean(item.metadata?.arc_intent_sha256)===intentSha)candidates.push(item);
      if(candidates.length>1)throw new Error("ARC_PRIVATE_CHECKOUT_AMBIGUOUS: multiple provider Links match the immutable intent");
      if(!listing.has_more){startingAfter="";break;}
      const last=listing.data.at(-1),next=clean(last?.id);
      if(listing.data.length===0||!/^plink_[A-Za-z0-9]+$/.test(next)||next===startingAfter)throw new Error("ARC_PRIVATE_CHECKOUT_AMBIGUOUS: invalid reconciliation cursor");
      startingAfter=next;
      if(page===19)throw new Error("ARC_PRIVATE_CHECKOUT_AMBIGUOUS: reconciliation page bound exceeded");
    }
    if(startingAfter||candidates.length!==1)throw new Error("ARC_PRIVATE_CHECKOUT_AMBIGUOUS: expired readiness or stale idempotency requires exact read-only reconciliation/operator review");
    link=await fetchJson(`https://api.stripe.com/v1/payment_links/${encodeURIComponent(clean(candidates[0].id))}?expand%5B%5D=line_items.data.price.product`,{method:"GET",headers:stripeHeaders},1000000,"ARC_PRIVATE_CHECKOUT_STRIPE_READBACK");
  }
  await validateLink(link);const linkId=clean(link.id),linkIdHmac=await hmacHex(key,`arc-private-checkout-link-id-key-v1\n${mode}\n${linkId}`),urlSha=await sha256(clean(link.url));
  const readbackSha=await sha256(canonicalJson({id:linkId,active:link.active,livemode:link.livemode,url_sha256:urlSha,metadata:linkMetadata,completed_sessions_limit:1,price_id:offer.price_id,product_id:offer.product_id}));
  const receipt=canonicalJson({version:"arc-private-checkout-link-receipt-v1",scope:"validated-one-use-private-payment-link",payment_link_id:linkId,payment_link_url_sha256:urlSha,
    checkout_reference_sha256:referenceSha,checkout_policy_sha256:policySha,provider_intent_sha256:intentSha,create_request_sha256:createRequestSha,stripe_mode:mode,
    stripe_account_id_sha256:offer.stripe_account_id_sha256,credential_key_id:prepared.credential_key_id,readback_sha256:readbackSha});
  const receiptSha=await sha256(receipt),receiptHmac=await hmacHex(key,`arc-private-checkout-link-receipt-signature-v1\n${mode}\n${receipt}`);
  const reverse=canonicalJson({version:"arc-private-checkout-link-reverse-v1",scope:"private-link-id-to-approved-reference",link_id_hmac_sha256:linkIdHmac,payment_link_id:linkId,
    checkout_reference:checkoutReference,checkout_reference_sha256:referenceSha,checkout_policy_private:policy,checkout_policy_sha256:policySha,
    checkout_recipient_reservation_private:recipientRaw,checkout_recipient_reservation_hmac_sha256:clean(inputData.checkout_recipient_reservation_hmac_sha256).toLowerCase(),
    link_receipt_private:receipt,link_receipt_sha256:receiptSha,link_receipt_hmac_sha256:receiptHmac});
  const linkCreated=canonicalJson({...prepared,status:"LINK_CREATED",payment_link_id:linkId,link_id_hmac_sha256:linkIdHmac,link_receipt_private:receipt,link_receipt_sha256:receiptSha,
    link_receipt_hmac_sha256:receiptHmac,reverse_mapping_private:reverse,reverse_mapping_sha256:await sha256(reverse)});
  return{status:"PRIVATE_CHECKOUT_LINK_VALIDATED",provider_write_attempted:true,url_exposure_allowed:false,link_reverse_record_key_hmac_sha256:linkIdHmac,
    link_reverse_state_write_required:false,active_forward_state_write_required:false,link_created_state_write_required:true,private_checkout_intent_state:linkCreated,
    payment_link_id_private:linkId,link_receipt_private:receipt,link_receipt_sha256:receiptSha,link_receipt_hmac_sha256:receiptHmac};
}

if(phase==="PERSIST_REVERSE"){
  const {reverseRaw,reverse}=await validateLinkState(inputIntent,new Set(["LINK_CREATED"]));
  const existing=parseState(inputData.private_link_reverse_state,"persisted reverse state");if(existing&&canonicalJson(existing)!==reverseRaw)throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: reverse index already differs");
  return{status:existing?"PRIVATE_CHECKOUT_REVERSE_REUSED":"PRIVATE_CHECKOUT_REVERSE_PREPARED",provider_write_allowed:false,url_exposure_allowed:false,
    link_reverse_record_key_hmac_sha256:inputIntent.link_id_hmac_sha256,link_reverse_state_write_required:!existing,private_link_reverse_state:reverseRaw,
    expected_forward_status:"LINK_CREATED",state_adapter_contract:"create-or-exact reverse before forward CAS"};
}

if(phase==="ACTIVATE"){
  await validateLinkState(inputIntent,new Set(["LINK_CREATED","ACTIVE"]));
  const reverseRaw=clean(inputData.private_link_reverse_state),reverse=parseCanonical(reverseRaw,"persisted reverse state");
  exactKeys(reverse,reverseFields,"persisted reverse state");
  if(await sha256(reverseRaw)!==inputIntent.reverse_mapping_sha256||reverse.checkout_reference!==checkoutReference||reverse.checkout_reference_sha256!==referenceSha||
    reverse.checkout_policy_sha256!==policySha||reverse.payment_link_id!==inputIntent.payment_link_id)throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: persisted reverse mapping");
  const active={...inputIntent,status:"ACTIVE"};
  return{status:inputIntent.status==="ACTIVE"?"PRIVATE_CHECKOUT_ACTIVE_REUSED":"PRIVATE_CHECKOUT_ACTIVE_PREPARED",provider_write_allowed:false,url_exposure_allowed:false,
    active_forward_state_write_required:inputIntent.status!=="ACTIVE",private_checkout_intent_state:canonicalJson(active),
    expected_previous_forward_status:"LINK_CREATED",state_adapter_contract:"compare-and-swap LINK_CREATED to exact ACTIVE after reverse readback"};
}

// FINALIZE: mappings must already be durable. Re-read active Link before URL
// exposure, then create exact ready/email tags and return the URL privately.
const emailStateRaw=clean(inputData.email_state),emailState=parseCanonical(emailStateRaw,"email state"),emailToken=clean(inputData.email_state_token),customerEmail=clean(inputData.customer_email).toLowerCase();
const emailStatus=clean(emailState.status).toUpperCase();
const emailBaseFields=["asset_publication_receipt_sha256","content_sha256","created_at","expires_at","head_sha","pr_number","preview_folder","recipient_sha256","status","token_sha256","version"];
const emailClaimFields=[...emailBaseFields,"checkout_reference_sha256","claim_token_sha256","link_receipt_sha256"];
exactKeys(emailState,emailStatus==="PENDING"?emailBaseFields:emailClaimFields,"email state");
const emailCreatedAt=Date.parse(emailState.created_at),emailExpiresAt=Date.parse(emailState.expires_at),emailNow=Date.now();
if(emailState.version!=="arc-preview-email-state-v1"||!new Set(["PENDING","CLAIMED","SENT"]).has(emailStatus)||
  emailState.status!==emailStatus||emailState.token_sha256!==await sha256(emailToken)||emailState.recipient_sha256!==await sha256(customerEmail)||
  emailState.preview_folder!==core.preview_folder||emailState.content_sha256!==core.content_sha256||emailState.asset_publication_receipt_sha256!==core.asset_publication_receipt_sha256||
  emailState.head_sha!==core.head_sha||emailState.pr_number!==core.pr_number||core.customer_email_sha256!==await sha256(customerEmail)||
  !Number.isFinite(emailCreatedAt)||!Number.isFinite(emailExpiresAt)||new Date(emailCreatedAt).toISOString()!==emailState.created_at||new Date(emailExpiresAt).toISOString()!==emailState.expires_at||
  emailCreatedAt>emailNow+300000||emailExpiresAt<=emailCreatedAt||emailExpiresAt-emailCreatedAt>24*60*60*1000||emailExpiresAt<=emailNow)
  throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: private email state expired or invalid");
requireFreshObservation();
await validateLinkState(inputIntent,new Set(["ACTIVE"]));
const reverseRaw=clean(inputData.private_link_reverse_state),reverse=parseCanonical(reverseRaw,"link reverse state");
exactKeys(reverse,reverseFields,"link reverse state");
if(reverse.checkout_reference!==checkoutReference||reverse.checkout_reference_sha256!==referenceSha||reverse.checkout_policy_sha256!==policySha||
  reverse.payment_link_id!==inputIntent.payment_link_id||await sha256(reverseRaw)!==inputIntent.reverse_mapping_sha256)throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: forward/reverse mapping");
const link=await fetchJson(`https://api.stripe.com/v1/payment_links/${encodeURIComponent(inputIntent.payment_link_id)}?expand%5B%5D=line_items.data.price.product`,{method:"GET",headers:stripeHeaders},1000000,"ARC_PRIVATE_CHECKOUT_STRIPE_PREEXPOSURE_READBACK");
await validateLink(link);
const githubToken=clean(inputData.github_token);if(!githubToken)throw new Error("ARC_PRIVATE_CHECKOUT_INVALID: github token");
const api="https://api.github.com/repos/arcwebhq-cpu/arc-previews",githubHeaders={Accept:"application/vnd.github+json",Authorization:`Bearer ${githubToken}`,"Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"};
const github=async(url,options={},allowed=[])=>{const response=await fetchJsonStatus(url,{...options,headers:{...githubHeaders,...(options.headers||{})}},65536,"ARC_PRIVATE_CHECKOUT_GITHUB",allowed);return allowed.includes(response.status)&&response.status>=400?{_status:response.status}:response.body;};
const createExactTag=async(name,sha)=>{const created=await github(`${api}/git/refs`,{method:"POST",body:JSON.stringify({ref:`refs/tags/${name}`,sha})},[422]);if(created._status){const found=await github(`${api}/git/ref/${encodeURIComponent(`tags/${name}`)}`);if(clean(found.ref)!==`refs/tags/${name}`||clean(found.object?.type)!=="commit"||clean(found.object?.sha).toLowerCase()!==sha)throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: tag replay");}else if(clean(created.ref)!==`refs/tags/${name}`||clean(created.object?.type)!=="commit"||clean(created.object?.sha).toLowerCase()!==sha)throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: tag create");};
await createExactTag(`arc-checkout-ready-v3/${referenceSha}`,core.merge_commit_sha);
const emailClaim=await sha256(`arc-preview-private-checkout-email-v1\n${referenceSha}\n${core.merge_commit_sha}\n${inputIntent.link_receipt_sha256}`);
await createExactTag(`arc-preview-email/${emailClaim}`,core.merge_commit_sha);
const nextEmail={...emailState,status:"CLAIMED",claim_token_sha256:emailClaim,checkout_reference_sha256:referenceSha,link_receipt_sha256:inputIntent.link_receipt_sha256};
if(emailState.status==="SENT")return{status:"PRIVATE_PREVIEW_AND_CHECKOUT_EMAIL_ALREADY_SENT",send_preview_email:false,private_checkout_link_allowed:false,url_exposure_allowed:false};
if(emailState.status==="CLAIMED"&&(emailState.claim_token_sha256!==emailClaim||emailState.checkout_reference_sha256!==referenceSha||emailState.link_receipt_sha256!==inputIntent.link_receipt_sha256))throw new Error("ARC_PRIVATE_CHECKOUT_CONFLICT: claimed email replay");
return{status:"READY_TO_SEND_PRIVATE_PREVIEW_AND_CHECKOUT_EMAIL",send_preview_email:true,checkout_url_private:clean(link.url),checkout_reference_private:checkoutReference,
  email_state_write_required_before_email:emailState.status==="PENDING",next_email_state:canonicalJson(nextEmail),email_provider_idempotency_key:`arc-preview-${emailClaim}`,
  customer_email:customerEmail,preview_url:core.preview_url,private_checkout_link_allowed:true,ready_tag:`arc-checkout-ready-v3/${referenceSha}`};
