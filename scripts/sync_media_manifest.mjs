import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "config/media-manifest.json"), "utf8"));
const templatePath = path.join(root, "ARC_MASTER_TEMPLATE.html");
const template = await readFile(templatePath, "utf8");

const imageExpression = profile => {
  if (profile.provider === "pexels") {
    return `[${profile.photo_ids.map(id => `pexels(${JSON.stringify(id)})`).join(",")} ]`;
  }
  if (profile.provider === "unsplash") {
    return `[${profile.photo_ids.map(id => `unsplash(${JSON.stringify(id)})`).join(",")} ]`;
  }
  return JSON.stringify(profile.urls || []);
};

const profiles = manifest.profiles.map(profile => `        {
          key:${JSON.stringify(profile.key)},
          layout:${JSON.stringify(profile.layout)},
          variant:${JSON.stringify(profile.variant)},
          alt:${JSON.stringify(profile.alt)},
          match:new RegExp(${JSON.stringify(profile.match)},"i"),
          provider:${JSON.stringify(profile.provider)},
          images:${imageExpression(profile)}
        }`).join(",\n");

const replacement = `const unsplash = id => \`https://images.unsplash.com/\${id}?auto=format&fit=crop&w=1800&q=82\`;
      const pexels = id => \`https://images.pexels.com/photos/\${id}/pexels-photo-\${id}.jpeg?auto=compress&cs=tinysrgb&w=1800\`;
      /* ARC_MEDIA_MANIFEST_START v${manifest.version} */
      const mediaPresets = [
${profiles}
      ];
      /* ARC_MEDIA_MANIFEST_END */
      const expectedMediaProfile=(document.body.dataset.arcExpectedMediaProfile || "").trim();
      const media =`;

const next = template.replace(
  /const unsplash = id =>[\s\S]*?\n      const media =/,
  replacement
);

if (!template.includes("/* ARC_MEDIA_MANIFEST_START")) {
  throw new Error("ARC media manifest marker could not be found");
}
if (next === template) {
  console.log(`ARC media manifest already synced (v${manifest.version}).`);
  process.exit(0);
}
await writeFile(templatePath, next);
console.log(`Synced ${manifest.profiles.length} ARC media profiles (v${manifest.version}).`);
