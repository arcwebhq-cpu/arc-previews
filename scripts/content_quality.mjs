const clean = value => String(value ?? "").trim();

export function plainContentText(value) {
  return clean(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:address|article|aside|blockquote|button|details|div|figcaption|footer|form|h[1-6]|header|label|li|main|nav|p|section|small|span|strong|summary)>/gi, ". ")
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi, " ")
    .replace(/&#(?:x[0-9a-f]+|\d+);?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizedText = value => plainContentText(value)
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const wordCount = value => {
  const text = plainContentText(value);
  return text ? text.split(/\s+/).length : 0;
};

const blockMatches = (markup, tag) => String(markup ?? "").match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi")) || [];

const fillerPattern = /\b(?:lorem ipsum|placeholder copy|insert (?:copy|text|content) here|your business name|business name here|tbd|todo|coming soon)\b/i;
const unsupportedClaimPatterns = Object.freeze([
  ["rating", /(?:\b[1-5](?:\.\d)?\s*(?:\/\s*5|stars?)\b|[★☆]{3,})/i],
  ["ranking", /(?:#\s*1\b|\bnumber\s+one\b|\btop[-\s]?rated\b|\baward[-\s]?winning\b)/i],
  ["volume", /\b[1-9]\d*(?:,\d{3})*(?:\.\d+)?\+?\s+(?:years?|clients?|customers?|patients?|projects?|homes?|jobs?|reviews?|cases?|businesses?)\b/i],
  ["percentage", /\b\d+(?:\.\d+)?\s*%/i],
  ["availability", /\b24\s*\/\s*7\b/i],
  ["credential", /\b(?:licensed\s+(?:and|&)\s+insured|licensed\s+(?:contractor|professional|provider|technician|plumber|electrician)|certified\s+(?:professional|provider|technician|specialist)|accredited\s+(?:business|practice|provider)|fully bonded)\b/i],
  ["guarantee", /\b(?:satisfaction guaranteed|money[-\s]?back guarantee|lifetime warranty|guaranteed results?)\b/i],
  ["numeric result", /\b(?:saved|increased|grew|reduced|improved|generated|delivered)\s+(?:by\s+)?\$?\d[\d,.]*/i]
]);

export function unsupportedMarketingClaims(value) {
  const text = plainContentText(value);
  if (!text) return [];
  const segments = text.split(/(?<=[.!?])\s+|[\r\n]+/).map(clean).filter(Boolean);
  const breaches = [];
  for (const segment of segments) {
    for (const [kind, pattern] of unsupportedClaimPatterns) {
      if (pattern.test(segment)) {
        breaches.push({ kind, text: segment.slice(0, 180) });
      }
    }
  }
  return breaches;
}

function inspectCards(markup, tag, minimum, maximum, label) {
  const blocks = blockMatches(markup, tag);
  const titles = [];
  const bodies = [];
  const errors = [];
  if (blocks.length < minimum || blocks.length > maximum) errors.push(`${label} requires ${minimum}-${maximum} ${tag} blocks`);
  for (const block of blocks) {
    const title = plainContentText(block.match(/<(?:h3|summary)\b[^>]*>[\s\S]*?<\/(?:h3|summary)>/i)?.[0] || "");
    const body = plainContentText(block.replace(/<(?:h3|summary)\b[^>]*>[\s\S]*?<\/(?:h3|summary)>/i, ""));
    if (wordCount(title) < 1 || wordCount(title) > 12) errors.push(`${label} has an empty or oversized title`);
    if (wordCount(body) < 5) errors.push(`${label} has thin body copy`);
    titles.push(normalizedText(title));
    bodies.push(normalizedText(body));
  }
  if (new Set(titles.filter(Boolean)).size !== titles.filter(Boolean).length) errors.push(`${label} repeats a title`);
  if (new Set(bodies.filter(Boolean)).size !== bodies.filter(Boolean).length) errors.push(`${label} repeats body copy`);
  return errors;
}

export function inspectPremiumContent(content) {
  const errors = [];
  const importantCopy = [
    "SEO_TITLE", "SEO_DESCRIPTION", "BUSINESS_NAME", "HEADLINE", "SUBHEADLINE", "INDUSTRY_LABEL", "LOCATION",
    "VISUAL_HEADLINE", "HIGHEST_PROFIT_SERVICE", "SERVICES_HEADING", "SERVICES_INTRO", "WHY_HEADING", "WHY_INTRO",
    "ABOUT_TITLE", "ABOUT_BODY", "PROCESS_HEADING", "PROCESS_INTRO", "PROOF_HEADING", "PROOF_INTRO", "FAQ_HEADING",
    "FAQ_INTRO", "CONTACT_HEADING", "CONTACT_BODY", "FOOTER_TAGLINE"
  ];
  for (const key of importantCopy) {
    if (!plainContentText(content?.[key])) errors.push(`${key} is empty`);
  }
  const minimumWords = {
    HEADLINE: 4,
    SUBHEADLINE: 10,
    SERVICES_INTRO: 7,
    WHY_INTRO: 7,
    ABOUT_BODY: 20,
    PROCESS_INTRO: 7,
    PROOF_INTRO: 7,
    FAQ_INTRO: 6,
    CONTACT_BODY: 8
  };
  for (const [key, minimum] of Object.entries(minimumWords)) {
    if (wordCount(content?.[key]) < minimum) errors.push(`${key} needs at least ${minimum} words`);
  }
  errors.push(...inspectCards(content?.SERVICES_HTML, "article", 3, 6, "SERVICES_HTML"));
  errors.push(...inspectCards(content?.DIFFERENTIATORS_HTML, "article", 3, 6, "DIFFERENTIATORS_HTML"));
  errors.push(...inspectCards(content?.PROCESS_HTML, "article", 3, 6, "PROCESS_HTML"));
  errors.push(...inspectCards(content?.PROOF_HTML, "article", 2, 6, "PROOF_HTML"));
  errors.push(...inspectCards(content?.FAQ_HTML, "details", 3, 8, "FAQ_HTML"));

  const trustItems = blockMatches(content?.TRUST_LINE_HTML, "span");
  const heroChips = blockMatches(content?.HERO_CHIPS_HTML, "span");
  const tickerItems = blockMatches(content?.TICKER_HTML, "span");
  if (trustItems.length < 2 || trustItems.length > 4) errors.push("TRUST_LINE_HTML requires 2-4 trust items");
  if (heroChips.length < 2 || heroChips.length > 4) errors.push("HERO_CHIPS_HTML requires 2-4 service chips");
  if (tickerItems.length < 3 || tickerItems.length > 8) errors.push("TICKER_HTML requires 3-8 service items");

  const highestProfitService = normalizedText(content?.HIGHEST_PROFIT_SERVICE);
  if (!highestProfitService || !normalizedText(content?.SERVICES_HTML).includes(highestProfitService)) {
    errors.push("HIGHEST_PROFIT_SERVICE must appear in SERVICES_HTML");
  }
  const form = blockMatches(content?.CONTACT_ACTION_HTML, "form")[0] || "";
  if (form) {
    const submitText = plainContentText(form.match(/<button\b[^>]*type=["']submit["'][^>]*>[\s\S]*?<\/button>/i)?.[0] || "");
    if (normalizedText(submitText) !== normalizedText(content?.PRIMARY_CTA_LABEL)) {
      errors.push("lead form submit text must exactly match PRIMARY_CTA_LABEL");
    }
  }

  const publicCopyParts = Object.entries(content || {})
    .filter(([key]) => !/(?:_COLOR|_HREF)$/.test(key) && !["LOGO_HTML", "HERO_MEDIA_HTML", "ABOUT_MEDIA_HTML", "GALLERY_HTML"].includes(key))
    .map(([, value]) => plainContentText(value));
  const publicCopy = publicCopyParts.join("\n");
  if (fillerPattern.test(publicCopy)) errors.push("placeholder or unfinished copy is visible");
  const unsupportedClaims = publicCopyParts.flatMap(unsupportedMarketingClaims);
  return { errors: [...new Set(errors)], unsupportedClaims };
}

export function assertPremiumContentContract(content) {
  const report = inspectPremiumContent(content);
  if (report.errors.length) throw new Error(`ARC_CONTENT_QUALITY_INVALID: ${report.errors.join("; ")}`);
  if (report.unsupportedClaims.length) {
    throw new Error(`ARC_CLAIM_EVIDENCE_REQUIRED: ${report.unsupportedClaims.map(item => item.kind).join(",")}`);
  }
  return true;
}
