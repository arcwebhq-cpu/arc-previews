// ARC1 unpaid private Payment Link lifecycle. This step is deliberately a pure
// adapter contract: it performs no network request, accepts no Stripe key, and
// never returns a Link URL. Every state/provider gate defaults OFF.
//
// ENROLL_ACTIVE -> persist a signed ACTIVE lease with an explicit expiry.
// REQUEST_DEACTIVATION -> persist authorization before an adapter mutation.
// CONFIRM_DEACTIVATION -> require signed active=false and unpaid evidence.
// AUTHORIZE_RENEWAL -> require fresh offer/tax + preview readiness evidence.
// FINALIZE_RENEWAL -> rerun both proofs after create, then activate the renewal.
const clean=value=>String(value==null?"":value).trim();
const enabled=name=>clean(inputData[name])==="true";
const phase=clean(inputData.phase).toUpperCase();
const phases=new Set(["ENROLL_ACTIVE","REQUEST_DEACTIVATION","CONFIRM_DEACTIVATION","AUTHORIZE_RENEWAL","FINALIZE_RENEWAL"]);
if(!phases.has(phase))throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: phase");
if(!enabled("private_checkout_lifecycle_enabled"))throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_DISABLED: lifecycle gate is off");
if(new Set(["ENROLL_ACTIVE","CONFIRM_DEACTIVATION","FINALIZE_RENEWAL"]).has(phase)&&!enabled("private_checkout_lifecycle_state_commit_enabled"))
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_DISABLED: state commit gate is off");
if(phase==="REQUEST_DEACTIVATION"&&!enabled("private_checkout_deactivation_adapter_enabled"))
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_DISABLED: deactivation adapter gate is off");
if(phase==="AUTHORIZE_RENEWAL"&&!enabled("private_checkout_renewal_adapter_enabled"))
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_DISABLED: renewal adapter gate is off");

