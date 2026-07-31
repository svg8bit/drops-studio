import assert from "node:assert/strict";
import test from "node:test";

test("account profile labels trim display names and always provide a stable initial", async () => {
  const profile = await import("../lib/studio-account-profile.ts");

  assert.equal(profile.studioAccountDisplayName("  Ada   Lovelace  "), "Ada Lovelace");
  assert.equal(profile.studioAccountDisplayName("   "), "Drops Studio member");
  assert.equal(profile.studioAccountInitial("  ada "), "A");
  assert.equal(profile.studioAccountInitial("   "), "D");
});
