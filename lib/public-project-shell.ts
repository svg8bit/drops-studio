import type { PresetId } from "./presets.ts";

function htmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scriptValue(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function publicProjectShellCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export function buildPublicProjectShell(options: {
  nonce: string;
  presetId: PresetId;
  runtimeUrl: string;
  slug: string;
  title: string;
}): string {
  const title = htmlAttribute(options.title);
  const runtimeUrl = htmlAttribute(options.runtimeUrl);
  const nonce = htmlAttribute(options.nonce);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · Drops Studio</title>
  <style nonce="${nonce}">
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#050914;color:#dbeafe;font:500 16px/1.45 system-ui,sans-serif}body{display:grid;grid-template-rows:auto 1fr}.shell-bar{display:flex;min-height:52px;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid #243044;background:#0b1220}.shell-bar strong{color:#fff}.shell-bar span{color:#9fb0c8}.external-action{display:none;margin-left:auto;min-width:44px;min-height:44px;padding:0 14px;border:1px solid #3b82f6;border-radius:8px;background:#2563eb;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer}.external-action[data-visible="true"]{display:inline-flex;align-items:center}iframe{display:block;width:100%;height:100%;border:0;background:#fff}
  </style>
</head>
<body>
  <div class="shell-bar" role="status" aria-live="polite">
    <strong>Sandboxed public app</strong>
    <span id="shellStatus">Runtime isolated from your Drops Studio account.</span>
    <button class="external-action" id="externalAction" type="button">Open approved link</button>
  </div>
  <iframe id="projectRuntime" title="${title} application" src="${runtimeUrl}" sandbox="allow-scripts allow-forms allow-downloads" credentialless referrerpolicy="no-referrer"></iframe>
  <script nonce="${nonce}">
  (() => {
    "use strict";
    const frame = document.getElementById("projectRuntime");
    const status = document.getElementById("shellStatus");
    const externalAction = document.getElementById("externalAction");
    const projectSlug = ${scriptValue(options.slug)};
    const projectPreset = ${scriptValue(options.presetId)};
    let pendingExternalUrl = "";
    const send = (payload) => frame.contentWindow?.postMessage(payload, "*");
    const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
    const exactKeys = (value, allowed) => plainObject(value) && Object.keys(value).every((key) => allowed.includes(key));
    const domain = (hostname, apex) => hostname === apex || hostname.endsWith("." + apex);
    const approvedExternalUrl = (value) => {
      if (typeof value !== "string" || value.length > 2048) return null;
      try {
        const url = new URL(value, location.origin);
        if (url.protocol !== "https:" || url.username || url.password) return null;
        const keys = [...url.searchParams.keys()];
        if (url.origin === location.origin && url.pathname === "/" && url.searchParams.get("connections") === "1" && url.searchParams.get("provider") === "dropsbot" && url.searchParams.get("flow") === "telegram-channel" && keys.every((key) => ["connections", "provider", "flow", "project"].includes(key))) return url.href;
        if (domain(url.hostname, "dropstab.com") || domain(url.hostname, "polymarket.com")) return url.href;
        if (url.hostname === "t.me" && /^\\/Drops\\/?$/.test(url.pathname) && !url.search) return url.href;
      } catch {}
      return null;
    };
    const respondHunt = (requestId, ok, payload) => send({ type: "drops-studio-product-hunt-response", requestId, ok, payload });
    const boundedText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
    const validSubmission = (value) => {
      if (!exactKeys(value, ["name", "tagline", "description", "url", "category"])) return false;
      if (!boundedText(value.name, 80) || !boundedText(value.tagline, 160) || !boundedText(value.description, 1200) || !boundedText(value.url, 2048) || !boundedText(value.category, 40)) return false;
      try {
        const url = new URL(value.url);
        return url.protocol === "https:" && !url.username && !url.password;
      } catch { return false; }
    };
    const handleData = async () => {
      try {
        const response = await fetch("/api/public-data", { headers: { accept: "application/json" }, credentials: "omit" });
        const payload = await response.json();
        send({ type: "drops-studio-data-response", payload });
      } catch {
        send({ type: "drops-studio-data-response", payload: { source: "Saved DropsTab-compatible snapshot", provider: "unverified" } });
      }
    };
    const handleHunt = async (message) => {
      const requestId = typeof message.requestId === "string" ? message.requestId : "";
      const action = typeof message.action === "string" ? message.action : "";
      const payload = plainObject(message.payload) ? message.payload : {};
      if (projectPreset !== "crypto-product-hunt" || !/^hunt-[1-9]\\d{0,7}$/.test(requestId) || (action !== "list" && action !== "submit" && action !== "vote")) {
        respondHunt(requestId, false, { error: "Published app request was rejected." });
        return;
      }
      let endpoint = "/api/product-hunt/launches";
      const init = { credentials: "same-origin", headers: { accept: "application/json" } };
      if (action === "list") {
        endpoint += "?sort=" + (payload.sort === "new" ? "new" : "top") + "&limit=24";
      } else if (action === "submit") {
        if (!exactKeys(payload, ["submission"]) || !validSubmission(payload.submission) || !confirm("Allow this published app to submit this product to the public community feed?")) {
          respondHunt(requestId, false, { error: "Submission was not approved." });
          return;
        }
        init.method = "POST";
        init.headers = { accept: "application/json", "content-type": "application/json" };
        init.body = JSON.stringify(payload.submission);
      } else {
        if (!exactKeys(payload, ["id"]) || typeof payload.id !== "string" || !/^[a-f0-9-]{36}$/i.test(payload.id) || !confirm("Allow this published app to record one community vote?")) {
          respondHunt(requestId, false, { error: "Vote was not approved." });
          return;
        }
        endpoint += "/" + encodeURIComponent(payload.id) + "/vote";
        init.method = "POST";
      }
      try {
        const response = await fetch(endpoint, init);
        const responsePayload = await response.json().catch(() => ({ error: "Community response was unreadable." }));
        respondHunt(requestId, response.ok, responsePayload);
      } catch {
        respondHunt(requestId, false, { error: "Community service is unavailable." });
      }
    };
    externalAction.addEventListener("click", () => {
      if (!pendingExternalUrl) return;
      window.open(pendingExternalUrl, "_blank", "noopener,noreferrer");
      pendingExternalUrl = "";
      externalAction.dataset.visible = "false";
      status.textContent = "Runtime isolated from your Drops Studio account.";
    });
    addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow || event.origin !== "null" || !plainObject(event.data)) return;
      const message = event.data;
      if (message.slug !== projectSlug) return;
      if (message.type === "drops-studio-data-request") { void handleData(); return; }
      if (message.type === "drops-studio-product-hunt-request") { void handleHunt(message); return; }
      if (message.type === "drops-studio-open-external") {
        const approved = approvedExternalUrl(message.url);
        if (!approved) { status.textContent = "The app requested a link outside the approved provider list."; return; }
        pendingExternalUrl = approved;
        externalAction.dataset.visible = "true";
        status.textContent = "Review the approved provider link before opening it.";
      }
    });
  })();
  </script>
</body>
</html>`;
}
