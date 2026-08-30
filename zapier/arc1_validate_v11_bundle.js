// ARC1 Step 7 — fail-closed V11 five-page bundle validator.
// This step consumes only arc1_inject.js bundle outputs. It never publishes,
// emails, creates checkout, or returns private recipient data.
const clean = value => String(value == null ? "" : value).trim();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
for (const legacy of ["html_content", "file_path", "preview_path", "html_character_count"]) {
  if (own(inputData, legacy)) throw new Error(`ARC_V11_VALIDATION_FAILED: legacy singular input ${legacy} is forbidden`);
}
if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function" || typeof URL !== "function") {
  throw new Error("ARC_V11_VALIDATION_FAILED: crypto/runtime unavailable");
}

const encoder = new TextEncoder();
const canonicalJson = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC_V11_VALIDATION_FAILED: canonical JSON requires plain finite values");
};
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))]
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const hex64 = value => /^[a-f0-9]{64}$/.test(clean(value).toLowerCase());
const exactKeys = (value, fields, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${label} fields`);
  }
};
const parseCanonical = (rawValue, label, maximumBytes = 1_200_000) => {
  const raw = String(rawValue == null ? "" : rawValue);
  if (!raw || encoder.encode(raw).byteLength > maximumBytes) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${label} size`);
  }
  let value;
  try { value = JSON.parse(raw); } catch {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${label} JSON`);
  }
  if (canonicalJson(value) !== raw) throw new Error(`ARC_V11_VALIDATION_FAILED: ${label} canonical JSON`);
  return { raw, value };
};

const decodePrivacyEntities = value => String(value == null ? "" : value)
  .replace(/&#(\d+);?/g, (_, code) => {
    const point = Number(code);
    return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  })
  .replace(/&#x([0-9a-f]+);?/gi, (_, code) => {
    const point = Number.parseInt(code, 16);
    return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  })
  .replace(/&(amp|quot|apos|lt|gt|colon|sol|period|commat|percnt|num|tab|newline);/gi, (_, name) => ({
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", sol: "/", period: ".",
    commat: "@", percnt: "%", num: "#", tab: "\t", newline: "\n"
  })[name.toLowerCase()]);
const decodePercentBytes = value => String(value).replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
  try { return decodeURIComponent(encoded); } catch {
    return encoded.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
});
const recursivelyDecode = value => {
  let current = String(value == null ? "" : value);
  for (let pass = 0; pass < 5; pass += 1) {
    let next = decodePrivacyEntities(current).replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/[\u3002\uff0e\uff61]/g, ".");
    next = decodePercentBytes(next.replace(/\+/g, "%20"));
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC");
};
const privacyCanonical = value => recursivelyDecode(value).toLowerCase()
  .replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const privacyCompact = value => privacyCanonical(value).replace(/[^\p{L}\p{N}@]+/gu, "");
const assertPrivateValuesAbsent = (markup, privateValues, label) => {
  const decoded = recursivelyDecode(markup);
  const text = recursivelyDecode(decoded.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const urlSurfaces = [...decoded.matchAll(/\b(?:href|src|srcset|action|content|style)\s*=\s*["']([^"']*)["']/gi)]
    .map(match => recursivelyDecode(match[1]));
  const surfaces = [decoded, text, ...urlSurfaces].map(value => ({
    canonical: privacyCanonical(value), compact: privacyCompact(value)
  }));
  for (const item of privateValues) {
    const canonical = privacyCanonical(item.value);
    if (!canonical) continue;
    const compact = privacyCompact(canonical);
    if (surfaces.some(surface => surface.canonical.includes(canonical) ||
        (compact.length >= 7 && surface.compact.includes(compact)))) {
      throw new Error(`ARC_V11_PRIVACY_FAILED: ${label} contains private ${item.label}`);
    }
  }
};
const assertNoCheckoutCapability = (markup, label) => {
  const decoded = recursivelyDecode(markup).toLowerCase();
  const compact = decoded.replace(/[\s\u0000-\u001f\u007f]+/g, "");
  const nonScriptMarkup = String(markup).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const forbidden = /buy\.stripe\.com|\bplink_[a-z0-9]+|client_reference_id|arc-checkout-config|v[34]_[a-z0-9_-]{135}|arc-checkout-offer-snapshot-v[12]|arc1-checkout-recipient-reservation-v[12]|arc1-preview-readiness-(?:core|observation)-v[12]|arc-private-checkout-(?:policy|link-intent|link-receipt|link-reverse)-v[12]|checkout_(?:binding|offer|recipient|readiness)|link_receipt_(?:private|hmac|sha256)/i;
  if (/&(?!(?:amp|quot|apos|lt|gt);)[a-z][a-z0-9]+;/i.test(nonScriptMarkup) ||
      /\p{Default_Ignorable_Code_Point}/u.test(nonScriptMarkup) || forbidden.test(decoded) ||
      forbidden.test(compact) || /<[A-Za-z][^>]*(?:\s|\/)on[a-z0-9_-]+\s*=/i.test(String(markup))) {
    throw new Error(`ARC_V11_CHECKOUT_EXPOSURE_FAILED: ${label}`);
  }
  for (const match of String(markup).matchAll(/\b(?:href|xlink:href|action|formaction|src|srcset|poster|data|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const normalized = recursivelyDecode(raw).toLowerCase();
    let parsed;
    try { parsed = new URL(normalized, "https://arc.invalid/"); } catch {}
    const host = parsed?.hostname?.toLowerCase() || "";
    if (/%(?![0-9a-f]{2})/i.test(raw) || /\p{Default_Ignorable_Code_Point}/u.test(normalized) ||
        host === "buy.stripe.com" || host.endsWith(".buy.stripe.com") ||
        new Set(["javascript:", "vbscript:"]).has(parsed?.protocol) || forbidden.test(normalized) ||
        forbidden.test(normalized.replace(/[\s\u0000-\u001f\u007f]+/g, ""))) {
      throw new Error(`ARC_V11_CHECKOUT_EXPOSURE_FAILED: ${label}`);
    }
  }
};
const assertNoRemoteRuntimeDependencies = (markup, receiptUrls) => {
  const allowed = new Set(receiptUrls);
  const decode = value => recursivelyDecode(value).replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  const remote = value => /^(?:https?:)?\/\//i.test(decode(value));
  const safeLocal = value => {
    const decoded = decode(value);
    return /^\/(?!\/)[^\\\s]*$/.test(decoded) || /^\.?\.\/(?!\/)[^\\\s:]*$/.test(decoded) ||
      /^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=@%/-]*$/.test(decoded);
  };
  for (const tag of markup.match(/<[A-Za-z][^>]*>/g) || []) {
    const tagName = tag.match(/^<\s*([A-Za-z][A-Za-z0-9:-]*)/)?.[1].toLowerCase() || "";
    const attributes = [...tag.matchAll(/\b(srcset|src|poster|data|action|href|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)];
    const declared = (tag.match(/\b(?:srcset|src|poster|data|action|href|style)\s*=/gi) || []).length;
    if (attributes.length !== declared) throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: malformed URL attribute");
    for (const match of attributes) {
      const attribute = match[1].toLowerCase();
      const raw = match[2] ?? match[3] ?? match[4] ?? "";
      if (attribute === "style") {
        if (/\\|@import\b|url\s*\(/i.test(decode(raw))) throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: unsafe inline CSS resource");
        continue;
      }
      if (attribute === "href") {
        if (tagName === "a") {
          const href = decode(raw);
          let external = false;
          if (/^https?:\/\//i.test(href)) {
            try {
              const url = new URL(href);
              external = !url.username && !url.password && new Set(["http:", "https:"]).has(url.protocol);
            } catch {}
          }
          if (!external && !safeLocal(href) && !/^#[A-Za-z0-9_.:-]*$/.test(href) &&
              !/^tel:\+?[0-9(). -]{5,32}$/i.test(href) &&
              !/^mailto:[^\s@]+@[^\s@]+\.[^\s@?]+(?:\?[^\s]*)?$/i.test(href)) {
            throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: unsafe navigation URL");
          }
          continue;
        }
        if (remote(raw)) throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: remote subresource");
        continue;
      }
      if (attribute === "action") {
        if (!safeLocal(raw)) throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: form action must remain same-origin");
        continue;
      }
      const values = attribute === "srcset"
        ? decode(raw).split(",").map(candidate => candidate.trim().split(/\s+/, 1)[0]).filter(Boolean)
        : [decode(raw)];
      if (!values.length) throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: empty resource URL");
      for (const value of values) {
        if (remote(value)) {
          if (!new Set(["img", "source"]).has(tagName) || !new Set(["src", "srcset"]).has(attribute) || !allowed.has(value)) {
            throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: unreceipted remote resource");
          }
        } else if (!safeLocal(value)) {
          throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: unsafe local resource");
        }
      }
    }
    if (tagName === "base" || tagName === "meta" && /\bhttp-equiv\s*=\s*["']?refresh/i.test(tag)) {
      throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: navigation primitive");
    }
  }
  for (const style of markup.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []) {
    if (/\\|@import\b|url\s*\(/i.test(style)) throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: CSS resource primitive");
  }
  const scripts = (markup.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join("\n");
  const forbiddenScript = [
    /\bfetch\s*\(/i, /\bXMLHttpRequest\b/i, /\bWebSocket\s*\(/i, /\bEventSource\s*\(/i,
    /\bsendBeacon\s*\(/i, /\bserviceWorker\b/i, /\bimportScripts\s*\(/i, /\bnew\s+Image\s*\(/i,
    /\.(?:src|srcset|poster|href|action)\s*=/i, /\.setAttribute\s*\(\s*["'](?:src|srcset|poster|href|action)["']/i,
    /\bwindow\.open\s*\(/i, /(?:\bwindow\.|\bdocument\.)?location(?:\.href)?\s*=/i,
    /(?:\bwindow\.|\bdocument\.)?location\.(?:assign|replace)\s*\(/i
  ];
  if (forbiddenScript.some(pattern => pattern.test(scripts))) {
    throw new Error("ARC_V11_RUNTIME_DEPENDENCY_FAILED: executable network or navigation primitive");
  }
};

const requiredGeneratedKeys = [
  "SEO_TITLE", "SEO_DESCRIPTION", "PRIMARY_COLOR", "BACKGROUND_COLOR", "SURFACE_COLOR", "TEXT_COLOR", "MUTED_COLOR", "ACCENT_COLOR",
  "PRIMARY_BUTTON_TEXT", "STYLE_MODE", "BUSINESS_NAME", "LOGO_HTML", "PRIMARY_CTA_HREF", "PRIMARY_CTA_LABEL", "EYEBROW", "HEADLINE",
  "SUBHEADLINE", "SECONDARY_CTA_HREF", "SECONDARY_CTA_LABEL", "TRUST_LINE_HTML", "HERO_MEDIA_HTML", "INDUSTRY_LABEL", "LOCATION",
  "VISUAL_HEADLINE", "HERO_CHIPS_HTML", "HIGHEST_PROFIT_SERVICE", "HERO_PROOF_LINE", "TICKER_HTML", "SERVICES_HEADING", "SERVICES_INTRO",
  "SERVICES_HTML", "WHY_HEADING", "WHY_INTRO", "DIFFERENTIATORS_HTML", "ABOUT_TITLE", "ABOUT_BODY", "ABOUT_STATS_HTML", "ABOUT_MEDIA_HTML",
  "ABOUT_EYEBROW", "ABOUT_QUOTE", "PROCESS_HEADING", "PROCESS_INTRO", "PROCESS_HTML", "PROOF_HEADING", "PROOF_INTRO", "PROOF_HTML",
  "GALLERY_HEADING", "GALLERY_INTRO", "GALLERY_HTML", "FAQ_HEADING", "FAQ_INTRO", "FAQ_HTML", "CONTACT_HEADING", "CONTACT_BODY",
  "CONTACT_ACTION_HTML", "CONTACT_DETAILS_HTML", "FOOTER_TAGLINE", "FOOTER_LINKS_HTML"
];
let generated;
try { generated = JSON.parse(clean(inputData.raw_json)); } catch {
  throw new Error("ARC_V11_VALIDATION_FAILED: raw_json JSON");
}
exactKeys(generated, requiredGeneratedKeys, "raw_json");
if (Object.values(generated).some(value => typeof value !== "string")) {
  throw new Error("ARC_V11_VALIDATION_FAILED: raw_json requires exactly 58 strings");
}

const logicalPaths = ["index.html", "services/index.html", "about/index.html", "process/index.html", "contact/index.html"];
const artifactPaths = ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"];
const pageKeys = ["home", "services", "about", "process", "contact"];
const pageLabels = ["Home", "Services", "About", "Process", "Contact"];
const pagesBaseUrl = "https://arcwebhq-cpu.github.io/arc-previews";
const previewCsp = "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const productionCsp = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; script-src-attr 'none'; connect-src 'none'; font-src 'self' data:; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const toolbar = '<aside class="arc-preview-toolbar" aria-label="ARC preview status"><span><strong>ARC preview</strong>Five-page website concept for this business.</span><span data-arc-checkout-private>Review and payment are available through your private review link.</span></aside>';
const trustedScriptHash = "36441ce93ccc1f13622e64f34ba6e43a039cdb453e1f40010dd8c399c97751f4";
const trustedScriptManifest = "1ef7f0088cdcf042b1593fbc11d7ea2d3c47e9ff92c94caf2f578179e3993685";

const { raw: bundleRaw, value: bundle } = parseCanonical(inputData.render_bundle_private, "render bundle");
exactKeys(bundle, [
  "approval_manifest", "approval_manifest_sha256", "deliverable", "lead_route_form_name", "lead_route_mode", "logical_page_paths",
  "offer_contract_id", "page_count", "pages", "preview_folder", "preview_paths", "production_content_sha256",
  "published_preview_bundle_sha256", "published_preview_manifest", "runtime_version", "scope", "site_contract_version", "template_version", "version"
], "render bundle");
const bundleSha = await sha256(bundleRaw);
const previewFolder = clean(bundle.preview_folder).toLowerCase();
const suffix = previewFolder.match(/-([a-f0-9]{8})$/)?.[1] || "";
const previewPaths = artifactPaths.map(path => `${previewFolder}/${path}`);
if (bundleSha !== clean(inputData.render_bundle_sha256).toLowerCase() ||
    bundle.version !== "arc1-five-page-render-bundle-v1" || bundle.scope !== "private-sanitized-five-page-preview-render" ||
    bundle.runtime_version !== "arc1-inject-v11-render-runtime-v1" || bundle.site_contract_version !== "arc-five-page-site-v1" ||
    bundle.template_version !== "11.0" || bundle.offer_contract_id !== "arc-fixed-five-page-offer-v1" ||
    bundle.deliverable !== "fixed-five-page-marketing-website-v1" || bundle.page_count !== 5 ||
    !/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/.test(previewFolder) || !suffix ||
    canonicalJson(bundle.logical_page_paths) !== canonicalJson(logicalPaths) ||
    canonicalJson(bundle.preview_paths) !== canonicalJson(previewPaths) ||
    ![bundle.approval_manifest_sha256, bundle.published_preview_bundle_sha256, bundle.production_content_sha256].every(hex64)) {
  throw new Error("ARC_V11_VALIDATION_FAILED: exact V11 five-page bundle binding");
}
if (clean(inputData.preview_folder).toLowerCase() !== previewFolder ||
    clean(inputData.trusted_event_prefix).toLowerCase() !== suffix || Number(inputData.page_count) !== 5 ||
    clean(inputData.offer_contract_id) !== bundle.offer_contract_id || clean(inputData.deliverable) !== bundle.deliverable ||
    clean(inputData.preview_url) !== `${pagesBaseUrl}/${previewFolder}/` ||
    clean(inputData.template_comment) !== "ARC Client Master Template v11.0" || Number(inputData.template_placeholder_count) !== 24 ||
    Number(inputData.final_placeholder_count) !== 0 || clean(inputData.script_manifest_sha256).toLowerCase() !== trustedScriptManifest) {
  throw new Error("ARC_V11_VALIDATION_FAILED: injector output binding");
}
const logicalOutput = parseCanonical(inputData.logical_page_paths_json, "logical page paths", 2_000).value;
const previewOutput = parseCanonical(inputData.preview_paths_json, "preview paths", 4_000).value;
if (canonicalJson(logicalOutput) !== canonicalJson(logicalPaths) || canonicalJson(previewOutput) !== canonicalJson(previewPaths) ||
    (Array.isArray(inputData.preview_paths) && canonicalJson(inputData.preview_paths) !== canonicalJson(previewPaths))) {
  throw new Error("ARC_V11_VALIDATION_FAILED: output path set");
}

const manifestContext = parseCanonical(inputData.validated_asset_manifest, "validated asset manifest", 100_000);
if (!Array.isArray(manifestContext.value) || manifestContext.value.length > 3) {
  throw new Error("ARC_V11_VALIDATION_FAILED: asset manifest shape");
}
const assetManifest = manifestContext.value;
const assetMapContext = parseCanonical(inputData.public_asset_url_map_json, "public asset URL map", 20_000);
if (!assetMapContext.value || typeof assetMapContext.value !== "object" || Array.isArray(assetMapContext.value)) {
  throw new Error("ARC_V11_VALIDATION_FAILED: public asset URL map shape");
}
const assetMap = assetMapContext.value;
const roleOrder = ["hero_image_file", "logo_file", "supporting_image_file"];
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
let lastRole = -1;
const receiptUrls = new Set();
const productionAssetPathByUrl = new Map();
for (const entry of assetManifest) {
  exactKeys(entry, ["asset_id", "content_type", "kind", "retrieval_endpoint_sha256", "role", "sha256", "size_bytes"], "asset manifest entry");
  const roleIndex = roleOrder.indexOf(entry.role);
  const extension = extensions[entry.content_type];
  if (entry.kind !== "UPLOAD" || roleIndex <= lastRole || !extension || !hex64(entry.asset_id) ||
      !hex64(entry.retrieval_endpoint_sha256) || !hex64(entry.sha256) || !Number.isSafeInteger(entry.size_bytes) ||
      entry.size_bytes < 1 || entry.size_bytes > 1_250_000) {
    throw new Error("ARC_V11_VALIDATION_FAILED: asset manifest entry binding");
  }
  lastRole = roleIndex;
  const expectedUrl = `${pagesBaseUrl}/${previewFolder}/assets/${entry.sha256}.${extension}`;
  if (assetMap[entry.role] !== expectedUrl) throw new Error("ARC_V11_VALIDATION_FAILED: content-addressed asset URL binding");
  receiptUrls.add(expectedUrl);
  productionAssetPathByUrl.set(expectedUrl, `/assets/${entry.sha256}.${extension}`);
}
if (JSON.stringify(Object.keys(assetMap).sort()) !== JSON.stringify(assetManifest.map(entry => entry.role).sort()) ||
    await sha256(manifestContext.raw) !== clean(inputData.asset_manifest_sha256).toLowerCase()) {
  throw new Error("ARC_V11_VALIDATION_FAILED: asset manifest digest or role set");
}

const pageFields = [
  "approval_html", "approval_sha256", "approval_size", "key", "label", "path", "production_sha256", "production_size",
  "published_html", "published_sha256", "published_size", "repository_path", "url"
];
if (!Array.isArray(bundle.pages) || bundle.pages.length !== 5) throw new Error("ARC_V11_VALIDATION_FAILED: exactly five pages required");
const pagesByPath = new Map();
let approvalTotal = 0;
let publishedTotal = 0;
let publishedCharacterTotal = 0;
const titles = new Set();
const descriptions = new Set();
const headings = new Set();
let formCount = 0;
const renderedAssetUrls = new Set();
const plainText = value => recursivelyDecode(String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const oneMeta = (html, name) => {
  const matches = [...html.matchAll(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)">`, "gi"))];
  if (matches.length !== 1) throw new Error(`ARC_V11_VALIDATION_FAILED: exact ${name} metadata`);
  return matches[0][1];
};
const relativeHref = (fromIndex, toIndex) => {
  if (fromIndex === 0) return toIndex === 0 ? "./" : `./${pageKeys[toIndex]}/`;
  if (toIndex === 0) return "../";
  if (toIndex === fromIndex) return "./";
  return `../${pageKeys[toIndex]}/`;
};
const navigation = (pageIndex, className) => `<nav class="${className}" aria-label="${className === "nav-links" ? "Main menu" : "Footer menu"}">${pageLabels.map((label, index) =>
  `<a href="${relativeHref(pageIndex, index)}"${index === pageIndex ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;

const recipientContext = parseCanonical(inputData.checkout_recipient_reservation_private, "checkout recipient reservation", 40_000);
const recipient = recipientContext.value;
exactKeys(recipient, [
  "approval_content_sha256", "checkout_binding_key_id", "checkout_offer_snapshot_sha256", "claim_recipient_email",
  "claim_recipient_email_sha256", "deliverable", "lead_notification_email", "lead_route_form_name", "lead_route_mode",
  "lead_route_recipient_hmac_sha256", "offer_contract_id", "page_count", "preview_folder", "preview_paths",
  "production_content_sha256", "published_preview_bundle_sha256", "scope", "stripe_mode", "version"
], "checkout recipient reservation");
const privateValues = [
  { label: "requester email", value: inputData.customer_email },
  { label: "lead recipient", value: recipient.lead_notification_email },
  { label: "claim recipient", value: recipient.claim_recipient_email },
  { label: "contact phone", value: inputData.private_contact_phone },
  { label: "contact address", value: inputData.private_contact_address }
];

for (let index = 0; index < bundle.pages.length; index += 1) {
  const page = bundle.pages[index];
  exactKeys(page, pageFields, `page ${index}`);
  const pagePath = logicalPaths[index];
  const expectedUrl = `${pagesBaseUrl}/${previewFolder}/${pagePath === "index.html" ? "" : pagePath.replace(/index\.html$/, "")}`;
  if (page.key !== pageKeys[index] || page.label !== pageLabels[index] || page.path !== pagePath ||
      page.repository_path !== `${previewFolder}/${pagePath}` || page.url !== expectedUrl || pagesByPath.has(pagePath) ||
      ![page.approval_sha256, page.published_sha256, page.production_sha256].every(hex64) ||
      ![page.approval_size, page.published_size, page.production_size].every(Number.isSafeInteger) ||
      page.approval_size < 18_000 || page.approval_size > 150_000 || page.published_size < 18_000 || page.published_size > 150_000 ||
      page.production_size < 18_000 || page.production_size > 150_000 ||
      encoder.encode(page.approval_html).byteLength !== page.approval_size ||
      encoder.encode(page.published_html).byteLength !== page.published_size ||
      await sha256(page.approval_html) !== page.approval_sha256 || await sha256(page.published_html) !== page.published_sha256) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} digest/path/size binding`);
  }
  const expectedPublished = page.approval_html.replace("</body>\n</html>\n", `${toolbar}\n</body>\n</html>\n`);
  if (expectedPublished === page.approval_html || expectedPublished !== page.published_html ||
      (page.approval_html.match(/<aside class="arc-preview-toolbar"/g) || []).length !== 0 ||
      (page.published_html.match(/<aside class="arc-preview-toolbar"/g) || []).length !== 1) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} exact preview-toolbar derivation`);
  }
  for (const html of [page.approval_html, page.published_html]) {
    if (/\[\[[A-Z0-9_]+\]\]/.test(html)) throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} unresolved placeholder`);
    assertNoCheckoutCapability(html, `${pagePath} public HTML`);
    assertPrivateValuesAbsent(html, privateValues, `${pagePath} public HTML`);
    assertNoRemoteRuntimeDependencies(html, receiptUrls);
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) || [];
    if ((html.match(/<script\b/gi) || []).length !== 1 || (html.match(/<\/script\b/gi) || []).length !== 1 ||
        scripts.length !== 1 || await sha256(scripts[0]) !== trustedScriptHash || await sha256(trustedScriptHash) !== trustedScriptManifest) {
      throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} trusted script manifest`);
    }
    for (const match of recursivelyDecode(html).matchAll(/\b(?:src|srcset)\s*=\s*["']([^"']+)["']/gi)) {
      const candidates = match[0].toLowerCase().startsWith("srcset")
        ? match[1].split(",").map(item => clean(item).split(/\s+/, 1)[0]) : [clean(match[1])];
      for (const candidate of candidates) if (receiptUrls.has(candidate)) renderedAssetUrls.add(candidate);
    }
  }
  const approval = page.approval_html;
  if ((approval.match(/<!doctype html>/gi) || []).length !== 1 || (approval.match(/<html\b/gi) || []).length !== 1 ||
      (approval.match(/<head\b/gi) || []).length !== 1 || (approval.match(/<body\b/gi) || []).length !== 1 ||
      (approval.match(/<main\b/gi) || []).length !== 1 || (approval.match(/<h1\b/gi) || []).length !== 1 ||
      (approval.match(/<nav class="nav-links"/g) || []).length !== 1 ||
      (approval.match(/<nav class="footer-links"/g) || []).length !== 1 ||
      !approval.includes(navigation(index, "nav-links")) || !approval.includes(navigation(index, "footer-links")) ||
      oneMeta(approval, "robots") !== "noindex,nofollow,noarchive,nosnippet" || oneMeta(approval, "arc-template-version") !== "11.0" ||
      oneMeta(approval, "arc-site-contract") !== "arc-five-page-site-v1" || oneMeta(approval, "arc-page-key") !== page.key ||
      oneMeta(approval, "arc-page-path") !== page.path ||
      !approval.includes(`<meta http-equiv="Content-Security-Policy" content="${previewCsp}">`) ||
      !new RegExp(`<body[^>]*data-arc-site-mode="preview"[^>]*data-arc-page="${page.key}"[^>]*data-arc-expected-media-profile="${clean(inputData.expected_media_profile)}"`).test(approval)) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} document/navigation/metadata contract`);
  }
  const title = oneMeta(approval, "arc-page-title");
  const description = oneMeta(approval, "description");
  const h1 = plainText((approval.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i) || [""])[0]);
  if (!title || title.length > 70 || !description || description.length > 170 || !h1 ||
      !approval.includes(`<title>${title}</title>`) ||
      !privacyCanonical(plainText(approval)).includes(privacyCanonical(generated.BUSINESS_NAME)) ||
      !privacyCanonical(plainText(approval)).includes(privacyCanonical(generated.PRIMARY_CTA_LABEL))) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} business/CTA/SEO contract`);
  }
  titles.add(title); descriptions.add(description); headings.add(h1.toLowerCase());

  const formBlocks = approval.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  formCount += formBlocks.length;
  if (pagePath !== "contact/index.html" && formBlocks.length) {
    throw new Error("ARC_V11_VALIDATION_FAILED: lead form escaped the Contact page");
  }
  if (formBlocks.length) {
    if (formBlocks.length !== 1 || bundle.lead_route_mode !== "netlify_form" ||
        !new RegExp(`<form\\b[^>]*\\bname="${bundle.lead_route_form_name}"[^>]*>`).test(formBlocks[0]) ||
        !/\bmethod="POST"/.test(formBlocks[0]) || !/\bdata-netlify="true"/.test(formBlocks[0]) ||
        !/\bnetlify-honeypot="bot-field"/.test(formBlocks[0]) || !/\baction="\.\/\?submitted=1"/.test(formBlocks[0]) ||
        !new RegExp(`<input\\b[^>]*type="hidden"[^>]*name="form-name"[^>]*value="${bundle.lead_route_form_name}"[^>]*>`).test(formBlocks[0]) ||
        !formBlocks[0].includes('<p class="form-status" role="note">By submitting this form, you agree that this business may contact you about your request. Do not include sensitive personal, medical, legal, or financial information.</p>')) {
      throw new Error("ARC_V11_VALIDATION_FAILED: exact Contact lead-form binding");
    }
    const controlNames = [...formBlocks[0].matchAll(/<(?:input|textarea|select)\b[^>]*\bname="([^"]+)"[^>]*>/gi)].map(match => match[1]);
    if (canonicalJson([...controlNames].sort()) !== canonicalJson(["bot-field", "email", "form-name", "name", "phone", "project_details"]) ||
        new Set(controlNames).size !== controlNames.length ||
        privacyCanonical(plainText((formBlocks[0].match(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/i) || [""])[0])) !==
          privacyCanonical(generated.PRIMARY_CTA_LABEL)) {
      throw new Error("ARC_V11_VALIDATION_FAILED: Contact control or CTA contract");
    }
  }
  approvalTotal += page.approval_size;
  publishedTotal += page.published_size;
  publishedCharacterTotal += page.published_html.length;
  pagesByPath.set(pagePath, page);
}
if (approvalTotal > 500_000 || publishedTotal > 500_000 || titles.size !== 5 || descriptions.size !== 5 || headings.size !== 5 ||
    renderedAssetUrls.size !== receiptUrls.size || [...receiptUrls].some(url => !renderedAssetUrls.has(url)) ||
    (bundle.lead_route_mode === "netlify_form"
      ? formCount !== 1 || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(bundle.lead_route_form_name)
      : bundle.lead_route_mode !== "not_required" || formCount !== 0 || bundle.lead_route_form_name !== "")) {
  throw new Error("ARC_V11_VALIDATION_FAILED: whole-site quality/form/asset contract");
}
if (Number(inputData.total_published_html_character_count) !== publishedCharacterTotal ||
    clean(inputData.lead_route_mode) !== bundle.lead_route_mode || clean(inputData.lead_route_form_name) !== bundle.lead_route_form_name) {
  throw new Error("ARC_V11_VALIDATION_FAILED: aggregate or lead-route output binding");
}

