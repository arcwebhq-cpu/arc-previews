import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(path.join(projectRoot, ".github/workflows/preview-quality.yml"), "utf8");
const dependabot = await readFile(path.join(projectRoot, ".github/dependabot.yml"), "utf8");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const binding = JSON.parse(await readFile(path.join(projectRoot, "config/arc-site-partner-binding.json"), "utf8"));
const bindingVerifier = await readFile(path.join(projectRoot, "scripts/verify_arc_site_partner_contract.mjs"), "utf8");

assert.match(workflow, /repository:\s*arcwebhq-cpu\/arc-site\s*\n\s*ref:\s*main\s*\n\s*path:\s*\.arc-site-contract\s*\n\s*persist-credentials:\s*false/,
  "The reverse partner checkout must use main without retaining credentials.");
assert.match(workflow, /preview-quality:[\s\S]*permissions:\s*\n\s*contents:\s*read\s*\n\s*pages:\s*read/,
  "The quality job must retain least-privilege Pages settings readback access.");
assert.equal((workflow.match(/run:\s*node scripts\/verify_pages_source\.mjs/g) || []).length, 2,
  "Both the quality and deploy jobs must fail closed unless Pages remains Actions-only.");
assert.equal((workflow.match(/GITHUB_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/g) || []).length, 2,
  "Both Pages source readbacks must use the scoped workflow token.");
assert.match(workflow, /run:\s*npm ci --ignore-scripts --no-audit --no-fund --prefix \.arc-site-contract\s*$/m,
  "Verified partner dependencies must install with lifecycle scripts disabled.");
assert.match(workflow, /run:\s*npm ci --ignore-scripts --no-audit --no-fund\s*$/m,
  "Preview dependency installation must also disable lifecycle scripts.");
assert.match(workflow, /run:\s*npx --no-install playwright install --with-deps chromium\s*$/m,
  "Browser setup must use the already locked local Playwright package.");
const verifyIndex = workflow.indexOf("run: node scripts/verify_arc_site_partner_contract.mjs");
const installIndex = workflow.indexOf("run: npm ci --ignore-scripts --no-audit --no-fund --prefix .arc-site-contract");
const reverifyIndex = workflow.lastIndexOf("run: node scripts/verify_arc_site_partner_contract.mjs");
const testIndex = workflow.indexOf("run: npm test");
assert.equal((workflow.match(/run:\s*node scripts\/verify_arc_site_partner_contract\.mjs/g) || []).length, 2);
assert.ok(verifyIndex > 0 && installIndex > verifyIndex && reverifyIndex > installIndex &&
  testIndex > reverifyIndex,
"The mutable partner checkout must be verified before installation and again before test execution.");
assert.equal(binding.schema, "arc-previews-site-contract-binding-v1");
assert.equal(binding.repository, "arcwebhq-cpu/arc-site");
assert.equal(binding.ref, "main");
assert.equal(binding.binding_mode, "mutable-ref-fail-closed-before-execution-content-digest");
assert.match(binding.bundle.sha256, /^[a-f0-9]{64}$/);
assert.ok(Number.isSafeInteger(binding.bundle.entry_count) && binding.bundle.entry_count > 0);
assert.deepEqual(binding.bundle.directories, ["netlify/lib", "vendor/image-size-disabled"]);
assert.deepEqual(binding.bundle.files,
  ["netlify/functions/arc2-handoff-start.mjs", "operations/review-activation-environment.json",
    "package-lock.json", "package.json"]);
