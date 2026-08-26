import { createHash } from "node:crypto";

import {
  assertExactContract,
  buildPreviewFolder,
  detectMediaProfile,
  sanitizeGeneratedMedia
} from "./arc_contract.mjs";
import { assertPremiumContentContract, plainContentText } from "./content_quality.mjs";
import { escapeHtml, sanitizeContentForRender } from "./content_sanitizer.mjs";
import { assertNoRemoteRuntimeDependencies } from "./no_egress_contract.mjs";

export const V11_TEMPLATE_VERSION = "11.0";
export const V11_SITE_CONTRACT_VERSION = "arc-five-page-site-v1";
export const V11_APPROVAL_MANIFEST_VERSION = "arc-v11-approval-bundle-v1";

export const V11_PAGES = Object.freeze([
  Object.freeze({ key: "home", label: "Home", path: "index.html" }),
  Object.freeze({ key: "services", label: "Services", path: "services/index.html" }),
  Object.freeze({ key: "about", label: "About", path: "about/index.html" }),
  Object.freeze({ key: "process", label: "Process", path: "process/index.html" }),
  Object.freeze({ key: "contact", label: "Contact", path: "contact/index.html" })
]);

const EXPECTED_PAGE_PATHS = Object.freeze(V11_PAGES.map(page => page.path));
const PAGE_BY_KEY = new Map(V11_PAGES.map(page => [page.key, page]));
const PROFILE_LAYOUTS = Object.freeze({
  roofing: ["impact", 0],
  hvac: ["trusted", 1],
  remodeling: ["editorial", 2],
  landscaping: ["balanced", 1],
  auto_detailing: ["impact", 2],
  dental: ["trusted", 0],
  plumbing: ["impact", 0],
  home_services: ["balanced", 1],
  medical_spa: ["editorial", 2],
  healthcare: ["trusted", 0],
  restaurant: ["editorial", 2],
  real_estate: ["editorial", 1],
  fitness: ["impact", 2],
  legal: ["trusted", 0],
  finance: ["trusted", 1],
  web_design: ["editorial", 2],
  technology: ["balanced", 1],
  beauty: ["editorial", 2],
  general: ["balanced", 0]
});

const TEMPLATE_KEYS = Object.freeze([
  "ACCENT_COLOR",
  "BACKGROUND_COLOR",
  "BODY_LAYOUT",
  "BODY_VARIANT",
  "BRAND_HREF",
  "BRAND_MARK_HTML",
  "BUSINESS_NAME",
  "FOOTER_LINKS_HTML",
  "HEADER_CTA_HREF",
  "LOCATION",
  "MAIN_HTML",
  "MUTED_COLOR",
  "NAV_HTML",
  "PAGE_DESCRIPTION",
  "PAGE_KEY",
  "PAGE_PATH",
  "PAGE_TITLE",
  "PRIMARY_BUTTON_TEXT",
  "PRIMARY_COLOR",
  "PRIMARY_CTA_LABEL",
  "STYLE_MODE",
  "SURFACE_COLOR",
  "TEXT_COLOR",
  "EXPECTED_MEDIA_PROFILE"
]);

const PREVIEW_TOOLBAR = '<aside class="arc-preview-toolbar" aria-label="ARC preview status"><span><strong>ARC preview</strong>Five-page website concept for this business.</span><span data-arc-checkout-private>Checkout is available only through the private approval email.</span></aside>';

function clean(value) {
  return String(value ?? "").trim();
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ARC_V11_CANONICAL_INVALID: non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ARC_V11_CANONICAL_INVALID: plain JSON values required");
}

export function sha256(value) {
  return createHash("sha256").update(value, typeof value === "string" ? "utf8" : undefined).digest("hex");
}

export function relativePageHref(fromKey, toKey) {
  const from = PAGE_BY_KEY.get(fromKey);
  const to = PAGE_BY_KEY.get(toKey);
  if (!from || !to) throw new Error("ARC_V11_ROUTE_INVALID: unsupported page key");
  if (from.key === "home") return to.key === "home" ? "./" : `./${to.key}/`;
  if (to.key === "home") return "../";
  if (to.key === from.key) return "./";
  return `../${to.key}/`;
}

function pageHrefs(pageKey) {
  return Object.fromEntries(V11_PAGES.map(page => [page.key, relativePageHref(pageKey, page.key)]));
}

function navigationHtml(pageKey, className = "nav-links") {
  return `<nav class="${className}" aria-label="${className === "nav-links" ? "Main menu" : "Footer menu"}">${V11_PAGES.map(page => {
    const current = page.key === pageKey ? ' aria-current="page"' : "";
    return `<a href="${relativePageHref(pageKey, page.key)}"${current}>${page.label}</a>`;
  }).join("")}</nav>`;
}

