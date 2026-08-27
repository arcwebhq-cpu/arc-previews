import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeContentForRender } from "./content_sanitizer.mjs";
import { assertPremiumContentContract } from "./content_quality.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export const REQUIRED_KEYS = Object.freeze([
  "SEO_TITLE",
  "SEO_DESCRIPTION",
  "PRIMARY_COLOR",
  "BACKGROUND_COLOR",
  "SURFACE_COLOR",
  "TEXT_COLOR",
  "MUTED_COLOR",
  "ACCENT_COLOR",
  "PRIMARY_BUTTON_TEXT",
  "STYLE_MODE",
  "BUSINESS_NAME",
  "LOGO_HTML",
  "PRIMARY_CTA_HREF",
  "PRIMARY_CTA_LABEL",
  "EYEBROW",
  "HEADLINE",
  "SUBHEADLINE",
  "SECONDARY_CTA_HREF",
  "SECONDARY_CTA_LABEL",
  "TRUST_LINE_HTML",
  "HERO_MEDIA_HTML",
  "INDUSTRY_LABEL",
  "LOCATION",
  "VISUAL_HEADLINE",
  "HERO_CHIPS_HTML",
  "HIGHEST_PROFIT_SERVICE",
  "HERO_PROOF_LINE",
  "TICKER_HTML",
  "SERVICES_HEADING",
  "SERVICES_INTRO",
  "SERVICES_HTML",
  "WHY_HEADING",
  "WHY_INTRO",
  "DIFFERENTIATORS_HTML",
  "ABOUT_TITLE",
  "ABOUT_BODY",
  "ABOUT_STATS_HTML",
  "ABOUT_MEDIA_HTML",
  "ABOUT_EYEBROW",
  "ABOUT_QUOTE",
  "PROCESS_HEADING",
  "PROCESS_INTRO",
  "PROCESS_HTML",
  "PROOF_HEADING",
  "PROOF_INTRO",
  "PROOF_HTML",
  "GALLERY_HEADING",
  "GALLERY_INTRO",
  "GALLERY_HTML",
  "FAQ_HEADING",
  "FAQ_INTRO",
  "FAQ_HTML",
  "CONTACT_HEADING",
  "CONTACT_BODY",
  "CONTACT_ACTION_HTML",
  "CONTACT_DETAILS_HTML",
  "FOOTER_TAGLINE",
  "FOOTER_LINKS_HTML"
]);

const MEDIA_PROFILE_RULES = Object.freeze([
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
]);

function plainText(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function detectMediaProfile(content) {
  const semanticText = [
    content?.INDUSTRY_LABEL,
    content?.BUSINESS_NAME,
    content?.SERVICES_HEADING,
    content?.SERVICES_INTRO,
    content?.SERVICES_HTML
  ].map(plainText).join(" ");
  return MEDIA_PROFILE_RULES.find(([, pattern]) => pattern.test(semanticText))?.[0] || "general";
}

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assertExactContract(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("ARC_CONTRACT_INVALID: generated content must be an object");
  }
  const keys = Object.keys(content);
  const missing = REQUIRED_KEYS.filter(key => !Object.hasOwn(content, key));
  const extra = keys.filter(key => !REQUIRED_KEYS.includes(key));
  if (keys.length !== 58 || missing.length || extra.length) {
    throw new Error(
      `ARC_CONTRACT_INVALID: expected 58 keys; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`
    );
  }
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return "";
  }
}

function removeUnownedImages(markup, approvedMedia) {
  const approved = new Set(approvedMedia.filter(Boolean).map(normalizedUrl));
  return String(markup ?? "")
    .replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, block => {
      const sources = [...block.matchAll(/\b(?:src|srcset)\s*=\s*["']([^"']+)["']/gi)];
      const owned = sources.some(match => approved.has(normalizedUrl(match[1].split(/\s+/)[0])));
      return owned ? block : "";
    })
    .replace(/<img\b[^>]*>/gi, tag => {
      const source = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || "";
      return source && approved.has(normalizedUrl(source)) ? tag : "";
    });
}

