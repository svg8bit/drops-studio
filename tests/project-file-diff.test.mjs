import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const { diffProjectV2Files } = await import("../lib/project-file-diff.ts");
const { createProjectV2File } = await import("../lib/project-v2-files.ts");

test("reports deterministic add, modify, delete and rename file diffs", async () => {
  const at = "2026-07-30T12:00:00.000Z";
  const before = {
    "a.txt": await createProjectV2File({ path: "a.txt", content: "one\ntwo", language: "text", role: "source", provenance: "generated", now: at }),
    "old.txt": await createProjectV2File({ path: "old.txt", content: "same", language: "text", role: "source", provenance: "generated", now: at }),
    "removed.txt": await createProjectV2File({ path: "removed.txt", content: "gone", language: "text", role: "source", provenance: "generated", now: at }),
  };
  const after = {
    "a.txt": await createProjectV2File({ path: "a.txt", content: "one\nthree", language: "text", role: "source", provenance: "manual", now: at }),
    "new.txt": await createProjectV2File({ path: "new.txt", content: "same", language: "text", role: "source", provenance: "manual", now: at }),
    "added.txt": await createProjectV2File({ path: "added.txt", content: "new", language: "text", role: "source", provenance: "ai", now: at }),
  };
  assert.deepEqual(
    diffProjectV2Files(before, after).map((item) => [item.status, item.path, item.previousPath]),
    [
      ["modified", "a.txt", undefined],
      ["added", "added.txt", undefined],
      ["renamed", "new.txt", "old.txt"],
      ["deleted", "removed.txt", undefined],
    ],
  );
});
