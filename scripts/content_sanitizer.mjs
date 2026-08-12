const clean = value => String(value ?? "").trim();

export const MARKUP_KEYS = Object.freeze([
  "LOGO_HTML",
  "TRUST_LINE_HTML",
  "HERO_MEDIA_HTML",
  "HERO_CHIPS_HTML",
  "TICKER_HTML",
  "SERVICES_HTML",
  "DIFFERENTIATORS_HTML",
  "ABOUT_BODY",
  "ABOUT_STATS_HTML",
  "ABOUT_MEDIA_HTML",
  "PROCESS_HTML",
  "PROOF_HTML",
  "GALLERY_HTML",
  "FAQ_HTML",
  "CONTACT_ACTION_HTML",
  "CONTACT_DETAILS_HTML",
  "FOOTER_LINKS_HTML"
]);

const COLOR_KEYS = new Set([
  "PRIMARY_COLOR",
  "BACKGROUND_COLOR",
  "SURFACE_COLOR",
  "TEXT_COLOR",
  "MUTED_COLOR",
  "ACCENT_COLOR",
  "PRIMARY_BUTTON_TEXT"
]);
const URL_KEYS = new Set(["PRIMARY_CTA_HREF", "SECONDARY_CTA_HREF"]);
const VOID_TAGS = new Set(["br", "img", "input", "source"]);
const BOOLEAN_ATTRIBUTES = new Set(["hidden", "required", "selected", "open", "multiple"]);
const SAFE_CLASSES = new Set([
  "service-card",
  "stat",
  "stat-card",
  "process-step",
  "proof-card",
  "gallery-card",
  "visual-direction",
  "contact-form",
  "form-field",
  "form-wide",
  "form-status",
  "btn",
  "btn-primary",
  "btn-secondary"
]);
const SUPPORTED_FORM_CONTROL_NAMES = new Set([
  "form-name",
  "bot-field",
  "name",
  "email",
  "phone",
  "project_details"
]);
const LEAD_DISCLOSURE_HTML = '<p class="form-status" role="note">By submitting this form, you agree that this business may contact you about your request. Do not include sensitive personal, medical, legal, or financial information.</p>';

const commonTextTags = ["span", "strong", "em", "small", "p", "br"];
const cardTags = [...commonTextTags, "article", "div", "h3", "ul", "ol", "li"];
const mediaTags = ["img", "picture", "source", "figure", "figcaption", "div", "span"];
const TAGS_BY_KEY = Object.freeze({
  LOGO_HTML: new Set(["img"]),
  TRUST_LINE_HTML: new Set(commonTextTags),
  HERO_MEDIA_HTML: new Set(mediaTags),
  HERO_CHIPS_HTML: new Set(["span", "strong", "em", "small"]),
  TICKER_HTML: new Set(["span", "strong", "em", "small"]),
  SERVICES_HTML: new Set(cardTags),
  DIFFERENTIATORS_HTML: new Set(cardTags),
  ABOUT_BODY: new Set([...commonTextTags, "div", "ul", "ol", "li", "a"]),
  ABOUT_STATS_HTML: new Set(cardTags),
  ABOUT_MEDIA_HTML: new Set(mediaTags),
  PROCESS_HTML: new Set(cardTags),
  PROOF_HTML: new Set(cardTags),
  GALLERY_HTML: new Set(mediaTags),
  FAQ_HTML: new Set([...commonTextTags, "details", "summary", "div", "ul", "ol", "li"]),
  CONTACT_ACTION_HTML: new Set([
    ...commonTextTags,
    "div",
    "form",
    "input",
    "textarea",
    "select",
    "option",
    "label",
    "button",
    "a"
  ]),
  CONTACT_DETAILS_HTML: new Set([...commonTextTags, "div", "ul", "ol", "li", "a"]),
  FOOTER_LINKS_HTML: new Set(["a", "span", "strong", "nav", "ul", "li"])
});

