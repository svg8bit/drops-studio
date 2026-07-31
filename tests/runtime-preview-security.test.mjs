import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  createIsolatedRuntimeFullscreenDocument,
  EDITABLE_RUNTIME_CSP,
  secureEditableRuntimeSrcDoc,
} from "../lib/runtime-srcdoc-security.ts";

test("host CSP is the first head child and blocks editable remote execution surfaces", () => {
  const editable = `<!doctype html><html><head><script src="https://evil.example/x.js"></script><meta http-equiv="Content-Security-Policy" content="default-src *"><style>body{color:red}</style></head><body><iframe src="https://evil.example"></iframe></body></html>`;
  const secured = secureEditableRuntimeSrcDoc(editable);
  const head = secured.indexOf("<head>");
  const trustedPolicy = secured.indexOf(
    '<meta http-equiv="Content-Security-Policy"',
  );
  const editableScript = secured.indexOf(
    '<script src="https://evil.example/x.js">',
  );

  assert.ok(
    head >= 0 && trustedPolicy >= 0 && editableScript >= 0,
    "head, trusted policy and editable script markers must exist",
  );
  assert.ok(trustedPolicy > head);
  assert.ok(trustedPolicy < editableScript);
  assert.match(EDITABLE_RUNTIME_CSP, /default-src 'none'/);
  assert.match(EDITABLE_RUNTIME_CSP, /script-src-attr 'none'/);
  assert.match(EDITABLE_RUNTIME_CSP, /connect-src 'self'/);
  assert.match(EDITABLE_RUNTIME_CSP, /img-src 'self' data: blob:/);
  assert.match(EDITABLE_RUNTIME_CSP, /object-src 'none'/);
  assert.match(EDITABLE_RUNTIME_CSP, /frame-src 'none'/);
  assert.match(EDITABLE_RUNTIME_CSP, /base-uri 'none'/);
  assert.doesNotMatch(EDITABLE_RUNTIME_CSP, /https?:|\*/);
});

test("srcdoc security fails closed when editable markup precedes or omits head", () => {
  for (const editable of [
    '<script>window.__ran=true</script><html><head></head><body></body></html>',
    '<!doctype html><html><body><script>window.__ran=true</script></body></html>',
  ]) {
    const secured = secureEditableRuntimeSrcDoc(editable);
    assert.match(secured, /Preview blocked/);
    assert.doesNotMatch(secured, /window\.__ran/);
    const policyAt = secured.indexOf("Content-Security-Policy");
    const bodyAt = secured.indexOf("<body>");
    assert.ok(policyAt >= 0 && bodyAt >= 0, "policy and body markers must exist");
    assert.ok(policyAt < bodyAt);
  }
});

test("CSP insertion respects quoted greater-than characters in head attributes", () => {
  const editable = `<!doctype html><html><head data-marker="keep>boundary"><script>window.__ran=true</script></head><body></body></html>`;
  const secured = secureEditableRuntimeSrcDoc(editable);
  assert.match(
    secured,
    /<head data-marker="keep>boundary">\n<meta http-equiv="Content-Security-Policy"/,
  );
  const policyAt = secured.indexOf("Content-Security-Policy");
  const runtimeAt = secured.indexOf("window.__ran=true");
  assert.ok(policyAt >= 0 && runtimeAt >= 0, "policy and runtime markers must exist");
  assert.ok(policyAt < runtimeAt);
  assert.match(
    secureEditableRuntimeSrcDoc(
      '<!doctype html><html><head data-marker="unterminated><script>evil()</script>',
    ),
    /Preview blocked/,
  );
});

test("fullscreen keeps fully escaped editable source inside an opaque nested sandbox", () => {
  const editable = `<!doctype html><html><head><title>Attack</title></head><body><script id="editable">window.top.__escaped=false</script><p title="&quot;">Artifact</p></body></html>`;
  const shell = createIsolatedRuntimeFullscreenDocument(editable);
  assert.match(shell, /<iframe[^>]*sandbox="allow-scripts allow-forms allow-downloads"/);
  assert.doesNotMatch(shell, /allow-same-origin|allow-popups/);
  assert.doesNotMatch(shell, /<script id="editable">/);
  assert.match(
    shell,
    /&lt;script id=&quot;editable&quot;&gt;window\.top\.__escaped=false&lt;\/script&gt;/,
  );
  assert.match(shell, /srcdoc="&lt;!doctype html&gt;/);
  assert.match(shell, /External links stay disabled here/);
});

test("Studio keeps srcdoc popups disabled and treats iframe smoke as browser-only telemetry", async () => {
  const [studio, compiler] = await Promise.all([
    readFile(
      new URL("../components/project-studio.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/project-compiler.ts", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /src=\{runtimePreviewUrl \?\? undefined\}/);
  assert.match(
    studio,
    /srcDoc=\{runtimePreviewUrl \? undefined : runtimeSrcDoc\}/,
  );
  assert.match(
    studio,
    /sandbox=\{runtimePreviewUrl \? "allow-scripts allow-forms allow-downloads allow-same-origin" : "allow-scripts allow-forms allow-downloads"\}/,
  );
  assert.match(studio, /function currentProjectV2PreviewUrl/);
  assert.match(studio, /url\.protocol === "https:"/);
  assert.doesNotMatch(studio, /allow-popups/);
  assert.match(
    studio,
    /mode: "browser",[\s\S]*dataProvider: "unverified"/,
  );
  assert.match(studio, /Browser telemetry/);
  assert.match(studio, /approvedPreviewExternalUrl\(/);
  assert.match(studio, /drops-studio-open-external/);
  assert.match(
    compiler,
    /function openTab\(url\)\{if\(window\.parent!==window\)\{postParent\(\{type:"drops-studio-open-external"/,
  );
  assert.match(
    studio,
    /new Blob\(\[createIsolatedRuntimeFullscreenDocument\(currentProject\.html\)\]/,
  );
  assert.doesNotMatch(
    studio,
    /new Blob\(\[(?:currentProject\.html|secureEditableRuntimeSrcDoc\(currentProject\.html\))\]/,
    "fullscreen must never escape the host CSP with raw editable HTML",
  );

  const publishStart = studio.indexOf("async function publish()");
  const publishEnd = studio.indexOf("async function unpublish()", publishStart);
  assert.ok(
    publishStart >= 0 && publishEnd > publishStart,
    "publish() region must be locatable",
  );
  const publishSource = studio.slice(publishStart, publishEnd);
  assert.match(publishSource, /const trustedPublishSmoke/);
  assert.match(
    publishSource,
    /if \(trustedPublishSmoke && !quality\.readyToPublish\)/,
  );
  assert.doesNotMatch(
    publishSource,
    /evaluateProjectQuality\([\s\S]{0,240}\bruntimeSmoke\b/,
    "forged browser telemetry must neither authorize nor permanently block the authoritative publish API",
  );
  assert.match(publishSource, /quality\?: unknown/);
  assert.match(publishSource, /acceptPublishedQuality\(/);
  assert.match(publishSource, /quality: publishedQuality/);
});