const approvalManifest = {
  version: "arc-v11-approval-bundle-v1",
  pages: logicalPaths.map(path => {
    const page = pagesByPath.get(path);
    return { path, sha256: page.approval_sha256, size: page.approval_size };
  })
};
const publishedManifest = {
  version: "arc-v11-published-preview-bundle-v1",
  pages: artifactPaths.map(path => {
    const page = pagesByPath.get(path);
    return { path, sha256: page.published_sha256, size: page.published_size };
  })
};
const approvalRaw = canonicalJson(approvalManifest);
const publishedRaw = canonicalJson(publishedManifest);
if (canonicalJson(bundle.approval_manifest) !== approvalRaw || canonicalJson(bundle.published_preview_manifest) !== publishedRaw ||
    await sha256(approvalRaw) !== bundle.approval_manifest_sha256 || await sha256(publishedRaw) !== bundle.published_preview_bundle_sha256 ||
    parseCanonical(inputData.approval_manifest_private, "approval manifest", 20_000).raw !== approvalRaw ||
    parseCanonical(inputData.published_preview_manifest_private, "published preview manifest", 20_000).raw !== publishedRaw ||
    clean(inputData.approval_content_sha256).toLowerCase() !== bundle.approval_manifest_sha256 ||
    clean(inputData.published_preview_bundle_sha256).toLowerCase() !== bundle.published_preview_bundle_sha256 ||
    clean(inputData.render_content_sha256).toLowerCase() !== bundle.published_preview_bundle_sha256) {
  throw new Error("ARC_V11_VALIDATION_FAILED: whole-site manifest digest");
}

