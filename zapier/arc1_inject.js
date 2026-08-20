// ARC1 Step 6 — exact-contract preview injection and Stripe folder binding.
const clean = value => String(value == null ? "" : value).trim();
const decodePrivacyEntities = value => String(value == null ? "" : value)
  .replace(/&#(\d+);?/g, (_, code) => {
    const point = Number(code); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  })
  .replace(/&#x([0-9a-f]+);?/gi, (_, code) => {
    const point = Number.parseInt(code, 16); return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  })
  .replace(/&(amp|quot|apos|lt|gt|colon|sol|period|commat|percnt|num|tab|newline);/gi, (_, name) => ({
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", sol: "/", period: ".",
    commat: "@", percnt: "%", num: "#", tab: "\t", newline: "\n"
  })[name.toLowerCase()]);
const decodePercentBytes = value => String(value).replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
  try { return decodeURIComponent(encoded); } catch { return encoded.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))); }
});
const recursivelyDecodePrivacyValue = value => {
  let current = String(value == null ? "" : value);
  for (let pass = 0; pass < 5; pass += 1) {
    let next = decodePrivacyEntities(current).replace(/\/\*[\s\S]*?\*\//g,"")
      .replace(/\\x([0-9a-f]{2})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/\\u\{([0-9a-f]{1,6})\}/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/\\([0-9a-f]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
      .replace(/[\u3002\uff0e\uff61]/g,".");
    next = decodePercentBytes(next.replace(/\+/g, "%20"));
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC");
};
const privacyCanonical = value => recursivelyDecodePrivacyValue(value).toLowerCase().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const privacyCompact = value => privacyCanonical(value).replace(/[^\p{L}\p{N}@]+/gu, "");
const assertPrivateValuesAbsent = (markup, privateValues, label) => {
  const decoded = recursivelyDecodePrivacyValue(markup);
  const text = recursivelyDecodePrivacyValue(decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const urlSurfaces = [...decoded.matchAll(/\b(?:href|src|srcset|action|content|style)\s*=\s*["']([^"']*)["']/gi)].map(match => recursivelyDecodePrivacyValue(match[1]));
  const surfaces = [decoded, text, ...urlSurfaces].map(value => ({ canonical: privacyCanonical(value), compact: privacyCompact(value) }));
  for (const item of privateValues) {
    const privateCanonical = privacyCanonical(item?.value);
    if (!privateCanonical) continue;
    const privateCompact = privacyCompact(privateCanonical);
    if (surfaces.some(surface => surface.canonical.includes(privateCanonical) ||
        (privateCompact.length >= 7 && surface.compact.includes(privateCompact)))) {
      throw new Error(`ARC_PRIVACY_FAILED: ${label} contains private ${item.label}`);
    }
  }
};
const assertNoCheckoutCapability = (markup, label) => {
  const decoded = recursivelyDecodePrivacyValue(markup).toLowerCase();
  const compact = decoded.replace(/[\s\u0000-\u001f\u007f]+/g, "");
  const nonScriptMarkup=String(markup).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"");
  const forbidden=/buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v3_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v1|arc1-checkout-recipient-reservation-v1|arc1-preview-readiness-(?:core|observation)-v1|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v1|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;
  if (/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScriptMarkup) || /\p{Default_Ignorable_Code_Point}/u.test(nonScriptMarkup) || forbidden.test(decoded) || forbidden.test(compact) || /<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(String(markup))) {
    throw new Error(`ARC_CHECKOUT_CAPABILITY_INVALID: ${label}`);
  }
  for (const match of String(markup).matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const normalized = recursivelyDecodePrivacyValue(raw).toLowerCase();
    const forbiddenNamedEntity=/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;?/i.test(raw);
    const defaultIgnorable=/\p{Default_Ignorable_Code_Point}/u.test(normalized);
    let parsedUrl;try{parsedUrl=new URL(normalized,"https://arc.invalid/");}catch{}
    const canonicalHost=parsedUrl?.hostname?.toLowerCase()||"";
    if (/%(?![0-9a-f]{2})/i.test(raw) || forbiddenNamedEntity || defaultIgnorable ||
        canonicalHost==="buy.stripe.com" || canonicalHost.endsWith(".buy.stripe.com") || new Set(["javascript:","vbscript:"]).has(parsedUrl?.protocol) ||
        /^(?:javascript|vbscript):/i.test(normalized) || forbidden.test(normalized) || forbidden.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g,""))) {
      throw new Error(`ARC_CHECKOUT_CAPABILITY_INVALID: ${label}`);
    }
  }
};
const assertNoRemoteRuntimeDependencies = (markup, exactReceiptUrls) => {
  const receiptUrls=new Set([...exactReceiptUrls].map(value=>clean(value)).filter(Boolean));
  const decode=value=>recursivelyDecodePrivacyValue(value).replace(/[\u0000-\u001f\u007f]+/g,"").trim();
  const remote=value=>/^(?:https?:)?\/\//i.test(decode(value));
  const safeLocal=value=>{
    const decoded=decode(value);
    return /^\/(?!\/)[^\\\s]*$/.test(decoded)||/^\.?\.\/(?!\/)[^\\\s:]*$/.test(decoded)||/^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=@%/-]*$/.test(decoded);
  };
  const assertResourceValue=(tagName,attribute,rawValue)=>{
    const values=attribute==="srcset"
      ? decode(rawValue).split(",").map(candidate=>candidate.trim().split(/\s+/,1)[0]).filter(Boolean)
      : [decode(rawValue)];
    if(!values.length)throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: empty runtime resource URL");
    for(const value of values){
      if(remote(value)){
        if(!new Set(["img","source"]).has(tagName)||!new Set(["src","srcset"]).has(attribute)||!receiptUrls.has(value)){
          throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: remote ${tagName} ${attribute} is not an exact signed upload receipt URL`);
        }
      }else if(!safeLocal(value)){
        throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: unsafe ${tagName} ${attribute} runtime URL`);
      }
    }
  };
  for(const tag of markup.match(/<[A-Za-z][^>]*>/g)||[]){
    const tagName=tag.match(/^<\s*([A-Za-z][A-Za-z0-9:-]*)/)?.[1].toLowerCase()||"";
    const attributes=[...tag.matchAll(/\b(srcset|src|poster|data|action|href|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)];
    const declared=(tag.match(/\b(?:srcset|src|poster|data|action|href|style)\s*=/gi)||[]).length;
    if(attributes.length!==declared)throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: malformed runtime URL attribute");
    for(const match of attributes){
      const attribute=match[1].toLowerCase(),value=match[2]??match[3]??match[4]??"";
      if(attribute==="style"){
        if(/\\|@import\b|url\s*\(/i.test(decode(value)))throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: CSS escapes, imports, and URL resources are forbidden");
        continue;
      }
      if(attribute==="href"){
        if(tagName==="a"){
          const href=decode(value);
          let externalNavigation=false;
          if(/^https?:\/\//i.test(href)){
            try{const url=new URL(href);externalNavigation=!url.username&&!url.password&&new Set(["http:","https:"]).has(url.protocol);}catch(error){}
          }
          if(!externalNavigation&&!safeLocal(href)&&!/^#[A-Za-z0-9_.:-]*$/.test(href)&&
            !/^tel:\+?[0-9(). -]{5,32}$/i.test(href)&&!/^mailto:[^\s@]+@[^\s@]+\.[^\s@?]+(?:\?[^\s]*)?$/i.test(href)){
            throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: unsafe anchor navigation URL");
          }
          continue;
        }
        if(remote(value))throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: remote ${tagName} href subresource`);
        continue;
      }
      if(attribute==="action"){
        if(!safeLocal(value))throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: form action must remain same-origin");
        continue;
      }
      assertResourceValue(tagName,attribute,value);
    }
    if(tagName==="base"||tagName==="meta"&&/\bhttp-equiv\s*=\s*["']?refresh/i.test(tag)){
      throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: forbidden ${tagName} navigation primitive`);
    }
  }
  for(const style of markup.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi)||[]){
    if(/\\|@import\b|url\s*\(/i.test(style))throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: CSS escapes, imports, and URL resources are forbidden");
  }
  const scripts=(markup.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[]).join("\n");
  const forbiddenScript=[
    /\bfetch\s*\(/i,/\bXMLHttpRequest\b/i,/\bWebSocket\s*\(/i,/\bEventSource\s*\(/i,
    /\bsendBeacon\s*\(/i,/\bserviceWorker\b/i,/\bimportScripts\s*\(/i,/\bnew\s+Image\s*\(/i,
    /\.(?:src|srcset|poster|href|action)\s*=/i,/\.setAttribute\s*\(\s*["'](?:src|srcset|poster|href|action)["']/i,
    /\bwindow\.open\s*\(/i,/(?:\bwindow\.|\bdocument\.)?location(?:\.href)?\s*=/i,/(?:\bwindow\.|\bdocument\.)?location\.(?:assign|replace)\s*\(/i,
    /\b(?:window|document)\s*\[\s*["'](?:open|location)["']\s*\]/i,/\[\s*["'](?:href|action|assign|replace)["']\s*\]\s*(?:=|\()/i
  ];
  if(forbiddenScript.some(pattern=>pattern.test(scripts))){
    throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: executable network or dynamic resource primitive");
  }
};
const trustedScriptHashes=["55335153318fa5a489d033599208d42c1c3c8b25f4a07f6e0a4f17fb5be60937","596ddd07b7b1525a0c2ec32411fa73e34121f8c320687a7249b9f793d8cf2870","98cbb58e3ec829ddaec61983333a8bb500b91558625a346350bfc8fe4842b860"];
const trustedScriptManifestSha256="8ff6073533b7b631ab6657461d3631a2f00ca4a70ed0b79c2c016647948aae7b";
const assertTrustedScripts=async markup=>{
  const scripts=markup.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)||[];
  const hashes=[];for(const script of scripts)hashes.push(await sha256Text(script));hashes.sort();
  if((markup.match(/<script\b/gi)||[]).length!==scripts.length||(markup.match(/<\/script\b/gi)||[]).length!==scripts.length||
    scripts.length!==3||JSON.stringify(hashes)!==JSON.stringify([...trustedScriptHashes].sort())||await sha256Text(hashes.join("\n"))!==trustedScriptManifestSha256){
    throw new Error("ARC_SCRIPT_MANIFEST_INVALID: public preview scripts differ from the reviewed template allowlist");
  }
};
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
const safeClasses = new Set(["service-card","stat","stat-card","process-step","proof-card","gallery-card","visual-direction","contact-form","form-field","form-wide","form-status","btn","btn-primary","btn-secondary"]);
const supportedFormControlNames = new Set(["form-name","bot-field","name","email","phone","project_details"]);
const leadDisclosureHtml='<p class="form-status" role="note">By submitting this form, you agree that this business may contact you about your request. Do not include sensitive personal, medical, legal, or financial information.</p>';
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
  if(!formBlock.includes(leadDisclosureHtml))throw new Error("ARC_CONTENT_UNSAFE: exact visible lead privacy disclosure is required");
  if(/<(?:input|textarea|select|button)\b/i.test(markup.replace(formBlock,"")))throw new Error("ARC_CONTENT_UNSAFE: generated form controls escaped the form");
  const formAttributes=attributeMapForCanonicalTag(formOpenings[0],"form");
  const formName=clean(formAttributes.get("name"));
  const honeypotName=clean(formAttributes.get("netlify-honeypot"));
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(formName)||formAttributes.get("method")!=="POST"||formAttributes.get("data-netlify")!=="true"||formAttributes.get("action")!=="/?submitted=1"||honeypotName!=="bot-field"){
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
const legacyEvidenceFields=[
  "version","scope","site_id","site_url","form_id","form_name","submission_id","received_at",
  "intake_version","budget_confirmed","terms_accepted","public_folder_prefix","submission_data_sha256",
  "asset_manifest","asset_manifest_sha256","total_asset_bytes","state_key","state_digest_sha256","claim_required_before_build","issued_at"
];
const functionEvidenceFields=[
  "version","scope","bridge_contract_sha256","site_id_sha256","source_schema","source_form_name","source_key_hmac_sha256",
  "delivery_id","submission_id","received_at","intake_version","budget_confirmed","terms_accepted","asset_permission","public_folder_prefix",
  "submission_data_sha256","asset_manifest","asset_manifest_sha256","total_asset_bytes","state_key","state_digest_sha256",
  "claim_required_before_build","issued_at"
];
const isFunctionEvidence=intakeEvidence.version==="arc1-intake-evidence-v2";
const expectedEvidenceFields=isFunctionEvidence?functionEvidenceFields:legacyEvidenceFields;
if(JSON.stringify(Object.keys(intakeEvidence).sort())!==JSON.stringify(expectedEvidenceFields.slice().sort())){
  throw new Error("ARC1_INTAKE_INVALID: intake evidence fields");
}
const externalId=value=>/^(?:[a-f0-9]{24}|[a-f0-9]{40}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(clean(value));
const expectedSiteId=clean(inputData.expected_netlify_site_id).toLowerCase();
const expectedFormId=clean(inputData.expected_netlify_form_id).toLowerCase();
const expectedFormName=clean(inputData.expected_netlify_form_name);
const bridgeContractSha256="e9bd5a3be21e0192acdc8b81692dab7bf5b1d0a132325a73011aa03e43674841";
const requiredBudgetConfirmation="Yes, understands the finished ARC website subtotal is $5,000 plus applicable sales tax only after preview approval";
const requiredTermsAcceptance="Accepted ARC preview terms, privacy policy, refund policy, and service scope dated 2026-08-12; separate adult checkout acceptance required";
const receivedAt=clean(intakeEvidence.received_at),issuedAt=clean(intakeEvidence.issued_at);
const receivedMs=Date.parse(receivedAt),issuedMs=Date.parse(issuedAt),nowMs=Date.now();
const expectedSiteIdSha256=await sha256Text(expectedSiteId);
const derivedPublicFolderPrefix=(await sha256Text((isFunctionEvidence?[
  "arc-preview-folder-v2",bridgeContractSha256,expectedSiteIdSha256,clean(intakeEvidence.submission_id).toLowerCase(),receivedAt
]:[
  "arc-preview-folder-v1",expectedSiteId,expectedFormId,clean(intakeEvidence.submission_id).toLowerCase(),receivedAt
]).join("\n"))).slice(0,8);
const legacyIdentityValid=!isFunctionEvidence&&intakeEvidence.version==="arc1-intake-evidence-v1"&&
  intakeEvidence.scope==="authoritative-netlify-intake-and-assets"&&externalId(expectedFormId)&&
  clean(intakeEvidence.site_id).toLowerCase()===expectedSiteId&&clean(intakeEvidence.form_id).toLowerCase()===expectedFormId&&
  clean(intakeEvidence.form_name)===expectedFormName&&externalId(intakeEvidence.submission_id)&&
  clean(intakeEvidence.state_key)===`arc1-intake-claim-v1:${clean(intakeEvidence.state_digest_sha256)}`;
const functionIdentityValid=isFunctionEvidence&&intakeEvidence.scope==="authoritative-first-party-function-intake"&&
  intakeEvidence.bridge_contract_sha256===bridgeContractSha256&&clean(intakeEvidence.site_id_sha256)===expectedSiteIdSha256&&
  intakeEvidence.source_schema==="arc-intake-function-submission-v1"&&intakeEvidence.source_form_name==="arc-preview-function-v1"&&
  /^[a-f0-9]{64}$/.test(clean(intakeEvidence.source_key_hmac_sha256))&&/^[a-f0-9]{64}$/.test(clean(intakeEvidence.delivery_id))&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(clean(intakeEvidence.submission_id))&&
  intakeEvidence.asset_permission===(intakeEvidence.asset_manifest?.length?"Confirmed":"")&&
  clean(intakeEvidence.state_key)===`arc1-intake-claim-v2:${clean(intakeEvidence.state_digest_sha256)}`;
if(
  !externalId(expectedSiteId)||(!legacyIdentityValid&&!functionIdentityValid)||intakeEvidence.intake_version!=="arc-intake-v7"||
  intakeEvidence.budget_confirmed!==requiredBudgetConfirmation||intakeEvidence.terms_accepted!==requiredTermsAcceptance||
  clean(intakeEvidence.public_folder_prefix)!==derivedPublicFolderPrefix||
  !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.submission_data_sha256))||
  !/^[a-f0-9]{64}$/.test(clean(intakeEvidence.state_digest_sha256))||
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
const evidenceSignaturePrefix=isFunctionEvidence?"arc1-intake-evidence-signature-v2\n":"arc1-intake-evidence-signature-v1\n";
if(!(await globalThis.crypto.subtle.verify("HMAC",evidenceKey,evidenceSignatureBytes,evidenceEncoder.encode(`${evidenceSignaturePrefix}${evidenceRaw}`)))){
  throw new Error("ARC1_INTAKE_INVALID: intake evidence HMAC mismatch");
}
const intakeEvidenceSha256=await sha256Text(evidenceRaw);
const evidenceManifest=Array.isArray(intakeEvidence.asset_manifest)?intakeEvidence.asset_manifest:null;
if(!evidenceManifest||evidenceManifest.length>3||!Number.isSafeInteger(intakeEvidence.total_asset_bytes)||
  intakeEvidence.total_asset_bytes<0||intakeEvidence.total_asset_bytes>(isFunctionEvidence?3020000:7864320)){
  throw new Error("ARC1_ASSET_INVALID: signed asset manifest");
}
const assetInputs={logo_file:inputData.logo_file_url,hero_image_file:inputData.hero_image_url,supporting_image_file:inputData.supporting_image_url};
const roleOrder=isFunctionEvidence?["hero_image_file","logo_file","supporting_image_file"]:["logo_file","hero_image_file","supporting_image_file"];
let manifestTotal=0,lastRoleIndex=-1;
for(const entry of evidenceManifest){
  if(isFunctionEvidence&&(entry?.kind==="FOLDER_LINK"||entry?.role==="asset_folder_link")){
    throw new Error("ARC1_ASSET_UNSUPPORTED: folder links require a private provider adapter");
  }
  const expectedAssetFields=isFunctionEvidence?
    ["asset_id","content_type","kind","retrieval_endpoint_sha256","role","sha256","size_bytes"]:
    ["content_type","role","sha256","size_bytes","source_url_sha256"];
  if(!entry||typeof entry!=="object"||Array.isArray(entry)||JSON.stringify(Object.keys(entry).sort())!==JSON.stringify(expectedAssetFields.sort())){
    throw new Error("ARC1_ASSET_INVALID: asset evidence fields");
  }
  const roleIndex=roleOrder.indexOf(clean(entry.role));
  const exactUrl=String(assetInputs[entry.role]==null?"":assetInputs[entry.role]);
  let legacyUrlValid=true;
  if(!isFunctionEvidence){
    let verifiedAssetUrl;
    try{verifiedAssetUrl=new URL(exactUrl);}catch(error){legacyUrlValid=false;}
    legacyUrlValid=legacyUrlValid&&exactUrl===exactUrl.trim()&&Boolean(exactUrl)&&await sha256Text(exactUrl)===clean(entry.source_url_sha256)&&
      verifiedAssetUrl.protocol==="https:"&&!verifiedAssetUrl.username&&!verifiedAssetUrl.password&&!verifiedAssetUrl.port&&!verifiedAssetUrl.search&&!verifiedAssetUrl.hash;
  }
  const functionAssetValid=!isFunctionEvidence||(/^[a-f0-9]{64}$/.test(clean(entry.asset_id))&&
    /^[a-f0-9]{64}$/.test(clean(entry.retrieval_endpoint_sha256))&&entry.kind==="UPLOAD"&&
    new Set(["image/png","image/jpeg","image/webp"]).has(entry.content_type));
  if(roleIndex<=lastRoleIndex||!legacyUrlValid||!functionAssetValid||
    !/^[a-f0-9]{64}$/.test(clean(entry.sha256))||
    !Number.isSafeInteger(entry.size_bytes)||entry.size_bytes<1||entry.size_bytes>(isFunctionEvidence?1250000:2621440)){
    throw new Error("ARC1_ASSET_INVALID: asset URL/hash/type/size binding");
  }
  lastRoleIndex=roleIndex;manifestTotal+=entry.size_bytes;
}
if(manifestTotal!==intakeEvidence.total_asset_bytes)throw new Error("ARC1_ASSET_INVALID: asset manifest total mismatch");
const assetManifestSha256=await sha256Text(canonicalJson(evidenceManifest));
if(clean(intakeEvidence.asset_manifest_sha256).toLowerCase()!==assetManifestSha256){
  throw new Error("ARC1_ASSET_INVALID: signed asset manifest SHA-256 mismatch");
}
const submissionPrefix=clean(intakeEvidence.public_folder_prefix);
const businessSlug = slugify(generated.BUSINESS_NAME).slice(0, 64).replace(/-+$/g, "");
if (!submissionPrefix || !businessSlug) throw new Error("ARC_PATH_INVALID: business name or submission id");
const previewFolder = `${businessSlug}-${submissionPrefix}`;
let assetPublicationReceiptSha256="";
let publicAssetUrlMap={};
if(isFunctionEvidence){
  const publicationSecret=clean(inputData.asset_publication_receipt_secret);
  if(evidenceEncoder.encode(publicationSecret).length<32||evidenceEncoder.encode(publicationSecret).length>256||publicationSecret===intakeEvidenceSecret){
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt secret");
  }
  const publicationRaw=clean(inputData.asset_publication_receipt_private);
  let publication;
  try{publication=JSON.parse(publicationRaw);}catch(error){throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt JSON");}
  const publicationFields=["version","scope","bridge_contract_sha256","delivery_id","bridge_evidence_sha256","private_asset_receipt_sha256",
    "intake_evidence_sha256","intake_state_digest_sha256","asset_manifest_sha256","asset_permission","repository","base_branch",
    "preview_branch","pages_base_url","public_folder_prefix","preview_folder","entries","status"];
  const publicationEntryFields=["asset_id","content_type","git_blob_sha1","public_url","repository_path","role","sha256","size_bytes"];
  const pagesRoot="https://arcwebhq-cpu.github.io/arc-previews";
  const extensions={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"};
  if(!publication||typeof publication!=="object"||Array.isArray(publication)||canonicalJson(publication)!==publicationRaw||
    JSON.stringify(Object.keys(publication).sort())!==JSON.stringify(publicationFields.slice().sort())||
    publication.version!=="arc1-public-asset-publication-receipt-v1"||publication.scope!=="github-content-addressed-preview-assets"||
    publication.bridge_contract_sha256!==bridgeContractSha256||publication.delivery_id!==intakeEvidence.delivery_id||
    !/^[a-f0-9]{64}$/.test(clean(publication.bridge_evidence_sha256))||
    publication.private_asset_receipt_sha256!==clean(inputData.ingress_claim_asset_receipt_sha256).toLowerCase()||
    !/^[a-f0-9]{64}$/.test(publication.private_asset_receipt_sha256)||publication.intake_evidence_sha256!==intakeEvidenceSha256||
    publication.intake_state_digest_sha256!==clean(intakeEvidence.state_digest_sha256)||publication.asset_manifest_sha256!==assetManifestSha256||
    publication.asset_permission!==intakeEvidence.asset_permission||publication.repository!=="arcwebhq-cpu/arc-previews"||publication.base_branch!=="main"||
    publication.preview_branch!==`arc-preview/${intakeEvidence.public_folder_prefix}`||publication.pages_base_url!==pagesRoot||
    publication.public_folder_prefix!==intakeEvidence.public_folder_prefix||publication.preview_folder!==previewFolder||!Array.isArray(publication.entries)){
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: exact publication receipt binding");
  }
  const uploads=evidenceManifest.filter(entry=>entry.kind==="UPLOAD");
  if(publication.entries.length!==uploads.length||publication.status!==(uploads.length?"VERIFIED_CONTENT_ADDRESSED":"NO_PUBLIC_UPLOADS")){
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication entry count/status");
  }
  for(let index=0;index<uploads.length;index+=1){
    const manifest=uploads[index],entry=publication.entries[index];
    const path=`${previewFolder}/assets/${manifest.sha256}.${extensions[manifest.content_type]}`;
    const url=`${pagesRoot}/${path}`;
    if(!entry||typeof entry!=="object"||Array.isArray(entry)||
      JSON.stringify(Object.keys(entry).sort())!==JSON.stringify(publicationEntryFields.slice().sort())||
      entry.asset_id!==manifest.asset_id||entry.content_type!==manifest.content_type||entry.role!==manifest.role||entry.sha256!==manifest.sha256||
      entry.size_bytes!==manifest.size_bytes||!/^[a-f0-9]{40}$/.test(entry.git_blob_sha1)||entry.repository_path!==path||entry.public_url!==url||
      clean(assetInputs[manifest.role])!==url){
      throw new Error("ARC1_ASSET_PUBLICATION_INVALID: exact content-addressed URL map");
    }
    publicAssetUrlMap[manifest.role]=url;
  }
  for(const role of ["logo_file","hero_image_file","supporting_image_file"]){
    if(Boolean(clean(assetInputs[role]))!==Object.hasOwn(publicAssetUrlMap,role))throw new Error("ARC1_ASSET_PUBLICATION_INVALID: missing or arbitrary mapped URL");
  }
  const publicationSignature=clean(inputData.asset_publication_receipt_hmac_sha256).toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(publicationSignature))throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt HMAC");
  const publicationKey=await globalThis.crypto.subtle.importKey("raw",evidenceEncoder.encode(publicationSecret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const publicationSignatureBytes=Uint8Array.from(publicationSignature.match(/../g),byte=>Number.parseInt(byte,16));
  if(!(await globalThis.crypto.subtle.verify("HMAC",publicationKey,publicationSignatureBytes,
    evidenceEncoder.encode(`arc1-public-asset-publication-receipt-v1\n${publicationRaw}`)))){
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt HMAC mismatch");
  }
  assetPublicationReceiptSha256=await sha256Text(publicationRaw);
  if(clean(inputData.asset_publication_receipt_sha256).toLowerCase()!==assetPublicationReceiptSha256){
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: publication receipt digest mismatch");
  }
}else{
  for(const role of ["logo_file","hero_image_file","supporting_image_file"]){
    if(Boolean(clean(assetInputs[role]))!==evidenceManifest.some(entry=>entry.role===role))throw new Error("ARC1_ASSET_INVALID: unverified or missing mapped asset URL");
  }
}
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
const paymentLinkEvidenceSecret=clean(inputData.payment_link_evidence_secret);
if(evidenceEncoder.encode(paymentLinkEvidenceSecret).length<32||evidenceEncoder.encode(paymentLinkEvidenceSecret).length>256){
  throw new Error("ARC_PAYMENT_LINK_INVALID: payment-link evidence secret must be 32–256 UTF-8 bytes");
}
const paymentLinkEvidenceRaw=clean(inputData.payment_link_evidence_private);
let paymentLinkEvidence;
try{paymentLinkEvidence=JSON.parse(paymentLinkEvidenceRaw);}catch(error){throw new Error("ARC_PAYMENT_LINK_INVALID: payment-link evidence JSON");}
const paymentLinkEvidenceFields=[
  "version","scope","price_id","product_id","amount_subtotal_minor_units",
  "stripe_account_id_sha256","livemode",
  "currency","quantity","terms_version","automatic_tax_enabled","customer_address_source",
  "terms_document_sha256",
  "price_tax_behavior","product_tax_code","tax_contract_version","tax_settings_status","tax_registrations_sha256",
  "tax_registrations","adult_acknowledgement_key","name_collection_required","submit_type","checkout_redirect_url",
  "stripe_api_version","configuration_sha256","issued_at"
];
if(!paymentLinkEvidence||typeof paymentLinkEvidence!=="object"||Array.isArray(paymentLinkEvidence)||
  canonicalJson(paymentLinkEvidence)!==paymentLinkEvidenceRaw||
  JSON.stringify(Object.keys(paymentLinkEvidence).sort())!==JSON.stringify(paymentLinkEvidenceFields.slice().sort())){
  throw new Error("ARC_PAYMENT_LINK_INVALID: canonical payment-link evidence contract");
}
const expectedPriceId=clean(inputData.expected_price_id);
const expectedTermsVersion=clean(inputData.expected_terms_version);
const expectedTermsDocumentSha256=clean(inputData.expected_terms_document_sha256).toLowerCase();
const expectedProductTaxCode=clean(inputData.expected_product_tax_code);
const expectedStripeAccountIdSha256=clean(inputData.expected_stripe_account_id_sha256).toLowerCase();
const stripeLiveModeFlag=clean(inputData.stripe_live_mode_enabled).toLowerCase();
if(!["","false","true"].includes(stripeLiveModeFlag))throw new Error("ARC_STRIPE_MODE_INVALID: stripe_live_mode_enabled must be true or false");
const stripeLiveModeEnabled=stripeLiveModeFlag==="true";
const paymentLinkEvidenceIssuedAt=clean(paymentLinkEvidence.issued_at);
const paymentLinkEvidenceIssuedMs=Date.parse(paymentLinkEvidenceIssuedAt);
if(paymentLinkEvidence.version!=="arc1-checkout-offer-template-evidence-v1"||
  paymentLinkEvidence.scope!=="authoritative-private-checkout-offer-template-preflight"||
  !/^price_[A-Za-z0-9]+$/.test(expectedPriceId)||
  !/^prod_[A-Za-z0-9]+$/.test(clean(paymentLinkEvidence.product_id))||
  !/^txcd_[0-9]{8}$/.test(expectedProductTaxCode)||
  !/^[a-f0-9]{64}$/.test(expectedStripeAccountIdSha256)||
  !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(expectedTermsVersion)||
  !/^[a-f0-9]{64}$/.test(expectedTermsDocumentSha256)||paymentLinkEvidence.terms_document_sha256!==expectedTermsDocumentSha256||
  paymentLinkEvidence.price_id!==expectedPriceId||
  paymentLinkEvidence.stripe_account_id_sha256!==expectedStripeAccountIdSha256||
  paymentLinkEvidence.livemode!==stripeLiveModeEnabled||
  paymentLinkEvidence.amount_subtotal_minor_units!==500000||paymentLinkEvidence.currency!=="usd"||
  paymentLinkEvidence.quantity!==1||paymentLinkEvidence.terms_version!==expectedTermsVersion||
  paymentLinkEvidence.automatic_tax_enabled!==true||
  paymentLinkEvidence.customer_address_source!=="stripe_checkout_customer_details.address"||
  paymentLinkEvidence.price_tax_behavior!=="exclusive"||
  paymentLinkEvidence.product_tax_code!==expectedProductTaxCode||
  paymentLinkEvidence.tax_contract_version!=="arc-tax-v1"||
  paymentLinkEvidence.tax_settings_status!=="active"||
  !Array.isArray(paymentLinkEvidence.tax_registrations)||paymentLinkEvidence.tax_registrations.length<1||paymentLinkEvidence.tax_registrations.length>100||
  !/^[a-f0-9]{64}$/.test(clean(paymentLinkEvidence.tax_registrations_sha256))||
  paymentLinkEvidence.adult_acknowledgement_key!=="adultpurchaserack"||paymentLinkEvidence.name_collection_required!==true||
  paymentLinkEvidence.submit_type!=="auto"||paymentLinkEvidence.checkout_redirect_url!=="https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}"||
  paymentLinkEvidence.stripe_api_version!=="2026-06-24.dahlia"||
  !/^[a-f0-9]{64}$/.test(clean(paymentLinkEvidence.configuration_sha256))||
  !Number.isFinite(paymentLinkEvidenceIssuedMs)||new Date(paymentLinkEvidenceIssuedMs).toISOString()!==paymentLinkEvidenceIssuedAt||
  paymentLinkEvidenceIssuedMs<Date.now()-5*60*1000||paymentLinkEvidenceIssuedMs>Date.now()+5*60*1000){
  throw new Error("ARC_PAYMENT_LINK_INVALID: payment-link evidence identity, configuration, or freshness");
}
const paymentLinkEvidenceHmac=clean(inputData.payment_link_evidence_hmac_sha256).toLowerCase();
if(!/^[a-f0-9]{64}$/.test(paymentLinkEvidenceHmac))throw new Error("ARC_PAYMENT_LINK_INVALID: payment-link evidence HMAC");
const paymentLinkEvidenceKey=await globalThis.crypto.subtle.importKey(
  "raw",evidenceEncoder.encode(paymentLinkEvidenceSecret),{name:"HMAC",hash:"SHA-256"},false,["verify"]
);
if(!(await globalThis.crypto.subtle.verify(
  "HMAC",paymentLinkEvidenceKey,
  Uint8Array.from(paymentLinkEvidenceHmac.match(/../g),byte=>Number.parseInt(byte,16)),
  evidenceEncoder.encode(`arc1-checkout-offer-template-evidence-signature-v1\n${paymentLinkEvidenceRaw}`)
))){
  throw new Error("ARC_PAYMENT_LINK_INVALID: payment-link evidence HMAC mismatch");
}
const paymentLinkEvidenceSha256=await sha256Text(paymentLinkEvidenceRaw);
const taxRegistrationFields=["country","id","state","type"];
for(const registration of paymentLinkEvidence.tax_registrations){
  if(!registration||typeof registration!=="object"||Array.isArray(registration)||
    JSON.stringify(Object.keys(registration).sort())!==JSON.stringify(taxRegistrationFields)||
    !/^taxreg_[A-Za-z0-9]+$/.test(clean(registration.id))||!/^[A-Z]{2}$/.test(clean(registration.country))||
    !/^[A-Z0-9-]{1,10}$/.test(clean(registration.state))||!/^[a-z][a-z0-9_]{2,63}$/.test(clean(registration.type))){
    throw new Error("ARC_PAYMENT_LINK_INVALID: stable tax registration snapshot");
  }
}
if(new Set(paymentLinkEvidence.tax_registrations.map(item=>item.id)).size!==paymentLinkEvidence.tax_registrations.length||
  canonicalJson([...paymentLinkEvidence.tax_registrations].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))!==canonicalJson(paymentLinkEvidence.tax_registrations)||
  await sha256Text(canonicalJson(paymentLinkEvidence.tax_registrations))!==paymentLinkEvidence.tax_registrations_sha256){
  throw new Error("ARC_PAYMENT_LINK_INVALID: tax registration snapshot digest");
}
const stableCheckoutConfiguration={
  stripe_account_id_sha256:paymentLinkEvidence.stripe_account_id_sha256,
  livemode:paymentLinkEvidence.livemode,price_id:paymentLinkEvidence.price_id,
  product_id:paymentLinkEvidence.product_id,
  amount_subtotal_minor_units:paymentLinkEvidence.amount_subtotal_minor_units,currency:paymentLinkEvidence.currency,quantity:paymentLinkEvidence.quantity,
  terms_version:paymentLinkEvidence.terms_version,terms_document_sha256:paymentLinkEvidence.terms_document_sha256,
  automatic_tax_enabled:paymentLinkEvidence.automatic_tax_enabled,
  customer_address_source:paymentLinkEvidence.customer_address_source,price_tax_behavior:paymentLinkEvidence.price_tax_behavior,
  product_tax_code:paymentLinkEvidence.product_tax_code,tax_contract_version:paymentLinkEvidence.tax_contract_version,
  tax_settings_status:paymentLinkEvidence.tax_settings_status,tax_registrations:paymentLinkEvidence.tax_registrations,
  tax_registrations_sha256:paymentLinkEvidence.tax_registrations_sha256,adult_acknowledgement_key:paymentLinkEvidence.adult_acknowledgement_key,
  name_collection_required:paymentLinkEvidence.name_collection_required,submit_type:paymentLinkEvidence.submit_type,
  checkout_redirect_url:paymentLinkEvidence.checkout_redirect_url,stripe_api_version:paymentLinkEvidence.stripe_api_version
};
if(await sha256Text(canonicalJson(stableCheckoutConfiguration))!==paymentLinkEvidence.configuration_sha256){
  throw new Error("ARC_PAYMENT_LINK_INVALID: immutable checkout configuration digest mismatch");
}
const checkoutBindingSecret = clean(inputData.checkout_binding_secret);
const checkoutBindingKeyId = clean(inputData.checkout_binding_key_id).toLowerCase();
const checkoutSignatureMode=stripeLiveModeEnabled?"live":"test";
if (checkoutBindingSecret.length < 32 || checkoutBindingSecret.length > 256) {
  throw new Error("ARC_PAYMENT_LINK_INVALID: checkout binding secret must be 32–256 characters");
}
if(!/^[a-f0-9]{2}$/.test(checkoutBindingKeyId))throw new Error("ARC_PAYMENT_LINK_INVALID: checkout binding key id must be one byte of lowercase hex");
if(new Set([checkoutBindingSecret,paymentLinkEvidenceSecret,intakeEvidenceSecret]).size!==3){
  throw new Error("ARC_PAYMENT_LINK_INVALID: intake, payment-link, and checkout secrets must be separate");
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
if(isFunctionEvidence){
  const receiptUrls=new Set(Object.values(publicAssetUrlMap));
  html=html.replace(/<(?:img|source)\b[^>]*>/gi,tag=>{
    const rawValues=[...tag.matchAll(/\b(?:src|srcset)\s*=\s*["']([^"']+)["']/gi)].flatMap(match=>
      match[0].toLowerCase().startsWith("srcset")?match[1].split(",").map(item=>clean(item).split(/\s+/,1)[0]):[clean(match[1])]
    );
    if(!rawValues.some(value=>receiptUrls.has(decodeUrlEntities(value))))return tag;
    if(/\bdata-arc-media-provider\s*=/i.test(tag))throw new Error("ARC1_ASSET_PUBLICATION_INVALID: duplicate media provenance marker");
    return tag.replace(/\s*\/?\s*>$/,ending=>` data-arc-media-provider="customer-upload"${ending}`);
  });
}
const hasRenderedLeadForm=/<form\b[^>]*\bdata-netlify\s*=\s*["']true["']/i.test(html);
const boundLeadRecipientEmail=clean(inputData.private_lead_notification_email||inputData.verified_lead_notification_email).toLowerCase();
const boundClaimRecipientEmail=clean(inputData.private_claim_recipient_email).toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(boundClaimRecipientEmail))throw new Error("ARC_CHECKOUT_RECIPIENT_INVALID: explicit private claim recipient is required");
const boundClaimRecipientEmailSha256=await sha256Text(boundClaimRecipientEmail);
let checkoutLeadRecipientHmacSha256="";
if(hasRenderedLeadForm){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(boundLeadRecipientEmail)){
    throw new Error("ARC_LEAD_ROUTE_INVALID: exact private lead recipient must be bound before checkout");
  }
  checkoutLeadRecipientHmacSha256=bytesToHex(await globalThis.crypto.subtle.sign(
    "HMAC",checkoutBindingKey,evidenceEncoder.encode(`arc-checkout-lead-recipient-v1\n${checkoutSignatureMode}\n${boundLeadRecipientEmail}`)
  ));
}
const checkoutAssetPublicationReceiptSha256=assetPublicationReceiptSha256||await sha256Text("arc1-no-publication-receipt-v1");
const checkoutConfigSnapshot=canonicalJson({
  version:"arc-checkout-offer-snapshot-v1",
  scope:"immutable-approved-preview-private-checkout-offer",
  checkout_binding_key_id:checkoutBindingKeyId,
  environment:"arc-production",
  preview_folder:previewFolder,
  preview_path:`${previewFolder}/index.html`,
  preview_source_repository:"arcwebhq-cpu/arc-previews",
  public_folder_prefix:submissionPrefix,
  lead_route_recipient_hmac_sha256:checkoutLeadRecipientHmacSha256,
  asset_publication_receipt_sha256:checkoutAssetPublicationReceiptSha256,
  ...stableCheckoutConfiguration,
  configuration_sha256:paymentLinkEvidence.configuration_sha256
});
const checkoutConfigSnapshotSha256=await sha256Text(checkoutConfigSnapshot);
const checkoutConfigSnapshotSignatureBytes=await globalThis.crypto.subtle.sign(
  "HMAC",checkoutBindingKey,evidenceEncoder.encode(`arc-checkout-offer-snapshot-signature-v1\n${checkoutSignatureMode}\n${checkoutConfigSnapshot}`)
);
const checkoutConfigSnapshotHmacSha256=bytesToHex(checkoutConfigSnapshotSignatureBytes);
html=html.trim();
const approvalContentSha256=await sha256Text(html);
const toolbar = `<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview</strong>Built for this business. Purchase only if approved.</span><span data-arc-checkout-private>Checkout is available only through the private approval email.</span></aside>`;
if (!/<\/body>/i.test(html)) throw new Error("ARC_TEMPLATE_INVALID: closing body tag is missing");
html = html.replace(/<\/body>/i, `${toolbar}\n</body>`);
if(evidenceEncoder.encode(html).byteLength>499500){
  throw new Error("ARC_PREVIEW_SIZE_INVALID: rendered preview must not exceed 499500 UTF-8 bytes before publication proof");
}
const unresolved = html.match(/\[\[[A-Z0-9_]+\]\]/g) || [];
if (unresolved.length) throw new Error(`ARC_INJECTION_FAILED: unresolved=${[...new Set(unresolved)].join(",")}`);
if(isFunctionEvidence){
  const receiptUrls=new Set(Object.values(publicAssetUrlMap));
  const renderedUrls=new Set();
  const decodedHtml=decodeUrlEntities(html);
  for(const match of decodedHtml.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)){
    const candidate=clean(match[1]);
    if(candidate.startsWith("https://arcwebhq-cpu.github.io/arc-previews/"))renderedUrls.add(candidate);
  }
  for(const match of decodedHtml.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)){
    for(const candidate of match[1].split(",").map(value=>clean(value).split(/\s+/,1)[0]).filter(Boolean)){
      if(candidate.startsWith("https://arcwebhq-cpu.github.io/arc-previews/"))renderedUrls.add(candidate);
    }
  }
  if(renderedUrls.size!==receiptUrls.size||[...renderedUrls].some(url=>!receiptUrls.has(url))||[...receiptUrls].some(url=>!renderedUrls.has(url))){
    throw new Error("ARC1_ASSET_PUBLICATION_INVALID: final rendered HTML and signed receipt URL sets differ");
  }
}
assertNoRemoteRuntimeDependencies(html,new Set(isFunctionEvidence?Object.values(publicAssetUrlMap):[]));
await assertTrustedScripts(html);
assertNoCheckoutCapability(html,"public rendered preview contains a decoded checkout capability or private offer marker");
assertPrivateValuesAbsent(html, [
  { label: "requester email", value: inputData.customer_email },
  { label: "lead recipient", value: boundLeadRecipientEmail },
  { label: "claim recipient", value: boundClaimRecipientEmail },
  { label: "contact phone", value: inputData.private_contact_phone },
  { label: "contact address", value: inputData.private_contact_address }
], "rendered preview HTML");
const renderContentSha256=await sha256Text(html);
const checkoutRecipientReservationPrivate=canonicalJson({
  version:"arc1-checkout-recipient-reservation-v1",scope:"private-lead-recipient-for-approved-checkout",
  approval_content_sha256:approvalContentSha256,checkout_offer_snapshot_sha256:checkoutConfigSnapshotSha256,
  checkout_binding_key_id:checkoutBindingKeyId,
  stripe_mode:checkoutSignatureMode,lead_route_recipient_hmac_sha256:checkoutLeadRecipientHmacSha256,
  lead_notification_email:hasRenderedLeadForm?boundLeadRecipientEmail:"",claim_recipient_email:boundClaimRecipientEmail,
  claim_recipient_email_sha256:boundClaimRecipientEmailSha256
});
const checkoutRecipientReservationHmacSha256=bytesToHex(await globalThis.crypto.subtle.sign(
  "HMAC",checkoutBindingKey,evidenceEncoder.encode(`arc1-checkout-recipient-reservation-signature-v1\n${checkoutSignatureMode}\n${checkoutRecipientReservationPrivate}`)
));
const renderEvidence=JSON.stringify({
  version:"arc1-render-evidence-v1",
  scope:"signed-sanitized-preview-render",
  preview_folder:previewFolder,
  content_sha256:renderContentSha256,
  intake_evidence_sha256:intakeEvidenceSha256,
  state_digest_sha256:clean(intakeEvidence.state_digest_sha256),
  submission_data_sha256:clean(intakeEvidence.submission_data_sha256),
  asset_manifest_sha256:assetManifestSha256,
  approval_content_sha256:approvalContentSha256,
  checkout_offer_snapshot_sha256:checkoutConfigSnapshotSha256,script_manifest_sha256:trustedScriptManifestSha256,
  ...(isFunctionEvidence?{asset_publication_receipt_sha256:assetPublicationReceiptSha256}:{})
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
  approval_content_sha256:approvalContentSha256,
  script_manifest_sha256:trustedScriptManifestSha256,
  checkout_config_snapshot_private:checkoutConfigSnapshot,
  checkout_config_snapshot_sha256:checkoutConfigSnapshotSha256,
  checkout_config_snapshot_hmac_sha256:checkoutConfigSnapshotHmacSha256,
  checkout_recipient_reservation_private:checkoutRecipientReservationPrivate,
  checkout_recipient_reservation_hmac_sha256:checkoutRecipientReservationHmacSha256,
  payment_link_evidence_sha256: paymentLinkEvidenceSha256,
  trusted_event_prefix: submissionPrefix,
  trusted_netlify_submission_id: clean(intakeEvidence.submission_id).toLowerCase(),
  trusted_received_at: receivedAt,
  intake_state_key: clean(intakeEvidence.state_key),
  intake_state_digest_sha256: clean(intakeEvidence.state_digest_sha256),
  intake_evidence_sha256: intakeEvidenceSha256,
  submission_data_sha256: clean(intakeEvidence.submission_data_sha256),
  asset_manifest_sha256: assetManifestSha256,
  asset_publication_receipt_sha256: assetPublicationReceiptSha256,
  public_asset_url_map_json: canonicalJson(publicAssetUrlMap),
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
