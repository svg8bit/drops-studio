import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { presets } from "../lib/presets.ts";

const paths = ["templates", "projects", "backend", "integrations", "organizations", "enterprise", "platform"];

test("public platform routes use the shared shell and remain explicit product surfaces", async () => {
  const pages = await Promise.all(paths.map((path) => readFile(new URL(`../app/${path}/page.tsx`, import.meta.url), "utf8")));
  for (const [index, source] of pages.entries()) {
    assert.match(source, /PlatformShell/);
    assert.match(source, /PageIntro/);
    assert.doesNotMatch(source, /(?<!dis)(?<!not )\bconnected\b|(?<!not )\bdeployed\b|All systems operational|All checks passed/i, `${paths[index]} must not invent provider evidence`);
  }
});

test("organizations surface calls the real team API and keeps provider state honest", async () => {
  const source = await readFile(new URL("../components/platform/organization-console.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\("\/api\/teams"/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /Sign in required/);
  assert.match(source, /Setup required/);
  assert.doesNotMatch(source, /sampleMembers|fakePresence|mockOrganization/i);
});

test("backend and enterprise surfaces read the server capability API", async () => {
  const [consoleSource, routeSource] = await Promise.all([
    readFile(new URL("../components/platform/platform-capability-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/capabilities/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(consoleSource, /fetch\("\/api\/platform\/capabilities"/);
  assert.match(consoleSource, /Data.*Schema.*Auth.*Storage.*Functions.*Jobs.*Cron.*Webhooks.*Realtime.*Secrets.*Logs.*Backups.*Settings/s);
  assert.match(consoleSource, /Organizations.*Roles & RBAC.*Collaboration.*Identity.*Service accounts.*Policies.*Audit.*Lifecycle/s);
  assert.match(routeSource, /platformCapabilitySnapshot/);
  assert.doesNotMatch(consoleSource, /mockCapability|fakeReceipt|sampleOrganization/i);
});

test("platform overview renders the server snapshot instead of hardcoded readiness", async () => {
  const [pageSource, overviewSource] = await Promise.all([
    readFile(new URL("../app/platform/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/platform/platform-overview.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(pageSource, /platformCapabilitySnapshotWithHealth\(\)/);
  assert.match(pageSource, /PlatformOverview snapshot=\{snapshot\}/);
  assert.match(overviewSource, /snapshot\.capabilities\.find/);
  assert.doesNotMatch(overviewSource, /title: "Vercel Sandbox", status:/);
});

test("template catalog is wired to the canonical twelve recipes", async () => {
  assert.equal(presets.length, 12);
  const source = await readFile(new URL("../components/platform/template-catalog.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ presets \} from "@\/lib\/presets"/);
  assert.match(source, /presets\.filter/);
  assert.doesNotMatch(source, /sampleTemplates|mockTemplates|placeholderTemplates/i);
});

test("project and integration surfaces read account state without exposing values or claiming guest ownership", async () => {
  const [projects, integrations] = await Promise.all([
    readFile(new URL("../components/platform/project-library.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/platform/integration-catalog.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(projects, /readStudioAccountSnapshot/);
  assert.match(projects, /listMemberProjectsFromCloud/);
  assert.doesNotMatch(projects, /readProjectsFromStore/);
  assert.match(projects, /Guest browser drafts are never presented as account-owned projects/);
  assert.match(projects, /\/studio\/\$\{encodeURIComponent\(project\.id\)\}/);
  assert.match(integrations, /sessionStorage\.getItem/);
  assert.match(integrations, /migrateSessionConnectionsToAccount/);
  assert.match(integrations, /Saved to account/);
  assert.match(integrations, /Setup required/);
  assert.doesNotMatch(integrations, /setSessionConnections\([^)]*getItem/);
});

test("shared public surfaces preserve target and typography contracts", async () => {
  const sources = await Promise.all([
    "platform-shell.tsx",
    "platform-ui.tsx",
    "template-catalog.tsx",
    "project-library.tsx",
    "integration-catalog.tsx",
    "platform-overview.tsx",
    "platform-capability-console.tsx",
  ].map((file) => readFile(new URL(`../components/platform/${file}`, import.meta.url), "utf8")));
  const source = sources.join("\n");
  assert.match(source, /min-h-11/);
  assert.doesNotMatch(source, /text-\[(?:[0-9]|1[01])px\]/);
  assert.doesNotMatch(source, /text-\[0\.[0-9]+rem\]/);
});
