// ARC1 Step 6 — exact-contract preview injection and Stripe folder binding.
const clean = value => String(value == null ? "" : value).trim();
const requiredKeys = [
  "SEO_TITLE","SEO_DESCRIPTION","PRIMARY_COLOR","BACKGROUND_COLOR","SURFACE_COLOR","TEXT_COLOR","MUTED_COLOR","ACCENT_COLOR","PRIMARY_BUTTON_TEXT","STYLE_MODE",
  "BUSINESS_NAME","LOGO_HTML","PRIMARY_CTA_HREF","PRIMARY_CTA_LABEL","EYEBROW","HEADLINE","SUBHEADLINE","SECONDARY_CTA_HREF","SECONDARY_CTA_LABEL","TRUST_LINE_HTML",
  "HERO_MEDIA_HTML","INDUSTRY_LABEL","LOCATION","VISUAL_HEADLINE","HERO_CHIPS_HTML","HIGHEST_PROFIT_SERVICE","HERO_PROOF_LINE","TICKER_HTML","SERVICES_HEADING","SERVICES_INTRO",
  "SERVICES_HTML","WHY_HEADING","WHY_INTRO","DIFFERENTIATORS_HTML","ABOUT_TITLE","ABOUT_BODY","ABOUT_STATS_HTML","ABOUT_MEDIA_HTML","ABOUT_EYEBROW","ABOUT_QUOTE",
  "PROCESS_HEADING","PROCESS_INTRO","PROCESS_HTML","PROOF_HEADING","PROOF_INTRO","PROOF_HTML","GALLERY_HEADING","GALLERY_INTRO","GALLERY_HTML","FAQ_HEADING","FAQ_INTRO",
  "FAQ_HTML","CONTACT_HEADING","CONTACT_BODY","CONTACT_ACTION_HTML","CONTACT_DETAILS_HTML","FOOTER_TAGLINE","FOOTER_LINKS_HTML"
];
const slugify = value => clean(value)
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
const normalizedUrl = value => {
  try {
    const url = new URL(value);
    return url.toString();
  } catch (error) {
    return "";
  }
};
const removeUnownedImages = (markup, approved) => clean(markup)
  .replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, block => {
    const urls = [...block.matchAll(/\b(?:src|srcset)\s*=\s*["']([^"']+)["']/gi)];
    return urls.some(match => approved.has(normalizedUrl(match[1].split(/\s+/)[0]))) ? block : "";
  })
  .replace(/<img\b[^>]*>/gi, tag => {
    const source = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      return source && approved.has(normalizedUrl(source)) ? tag : "";
    });