const ATTRIBUTES_BY_TAG = Object.freeze({
  a: new Set(["href", "class", "target", "rel", "aria-label", "title"]),
  article: new Set(["class", "aria-label"]),
  button: new Set(["type", "class", "aria-label"]),
  details: new Set(["open", "class"]),
  div: new Set(["class", "aria-label", "role", "hidden"]),
  figcaption: new Set(["class"]),
  figure: new Set(["class"]),
  form: new Set(["name", "method", "data-netlify", "netlify-honeypot", "action", "class", "aria-label"]),
  h3: new Set(["class"]),
  img: new Set(["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding", "fetchpriority", "referrerpolicy", "class"]),
  input: new Set(["type", "name", "value", "autocomplete", "placeholder", "required", "hidden", "minlength", "maxlength", "class", "aria-label"]),
  label: new Set(["for", "class"]),
  li: new Set(["class"]),
  nav: new Set(["class", "aria-label"]),
  ol: new Set(["class"]),
  option: new Set(["value", "selected"]),
  p: new Set(["class", "hidden", "role", "aria-label"]),
  picture: new Set(["class"]),
  select: new Set(["name", "autocomplete", "required", "multiple", "class", "aria-label"]),
  small: new Set(["class"]),
  source: new Set(["src", "srcset", "sizes", "type", "media"]),
  span: new Set(["class", "aria-label", "aria-hidden", "role"]),
  strong: new Set(["class"]),
  summary: new Set(["class"]),
  textarea: new Set(["name", "autocomplete", "placeholder", "required", "minlength", "maxlength", "rows", "cols", "class", "aria-label"]),
  ul: new Set(["class"])
});

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeUrlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(colon|tab|newline|amp|quot|apos|lt|gt);/gi, (_, name) => ({
      colon: ":",
      tab: "\t",
      newline: "\n",
      amp: "&",
      quot: '"',
      apos: "'",
      lt: "<",
      gt: ">"
    })[name.toLowerCase()]);
}

function normalizedMediaUrl(value) {
  try {
    const url = new URL(decodeUrlEntities(value));
    return url.toString();
  } catch {
    return "";
  }
}

function safeNavigationUrl(value, { image = false, action = false } = {}) {
  const decoded = decodeUrlEntities(clean(value));
  const compact = decoded.replace(/[\u0000-\u0020\u007f]+/g, "");
  if (!compact || compact.includes("<") || compact.includes(">") || compact.includes('"') || compact.includes("'")) {
    throw new Error("ARC_CONTENT_UNSAFE: malformed URL attribute");
  }
  if (action) {
    if (!/^\/(?![\\/])[^\\\s]*$/.test(compact)) throw new Error("ARC_CONTENT_UNSAFE: form action must stay same-origin");
    return compact;
  }
  if (!image && /^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(compact)) return compact;
  if (!image && /^\/(?![\\/])[^\\\s]*$/.test(compact)) return compact;
  if (!image && /^tel:\+?[0-9(). -]{5,32}$/i.test(decoded)) return decoded;
  if (!image && /^mailto:[^\s@]+@[^\s@]+\.[^\s@?]+(?:\?[^\s]*)?$/i.test(decoded)) return decoded;
  let url;
  try {
    url = new URL(compact);
  } catch {
    throw new Error("ARC_CONTENT_UNSAFE: unsupported URL");
  }
  if (!new Set(image ? ["https:"] : ["https:", "http:"]).has(url.protocol) || url.username || url.password || (image && url.hash)) {
    throw new Error("ARC_CONTENT_UNSAFE: unsafe URL scheme or credentials");
  }
  if (!image && url.hostname.toLowerCase() === "buy.stripe.com") {
    throw new Error("ARC_CONTENT_UNSAFE: generated content cannot contain an ARC checkout link");
  }
  return url.toString();
}

function ensureApprovedImage(value, approvedImageUrls) {
  const safe = safeNavigationUrl(value, { image: true });
  const normalized = normalizedMediaUrl(safe);
  if (!normalized || !approvedImageUrls.has(normalized)) {
    throw new Error("ARC_CONTENT_UNSAFE: image source is not an approved upload");
  }
  return safe;
}

function parseAttributes(source) {
  const attributes = [];
  let remaining = source.trim();
  while (remaining) {
    const nameMatch = remaining.match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)/);
    if (!nameMatch) throw new Error("ARC_CONTENT_UNSAFE: malformed HTML attribute");
    const name = nameMatch[1].toLowerCase();
    remaining = remaining.slice(nameMatch[0].length).trimStart();
    let value = null;
    if (remaining.startsWith("=")) {
      remaining = remaining.slice(1).trimStart();
      const quote = remaining[0];
      if (quote !== '"' && quote !== "'") throw new Error("ARC_CONTENT_UNSAFE: attributes must be quoted");
      const end = remaining.indexOf(quote, 1);
      if (end < 0) throw new Error("ARC_CONTENT_UNSAFE: unterminated HTML attribute");
      value = remaining.slice(1, end);
      remaining = remaining.slice(end + 1).trimStart();
    }
    attributes.push({ name, value });
  }
  return attributes;
}

