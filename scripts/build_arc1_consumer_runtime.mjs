import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const coreUrl = new URL("scripts/arc1_consumer_contract.mjs", root);
const runtimeUrl = new URL("scripts/arc1_consumer_runtime.mjs", root);
const bundleUrl = new URL("zapier/arc1_consumer_runtime.js", root);
const manifestUrl = new URL("zapier/arc1_consumer_runtime.manifest.json", root);
const checkOnly = process.argv.includes("--check");
const sha256 = value => createHash("sha256").update(value).digest("hex");

const [coreSource, runtimeSource] = await Promise.all([
  readFile(coreUrl, "utf8"),
  readFile(runtimeUrl, "utf8"),
]);

const transformedCore = coreSource
  .replace('import { createHash, createHmac, timingSafeEqual } from "node:crypto";',
    'const { createHash, createHmac, timingSafeEqual } = require("crypto");')
  .replace(/^export\s+/gm, "");
const transformedRuntime = runtimeSource
  .replace(/^import \{[\s\S]*?\} from "\.\/arc1_consumer_contract\.mjs";\n\n/, "")
  .replace(/^export\s+/gm, "");

const runtimeCoreImports = [
  "arc1ConsumerHmacHex",
  "arc1ConsumerSafeEqualHex",
  "arc1ConsumerSha256Hex",
  "canonicalJson",
  "claimArc1ConsumerPacket",
  "completeArc1ConsumerPacket",
  "createArc1DurableResultReceipt",
  "resolveArc1ConsumerEnvironment",
  "verifyArc1ConsumerPacket",
  "verifyArc1MutationFence",
];

if (transformedCore.includes("export ") || transformedRuntime.includes("export ") || transformedRuntime.startsWith("import ")) {
  throw new Error("ARC1_CONSUMER_BUNDLE_INVALID: unsupported module syntax");
}

const bundle = [
  "// GENERATED FILE. Do not edit; run `node scripts/build_arc1_consumer_runtime.mjs`.",
  "// NOT PROVIDER-READY: use only in a private Node 18+ integration after the deployment contract passes.",
  "// The provider must redact raw step inputs/outputs and must not retain packet JSON in run history.",
  "",
  "const arc1ConsumerCore = (() => {",
  transformedCore.trim(),
  `return Object.freeze({ ${runtimeCoreImports.join(", ")} });`,
  "})();",
  `const { ${runtimeCoreImports.join(", ")} } = arc1ConsumerCore;`,
  "",
  transformedRuntime.trim(),
  "",
  "if (typeof inputData === \"undefined\") throw new Error(\"ARC1_RUNTIME_INVALID: inputData unavailable\");",
  "const arc1CodeStepFetch = typeof fetch === \"function\" ? fetch : globalThis.fetch;",
  "const arc1CodeStepRuntimeEnv = typeof process === \"object\" && process && process.env ? process.env : undefined;",
  "return await runArc1ConsumerCodeStep(inputData, { fetch: arc1CodeStepFetch, runtimeEnv: arc1CodeStepRuntimeEnv });",
  "",
].join("\n");

const manifest = `${JSON.stringify({
  schema: "arc-intake-arc1-consumer-runtime-manifest-v1",
  bundle: "zapier/arc1_consumer_runtime.js",
  bundle_sha256: sha256(bundle),
  bundle_bytes: Buffer.byteLength(bundle, "utf8"),
  sources: {
    "scripts/arc1_consumer_contract.mjs": sha256(coreSource),
    "scripts/arc1_consumer_runtime.mjs": sha256(runtimeSource),
  },
  execution: {
    minimum_node_major: 18,
    phases: ["CLAIM", "AUTHORIZE", "COMPLETE"],
    private_history_redaction_required: true,
    encrypted_host_secret_injection_required: true,
    raw_private_state_output_history_forbidden: true,
    authoritative_provider_persistence_readback_required: true,
    local_hmac_receipt_alone_proves_persistence: false,
    private_state_operation_timeout_default_ms: 5000,
    private_state_operation_timeout_maximum_ms: 5000,
    private_state_timeout_capped_by_claim_deadline: true,
    private_state_abort_signal_propagated: true,
    external_calls_default_off: true,
  },
  activation_flags: {
    ARC_INTAKE_ARC1_CONSUMER_CLAIM_ENABLED: false,
    ARC_INTAKE_ARC1_CONSUMER_COMPLETION_ENABLED: false,
    ARC_INTAKE_ARC1_CONSUMER_RUNTIME_ENABLED: false,
    ARC_INTAKE_ARC1_CONSUMER_PRIVATE_STATE_ENABLED: false,
    ARC_INTAKE_ARC1_PROVIDER_WORK_ENABLED: false,
    ARC_INTAKE_ARC1_HISTORY_REDACTION_ATTESTED: false,
    ARC_INTAKE_ARC1_INPUTDATA_SECRET_COMPATIBILITY_ENABLED: false,
  },
  live_verified: false,
}, null, 2)}\n`;

if (checkOnly) {
  const [existingBundle, existingManifest] = await Promise.all([
    readFile(bundleUrl, "utf8"),
    readFile(manifestUrl, "utf8"),
  ]);
  if (existingBundle !== bundle || existingManifest !== manifest) {
    throw new Error("ARC1_CONSUMER_BUNDLE_STALE: rebuild the committed bundle and manifest");
  }
  console.log(`ARC1 consumer runtime bundle verified: ${sha256(bundle)}`);
} else {
  await Promise.all([
    writeFile(bundleUrl, bundle, "utf8"),
    writeFile(manifestUrl, manifest, "utf8"),
  ]);
  console.log(`ARC1 consumer runtime bundle built: ${sha256(bundle)}`);
}
