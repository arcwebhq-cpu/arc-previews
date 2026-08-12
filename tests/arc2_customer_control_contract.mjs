import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../zapier/arc2_verify_customer_control.js", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction("inputData", "fetch", "Buffer", source);
const sha1 = value => createHash("sha1").update(value).digest("hex");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const response = (status, body, url) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  json: async () => body,
  text: async () => typeof body === "string" ? body : JSON.stringify(body)
});

const folder = "summit-roofing-a1b2c3d4";
const deliveryRoot = `deliveries/${folder}`;
const productionHtml = '<!doctype html><html><body data-arc-site-mode="production"><form data-netlify="true" netlify-honeypot="bot-field"></form></body></html>\n';
const servedHtml = productionHtml.replace(' data-netlify="true"', "").replace(' netlify-honeypot="bot-field"', "");
const netlifyConfig = '[build]\n  publish = "."\n';
const usageGuide = "# Launch checklist\n\nSecure manual setup required.\n";
const sourceArtifacts = [
  { sourcePath: `${deliveryRoot}/index.html`, customerPath: "index.html", content: productionHtml },
  { sourcePath: `${deliveryRoot}/netlify.toml`, customerPath: "netlify.toml", content: netlifyConfig },
  { sourcePath: `${deliveryRoot}/USAGE.md`, customerPath: "USAGE.md", content: usageGuide }
];
const fingerprint = sha256(sourceArtifacts.map(item => `${item.sourcePath}\0${item.content}\0`).join(""));
const marker = `${JSON.stringify({
  version: "arc-handoff-v2",
  preview_folder: folder,
  fingerprint_algorithm: "sha256",
  bundle_fingerprint: fingerprint,
  files: [...sourceArtifacts.map(item => item.sourcePath), `${deliveryRoot}/.arc-handoff.json`]
}, null, 2)}\n`;
const artifacts = [...sourceArtifacts, { sourcePath: `${deliveryRoot}/.arc-handoff.json`, customerPath: ".arc-handoff.json", content: marker }];
const customerCommit = "9".repeat(40);
const customerTree = "6".repeat(40);
const netlifySiteId = "623e4567-e89b-42d3-a456-426614174000";
const netlifyDeployId = "723e4567-e89b-42d3-a456-426614174000";
const deployUrl = `https://${netlifyDeployId}--buyer-site.netlify.app/`;
const input = {
  customer_github_token: "mock-customer-github-token",
  customer_netlify_access_token: "mock-customer-netlify-token",
  customer_control_evidence_secret: "arc-customer-control-contract-secret-32-bytes",
  customer_email: "buyer@example.test",
  preview_folder: folder,
  bundle_fingerprint: fingerprint,
  payment_evidence_sha256: "8".repeat(64),
  merge_commit_sha: "7".repeat(40),
  customer_github_owner: "buyer-owner",
  customer_github_repo: "buyer-site",
  customer_netlify_account_id: "buyer_account_123456",
  customer_netlify_site_id: netlifySiteId,
  customer_netlify_deploy_id: netlifyDeployId,
  production_content_base64: Buffer.from(productionHtml).toString("base64"),
  netlify_config_base64: Buffer.from(netlifyConfig).toString("base64"),
  usage_guide_base64: Buffer.from(usageGuide).toString("base64")
};

