import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(path.join(projectRoot, ".github/workflows/preview-quality.yml"), "utf8");
const dependabot = await readFile(path.join(projectRoot, ".github/dependabot.yml"), "utf8");
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));

assert.match(workflow, /repository:\s*arcwebhq-cpu\/arc-site\s*\n\s*ref:\s*c9fe3d2304bc6b37169c53055ab67edeb44a16ff\s*\n\s*path:\s*\.arc-site-contract/,
  "CI must execute against the reviewed ARC1 v2 site producer authority.");
assert.match(workflow, /preview-quality:[\s\S]*permissions:\s*\n\s*contents:\s*read\s*\n\s*pages:\s*read/,
  "The quality job must retain least-privilege Pages settings readback access.");
assert.equal((workflow.match(/run:\s*node scripts\/verify_pages_source\.mjs/g) || []).length, 2,
  "Both the quality and deploy jobs must fail closed unless Pages remains Actions-only.");
assert.equal((workflow.match(/GITHUB_TOKEN:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/g) || []).length, 2,
  "Both Pages source readbacks must use the scoped workflow token.");
assert.match(workflow, /run:\s*npm ci --prefix \.arc-site-contract\s*$/m,
  "CI must install the pinned ARC site contract's exact dependencies before importing its runtime modules.");
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
