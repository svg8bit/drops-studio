import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";

const entitlementModule = await import(
  "../lib/workspace-ai-entitlement.ts"
).catch(() => null);
const accessModule = await import("../lib/access-tier.ts");

function api() {
  assert.ok(entitlementModule, "workspace AI entitlement module must exist");
  return entitlementModule;
}

function baseEnv(overrides = {}) {
  return {
    NODE_ENV: "test",
    AI_GATEWAY_API_KEY: "gateway-test-token",
    DROPS_GUEST_COOKIE_SECRET: "guest-test-signing-secret",
    DROPS_ACCOUNT_COOKIE_SECRET: "account-test-signing-secret",
    DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
    ...overrides,
  };
}

function request(cookie) {
  return new NextRequest("https://drops-studio.example/api/workspace/patch", {
    headers: cookie ? { cookie } : {},
  });
}

test("reserves the shared three-per-day guest platform allowance", async () => {
  const { reserveWorkspacePlatformQuota } = api();
  let quotaInput;
  const result = await reserveWorkspacePlatformQuota(request(), {
    env: baseEnv(),
    createGuestIdentity: () => "12345678-1234-1234-1234-123456789abc",
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    async consumeQuota(input) {
      quotaInput = input;
      return { status: "allowed", count: 1, remaining: 2 };
    },
  });

  assert.equal(quotaInput.namespace, "guest-ai-plan");
  assert.equal(quotaInput.max, 3);
  assert.equal(quotaInput.windowMs, 86_400_000);
  assert.equal(result.tier, "guest");
  assert.equal(result.identity, "12345678-1234-1234-1234-123456789abc");
  assert.equal(result.used, 1);
  assert.equal(result.remaining, 2);
  assert.deepEqual(
    result.cookies.map((cookie) => cookie.name),
    ["drops_guest_identity", "drops_guest_builds"],
  );
});

test("resolves a paid account to the shared 100-per-day Pro allowance", async () => {
  const { reserveWorkspacePlatformQuota } = api();
  const env = baseEnv({ STRIPE_PRO_PRICE_ID: "price_pro123456" });
  const accountCookie = accessModule.createStudioAccountCookie(
    { provider: "openrouter", subject: "openrouter-user-pro-123456" },
    env.DROPS_ACCOUNT_COOKIE_SECRET,
  );
  let quotaInput;
  let billingIdentity;
  const result = await reserveWorkspacePlatformQuota(
    request(`drops_studio_account=${accountCookie}`),
    {
      env,
      now: () => new Date("2026-07-30T12:00:01.000Z"),
      billingStorageConfigured: () => true,
      async readBillingAccount(identity) {
        billingIdentity = identity;
        return {
          accountIdentity: identity,
          stripeCustomerId: "cus_pro123456",
          stripeSubscriptionId: "sub_pro123456",
          priceId: "price_pro123456",
          status: "active",
          currentPeriodEnd: "2026-08-30T12:00:00.000Z",
          cancelAtPeriodEnd: false,
          updatedAt: "2026-07-30T12:00:00.000Z",
        };
      },
      async consumeQuota(input) {
        quotaInput = input;
        return { status: "allowed", count: 11, remaining: 89 };
      },
    },
  );

  assert.equal(billingIdentity, result.identity);
  assert.equal(quotaInput.identity, result.identity);
  assert.equal(quotaInput.namespace, "member-ai-plan");
  assert.equal(quotaInput.max, 100);
  assert.equal(result.tier, "pro");
  assert.equal(result.limit, 100);
  assert.equal(result.remaining, 89);
  assert.equal(result.account.identity, result.identity);
  assert.deepEqual(
    result.cookies.map((cookie) => cookie.name),
    ["drops_member_builds"],
  );
});

