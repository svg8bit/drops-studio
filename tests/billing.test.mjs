import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import Stripe from "stripe";
import { NextRequest } from "next/server.js";

const projectRoot = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const projectPath = specifier.slice(2);
    return {
      shortCircuit: true,
      url: new URL(
        projectPath.endsWith(".ts") ? projectPath : `${projectPath}.ts`,
        projectRoot,
      ).href,
    };
  },
});

const billingModule = await import("../lib/billing.ts").catch(() => null);
const billingStoreModule = await import("../db/billing.ts").catch(() => null);
const checkoutRouteModule = await import(
  "../app/api/billing/checkout/route.ts"
).catch(() => null);
const portalRouteModule = await import(
  "../app/api/billing/portal/route.ts"
).catch(() => null);
const statusRouteModule = await import(
  "../app/api/billing/status/route.ts"
).catch(() => null);
const webhookRouteModule = await import(
  "../app/api/billing/webhook/route.ts"
).catch(() => null);

const accountIdentity = "a".repeat(64);
const accountSecret = "billing-account-cookie-test-secret-with-32-bytes";
const webhookSecret = "whsec_billing_test_secret_1234567890";

function modules() {
  assert.ok(billingModule, "billing module must exist");
  assert.ok(billingStoreModule, "billing store module must exist");
  return { ...billingModule, ...billingStoreModule };
}

function withEnv(values, run) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