const replaceOne = (html, pattern, replacement, label) => {
  const matches = html.match(pattern) || [];
  if (matches.length !== 1) throw new Error(`ARC_V11_VALIDATION_FAILED: production ${label}`);
  return html.replace(pattern, replacement);
};
const productionByPath = new Map();
let productionTotal = 0;
for (const pagePath of logicalPaths) {
  const page = pagesByPath.get(pagePath);
  let html = replaceOne(page.approval_html, /<meta\s+name="robots"\s+content="[^"]*">/gi,
    '<meta name="robots" content="index,follow,max-image-preview:large">', `${pagePath} robots`);
  html = replaceOne(html, /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*">/gi,
    `<meta http-equiv="Content-Security-Policy" content="${productionCsp}">`, `${pagePath} CSP`);
  html = replaceOne(html, /data-arc-site-mode="preview"/g, 'data-arc-site-mode="production"', `${pagePath} mode`);
  if (pagePath === "contact/index.html" && bundle.lead_route_mode === "netlify_form") {
    html = replaceOne(html, /action="\.\/\?submitted=1"/g, 'action="/contact/?submitted=1"', "Contact form action");
  }
  for (const [sourceUrl, productionPath] of productionAssetPathByUrl) {
    const encodedUrl = sourceUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    html = html.split(sourceUrl).join(productionPath).split(encodedUrl).join(productionPath);
  }
  if (/https:\/\/arcwebhq-cpu\.github\.io\/arc-previews(?:\/|["'?#]|$)/i.test(html) || /<base\b/i.test(html)) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} production retains preview routing`);
  }
  const size = encoder.encode(html).byteLength;
  const digest = await sha256(html);
  if (size !== page.production_size || digest !== page.production_sha256) {
    throw new Error(`ARC_V11_VALIDATION_FAILED: ${pagePath} production digest/size`);
  }
  productionTotal += size;
  productionByPath.set(pagePath, html);
}
const productionReferenced = new Set();
for (const html of productionByPath.values()) {
  for (const match of html.matchAll(/\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp)/g)) productionReferenced.add(match[0]);
}
const productionPaths = new Set(productionAssetPathByUrl.values());
const productionContent = artifactPaths.map(path => `${path}\0${productionByPath.get(path)}\0`).join("");
if (productionTotal > 500_000 || productionReferenced.size !== productionPaths.size ||
    [...productionPaths].some(path => !productionReferenced.has(path)) || await sha256(productionContent) !== bundle.production_content_sha256 ||
    clean(inputData.production_content_sha256).toLowerCase() !== bundle.production_content_sha256) {
  throw new Error("ARC_V11_VALIDATION_FAILED: production five-page digest or asset union");
}