function attributeMapForCanonicalTag(tag, tagName) {
  const match = tag.match(new RegExp(`^<${tagName}\\b([\\s\\S]*?)>$`, "i"));
  if (!match) throw new Error("ARC_CONTENT_UNSAFE: malformed canonical form control");
  return new Map(parseAttributes(match[1]).map(attribute => [attribute.name, attribute.value === null ? attribute.name : attribute.value]));
}

export function validateGeneratedFormContract(markup) {
  const forms = markup.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const formOpenings = markup.match(/<form\b[^>]*>/gi) || [];
  const controls = markup.match(/<(?:input|textarea|select|button)\b[^>]*>/gi) || [];
  if (!formOpenings.length) {
    if (controls.length) throw new Error("ARC_CONTENT_UNSAFE: generated controls require one Netlify form");
    return;
  }
  if (forms.length !== 1 || formOpenings.length !== 1) {
    throw new Error("ARC_CONTENT_UNSAFE: exactly one generated Netlify form is allowed");
  }
  const formBlock = forms[0];
  if (!formBlock.includes(LEAD_DISCLOSURE_HTML)) {
    throw new Error("ARC_CONTENT_UNSAFE: exact visible lead privacy disclosure is required");
  }
  const outside = markup.replace(formBlock, "");
  if (/<(?:input|textarea|select|button)\b/i.test(outside)) {
    throw new Error("ARC_CONTENT_UNSAFE: generated form controls escaped the form");
  }
  const formAttributes = attributeMapForCanonicalTag(formOpenings[0], "form");
  const formName = clean(formAttributes.get("name"));
  const honeypotName = clean(formAttributes.get("netlify-honeypot"));
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,58}-lead$/.test(formName) ||
      formAttributes.get("method") !== "POST" ||
      formAttributes.get("data-netlify") !== "true" ||
      formAttributes.get("action") !== "/?submitted=1" ||
      honeypotName !== "bot-field") {
    throw new Error("ARC_CONTENT_UNSAFE: exact Netlify form attributes are required");
  }
  const namedControls = [];
  for (const tag of formBlock.match(/<(?:input|textarea|select|button)\b[^>]*>/gi) || []) {
    const tagName = tag.match(/^<([a-z]+)/i)?.[1].toLowerCase();
    const attributes = attributeMapForCanonicalTag(tag, tagName);
    const name = clean(attributes.get("name"));
    if (name) namedControls.push({ tagName, name, attributes });
  }
  const names = namedControls.map(control => control.name);
  if (new Set(names).size !== names.length) {
    throw new Error("ARC_CONTENT_UNSAFE: duplicate generated form control name");
  }
  if (names.some(name => !SUPPORTED_FORM_CONTROL_NAMES.has(name)) ||
      [...SUPPORTED_FORM_CONTROL_NAMES].some(name => !names.includes(name))) {
    throw new Error("ARC_CONTENT_UNSAFE: generated form controls must match the supported lead schema");
  }
  const formNameControls = namedControls.filter(control => control.name === "form-name");
  if (formNameControls.length !== 1 || formNameControls[0].tagName !== "input" ||
      clean(formNameControls[0].attributes.get("type")).toLowerCase() !== "hidden" ||
      clean(formNameControls[0].attributes.get("value")) !== formName) {
    throw new Error("ARC_CONTENT_UNSAFE: hidden form-name must uniquely match the Netlify form name");
  }
  const control = name => namedControls.find(item => item.name === name);
  const type = name => clean(control(name)?.attributes.get("type")).toLowerCase();
  const required = name => control(name)?.attributes.has("required");
  const submitButtons = formBlock.match(/<button\b[^>]*type="submit"[^>]*>/gi) || [];
  if (control(honeypotName)?.tagName !== "input" || !new Set(["", "text"]).has(type(honeypotName)) ||
      control("name")?.tagName !== "input" || type("name") !== "text" || !required("name") ||
      control("email")?.tagName !== "input" || type("email") !== "email" || !required("email") ||
      control("phone")?.tagName !== "input" || type("phone") !== "tel" ||
      control("project_details")?.tagName !== "textarea" || !required("project_details") ||
      submitButtons.length !== 1) {
    throw new Error("ARC_CONTENT_UNSAFE: generated form controls do not match the supported lead schema");
  }
}