export function sanitizeGeneratedMedia(content, approvedMedia = []) {
  const next = { ...content };
  for (const key of ["HERO_MEDIA_HTML", "ABOUT_MEDIA_HTML", "GALLERY_HTML"]) {
    next[key] = removeUnownedImages(next[key], approvedMedia);
  }
  return next;
}

export function buildPreviewFolder(businessName, trustedEventPrefix) {
  const businessSlug = slugify(businessName).slice(0, 64).replace(/-+$/g, "");
  const prefix = String(trustedEventPrefix ?? "").trim().toLowerCase();
  if (!businessSlug) throw new Error("ARC_PATH_INVALID: business name cannot produce a slug");
  if (!/^[a-f0-9]{8}$/.test(prefix)) {
    throw new Error("ARC_PATH_INVALID: trusted event prefix must be exactly eight hexadecimal characters");
  }
  return `${businessSlug}-${prefix}`;
}

function injectPreviewToolbar(html) {
  const markup = `<aside class="arc-preview-toolbar" aria-label="ARC preview purchase"><span><strong>ARC preview</strong>Built for this business. Purchase only if approved.</span><span data-arc-checkout-private>Checkout is available only through the private approval email.</span></aside>`;
  if (!/<\/body>/i.test(html)) throw new Error("ARC_TEMPLATE_INVALID: closing body tag is missing");
  return html.replace(/<\/body>/i, `${markup}\n</body>`) + "\n";
}

export function renderPreview(template, content, options) {
  assertExactContract(content);
  const folder = buildPreviewFolder(content.BUSINESS_NAME, options?.trustedEventPrefix);
  const approvedMedia = [options?.heroImageUrl, options?.supportingImageUrl].filter(Boolean);
  const safeContent = sanitizeGeneratedMedia(content, approvedMedia);
  const renderContent = sanitizeContentForRender(safeContent, {
    approvedLogoUrl: options?.logoImageUrl,
    heroImageUrl: options?.heroImageUrl,
    supportingImageUrl: options?.supportingImageUrl
  });
  assertPremiumContentContract(renderContent);
  const templateKeys = [...template.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map(match => match[1]);
  const uniqueTemplateKeys = [...new Set(templateKeys)];
  if (uniqueTemplateKeys.length !== 58 || uniqueTemplateKeys.some(key => !REQUIRED_KEYS.includes(key))) {
    throw new Error("ARC_TEMPLATE_INVALID: template no longer matches the exact 58-key contract");
  }

  let html = template;
  for (const key of REQUIRED_KEYS) {
    html = html.split(`[[${key}]]`).join(String(renderContent[key] ?? ""));
  }
  const expectedMediaProfile = detectMediaProfile(safeContent);
  html = html.replace(/<body\b/i, `<body data-arc-expected-media-profile="${expectedMediaProfile}"`);
  html = html.trim();
  const approvalContentSha256 = createHash("sha256").update(html, "utf8").digest("hex");
  html = injectPreviewToolbar(html);
  const unresolved = [...html.matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].map(match => match[1]);
  if (unresolved.length) throw new Error(`ARC_INJECTION_FAILED: unresolved=${[...new Set(unresolved)].join(",")}`);

  const customerEmail = String(options?.customerEmail ?? "").trim().toLowerCase();
  if (customerEmail && html.toLowerCase().includes(customerEmail)) {
    throw new Error("ARC_PRIVACY_FAILED: customer email appeared in public HTML");
  }

  const filePath = `${folder}/index.html`;
  const pagesBaseUrl = String(options?.pagesBaseUrl ?? "https://arcwebhq-cpu.github.io/arc-previews").replace(/\/+$/, "");
  return {
    content: safeContent,
    folder,
    filePath,
    html,
    approvalContentSha256,
    expectedMediaProfile,
    previewUrl: `${pagesBaseUrl}/${folder}/`,
    templatePlaceholderCount: uniqueTemplateKeys.length,
    finalPlaceholderCount: 0,
    htmlCharacterCount: html.length
  };
}

export async function loadMasterTemplate(root = moduleRoot) {
  return readFile(path.join(root, "ARC_MASTER_TEMPLATE.html"), "utf8");
}
