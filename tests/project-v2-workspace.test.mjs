import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildProjectV2FileTree,
  createProjectV2LineDiff,
  clearProjectV2Draft,
  filterProjectV2FileTree,
  formatProjectV2Duration,
  resolveProjectV2DraftContent,
  updateProjectV2DraftMap,
  verifiedProjectV2PreviewUrl,
} from "../components/project-v2-workspace-model.ts";

const draftFiles = {
  "app/page.tsx": { content: "saved page" },
  "app/layout.tsx": { content: "saved layout" },
};

test("workspace drafts survive file switches and stay explicit across remote updates", () => {
  let drafts = updateProjectV2DraftMap({}, "app/page.tsx", "local draft", "saved page");
  assert.equal(resolveProjectV2DraftContent(drafts, "app/layout.tsx", draftFiles), "saved layout");
  assert.equal(resolveProjectV2DraftContent(drafts, "app/page.tsx", draftFiles), "local draft");
  assert.equal(resolveProjectV2DraftContent(drafts, "app/page.tsx", {
    ...draftFiles,
    "app/page.tsx": { content: "remote update" },
  }), "local draft");
  drafts = updateProjectV2DraftMap(drafts, "app/page.tsx", "remote update", "remote update");
  assert.deepEqual(drafts, {});
  assert.equal(resolveProjectV2DraftContent(drafts, "app/page.tsx", {
    ...draftFiles,
    "app/page.tsx": { content: "remote update" },
  }), "remote update");
});

test("workspace draft removal is immutable and path-scoped", () => {
  const drafts = { "app/page.tsx": "page draft", "app/layout.tsx": "layout draft" };
  const next = clearProjectV2Draft(drafts, "app/page.tsx");
  assert.deepEqual(next, { "app/layout.tsx": "layout draft" });
  assert.deepEqual(drafts, { "app/page.tsx": "page draft", "app/layout.tsx": "layout draft" });
});

test("workspace file tree is deterministic, nested, and search preserving", () => {
  const tree = buildProjectV2FileTree([
    "package.json",
    "components/market/table.tsx",
    "app/page.tsx",
    "components/button.tsx",
    "app/api/data/route.ts",
  ]);
  assert.deepEqual(tree.map((node) => [node.kind, node.name]), [
    ["directory", "app"],
    ["directory", "components"],
    ["file", "package.json"],
  ]);
  assert.deepEqual(tree[0].children.map((node) => node.name), ["api", "page.tsx"]);
  const filtered = filterProjectV2FileTree(tree, "market");
  assert.deepEqual(filtered.map((node) => node.path), ["components"]);
  assert.deepEqual(filtered[0].children[0].path, "components/market");
  assert.deepEqual(filtered[0].children[0].children[0].path, "components/market/table.tsx");
});

test("workspace line diff reports unchanged, removed, and added source lines", () => {
  const diff = createProjectV2LineDiff("one\ntwo\nthree", "one\nchanged\nthree");
  assert.deepEqual(diff.map((line) => [line.kind, line.content]), [
    ["context", "one"],
    ["removed", "two"],
    ["added", "changed"],
    ["context", "three"],
  ]);
  assert.deepEqual(diff.map((line) => line.oldLine), [1, 2, undefined, 3]);
  assert.deepEqual(diff.map((line) => line.newLine), [1, undefined, 2, 3]);
});

test("workspace preview accepts only ready HTTP(S) provider URLs", () => {
  assert.equal(verifiedProjectV2PreviewUrl({
    status: "ready",
    projectRevision: 4,
    url: "https://sandbox.example.dev",
  }), "https://sandbox.example.dev/");
  assert.equal(verifiedProjectV2PreviewUrl({
    status: "starting",
    projectRevision: 4,
    url: "https://sandbox.example.dev",
  }), null);
  assert.equal(verifiedProjectV2PreviewUrl({
    status: "ready",
    projectRevision: 4,
    url: "javascript:alert(1)",
  }), null);
});

test("workspace duration is bounded and human readable", () => {
  assert.equal(formatProjectV2Duration("2026-07-30T00:00:00.000Z", Date.parse("2026-07-30T00:01:05.000Z")), "01:05");
  assert.equal(formatProjectV2Duration("invalid", Date.now()), "—");
});

test("workspace component contract lazy-loads CodeMirror and never renders srcDoc", async () => {
  const source = await readFile(
    new URL("../components/project-v2-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /lazy\(\(\) => import\("\.\/project-v2-code-editor"\)\)/);
  assert.match(source, /onSaveFile/);
  assert.match(source, /onRenameFile/);
  assert.match(source, /onRestoreCheckpoint/);
  assert.match(source, /onStopSandbox/);
  assert.match(source, /onRequestDeployment/);
  assert.match(source, /id: "data", label: "Data"/);
  assert.match(source, /id: "logic", label: "Logic"/);
  assert.match(source, /Session-only GitHub access token/);
  assert.match(source, /studioProjectId: project\.id/);
  assert.doesNotMatch(source, /x-github-installation-id/);
  assert.match(source, /<iframe/);
  assert.doesNotMatch(source, /srcDoc=/);
  assert.doesNotMatch(source, /terminal\.local|\.live\b/);
});