const encoder=new TextEncoder();
const canonicalJson=value=>{
  if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"&&Number.isFinite(value))return JSON.stringify(Object.is(value,-0)?0:value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype)
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: canonical JSON");
};
const parseCanonical=(raw,label)=>{let value;try{value=JSON.parse(clean(raw));}catch{throw new Error(`ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: ${label} JSON`);}if(!value||typeof value!=="object"||Array.isArray(value)||canonicalJson(value)!==clean(raw))throw new Error(`ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: ${label} canonical JSON`);return value;};
const exactKeys=(value,keys,label)=>{if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))throw new Error(`ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: ${label} fields`);};
const sha256=async value=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const hexBytes=hex=>Uint8Array.from((hex.match(/../g)||[]),byte=>Number.parseInt(byte,16));
const importHmac=secret=>crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
const hmacHex=async(key,message)=>[...new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(message)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const verifyHex=async(key,signature,message,label)=>{const hex=clean(signature).toLowerCase();if(!/^[a-f0-9]{64}$/.test(hex)||!await crypto.subtle.verify("HMAC",key,hexBytes(hex),encoder.encode(message)))throw new Error(`ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: ${label} HMAC`);};
const exactIso=(value,label)=>{const milliseconds=Date.parse(clean(value));if(!Number.isFinite(milliseconds)||new Date(milliseconds).toISOString()!==value)throw new Error(`ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: ${label} timestamp`);return milliseconds;};
if(!crypto?.subtle||typeof Buffer!=="function")throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: crypto/runtime");

const bindingSecret=clean(inputData.checkout_binding_secret),offerEvidenceSecret=clean(inputData.payment_link_evidence_secret),providerEvidenceSecret=clean(inputData.provider_adapter_evidence_secret);
if([bindingSecret,offerEvidenceSecret,providerEvidenceSecret].some(secret=>encoder.encode(secret).length<32||encoder.encode(secret).length>256))
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: evidence secrets");
const bindingKey=await importHmac(bindingSecret),offerEvidenceKey=await importHmac(offerEvidenceSecret),providerEvidenceKey=await importHmac(providerEvidenceSecret);

const offerRaw=clean(inputData.checkout_offer_snapshot_private),offer=parseCanonical(offerRaw,"offer snapshot"),offerSha=await sha256(offerRaw);
const offerFields=["adult_acknowledgement_key","amount_subtotal_minor_units","asset_publication_receipt_sha256","automatic_tax_enabled","checkout_binding_key_id","checkout_redirect_url","configuration_sha256","currency","customer_address_source","environment","lead_route_recipient_hmac_sha256","livemode","name_collection_required","preview_folder","preview_path","preview_source_repository","price_id","price_tax_behavior","product_id","product_tax_code","public_folder_prefix","quantity","scope","stripe_account_id_sha256","stripe_api_version","submit_type","tax_contract_version","tax_registrations","tax_registrations_sha256","tax_settings_status","terms_document_sha256","terms_version","version"];
exactKeys(offer,offerFields,"offer snapshot");
const mode=offer.livemode?"live":"test";
if(offer.version!=="arc-checkout-offer-snapshot-v1"||offer.scope!=="immutable-approved-preview-private-checkout-offer"||offer.environment!=="arc-production"||
  offer.checkout_binding_key_id!==clean(inputData.checkout_binding_key_id).toLowerCase()||!/^[a-f0-9]{2}$/.test(offer.checkout_binding_key_id)||
  offer.amount_subtotal_minor_units!==500000||offer.currency!=="usd"||offer.quantity!==1||offer.automatic_tax_enabled!==true||offer.price_tax_behavior!=="exclusive"||
  offer.tax_contract_version!=="arc-tax-v1"||offer.tax_settings_status!=="active"||!/^price_[A-Za-z0-9]+$/.test(offer.price_id)||!/^prod_[A-Za-z0-9]+$/.test(offer.product_id)||
  !/^txcd_[0-9]{8}$/.test(offer.product_tax_code)||!/^[a-f0-9]{64}$/.test(offer.stripe_account_id_sha256)||!/^[a-f0-9]{64}$/.test(offer.configuration_sha256)||
  clean(inputData.checkout_offer_snapshot_sha256).toLowerCase()!==offerSha)throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: offer snapshot semantics");
await verifyHex(bindingKey,inputData.checkout_offer_snapshot_hmac_sha256,`arc-checkout-offer-snapshot-signature-v1\n${mode}\n${offerRaw}`,"offer snapshot");
const stableOfferConfiguration=canonicalJson({stripe_account_id_sha256:offer.stripe_account_id_sha256,livemode:offer.livemode,price_id:offer.price_id,product_id:offer.product_id,
  amount_subtotal_minor_units:offer.amount_subtotal_minor_units,currency:offer.currency,quantity:offer.quantity,terms_version:offer.terms_version,
  terms_document_sha256:offer.terms_document_sha256,automatic_tax_enabled:offer.automatic_tax_enabled,customer_address_source:offer.customer_address_source,
  price_tax_behavior:offer.price_tax_behavior,product_tax_code:offer.product_tax_code,tax_contract_version:offer.tax_contract_version,tax_settings_status:offer.tax_settings_status,
  tax_registrations:offer.tax_registrations,tax_registrations_sha256:offer.tax_registrations_sha256,adult_acknowledgement_key:offer.adult_acknowledgement_key,
  name_collection_required:offer.name_collection_required,submit_type:offer.submit_type,checkout_redirect_url:offer.checkout_redirect_url,stripe_api_version:offer.stripe_api_version});
if(await sha256(stableOfferConfiguration)!==offer.configuration_sha256)throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: offer configuration digest");

const policyRaw=clean(inputData.checkout_policy_private),policy=parseCanonical(policyRaw,"checkout policy"),policySha=await sha256(policyRaw);
if(policy.version!=="arc-private-checkout-policy-v1"||policy.scope!=="one-approved-preview-one-private-payment-link"||policy.offer_snapshot_sha256!==offerSha||
  policy.stripe_mode!==mode||policy.stripe_account_id_sha256!==offer.stripe_account_id_sha256||policy.price_id!==offer.price_id||policy.product_id!==offer.product_id||
  policy.product_tax_code!==offer.product_tax_code||policy.automatic_tax_enabled!==true||policy.payment_method_selection!=="dynamic"||
  policy.completed_sessions_limit!==1||!/^[a-f0-9]{64}$/.test(clean(policy.readiness_core_sha256)))
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: checkout policy semantics");

const receiptRaw=clean(inputData.active_link_receipt_private),receipt=parseCanonical(receiptRaw,"active Link receipt"),receiptSha=await sha256(receiptRaw);
const receiptFields=["checkout_policy_sha256","checkout_reference_sha256","create_request_sha256","credential_key_id","payment_link_id","payment_link_url_sha256","provider_intent_sha256","readback_sha256","scope","stripe_account_id_sha256","stripe_mode","version"];
exactKeys(receipt,receiptFields,"active Link receipt");
if(receipt.version!=="arc-private-checkout-link-receipt-v1"||receipt.scope!=="validated-one-use-private-payment-link"||receipt.checkout_policy_sha256!==policySha||
  receipt.stripe_mode!==mode||receipt.stripe_account_id_sha256!==offer.stripe_account_id_sha256||!/^plink_[A-Za-z0-9]+$/.test(receipt.payment_link_id)||
  ![receipt.checkout_reference_sha256,receipt.create_request_sha256,receipt.payment_link_url_sha256,receipt.provider_intent_sha256,receipt.readback_sha256].every(value=>/^[a-f0-9]{64}$/.test(clean(value)))||
  clean(inputData.active_link_receipt_sha256).toLowerCase()!==receiptSha)throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: active Link receipt semantics");
await verifyHex(bindingKey,inputData.active_link_receipt_hmac_sha256,`arc-private-checkout-link-receipt-signature-v1\n${mode}\n${receiptRaw}`,"active Link receipt");

const freshnessMs=120000,clockSkewMs=30000,now=Date.now();
const offerEvidenceFields=["adult_acknowledgement_key","amount_subtotal_minor_units","automatic_tax_enabled","checkout_redirect_url","configuration_sha256","currency","customer_address_source","issued_at","livemode","name_collection_required","price_id","price_tax_behavior","product_id","product_tax_code","quantity","scope","stripe_account_id_sha256","stripe_api_version","submit_type","tax_contract_version","tax_registrations","tax_registrations_sha256","tax_settings_status","terms_document_sha256","terms_version","version"];
const validateOfferEvidence=async(rawValue,hmacValue,minimumIssuedMs=0)=>{
  const raw=clean(rawValue),evidence=parseCanonical(raw,"renewable offer evidence");exactKeys(evidence,offerEvidenceFields,"renewable offer evidence");
  const issuedMs=exactIso(evidence.issued_at,"renewable offer evidence");
  if(evidence.version!=="arc1-checkout-offer-template-evidence-v1"||evidence.scope!=="authoritative-private-checkout-offer-template-preflight"||
    evidence.stripe_account_id_sha256!==offer.stripe_account_id_sha256||evidence.livemode!==offer.livemode||evidence.price_id!==offer.price_id||evidence.product_id!==offer.product_id||
    evidence.amount_subtotal_minor_units!==offer.amount_subtotal_minor_units||evidence.currency!==offer.currency||evidence.quantity!==offer.quantity||evidence.terms_version!==offer.terms_version||
    evidence.terms_document_sha256!==offer.terms_document_sha256||evidence.automatic_tax_enabled!==true||evidence.customer_address_source!==offer.customer_address_source||
    evidence.price_tax_behavior!==offer.price_tax_behavior||evidence.product_tax_code!==offer.product_tax_code||evidence.tax_contract_version!==offer.tax_contract_version||
    evidence.tax_settings_status!=="active"||canonicalJson(evidence.tax_registrations)!==canonicalJson(offer.tax_registrations)||
    evidence.tax_registrations_sha256!==offer.tax_registrations_sha256||evidence.adult_acknowledgement_key!==offer.adult_acknowledgement_key||
    evidence.name_collection_required!==true||evidence.submit_type!==offer.submit_type||evidence.checkout_redirect_url!==offer.checkout_redirect_url||
    evidence.stripe_api_version!==offer.stripe_api_version||evidence.configuration_sha256!==offer.configuration_sha256||
    issuedMs<now-freshnessMs||issuedMs>now+clockSkewMs||issuedMs<minimumIssuedMs-5000)
    throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_WAIT: rerun offer and tax readiness immediately before this renewal transition");
  await verifyHex(offerEvidenceKey,hmacValue,`arc1-checkout-offer-template-evidence-signature-v1\n${raw}`,"renewable offer evidence");
  return{raw,evidence,sha:await sha256(raw),issuedMs,expiresMs:issuedMs+freshnessMs};
};
const observationFields=["current_main_html_sha256","current_main_sha","expires_at","issued_at","pages_content_sha256","readiness_core_sha256","scope","version"];
const validateReadiness=async(rawValue,hmacValue,minimumIssuedMs=0)=>{
  const raw=clean(rawValue),observation=parseCanonical(raw,"renewable readiness observation");exactKeys(observation,observationFields,"renewable readiness observation");
  const issuedMs=exactIso(observation.issued_at,"renewable readiness observation"),expiresMs=exactIso(observation.expires_at,"renewable readiness observation");
  if(observation.version!=="arc1-preview-readiness-observation-v1"||observation.scope!=="renewable-private-checkout-readiness-observation"||
    observation.readiness_core_sha256!==policy.readiness_core_sha256||!/^[a-f0-9]{40}$/.test(observation.current_main_sha)||
    !/^[a-f0-9]{64}$/.test(observation.current_main_html_sha256)||observation.current_main_html_sha256!==observation.pages_content_sha256||
    issuedMs<now-freshnessMs||issuedMs>now+clockSkewMs||issuedMs<minimumIssuedMs-5000||expiresMs<=now||expiresMs<=issuedMs||expiresMs-issuedMs>600000)
    throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_WAIT: rerun preview readiness immediately before this renewal transition");
  await verifyHex(bindingKey,hmacValue,`arc1-preview-readiness-observation-signature-v1\n${mode}\n${raw}`,"renewable readiness observation");
  return{raw,observation,sha:await sha256(raw),issuedMs,expiresMs};
};

const providerFields=["active","automatic_tax_enabled","checkout_policy_sha256","checkout_reference_sha256","completed_sessions_count","completed_sessions_limit","configuration_sha256","dynamic_payment_methods","generation","observed_at","operation","operation_command_sha256","payment_link_id","predecessor_payment_link_id","price_id","product_id","product_tax_code","scope","stripe_account_id_sha256","stripe_mode","url_sha256","version"];
const validateProviderEvidence=async(rawValue,hmacValue,{operation,commandSha="",generation,paymentLinkId,predecessor="",active,maximumAgeMs=2592000000})=>{
  const raw=clean(rawValue),evidence=parseCanonical(raw,"provider adapter evidence");exactKeys(evidence,providerFields,"provider adapter evidence");
  const observedMs=exactIso(evidence.observed_at,"provider adapter evidence");
  if(evidence.version!=="arc-private-checkout-provider-adapter-evidence-v1"||evidence.scope!=="private-unpaid-link-lifecycle-provider-readback"||
    evidence.operation!==operation||evidence.operation_command_sha256!==commandSha||evidence.generation!==generation||evidence.payment_link_id!==paymentLinkId||
    evidence.predecessor_payment_link_id!==predecessor||evidence.active!==active||evidence.completed_sessions_count!==0||evidence.completed_sessions_limit!==1||
    evidence.automatic_tax_enabled!==true||evidence.dynamic_payment_methods!==true||evidence.checkout_reference_sha256!==receipt.checkout_reference_sha256||
    evidence.checkout_policy_sha256!==policySha||evidence.configuration_sha256!==offer.configuration_sha256||evidence.stripe_mode!==mode||
    evidence.stripe_account_id_sha256!==offer.stripe_account_id_sha256||evidence.price_id!==offer.price_id||evidence.product_id!==offer.product_id||
    evidence.product_tax_code!==offer.product_tax_code||!/^[a-f0-9]{64}$/.test(evidence.url_sha256)||observedMs>now+clockSkewMs||observedMs<now-maximumAgeMs)
    throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: provider adapter evidence does not prove the exact unpaid Link state");
  await verifyHex(providerEvidenceKey,hmacValue,`arc-private-checkout-provider-adapter-evidence-signature-v1\n${mode}\n${raw}`,"provider adapter evidence");
  return{raw,evidence,sha:await sha256(raw),hmac:clean(hmacValue).toLowerCase(),observedMs};
};

const stateFields=["active_link_evidence_sha256","checkout_policy_sha256","checkout_reference_sha256","deactivation_command_private","deactivation_command_sha256","deactivation_evidence_hmac_sha256","deactivation_evidence_private","deactivation_evidence_sha256","generation","last_transition_receipt_sha256","link_activated_at","link_expires_at","link_ttl_seconds","offer_configuration_sha256","offer_expires_at","offer_snapshot_sha256","payment_link_id","payment_link_id_hmac_sha256","previous_link_id_hmac_sha256","readiness_core_sha256","renewal_adapter_command_private","renewal_adapter_command_sha256","renewal_authorization_expires_at","renewal_offer_evidence_sha256","renewal_predecessor_inactive_evidence_sha256","renewal_readiness_observation_sha256","scope","state_hmac_sha256","status","stripe_account_id_sha256","stripe_mode","updated_at","version"];
const linkIdHmac=linkId=>hmacHex(bindingKey,`arc-private-checkout-link-id-key-v1\n${mode}\n${linkId}`);
const signState=async value=>{const unsigned={...value};delete unsigned.state_hmac_sha256;return{...unsigned,state_hmac_sha256:await hmacHex(bindingKey,`arc-private-checkout-lifecycle-state-v1\n${mode}\n${canonicalJson(unsigned)}`)};};
const validateState=async rawValue=>{
  const raw=clean(rawValue),state=parseCanonical(raw,"lifecycle state");exactKeys(state,stateFields,"lifecycle state");
  const unsigned={...state};delete unsigned.state_hmac_sha256;
  await verifyHex(bindingKey,state.state_hmac_sha256,`arc-private-checkout-lifecycle-state-v1\n${mode}\n${canonicalJson(unsigned)}`,"lifecycle state");
  const activatedMs=exactIso(state.link_activated_at,"link activation"),expiresMs=exactIso(state.link_expires_at,"link expiry"),offerExpiresMs=exactIso(state.offer_expires_at,"offer expiry");exactIso(state.updated_at,"state update");
  if(state.version!=="arc-private-checkout-unpaid-lifecycle-v1"||state.scope!=="explicit-expiry-deactivation-and-safe-renewal"||
    !new Set(["ACTIVE","DEACTIVATION_AUTHORIZED","DEACTIVATED","RENEWAL_AUTHORIZED"]).has(state.status)||!Number.isSafeInteger(state.generation)||state.generation<0||state.generation>1000||
    state.checkout_reference_sha256!==receipt.checkout_reference_sha256||state.checkout_policy_sha256!==policySha||state.readiness_core_sha256!==policy.readiness_core_sha256||
    state.offer_snapshot_sha256!==offerSha||state.offer_configuration_sha256!==offer.configuration_sha256||state.stripe_mode!==mode||state.stripe_account_id_sha256!==offer.stripe_account_id_sha256||
    !/^plink_[A-Za-z0-9]+$/.test(state.payment_link_id)||state.payment_link_id_hmac_sha256!==await linkIdHmac(state.payment_link_id)||
    !/^[a-f0-9]{64}$/.test(state.active_link_evidence_sha256)||!Number.isSafeInteger(state.link_ttl_seconds)||state.link_ttl_seconds<3600||state.link_ttl_seconds>604800||
    expiresMs!==activatedMs+state.link_ttl_seconds*1000||offerExpiresMs!==expiresMs||!/^$|^[a-f0-9]{64}$/.test(state.previous_link_id_hmac_sha256)||!/^$|^[a-f0-9]{64}$/.test(state.last_transition_receipt_sha256))
    throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: lifecycle state binding");
  const hasDeactivation=state.deactivation_command_private!==""&&/^[a-f0-9]{64}$/.test(state.deactivation_command_sha256);
  const hasDeactivationEvidence=state.deactivation_evidence_private!==""&&/^[a-f0-9]{64}$/.test(state.deactivation_evidence_sha256)&&/^[a-f0-9]{64}$/.test(state.deactivation_evidence_hmac_sha256);
  const hasRenewal=state.renewal_adapter_command_private!==""&&/^[a-f0-9]{64}$/.test(state.renewal_adapter_command_sha256)&&/^[a-f0-9]{64}$/.test(state.renewal_offer_evidence_sha256)&&/^[a-f0-9]{64}$/.test(state.renewal_predecessor_inactive_evidence_sha256)&&/^[a-f0-9]{64}$/.test(state.renewal_readiness_observation_sha256)&&state.renewal_authorization_expires_at!=="";
  if(state.status==="ACTIVE"&&(hasDeactivation||hasDeactivationEvidence||hasRenewal)||state.status==="DEACTIVATION_AUTHORIZED"&&(!hasDeactivation||hasDeactivationEvidence||hasRenewal)||
    state.status==="DEACTIVATED"&&(!hasDeactivation||!hasDeactivationEvidence||hasRenewal)||state.status==="RENEWAL_AUTHORIZED"&&(!hasDeactivation||!hasDeactivationEvidence||!hasRenewal))
    throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: lifecycle state transition fields");
  return{raw,state,sha:await sha256(raw),expiresMs};
};

const commandFields=["authorization_hmac_sha256","automatic_tax_enabled","checkout_policy_sha256","checkout_reference_sha256","completed_sessions_limit","configuration_sha256","dynamic_payment_methods_required","expected_active","expected_completed_sessions_count","expires_at","generation","idempotency_key","issued_at","lifecycle_state_sha256","offer_evidence_sha256","operation","payment_link_id","predecessor_inactive_evidence_sha256","predecessor_payment_link_id","price_id","product_id","product_tax_code","readiness_observation_sha256","requested_active","scope","stripe_account_id_sha256","stripe_mode","version"];
const signCommand=async unsigned=>canonicalJson({...unsigned,authorization_hmac_sha256:await hmacHex(bindingKey,`arc-private-checkout-lifecycle-adapter-command-v1\n${mode}\n${canonicalJson(unsigned)}`)});
const validateCommand=async(rawValue,expectedOperation)=>{const raw=clean(rawValue),command=parseCanonical(raw,"adapter command");exactKeys(command,commandFields,"adapter command");const unsigned={...command};delete unsigned.authorization_hmac_sha256;await verifyHex(bindingKey,command.authorization_hmac_sha256,`arc-private-checkout-lifecycle-adapter-command-v1\n${mode}\n${canonicalJson(unsigned)}`,"adapter command");if(command.version!=="arc-private-checkout-lifecycle-adapter-command-v1"||command.scope!=="private-provider-adapter-only"||command.operation!==expectedOperation)return Promise.reject(new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: adapter command"));return{raw,command,sha:await sha256(raw)};};
const blankTransition={deactivation_command_private:"",deactivation_command_sha256:"",deactivation_evidence_private:"",deactivation_evidence_sha256:"",deactivation_evidence_hmac_sha256:"",renewal_adapter_command_private:"",renewal_adapter_command_sha256:"",renewal_offer_evidence_sha256:"",renewal_predecessor_inactive_evidence_sha256:"",renewal_readiness_observation_sha256:"",renewal_authorization_expires_at:""};

if(phase==="ENROLL_ACTIVE"){
  const ttl=Number(clean(inputData.private_checkout_link_ttl_seconds)||"604800");
  if(!Number.isSafeInteger(ttl)||ttl<3600||ttl>604800)throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: Link TTL");
  const active=await validateProviderEvidence(inputData.provider_link_evidence_private,inputData.provider_link_evidence_hmac_sha256,{operation:"OBSERVE_ACTIVE",generation:0,paymentLinkId:receipt.payment_link_id,active:true});
  const state=await signState({version:"arc-private-checkout-unpaid-lifecycle-v1",scope:"explicit-expiry-deactivation-and-safe-renewal",status:"ACTIVE",generation:0,
    checkout_reference_sha256:receipt.checkout_reference_sha256,checkout_policy_sha256:policySha,readiness_core_sha256:policy.readiness_core_sha256,offer_snapshot_sha256:offerSha,
    offer_configuration_sha256:offer.configuration_sha256,stripe_mode:mode,stripe_account_id_sha256:offer.stripe_account_id_sha256,payment_link_id:receipt.payment_link_id,
    payment_link_id_hmac_sha256:await linkIdHmac(receipt.payment_link_id),active_link_evidence_sha256:active.sha,link_activated_at:active.evidence.observed_at,
    link_expires_at:new Date(active.observedMs+ttl*1000).toISOString(),offer_expires_at:new Date(active.observedMs+ttl*1000).toISOString(),link_ttl_seconds:ttl,previous_link_id_hmac_sha256:"",last_transition_receipt_sha256:"",
    ...blankTransition,updated_at:active.evidence.observed_at});
  return{status:"PRIVATE_UNPAID_LINK_LIFECYCLE_ENROLLED",provider_call_allowed:false,url_exposure_allowed:false,lifecycle_state_write_required:true,
    private_checkout_lifecycle_state:canonicalJson(state),link_expires_at:state.link_expires_at,offer_expires_at:state.offer_expires_at,
    state_adapter_contract:"create-or-exact signed ACTIVE lifecycle lease"};
}

const current=await validateState(inputData.private_checkout_lifecycle_state);
if(phase==="REQUEST_DEACTIVATION"){
  if(current.state.status!=="ACTIVE")throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: ACTIVE state required before deactivation authorization");
  if(current.expiresMs>Date.now())throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_WAIT: unpaid Link has not expired");
  const unsignedCommand={version:"arc-private-checkout-lifecycle-adapter-command-v1",scope:"private-provider-adapter-only",operation:"DEACTIVATE_UNPAID_LINK",generation:current.state.generation,
    stripe_mode:mode,stripe_account_id_sha256:offer.stripe_account_id_sha256,checkout_reference_sha256:receipt.checkout_reference_sha256,checkout_policy_sha256:policySha,
    configuration_sha256:offer.configuration_sha256,payment_link_id:current.state.payment_link_id,predecessor_payment_link_id:"",expected_active:true,requested_active:false,
    expected_completed_sessions_count:0,completed_sessions_limit:1,automatic_tax_enabled:true,dynamic_payment_methods_required:true,price_id:offer.price_id,product_id:offer.product_id,
    product_tax_code:offer.product_tax_code,lifecycle_state_sha256:current.sha,offer_evidence_sha256:"",readiness_observation_sha256:"",predecessor_inactive_evidence_sha256:"",
    issued_at:current.state.link_expires_at,expires_at:"",idempotency_key:`arc-deactivate-${await hmacHex(bindingKey,`arc-private-checkout-deactivate-idempotency-v1\n${mode}\n${current.sha}`)}`};
  const commandRaw=await signCommand(unsignedCommand),commandSha=await sha256(commandRaw);
  const next=await signState({...current.state,status:"DEACTIVATION_AUTHORIZED",deactivation_command_private:commandRaw,deactivation_command_sha256:commandSha,updated_at:current.state.link_expires_at});
  return{status:"PRIVATE_UNPAID_LINK_DEACTIVATION_AUTHORIZED",provider_call_allowed:false,provider_adapter_call_allowed_after_state_persist:true,url_exposure_allowed:false,
    lifecycle_state_write_required_before_provider:true,private_checkout_lifecycle_state:canonicalJson(next),deactivation_adapter_command_private:commandRaw,
    deactivation_adapter_command_sha256:commandSha,state_adapter_contract:"CAS exact ACTIVE state to DEACTIVATION_AUTHORIZED before adapter mutation"};
}

if(phase==="CONFIRM_DEACTIVATION"){
  if(current.state.status!=="DEACTIVATION_AUTHORIZED")throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: persisted DEACTIVATION_AUTHORIZED state required");
  const command=await validateCommand(current.state.deactivation_command_private,"DEACTIVATE_UNPAID_LINK");
  if(command.sha!==current.state.deactivation_command_sha256||command.command.lifecycle_state_sha256==="")throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: deactivation command binding");
  const evidence=await validateProviderEvidence(inputData.provider_link_evidence_private,inputData.provider_link_evidence_hmac_sha256,{operation:"DEACTIVATE",commandSha:command.sha,
    generation:current.state.generation,paymentLinkId:current.state.payment_link_id,active:false,maximumAgeMs:300000});
  if(evidence.observedMs<current.expiresMs)throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: deactivation predates Link expiry");
  const receiptUnsigned={version:"arc-private-checkout-deactivation-receipt-v1",scope:"durable-unpaid-link-deactivation-evidence",generation:current.state.generation,
    checkout_reference_sha256:receipt.checkout_reference_sha256,payment_link_id_hmac_sha256:current.state.payment_link_id_hmac_sha256,lifecycle_state_sha256:current.sha,
    deactivation_command_sha256:command.sha,deactivation_evidence_sha256:evidence.sha,completed_sessions_count:0,deactivated_at:evidence.evidence.observed_at};
  const transitionReceipt=canonicalJson({...receiptUnsigned,receipt_hmac_sha256:await hmacHex(bindingKey,`arc-private-checkout-deactivation-receipt-v1\n${mode}\n${canonicalJson(receiptUnsigned)}`)}),transitionSha=await sha256(transitionReceipt);
  const next=await signState({...current.state,status:"DEACTIVATED",deactivation_evidence_private:evidence.raw,deactivation_evidence_sha256:evidence.sha,
    deactivation_evidence_hmac_sha256:evidence.hmac,last_transition_receipt_sha256:transitionSha,updated_at:evidence.evidence.observed_at});
  return{status:"PRIVATE_UNPAID_LINK_DEACTIVATED",provider_call_allowed:false,url_exposure_allowed:false,lifecycle_state_write_required:true,
    private_checkout_lifecycle_state:canonicalJson(next),deactivation_evidence_private:evidence.raw,deactivation_evidence_sha256:evidence.sha,
    deactivation_transition_receipt_private:transitionReceipt,deactivation_transition_receipt_sha256:transitionSha,
    state_adapter_contract:"CAS DEACTIVATION_AUTHORIZED to DEACTIVATED only after signed active=false and completed_sessions_count=0 readback"};
}

if(phase==="AUTHORIZE_RENEWAL"){
  if(current.state.status!=="DEACTIVATED")throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: durable DEACTIVATED state required before renewal");
  const predecessor=await validateProviderEvidence(inputData.provider_link_evidence_private,inputData.provider_link_evidence_hmac_sha256,{operation:"OBSERVE_INACTIVE",
    commandSha:current.state.deactivation_command_sha256,generation:current.state.generation,paymentLinkId:current.state.payment_link_id,active:false,maximumAgeMs:freshnessMs});
  const durableDeactivation=parseCanonical(current.state.deactivation_evidence_private,"durable deactivation evidence");
  if(predecessor.observedMs<exactIso(durableDeactivation.observed_at,"durable deactivation evidence")-5000)
    throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: predecessor inactive readback predates durable deactivation");
  const freshOffer=await validateOfferEvidence(inputData.payment_link_evidence_private,inputData.payment_link_evidence_hmac_sha256);
  const freshReadiness=await validateReadiness(inputData.checkout_readiness_observation_private,inputData.checkout_readiness_observation_hmac_sha256);
  const issuedMs=Math.max(predecessor.observedMs,freshOffer.issuedMs,freshReadiness.issuedMs),expiresMs=Math.min(issuedMs+freshnessMs,freshOffer.expiresMs,freshReadiness.expiresMs);
  if(expiresMs<=Date.now())throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_WAIT: renewal authorization inputs expired");
  const nextGeneration=current.state.generation+1;
  const unsignedCommand={version:"arc-private-checkout-lifecycle-adapter-command-v1",scope:"private-provider-adapter-only",operation:"CREATE_RENEWED_UNPAID_LINK",generation:nextGeneration,
    stripe_mode:mode,stripe_account_id_sha256:offer.stripe_account_id_sha256,checkout_reference_sha256:receipt.checkout_reference_sha256,checkout_policy_sha256:policySha,
    configuration_sha256:offer.configuration_sha256,payment_link_id:"",predecessor_payment_link_id:current.state.payment_link_id,expected_active:false,requested_active:true,
    expected_completed_sessions_count:0,completed_sessions_limit:1,automatic_tax_enabled:true,dynamic_payment_methods_required:true,price_id:offer.price_id,product_id:offer.product_id,
    product_tax_code:offer.product_tax_code,lifecycle_state_sha256:current.sha,offer_evidence_sha256:freshOffer.sha,readiness_observation_sha256:freshReadiness.sha,
    predecessor_inactive_evidence_sha256:predecessor.sha,issued_at:new Date(issuedMs).toISOString(),expires_at:new Date(expiresMs).toISOString(),
    idempotency_key:`arc-renew-${await hmacHex(bindingKey,`arc-private-checkout-renew-idempotency-v1\n${mode}\n${current.sha}\n${nextGeneration}\n${predecessor.sha}`)}`};
  const commandRaw=await signCommand(unsignedCommand),commandSha=await sha256(commandRaw);
  const next=await signState({...current.state,status:"RENEWAL_AUTHORIZED",renewal_adapter_command_private:commandRaw,renewal_adapter_command_sha256:commandSha,
    renewal_offer_evidence_sha256:freshOffer.sha,renewal_predecessor_inactive_evidence_sha256:predecessor.sha,renewal_readiness_observation_sha256:freshReadiness.sha,
    renewal_authorization_expires_at:new Date(expiresMs).toISOString(),updated_at:new Date(issuedMs).toISOString()});
  return{status:"PRIVATE_UNPAID_LINK_RENEWAL_AUTHORIZED",provider_call_allowed:false,provider_adapter_call_allowed_after_state_persist:true,url_exposure_allowed:false,
    lifecycle_state_write_required_before_provider:true,private_checkout_lifecycle_state:canonicalJson(next),renewal_adapter_command_private:commandRaw,
    renewal_adapter_command_sha256:commandSha,renewal_authorization_expires_at:new Date(expiresMs).toISOString(),
    state_adapter_contract:"CAS DEACTIVATED to RENEWAL_AUTHORIZED before provider create; adapter must verify command HMAC and expiry"};
}

if(current.state.status!=="RENEWAL_AUTHORIZED")throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: persisted RENEWAL_AUTHORIZED state required before renewal finalize");
const authorizationExpiresMs=exactIso(current.state.renewal_authorization_expires_at,"renewal authorization expiry");
if(authorizationExpiresMs<=Date.now())throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_WAIT: renewal authorization expired before provider create/finalize");
const renewalCommand=await validateCommand(current.state.renewal_adapter_command_private,"CREATE_RENEWED_UNPAID_LINK");
if(renewalCommand.sha!==current.state.renewal_adapter_command_sha256||renewalCommand.command.expires_at!==current.state.renewal_authorization_expires_at)
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_CONFLICT: renewal command binding");
const createdRaw=clean(inputData.provider_link_evidence_private),createdObject=parseCanonical(createdRaw,"renewed Link provider evidence");
if(!/^plink_[A-Za-z0-9]+$/.test(clean(createdObject.payment_link_id))||createdObject.payment_link_id===current.state.payment_link_id)
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_INVALID: renewal must create a distinct private Link");
const created=await validateProviderEvidence(createdRaw,inputData.provider_link_evidence_hmac_sha256,{operation:"CREATE_RENEWAL",commandSha:renewalCommand.sha,
  generation:current.state.generation+1,paymentLinkId:createdObject.payment_link_id,predecessor:current.state.payment_link_id,active:true,maximumAgeMs:freshnessMs});
if(created.observedMs<exactIso(renewalCommand.command.issued_at,"renewal command issuance")-5000||created.observedMs>authorizationExpiresMs)
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_WAIT: provider create occurred outside the renewal authorization window");
const finalOffer=await validateOfferEvidence(inputData.payment_link_evidence_private,inputData.payment_link_evidence_hmac_sha256,created.observedMs);
const finalReadiness=await validateReadiness(inputData.checkout_readiness_observation_private,inputData.checkout_readiness_observation_hmac_sha256,created.observedMs);
if(finalOffer.sha===current.state.renewal_offer_evidence_sha256||finalReadiness.sha===current.state.renewal_readiness_observation_sha256)
  throw new Error("ARC_PRIVATE_CHECKOUT_LIFECYCLE_WAIT: rerun offer/tax and preview readiness after provider create before finalizing renewal");
const activatedAt=created.evidence.observed_at,linkExpiresAt=new Date(created.observedMs+current.state.link_ttl_seconds*1000).toISOString();
const receiptUnsigned={version:"arc-private-checkout-renewal-receipt-v1",scope:"durable-renewed-unpaid-private-link",generation:current.state.generation+1,
  checkout_reference_sha256:receipt.checkout_reference_sha256,checkout_policy_sha256:policySha,predecessor_payment_link_id_hmac_sha256:current.state.payment_link_id_hmac_sha256,
  payment_link_id_hmac_sha256:await linkIdHmac(created.evidence.payment_link_id),deactivation_evidence_sha256:current.state.deactivation_evidence_sha256,
  predecessor_inactive_evidence_sha256:current.state.renewal_predecessor_inactive_evidence_sha256,renewal_adapter_command_sha256:renewalCommand.sha,
  renewed_link_provider_evidence_sha256:created.sha,precreate_offer_evidence_sha256:current.state.renewal_offer_evidence_sha256,
  precreate_readiness_observation_sha256:current.state.renewal_readiness_observation_sha256,final_offer_evidence_sha256:finalOffer.sha,
  final_readiness_observation_sha256:finalReadiness.sha,activated_at:activatedAt,link_expires_at:linkExpiresAt};
const transitionReceipt=canonicalJson({...receiptUnsigned,receipt_hmac_sha256:await hmacHex(bindingKey,`arc-private-checkout-renewal-receipt-v1\n${mode}\n${canonicalJson(receiptUnsigned)}`)}),transitionSha=await sha256(transitionReceipt);
const next=await signState({...current.state,...blankTransition,status:"ACTIVE",generation:current.state.generation+1,payment_link_id:created.evidence.payment_link_id,
  payment_link_id_hmac_sha256:await linkIdHmac(created.evidence.payment_link_id),active_link_evidence_sha256:created.sha,link_activated_at:activatedAt,link_expires_at:linkExpiresAt,offer_expires_at:linkExpiresAt,
  previous_link_id_hmac_sha256:current.state.payment_link_id_hmac_sha256,last_transition_receipt_sha256:transitionSha,
  updated_at:new Date(Math.max(finalOffer.issuedMs,finalReadiness.issuedMs)).toISOString()});
return{status:"PRIVATE_UNPAID_LINK_RENEWAL_FINALIZED",provider_call_allowed:false,url_exposure_allowed:false,lifecycle_state_write_required:true,
  private_checkout_lifecycle_state:canonicalJson(next),renewed_payment_link_id_private:created.evidence.payment_link_id,renewed_link_provider_evidence_private:created.raw,
  renewal_transition_receipt_private:transitionReceipt,renewal_transition_receipt_sha256:transitionSha,link_expires_at:linkExpiresAt,
  final_offer_evidence_sha256:finalOffer.sha,final_readiness_observation_sha256:finalReadiness.sha,
  state_adapter_contract:"CAS exact RENEWAL_AUTHORIZED to ACTIVE only after post-create offer/tax and preview-readiness reruns"};