function fakeBillingD1(initialAccounts = [], options = {}) {
  const accounts = new Map(initialAccounts.map((account) => [account.accountIdentity, { ...account }]));
  const events = new Map();
  let beforeBatchRan = false;

  function accountFor(sql, args, source = accounts) {
    if (/WHERE account_identity = \?/i.test(sql)) {
      return source.get(args[0]) ?? null;
    }
    if (/WHERE stripe_customer_id = \?/i.test(sql)) {
      return [...source.values()].find((account) => account.stripeCustomerId === args[0]) ?? null;
    }
    if (/WHERE stripe_subscription_id = \?/i.test(sql)) {
      return [...source.values()].find((account) => account.stripeSubscriptionId === args[0]) ?? null;
    }
    return null;
  }

  function row(account) {
    return account && {
      account_identity: account.accountIdentity,
      stripe_customer_id: account.stripeCustomerId,
      stripe_subscription_id: account.stripeSubscriptionId,
      price_id: account.priceId,
      status: account.status,
      current_period_end: account.currentPeriodEnd,
      cancel_at_period_end: account.cancelAtPeriodEnd ? 1 : 0,
      updated_at: account.updatedAt,
    };
  }

  function bound(sql, args = []) {
    return {
      sql,
      args,
      bind(...nextArgs) {
        return bound(sql, nextArgs);
      },
      async first() {
        if (/FROM billing_events/i.test(sql)) {
          const event = events.get(args[0]);
          return event ? { event_id: event.id } : null;
        }
        const account = accountFor(sql, args);
        if (!account) return null;
        if (/SELECT account_identity/i.test(sql) && !/SELECT \*/i.test(sql)) {
          return { account_identity: account.accountIdentity };
        }
        if (/SELECT updated_at, status/i.test(sql)) {
          return { updated_at: account.updatedAt, status: account.status };
        }
        return row(account);
      },
      async run() {
        if (/^CREATE TABLE/i.test(sql.trim())) return { meta: { changes: 0 } };
        if (/INSERT INTO billing_events/i.test(sql)) {
          if (options.failReceiptStorage) throw new Error("D1 receipt storage failed");
          if (events.has(args[0])) throw new Error("UNIQUE billing_events.event_id");
          events.set(args[0], { id: args[0], type: args[1], processedAt: args[2] });
          return { meta: { changes: 1 } };
        }
        if (/INSERT OR IGNORE INTO billing_accounts/i.test(sql)) {
          const [identity, customerId, updatedAt] = args;
          if (
            accounts.has(identity)
            || [...accounts.values()].some((account) => account.stripeCustomerId === customerId)
          ) {
            return { meta: { changes: 0 } };
          }
          accounts.set(identity, {
            accountIdentity: identity,
            stripeCustomerId: customerId,
            stripeSubscriptionId: null,
            priceId: null,
            status: "none",
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            updatedAt,
          });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unsupported D1 run: ${sql}`);
      },
    };
  }

  return {
    accounts,
    events,
    prepare(sql) {
      return bound(sql);
    },
    async batch(statements) {
      if (!beforeBatchRan && options.beforeBatch) {
        beforeBatchRan = true;
        options.beforeBatch({ accounts, events });
      }
      if (options.failBatchStorage) throw new Error("D1 account storage failed");
      const nextAccounts = new Map([...accounts].map(([key, value]) => [key, { ...value }]));
      const nextEvents = new Map(events);
      const results = [];
      for (const statement of statements) {
        const { sql, args } = statement;
        if (/INSERT INTO billing_events/i.test(sql)) {
          if (nextEvents.has(args[0])) throw new Error("UNIQUE billing_events.event_id");
          nextEvents.set(args[0], { id: args[0], type: args[1], processedAt: args[2] });
          results.push({ meta: { changes: 1 } });
          continue;
        }
        if (/INSERT INTO billing_accounts/i.test(sql)) {
          const [identity, customerId, subscriptionId, priceId, status,
            currentPeriodEnd, cancelAtPeriodEnd, updatedAt] = args;
          const customerOwner = [...nextAccounts.values()].find((account) =>
            account.stripeCustomerId === customerId && account.accountIdentity !== identity);
          const subscriptionOwner = subscriptionId
            ? [...nextAccounts.values()].find((account) =>
                account.stripeSubscriptionId === subscriptionId
                && account.accountIdentity !== identity)
            : null;
          if (customerOwner || subscriptionOwner) throw new Error("UNIQUE billing account mapping");
          const current = nextAccounts.get(identity);
          const precedence = (value) => ({
            active: 0,
            trialing: 0,
            incomplete: 1,
            past_due: 2,
            paused: 3,
            unpaid: 4,
            canceled: 5,
            incomplete_expired: 5,
            none: 6,
          })[value] ?? 6;
          const canApply = !current || (
            current.stripeCustomerId === customerId
            && (
              updatedAt > current.updatedAt
              || (updatedAt === current.updatedAt && precedence(status) > precedence(current.status))
            )
          );
          if (!canApply) {
            results.push({ meta: { changes: 0 } });
            continue;
          }
          nextAccounts.set(identity, {
            accountIdentity: identity,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId ?? current?.stripeSubscriptionId ?? null,
            priceId: priceId ?? current?.priceId ?? null,
            status: status === "none" ? current?.status ?? "none" : status,
            currentPeriodEnd: currentPeriodEnd ?? current?.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd),
            updatedAt,
          });
          results.push({ meta: { changes: 1 } });
          continue;
        }
        throw new Error(`Unsupported D1 batch: ${sql}`);
      }
      accounts.clear();
      for (const [key, value] of nextAccounts) accounts.set(key, value);
      events.clear();
      for (const [key, value] of nextEvents) events.set(key, value);
      return results;
    },
  };
}

test("guest, member and Pro entitlements expand honestly while BYOK remains zero-markup", () => {
  const {
    billingEntitlements,
    billingTierForAccount,
    memberPlatformBuildLimit,
  } = modules();
  const guest = billingEntitlements("guest");
  const member = billingEntitlements("member");
  const pro = billingEntitlements("pro");

  assert.deepEqual(
    [guest.platformDailyBuilds, member.platformDailyBuilds, pro.platformDailyBuilds],
    [3, 10, 100],
  );
  assert.deepEqual(
    [guest.privateProjects, member.privateProjects, pro.privateProjects],
    [0, 50, 500],
  );
  assert.deepEqual(
    [guest.teamWorkspaces, member.teamWorkspaces, pro.teamWorkspaces],
    [0, 0, 10],
  );
  for (const entitlement of [guest, member, pro]) {
    assert.deepEqual(entitlement.byok, {
      available: true,
      sessionOnly: true,
      billingOwner: "user",
      markupBasisPoints: 0,
      providers: ["openrouter", "openai", "anthropic", "kimi", "custom"],
    });
  }

  const active = {
    accountIdentity,
    stripeCustomerId: "cus_owner_123456",
    stripeSubscriptionId: "sub_pro_123456",
    priceId: "price_other_product",
    status: "active",
    currentPeriodEnd: "2026-08-30T12:00:00.000Z",
    cancelAtPeriodEnd: false,
    updatedAt: "2026-07-30T12:00:00.000Z",
  };
  const now = new Date("2026-07-30T12:00:01.000Z");
  assert.equal(billingTierForAccount(active, "price_pro_monthly", now), "member");
  assert.equal(memberPlatformBuildLimit(active, "price_pro_monthly", now), 10);
  assert.equal(
    billingTierForAccount(
      { ...active, priceId: "price_pro_monthly" },
      "price_pro_monthly",
      now,
    ),
    "pro",
  );
  assert.equal(
    memberPlatformBuildLimit(
      { ...active, priceId: "price_pro_monthly" },
      "price_pro_monthly",
      now,
    ),
    100,
  );
  assert.equal(
    billingTierForAccount(
      {
        ...active,
        priceId: "price_pro_monthly",
        currentPeriodEnd: "2026-07-30T12:00:01.000Z",
      },
      "price_pro_monthly",
      now,
    ),
    "member",
  );
  assert.equal(
    billingTierForAccount(
      { ...active, priceId: "price_pro_monthly", currentPeriodEnd: null },
      "price_pro_monthly",
      now,
    ),
    "member",
  );
});

test("checkout reuses an owner mapping and sends one server-owned recurring Price", async () => {
  const { createProCheckout } = modules();
  let stored = null;
  let customerCreates = 0;
  const checkoutCalls = [];
  const repository = {
    async readAccount() {
      return stored;
    },
    async saveCustomer(identity, customerId) {
      stored ??= {
        accountIdentity: identity,
        stripeCustomerId: customerId,
        stripeSubscriptionId: null,
        priceId: null,
        status: "none",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        updatedAt: "2026-07-30T12:00:00.000Z",
      };
      return stored;
    },
  };
  const provider = {
    async createCustomer(input) {
      customerCreates += 1;
      assert.equal(input.accountIdentity, accountIdentity);
      assert.doesNotMatch(JSON.stringify(input), /secret|token|api.?key/i);
      return { id: "cus_owner_123456" };
    },
    async createCheckoutSession(input) {
      checkoutCalls.push(input);
      return {
        id: `cs_checkout_${checkoutCalls.length}`,
        url: "https://checkout.stripe.com/c/pay/cs_checkout",
      };
    },
  };

  const input = {
    accountIdentity,
    origin: "https://drops-studio.vercel.app",
    consent: true,
  };
  const options = {
    config: { priceId: "price_pro_monthly", portalReturnPath: "/studio" },
    repository,
    provider,
  };
  await createProCheckout(input, options);
  await createProCheckout(input, options);

  assert.equal(customerCreates, 1);
  assert.equal(checkoutCalls.length, 2);
  assert.equal(checkoutCalls[0].customerId, "cus_owner_123456");
  assert.deepEqual(checkoutCalls[0].lineItems, [
    { price: "price_pro_monthly", quantity: 1 },
  ]);
  assert.equal(checkoutCalls[0].mode, "subscription");
  assert.equal(checkoutCalls[0].allowPromotionCodes, false);
  assert.match(checkoutCalls[0].idempotencyKey, /^drops-checkout-[a-f0-9]{64}$/);
  assert.equal(
    checkoutCalls[0].idempotencyKey,
    checkoutCalls[1].idempotencyKey,
  );
});

test("checkout refuses a second session for an already-active Pro account", async () => {
  const { BillingValidationError, createProCheckout } = modules();
  let providerTouched = false;
  const active = {
    accountIdentity,
    stripeCustomerId: "cus_active_pro_123456",
    stripeSubscriptionId: "sub_active_pro_123456",
    priceId: "price_pro_monthly",
    status: "active",
    currentPeriodEnd: "2026-08-30T12:00:00.000Z",
    cancelAtPeriodEnd: false,
    updatedAt: "2026-07-30T12:00:00.000Z",
  };

  await assert.rejects(
    () => createProCheckout(
      {
        accountIdentity,
        origin: "https://drops-studio.vercel.app",
        consent: true,
      },
      {
        config: { priceId: "price_pro_monthly", portalReturnPath: "/studio" },
        repository: {
          async readAccount() { return active; },
          async saveCustomer() { throw new Error("must not save"); },
        },
        provider: {
          async createCustomer() { providerTouched = true; throw new Error("must not call"); },
          async createCheckoutSession() { providerTouched = true; throw new Error("must not call"); },
          async createPortalSession() { providerTouched = true; throw new Error("must not call"); },
        },
      },
    ),
    BillingValidationError,
  );
  assert.equal(providerTouched, false);
});

test("raw-body Stripe verification is signature-bound and webhook application is idempotent", async () => {
  const {
    applyBillingWebhookEvent,
    readBillingAccount,
    resetLocalBillingStateForTests,
    verifyStripeWebhook,
  } = modules();
  resetLocalBillingStateForTests();
  const payload = JSON.stringify({
    id: "evt_subscription_active_123",
    object: "event",
    api_version: "2026-02-25.clover",
    created: 1785412800,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_pro_123456",
        object: "subscription",
        customer: "cus_owner_123456",
        status: "active",
        cancel_at_period_end: false,
        metadata: { drops_account_identity: accountIdentity },
        items: {
          data: [{
            current_period_end: 1788004800,
            price: { id: "price_pro_monthly", object: "price" },
          }],
        },
      },
    },
  });
  const stripe = new Stripe("sk_test_not_used_for_network_calls");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
    timestamp: 1785412800,
  });

  assert.throws(
    () => verifyStripeWebhook(Buffer.from(payload), `${signature}bad`, webhookSecret),
    /signature/i,
  );
  const event = verifyStripeWebhook(
    Buffer.from(payload),
    signature,
    webhookSecret,
    1785412800,
  );
  assert.equal(event.mutation, "subscription");
  assert.equal(event.currentPeriodEnd, "2026-08-29T12:00:00.000Z");

  await withEnv(
    { DROPS_STUDIO_LOCAL_PROJECT_STORE: "1", VERCEL: undefined },
    async () => {
      const first = await applyBillingWebhookEvent(event);
      const duplicate = await applyBillingWebhookEvent(event);
      const account = await readBillingAccount(accountIdentity);

      assert.deepEqual(first, { status: "processed" });
      assert.deepEqual(duplicate, { status: "duplicate" });
      assert.equal(account.status, "active");
      assert.equal(account.stripeCustomerId, "cus_owner_123456");
      assert.equal(account.stripeSubscriptionId, "sub_pro_123456");
      assert.equal(account.priceId, "price_pro_monthly");
      assert.equal(JSON.stringify(account).includes(webhookSecret), false);
    },
  );
});

test("billing canonicalizes offset webhook instants before persistence", async () => {
  const {
    applyBillingWebhookEvent,
    readBillingAccount,
    resetLocalBillingStateForTests,
  } = modules();
  resetLocalBillingStateForTests();
  await withEnv(
    { DROPS_STUDIO_LOCAL_PROJECT_STORE: "1", VERCEL: undefined },
    async () => {
      await applyBillingWebhookEvent({
        id: "evt_offset_time_123456",
        type: "customer.subscription.updated",
        mutation: "subscription",
        createdAt: "2026-07-30T14:00:00+02:00",
        accountIdentity,
        stripeCustomerId: "cus_offset_123456",
        stripeSubscriptionId: "sub_offset_123456",
        priceId: "price_pro_monthly",
        status: "active",
        currentPeriodEnd: "2026-08-30T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      assert.equal(
        (await readBillingAccount(accountIdentity)).updatedAt,
        "2026-07-30T12:00:00.000Z",
      );
    },
  );
});

test("new customer placeholders accept subscription events created before checkout persistence", async () => {
  const {
    applyBillingWebhookEvent,
    readBillingAccount,
    resetLocalBillingStateForTests,
    saveBillingCustomer,
  } = modules();
  resetLocalBillingStateForTests();

  await withEnv(
    { DROPS_STUDIO_LOCAL_PROJECT_STORE: "1", VERCEL: undefined },
    async () => {
      const placeholder = await saveBillingCustomer(accountIdentity, "cus_placeholder_123456");
      assert.equal(placeholder.updatedAt, "1970-01-01T00:00:00.000Z");

      const result = await applyBillingWebhookEvent({
        id: "evt_placeholder_active_123",
        type: "customer.subscription.created",
        mutation: "subscription",
        createdAt: "2000-01-01T00:00:00.000Z",
        accountIdentity,
        stripeCustomerId: "cus_placeholder_123456",
        stripeSubscriptionId: "sub_placeholder_123456",
        priceId: "price_pro_monthly",
        status: "active",
        currentPeriodEnd: "2099-01-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const account = await readBillingAccount(accountIdentity);

      assert.deepEqual(result, { status: "processed" });
      assert.equal(account?.status, "active");
      assert.equal(account?.updatedAt, "2000-01-01T00:00:00.000Z");
    },
  );
});

test("unsupported Stripe events and unsupported Prices never grant Pro", async () => {
  const {
    applyBillingWebhookEvent,
    billingTierForAccount,
    readBillingAccount,
    resetLocalBillingStateForTests,
    verifyStripeWebhook,
  } = modules();
  resetLocalBillingStateForTests();
  const payload = JSON.stringify({
    id: "evt_payment_intent_ignored_123",
    object: "event",
    api_version: "2026-02-25.clover",
    created: 1785412800,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_ignored_123456",
        customer: "cus_ignored_123456",
        status: "active",
        metadata: { drops_account_identity: accountIdentity },
        items: { data: [{ price: { id: "price_pro_monthly" } }] },
      },
    },
  });
  const stripe = new Stripe("sk_test_not_used_for_network_calls");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
    timestamp: 1785412800,
  });
  const event = verifyStripeWebhook(
    Buffer.from(payload),
    signature,
    webhookSecret,
    1785412800,
  );
  assert.equal(event.mutation, "ignored");

  await withEnv(
    { DROPS_STUDIO_LOCAL_PROJECT_STORE: "1", VERCEL: undefined },
    async () => {
      assert.deepEqual(await applyBillingWebhookEvent(event), { status: "ignored" });
      assert.equal(await readBillingAccount(accountIdentity), null);

      await applyBillingWebhookEvent({
        id: "evt_wrong_price_active_123",
        type: "customer.subscription.updated",
        mutation: "subscription",
        createdAt: "2026-07-30T13:00:00.000Z",
        accountIdentity,
        stripeCustomerId: "cus_wrong_price_123456",
        stripeSubscriptionId: "sub_wrong_price_123456",
        priceId: "price_other_product",
        status: "active",
        currentPeriodEnd: "2026-08-30T13:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const wrongPrice = await readBillingAccount(accountIdentity);
      assert.equal(
        billingTierForAccount(
          wrongPrice,
          "price_pro_monthly",
          new Date("2026-07-30T13:00:01.000Z"),
        ),
        "member",
      );
    },
  );
});

test("older Stripe events are receipted but cannot roll back newer subscription state", async () => {
  const {
    applyBillingWebhookEvent,
    readBillingAccount,
    resetLocalBillingStateForTests,
  } = modules();
  resetLocalBillingStateForTests();
  const base = {
    mutation: "subscription",
    type: "customer.subscription.updated",
    accountIdentity,
    stripeCustomerId: "cus_ordered_123456",
    stripeSubscriptionId: "sub_ordered_123456",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
  };
  await withEnv(
    { DROPS_STUDIO_LOCAL_PROJECT_STORE: "1", VERCEL: undefined },
    async () => {
      const newer = await applyBillingWebhookEvent({
        ...base,
        id: "evt_newer_active_123",
        createdAt: "2026-08-01T00:00:00.000Z",
        priceId: "price_pro_monthly",
        status: "active",
      });
      const stale = await applyBillingWebhookEvent({
        ...base,
        id: "evt_older_canceled_123",
        type: "customer.subscription.deleted",
        createdAt: "2026-07-01T00:00:00.000Z",
        priceId: "price_other_product",
        status: "canceled",
      });
      const replay = await applyBillingWebhookEvent({
        ...base,
        id: "evt_older_canceled_123",
        type: "customer.subscription.deleted",
        createdAt: "2026-07-01T00:00:00.000Z",
        priceId: "price_other_product",
        status: "canceled",
      });
      const account = await readBillingAccount(accountIdentity);

      assert.deepEqual(newer, { status: "processed" });
      assert.deepEqual(stale, { status: "stale" });
      assert.deepEqual(replay, { status: "duplicate" });
      assert.equal(account.status, "active");
      assert.equal(account.priceId, "price_pro_monthly");
      assert.equal(account.updatedAt, "2026-08-01T00:00:00.000Z");
    },
  );
});

test("same-created Stripe delivery always keeps the more restrictive status", async () => {
  const {
    applyBillingWebhookEvent,
    readBillingAccount,
    resetLocalBillingStateForTests,
  } = modules();
  const base = {
    mutation: "subscription",
    accountIdentity,
    stripeCustomerId: "cus_same_second_123456",
    stripeSubscriptionId: "sub_same_second_123456",
    priceId: "price_pro_monthly",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    createdAt: "2026-07-30T12:00:00.000Z",
  };
  const active = {
    ...base,
    id: "evt_same_second_active_123",
    type: "customer.subscription.updated",
    status: "active",
  };
  const canceled = {
    ...base,
    id: "evt_same_second_canceled_123",
    type: "customer.subscription.deleted",
    status: "canceled",
  };

  await withEnv(
    { DROPS_STUDIO_LOCAL_PROJECT_STORE: "1", VERCEL: undefined },
    async () => {
      for (const [index, events] of [[active, canceled], [canceled, active]].entries()) {
        resetLocalBillingStateForTests();
        const results = [];
        for (const event of events) results.push(await applyBillingWebhookEvent(event));
        const account = await readBillingAccount(accountIdentity);
        assert.equal(account.status, "canceled");
        assert.equal(account.updatedAt, base.createdAt);
        assert.equal(results[1].status, index === 0 ? "processed" : "stale");
      }
    },
  );
});

test("local billing never reassigns Stripe customers or subscriptions across account identities", async () => {
  const {
    applyBillingWebhookEvent,
    readBillingAccount,
    resetLocalBillingStateForTests,
    saveBillingCustomer,
  } = modules();
  const secondIdentity = "b".repeat(64);
  resetLocalBillingStateForTests();
  const telemetry = [];
  const originalWarn = console.warn;
  console.warn = (...args) => telemetry.push(args);

  try {
    await withEnv(
      { DROPS_STUDIO_LOCAL_PROJECT_STORE: "1", VERCEL: undefined },
      async () => {
      await saveBillingCustomer(accountIdentity, "cus_local_owner_123456");
      await assert.rejects(
        () => saveBillingCustomer(secondIdentity, "cus_local_owner_123456"),
        /already linked|mapping/i,
      );

      await applyBillingWebhookEvent({
        id: "evt_local_subscription_owner_123",
        type: "customer.subscription.updated",
        mutation: "subscription",
        createdAt: "2099-07-30T12:00:00.000Z",
        accountIdentity,
        stripeCustomerId: "cus_local_owner_123456",
        stripeSubscriptionId: "sub_local_owner_123456",
        priceId: "price_pro_monthly",
        status: "active",
        currentPeriodEnd: "2099-08-30T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const conflictingCustomer = await applyBillingWebhookEvent({
        id: "evt_local_customer_conflict_123",
        type: "customer.subscription.updated",
        mutation: "subscription",
        createdAt: "2099-07-30T13:00:00.000Z",
        accountIdentity: secondIdentity,
        stripeCustomerId: "cus_local_owner_123456",
        stripeSubscriptionId: "sub_local_other_123456",
        priceId: "price_pro_monthly",
        status: "active",
        currentPeriodEnd: "2099-08-30T13:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const conflictingSubscription = await applyBillingWebhookEvent({
        id: "evt_local_subscription_conflict_123",
        type: "customer.subscription.updated",
        mutation: "subscription",
        createdAt: "2099-07-30T14:00:00.000Z",
        accountIdentity: secondIdentity,
        stripeCustomerId: "cus_local_other_123456",
        stripeSubscriptionId: "sub_local_owner_123456",
        priceId: "price_pro_monthly",
        status: "active",
        currentPeriodEnd: "2099-08-30T14:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const metadataFreeReassignment = await applyBillingWebhookEvent({
        id: "evt_local_metadata_free_conflict_123",
        type: "customer.subscription.updated",
        mutation: "subscription",
        createdAt: "2099-07-30T15:00:00.000Z",
        accountIdentity: null,
        stripeCustomerId: "cus_local_reassigned_123456",
        stripeSubscriptionId: "sub_local_owner_123456",
        priceId: "price_pro_monthly",
        status: "active",
        currentPeriodEnd: "2099-08-30T15:00:00.000Z",
        cancelAtPeriodEnd: false,
      });

      assert.deepEqual(conflictingCustomer, { status: "ignored" });
      assert.deepEqual(conflictingSubscription, { status: "ignored" });
      assert.deepEqual(metadataFreeReassignment, { status: "ignored" });
      assert.equal((await readBillingAccount(accountIdentity)).stripeCustomerId, "cus_local_owner_123456");
      assert.equal((await readBillingAccount(accountIdentity)).stripeSubscriptionId, "sub_local_owner_123456");
      assert.equal(await readBillingAccount(secondIdentity), null);
      },
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(telemetry.length, 3);
  for (const entry of telemetry) {
    assert.deepEqual(entry, [
      "Drops Studio billing integrity event.",
      { code: "BILLING_MAPPING_CONFLICT", source: "stripe-webhook" },
    ]);
  }
  assert.doesNotMatch(
    JSON.stringify(telemetry),
    new RegExp(`${accountIdentity}|${secondIdentity}|cus_|sub_|evt_|token`, "i"),
  );
});

test("D1 receipts identity conflicts once while unrelated storage failures remain retryable", async () => {
  const {
    applyBillingWebhookEvent,
    BillingStorageUnavailableError,
  } = modules();
  const secondIdentity = "b".repeat(64);
  const owner = {
    accountIdentity,
    stripeCustomerId: "cus_d1_owner_123456",
    stripeSubscriptionId: "sub_d1_owner_123456",
    priceId: "price_pro_monthly",
    status: "active",
    currentPeriodEnd: "2026-08-30T12:00:00.000Z",
    cancelAtPeriodEnd: false,
    updatedAt: "2026-07-30T12:00:00.000Z",
  };
  const db = fakeBillingD1([owner]);
  const event = {
    id: "evt_d1_mapping_conflict_123",
    type: "customer.subscription.updated",
    mutation: "subscription",
    createdAt: "2026-07-30T13:00:00.000Z",
    accountIdentity: secondIdentity,
    stripeCustomerId: owner.stripeCustomerId,
    stripeSubscriptionId: "sub_d1_other_123456",
    priceId: "price_pro_monthly",
    status: "active",
    currentPeriodEnd: "2026-08-30T13:00:00.000Z",
    cancelAtPeriodEnd: false,
  };

  globalThis.__DROPS_STUDIO_ENV__ = { DB: db };
  try {
    assert.deepEqual(await applyBillingWebhookEvent(event), { status: "ignored" });
    assert.deepEqual(await applyBillingWebhookEvent(event), { status: "duplicate" });
    const subscriptionConflict = {
      ...event,
      id: "evt_d1_subscription_conflict_123",
      stripeCustomerId: "cus_d1_other_123456",
      stripeSubscriptionId: owner.stripeSubscriptionId,
    };
    assert.deepEqual(
      await applyBillingWebhookEvent(subscriptionConflict),
      { status: "ignored" },
    );
    assert.equal(db.events.has(event.id), true);
    assert.equal(db.events.has(subscriptionConflict.id), true);
    assert.deepEqual(db.accounts.get(accountIdentity), owner);
    assert.equal(db.accounts.has(secondIdentity), false);
  } finally {
    globalThis.__DROPS_STUDIO_ENV__ = undefined;
  }

  const raceOwner = { ...owner, stripeCustomerId: "cus_d1_race_123456" };
  const race = fakeBillingD1([], {
    beforeBatch({ accounts }) {
      accounts.set(accountIdentity, raceOwner);
    },
  });
  const racedEvent = {
    ...event,
    id: "evt_d1_raced_mapping_123",
    stripeCustomerId: raceOwner.stripeCustomerId,
    stripeSubscriptionId: "sub_d1_raced_other_123456",
  };
  globalThis.__DROPS_STUDIO_ENV__ = { DB: race };
  try {
    assert.deepEqual(await applyBillingWebhookEvent(racedEvent), { status: "ignored" });
    assert.deepEqual(await applyBillingWebhookEvent(racedEvent), { status: "duplicate" });
    assert.equal(race.events.has(racedEvent.id), true);
    assert.equal(race.accounts.has(secondIdentity), false);
  } finally {
    globalThis.__DROPS_STUDIO_ENV__ = undefined;
  }

  const unavailable = fakeBillingD1([], { failBatchStorage: true });
  globalThis.__DROPS_STUDIO_ENV__ = { DB: unavailable };
  try {
    await assert.rejects(
      () => applyBillingWebhookEvent({
        ...event,
        id: "evt_d1_storage_failure_123",
        stripeCustomerId: "cus_d1_new_owner_123456",
        stripeSubscriptionId: "sub_d1_new_owner_123456",
      }),
      BillingStorageUnavailableError,
    );
    assert.equal(unavailable.events.has("evt_d1_storage_failure_123"), false);
  } finally {
    globalThis.__DROPS_STUDIO_ENV__ = undefined;
  }
});

test("D1 reports a receipted webhook as stale when its conditional account write loses an ordering race", async () => {
  const { applyBillingWebhookEvent } = modules();
  const older = {
    accountIdentity,
    stripeCustomerId: "cus_d1_ordering_123456",
    stripeSubscriptionId: "sub_d1_ordering_123456",
    priceId: "price_pro_monthly",
    status: "active",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    updatedAt: "2026-07-30T12:00:00.000Z",
  };
  const newer = {
    ...older,
    status: "canceled",
    updatedAt: "2026-07-30T14:00:00.000Z",
  };
  const db = fakeBillingD1([older], {
    beforeBatch({ accounts }) {
      accounts.set(accountIdentity, newer);
    },
  });
  const event = {
    id: "evt_d1_ordering_race_123",
    type: "customer.subscription.updated",
    mutation: "subscription",
    createdAt: "2026-07-30T13:00:00.000Z",
    accountIdentity,
    stripeCustomerId: older.stripeCustomerId,
    stripeSubscriptionId: older.stripeSubscriptionId,
    priceId: older.priceId,
    status: "past_due",
    currentPeriodEnd: older.currentPeriodEnd,
    cancelAtPeriodEnd: false,
  };

  globalThis.__DROPS_STUDIO_ENV__ = { DB: db };
  try {
    assert.deepEqual(await applyBillingWebhookEvent(event), { status: "stale" });
    assert.deepEqual(await applyBillingWebhookEvent(event), { status: "duplicate" });
    assert.deepEqual(db.accounts.get(accountIdentity), newer);
    assert.equal(db.events.has(event.id), true);
  } finally {
    globalThis.__DROPS_STUDIO_ENV__ = undefined;
  }
});

test("checkout endpoint fails closed with 503 when Stripe is unconfigured", async () => {
  assert.ok(checkoutRouteModule, "checkout route must exist");
  const { createStudioAccountCookie, STUDIO_ACCOUNT_COOKIE } = await import(
    "../lib/access-tier.ts"
  );
  const cookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "billing-user-123" },
    accountSecret,
  );
  await withEnv(
    {
      DROPS_ACCOUNT_COOKIE_SECRET: accountSecret,
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRO_PRICE_ID: undefined,
      STRIPE_WEBHOOK_SECRET: undefined,
    },
    async () => {
      const response = await checkoutRouteModule.POST(
        new NextRequest("https://drops-studio.vercel.app/api/billing/checkout", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
            origin: "https://drops-studio.vercel.app",
          },
          body: JSON.stringify({ consent: true }),
        }),
      );
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.match(body.error, /not configured|unavailable/i);
      assert.doesNotMatch(JSON.stringify(body), /STRIPE_|sk_|whsec_/);
    },
  );
});

test("checkout endpoint rejects JSON-like media types before calling Stripe", async () => {
  assert.ok(checkoutRouteModule, "checkout route must exist");
  const { createStudioAccountCookie, STUDIO_ACCOUNT_COOKIE } = await import(
    "../lib/access-tier.ts"
  );
  const cookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "billing-boundary-user-123" },
    accountSecret,
  );
  await withEnv(
    {
      DROPS_ACCOUNT_COOKIE_SECRET: accountSecret,
      DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
      VERCEL: undefined,
      STRIPE_SECRET_KEY: "sk_test_boundary_only_123456",
      STRIPE_PRO_PRICE_ID: "price_pro_monthly",
    },
    async () => {
      const response = await checkoutRouteModule.POST(
        new NextRequest("https://drops-studio.vercel.app/api/billing/checkout", {
          method: "POST",
          headers: {
            "content-type": "application/jsonp",
            cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
            origin: "https://drops-studio.vercel.app",
          },
          body: JSON.stringify({ consent: true }),
        }),
      );
      assert.equal(response.status, 415);
    },
  );
});

test("customer portal is available only for the signed owner's mapped customer", async () => {
  const { createCustomerPortal } = modules();
  const calls = [];
  const result = await createCustomerPortal(
    {
      accountIdentity,
      origin: "https://drops-studio.vercel.app",
    },
    {
      config: { priceId: "price_pro_monthly", portalReturnPath: "/studio" },
      repository: {
        async readAccount(identity) {
          assert.equal(identity, accountIdentity);
          return {
            accountIdentity,
            stripeCustomerId: "cus_owner_123456",
            stripeSubscriptionId: "sub_pro_123456",
            priceId: "price_pro_monthly",
            status: "active",
            currentPeriodEnd: "2026-08-30T12:00:00.000Z",
            cancelAtPeriodEnd: false,
            updatedAt: "2026-07-30T12:00:00.000Z",
          };
        },
        async saveCustomer() {
          throw new Error("portal must not create a customer");
        },
      },
      provider: {
        async createCustomer() {
          throw new Error("portal must not create a customer");
        },
        async createCheckoutSession() {
          throw new Error("portal must not create checkout");
        },
        async createPortalSession(input) {
          calls.push(input);
          return {
            id: "bps_portal_123456",
            url: "https://billing.stripe.com/p/session/test",
          };
        },
      },
    },
  );

  assert.deepEqual(calls, [{
    customerId: "cus_owner_123456",
    returnUrl: "https://drops-studio.vercel.app/studio",
  }]);
  assert.equal(result.sessionId, "bps_portal_123456");
  assert.equal(result.portalUrl, "https://billing.stripe.com/p/session/test");
});

test("webhook route verifies raw bytes before parsing and returns duplicate receipts", async () => {
  assert.ok(webhookRouteModule, "billing webhook route must exist");
  const { resetLocalBillingStateForTests } = modules();
  resetLocalBillingStateForTests();
  const payload = JSON.stringify({
    id: "evt_route_subscription_123",
    object: "event",
    api_version: "2026-02-25.clover",
    created: 1785412800,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_route_123456",
        object: "subscription",
        customer: "cus_route_123456",
        status: "trialing",
        cancel_at_period_end: false,
        current_period_end: 1788004800,
        metadata: { drops_account_identity: accountIdentity },
        items: { data: [{ price: { id: "price_pro_monthly" } }] },
      },
    },
  });
  const stripe = new Stripe("sk_test_not_used_for_network_calls");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  await withEnv(
    {
      DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
      VERCEL: undefined,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    },
    async () => {
      const send = () => webhookRouteModule.POST(
        new NextRequest("https://drops-studio.vercel.app/api/billing/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          body: payload,
        }),
      );
      const first = await send();
      const duplicate = await send();
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), { received: true, duplicate: false });
      assert.equal(duplicate.status, 200);
      assert.deepEqual(await duplicate.json(), { received: true, duplicate: true });

      const tampered = await webhookRouteModule.POST(
        new NextRequest("https://drops-studio.vercel.app/api/billing/webhook", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
          body: `${payload} `,
        }),
      );
      assert.equal(tampered.status, 400);
    },
  );
});

test("billing status derives Pro only from an active signed owner mapping", async () => {
  assert.ok(statusRouteModule, "billing status route must exist");
  assert.ok(portalRouteModule, "billing portal route must exist");
  const {
    applyBillingWebhookEvent,
    resetLocalBillingStateForTests,
  } = modules();
  const {
    createStudioAccountCookie,
    readStudioAccountCookie,
    STUDIO_ACCOUNT_COOKIE,
  } = await import("../lib/access-tier.ts");
  const cookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "billing-status-user" },
    accountSecret,
  );
  const account = readStudioAccountCookie(cookie, accountSecret);
  assert.ok(account);
  resetLocalBillingStateForTests();

  await withEnv(
    {
      DROPS_ACCOUNT_COOKIE_SECRET: accountSecret,
      DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
      STRIPE_PRO_PRICE_ID: "price_pro_monthly",
      VERCEL: undefined,
    },
    async () => {
      await applyBillingWebhookEvent({
        id: "evt_status_active_123",
        type: "customer.subscription.updated",
        mutation: "subscription",
        createdAt: "2026-07-30T12:00:00.000Z",
        accountIdentity: account.identity,
        stripeCustomerId: "cus_status_123456",
        stripeSubscriptionId: "sub_status_123456",
        priceId: "price_pro_monthly",
        status: "active",
        currentPeriodEnd: "2026-08-30T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      });
      const response = await statusRouteModule.GET(
        new NextRequest("https://drops-studio.vercel.app/api/billing/status", {
          headers: { cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}` },
        }),
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.tier, "pro");
      assert.equal(body.entitlements.byok.markupBasisPoints, 0);
      assert.equal(body.entitlements.teamWorkspaces, 10);
      assert.equal("stripeCustomerId" in body, false);
    },
  );
});

