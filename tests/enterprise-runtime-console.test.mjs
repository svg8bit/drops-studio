import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("enterprise page includes the live runtime console without replacing the capability console", async () => {
  const source = await readFile(new URL("../app/enterprise/page.tsx", import.meta.url), "utf8");
  assert.match(source, /EnterpriseRuntimeConsole/);
  assert.match(source, /PlatformCapabilityConsole mode="enterprise"/);
  assert.match(source, /Runtime status comes from the public capability snapshot/);
});

test("runtime console reads collaboration and identity from one public capability snapshot", async () => {
  const source = await readFile(new URL("../components/platform/enterprise-runtime-console.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/platform\/capabilities"/);
  assert.match(source, /capabilityId: "collaboration"/);
  assert.match(source, /capabilityId: "enterprise-identity"/);
  assert.doesNotMatch(source, /\/api\/collaboration\/transport\?health=1/);
  assert.match(source, /\/api\/enterprise\/oidc\/\.well-known\/openid-configuration/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /useRef\(0\)/);
  assert.match(source, /refreshGeneration\.current !== generation/);
  assert.match(source, /payload\.healthCheckedAt/);
  assert.doesNotMatch(source, /payload\.generatedAt/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /AbortController/);
  assert.match(source, /state === "working"/);
  assert.doesNotMatch(source, /mockReceipt|fakeProvider|sampleStatus|defaultWorking/i);
});

test("runtime console keeps refresh, receipt links, and status updates accessible", async () => {
  const source = await readFile(new URL("../components/platform/enterprise-runtime-console.tsx", import.meta.url), "utf8");
  assert.match(source, /type="button"/);
  assert.match(source, /min-h-11/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="status"/);
  assert.match(source, /Open public OIDC discovery/);
  assert.match(source, /operator-protected/);
  assert.match(source, /target="_blank"/);
  assert.doesNotMatch(source, /text-\[(?:[0-9]|1[01])px\]/);
});

test("runtime console never promotes configuration into working evidence", async () => {
  const source = await readFile(new URL("../components/platform/enterprise-runtime-console.tsx", import.meta.url), "utf8");
  assert.match(source, /state: "loading"/);
  assert.match(source, /Setup required/);
  assert.match(source, /Check unavailable/);
  assert.match(source, /credential values never leave the server/i);
  assert.doesNotMatch(source, /All systems operational|All checks passed|hardcoded success/i);
});