const offerContext = parseCanonical(inputData.checkout_offer_snapshot_private, "checkout offer snapshot", 80_000);
const offer = offerContext.value;
const offerFields = [
  "adult_acknowledgement_key", "amount_subtotal_minor_units", "approval_content_sha256", "asset_publication_receipt_sha256",
  "automatic_tax_enabled", "checkout_binding_key_id", "checkout_redirect_url", "configuration_sha256", "currency",
  "customer_address_source", "deliverable", "environment", "lead_route_form_name", "lead_route_mode", "lead_route_recipient_hmac_sha256",
  "customer_creation", "livemode", "offer_contract_id", "page_count", "preview_folder", "preview_paths", "preview_source_repository",
  "price_id", "price_tax_behavior", "product_id", "product_tax_code", "production_content_sha256", "public_folder_prefix",
  "published_preview_bundle_sha256", "quantity", "render_bundle_sha256", "scope", "stripe_account_id_sha256", "stripe_api_version",
  "submit_type", "tax_contract_version", "tax_registrations", "tax_registrations_sha256", "tax_settings_status", "terms_document_sha256",
  "terms_version", "version"
];
exactKeys(offer, offerFields, "checkout offer snapshot");
const offerSha = await sha256(offerContext.raw);
const recipientSha = await sha256(recipientContext.raw);
if (offerSha !== clean(inputData.checkout_offer_snapshot_sha256).toLowerCase() ||
    recipientSha !== clean(inputData.checkout_recipient_reservation_sha256).toLowerCase() ||
    !hex64(inputData.checkout_offer_snapshot_hmac_sha256) || !hex64(inputData.checkout_recipient_reservation_hmac_sha256) ||
    offer.version !== "arc-checkout-offer-snapshot-v2" || offer.scope !== "immutable-approved-five-page-preview-private-checkout-offer" ||
    offer.offer_contract_id !== bundle.offer_contract_id || offer.deliverable !== bundle.deliverable || offer.page_count !== 5 ||
    offer.preview_folder !== previewFolder || canonicalJson(offer.preview_paths) !== canonicalJson(previewPaths) ||
    offer.preview_source_repository !== "arcwebhq-cpu/arc-previews" || offer.public_folder_prefix !== suffix ||
    offer.approval_content_sha256 !== bundle.approval_manifest_sha256 ||
    offer.published_preview_bundle_sha256 !== bundle.published_preview_bundle_sha256 ||
    offer.production_content_sha256 !== bundle.production_content_sha256 || offer.render_bundle_sha256 !== bundleSha ||
    offer.lead_route_mode !== bundle.lead_route_mode || offer.lead_route_form_name !== bundle.lead_route_form_name ||
    offer.environment !== "arc-production" || typeof offer.livemode !== "boolean" || offer.amount_subtotal_minor_units !== 500000 ||
    offer.currency !== "usd" || offer.quantity !== 1 || offer.automatic_tax_enabled !== true ||
    offer.customer_address_source !== "stripe_checkout_customer_details.address" || offer.price_tax_behavior !== "exclusive" ||
    offer.tax_contract_version !== "arc-tax-v1" || offer.tax_settings_status !== "active" ||
    !Array.isArray(offer.tax_registrations) || !offer.tax_registrations.length || offer.tax_registrations.length > 100 ||
    offer.adult_acknowledgement_key !== "adultpurchaserack" || offer.customer_creation !== "always" || offer.submit_type !== "pay" ||
    offer.checkout_redirect_url !== "https://arcweb.onl/payment-success/?session_id={CHECKOUT_SESSION_ID}" ||
    offer.stripe_api_version !== "2026-08-26.dahlia" || !/^price_[A-Za-z0-9]+$/.test(offer.price_id) ||
    !/^prod_[A-Za-z0-9]+$/.test(offer.product_id) || !/^txcd_[0-9]{8}$/.test(offer.product_tax_code) ||
    !hex64(offer.stripe_account_id_sha256) || !hex64(offer.terms_document_sha256) || !hex64(offer.tax_registrations_sha256) ||
    !hex64(offer.configuration_sha256) || !hex64(offer.asset_publication_receipt_sha256)) {
  throw new Error("ARC_V11_VALIDATION_FAILED: private checkout offer binding");
}
const stableCheckout = {
  stripe_account_id_sha256: offer.stripe_account_id_sha256, livemode: offer.livemode, price_id: offer.price_id,
  product_id: offer.product_id, amount_subtotal_minor_units: offer.amount_subtotal_minor_units, currency: offer.currency,
  quantity: offer.quantity, terms_version: offer.terms_version, terms_document_sha256: offer.terms_document_sha256,
  automatic_tax_enabled: offer.automatic_tax_enabled, customer_address_source: offer.customer_address_source,
  price_tax_behavior: offer.price_tax_behavior, product_tax_code: offer.product_tax_code, tax_contract_version: offer.tax_contract_version,
  tax_settings_status: offer.tax_settings_status, tax_registrations: offer.tax_registrations,
  tax_registrations_sha256: offer.tax_registrations_sha256, adult_acknowledgement_key: offer.adult_acknowledgement_key,
  customer_creation: offer.customer_creation, submit_type: offer.submit_type,
  checkout_redirect_url: offer.checkout_redirect_url, stripe_api_version: offer.stripe_api_version
};
if (await sha256(canonicalJson(stableCheckout)) !== offer.configuration_sha256 ||
    await sha256(canonicalJson(offer.tax_registrations)) !== offer.tax_registrations_sha256) {
  throw new Error("ARC_V11_VALIDATION_FAILED: immutable checkout configuration digest");
}
if (recipient.version !== "arc1-checkout-recipient-reservation-v2" ||
    recipient.scope !== "private-recipients-for-approved-five-page-checkout" || recipient.offer_contract_id !== bundle.offer_contract_id ||
    recipient.deliverable !== bundle.deliverable || recipient.page_count !== 5 || recipient.preview_folder !== previewFolder ||
    canonicalJson(recipient.preview_paths) !== canonicalJson(previewPaths) || recipient.approval_content_sha256 !== bundle.approval_manifest_sha256 ||
    recipient.published_preview_bundle_sha256 !== bundle.published_preview_bundle_sha256 ||
    recipient.production_content_sha256 !== bundle.production_content_sha256 || recipient.checkout_offer_snapshot_sha256 !== offerSha ||
    recipient.checkout_binding_key_id !== offer.checkout_binding_key_id || recipient.stripe_mode !== (offer.livemode ? "live" : "test") ||
    recipient.lead_route_mode !== bundle.lead_route_mode || recipient.lead_route_form_name !== bundle.lead_route_form_name ||
    recipient.lead_route_recipient_hmac_sha256 !== offer.lead_route_recipient_hmac_sha256 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.claim_recipient_email) ||
    await sha256(recipient.claim_recipient_email) !== recipient.claim_recipient_email_sha256 ||
    (bundle.lead_route_mode === "netlify_form"
      ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.lead_notification_email) || !hex64(offer.lead_route_recipient_hmac_sha256)
      : recipient.lead_notification_email !== "" || offer.lead_route_recipient_hmac_sha256 !== "")) {
  throw new Error("ARC_V11_VALIDATION_FAILED: private checkout recipient binding");
}