function boundedText(value, maximum, fallback) {
  const normalized = plainContentText(value).replace(/\s+/g, " ").trim() || fallback;
  if (normalized.length <= maximum) return normalized;
  const slice = normalized.slice(0, maximum - 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary >= maximum * 0.65 ? boundary : slice.length).replace(/[\s,;:.-]+$/g, "")}…`;
}

function pageMetadata(pageKey, content) {
  const business = plainContentText(content.BUSINESS_NAME);
  const titleByPage = {
    home: plainContentText(content.SEO_TITLE),
    services: `Services | ${business}`,
    about: `About | ${business}`,
    process: `Process | ${business}`,
    contact: `Contact | ${business}`
  };
  const descriptionByPage = {
    home: content.SEO_DESCRIPTION,
    services: `${plainContentText(content.SERVICES_INTRO)} Explore the service path from ${business}.`,
    about: `${plainContentText(content.ABOUT_BODY)} Learn what shapes the experience at ${business}.`,
    process: `${plainContentText(content.PROCESS_INTRO)} See how ${business} moves from first conversation to a clear next step.`,
    contact: `${plainContentText(content.CONTACT_BODY)} Contact ${business} to begin the conversation.`
  };
  return {
    title: boundedText(titleByPage[pageKey], 70, `${PAGE_BY_KEY.get(pageKey).label} | ${business}`),
    description: boundedText(descriptionByPage[pageKey], 170, `${PAGE_BY_KEY.get(pageKey).label} information for ${business}.`)
  };
}

function visualStage(content, expectedMediaProfile) {
  const supplied = clean(content.HERO_MEDIA_HTML);
  return `<div class="visual-stage" data-profile-label="${escapeHtml(expectedMediaProfile.replaceAll("_", " "))}" aria-label="Visual direction for ${content.BUSINESS_NAME}">${supplied || '<span class="visual-orbit" aria-hidden="true"></span><span class="visual-core" aria-hidden="true"></span>'}<div class="visual-caption"><small>${content.INDUSTRY_LABEL}</small><strong>${content.VISUAL_HEADLINE}</strong><div class="chip-row">${content.HERO_CHIPS_HTML}</div></div></div>`;
}

function contactMarkup(content) {
  const markup = clean(content.CONTACT_ACTION_HTML);
  if (!/<form\b/i.test(markup)) return markup;
  const replaced = markup.replace('action="/?submitted=1"', 'action="./?submitted=1"');
  if (replaced === markup || (replaced.match(/action="\.\/\?submitted=1"/g) || []).length !== 1) {
    throw new Error("ARC_V11_FORM_INVALID: contact form action could not be made contact-page relative");
  }
  return replaced;
}

function mainHtml(pageKey, content, expectedMediaProfile) {
  const hrefs = pageHrefs(pageKey);
  const contactButton = `<a class="btn btn-primary" href="${hrefs.contact}">${content.PRIMARY_CTA_LABEL}<span aria-hidden="true">→</span></a>`;
  if (pageKey === "home") {
    return `<section class="hero page-hero"><div class="wrap hero-grid"><div class="hero-copy"><p class="eyebrow">${content.EYEBROW}</p><h1>${content.HEADLINE}</h1><p class="lede">${content.SUBHEADLINE}</p><div class="actions">${contactButton}<a class="btn btn-secondary" href="${hrefs.services}">${content.SECONDARY_CTA_LABEL}</a></div><div class="trust-line">${content.TRUST_LINE_HTML}</div></div>${visualStage(content, expectedMediaProfile)}</div></section><div class="ticker" aria-label="Service highlights"><div>${content.TICKER_HTML}</div></div><section class="section section-dark"><div class="wrap"><p class="eyebrow">Why this approach</p><div class="section-heading"><h2>${content.WHY_HEADING}</h2><p>${content.WHY_INTRO}</p></div><div class="card-grid">${content.DIFFERENTIATORS_HTML}</div></div></section><section class="section"><div class="wrap split-callout"><div><p class="eyebrow">Services</p><h2>${content.SERVICES_HEADING}</h2><p>${content.SERVICES_INTRO}</p></div><a class="text-link" href="${hrefs.services}">Explore every service <span aria-hidden="true">→</span></a></div></section>`;
  }
  if (pageKey === "services") {
    return `<section class="inner-hero"><div class="wrap"><p class="eyebrow">${content.INDUSTRY_LABEL}</p><h1>${content.SERVICES_HEADING}</h1><p class="lede">${content.SERVICES_INTRO}</p><div class="metric-line"><span>Primary focus</span><strong>${content.HIGHEST_PROFIT_SERVICE}</strong></div></div></section><section class="section"><div class="wrap"><div class="card-grid service-grid">${content.SERVICES_HTML}</div></div></section><section class="section section-dark"><div class="wrap split-callout"><div><p class="eyebrow">Next step</p><h2>${content.CONTACT_HEADING}</h2><p>${content.CONTACT_BODY}</p></div>${contactButton}</div></section>`;
  }
  if (pageKey === "about") {
    return `<section class="inner-hero"><div class="wrap about-layout"><div><p class="eyebrow">${content.ABOUT_EYEBROW}</p><h1>${content.ABOUT_TITLE}</h1><div class="lede prose">${content.ABOUT_BODY}</div><blockquote>${content.ABOUT_QUOTE}</blockquote></div><div class="about-visual">${content.ABOUT_MEDIA_HTML || `<span aria-hidden="true">${content.BUSINESS_NAME.slice(0, 1)}</span>`}</div></div></section><section class="section"><div class="wrap"><div class="stats">${content.ABOUT_STATS_HTML}</div><div class="section-heading"><p class="eyebrow">Credibility</p><h2>${content.PROOF_HEADING}</h2><p>${content.PROOF_INTRO}</p></div><div class="card-grid proof-grid">${content.PROOF_HTML}</div></div></section><section class="section section-accent"><div class="wrap split-callout"><div><h2>${content.WHY_HEADING}</h2><p>${content.WHY_INTRO}</p></div>${contactButton}</div></section>`;
  }
  if (pageKey === "process") {
    const gallery = clean(content.GALLERY_HTML) || '<div class="visual-tile" aria-hidden="true"></div><div class="visual-tile" aria-hidden="true"></div><div class="visual-tile" aria-hidden="true"></div>';
    return `<section class="inner-hero"><div class="wrap"><p class="eyebrow">How it works</p><h1>${content.PROCESS_HEADING}</h1><p class="lede">${content.PROCESS_INTRO}</p></div></section><section class="section section-dark"><div class="wrap"><div class="process-grid">${content.PROCESS_HTML}</div></div></section><section class="section"><div class="wrap"><div class="section-heading"><p class="eyebrow">Visual direction</p><h2>${content.GALLERY_HEADING}</h2><p>${content.GALLERY_INTRO}</p></div><div class="gallery-grid">${gallery}</div></div></section><section class="section section-accent"><div class="wrap split-callout"><div><h2>${content.CONTACT_HEADING}</h2><p>${content.CONTACT_BODY}</p></div>${contactButton}</div></section>`;
  }
  if (pageKey === "contact") {
    return `<section class="inner-hero contact-hero"><div class="wrap"><p class="eyebrow">Start here</p><h1>${content.CONTACT_HEADING}</h1><p class="lede">${content.CONTACT_BODY}</p></div></section><section class="section"><div class="wrap contact-layout"><div class="contact-panel"><p class="eyebrow">Request details</p>${contactMarkup(content)}</div><aside class="contact-details"><p class="eyebrow">Contact context</p>${content.CONTACT_DETAILS_HTML}</aside></div></section><section class="section section-soft"><div class="wrap faq-layout"><div class="section-heading"><p class="eyebrow">FAQ</p><h2>${content.FAQ_HEADING}</h2><p>${content.FAQ_INTRO}</p></div><div class="faq-list">${content.FAQ_HTML}</div></div></section>`;
  }
  throw new Error("ARC_V11_ROUTE_INVALID: page renderer is missing");
}

function renderTemplate(template, values) {
  const observed = [...new Set([...template.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map(match => match[1]))].sort();
  if (JSON.stringify(observed) !== JSON.stringify([...TEMPLATE_KEYS].sort())) {
    throw new Error(`ARC_V11_TEMPLATE_INVALID: placeholder contract mismatch (${observed.join(",")})`);
  }
  let html = template;
  for (const key of TEMPLATE_KEYS) {
    if (!Object.hasOwn(values, key)) throw new Error(`ARC_V11_TEMPLATE_INVALID: missing render value ${key}`);
    html = html.split(`[[${key}]]`).join(String(values[key]));
  }
  if (/\[\[[A-Z0-9_]+\]\]/.test(html)) throw new Error("ARC_V11_TEMPLATE_INVALID: unresolved placeholder");
  return `${html.trim()}\n`;
}

function injectPreviewToolbar(html) {
  if (!html.endsWith("</body>\n</html>\n")) throw new Error("ARC_V11_TEMPLATE_INVALID: canonical document ending");
  return html.replace("</body>\n</html>\n", `${PREVIEW_TOOLBAR}\n</body>\n</html>\n`);
}

function metaValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...html.matchAll(new RegExp(`<meta\\s+name="${escaped}"\\s+content="([^"]+)"`, "gi"))];
  if (matches.length !== 1) throw new Error(`ARC_V11_BUNDLE_INVALID: expected one ${name} meta`);
  return matches[0][1];
}

