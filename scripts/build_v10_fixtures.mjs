import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures as launchFixtures } from "../fixtures/v10_industries.mjs";
import { mediaCoverageFixtures } from "../fixtures/v10_media_coverage.mjs";
import { renderPreview } from "./arc_contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(path.join(root, "ARC_MASTER_TEMPLATE.html"), "utf8");
const validatorSource = await readFile(path.join(root, "arc_step7_validator.js"), "utf8");
const validate = new Function("inputData", validatorSource);
const manifest = [];
const fixtures = [...launchFixtures, ...mediaCoverageFixtures];

for (const fixture of fixtures) {
  const rendered = renderPreview(template, fixture.content, {
    trustedEventPrefix: fixture.id,
    customerEmail: fixture.customerEmail
  });
  const validation = validate({
    html_content: rendered.html,
    raw_json: JSON.stringify(rendered.content),
    file_path: rendered.filePath,
    business_name: rendered.content.BUSINESS_NAME,
    customer_email: fixture.customerEmail,
    trusted_event_prefix: fixture.id,
    preview_url: rendered.previewUrl,
    expected_cta: rendered.content.PRIMARY_CTA_LABEL,
    main_call_to_action: rendered.content.PRIMARY_CTA_LABEL,
    final_placeholder_count: rendered.finalPlaceholderCount,
    template_placeholder_count: rendered.templatePlaceholderCount,
    html_character_count: rendered.htmlCharacterCount,
    template_comment: "ARC Client Master Template v10.0"
  });
  if (!validation.validation_pass || validation.semantic_media_profile !== fixture.expectedProfile) {
    throw new Error(`ARC_FIXTURE_FAILED: ${rendered.folder}`);
  }
  const directory = path.join(root, "qa-v10", rendered.folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), rendered.html);
  manifest.push({
    folder: rendered.folder,
    file: `qa-v10/${rendered.folder}/index.html`,
    expectedProfile: fixture.expectedProfile,
    isLaunch: fixture.isLaunch,
    previewUrl: rendered.previewUrl,
    expectedMediaProfile: rendered.expectedMediaProfile,
    validationChecks: validation.validation_check_count
  });
  console.log(`Built ${rendered.folder} [${fixture.expectedProfile}]`);
}

await writeFile(path.join(root, "qa-v10/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built and validated ${manifest.length} ARC v10 industry fixtures.`);