const renderContext = parseCanonical(inputData.render_evidence_private, "render evidence", 80_000);
const renderEvidence = renderContext.value;
exactKeys(renderEvidence, [
  "approval_content_sha256", "asset_manifest_sha256", "asset_publication_receipt_sha256", "checkout_offer_snapshot_sha256",
  "checkout_recipient_reservation_sha256", "content_sha256", "deliverable", "intake_evidence_sha256", "lead_route_form_name",
  "lead_route_mode", "offer_contract_id", "page_count", "preview_folder", "preview_paths", "production_content_sha256",
  "published_preview_bundle_sha256", "render_bundle_sha256", "scope", "script_manifest_sha256", "state_digest_sha256",
  "submission_data_sha256", "version"
], "render evidence");
if (!hex64(inputData.render_evidence_hmac_sha256) || renderEvidence.version !== "arc1-render-evidence-v2" ||
    renderEvidence.scope !== "signed-sanitized-five-page-preview-render" || renderEvidence.offer_contract_id !== bundle.offer_contract_id ||
    renderEvidence.deliverable !== bundle.deliverable || renderEvidence.page_count !== 5 || renderEvidence.preview_folder !== previewFolder ||
    canonicalJson(renderEvidence.preview_paths) !== canonicalJson(previewPaths) || renderEvidence.render_bundle_sha256 !== bundleSha ||
    renderEvidence.approval_content_sha256 !== bundle.approval_manifest_sha256 ||
    renderEvidence.content_sha256 !== bundle.published_preview_bundle_sha256 ||
    renderEvidence.published_preview_bundle_sha256 !== bundle.published_preview_bundle_sha256 ||
    renderEvidence.production_content_sha256 !== bundle.production_content_sha256 ||
    renderEvidence.lead_route_mode !== bundle.lead_route_mode || renderEvidence.lead_route_form_name !== bundle.lead_route_form_name ||
    renderEvidence.checkout_offer_snapshot_sha256 !== offerSha || renderEvidence.checkout_recipient_reservation_sha256 !== recipientSha ||
    renderEvidence.script_manifest_sha256 !== trustedScriptManifest || renderEvidence.asset_manifest_sha256 !== clean(inputData.asset_manifest_sha256).toLowerCase() ||
    renderEvidence.asset_publication_receipt_sha256 !== clean(inputData.asset_publication_receipt_sha256).toLowerCase() ||
    renderEvidence.intake_evidence_sha256 !== clean(inputData.intake_evidence_sha256).toLowerCase() ||
    renderEvidence.state_digest_sha256 !== clean(inputData.intake_state_digest_sha256).toLowerCase() ||
    renderEvidence.submission_data_sha256 !== clean(inputData.submission_data_sha256).toLowerCase() ||
    ![inputData.checkout_offer_evidence_sha256, inputData.intake_evidence_sha256, inputData.intake_state_digest_sha256,
      inputData.submission_data_sha256, inputData.asset_publication_receipt_sha256].every(hex64)) {
  throw new Error("ARC_V11_VALIDATION_FAILED: signed render evidence binding");
}