function validateRenderedPages(pages, exactReceiptUrls) {
  if (!Array.isArray(pages) || pages.length !== V11_PAGES.length ||
      JSON.stringify(pages.map(page => page.path)) !== JSON.stringify(EXPECTED_PAGE_PATHS)) {
    throw new Error("ARC_V11_BUNDLE_INVALID: exact five-page path order required");
  }
  let formCount = 0;
  const titles = new Set();
  const descriptions = new Set();
  for (const page of pages) {
    const html = page.approvalHtml;
    if (Buffer.byteLength(html, "utf8") > 300_000) throw new Error("ARC_V11_BUNDLE_INVALID: page exceeds 300000 UTF-8 bytes");
    if (!/^<!doctype html>/i.test(html) || (html.match(/<h1\b/gi) || []).length !== 1 ||
        (html.match(/<main\b/gi) || []).length !== 1 || (html.match(/<nav class="nav-links"/g) || []).length !== 1) {
      throw new Error(`ARC_V11_BUNDLE_INVALID: ${page.path} document structure`);
    }
    if (metaValue(html, "arc-template-version") !== V11_TEMPLATE_VERSION ||
        metaValue(html, "arc-site-contract") !== V11_SITE_CONTRACT_VERSION ||
        metaValue(html, "arc-page-key") !== page.key || metaValue(html, "arc-page-path") !== page.path) {
      throw new Error(`ARC_V11_BUNDLE_INVALID: ${page.path} metadata binding`);
    }
    const robots = metaValue(html, "robots").toLowerCase().split(",").map(value => value.trim());
    if (!robots.includes("noindex") || !robots.includes("nofollow")) {
      throw new Error(`ARC_V11_BUNDLE_INVALID: ${page.path} must be noindex,nofollow`);
    }
    titles.add(metaValue(html, "arc-page-title"));
    descriptions.add(metaValue(html, "description"));
    const pageForms = (html.match(/<form\b/gi) || []).length;
    if (page.key !== "contact" && pageForms) throw new Error(`ARC_V11_FORM_INVALID: form escaped onto ${page.path}`);
    formCount += pageForms;
    assertNoRemoteRuntimeDependencies(html, { exactReceiptUrls });
  }
  if (titles.size !== V11_PAGES.length || descriptions.size !== V11_PAGES.length) {
    throw new Error("ARC_V11_BUNDLE_INVALID: page titles and descriptions must be unique");
  }
  if (formCount > 1) throw new Error("ARC_V11_FORM_INVALID: at most one form is allowed across the site");
}