function sanitizedAttribute(tag, name, value, context) {
  if (name === "style" || name.startsWith("on") || name === "srcdoc") {
    throw new Error(`ARC_CONTENT_UNSAFE: forbidden ${name} attribute`);
  }
  if (!ATTRIBUTES_BY_TAG[tag]?.has(name)) {
    throw new Error(`ARC_CONTENT_UNSAFE: ${name} is not allowed on <${tag}>`);
  }
  if (BOOLEAN_ATTRIBUTES.has(name)) {
    if (value !== null && clean(value).toLowerCase() !== name) {
      throw new Error(`ARC_CONTENT_UNSAFE: malformed boolean ${name} attribute`);
    }
    return name;
  }
  if (value === null) throw new Error(`ARC_CONTENT_UNSAFE: ${name} requires a value`);
  let next = clean(value);
  if (name === "class") {
    const classes = next.split(/\s+/).filter(Boolean);
    if (!classes.length || classes.some(item => !SAFE_CLASSES.has(item) || item.startsWith("arc-"))) {
      throw new Error("ARC_CONTENT_UNSAFE: generated class is not allowlisted");
    }
    next = classes.join(" ");
  } else if (name === "href") {
    next = safeNavigationUrl(next);
  } else if (name === "src") {
    next = ensureApprovedImage(next, context.approvedImageUrls);
  } else if (name === "srcset") {
    const candidates = next.split(",").map(item => item.trim()).filter(Boolean);
    if (!candidates.length) throw new Error("ARC_CONTENT_UNSAFE: empty srcset");
    next = candidates.map(candidate => {
      const match = candidate.match(/^(\S+)(?:\s+([1-9]\d*(?:\.\d+)?[wx]))?$/);
      if (!match) throw new Error("ARC_CONTENT_UNSAFE: malformed srcset candidate");
      const url = ensureApprovedImage(match[1], context.approvedImageUrls);
      return `${url}${match[2] ? ` ${match[2]}` : ""}`;
    }).join(", ");
  } else if (name === "action") {
    next = safeNavigationUrl(next, { action: true });
  } else if (name === "method") {
    if (next.toUpperCase() !== "POST") throw new Error("ARC_CONTENT_UNSAFE: forms must use POST");
    next = "POST";
  } else if (name === "data-netlify") {
    if (next.toLowerCase() !== "true") throw new Error("ARC_CONTENT_UNSAFE: data-netlify must be true");
    next = "true";
  } else if (name === "type") {
    const allowed = tag === "input"
      ? new Set(["hidden", "text", "email", "tel"])
      : tag === "button"
        ? new Set(["submit", "button"])
        : tag === "source"
          ? null
          : new Set();
    if (allowed && !allowed.has(next.toLowerCase())) throw new Error(`ARC_CONTENT_UNSAFE: unsupported ${tag} type`);
    if (tag === "source" && !/^image\/(?:avif|webp|png|jpeg)$/i.test(next)) {
      throw new Error("ARC_CONTENT_UNSAFE: unsupported source media type");
    }
    next = next.toLowerCase();
  } else if (["name", "for", "netlify-honeypot"].includes(name)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(next)) throw new Error(`ARC_CONTENT_UNSAFE: malformed ${name}`);
  } else if (["width", "height", "minlength", "maxlength", "rows", "cols"].includes(name)) {
    if (!/^\d{1,4}$/.test(next)) throw new Error(`ARC_CONTENT_UNSAFE: malformed numeric ${name}`);
  } else if (name === "loading" && !new Set(["lazy", "eager"]).has(next.toLowerCase())) {
    throw new Error("ARC_CONTENT_UNSAFE: unsupported image loading mode");
  } else if (name === "decoding" && !new Set(["async", "sync", "auto"]).has(next.toLowerCase())) {
    throw new Error("ARC_CONTENT_UNSAFE: unsupported image decoding mode");
  } else if (name === "fetchpriority" && !new Set(["high", "low", "auto"]).has(next.toLowerCase())) {
    throw new Error("ARC_CONTENT_UNSAFE: unsupported image fetch priority");
  } else if (name === "referrerpolicy" && next.toLowerCase() !== "no-referrer") {
    throw new Error("ARC_CONTENT_UNSAFE: unsupported image referrer policy");
  } else if (name === "target" && !new Set(["_blank", "_self"]).has(next.toLowerCase())) {
    throw new Error("ARC_CONTENT_UNSAFE: unsupported link target");
  } else if (name === "rel") {
    const rel = next.toLowerCase().split(/\s+/).filter(Boolean);
    if (!rel.length || rel.some(item => !new Set(["noopener", "noreferrer", "nofollow"]).has(item))) {
      throw new Error("ARC_CONTENT_UNSAFE: unsupported link relationship");
    }
    next = [...new Set(rel)].join(" ");
  } else if (name === "aria-hidden" && !new Set(["true", "false"]).has(next.toLowerCase())) {
    throw new Error("ARC_CONTENT_UNSAFE: aria-hidden must be true or false");
  } else if (name === "role" && !new Set(["group", "note", "status"]).has(next.toLowerCase())) {
    throw new Error("ARC_CONTENT_UNSAFE: unsupported generated role");
  } else if (["sizes", "media"].includes(name) && (!next || next.length > 300 || /[<>"']/.test(next))) {
    throw new Error(`ARC_CONTENT_UNSAFE: malformed ${name}`);
  }
  return `${name}="${escapeHtml(next)}"`;
}

export function sanitizeStructuredMarkup(key, markup, options = {}) {
  const allowedTags = TAGS_BY_KEY[key];
  if (!allowedTags) throw new Error(`ARC_CONTENT_UNSAFE: ${key} is not a structured-markup field`);
  const imageUrls = key === "LOGO_HTML"
    ? [options.approvedLogoUrl]
    : [options.heroImageUrl, options.supportingImageUrl];
  const context = {
    approvedImageUrls: new Set(imageUrls.filter(Boolean).map(normalizedMediaUrl).filter(Boolean))
  };
  const input = clean(markup);
  if (!input) return "";
  let output = "";
  let position = 0;
  const stack = [];
  while (position < input.length) {
    const start = input.indexOf("<", position);
    if (start < 0) {
      output += escapeHtml(input.slice(position));
      break;
    }
    output += escapeHtml(input.slice(position, start));
    if (input.startsWith("<!--", start) || input.startsWith("<!", start) || input.startsWith("<?", start)) {
      throw new Error("ARC_CONTENT_UNSAFE: comments and declarations are not allowed in generated markup");
    }
    let quote = "";
    let end = -1;
    for (let index = start + 1; index < input.length; index += 1) {
      const char = input[index];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        end = index;
        break;
      }
    }
    if (end < 0 || quote) throw new Error("ARC_CONTENT_UNSAFE: unterminated generated HTML tag");
    const token = input.slice(start, end + 1);
    const parsed = token.match(/^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)([\s\S]*?)>$/);
    if (!parsed) throw new Error("ARC_CONTENT_UNSAFE: malformed generated HTML tag");
    const closing = Boolean(parsed[1]);
    const tag = parsed[2].toLowerCase();
    let attributeSource = parsed[3].trim();
    const selfClosing = !closing && attributeSource.endsWith("/");
    if (selfClosing) attributeSource = attributeSource.slice(0, -1).trim();
    if (!allowedTags.has(tag)) throw new Error(`ARC_CONTENT_UNSAFE: <${tag}> is not allowed in ${key}`);
    if (closing) {
      if (attributeSource) throw new Error("ARC_CONTENT_UNSAFE: closing tags cannot have attributes");
      if (VOID_TAGS.has(tag) || stack.pop() !== tag) throw new Error("ARC_CONTENT_UNSAFE: generated HTML nesting is invalid");
      output += `</${tag}>`;
    } else {
      const attributes = parseAttributes(attributeSource);
      const names = new Set();
      const rendered = attributes.map(attribute => {
        if (names.has(attribute.name)) throw new Error("ARC_CONTENT_UNSAFE: duplicate HTML attribute");
        names.add(attribute.name);
        return sanitizedAttribute(tag, attribute.name, attribute.value, context);
      });
      if (tag === "a") {
        const target = attributes.find(attribute => attribute.name === "target");
        if (clean(target?.value).toLowerCase() === "_blank" && !names.has("rel")) {
          rendered.push('rel="noopener noreferrer"');
        }
      }
      output += `<${tag}${rendered.length ? ` ${rendered.join(" ")}` : ""}>`;
      if (!VOID_TAGS.has(tag) && selfClosing) output += `</${tag}>`;
      else if (!VOID_TAGS.has(tag)) stack.push(tag);
    }
    position = end + 1;
  }
  if (stack.length) throw new Error("ARC_CONTENT_UNSAFE: generated HTML has unclosed tags");
  if (key === "CONTACT_ACTION_HTML") validateGeneratedFormContract(output);
  return output;
}

export function sanitizeContentForRender(content, options = {}) {
  const next = {};
  for (const [key, raw] of Object.entries(content || {})) {
    if (MARKUP_KEYS.includes(key)) {
      next[key] = sanitizeStructuredMarkup(key, raw, options);
    } else if (COLOR_KEYS.has(key)) {
      const value = clean(raw);
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`ARC_CONTENT_UNSAFE: ${key} must be a six-digit hex color`);
      next[key] = value.toLowerCase();
    } else if (URL_KEYS.has(key)) {
      next[key] = escapeHtml(safeNavigationUrl(raw));
    } else {
      next[key] = escapeHtml(clean(raw));
    }
  }
  return next;
}
