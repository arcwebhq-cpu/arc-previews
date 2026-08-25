import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(path.join(projectRoot, ".github/workflows/preview-quality.yml"), "utf8");
const dependabot = await readFile(path.join(projectRoot, ".github/dependabot.yml"), "utf8");

const reviewedActions = new Map([
  ["actions/checkout", { sha: "11d5960a326750d5838078e36cf38b85af677262", version: "v4.4.0", count: 3 }],
  ["actions/setup-node", { sha: "49933ea5288caeca8642d1e84afbd3f7d6820020", version: "v4.4.0", count: 2 }],
  ["actions/upload-artifact", { sha: "ea165f8d65b6e75b540449e92b4886f43607fa02", version: "v4.6.2", count: 1 }],
  ["actions/configure-pages", { sha: "983d7736d9b0ae728b81ab479565c72886d7745b", version: "v5.0.0", count: 1 }],
  ["actions/upload-pages-artifact", { sha: "56afc609e74202658d3ffba0e8f6dda462b719fa", version: "v3.0.1", count: 1 }],
  ["actions/deploy-pages", { sha: "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", version: "v4.0.5", count: 1 }]
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