export function createV11ApprovalManifest(pages) {
  if (!Array.isArray(pages) || pages.length !== V11_PAGES.length ||
      JSON.stringify(pages.map(page => page.path)) !== JSON.stringify(EXPECTED_PAGE_PATHS)) {
    throw new Error("ARC_V11_BUNDLE_INVALID: approval manifest page set");
  }
  return {
    version: V11_APPROVAL_MANIFEST_VERSION,
    pages: pages.map(page => {
      const bytes = page.approvalHtml ?? page.html;
      if (typeof bytes !== "string" || !bytes.length) throw new Error(`ARC_V11_BUNDLE_INVALID: ${page.path} approval bytes`);
      return { path: page.path, sha256: sha256(bytes), size: Buffer.byteLength(bytes, "utf8") };
    })
  };
}

export function digestV11ApprovalManifest(manifest) {
  const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
  if (!exactKeys(manifest, ["pages", "version"]) || manifest.version !== V11_APPROVAL_MANIFEST_VERSION ||
      !Array.isArray(manifest.pages) || JSON.stringify(manifest.pages.map(page => page.path)) !== JSON.stringify(EXPECTED_PAGE_PATHS) ||
      manifest.pages.some(page => !exactKeys(page, ["path", "sha256", "size"]) ||
        !/^[a-f0-9]{64}$/.test(page.sha256) || !Number.isSafeInteger(page.size) || page.size < 1)) {
    throw new Error("ARC_V11_BUNDLE_INVALID: malformed approval manifest");
  }
  return sha256(canonicalJson(manifest));
}