test("planner quota enforces 10 member builds and 100 exact-Price Pro builds", async () => {
  const planRoute = await import("../app/api/agent/plan/route.ts");
  const {
    applyBillingWebhookEvent,
    resetLocalBillingStateForTests,
  } = modules();
  const {
    createStudioAccountCookie,
    readStudioAccountCookie,
    STUDIO_ACCOUNT_COOKIE,
  } = await import("../lib/access-tier.ts");
  const memberCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "quota-member-user" },
    accountSecret,
  );
  const proCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "quota-pro-user" },
    accountSecret,
  );
  const member = readStudioAccountCookie(memberCookie, accountSecret);
  const pro = readStudioAccountCookie(proCookie, accountSecret);
  assert.ok(member);
  assert.ok(pro);
  resetLocalBillingStateForTests();

  await withEnv({
    DROPS_ACCOUNT_COOKIE_SECRET: accountSecret,
    DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
    VERCEL: undefined,
    AI_GATEWAY_API_KEY: "gateway_test_key_not_returned",
    STRIPE_PRO_PRICE_ID: "price_pro_monthly",
  }, async () => {
    await applyBillingWebhookEvent({
      id: "evt_quota_pro_active_123",
      type: "customer.subscription.updated",
      mutation: "subscription",
      createdAt: "2026-07-30T12:00:00.000Z",
      accountIdentity: pro.identity,
      stripeCustomerId: "cus_quota_pro_123456",
      stripeSubscriptionId: "sub_quota_pro_123456",
      priceId: "price_pro_monthly",
      status: "active",
      currentPeriodEnd: "2026-08-30T12:00:00.000Z",
      cancelAtPeriodEnd: false,
    });
    const windowMs = 24 * 60 * 60 * 1_000;
    const bucket = Math.floor(Date.now() / windowMs);
    globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__ = new Map(
      [bucket, bucket + 1].flatMap((candidate) => {
        const expiresAt = (candidate + 1) * windowMs;
        return [
          [`member-ai-plan:${candidate}:${member.identity}`, { count: 10, expiresAt }],
          [`member-ai-plan:${candidate}:${pro.identity}`, { count: 100, expiresAt }],
        ];
      }),
    );
    try {
      const request = (cookie) => new NextRequest(
        "https://drops-studio.vercel.app/api/agent/plan",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${STUDIO_ACCOUNT_COOKIE}=${cookie}`,
          },
          body: JSON.stringify({ prompt: "Build a real crypto research product" }),
        },
      );
      const memberResponse = await planRoute.POST(request(memberCookie));
      const proResponse = await planRoute.POST(request(proCookie));
      const memberBody = await memberResponse.json();
      const proBody = await proResponse.json();

      assert.equal(memberResponse.status, 429);
      assert.equal(memberBody.tier ?? memberBody.access.tier, "member");
      assert.equal(memberBody.access.platformAi.limit, 10);
      assert.equal(proResponse.status, 429);
      assert.equal(proBody.tier ?? proBody.access.tier, "pro");
      assert.equal(proBody.access.platformAi.limit, 100);
    } finally {
      delete globalThis.__DROPS_STUDIO_LOCAL_RATE_LIMITS__;
    }
  });
});

test("shared funded quota helper exposes authoritative guest/member/Pro daily boundaries", async () => {
  const {
    consumeFundedBuildQuota,
    createStudioAccountCookie,
    readStudioAccountCookie,
    resolveFundedBuildQuota,
  } = await import("../lib/access-tier.ts");
  const {
    applyBillingWebhookEvent,
    resetLocalBillingStateForTests,
  } = modules();
  const memberCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "helper-member-user" },
    accountSecret,
  );
  const proCookie = createStudioAccountCookie(
    { provider: "openrouter", subject: "helper-pro-user" },
    accountSecret,
  );
  const member = readStudioAccountCookie(memberCookie, accountSecret);
  const pro = readStudioAccountCookie(proCookie, accountSecret);
  assert.ok(member);
  assert.ok(pro);
  resetLocalBillingStateForTests();

  await withEnv({
    DROPS_STUDIO_LOCAL_PROJECT_STORE: "1",
    VERCEL: undefined,
    STRIPE_PRO_PRICE_ID: "price_pro_monthly",
  }, async () => {
    await applyBillingWebhookEvent({
      id: "evt_helper_pro_active_123",
      type: "customer.subscription.updated",
      mutation: "subscription",
      createdAt: "2026-07-30T12:00:00.000Z",
      accountIdentity: pro.identity,
      stripeCustomerId: "cus_helper_pro_123456",
      stripeSubscriptionId: "sub_helper_pro_123456",
      priceId: "price_pro_monthly",
      status: "active",
      currentPeriodEnd: "2026-08-30T12:00:00.000Z",
      cancelAtPeriodEnd: false,
    });
    const guest = await resolveFundedBuildQuota({
      kind: "guest",
      identity: "11111111-1111-4111-8111-111111111111",
    });
    const freeMember = await resolveFundedBuildQuota({ kind: "account", account: member });
    const paid = await resolveFundedBuildQuota({ kind: "account", account: pro });
    assert.deepEqual(
      [guest.tier, guest.limit, guest.namespace],
      ["guest", 3, "guest-ai-plan"],
    );
    assert.deepEqual(
      [freeMember.tier, freeMember.limit, freeMember.namespace],
      ["member", 10, "member-ai-plan"],
    );
    assert.deepEqual(
      [paid.tier, paid.limit, paid.namespace],
      ["pro", 100, "member-ai-plan"],
    );

    let consumedOptions;
    const consumed = await consumeFundedBuildQuota(
      { kind: "account", account: pro },
      {
        async consume(options) {
          consumedOptions = options;
          return { status: "allowed", count: 11, remaining: 89 };
        },
      },
    );
    assert.equal(consumed.tier, "pro");
    assert.equal(consumed.status, "allowed");
    assert.equal(consumed.remaining, 89);
    assert.deepEqual(consumedOptions, {
      identity: pro.identity,
      namespace: "member-ai-plan",
      max: 100,
      windowMs: 24 * 60 * 60 * 1_000,
    });
  });
});
