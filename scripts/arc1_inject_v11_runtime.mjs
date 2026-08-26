export const ARC1_V11_RUNTIME_VERSION = "arc1-inject-v11-render-runtime-v1";
export const ARC1_V11_SITE_CONTRACT_VERSION = "arc-five-page-site-v1";
export const ARC1_V11_TEMPLATE_VERSION = "11.0";
export const ARC1_V11_APPROVAL_MANIFEST_VERSION = "arc-v11-approval-bundle-v1";

export const ARC1_V11_PAGES = Object.freeze([
  Object.freeze({ key: "home", label: "Home", path: "index.html" }),
  Object.freeze({ key: "services", label: "Services", path: "services/index.html" }),
  Object.freeze({ key: "about", label: "About", path: "about/index.html" }),
  Object.freeze({ key: "process", label: "Process", path: "process/index.html" }),
  Object.freeze({ key: "contact", label: "Contact", path: "contact/index.html" })
]);

export const ARC1_V11_PRODUCTION_PATHS = Object.freeze([
  "about/index.html",
  "contact/index.html",
  "process/index.html",
  "services/index.html",
  "index.html"
]);

const arc1V11ProfileLayouts = Object.freeze({
  roofing: ["impact", 0], hvac: ["trusted", 1], remodeling: ["editorial", 2], landscaping: ["balanced", 1],
  auto_detailing: ["impact", 2], dental: ["trusted", 0], plumbing: ["impact", 0], home_services: ["balanced", 1],
  medical_spa: ["editorial", 2], healthcare: ["trusted", 0], restaurant: ["editorial", 2], real_estate: ["editorial", 1],
  fitness: ["impact", 2], legal: ["trusted", 0], finance: ["trusted", 1], web_design: ["editorial", 2],
  technology: ["balanced", 1], beauty: ["editorial", 2], general: ["balanced", 0]
});

const arc1V11TemplateKeys = Object.freeze([
  "ACCENT_COLOR", "BACKGROUND_COLOR", "BODY_LAYOUT", "BODY_VARIANT", "BRAND_HREF", "BRAND_MARK_HTML",
  "BUSINESS_NAME", "EXPECTED_MEDIA_PROFILE", "FOOTER_LINKS_HTML", "HEADER_CTA_HREF", "LOCATION", "MAIN_HTML",
  "MUTED_COLOR", "NAV_HTML", "PAGE_DESCRIPTION", "PAGE_KEY", "PAGE_PATH", "PAGE_TITLE", "PRIMARY_BUTTON_TEXT",
  "PRIMARY_COLOR", "PRIMARY_CTA_LABEL", "STYLE_MODE", "SURFACE_COLOR", "TEXT_COLOR"
]);

const arc1V11PreviewToolbar = '<aside class="arc-preview-toolbar" aria-label="ARC preview status"><span><strong>ARC preview</strong>Five-page website concept for this business.</span><span data-arc-checkout-private>Checkout is available only through the private approval email.</span></aside>';
const arc1V11PageByKey = new Map(ARC1_V11_PAGES.map(page => [page.key, page]));