const makeFetch = ({ admin = true, tamper = false } = {}) => {
  const calls = [];
  const fetch = async (rawUrl, options = {}) => {
    calls.push({ rawUrl, method: options.method || "GET" });
    assert.equal(options.method || "GET", "GET", "customer-control verifier must remain read-only");
    const url = new URL(rawUrl);
    if (url.hostname === "api.github.com") {
      if (url.pathname === "/user") return response(200, { id: 1001 }, rawUrl);
      if (url.pathname === "/repos/buyer-owner/buyer-site") return response(200, {
        id: 12345,
        full_name: "buyer-owner/buyer-site",
        owner: { login: "buyer-owner" },
        permissions: { admin },
        default_branch: "main"
      }, rawUrl);
      if (url.pathname.endsWith("/branches/main")) return response(200, { commit: { sha: customerCommit } }, rawUrl);
      if (url.pathname.endsWith(`/git/commits/${customerCommit}`)) return response(200, {
        sha: customerCommit,
        tree: { sha: customerTree }
      }, rawUrl);
      if (url.pathname.includes("/git/trees/")) return response(200, {
        truncated: false,
        tree: artifacts.map(item => ({ type: "blob", path: item.customerPath, sha: sha1(item.content), size: Buffer.byteLength(item.content) }))
      }, rawUrl);
      const match = url.pathname.match(/\/contents\/(.+)$/);
      if (match) {
        const name = match[1].split("/").map(decodeURIComponent).join("/");
        const artifact = artifacts.find(item => item.customerPath === name);
        return response(200, { type: "file", content: Buffer.from(artifact.content).toString("base64") }, rawUrl);
      }
    }
    if (url.hostname === "api.netlify.com") {
      if (url.pathname === "/api/v1/user") return response(200, { id: "823e4567-e89b-42d3-a456-426614174000" }, rawUrl);
      if (url.pathname === "/api/v1/accounts/buyer_account_123456") return response(200, {
        id: "buyer_account_123456",
        owner_ids: ["823e4567-e89b-42d3-a456-426614174000"]
      }, rawUrl);
      if (url.pathname === `/api/v1/sites/${netlifySiteId}`) return response(200, {
        id: netlifySiteId,
        account_id: "buyer_account_123456",
        state: "current",
        ssl_url: "https://buyer-site.netlify.app/",
        published_deploy: { id: netlifyDeployId },
        build_settings: { provider: "github", repo_path: "buyer-owner/buyer-site", repo_branch: "main", dir: "" }
      }, rawUrl);
      if (url.pathname === `/api/v1/sites/${netlifySiteId}/deploys/${netlifyDeployId}`) return response(200, {
        id: netlifyDeployId,
        site_id: netlifySiteId,
        state: "ready",
        commit_ref: customerCommit,
        deploy_ssl_url: deployUrl
      }, rawUrl);
      if (url.pathname === `/api/v1/sites/${netlifySiteId}/files`) return response(200, artifacts.map(item => ({
        path: `/${item.customerPath}`,
        sha: sha1(item.content),
        size: Buffer.byteLength(item.content),
        mime_type: item.customerPath.endsWith(".html") ? "text/html" : "text/plain"
      })), rawUrl);
      const rawPrefix = `/api/v1/sites/${netlifySiteId}/files/`;
      if (url.pathname.startsWith(rawPrefix)) {
        const name = url.pathname.slice(rawPrefix.length).split("/").map(decodeURIComponent).join("/");
        const artifact = artifacts.find(item => item.customerPath === name);
        return response(200, tamper && name === "index.html" ? `${artifact.content}tampered` : artifact.content, rawUrl);
      }
    }
    if (rawUrl === deployUrl) return response(200, servedHtml, rawUrl);
    return response(404, {}, rawUrl);
  };
  return { fetch, calls };
};

const ok = makeFetch();
const result = await run(input, ok.fetch, Buffer);
assert.equal(result.status, "CUSTOMER_CONTROL_EVIDENCE_ISSUED");
assert.equal(result.send_delivery_email, false);
assert.equal(result.write_methods_allowed, false);
assert.match(result.customer_control_evidence_hmac_sha256, /^[a-f0-9]{64}$/);
assert.equal(ok.calls.every(call => call.method === "GET"), true);
assert.equal(ok.calls.some(call => call.rawUrl.includes(`/git/trees/${customerTree}?recursive=1`)), true);
assert.equal(ok.calls.some(call => call.rawUrl.includes(`/git/trees/${customerCommit}?recursive=1`)), false);

await assert.rejects(run(input, makeFetch({ admin: false }).fetch, Buffer), /lacks admin control/);
await assert.rejects(run(input, makeFetch({ tamper: true }).fetch, Buffer), /source bytes changed/);
await assert.rejects(run({ ...input, customer_github_owner: "arcwebhq-cpu" }, async () => {
  throw new Error("network must not run");
}, Buffer), /customer repository identity/);

console.log("PASS ARC2 read-only customer-owned GitHub/Netlify control evidence contract");