test("reserves a separate tier-derived sandbox execution allowance", async () => {
  const { reserveWorkspaceExecutionQuota } = api();
  let quotaInput;
  const result = await reserveWorkspaceExecutionQuota(request(), {
    env: baseEnv({ AI_GATEWAY_API_KEY: undefined }),
    createGuestIdentity: () => "12345678-1234-1234-1234-123456789abc",
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    async consumeQuota(input) {
      quotaInput = input;
      return { status: "allowed", count: 1, remaining: 2 };
    },
  });

  assert.equal(quotaInput.namespace, "guest-sandbox-execution");
  assert.equal(quotaInput.max, 3);
  assert.equal(result.tier, "guest");
  assert.equal(result.used, 1);
  assert.equal(result.remaining, 2);
  assert.deepEqual(
    result.cookies.map((cookie) => cookie.name),
    ["drops_guest_identity"],
  );
});

test("expired billing state cannot expand the sandbox execution allowance", async () => {
  const { reserveWorkspaceExecutionQuota } = api();
  const env = baseEnv({
    AI_GATEWAY_API_KEY: undefined,
    STRIPE_PRO_PRICE_ID: "price_pro123456",
  });
  const accountCookie = accessModule.createStudioAccountCookie(
    { provider: "openrouter", subject: "expired-pro-execution-user" },
    env.DROPS_ACCOUNT_COOKIE_SECRET,
  );
  let quotaInput;
  const result = await reserveWorkspaceExecutionQuota(
    request(`drops_studio_account=${accountCookie}`),
    {
      env,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      billingStorageConfigured: () => true,
      async readBillingAccount(identity) {
        return {
          accountIdentity: identity,
          stripeCustomerId: "cus_expired123456",
          stripeSubscriptionId: "sub_expired123456",
          priceId: "price_pro123456",
          status: "active",
          currentPeriodEnd: "2026-07-30T11:59:59.000Z",
          cancelAtPeriodEnd: false,
          updatedAt: "2026-07-29T12:00:00.000Z",
        };
      },
      async consumeQuota(input) {
        quotaInput = input;
        return { status: "allowed", count: 1, remaining: 9 };
      },
    },
  );

  assert.equal(result.tier, "member");
  assert.equal(result.limit, 10);
  assert.equal(quotaInput.namespace, "member-sandbox-execution");
  assert.equal(quotaInput.max, 10);
});

test("billing failures fail closed to the member allowance", async () => {
  const { reserveWorkspacePlatformQuota } = api();
  const env = baseEnv({ STRIPE_PRO_PRICE_ID: "price_pro123456" });
  const accountCookie = accessModule.createStudioAccountCookie(
    { provider: "openrouter", subject: "openrouter-user-member-123456" },
    env.DROPS_ACCOUNT_COOKIE_SECRET,
  );
  let quotaInput;
  const result = await reserveWorkspacePlatformQuota(
    request(`drops_studio_account=${accountCookie}`),
    {
      env,
      billingStorageConfigured: () => true,
      async readBillingAccount() {
        throw new Error("storage unavailable");
      },
      async consumeQuota(input) {
        quotaInput = input;
        return { status: "allowed", count: 1, remaining: 9 };
      },
    },
  );

  assert.equal(quotaInput.max, 10);
  assert.equal(result.tier, "member");
  assert.equal(result.limit, 10);
});

test("fails closed when the daily allowance cannot be reserved", async () => {
  const {
    reserveWorkspacePlatformQuota,
    WorkspaceAiQuotaLimitError,
    WorkspaceAiQuotaUnavailableError,
  } = api();
  const dependencies = {
    env: baseEnv(),
    createGuestIdentity: () => "12345678-1234-1234-1234-123456789abc",
  };

  await assert.rejects(
    () =>
      reserveWorkspacePlatformQuota(request(), {
        ...dependencies,
        async consumeQuota() {
          return { status: "limited", count: 4, remaining: 0 };
        },
      }),
    WorkspaceAiQuotaLimitError,
  );
  await assert.rejects(
    () =>
      reserveWorkspacePlatformQuota(request(), {
        ...dependencies,
        async consumeQuota() {
          return { status: "unavailable", count: null, remaining: null };
        },
      }),
    WorkspaceAiQuotaUnavailableError,
  );
});
