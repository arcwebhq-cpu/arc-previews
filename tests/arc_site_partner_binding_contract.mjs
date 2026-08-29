import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSite = path.resolve(process.env.ARC_SITE_DIR || path.join(root, '../arc-site'));
const verifier = path.join(root, 'scripts/verify_arc_site_partner_contract.mjs');
const temporarySite = await mkdtemp(path.join(os.tmpdir(), 'arc-site-partner-binding-'));

function verify(siteRoot) {
  return spawnSync(process.execPath, [verifier], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ARC_SITE_DIR: siteRoot },
  });
}

try {
  for (const directory of ['netlify/lib', 'vendor/image-size-disabled']) {
    await mkdir(path.join(temporarySite, path.dirname(directory)), { recursive: true });
    await cp(path.join(sourceSite, directory), path.join(temporarySite, directory), { recursive: true });
  }
  for (const file of [
    'netlify/functions/arc2-handoff-start.mjs',
    'operations/arc-site-partner-contract.json',
    'operations/review-activation-environment.json',
    'package-lock.json',
    'package.json',
  ]) {
    await mkdir(path.join(temporarySite, path.dirname(file)), { recursive: true });
    await cp(path.join(sourceSite, file), path.join(temporarySite, file));
  }

  const baseline = verify(temporarySite);
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

  const coveredFile = path.join(temporarySite, 'netlify/lib/arc2-handoff-core.mjs');
  const coveredSource = await readFile(coveredFile, 'utf8');
  await writeFile(coveredFile, `${coveredSource}\n// tamper\n`);
  const tampered = verify(temporarySite);
  assert.notEqual(tampered.status, 0, 'A changed covered byte must fail the binding');
  assert.match(`${tampered.stderr}\n${tampered.stdout}`, /does not match the reviewed partner-contract digest/);

  await writeFile(coveredFile, `${coveredSource}\nimport '../functions/uncovered.mjs';\n`);
  const escapedImport = verify(temporarySite);
  assert.notEqual(escapedImport.status, 0, 'A relative import outside the covered set must fail');
  assert.match(`${escapedImport.stderr}\n${escapedImport.stdout}`, /import escapes the covered partner set/);

  await writeFile(coveredFile, `${coveredSource}\nvoid import('.\/arc2-handoff-store.mjs');\n`);
  const dynamicImport = verify(temporarySite);
  assert.notEqual(dynamicImport.status, 0, 'A dynamic partner import must fail');
  assert.match(`${dynamicImport.stderr}\n${dynamicImport.stdout}`, /must not use a dynamic import/);

  const helperPath = path.join(temporarySite, 'netlify/lib/closure-helper.js');
  await writeFile(coveredFile, `${coveredSource}\nimport '.\/closure-helper.js';\n`);
  await writeFile(helperPath, "import '../../outside-contract.mjs';\n");
  const alternateSuffix = verify(temporarySite);
  assert.notEqual(alternateSuffix.status, 0,
    'A future executable suffix must not bypass transitive import closure');
  assert.match(`${alternateSuffix.stderr}\n${alternateSuffix.stdout}`, /has an unreviewed covered file type/);
  await rm(helperPath);

  await writeFile(coveredFile, coveredSource);
  const lockPath = path.join(temporarySite, 'package-lock.json');
  const packageLock = JSON.parse(await readFile(lockPath, 'utf8'));
  delete packageLock.packages['node_modules/stripe'].integrity;
  await writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
  const unlockedPackage = verify(temporarySite);
  assert.notEqual(unlockedPackage.status, 0, 'An external package without integrity must fail');
  assert.match(`${unlockedPackage.stderr}\n${unlockedPackage.stdout}`, /is not contained in an integrity-bound package/);

  await cp(path.join(sourceSite, 'package-lock.json'), lockPath);
  const extraFile = path.join(temporarySite, 'netlify/lib/unreviewed-extra.mjs');
  await writeFile(extraFile, 'export default true;\n');
  const unexpected = verify(temporarySite);
  assert.notEqual(unexpected.status, 0, 'An unexpected file in a covered tree must fail the binding');
  assert.match(`${unexpected.stderr}\n${unexpected.stdout}`, /does not match the reviewed partner-contract digest/);

  await rm(extraFile);
  const functionsDirectory = path.join(temporarySite, 'netlify/functions');
  await rm(functionsDirectory, { recursive: true });
  await symlink(path.join(sourceSite, 'netlify/functions'), functionsDirectory, 'dir');
  const ancestorSymlink = verify(temporarySite);
  assert.notEqual(ancestorSymlink.status, 0, 'A symlinked intermediate path must fail the binding');
  assert.match(`${ancestorSymlink.stderr}\n${ancestorSymlink.stdout}`, /symbolic-link path component/);
} finally {
  await rm(temporarySite, { recursive: true, force: true });
}

console.log('ARC site partner binding tamper contract passed.');