assert.match(bindingVerifier, /forbiddenNpmControlFiles = Object\.freeze\(\['\.npmrc', 'npm-shrinkwrap\.json'\]\)/);
assert.match(bindingVerifier, /entry\.isSymbolicLink\(\)/);
assert.match(bindingVerifier, /assertNoSymlinkAncestors/);
assert.match(bindingVerifier, /assert\.deepEqual\(manifest\.bundle, binding\.bundle/);
assert.match(bindingVerifier, /experimental-vm-modules/,
  "The trusted verifier must parse static module requests without executing partner code.");
assert.match(bindingVerifier, /import escapes the covered partner set/);
assert.match(bindingVerifier, /must not use a dynamic import in the partner contract/);
assert.match(bindingVerifier, /must use SHA-512 package integrity/);
assert.match(bindingVerifier, /registry\.npmjs\.org/);
assert.match(bindingVerifier, /allowedCoveredDataFiles/);
assert.match(bindingVerifier, /has an unreviewed covered file type/);
assert.doesNotMatch(bindingVerifier, /localeCompare/,
  "Partner path ordering must not depend on host ICU locale behavior.");
assert.match(bindingVerifier, /updateBinding/,
  "A deterministic, manifest-verified binding update path must remain available.");
assert.match(packageJson.scripts["test"], /^npm run test:site-binding &&/,
  "Local and CI gates must fail before executing a changed partner contract.");
assert.match(packageJson.scripts["test:arc1-consumer"], /tests\/arc1_site_packet_runtime_contract\.mjs/,
  "The quality gate must execute a real pinned site packet through the generated runtime bundle.");

const reviewedActions = new Map([
  ["actions/checkout", { sha: "3d3c42e5aac5ba805825da76410c181273ba90b1", version: "v7.0.1", count: 3 }],
  ["actions/setup-node", { sha: "820762786026740c76f36085b0efc47a31fe5020", version: "v7.0.0", count: 2 }],
  ["actions/upload-artifact", { sha: "ea165f8d65b6e75b540449e92b4886f43607fa02", version: "v4.6.2", count: 1 }],
  ["actions/configure-pages", { sha: "45bfe0192ca1faeb007ade9deae92b16b8254a0d", version: "v6.0.0", count: 1 }],
  ["actions/upload-pages-artifact", { sha: "fc324d3547104276b827a68afc52ff2a11cc49c9", version: "v5.0.0", count: 1 }],
  ["actions/deploy-pages", { sha: "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128", version: "v5.0.0", count: 1 }]
]);

const uses = [...workflow.matchAll(/^[ \t]*-?[ \t]*uses:[ \t]+([^ \t#]+)(?:[ \t]+#[ \t]*(\S+))?[ \t]*$/gm)].map(match => ({
  action: match[1].split("@")[0],
  ref: match[1].split("@")[1],
  version: match[2]
}));

assert.equal(uses.length, 9, "every reviewed third-party action use must remain visible to this contract");
for (const use of uses) {
  assert.match(use.ref ?? "", /^[a-f0-9]{40}$/, `${use.action} must use an immutable full commit SHA`);
  assert.match(use.version ?? "", /^v\d+\.\d+\.\d+$/, `${use.action} must retain a human-readable release comment`);
  const reviewed = reviewedActions.get(use.action);
  assert.ok(reviewed, `unreviewed action introduced: ${use.action}`);
  assert.equal(use.ref, reviewed.sha, `${use.action} SHA changed without review`);
  assert.equal(use.version, reviewed.version, `${use.action} version comment changed without review`);
}

for (const [action, reviewed] of reviewedActions) {
  assert.equal(uses.filter(use => use.action === action).length, reviewed.count, `${action} use count changed`);
}

assert.match(dependabot, /^version:\s*2\s*$/m);
const updateBlocks = dependabot.split(/(?=^[ \t]*-[ \t]+package-ecosystem:)/m).slice(1);
assert.equal(updateBlocks.length, 2, "Dependabot must contain only the reviewed update ecosystems");
for (const ecosystem of ["github-actions", "npm"]) {
  const block = updateBlocks.find(candidate => new RegExp(`package-ecosystem:\\s*["']?${ecosystem}["']?`).test(candidate));
  assert.ok(block, `Dependabot must monitor ${ecosystem}`);
  assert.match(block, /directory:\s*["']\/["']/);
  assert.match(block, /interval:\s*["']?weekly["']?/);
}

console.log("ARC workflow supply-chain contract passed.");
