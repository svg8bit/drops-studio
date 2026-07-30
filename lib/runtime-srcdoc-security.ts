export const EDITABLE_RUNTIME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const RUNTIME_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${EDITABLE_RUNTIME_CSP}">`;

const FULLSCREEN_SHELL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function htmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function blockedRuntimeDocument(): string {
  return `<!doctype html><html><head>${RUNTIME_CSP_META}<title>Preview blocked</title></head><body>Preview blocked: the editable document has no safe head boundary.</body></html>`;
}

/**
 * Places the host-owned policy before every editable node. A later meta policy
 * can only make CSP stricter; it cannot weaken this first enforced policy.
 */
export function secureEditableRuntimeSrcDoc(html: string): string {
  const head = findHtmlOpeningTag(html, "head");
  if (!head) return blockedRuntimeDocument();
  const prefix = html
    .slice(0, head.start)
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<!doctype\s+html(?:\s[^>]*)?>/i, "")
    .replace(/<html(?:\s[^>]*)?>/i, "")
    .trim();
  if (prefix) return blockedRuntimeDocument();
  const insertionPoint = head.end;
  return `${html.slice(0, insertionPoint)}\n${RUNTIME_CSP_META}\n${html.slice(insertionPoint)}`;
}

/**
 * A Blob URL inherits the Studio origin. Keep all editable code one origin
 * boundary deeper in an opaque sandbox so it never becomes the Blob's
 * top-level document.
 */
export function createIsolatedRuntimeFullscreenDocument(html: string): string {
  const srcdoc = htmlAttribute(secureEditableRuntimeSrcDoc(html));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${FULLSCREEN_SHELL_CSP}">
  <title>Isolated Drops Studio preview</title>
  <style>
    *{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;grid-template-rows:auto 1fr;background:#050914;color:#dbeafe;font:500 13px/1.4 system-ui,sans-serif}.notice{padding:10px 16px;border-bottom:1px solid #243044;background:#0b1220}.notice strong{color:#fff}.notice span{margin-left:8px;color:#9fb0c8}iframe{width:100%;height:100%;border:0;background:#fff}
  </style>
</head>
<body>
  <div class="notice" role="status"><strong>Isolated fullscreen preview</strong><span id="externalStatus">External links stay disabled here; use Studio or the published app to open them.</span></div>
  <iframe title="Sandboxed product preview" sandbox="allow-scripts allow-forms allow-downloads" referrerpolicy="no-referrer" srcdoc="${srcdoc}"></iframe>
  <script>
    const preview=document.querySelector("iframe");
    addEventListener("message",function(event){if(event.source!==preview.contentWindow||!event.data||event.data.type!=="drops-studio-open-external")return;document.getElementById("externalStatus").textContent="External link blocked in isolated fullscreen. Return to Studio or open the published app."});
  </script>
</body>
</html>`;
}
import { findHtmlOpeningTag } from "./html-opening-tag.ts";
