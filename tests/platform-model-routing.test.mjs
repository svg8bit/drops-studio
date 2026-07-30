import assert from "node:assert/strict";
import test from "node:test";

const { PLATFORM_PLAN_MODELS } = await import(
  "../app/api/agent/plan/route.ts"
);

test("platform-funded planning starts with GPT-5.6 Sol for guests and members", () => {
  assert.equal(PLATFORM_PLAN_MODELS.guest[0], "openai/gpt-5.6-sol");
  assert.equal(PLATFORM_PLAN_MODELS.member[0], "openai/gpt-5.6-sol");
  assert.ok(PLATFORM_PLAN_MODELS.guest.length <= 2);
  assert.ok(PLATFORM_PLAN_MODELS.member.length <= 2);
});
