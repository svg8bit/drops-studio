import assert from "node:assert/strict";
import test from "node:test";

const {
  assertProjectV2FileSetLimits,
  normalizeProjectV2Path,
  ProjectV2PathError,
} = await import("../lib/project-v2-path.ts");

test("normalizes safe POSIX and Next.js route paths", () => {
  assert.equal(normalizeProjectV2Path("app/[slug]/page.tsx"), "app/[slug]/page.tsx");
  assert.equal(normalizeProjectV2Path("app/(studio)/page.tsx"), "app/(studio)/page.tsx");
  assert.equal(normalizeProjectV2Path("components/CoinCard.tsx"), "components/CoinCard.tsx");
});

test("rejects traversal, absolute, Windows, null and protected paths", () => {
  for (const path of [
    "../secret",
    "app/../secret",
    "/etc/passwd",
    "C:\\secrets.txt",
    "app\\page.tsx",
    "app/\0page.tsx",
    "app//page.tsx",
    ".env",
    "node_modules/pkg/index.js",
    ".git/config",
  ]) {
    assert.throws(() => normalizeProjectV2Path(path), ProjectV2PathError, path);
  }
});

test("enforces aggregate file count, per-file and total byte limits", () => {
  assert.doesNotThrow(() =>
    assertProjectV2FileSetLimits([
      { path: "app/page.tsx", content: "export default function Page(){}" },
    ]),
  );
  assert.throws(
    () => assertProjectV2FileSetLimits([{ path: "large.txt", content: "x".repeat(512_001) }]),
    /per-file limit/,
  );
  assert.throws(
    () =>
      assertProjectV2FileSetLimits(
        Array.from({ length: 65 }, (_, index) => ({
          path: `files/${index}.txt`,
          content: "x",
        })),
      ),
    /at most 64 files/,
  );
  assert.throws(
    () =>
      assertProjectV2FileSetLimits(
        Array.from({ length: 4 }, (_, index) => ({
          path: `files/large-${index}.txt`,
          content: "x".repeat(400_000),
        })),
      ),
    /byte total limit/,
  );
});