const semanticText = [generated.INDUSTRY_LABEL, generated.BUSINESS_NAME, generated.SERVICES_HEADING, generated.SERVICES_INTRO, generated.SERVICES_HTML]
  .map(value => plainText(value).toLowerCase()).join(" ");
const mediaRules = [
  ["roofing", /\b(roof(?:er|ing)?|shingles?|siding|gutters?|(?:home|residential) exteriors?)\b/i],
  ["hvac", /\b(hvac|air conditioning|air conditioner|heating|furnace|heat pump|climate control)\b/i],
  ["remodeling", /\b(remodel(?:ing|er)?|renovat(?:e|ion|ing)?|kitchen|bathroom|home improvement)\b/i],
  ["landscaping", /\b(landscap(?:e|er|ing)?|lawn care|gardener|gardening|hardscape|yard care|tree service)\b/i],
  ["auto_detailing", /\b(auto detailing|car detailing|detailer|ceramic coating|paint correction|car wash)\b/i],
  ["dental", /\b(dent(?:al|ist|istry)|orthodont(?:ic|ics|ist)|oral surgery)\b/i],
  ["plumbing", /\b(plumb(?:er|ing)?|drain service|water heater|boiler repair)\b/i],
  ["home_services", /\b(contractor|construction|home service|specialty contractor|handyman|painting contractor)\b/i],
  ["medical_spa", /\b(med(?:ical)? spa|medspa|aesthetic(?:s)?|injectables?|botox|facial treatment|skin rejuvenation)\b/i],
  ["healthcare", /\b(medical|health(?:care)?|clinic|doctor|physician|chiropract(?:ic|or)|physical therapy|therapist|urgent care)\b/i],
  ["restaurant", /\b(restaurant|food|hospitality|cafe|bakery|cater(?:er|ing)?)\b/i],
  ["real_estate", /\b(real estate|realtor|property|brokerage|home builder|architect(?:ure)?)\b/i],
  ["fitness", /\b(fitness|gym|wellness|personal trainer|yoga|strength club)\b/i],
  ["legal", /\b(law|legal|attorney|lawyer|law firm)\b/i],
  ["finance", /\b(account(?:ant|ing)?|cpa|finance|financial|insurance|bookkeep(?:er|ing)?|tax)\b/i],
  ["web_design", /\b(web design|web designer|website design|web development|digital studio|digital agency|creative agency|ui\/ux|ux design|product design|ecommerce design)\b/i],
  ["technology", /\b(software|technology|saas|consulting|it services?|tech company)\b/i],
  ["beauty", /\b(beauty|salon|barber|spa|cosmetic|skincare|skin care)\b/i]
];
const expectedMediaProfile = mediaRules.find(([, pattern]) => pattern.test(semanticText))?.[0] || "general";
if (clean(inputData.expected_media_profile) !== expectedMediaProfile) {
  throw new Error("ARC_V11_VALIDATION_FAILED: semantic media profile binding");
}

