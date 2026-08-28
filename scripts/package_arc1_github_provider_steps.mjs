import { createHash, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ARC1_PROVIDER_STEP_TRUST_ROOT_SENTINEL = "@@ARC1_PRIVATE_STATE_AUTHORIZATION_PUBLIC_KEYRING_JSON@@";
export const ARC1_PROVIDER_STEP_CONFIG_SCHEMA = "arc1-zapier-provider-step-deployment-config-v1";

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const TRUST_ROOT_ID_PATTERN = /^arc1-trust-[a-z0-9][a-z0-9_-]{3,47}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: canonical JSON value");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new TypeError(`ARC1_PROVIDER_STEP_PACKAGE_INVALID: ${label} fields`);
  }
}

export function validateArc1ProviderStepDeploymentConfig(config) {
  exactKeys(config, ["authorization_public_keyring", "schema", "trust_root_id"], "deployment config");
  if (config.schema !== ARC1_PROVIDER_STEP_CONFIG_SCHEMA ||
      !TRUST_ROOT_ID_PATTERN.test(config.trust_root_id)) {
    throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: deployment config identity");
  }
  if (!isPlainObject(config.authorization_public_keyring)) {
    throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: authorization public keyring");
  }
  const entries = Object.entries(config.authorization_public_keyring);
  if (entries.length < 1 || entries.length > 16) {
    throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: authorization public keyring size");
  }
  for (const [keyId, record] of entries) {
    exactKeys(record, ["issuer", "public_key_pem"], `authorization public key ${keyId}`);
    if (!KEY_ID_PATTERN.test(keyId) || record.issuer !== "private-state-authorization-adapter" ||
        typeof record.public_key_pem !== "string" || record.public_key_pem.length < 80 ||
        record.public_key_pem.length > 2048 || /PRIVATE KEY/.test(record.public_key_pem)) {
      throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: authorization public key record");
    }
    let key;
    try { key = createPublicKey(record.public_key_pem); } catch {
      throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: authorization public key PEM");
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: authorization key must be Ed25519 public key");
    }
  }
  const keyringJson = canonicalJson(config.authorization_public_keyring);
  return Object.freeze({
    trustRootId: config.trust_root_id,
    keyringJson,
    keyringSha256: sha256(keyringJson),
  });
}

export function packageArc1GithubProviderStepSource(templateSource, config) {
  if (typeof templateSource !== "string" || !templateSource) {
    throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: template source");
  }
  const validated = validateArc1ProviderStepDeploymentConfig(config);
  const sentinelLiteral = JSON.stringify(ARC1_PROVIDER_STEP_TRUST_ROOT_SENTINEL);
  const occurrences = templateSource.split(sentinelLiteral).length - 1;
  if (occurrences !== 1) {
    throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: trust-root sentinel count");
  }
  const bundled = templateSource.replace(sentinelLiteral, JSON.stringify(validated.keyringJson));
  if (bundled.includes(ARC1_PROVIDER_STEP_TRUST_ROOT_SENTINEL) ||
      /inputData\.async_(?:readback|authorization)[a-z0-9_]*public_keyring/i.test(bundled) ||
      /-----BEGIN (?:ED25519 )?PRIVATE KEY-----/.test(bundled)) {
    throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: unsafe bundled source");
  }
  return Object.freeze({
    source: bundled,
    sourceSha256: sha256(bundled),
    templateSha256: sha256(templateSource),
    trustRootId: validated.trustRootId,
    keyringSha256: validated.keyringSha256,
  });
}

export async function packageArc1GithubProviderSteps({ config, outputDirectory }) {
  if (typeof outputDirectory !== "string" || !outputDirectory.trim()) {
    throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: explicit output directory required");
  }
  const root = new URL("../", import.meta.url);
  const templates = ["arc1_publish_preview_pr.js", "arc1_merge_preview_pr.js"];
  const outputRoot = resolve(outputDirectory);
  const packaged = [];
  for (const name of templates) {
    const source = await readFile(new URL(`zapier/${name}`, root), "utf8");
    const bundle = packageArc1GithubProviderStepSource(source, config);
    packaged.push({ source: bundle.source, manifest: {
      file: name,
      sha256: bundle.sourceSha256,
      template_sha256: bundle.templateSha256,
    } });
  }
  const validated = validateArc1ProviderStepDeploymentConfig(config);
  const manifest = {
    schema: "arc1-zapier-github-provider-step-bundle-manifest-v1",
    trust_root_id: validated.trustRootId,
    authorization_public_keyring_sha256: validated.keyringSha256,
    caller_controlled_trust_root_allowed: false,
    atomic_authorization_consumption_receipt_required: true,
    provider_adapter_e2e_verified: false,
    files: packaged.map(item => item.manifest),
  };
  await mkdir(outputRoot, { recursive: false });
  for (const item of packaged) {
    await writeFile(resolve(outputRoot, item.manifest.file), item.source, { encoding: "utf8", flag: "wx" });
  }
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" });
  return Object.freeze({ outputDirectory: outputRoot, manifest });
}

async function main() {
  const args = process.argv.slice(2);
  const valueFor = flag => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : "";
  };
  const configPath = valueFor("--config");
  const outputDirectory = valueFor("--output");
  if (!configPath || !outputDirectory || args.length !== 4) {
    throw new Error("Usage: node scripts/package_arc1_github_provider_steps.mjs --config <public-config.json> --output <new-directory>");
  }
  const raw = await readFile(configPath, "utf8");
  let config;
  try { config = JSON.parse(raw); } catch { throw new TypeError("ARC1_PROVIDER_STEP_PACKAGE_INVALID: config JSON"); }
  const result = await packageArc1GithubProviderSteps({ config, outputDirectory });
  process.stdout.write(`${basename(result.outputDirectory)}: ${result.manifest.files.length} provider steps packaged\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
