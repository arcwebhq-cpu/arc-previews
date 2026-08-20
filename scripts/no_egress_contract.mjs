const clean = value => String(value ?? "").trim();

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(amp|quot|apos|lt|gt|colon|sol|period|commat|percnt|num);/gi, (_, name) => ({
      amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", sol: "/", period: ".",
      commat: "@", percnt: "%", num: "#"
    })[name.toLowerCase()]);
}

function recursivelyDecode(value) {
  let current = String(value ?? "");
  for (let pass = 0; pass < 5; pass += 1) {
    let next = decodeEntities(current);
    try { next = decodeURIComponent(next.replace(/\+/g, "%20")); } catch {}
    if (next === current) break;
    current = next;
  }
  return current.normalize("NFKC");
}

export function assertNoRemoteRuntimeDependencies(markup, { exactReceiptUrls = [] } = {}) {
  const html = String(markup ?? "");
  const receiptUrls = new Set([...exactReceiptUrls].map(clean).filter(Boolean));
  const decode = value => recursivelyDecode(value).replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  const remote = value => /^(?:https?:)?\/\//i.test(decode(value));
  const safeLocal = value => {
    const decoded = decode(value);
    return /^\/(?!\/)[^\\\s]*$/.test(decoded) ||
      /^\.?\.\/(?!\/)[^\\\s:]*$/.test(decoded) ||
      /^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=@%/-]*$/.test(decoded);
  };
  const assertResourceValue = (tagName, attribute, rawValue) => {
    const values = attribute === "srcset"
      ? decode(rawValue).split(",").map(candidate => candidate.trim().split(/\s+/, 1)[0]).filter(Boolean)
      : [decode(rawValue)];
    if (!values.length) throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: empty runtime resource URL");
    for (const value of values) {
      if (remote(value)) {
        if (!new Set(["img", "source"]).has(tagName) ||
            !new Set(["src", "srcset"]).has(attribute) || !receiptUrls.has(value)) {
          throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: remote ${tagName} ${attribute} is not an exact signed upload receipt URL`);
        }
      } else if (!safeLocal(value)) {
        throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: unsafe ${tagName} ${attribute} runtime URL`);
      }
    }
  };

  for (const tag of html.match(/<[A-Za-z][^>]*>/g) || []) {
    const tagName = tag.match(/^<\s*([A-Za-z][A-Za-z0-9:-]*)/)?.[1].toLowerCase() || "";
    const attributes = [...tag.matchAll(/\b(srcset|src|poster|data|action|href|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)];
    const declared = (tag.match(/\b(?:srcset|src|poster|data|action|href|style)\s*=/gi) || []).length;
    if (attributes.length !== declared) throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: malformed runtime URL attribute");
    for (const match of attributes) {
      const attribute = match[1].toLowerCase();
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      if (attribute === "style") {
        if (/@import\b|url\s*\(/i.test(decode(value))) {
          throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: CSS imports and URL resources are forbidden");
        }
        continue;
      }
      if (attribute === "href") {
        if (tagName === "a") {
          const href = decode(value);
          let externalNavigation = false;
          if (/^https?:\/\//i.test(href)) {
            try {
              const url = new URL(href);
              externalNavigation = !url.username && !url.password && new Set(["http:", "https:"]).has(url.protocol);
            } catch {}
          }
          if (!externalNavigation && !safeLocal(href) && !/^#[A-Za-z0-9_.:-]*$/.test(href) &&
              !/^tel:\+?[0-9(). -]{5,32}$/i.test(href) &&
              !/^mailto:[^\s@]+@[^\s@]+\.[^\s@?]+(?:\?[^\s]*)?$/i.test(href)) {
            throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: unsafe anchor navigation URL");
          }
          continue;
        }
        if (remote(value)) throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: remote ${tagName} href subresource`);
        continue;
      }
      if (attribute === "action") {
        if (!safeLocal(value)) throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: form action must remain same-origin");
        continue;
      }
      assertResourceValue(tagName, attribute, value);
    }
    if (tagName === "base" || tagName === "meta" && /\bhttp-equiv\s*=\s*["']?refresh/i.test(tag)) {
      throw new Error(`ARC_REMOTE_DEPENDENCY_INVALID: forbidden ${tagName} navigation primitive`);
    }
  }

  for (const style of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []) {
    if (/@import\b|url\s*\(/i.test(style)) {
      throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: CSS imports and URL resources are forbidden");
    }
  }
  const scripts = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || []).join("\n");
  const forbiddenScript = [
    /\bfetch\s*\(/i, /\bXMLHttpRequest\b/i, /\bWebSocket\s*\(/i, /\bEventSource\s*\(/i,
    /\bsendBeacon\s*\(/i, /\bserviceWorker\b/i, /\bimportScripts\s*\(/i, /\bnew\s+Image\s*\(/i,
    /\.(?:src|srcset|poster)\s*=/i, /\.setAttribute\s*\(\s*["'](?:src|srcset|poster)["']/i
  ];
  if (forbiddenScript.some(pattern => pattern.test(scripts))) {
    throw new Error("ARC_REMOTE_DEPENDENCY_INVALID: executable network or dynamic resource primitive");
  }
  return true;
}
