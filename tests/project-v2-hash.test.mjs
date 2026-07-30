import assert from "node:assert/strict";
import test from "node:test";

const {
  hashProjectV2FileContent,
  hashProjectV2Files,
} = await import("../lib/project-v2-hash.ts");

test("uses deterministic SHA-256 hashes for file contents", async () => {
  assert.equal(
    await hashProjectV2FileContent("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("hashes file maps independently of object insertion order", async () => {
  const first = {
    "z.txt": { path: "z.txt", content: "last", hash: await hashProjectV2FileContent("last") },
    "a.txt": { path: "a.txt", content: "first", hash: await hashProjectV2FileContent("first") },
  };
  const second = { "a.txt": first["a.txt"], "z.txt": first["z.txt"] };
  assert.equal(await hashProjectV2Files(first), await hashProjectV2Files(second));
  second["z.txt"] = {
    ...second["z.txt"],
    content: "changed",
    hash: await hashProjectV2FileContent("changed"),
  };
  assert.notEqual(await hashProjectV2Files(first), await hashProjectV2Files(second));
});
