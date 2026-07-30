import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellModule = await import("../lib/public-project-shell.ts").catch(() => null);
const cspModule = await import("../lib/artifact-csp.ts").catch(() => null);

test("published artifacts run only through a child URL in an opaque sandbox", () => {
  assert.ok(shellModule, "the public project shell module must exist");
  const { buildPublicProjectShell, publicProjectShellCsp } = shellModule;
  const nonce = "unit-test-nonce";
  const shell = buildPublicProjectShell({
    nonce,
    presetId: "crypto-product-hunt",
    runtimeUrl: "/p/secure-launch-board?runtime=1",
    slug: "secure-launch-board",
    title: `Secure "launch" <board>`,
  });
  const csp = publicProjectShellCsp(nonce);

  assert.equal(
    shell.match(/<script\b/gi)?.length,
    1,
    "only the host bridge may be a top-level script",
  );
  assert.match(shell, /src="\/p\/secure-launch-board\?runtime=1"/);
  assert.match(
    shell,
    /<iframe[^>]+sandbox="allow-scripts allow-forms allow-downloads"/,
  );
  assert.doesNotMatch(
    shell,
    /allow-same-origin|allow-popups|allow-top-navigation/,
  );
  assert.match(shell, /\bcredentialless\b/);
  assert.match(shell, /<style nonce="unit-test-nonce">/);
  assert.match(shell, /<script nonce="unit-test-nonce">/);
  assert.match(shell, /event\.source !== frame\.contentWindow/);
  assert.match(shell, /event\.origin !== "null"/);
  assert.match(shell, /message\.slug !== projectSlug/);
  assert.match(shell, /drops-studio-data-request/);
  assert.match(shell, /drops-studio-product-hunt-request/);
  assert.match(shell, /drops-studio-open-external/);
  assert.match(shell, /\/api\/public-data/);
  assert.match(shell, /\/api\/product-hunt\/launches/);
  assert.match(shell, /Open approved link/);
  assert.match(shell, /confirm\("Allow this published app to submit/);

  assert.match(csp, /script-src 'nonce-unit-test-nonce'/);
  assert.match(csp, /style-src 'nonce-unit-test-nonce'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-src 'self'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|https:/);
});

test("published shell bridge is preset-scoped and validates every privileged request shape", () => {
  assert.ok(shellModule, "the public project shell module must exist");
  const shell = shellModule.buildPublicProjectShell({
    nonce: "validation-nonce",
    presetId: "morning-alpha",
    runtimeUrl: "/p/morning-alpha-safe?runtime=1",
    slug: "morning-alpha-safe",
    title: "Morning Alpha",
  });

  assert.match(shell, /projectPreset !== "crypto-product-hunt"/);
  assert.match(shell, /\^hunt-\[1-9\]\\d\{0,7\}\$/);
  assert.match(
    shell,
    /action !== "list" && action !== "submit" && action !== "vote"/,
  );
  assert.match(shell, /\^\[a-f0-9-\]\{36\}\$/i);
  assert.match(shell, /Object\.keys\(value\)/);
  assert.match(shell, /dropstab\.com/);
  assert.match(shell, /polymarket\.com/);
  assert.match(shell, /url\.hostname === "t\.me"/);
  assert.match(shell, /url\.username \|\| url\.password/);
});

test("runtime response is header-sandboxed even when opened directly", async () => {
  assert.ok(cspModule, "the artifact CSP module must exist");
  assert.match(
    cspModule.PROJECT_PUBLIC_RUNTIME_CSP,
    /sandbox allow-scripts allow-forms allow-downloads/,
  );
  assert.doesNotMatch(
    cspModule.PROJECT_PUBLIC_RUNTIME_CSP,
    /allow-same-origin|allow-popups|allow-top-navigation/,
  );
  assert.match(cspModule.PROJECT_PUBLIC_RUNTIME_CSP, /connect-src 'self'/);
  const secured = cspModule.addProjectArtifactCspMeta(
    '<!doctype html><html><head data-marker="keep>boundary"><title>Safe</title></head><body></body></html>',
  );
  assert.match(
    secured,
    /<head data-marker="keep>boundary"><meta http-equiv="Content-Security-Policy"/,
  );
  const route = await readFile(
    new URL("../app/p/[slug]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /searchParams\.get\("runtime"\) === "1"/);
  assert.match(route, /PROJECT_PUBLIC_RUNTIME_CSP/);
  assert.match(route, /buildPublicProjectShell/);
  assert.doesNotMatch(route, /new Response\(project\.html/);
});