export function renderV11Site(template, content, options = {}) {
  assertExactContract(content);
  const folder = buildPreviewFolder(content.BUSINESS_NAME, options.trustedEventPrefix);
  const approvedMedia = [options.heroImageUrl, options.supportingImageUrl].filter(Boolean);
  const mediaSafe = sanitizeGeneratedMedia(content, approvedMedia);
  const renderContent = sanitizeContentForRender(mediaSafe, {
    approvedLogoUrl: options.logoImageUrl,
    heroImageUrl: options.heroImageUrl,
    supportingImageUrl: options.supportingImageUrl
  });
  assertPremiumContentContract(renderContent);
  const expectedMediaProfile = detectMediaProfile(mediaSafe);
  const [layout, variant] = PROFILE_LAYOUTS[expectedMediaProfile] || PROFILE_LAYOUTS.general;
  const businessInitial = escapeHtml(plainContentText(content.BUSINESS_NAME).slice(0, 1).toUpperCase() || "A");
  const approvalPages = V11_PAGES.map(page => {
    const metadata = pageMetadata(page.key, content);
    const hrefs = pageHrefs(page.key);
    const approvalHtml = renderTemplate(template, {
      ACCENT_COLOR: renderContent.ACCENT_COLOR,
      BACKGROUND_COLOR: renderContent.BACKGROUND_COLOR,
      BODY_LAYOUT: layout,
      BODY_VARIANT: String(variant),
      BRAND_HREF: hrefs.home,
      BRAND_MARK_HTML: renderContent.LOGO_HTML || `<span class="brand-monogram" aria-hidden="true">${businessInitial}</span>`,
      BUSINESS_NAME: renderContent.BUSINESS_NAME,
      EXPECTED_MEDIA_PROFILE: expectedMediaProfile,
      FOOTER_LINKS_HTML: navigationHtml(page.key, "footer-links"),
      HEADER_CTA_HREF: hrefs.contact,
      LOCATION: renderContent.LOCATION,
      MAIN_HTML: mainHtml(page.key, renderContent, expectedMediaProfile),
      MUTED_COLOR: renderContent.MUTED_COLOR,
      NAV_HTML: navigationHtml(page.key),
      PAGE_DESCRIPTION: escapeHtml(metadata.description),
      PAGE_KEY: page.key,
      PAGE_PATH: page.path,
      PAGE_TITLE: escapeHtml(metadata.title),
      PRIMARY_BUTTON_TEXT: renderContent.PRIMARY_BUTTON_TEXT,
      PRIMARY_COLOR: renderContent.PRIMARY_COLOR,
      PRIMARY_CTA_LABEL: renderContent.PRIMARY_CTA_LABEL,
      STYLE_MODE: renderContent.STYLE_MODE,
      SURFACE_COLOR: renderContent.SURFACE_COLOR,
      TEXT_COLOR: renderContent.TEXT_COLOR
    });
    return { ...page, approvalHtml };
  });
  validateRenderedPages(approvalPages, approvedMedia);
  const approvalManifest = createV11ApprovalManifest(approvalPages);
  const approvalManifestJson = canonicalJson(approvalManifest);
  const approvalBundleSha256 = digestV11ApprovalManifest(approvalManifest);
  const pagesBaseUrl = clean(options.pagesBaseUrl || "https://arcwebhq-cpu.github.io/arc-previews").replace(/\/+$/, "");
  const pages = approvalPages.map(page => {
    const html = injectPreviewToolbar(page.approvalHtml);
    const customerEmail = clean(options.customerEmail).toLowerCase();
    if (customerEmail && html.toLowerCase().includes(customerEmail)) {
      throw new Error(`ARC_V11_PRIVACY_FAILED: customer email appeared in ${page.path}`);
    }
    return {
      key: page.key,
      label: page.label,
      path: page.path,
      filePath: `${folder}/${page.path}`,
      url: `${pagesBaseUrl}/${folder}/${page.path === "index.html" ? "" : page.path.replace(/index\.html$/, "")}`,
      approvalHtml: page.approvalHtml,
      approvalSha256: sha256(page.approvalHtml),
      html,
      publishedSha256: sha256(html)
    };
  });
  return {
    contractVersion: V11_SITE_CONTRACT_VERSION,
    templateVersion: V11_TEMPLATE_VERSION,
    folder,
    previewUrl: `${pagesBaseUrl}/${folder}/`,
    expectedMediaProfile,
    pages,
    approvalManifest,
    approvalManifestJson,
    approvalBundleSha256,
    pageCount: pages.length
  };
}
