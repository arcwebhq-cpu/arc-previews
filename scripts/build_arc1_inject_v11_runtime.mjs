import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const sourceUrl = new URL("scripts/arc1_inject_v11_runtime.mjs", root);
const templateUrl = new URL("ARC_MASTER_TEMPLATE_V11.html", root);
const injectorUrl = new URL("zapier/arc1_inject.js", root);
const manifestUrl = new URL("zapier/arc1_inject_v11_runtime.manifest.json", root);
const checkOnly = process.argv.includes("--check");
const begin = "// BEGIN GENERATED ARC1 V11 RENDER RUNTIME — DO NOT EDIT";
const end = "// END GENERATED ARC1 V11 RENDER RUNTIME";
const insertion = "const template = clean(inputData.template_content || inputData.template_html);";
const sha256 = value => createHash("sha256").update(value).digest("hex");

const [source, template, currentInjector] = await Promise.all([
  readFile(sourceUrl, "utf8"),
  readFile(templateUrl, "utf8"),
  readFile(injectorUrl, "utf8")
]);
const runtime = source.replace(/^export\s+/gm, "").trim();
if (/^\s*(?:import|export)\s/m.test(runtime)) {
  throw new Error("ARC1_INJECT_V11_RUNTIME_INVALID: unsupported module syntax remains");
}
const block = `${begin}\n${runtime}\n${end}`;
let injector;
const blockPattern = new RegExp(`${begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
if (blockPattern.test(currentInjector)) injector = currentInjector.replace(blockPattern, block);
else {
  if (!currentInjector.includes(insertion)) throw new Error("ARC1_INJECT_V11_RUNTIME_INVALID: insertion marker is missing");
  injector = currentInjector.replace(insertion, `${block}\n\n${insertion}`);
}
const manifest = `${JSON.stringify({
  schema: "arc1-inject-v11-render-runtime-manifest-v1",
  runtime_version: "arc1-inject-v11-render-runtime-v1",
  source: "scripts/arc1_inject_v11_runtime.mjs",
  source_sha256: sha256(source),
  inline_runtime_sha256: sha256(runtime),
  template: "ARC_MASTER_TEMPLATE_V11.html",
  template_sha256: sha256(template),
  injector: "zapier/arc1_inject.js",
  injector_sha256: sha256(injector),
  page_count: 5,
  logical_page_paths: ["index.html", "services/index.html", "about/index.html", "process/index.html", "contact/index.html"],
  artifact_page_paths: ["about/index.html", "contact/index.html", "process/index.html", "services/index.html", "index.html"]
}, null, 2)}\n`;

if (checkOnly) {
  const currentManifest = await readFile(manifestUrl, "utf8");
  if (currentInjector !== injector || currentManifest !== manifest) {
    throw new Error("ARC1_INJECT_V11_RUNTIME_STALE: rebuild the checked inline runtime and manifest");
  }
  console.log(`ARC1 injector v11 runtime verified: ${sha256(runtime)}`);
} else {
  await Promise.all([writeFile(injectorUrl, injector, "utf8"), writeFile(manifestUrl, manifest, "utf8")]);
  console.log(`ARC1 injector v11 runtime built: ${sha256(runtime)}`);
}
