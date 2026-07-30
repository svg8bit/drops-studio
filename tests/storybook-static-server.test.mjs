import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("static Storybook server awaits stream completion and handles read failures", async () => {
  const source = await readFile(
    new URL("../scripts/serve-storybook-static.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /node:stream\/promises/);
  assert.match(source, /await pipeline\(createReadStream\(filePath\), response\)/);
});
