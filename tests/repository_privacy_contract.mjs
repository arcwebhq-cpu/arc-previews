import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const protectedNameHashes = new Set([
  "f2e604d38c2363c1450d1a0fe2fb75ea7aaee39038d4a3f04210891a8b5733fe"
]);
const protectedPhoneHashes = new Set([
  "ea099f85ce2ab1e20cfa5581d3a5804b9683a79c1994e669c133c9fa441b2aab"
]);
const protectedAddressHashes = new Set([
  "e19eaa28325965c716382fc33b306c9de3d1587571ebd67ff65a9f13990f5eb3"
]);
const removedLegacyPathHashes = new Set([
  "4cb99a6da48af5e03041b45a35eaea6a849661000827e23c417a8cf1ba1a290e",
  "da5cbb95f376bc176fbb84643e8f177d81e7d120c86aa3d4a84660060a4c9fbf",
  "e0b34819fa156eb4674c737d558867c8fe4e77ca48399f2e3968220510a6fbe1",
  "adfe8bacec66466abb5133656e86d29afbcc45b1e9561151f76a70b506185f8a",
  "6d430771e88b38584e7db03825094d38dab2153bb8e3c208fff1b93f9f6fa686",
  "76546027e4ad25c04babe16c252be73fa3a3cf64e79c91a413a4987047650d94",
  "cd3d409a33210c8f24753e638300f5094267c23ef400ec2b0651b13f2704e9e2",
  "01b200ce1ddb419f43580a0b4ed9b2d244dfc508c2acaef6467942af509ff402",
  "025de4e540e475eff93a1b31fd044da47819ced36cbd201b445097bf9eae8138",
  "31da2f03bbc1ee05dba8eefd702ecbd6e19f24463df735cc3478452dd8148af0",
  "1856406924905bfed1311e789c5481eeef98d4090512189056debfe437339d74"
]);
const textExtension = /\.(?:css|html|js|json|md|mjs|toml|txt|ya?ml)$/i;
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" }
).split("\0").filter(Boolean);

const violations = [];
for (const relative of files) {
  if (!textExtension.test(relative)) continue;
  let text;
  try {
    text = await readFile(path.join(root, relative), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (removedLegacyPathHashes.has(sha256(relative))) {
    violations.push(`${relative}: removed personal preview path returned`);
    continue;
  }
  const words = text.normalize("NFKC").toLowerCase().match(/[a-z0-9]+/g) || [];
  for (let index = 0; index + 1 < words.length; index += 1) {
    if (protectedNameHashes.has(sha256(`${words[index]} ${words[index + 1]}`))) {
      violations.push(`${relative}: protected operator name`);
      break;
    }
  }
  for (const match of text.match(/(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10}/g) || []) {
    let digits = match.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (protectedPhoneHashes.has(sha256(digits))) {
      violations.push(`${relative}: protected operator phone`);
      break;
    }
  }
  for (const match of text.match(/\b\d{1,6}\s+[A-Za-z0-9 .'-]{2,60}\s(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|way|boulevard|blvd)\b/gi) || []) {
    const normalized = match.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (protectedAddressHashes.has(sha256(normalized))) {
      violations.push(`${relative}: protected operator address`);
      break;
    }
  }
}

assert.deepEqual(violations, [], `public repository privacy violations:\n${violations.join("\n")}`);
console.log(`Repository privacy contract passed across ${files.length} tracked and unignored files.`);