const arc1V11Clean = value => String(value == null ? "" : value).trim();
const arc1V11EscapeHtml = value => String(value == null ? "" : value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const arc1V11PlainText = value => arc1V11Clean(value)
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<\/(?:address|article|aside|blockquote|button|details|div|figcaption|footer|form|h[1-6]|header|label|li|main|nav|p|section|small|span|strong|summary)>/gi, ". ")
  .replace(/<br\s*\/?>/gi, ". ").replace(/<[^>]+>/g, " ")
  .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi, " ").replace(/&#(?:x[0-9a-f]+|\d+);?/gi, " ")
  .replace(/\s+/g, " ").trim();

const arc1V11RelativeHref = (fromKey, toKey) => {
  const from = arc1V11PageByKey.get(fromKey), to = arc1V11PageByKey.get(toKey);
  if (!from || !to) throw new Error("ARC_V11_ROUTE_INVALID: unsupported page key");
  if (from.key === "home") return to.key === "home" ? "./" : `./${to.key}/`;
  if (to.key === "home") return "../";
  if (to.key === from.key) return "./";
  return `../${to.key}/`;
};

const arc1V11Hrefs = pageKey => Object.fromEntries(ARC1_V11_PAGES.map(page => [page.key, arc1V11RelativeHref(pageKey, page.key)]));
const arc1V11Navigation = (pageKey, className = "nav-links") =>
  `<nav class="${className}" aria-label="${className === "nav-links" ? "Main menu" : "Footer menu"}">${ARC1_V11_PAGES.map(page =>
    `<a href="${arc1V11RelativeHref(pageKey, page.key)}"${page.key === pageKey ? ' aria-current="page"' : ""}>${page.label}</a>`
  ).join("")}</nav>`;

const arc1V11BoundedText = (value, maximum, fallback) => {
  const normalized = arc1V11PlainText(value).replace(/\s+/g, " ").trim() || fallback;
  if (normalized.length <= maximum) return normalized;
  const slice = normalized.slice(0, maximum - 1), boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary >= maximum * 0.65 ? boundary : slice.length).replace(/[\s,;:.-]+$/g, "")}…`;
};

const arc1V11Metadata = (pageKey, content) => {
  const business = arc1V11PlainText(content.BUSINESS_NAME);
  const titles = {
    home: arc1V11PlainText(content.SEO_TITLE), services: `Services | ${business}`, about: `About | ${business}`,
    process: `Process | ${business}`, contact: `Contact | ${business}`
  };
  const descriptions = {
    home: content.SEO_DESCRIPTION,
    services: `${arc1V11PlainText(content.SERVICES_INTRO)} Explore the service path from ${business}.`,
    about: `${arc1V11PlainText(content.ABOUT_BODY)} Learn what shapes the experience at ${business}.`,
    process: `${arc1V11PlainText(content.PROCESS_INTRO)} See how ${business} moves from first conversation to a clear next step.`,
    contact: `${arc1V11PlainText(content.CONTACT_BODY)} Contact ${business} to begin the conversation.`
  };
  return {
    title: arc1V11BoundedText(titles[pageKey], 70, `${arc1V11PageByKey.get(pageKey).label} | ${business}`),
    description: arc1V11BoundedText(descriptions[pageKey], 170, `${arc1V11PageByKey.get(pageKey).label} information for ${business}.`)
  };
};

const arc1V11VisualStage = (content, profile) => {
  const supplied = arc1V11Clean(content.HERO_MEDIA_HTML);
  return `<div class="visual-stage" data-profile-label="${arc1V11EscapeHtml(profile.replaceAll("_", " "))}" aria-label="Visual direction for ${content.BUSINESS_NAME}">${supplied || '<span class="visual-orbit" aria-hidden="true"></span><span class="visual-core" aria-hidden="true"></span>'}<div class="visual-caption"><small>${content.INDUSTRY_LABEL}</small><strong>${content.VISUAL_HEADLINE}</strong><div class="chip-row">${content.HERO_CHIPS_HTML}</div></div></div>`;
};

const arc1V11ContactMarkup = content => {
  const markup = arc1V11Clean(content.CONTACT_ACTION_HTML);
  if (!/<form\b/i.test(markup)) return markup;
  const replaced = markup.replace('action="/?submitted=1"', 'action="./?submitted=1"');
  if (replaced === markup || (replaced.match(/action="\.\/\?submitted=1"/g) || []).length !== 1) {
    throw new Error("ARC_V11_FORM_INVALID: contact form action could not be made contact-page relative");
  }
  return replaced;
};

const arc1V11MainHtml = (pageKey, content, profile) => {
  const hrefs = arc1V11Hrefs(pageKey);
  const contactButton = `<a class="btn btn-primary" href="${hrefs.contact}">${content.PRIMARY_CTA_LABEL}<span aria-hidden="true">→</span></a>`;
  if (pageKey === "home") return `<section class="hero page-hero"><div class="wrap hero-grid"><div class="hero-copy"><p class="eyebrow">${content.EYEBROW}</p><h1>${content.HEADLINE}</h1><p class="lede">${content.SUBHEADLINE}</p><div class="actions">${contactButton}<a class="btn btn-secondary" href="${hrefs.services}">${content.SECONDARY_CTA_LABEL}</a></div><div class="trust-line">${content.TRUST_LINE_HTML}</div></div>${arc1V11VisualStage(content, profile)}</div></section><div class="ticker" aria-label="Service highlights"><div>${content.TICKER_HTML}</div></div><section class="section section-dark"><div class="wrap"><p class="eyebrow">Why this approach</p><div class="section-heading"><h2>${content.WHY_HEADING}</h2><p>${content.WHY_INTRO}</p></div><div class="card-grid">${content.DIFFERENTIATORS_HTML}</div></div></section><section class="section"><div class="wrap split-callout"><div><p class="eyebrow">Services</p><h2>${content.SERVICES_HEADING}</h2><p>${content.SERVICES_INTRO}</p></div><a class="text-link" href="${hrefs.services}">Explore every service <span aria-hidden="true">→</span></a></div></section>`;
  if (pageKey === "services") return `<section class="inner-hero"><div class="wrap"><p class="eyebrow">${content.INDUSTRY_LABEL}</p><h1>${content.SERVICES_HEADING}</h1><p class="lede">${content.SERVICES_INTRO}</p><div class="metric-line"><span>Primary focus</span><strong>${content.HIGHEST_PROFIT_SERVICE}</strong></div></div></section><section class="section"><div class="wrap"><div class="card-grid service-grid">${content.SERVICES_HTML}</div></div></section><section class="section section-dark"><div class="wrap split-callout"><div><p class="eyebrow">Next step</p><h2>${content.CONTACT_HEADING}</h2><p>${content.CONTACT_BODY}</p></div>${contactButton}</div></section>`;
  if (pageKey === "about") return `<section class="inner-hero"><div class="wrap about-layout"><div><p class="eyebrow">${content.ABOUT_EYEBROW}</p><h1>${content.ABOUT_TITLE}</h1><div class="lede prose">${content.ABOUT_BODY}</div><blockquote>${content.ABOUT_QUOTE}</blockquote></div><div class="about-visual">${content.ABOUT_MEDIA_HTML || `<span aria-hidden="true">${content.BUSINESS_NAME.slice(0, 1)}</span>`}</div></div></section><section class="section"><div class="wrap"><div class="stats">${content.ABOUT_STATS_HTML}</div><div class="section-heading"><p class="eyebrow">Credibility</p><h2>${content.PROOF_HEADING}</h2><p>${content.PROOF_INTRO}</p></div><div class="card-grid proof-grid">${content.PROOF_HTML}</div></div></section><section class="section section-accent"><div class="wrap split-callout"><div><h2>${content.WHY_HEADING}</h2><p>${content.WHY_INTRO}</p></div>${contactButton}</div></section>`;
  if (pageKey === "process") {
    const gallery = arc1V11Clean(content.GALLERY_HTML) || '<div class="visual-tile" aria-hidden="true"></div><div class="visual-tile" aria-hidden="true"></div><div class="visual-tile" aria-hidden="true"></div>';
    return `<section class="inner-hero"><div class="wrap"><p class="eyebrow">How it works</p><h1>${content.PROCESS_HEADING}</h1><p class="lede">${content.PROCESS_INTRO}</p></div></section><section class="section section-dark"><div class="wrap"><div class="process-grid">${content.PROCESS_HTML}</div></div></section><section class="section"><div class="wrap"><div class="section-heading"><p class="eyebrow">Visual direction</p><h2>${content.GALLERY_HEADING}</h2><p>${content.GALLERY_INTRO}</p></div><div class="gallery-grid">${gallery}</div></div></section><section class="section section-accent"><div class="wrap split-callout"><div><h2>${content.CONTACT_HEADING}</h2><p>${content.CONTACT_BODY}</p></div>${contactButton}</div></section>`;
  }
  if (pageKey === "contact") return `<section class="inner-hero contact-hero"><div class="wrap"><p class="eyebrow">Start here</p><h1>${content.CONTACT_HEADING}</h1><p class="lede">${content.CONTACT_BODY}</p></div></section><section class="section"><div class="wrap contact-layout"><div class="contact-panel"><p class="eyebrow">Request details</p>${arc1V11ContactMarkup(content)}</div><aside class="contact-details"><p class="eyebrow">Contact context</p>${content.CONTACT_DETAILS_HTML}</aside></div></section><section class="section section-soft"><div class="wrap faq-layout"><div class="section-heading"><p class="eyebrow">FAQ</p><h2>${content.FAQ_HEADING}</h2><p>${content.FAQ_INTRO}</p></div><div class="faq-list">${content.FAQ_HTML}</div></div></section>`;
  throw new Error("ARC_V11_ROUTE_INVALID: page renderer is missing");
};

const arc1V11RenderTemplate = (template, values) => {
  const observed = [...new Set([...template.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map(match => match[1]))].sort();
  if (JSON.stringify(observed) !== JSON.stringify([...arc1V11TemplateKeys].sort())) {
    throw new Error(`ARC_V11_TEMPLATE_INVALID: placeholder contract mismatch (${observed.join(",")})`);
  }
  let html = template;
  for (const key of arc1V11TemplateKeys) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error(`ARC_V11_TEMPLATE_INVALID: missing render value ${key}`);
    html = html.split(`[[${key}]]`).join(String(values[key]));
  }
  if (/\[\[[A-Z0-9_]+\]\]/.test(html)) throw new Error("ARC_V11_TEMPLATE_INVALID: unresolved placeholder");
  return `${html.trim()}\n`;
};

const arc1V11InjectToolbar = html => {
  if (!html.endsWith("</body>\n</html>\n")) throw new Error("ARC_V11_TEMPLATE_INVALID: canonical document ending");
  return html.replace("</body>\n</html>\n", `${arc1V11PreviewToolbar}\n</body>\n</html>\n`);
};

export async function arc1RenderV11Site(template, content, renderContent, options, runtime) {
  const { canonicalJson, sha256Text } = runtime;
  const profile = options.expectedMediaProfile;
  const layout = arc1V11ProfileLayouts[profile] || arc1V11ProfileLayouts.general;
  const businessInitial = arc1V11EscapeHtml(arc1V11PlainText(content.BUSINESS_NAME).slice(0, 1).toUpperCase() || "A");
  const approvalPages = ARC1_V11_PAGES.map(page => {
    const metadata = arc1V11Metadata(page.key, content), hrefs = arc1V11Hrefs(page.key);
    const approvalHtml = arc1V11RenderTemplate(template, {
      ACCENT_COLOR: renderContent.ACCENT_COLOR, BACKGROUND_COLOR: renderContent.BACKGROUND_COLOR,
      BODY_LAYOUT: layout[0], BODY_VARIANT: String(layout[1]), BRAND_HREF: hrefs.home,
      BRAND_MARK_HTML: renderContent.LOGO_HTML || `<span class="brand-monogram" aria-hidden="true">${businessInitial}</span>`,
      BUSINESS_NAME: renderContent.BUSINESS_NAME, EXPECTED_MEDIA_PROFILE: profile,
      FOOTER_LINKS_HTML: arc1V11Navigation(page.key, "footer-links"), HEADER_CTA_HREF: hrefs.contact,
      LOCATION: renderContent.LOCATION, MAIN_HTML: arc1V11MainHtml(page.key, renderContent, profile),
      MUTED_COLOR: renderContent.MUTED_COLOR, NAV_HTML: arc1V11Navigation(page.key),
      PAGE_DESCRIPTION: arc1V11EscapeHtml(metadata.description), PAGE_KEY: page.key, PAGE_PATH: page.path,
      PAGE_TITLE: arc1V11EscapeHtml(metadata.title), PRIMARY_BUTTON_TEXT: renderContent.PRIMARY_BUTTON_TEXT,
      PRIMARY_COLOR: renderContent.PRIMARY_COLOR, PRIMARY_CTA_LABEL: renderContent.PRIMARY_CTA_LABEL,
      STYLE_MODE: renderContent.STYLE_MODE, SURFACE_COLOR: renderContent.SURFACE_COLOR, TEXT_COLOR: renderContent.TEXT_COLOR
    });
    return { ...page, approvalHtml };
  });
  const formPages = approvalPages.flatMap(page => (page.approvalHtml.match(/<form\b/gi) || []).map(() => page.path));
  if (formPages.length > 1 || formPages.some(path => path !== "contact/index.html")) {
    throw new Error("ARC_V11_FORM_INVALID: at most one Contact-only form is allowed");
  }
  for (const page of approvalPages) {
    if ((page.approvalHtml.match(/<h1\b/gi) || []).length !== 1 ||
        (page.approvalHtml.match(/<nav class="nav-links"/g) || []).length !== 1 ||
        (page.approvalHtml.match(/<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/g) || []).length !== 1) {
      throw new Error(`ARC_V11_BUNDLE_INVALID: ${page.path} structure`);
    }
  }
  const approvalPagesWithDigests = [];
  for (const page of approvalPages) approvalPagesWithDigests.push({
    ...page,
    approvalSha256: await sha256Text(page.approvalHtml),
    approvalSize: new TextEncoder().encode(page.approvalHtml).byteLength,
    publishedHtml: arc1V11InjectToolbar(page.approvalHtml)
  });
  const pages = [];
  for (const page of approvalPagesWithDigests) pages.push({
    ...page,
    publishedSha256: await sha256Text(page.publishedHtml),
    publishedSize: new TextEncoder().encode(page.publishedHtml).byteLength,
    filePath: `${options.previewFolder}/${page.path}`,
    url: `${options.pagesBaseUrl}/${options.previewFolder}/${page.path === "index.html" ? "" : page.path.replace(/index\.html$/, "")}`
  });
  const approvalManifest = {
    version: ARC1_V11_APPROVAL_MANIFEST_VERSION,
    pages: pages.map(page => ({ path: page.path, sha256: page.approvalSha256, size: page.approvalSize }))
  };
  const approvalManifestJson = canonicalJson(approvalManifest);
  return {
    runtimeVersion: ARC1_V11_RUNTIME_VERSION,
    contractVersion: ARC1_V11_SITE_CONTRACT_VERSION,
    templateVersion: ARC1_V11_TEMPLATE_VERSION,
    folder: options.previewFolder,
    pageCount: pages.length,
    pages,
    approvalManifest,
    approvalManifestJson,
    approvalBundleSha256: await sha256Text(approvalManifestJson),
    hasLeadForm: formPages.length === 1
  };
}