const validationReceiptSha256 = await sha256(canonicalJson({
  version: "arc1-v11-bundle-validation-receipt-v1",
  scope: "log-safe-exact-five-page-validation",
  validator_version: "arc1-v11-five-page-bundle-validator-v1",
  validation_result: "PASSED",
  page_count: 5,
  preview_folder: previewFolder,
  preview_paths: previewPaths,
  render_bundle_sha256: bundleSha,
  approval_content_sha256: bundle.approval_manifest_sha256,
  published_preview_bundle_sha256: bundle.published_preview_bundle_sha256,
  production_content_sha256: bundle.production_content_sha256,
  asset_manifest_sha256: clean(inputData.asset_manifest_sha256).toLowerCase(),
  asset_publication_receipt_sha256: clean(inputData.asset_publication_receipt_sha256).toLowerCase(),
  checkout_offer_evidence_sha256: clean(inputData.checkout_offer_evidence_sha256).toLowerCase(),
  checkout_offer_snapshot_sha256: offerSha,
  checkout_recipient_reservation_sha256: recipientSha,
  script_manifest_sha256: trustedScriptManifest,
  expected_media_profile: expectedMediaProfile
}));

return {
  status: "V11_FIVE_PAGE_BUNDLE_VALIDATED",
  validation_pass: true,
  validator_version: "arc1-v11-five-page-bundle-validator-v1",
  failed_checks: "none",
  validation_check_count: 33,
  page_count: 5,
  preview_folder: previewFolder,
  preview_paths_json: canonicalJson(previewPaths),
  render_bundle_sha256: bundleSha,
  validation_receipt_sha256: validationReceiptSha256,
  approval_content_sha256: bundle.approval_manifest_sha256,
  published_preview_bundle_sha256: bundle.published_preview_bundle_sha256,
  production_content_sha256: bundle.production_content_sha256,
  expected_media_profile: expectedMediaProfile,
  legacy_singular_output_absent_pass: true,
  private_checkout_exposure_pass: true,
  private_recipient_exposure_pass: true,
  whole_site_digest_pass: true,
  production_derivation_pass: true
};