// Generated content is untrusted. Scalar fields are HTML-escaped, while the
// small set of structured fields is rebuilt through explicit tag/attribute
// allowlists. No generated CSS, script, event handler, or unsafe URL survives.
const markupKeys = new Set([
  "LOGO_HTML","TRUST_LINE_HTML","HERO_MEDIA_HTML","HERO_CHIPS_HTML","TICKER_HTML","SERVICES_HTML",
  "DIFFERENTIATORS_HTML","ABOUT_BODY","ABOUT_STATS_HTML","ABOUT_MEDIA_HTML","PROCESS_HTML","PROOF_HTML",
  "GALLERY_HTML","FAQ_HTML","CONTACT_ACTION_HTML","CONTACT_DETAILS_HTML","FOOTER_LINKS_HTML"
]);
const colorKeys = new Set(["PRIMARY_COLOR","BACKGROUND_COLOR","SURFACE_COLOR","TEXT_COLOR","MUTED_COLOR","ACCENT_COLOR","PRIMARY_BUTTON_TEXT"]);
const urlKeys = new Set(["PRIMARY_CTA_HREF","SECONDARY_CTA_HREF"]);
const voidTags = new Set(["br","img","input","source"]);
const booleanAttributes = new Set(["hidden","required","selected","open","multiple"]);
const safeClasses = new Set(["service-card","stat","stat-card","process-step","proof-card","gallery-card","visual-direction","contact-form","form-field","form-wide","btn","btn-primary","btn-secondary"]);
const supportedFormControlNames = new Set(["form-name","bot-field","name","email","phone","project_details"]);
const commonTextTags = ["span","strong","em","small","p","br"];
const cardTags = [...commonTextTags,"article","div","h3","ul","ol","li"];
const mediaTags = ["img","picture","source","figure","figcaption","div","span"];
const tagsByKey = {
  LOGO_HTML:new Set(["img"]),
  TRUST_LINE_HTML:new Set(commonTextTags),
  HERO_MEDIA_HTML:new Set(mediaTags),
  HERO_CHIPS_HTML:new Set(["span","strong","em","small"]),
  TICKER_HTML:new Set(["span","strong","em","small"]),
  SERVICES_HTML:new Set(cardTags),
  DIFFERENTIATORS_HTML:new Set(cardTags),
  ABOUT_BODY:new Set([...commonTextTags,"div","ul","ol","li","a"]),
  ABOUT_STATS_HTML:new Set(cardTags),
  ABOUT_MEDIA_HTML:new Set(mediaTags),
  PROCESS_HTML:new Set(cardTags),
  PROOF_HTML:new Set(cardTags),
  GALLERY_HTML:new Set(mediaTags),
  FAQ_HTML:new Set([...commonTextTags,"details","summary","div","ul","ol","li"]),
  CONTACT_ACTION_HTML:new Set([...commonTextTags,"div","form","input","textarea","select","option","label","button","a"]),
  CONTACT_DETAILS_HTML:new Set([...commonTextTags,"div","ul","ol","li","a"]),
  FOOTER_LINKS_HTML:new Set(["a","span","strong","nav","ul","li"])
};
const attributesByTag = {
  a:new Set(["href","class","target","rel","aria-label","title"]),article:new Set(["class","aria-label"]),
  button:new Set(["type","class","aria-label"]),details:new Set(["open","class"]),div:new Set(["class","aria-label","role","hidden"]),
  figcaption:new Set(["class"]),figure:new Set(["class"]),form:new Set(["name","method","data-netlify","netlify-honeypot","action","class","aria-label"]),
  h3:new Set(["class"]),img:new Set(["src","srcset","sizes","alt","width","height","loading","decoding","fetchpriority","referrerpolicy","class"]),
  input:new Set(["type","name","value","autocomplete","placeholder","required","hidden","minlength","maxlength","class","aria-label"]),
  label:new Set(["for","class"]),li:new Set(["class"]),nav:new Set(["class","aria-label"]),ol:new Set(["class"]),option:new Set(["value","selected"]),
  p:new Set(["class","hidden","role","aria-label"]),picture:new Set(["class"]),select:new Set(["name","autocomplete","required","multiple","class","aria-label"]),
  small:new Set(["class"]),source:new Set(["src","srcset","sizes","type","media"]),span:new Set(["class","aria-label","aria-hidden","role"]),
  strong:new Set(["class"]),summary:new Set(["class"]),textarea:new Set(["name","autocomplete","placeholder","required","minlength","maxlength","rows","cols","class","aria-label"]),
  ul:new Set(["class"])
};
const escapeHtmlValue = value => String(value == null ? "" : value)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const decodeUrlEntities = value => String(value == null ? "" : value)
  .replace(/&#(\d+);?/g,(_,code)=>String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);?/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16)))
  .replace(/&(colon|tab|newline|amp|quot|apos|lt|gt);/gi,(_,name)=>({colon:":",tab:"\t",newline:"\n",amp:"&",quot:'"',apos:"'",lt:"<",gt:">"})[name.toLowerCase()]);
const safeNavigationUrl = (value,{image=false,action=false}={}) => {
  const decoded=decodeUrlEntities(clean(value));
  const compact=decoded.replace(/[\u0000-\u0020\u007f]+/g,"");
  if(!compact||/[<>"']/.test(compact))throw new Error("ARC_CONTENT_UNSAFE: malformed URL attribute");
  if(action){
    if(!/^\/(?![\\/])[^\\\s]*$/.test(compact))throw new Error("ARC_CONTENT_UNSAFE: form action must stay same-origin");
    return compact;
  }
  if(!image&&/^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(compact))return compact;
  if(!image&&/^\/(?![\\/])[^\\\s]*$/.test(compact))return compact;
  if(!image&&/^tel:\+?[0-9(). -]{5,32}$/i.test(decoded))return decoded;
  if(!image&&/^mailto:[^\s@]+@[^\s@]+\.[^\s@?]+(?:\?[^\s]*)?$/i.test(decoded))return decoded;
  let url;
  try{url=new URL(compact);}catch(error){throw new Error("ARC_CONTENT_UNSAFE: unsupported URL");}
  if(!(image?new Set(["https:"]):new Set(["https:","http:"])).has(url.protocol)||url.username||url.password||(image&&url.hash)){
    throw new Error("ARC_CONTENT_UNSAFE: unsafe URL scheme or credentials");
  }
  if(!image&&url.hostname.toLowerCase()==="buy.stripe.com")throw new Error("ARC_CONTENT_UNSAFE: generated content cannot contain an ARC checkout link");
  return url.toString();
};
const ensureApprovedImage = (value,approved) => {
  const safe=safeNavigationUrl(value,{image:true});
  if(!approved.has(normalizedUrl(safe)))throw new Error("ARC_CONTENT_UNSAFE: image source is not an approved upload");
  return safe;
};
const parseAttributes = source => {
  const attributes=[];
  let remaining=source.trim();
  while(remaining){
    const match=remaining.match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)/);
    if(!match)throw new Error("ARC_CONTENT_UNSAFE: malformed HTML attribute");
    const name=match[1].toLowerCase();
    remaining=remaining.slice(match[0].length).trimStart();
    let value=null;
    if(remaining.startsWith("=")){
      remaining=remaining.slice(1).trimStart();
      const quote=remaining[0];
      if(quote!=='"'&&quote!=="'")throw new Error("ARC_CONTENT_UNSAFE: attributes must be quoted");
      const end=remaining.indexOf(quote,1);
      if(end<0)throw new Error("ARC_CONTENT_UNSAFE: unterminated HTML attribute");
      value=remaining.slice(1,end);
      remaining=remaining.slice(end+1).trimStart();
    }
    attributes.push({name,value});
  }
  return attributes;
};
const attributeMapForCanonicalTag=(tag,tagName)=>{
  const match=tag.match(new RegExp(`^<${tagName}\\b([\\s\\S]*?)>$`,"i"));
  if(!match)throw new Error("ARC_CONTENT_UNSAFE: malformed canonical form control");
  return new Map(parseAttributes(match[1]).map(attribute=>[attribute.name,attribute.value===null?attribute.name:attribute.value]));
};
const validateGeneratedFormContract=markup=>{
  const forms=markup.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi)||[];
  const formOpenings=markup.match(/<form\b[^>]*>/gi)||[];
  const controls=markup.match(/<(?:input|textarea|select|button)\b[^>]*>/gi)||[];
  if(!formOpenings.length){
    if(controls.length)throw new Error("ARC_CONTENT_UNSAFE: generated controls require one Netlify form");
    return;
  }
  if(forms.length!==1||formOpenings.length!==1)throw new Error("ARC_CONTENT_UNSAFE: exactly one generated Netlify form is allowed");
  const formBlock=forms[0];
  if(/<(?:input|textarea|select|button)\b/i.test(markup.replace(formBlock,"")))throw new Error("ARC_CONTENT_UNSAFE: generated form controls escaped the form");
  const formAttributes=attributeMapForCanonicalTag(formOpenings[0],"form");
  const formName=clean(formAttributes.get("name"));
  const honeypotName=clean(formAttributes.get("netlify-honeypot"));
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(formName)||formAttributes.get("method")!=="POST"||formAttributes.get("data-netlify")!=="true"||honeypotName!=="bot-field"){
    throw new Error("ARC_CONTENT_UNSAFE: exact Netlify form attributes are required");
  }
  const namedControls=[];
  for(const tag of formBlock.match(/<(?:input|textarea|select|button)\b[^>]*>/gi)||[]){
    const tagName=tag.match(/^<([a-z]+)/i)?.[1].toLowerCase();
    const attributes=attributeMapForCanonicalTag(tag,tagName);
    const name=clean(attributes.get("name"));
    if(name)namedControls.push({tagName,name,attributes});
  }
  const names=namedControls.map(control=>control.name);
  if(new Set(names).size!==names.length)throw new Error("ARC_CONTENT_UNSAFE: duplicate generated form control name");
  if(names.some(name=>!supportedFormControlNames.has(name))||[...supportedFormControlNames].some(name=>!names.includes(name))){
    throw new Error("ARC_CONTENT_UNSAFE: generated form controls must match the supported lead schema");
  }
  const formNameControls=namedControls.filter(control=>control.name==="form-name");
  if(formNameControls.length!==1||formNameControls[0].tagName!=="input"||clean(formNameControls[0].attributes.get("type")).toLowerCase()!=="hidden"||clean(formNameControls[0].attributes.get("value"))!==formName){
    throw new Error("ARC_CONTENT_UNSAFE: hidden form-name must uniquely match the Netlify form name");
  }
  const control=name=>namedControls.find(item=>item.name===name);
  const type=name=>clean(control(name)?.attributes.get("type")).toLowerCase();
  const required=name=>control(name)?.attributes.has("required");
  const submitButtons=formBlock.match(/<button\b[^>]*type="submit"[^>]*>/gi)||[];
  if(control(honeypotName)?.tagName!=="input"||!new Set(["","text"]).has(type(honeypotName))||
    control("name")?.tagName!=="input"||type("name")!=="text"||!required("name")||
    control("email")?.tagName!=="input"||type("email")!=="email"||!required("email")||
    control("phone")?.tagName!=="input"||type("phone")!=="tel"||
    control("project_details")?.tagName!=="textarea"||!required("project_details")||submitButtons.length!==1){
    throw new Error("ARC_CONTENT_UNSAFE: generated form controls do not match the supported lead schema");
  }
};
const sanitizedAttribute = (tag,name,value,approved) => {
  if(name==="style"||name.startsWith("on")||name==="srcdoc")throw new Error(`ARC_CONTENT_UNSAFE: forbidden ${name} attribute`);
  if(!attributesByTag[tag]?.has(name))throw new Error(`ARC_CONTENT_UNSAFE: ${name} is not allowed on <${tag}>`);
  if(booleanAttributes.has(name)){
    if(value!==null&&clean(value).toLowerCase()!==name)throw new Error(`ARC_CONTENT_UNSAFE: malformed boolean ${name} attribute`);
    return name;
  }
  if(value===null)throw new Error(`ARC_CONTENT_UNSAFE: ${name} requires a value`);
  let next=clean(value);
  if(name==="class"){
    const classes=next.split(/\s+/).filter(Boolean);
    if(!classes.length||classes.some(item=>!safeClasses.has(item)||item.startsWith("arc-")))throw new Error("ARC_CONTENT_UNSAFE: generated class is not allowlisted");
    next=classes.join(" ");
  }else if(name==="href")next=safeNavigationUrl(next);
  else if(name==="src")next=ensureApprovedImage(next,approved);
  else if(name==="srcset"){
    const candidates=next.split(",").map(item=>item.trim()).filter(Boolean);
    if(!candidates.length)throw new Error("ARC_CONTENT_UNSAFE: empty srcset");
    next=candidates.map(candidate=>{
      const match=candidate.match(/^(\S+)(?:\s+([1-9]\d*(?:\.\d+)?[wx]))?$/);
      if(!match)throw new Error("ARC_CONTENT_UNSAFE: malformed srcset candidate");
      const url=ensureApprovedImage(match[1],approved);
      return `${url}${match[2]?` ${match[2]}`:""}`;
    }).join(", ");
  }else if(name==="action")next=safeNavigationUrl(next,{action:true});
  else if(name==="method"){
    if(next.toUpperCase()!=="POST")throw new Error("ARC_CONTENT_UNSAFE: forms must use POST");
    next="POST";
  }else if(name==="data-netlify"){
    if(next.toLowerCase()!=="true")throw new Error("ARC_CONTENT_UNSAFE: data-netlify must be true");
    next="true";
  }else if(name==="type"){
    const allowed=tag==="input"?new Set(["hidden","text","email","tel"]):tag==="button"?new Set(["submit","button"]):null;
    if(allowed&&!allowed.has(next.toLowerCase()))throw new Error(`ARC_CONTENT_UNSAFE: unsupported ${tag} type`);
    if(tag==="source"&&!/^image\/(?:avif|webp|png|jpeg)$/i.test(next))throw new Error("ARC_CONTENT_UNSAFE: unsupported source media type");
    next=next.toLowerCase();
  }else if(["name","for","netlify-honeypot"].includes(name)){
    if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(next))throw new Error(`ARC_CONTENT_UNSAFE: malformed ${name}`);
  }else if(["width","height","minlength","maxlength","rows","cols"].includes(name)){
    if(!/^\d{1,4}$/.test(next))throw new Error(`ARC_CONTENT_UNSAFE: malformed numeric ${name}`);
  }else if(name==="loading"&&!new Set(["lazy","eager"]).has(next.toLowerCase()))throw new Error("ARC_CONTENT_UNSAFE: unsupported image loading mode");
  else if(name==="decoding"&&!new Set(["async","sync","auto"]).has(next.toLowerCase()))throw new Error("ARC_CONTENT_UNSAFE: unsupported image decoding mode");
  else if(name==="fetchpriority"&&!new Set(["high","low","auto"]).has(next.toLowerCase()))throw new Error("ARC_CONTENT_UNSAFE: unsupported image fetch priority");
  else if(name==="referrerpolicy"&&next.toLowerCase()!=="no-referrer")throw new Error("ARC_CONTENT_UNSAFE: unsupported image referrer policy");
  else if(name==="target"&&!new Set(["_blank","_self"]).has(next.toLowerCase()))throw new Error("ARC_CONTENT_UNSAFE: unsupported link target");
  else if(name==="rel"){
    const rel=next.toLowerCase().split(/\s+/).filter(Boolean);
    if(!rel.length||rel.some(item=>!new Set(["noopener","noreferrer","nofollow"]).has(item)))throw new Error("ARC_CONTENT_UNSAFE: unsupported link relationship");
    next=[...new Set(rel)].join(" ");
  }else if(name==="aria-hidden"&&!new Set(["true","false"]).has(next.toLowerCase()))throw new Error("ARC_CONTENT_UNSAFE: aria-hidden must be true or false");
  else if(name==="role"&&!new Set(["group","note","status"]).has(next.toLowerCase()))throw new Error("ARC_CONTENT_UNSAFE: unsupported generated role");
  else if(["sizes","media"].includes(name)&&(!next||next.length>300||/[<>"']/.test(next)))throw new Error(`ARC_CONTENT_UNSAFE: malformed ${name}`);
  return `${name}="${escapeHtmlValue(next)}"`;
};
const sanitizeMarkup = (key,markup,approved) => {
  const allowedTags=tagsByKey[key];
  const input=clean(markup);
  if(!input)return "";
  let output="",position=0;
  const stack=[];
  while(position<input.length){
    const start=input.indexOf("<",position);
    if(start<0){output+=escapeHtmlValue(input.slice(position));break;}
    output+=escapeHtmlValue(input.slice(position,start));
    if(input.startsWith("<!--",start)||input.startsWith("<!",start)||input.startsWith("<?",start))throw new Error("ARC_CONTENT_UNSAFE: comments and declarations are not allowed in generated markup");
    let quote="",end=-1;
    for(let index=start+1;index<input.length;index+=1){
      const char=input[index];
      if(quote){if(char===quote)quote="";}
      else if(char==='"'||char==="'")quote=char;
      else if(char===">"){end=index;break;}
    }
    if(end<0||quote)throw new Error("ARC_CONTENT_UNSAFE: unterminated generated HTML tag");
    const token=input.slice(start,end+1);
    const parsed=token.match(/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)([\s\S]*?)>$/);
    if(!parsed)throw new Error("ARC_CONTENT_UNSAFE: malformed generated HTML tag");
    const closing=Boolean(parsed[1]),tag=parsed[2].toLowerCase();
    let attributeSource=parsed[3].trim();
    const selfClosing=!closing&&attributeSource.endsWith("/");
    if(selfClosing)attributeSource=attributeSource.slice(0,-1).trim();
    if(!allowedTags.has(tag))throw new Error(`ARC_CONTENT_UNSAFE: <${tag}> is not allowed in ${key}`);
    if(closing){
      if(attributeSource||voidTags.has(tag)||stack.pop()!==tag)throw new Error("ARC_CONTENT_UNSAFE: generated HTML nesting is invalid");
      output+=`</${tag}>`;
    }else{
      const names=new Set();
      const attributes=parseAttributes(attributeSource).map(attribute=>{
        if(names.has(attribute.name))throw new Error("ARC_CONTENT_UNSAFE: duplicate HTML attribute");
        names.add(attribute.name);
        return sanitizedAttribute(tag,attribute.name,attribute.value,approved);
      });
      if(tag==="a"){
        const parsedAttributes=parseAttributes(attributeSource);
        const target=parsedAttributes.find(attribute=>attribute.name==="target");
        if(clean(target?.value).toLowerCase()==="_blank"&&!parsedAttributes.some(attribute=>attribute.name==="rel"))attributes.push('rel="noopener noreferrer"');
      }
      output+=`<${tag}${attributes.length?` ${attributes.join(" ")}`:""}>`;
      if(!voidTags.has(tag)&&selfClosing)output+=`</${tag}>`;
      else if(!voidTags.has(tag))stack.push(tag);
    }
    position=end+1;
  }
  if(stack.length)throw new Error("ARC_CONTENT_UNSAFE: generated HTML has unclosed tags");
  if(key==="CONTACT_ACTION_HTML")validateGeneratedFormContract(output);
  return output;
};

const template = clean(inputData.template_content || inputData.template_html);
const rawJson = clean(inputData.raw_json || inputData.generated_json)
  .replace(/^```json\s*/i, "")
  .replace(/^```\s*/, "")
  .replace(/\s*```$/, "");
if (!template) throw new Error("ARC_INJECTION_FAILED: template content is empty");
let generated;
try {
  generated = JSON.parse(rawJson);
} catch (error) {
  throw new Error("ARC_INJECTION_FAILED: generated JSON could not be parsed");
}
const generatedKeys = Object.keys(generated || {});
const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(generated, key));
const extra = generatedKeys.filter(key => !requiredKeys.includes(key));
if (generatedKeys.length !== 58 || missing.length || extra.length) {
  throw new Error(`ARC_CONTRACT_INVALID: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
}

// The browser submission is not an identity authority. This step accepts only
// signed evidence issued from an authenticated Netlify API read, followed by a
// matching create-only private-state claim. Hidden submission/timestamp/status
// fields are deliberately never read here.
const canonicalJson=value=>{
  if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw new Error("ARC1_INTAKE_INVALID: non-finite evidence value");
    return JSON.stringify(Object.is(value,-0)?0:value);
  }
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype){
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC1_INTAKE_INVALID: evidence must be plain JSON");
};
if(!globalThis.crypto?.subtle||typeof TextEncoder!=="function")throw new Error("ARC1_CRYPTO_UNAVAILABLE: signed intake evidence is required");
const evidenceEncoder=new TextEncoder();
const bytesToHex=bytes=>[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
const sha256Text=async value=>bytesToHex(await globalThis.crypto.subtle.digest("SHA-256",evidenceEncoder.encode(value)));
const intakeEvidenceSecret=clean(inputData.intake_evidence_secret);
if(evidenceEncoder.encode(intakeEvidenceSecret).length<32||evidenceEncoder.encode(intakeEvidenceSecret).length>256){
  throw new Error("ARC1_INTAKE_INVALID: intake evidence secret must be 32–256 UTF-8 bytes");
}
const evidenceRaw=clean(inputData.intake_evidence_private);
let intakeEvidence;
try{intakeEvidence=JSON.parse(evidenceRaw);}catch(error){throw new Error("ARC1_INTAKE_INVALID: intake evidence JSON");}
if(!intakeEvidence||typeof intakeEvidence!=="object"||Array.isArray(intakeEvidence)||canonicalJson(intakeEvidence)!==evidenceRaw){
  throw new Error("ARC1_INTAKE_INVALID: intake evidence must be canonical plain JSON");
}
const evidenceFields=[
  "version","scope","site_id","site_url","form_id","form_name","submission_id","received_at",
  "intake_version","budget_confirmed","terms_accepted","public_folder_prefix","submission_data_sha256",
  "asset_manifest","total_asset_bytes","state_key","state_digest_sha256","claim_required_before_build","issued_at"
];
if(JSON.stringify(Object.keys(intakeEvidence).sort())!==JSON.stringify(evidenceFields.slice().sort())){
  throw new Error("ARC1_INTAKE_INVALID: intake evidence fields");
}
const externalId=value=>/^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
const expectedSiteId=clean(inputData.expected_netlify_site_id).toLowerCase();
const expectedFormId=clean(inputData.expected_netlify_form_id).toLowerCase();
const expectedFormName=clean(inputData.expected_netlify_form_name);
const requiredBudgetConfirmation="Yes, understands the finished ARC website is $5,000 only after preview approval";
const requiredTermsAcceptance="Accepted ARC preview terms, privacy policy, refund policy, and service scope dated 2026-08-11; separate adult checkout acceptance required";
const receivedAt=clean(intakeEvidence.received_at),issuedAt=clean(intakeEvidence.issued_at);
const receivedMs=Date.parse(receivedAt),issuedMs=Date.parse(issuedAt),nowMs=Date.now();
const derivedPublicFolderPrefix=(await sha256Text([
  "arc-preview-folder-v1",expectedSiteId,expectedFormId,clean(intakeEvidence.submission_id).toLowerCase(),receivedAt
].join("\n"))).slice(0,8);
if(
  intakeEvidence.version!=="arc1-intake-evidence-v1"||intakeEvidence.scope!=="authoritative-netlify-intake-and-assets"||
  !externalId(expectedSiteId)||!externalId(expectedFormId)||clean(intakeEvidence.site_id).toLowerCase()!==expectedSiteId||
  clean(intakeEvidence.form_id).toLowerCase()!==expectedFormId||clean(intakeEvidence.form_name)!==expectedFormName||
  !externalId(intakeEvidence.submission_id)||intakeEvidence.intake_version!=="arc-intake-v7"||
  intakeEvidence.budget_confirmed!==requiredBudgetConfirmation||intakeEvidence.terms_accepted!==requiredTermsAcceptance||
  clean(intakeEvidence.public_folder_prefix)!==derivedPublicFolderPrefix||
  !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.submission_data_sha256))||
  !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.state_digest_sha256))||
  clean(intakeEvidence.state_key)!==`arc1-intake-claim-v1:${clean(intakeEvidence.state_digest_sha256)}`||
  intakeEvidence.claim_required_before_build!==true||!Number.isFinite(receivedMs)||!Number.isFinite(issuedMs)||
  new Date(receivedMs).toISOString()!==receivedAt||new Date(issuedMs).toISOString()!==issuedAt||
  receivedMs<nowMs-24*60*60*1000||receivedMs>nowMs+5*60*1000||issuedMs<receivedMs-5*60*1000||issuedMs>nowMs+5*60*1000
){
  throw new Error("ARC1_INTAKE_INVALID: signed intake identity, consent, or timestamp binding");
}
const evidenceSignature=clean(inputData.intake_evidence_hmac_sha256).toLowerCase();
if(!/^[a-f0-9]{64}$/.test(evidenceSignature))throw new Error("ARC1_INTAKE_INVALID: intake evidence HMAC");
const evidenceKey=await globalThis.crypto.subtle.importKey("raw",evidenceEncoder.encode(intakeEvidenceSecret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
const evidenceSignatureBytes=Uint8Array.from(evidenceSignature.match(/../g),byte=>Number.parseInt(byte,16));
if(!(await globalThis.crypto.subtle.verify("HMAC",evidenceKey,evidenceSignatureBytes,evidenceEncoder.encode(`arc1-intake-evidence-signature-v1\n${evidenceRaw}`)))){
  throw new Error("ARC1_INTAKE_INVALID: intake evidence HMAC mismatch");
}
const intakeEvidenceSha256=await sha256Text(evidenceRaw);
const evidenceManifest=Array.isArray(intakeEvidence.asset_manifest)?intakeEvidence.asset_manifest:null;
if(!evidenceManifest||evidenceManifest.length>3||!Number.isSafeInteger(intakeEvidence.total_asset_bytes)||intakeEvidence.total_asset_bytes<0||intakeEvidence.total_asset_bytes>7864320){
  throw new Error("ARC1_ASSET_INVALID: signed asset manifest");
}
const assetInputs={logo_file:inputData.logo_file_url,hero_image_file:inputData.hero_image_url,supporting_image_file:inputData.supporting_image_url};
const roleOrder=["logo_file","hero_image_file","supporting_image_file"];
let manifestTotal=0,lastRoleIndex=-1;
for(const entry of evidenceManifest){
  if(!entry||typeof entry!=="object"||Array.isArray(entry)||JSON.stringify(Object.keys(entry).sort())!==JSON.stringify(["content_type","role","sha256","size_bytes","source_url_sha256"].sort())){
    throw new Error("ARC1_ASSET_INVALID: asset evidence fields");
  }
  const roleIndex=roleOrder.indexOf(clean(entry.role));
  const exactUrl=String(assetInputs[entry.role]==null?"":assetInputs[entry.role]);
  if(roleIndex<=lastRoleIndex||exactUrl!==exactUrl.trim()||!exactUrl||await sha256Text(exactUrl)!==clean(entry.source_url_sha256)||
    !/^[a-f0-9]{64}$/.test(clean(entry.sha256))||!new Set(["image/png","image/jpeg","image/webp"]).has(entry.content_type)||
    !Number.isSafeInteger(entry.size_bytes)||entry.size_bytes<1||entry.size_bytes>2621440){
    throw new Error("ARC1_ASSET_INVALID: asset URL/hash/type/size binding");
  }
  lastRoleIndex=roleIndex;manifestTotal+=entry.size_bytes;
}
if(manifestTotal!==intakeEvidence.total_asset_bytes)throw new Error("ARC1_ASSET_INVALID: asset manifest total mismatch");
for(const role of roleOrder){
  const supplied=clean(assetInputs[role]);
  if(Boolean(supplied)!==evidenceManifest.some(entry=>entry.role===role))throw new Error("ARC1_ASSET_INVALID: unverified or missing mapped asset URL");
}
const assetManifestSha256=await sha256Text(canonicalJson(evidenceManifest));
const claimCreatedAt=clean(inputData.intake_claim_created_at),claimCreatedMs=Date.parse(claimCreatedAt);
if(
  clean(inputData.intake_claim_status).toLowerCase()!=="claimed"||
  clean(inputData.intake_claim_state_key)!==clean(intakeEvidence.state_key)||
  clean(inputData.intake_claim_state_digest_sha256).toLowerCase()!==clean(intakeEvidence.state_digest_sha256)||
  clean(inputData.intake_claim_evidence_sha256).toLowerCase()!==intakeEvidenceSha256||
  clean(inputData.intake_claim_public_folder_prefix).toLowerCase()!==clean(intakeEvidence.public_folder_prefix)||
  clean(inputData.intake_claim_asset_manifest_sha256).toLowerCase()!==assetManifestSha256||
  clean(inputData.intake_claim_existing_preview_folder)||!Number.isFinite(claimCreatedMs)||
  new Date(claimCreatedMs).toISOString()!==claimCreatedAt||claimCreatedMs<issuedMs-5*60*1000||claimCreatedMs>nowMs+5*60*1000
){
  throw new Error("ARC1_INTAKE_REPLAY_BLOCKED: matching atomic private-state claim is required before build");
}
const submissionPrefix=clean(intakeEvidence.public_folder_prefix);
const businessSlug = slugify(generated.BUSINESS_NAME).slice(0, 64).replace(/-+$/g, "");
if (!submissionPrefix || !businessSlug) throw new Error("ARC_PATH_INVALID: business name or submission id");
const previewFolder = `${businessSlug}-${submissionPrefix}`;
const approved = new Set([inputData.hero_image_url, inputData.supporting_image_url]
  .map(clean)
  .filter(Boolean)
  .map(normalizedUrl));
for (const key of ["HERO_MEDIA_HTML","ABOUT_MEDIA_HTML","GALLERY_HTML"]) {
  generated[key] = removeUnownedImages(generated[key], approved);
}
const approvedLogo = new Set([inputData.logo_file_url].map(clean).filter(Boolean).map(normalizedUrl));
const renderValues = {};
for (const key of requiredKeys) {
  if (markupKeys.has(key)) {
    renderValues[key] = sanitizeMarkup(key, generated[key], key === "LOGO_HTML" ? approvedLogo : approved);
  } else if (colorKeys.has(key)) {
    const value = clean(generated[key]);
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`ARC_CONTENT_UNSAFE: ${key} must be a six-digit hex color`);
    renderValues[key] = value.toLowerCase();
  } else if (urlKeys.has(key)) {
    renderValues[key] = escapeHtmlValue(safeNavigationUrl(generated[key]));
  } else {
    renderValues[key] = escapeHtmlValue(clean(generated[key]));
  }
}
const paymentLinkUrl = clean(inputData.payment_link_url);
if (!paymentLinkUrl) throw new Error("ARC_PAYMENT_LINK_INVALID: test Payment Link URL is required");
let checkout;
try {
  checkout = new URL(paymentLinkUrl);
} catch (error) {
  throw new Error("ARC_PAYMENT_LINK_INVALID: checkout URL is malformed");
}
if (checkout.origin !== "https://buy.stripe.com" || !/^\/test_[A-Za-z0-9]+$/.test(checkout.pathname)) {
  throw new Error("ARC_PAYMENT_LINK_INVALID: checkout must use a Stripe test-mode Payment Link");
}
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
if (checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256) {
  throw new Error("ARC_PAYMENT_LINK_INVALID: checkout binding secret must be 32–256 characters");
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
  throw new Error("ARC_PAYMENT_LINK_INVALID: HMAC-SHA-256 runtime unavailable");
}
const checkoutBindingKey = await globalThis.crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(checkoutBindingSecret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const checkoutBindingBytes = await globalThis.crypto.subtle.sign(
  "HMAC",
  checkoutBindingKey,
  new TextEncoder().encode(previewFolder)
);
const checkoutBinding = [...new Uint8Array(checkoutBindingBytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const checkoutReference = `${previewFolder}.${checkoutBinding}`;
checkout.searchParams.set("client_reference_id", checkoutReference);
if (/buy\.stripe\.com/i.test(clean(generated.PRIMARY_CTA_HREF))) {
  throw new Error("ARC_CTA_INVALID: business CTA cannot be an ARC checkout URL");
}

const templateKeys = [...new Set([...template.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map(match => match[1]))];
if (templateKeys.length !== 58 || templateKeys.some(key => !requiredKeys.includes(key))) {
  throw new Error("ARC_TEMPLATE_INVALID: template no longer matches the exact 58-key contract");
}
let html = template;
for (const key of requiredKeys) html = html.split(`[[${key}]]`).join(renderValues[key]);
const semanticPlainText = value => clean(value).replace(/<[^>]+>/g," ").replace(/\s+/g," ").toLowerCase();
const semanticText = [generated.INDUSTRY_LABEL,generated.BUSINESS_NAME,generated.SERVICES_HEADING,generated.SERVICES_INTRO,generated.SERVICES_HTML].map(semanticPlainText).join(" ");
const mediaRules = [
  ["roofing",/\b(roof(?:er|ing)?|shingles?|siding|gutters?|(?:home|residential) exteriors?)\b/i],["hvac",/\b(hvac|air conditioning|air conditioner|heating|furnace|heat pump|climate control)\b/i],["remodeling",/\b(remodel(?:ing|er)?|renovat(?:e|ion|ing)?|kitchen|bathroom|home improvement)\b/i],["landscaping",/\b(landscap(?:e|er|ing)?|lawn care|gardener|gardening|hardscape|yard care|tree service)\b/i],["auto_detailing",/\b(auto detailing|car detailing|detailer|ceramic coating|paint correction|car wash)\b/i],["dental",/\b(dent(?:al|ist|istry)|orthodont(?:ic|ics|ist)|oral surgery)\b/i],["plumbing",/\b(plumb(?:er|ing)?|drain service|water heater|boiler repair)\b/i],["home_services",/\b(contractor|construction|home service|specialty contractor|handyman|painting contractor)\b/i],["medical_spa",/\b(med(?:ical)? spa|medspa|aesthetic(?:s)?|injectables?|botox|facial treatment|skin rejuvenation)\b/i],["healthcare",/\b(medical|health(?:care)?|clinic|doctor|physician|chiropract(?:ic|or)|physical therapy|therapist|urgent care)\b/i],["restaurant",/\b(restaurant|food|hospitality|cafe|bakery|cater(?:er|ing)?)\b/i],["real_estate",/\b(real estate|realtor|property|brokerage|home builder|architect(?:ure)?)\b/i],["fitness",/\b(fitness|gym|wellness|personal trainer|yoga|strength club)\b/i],["legal",/\b(law|legal|attorney|lawyer|law firm)\b/i],["finance",/\b(account(?:ant|ing)?|cpa|finance|financial|insurance|bookkeep(?:er|ing)?|tax)\b/i],["web_design",/\b(web design|web designer|website design|web development|digital studio|digital agency|creative agency|ui\/ux|ux design|product design|ecommerce design)\b/i],["technology",/\b(software|technology|saas|consulting|it services?|tech company)\b/i],["beauty",/\b(beauty|salon|barber|spa|cosmetic|skincare|skin care)\b/i]
];
const expectedMediaProfile = mediaRules.find(([,pattern])=>pattern.test(semanticText))?.[0] || "general";
html = html.replace(/<body\b/i, `<body data-arc-expected-media-profile="${expectedMediaProfile}"`);
const escapeAttribute = value => clean(value)
  .replace(/&/g,"&amp;")
  .replace(/"/g,"&quot;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;");
const toolbar = `<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview</strong>Built for this business. Purchase only if approved.</span><a data-arc-checkout href="${escapeAttribute(checkout.toString())}">Own this website — $5,000</a></aside>`;
if (!/<\/body>/i.test(html)) throw new Error("ARC_TEMPLATE_INVALID: closing body tag is missing");
html = html.replace(/<\/body>/i, `${toolbar}\n</body>`);
const unresolved = html.match(/\[\[[A-Z0-9_]+\]\]/g) || [];
if (unresolved.length) throw new Error(`ARC_INJECTION_FAILED: unresolved=${[...new Set(unresolved)].join(",")}`);
const customerEmail = clean(inputData.customer_email).toLowerCase();
if (customerEmail && html.toLowerCase().includes(customerEmail)) {
  throw new Error("ARC_PRIVACY_FAILED: requester email appeared in public HTML");
}
const renderContentSha256=await sha256Text(html);
const renderEvidence=JSON.stringify({
  version:"arc1-render-evidence-v1",
  scope:"signed-sanitized-preview-render",
  preview_folder:previewFolder,
  content_sha256:renderContentSha256,
  intake_evidence_sha256:intakeEvidenceSha256,
  state_digest_sha256:clean(intakeEvidence.state_digest_sha256),
  submission_data_sha256:clean(intakeEvidence.submission_data_sha256),
  asset_manifest_sha256:assetManifestSha256
});
const renderEvidenceSignatureBytes=await globalThis.crypto.subtle.sign(
  "HMAC",
  evidenceKey,
  evidenceEncoder.encode(`arc1-render-evidence-signature-v1\n${renderEvidence}`)
);
const renderEvidenceHmacSha256=bytesToHex(renderEvidenceSignatureBytes);
const pagesBaseUrl = clean(inputData.pages_base_url || "https://arcwebhq-cpu.github.io/arc-previews").replace(/\/+$/, "");
return {
  html_content: html,
  raw_json: JSON.stringify(generated),
  file_path: `${previewFolder}/index.html`,
  preview_folder: previewFolder,
  preview_url: `${pagesBaseUrl}/${previewFolder}/`,
  checkout_url: checkout.toString(),
  checkout_reference: checkoutReference,
  trusted_event_prefix: submissionPrefix,
  trusted_netlify_submission_id: clean(intakeEvidence.submission_id).toLowerCase(),
  trusted_received_at: receivedAt,
  intake_state_key: clean(intakeEvidence.state_key),
  intake_state_digest_sha256: clean(intakeEvidence.state_digest_sha256),
  intake_evidence_sha256: intakeEvidenceSha256,
  submission_data_sha256: clean(intakeEvidence.submission_data_sha256),
  asset_manifest_sha256: assetManifestSha256,
  validated_asset_manifest: canonicalJson(evidenceManifest),
  render_content_sha256:renderContentSha256,
  render_evidence_private:renderEvidence,
  render_evidence_hmac_sha256:renderEvidenceHmacSha256,
  expected_media_profile: expectedMediaProfile,
  template_placeholder_count: templateKeys.length,
  final_placeholder_count: 0,
  html_character_count: html.length,
  template_comment: template.match(/ARC Client Master Template v\d+(?:\.\d+)?/i)?.[0] || "unknown"
};
