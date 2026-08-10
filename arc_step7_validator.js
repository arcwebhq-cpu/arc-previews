// ARC fail-closed contract, CTA, logo, form, copy, media, contrast, and template validation.
const clean = value => String(value == null ? "" : value).trim();
const html = clean(inputData.html_content);
const rawJson = clean(inputData.raw_json)
  .replace(/^```json\s*/i, "")
  .replace(/^```\s*/, "")
  .replace(/\s*```$/, "");
const filePath = clean(inputData.file_path);
const businessName = clean(inputData.business_name);
const customerEmail = clean(inputData.customer_email);
const submissionId = clean(inputData.submission_id);
const previewUrl = clean(inputData.preview_url);
const expectedCta = clean(inputData.expected_cta || inputData.main_call_to_action);
const mappedCta = clean(inputData.main_call_to_action);
const expectedLogoUrl = clean(inputData.expected_logo_url || inputData.logo_file_url);
const mappedLogoUrl = clean(inputData.logo_file_url);

let generated = {};
let jsonParsePass = true;
try {
  generated = JSON.parse(rawJson || "{}");
} catch (error) {
  jsonParsePass = false;
}

const requiredKeys = [
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
];

const generatedKeys = Object.keys(generated);
const missingKeys = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(generated, key));
const extraKeys = generatedKeys.filter(key => !requiredKeys.includes(key));
const unresolvedPlaceholders = html.match(/\[\[[A-Z0-9_]+\]\]/g) || [];
const declaredFinalCount = Number(inputData.final_placeholder_count);
const declaredTemplateCount = Number(inputData.template_placeholder_count);
const declaredHtmlCount = Number(inputData.html_character_count);

const markerMatch = html.match(/ARC Client Master Template v(\d+(?:\.\d+)?)/i);
const commentMatch = clean(inputData.template_comment).match(
  /ARC Client Master Template v(\d+(?:\.\d+)?)/i
);
const versionMatch = markerMatch || commentMatch;
const templateVersion = versionMatch ? Number(versionMatch[1]) : NaN;

const slugify = value =>
  clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const filePathMatch = filePath.match(
  /^([a-z0-9]+(?:-[a-z0-9]+)*)-([a-f0-9]{8})\/index\.html$/i
);
const pathBusinessSlug = filePathMatch ? filePathMatch[1].toLowerCase() : "";
const pathSubmissionPrefix = filePathMatch ? filePathMatch[2].toLowerCase() : "";
const businessSlug = slugify(businessName);
const filePathPass =
  Boolean(filePathMatch) &&
  Boolean(pathBusinessSlug) &&
  (
    pathBusinessSlug === businessSlug ||
    (pathBusinessSlug.length >= 8 && businessSlug.startsWith(pathBusinessSlug))
  );
const submissionPathPass =
  Boolean(filePathMatch) &&
  (
    !/^[a-f0-9]{8,}$/i.test(submissionId) ||
    pathSubmissionPrefix === submissionId.slice(0, 8).toLowerCase()
  );
const previewPathPass =
  !previewUrl ||
  previewUrl.toLowerCase().includes(`/${filePath.replace(/index\.html$/i, "").toLowerCase()}`);
const previewProtocolPass = !previewUrl || /^https:\/\//i.test(previewUrl);
const idempotencyKeyPass = Boolean(submissionId) && submissionPathPass;

const normalize = value => clean(value).replace(/\s+/g, " ").toLowerCase();
const generatedCta = clean(generated.PRIMARY_CTA_LABEL);
const ctaContractPass = !expectedCta || normalize(generatedCta) === normalize(expectedCta);
const mappedCtaPass = !mappedCta || !expectedCta || normalize(mappedCta) === normalize(expectedCta);
const ctaHtmlCount = expectedCta
  ? html.split(expectedCta).length - 1
  : generatedCta
    ? html.split(generatedCta).length - 1
    : 0;
const ctaHtmlPass = Boolean(generatedCta) && ctaHtmlCount >= 2;
const ctaHrefPass = /^(#|https?:\/\/|tel:|mailto:)/i.test(clean(generated.PRIMARY_CTA_HREF));

const filenameFromUrl = value => {
  try {
    const pathname = new URL(value).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
  } catch (error) {
    return decodeURIComponent(value.split("/").pop() || "");
  }
};
const expectedLogoFilename = expectedLogoUrl ? filenameFromUrl(expectedLogoUrl) : "";
const logoHtml = clean(generated.LOGO_HTML);
const logoContractPass = expectedLogoUrl
  ? logoHtml.includes(expectedLogoUrl) ||
    (expectedLogoFilename && logoHtml.includes(expectedLogoFilename))
  : logoHtml === "";
const mappedLogoPass =
  !mappedLogoUrl ||
  !expectedLogoUrl ||
  mappedLogoUrl === expectedLogoUrl ||
  filenameFromUrl(mappedLogoUrl) === expectedLogoFilename;
const logoRenderedPass = expectedLogoUrl
  ? html.includes(expectedLogoUrl) ||
    (expectedLogoFilename && html.includes(expectedLogoFilename))
  : true;

const formHtml = clean(generated.CONTACT_ACTION_HTML);
const formExists = /<form\b/i.test(formHtml);
const formContractPass =
  !formExists ||
  (
    /method=["']POST["']/i.test(formHtml) &&
    /\bdata-netlify=["']true["']/i.test(formHtml) &&
    /\bname=["'][^"']+["']/i.test(formHtml) &&
    /netlify-honeypot=/i.test(formHtml) &&
    /type=["']email["']/i.test(formHtml) &&
    /type=["']submit["']/i.test(formHtml)
  );
const formRenderedPass = !formExists || html.includes("data-netlify=") && html.includes("form-name");

const parseHex = value => {
  const raw = clean(value).replace(/^#/, "");
  const hex = raw.length === 3 ? raw.split("").map(char => char + char).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
};
const luminance = rgb => {
  if (!rgb) return null;
  const channels = rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrast = (first, second) => {
  const a = luminance(parseHex(first));
  const b = luminance(parseHex(second));
  if (a == null || b == null) return 0;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const bodyContrast = contrast(generated.TEXT_COLOR, generated.BACKGROUND_COLOR);
const buttonContrast = contrast(generated.PRIMARY_BUTTON_TEXT, generated.PRIMARY_COLOR);

const generatedMarkup = requiredKeys
  .filter(key => /_HTML$/.test(key))
  .map(key => clean(generated[key]))
  .join("\n");
const markupSafetyPass =
  !/<script\b/i.test(generatedMarkup) &&
  !/\bon[a-z]+\s*=/i.test(generatedMarkup) &&
  !/javascript\s*:/i.test(generatedMarkup) &&
  !/<iframe\b/i.test(generatedMarkup);
const generatedHrefValues = [...generatedMarkup.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)]
  .map(match => clean(match[1]))
  .filter(Boolean);
const generatedLinkSafetyPass = generatedHrefValues.every(value =>
  /^(#|https?:\/\/|tel:|mailto:|\/)/i.test(value)
);
const generatedImages = [...generatedMarkup.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
const generatedAltValues = generatedImages.map(tag => {
  const match = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
  return match ? clean(match[1]) : "";
});
const mediaAltPass = generatedAltValues.every(value => value.length > 0 && value.length <= 160);

const seoTitleLength = clean(generated.SEO_TITLE).length;
const seoDescriptionLength = clean(generated.SEO_DESCRIPTION).length;
const seoContractPass =
  seoTitleLength >= 15 &&
  seoTitleLength <= 70 &&
  seoDescriptionLength >= 50 &&
  seoDescriptionLength <= 170;

const plainText = value =>
  clean(value)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const wordCount = value => {
  const valueText = plainText(value);
  return valueText ? valueText.split(/\s+/).length : 0;
};
const copyLimits = {
  HEADLINE: 11,
  SUBHEADLINE: 32,
  SERVICES_INTRO: 32,
  SERVICES_HTML: 210,
  WHY_INTRO: 32,
  DIFFERENTIATORS_HTML: 190,
  ABOUT_BODY: 130,
  PROCESS_INTRO: 32,
  PROCESS_HTML: 170,
  GALLERY_INTRO: 28,
  PROOF_INTRO: 28,
  FAQ_INTRO: 28,
  FAQ_HTML: 330,
  CONTACT_BODY: 38
};
const copyDensityBreaches = Object.entries(copyLimits)
  .filter(([key, limit]) => wordCount(generated[key]) > limit)
  .map(([key, limit]) => `${key}:${wordCount(generated[key])}/${limit}`);
const copyDensityPass = copyDensityBreaches.length === 0;

const mediaMarkup = [
  generated.HERO_MEDIA_HTML,
  generated.ABOUT_MEDIA_HTML,
  generated.GALLERY_HTML
].map(clean).join("\n");
const mediaSources = [...mediaMarkup.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)]
  .map(match => match[1].split("?")[0].trim())
  .filter(Boolean);
const duplicateMediaSources = [...new Set(
  mediaSources.filter((source, index) => mediaSources.indexOf(source) !== index)
)];
const uniqueMediaPass = duplicateMediaSources.length === 0;

const baseStructurePass =
  /<!doctype html>/i.test(html) &&
  /<html\b/i.test(html) &&
  /<head\b/i.test(html) &&
  /<\/head>/i.test(html) &&
  /<body\b/i.test(html) &&
  /<\/body>/i.test(html) &&
  /<\/html>/i.test(html);
const securityPass =
  /Content-Security-Policy/i.test(html) &&
  /name=["']viewport["']/i.test(html) &&
  /name=["']robots["']/i.test(html);
const privatePreviewPass =
  /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*nofollow[^"']*["']/i.test(html);
const customerEmailPass =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) &&
  !html.toLowerCase().includes(customerEmail.toLowerCase());
const dummyLinkPass = generatedHrefValues.every(value =>
  !/^https?:\/\/(?:www\.)?(?:example\.(?:com|org|net)|localhost)(?:[/:?#]|$)/i.test(value) &&
  value !== "#"
);
const v9QualityPass =
  templateVersion < 9 ||
  (
    /data-industry=/i.test(html) &&
    html.includes("mediaPresets") &&
    html.includes("mobile-cta") &&
    html.includes("contentIsFake") &&
    html.includes("IntersectionObserver") &&
    (templateVersion < 9.1 || html.includes("flattenGeneratedGroup")) &&
    (
      templateVersion < 9.4 ||
      (
        html.includes("usedMediaSources") &&
        html.includes("nextMedia") &&
        html.includes("recoverImage") &&
        html.includes("srcset")
      )
    ) &&
    (
      templateVersion < 9.5 ||
      (
        html.includes("Curated preview imagery") &&
        html.includes("fitLogo") &&
        html.includes("arcHeroVisual")
      )
    ) &&
    (
      templateVersion < 9.6 ||
      (
        html.includes("ARC production hardening v9.6") &&
        privatePreviewPass
      )
    )
  );

const checks = {
  json_parse_pass: jsonParsePass,
  exact_58_key_contract_pass:
    jsonParsePass && generatedKeys.length === 58 && missingKeys.length === 0 && extraKeys.length === 0,
  template_version_pass: Number.isFinite(templateVersion) && templateVersion >= 9.6,
  template_marker_pass: Boolean(markerMatch),
  template_quality_pass: v9QualityPass,
  html_size_pass: html.length >= 30000,
  html_count_pass:
    Number.isFinite(declaredHtmlCount) && Math.abs(declaredHtmlCount - html.length) <= 8,
  base_structure_pass: baseStructurePass,
  security_metadata_pass: securityPass,
  private_preview_metadata_pass: privatePreviewPass,
  template_placeholder_contract_pass: declaredTemplateCount === 58,
  final_placeholder_count_pass: declaredFinalCount === 0,
  unresolved_placeholder_pass: unresolvedPlaceholders.length === 0,
  file_path_pass: filePathPass,
  submission_path_pass: submissionPathPass,
  preview_path_pass: previewPathPass,
  preview_protocol_pass: previewProtocolPass,
  idempotency_key_pass: idempotencyKeyPass,
  business_name_pass: Boolean(businessName) && normalize(html).includes(normalize(businessName)),
  customer_email_not_exposed_pass: customerEmailPass,
  primary_cta_contract_pass: ctaContractPass,
  mapped_cta_consistency_pass: mappedCtaPass,
  primary_cta_rendered_pass: ctaHtmlPass,
  primary_cta_href_pass: ctaHrefPass,
  logo_contract_pass: logoContractPass,
  mapped_logo_consistency_pass: mappedLogoPass,
  logo_rendered_pass: logoRenderedPass,
  form_contract_pass: formContractPass,
  form_rendered_pass: formRenderedPass,
  body_contrast_pass: bodyContrast >= 4.5,
  button_contrast_pass: buttonContrast >= 4.5,
  generated_markup_safety_pass: markupSafetyPass,
  generated_link_safety_pass: generatedLinkSafetyPass,
  dummy_link_pass: dummyLinkPass,
  media_alt_text_pass: mediaAltPass,
  seo_contract_pass: seoContractPass,
  concise_copy_contract_pass: copyDensityPass,
  unique_media_contract_pass: uniqueMediaPass
};

const failedChecks = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);

if (failedChecks.length) {
  throw new Error(`ARC_VALIDATION_FAILED: ${failedChecks.join(", ")}`);
}

return {
  status: "ALL_VALIDATIONS_PASSED",
  validation_pass: true,
  semantic_validation_pass: true,
  failed_checks: "none",
  validation_check_count: Object.keys(checks).length,
  template_version_detected: String(templateVersion),
  generated_key_count: generatedKeys.length,
  template_placeholder_count: declaredTemplateCount,
  final_placeholder_count: declaredFinalCount,
  html_character_count: html.length,
  business_name: businessName,
  customer_email: customerEmail,
  submission_id: submissionId,
  file_path: filePath,
  preview_url: previewUrl,
  expected_cta: expectedCta,
  primary_cta_label: generatedCta,
  primary_cta_occurrences: ctaHtmlCount,
  expected_logo_filename: expectedLogoFilename || "none",
  logo_contract_mode: expectedLogoUrl ? "uploaded_logo" : "text_fallback",
  contact_form_mode: formExists ? "netlify_form" : "direct_cta",
  body_contrast_ratio: bodyContrast.toFixed(2),
  button_contrast_ratio: buttonContrast.toFixed(2),
  seo_title_length: seoTitleLength,
  seo_description_length: seoDescriptionLength,
  copy_density_breaches: copyDensityBreaches.join(", ") || "none",
  generated_media_source_count: mediaSources.length,
  duplicate_media_sources: duplicateMediaSources.join(", ") || "none",
  missing_keys: missingKeys.join(", ") || "none",
  extra_keys: extraKeys.join(", ") || "none",
  ...checks
};
