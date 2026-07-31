import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const path = specifier.slice(2);
    return { shortCircuit: true, url: new URL(path.endsWith(".ts") ? path : `${path}.ts`, new URL("../", import.meta.url)).href };
  },
});

const managed = await import("../lib/managed-platform/index.ts");

const SCOPE = managed.managedScope({ organizationId: "org", workspaceId: "workspace", projectId: "project", environment: "development" });
const OTHER_ENV = managed.managedScope({ ...SCOPE, environment: "preview" });

function principal(scope = SCOPE, actorId = "owner") {
  return managed.managedPrincipal({
    actorId,
    actorType: "user",
    scope,
    roles: ["owner"],
    permissions: [
      "backend.auth.manage", "backend.storage.manage", "backend.functions.manage", "backend.functions.invoke",
      "backend.webhooks.manage", "backend.webhooks.replay", "backend.jobs.manage", "backend.cron.manage",
      "backend.realtime.read", "backend.realtime.publish", "backend.secrets.manage", "backend.logs.read", "backend.backups.manage",
      "backend.schema.manage", "backend.data.read", "backend.data.write", "backend.data.admin",
    ],
  });
}

function platformAt(clock) {
  return managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 3),
    encryptionKey: Buffer.alloc(32, 4),
    now: () => new Date(clock.value),
  });
}

test("managed auth is project-scoped, CSRF-bound, revocable, and honest without email delivery", async () => {
  const clock = { value: Date.parse("2026-07-30T10:00:00.000Z") };
  const platform = platformAt(clock);
  platform.environments.ensure(SCOPE, principal());
  assert.deepEqual(await platform.auth.requestEmailCode(SCOPE, "user@example.com", principal()), { status: "setup-required", reasonCode: "EMAIL_ADAPTER_REQUIRED" });

  const user = platform.auth.createUser(SCOPE, { email: "user@example.com", roles: ["developer"], profile: { name: "User" } }, principal());
  const session = platform.auth.createSession(SCOPE, user.id, principal(), { ttlSeconds: 600 });
  assert.ok(session.token.startsWith("ds_session_"));
  assert.ok(session.csrfToken.startsWith("ds_csrf_"));
  assert.equal(platform.auth.verifySession(SCOPE, session.token, { write: true, csrfToken: session.csrfToken }).userId, user.id);
  assert.throws(() => platform.auth.verifySession(SCOPE, session.token, { write: true, csrfToken: "wrong" }), /CSRF/i);
  assert.throws(() => platform.auth.verifySession(OTHER_ENV, session.token), /scope|environment/i);
  platform.auth.revokeSession(SCOPE, session.id, principal());
  assert.throws(() => platform.auth.verifySession(SCOPE, session.token), /revoked/i);
});

test("secret vault exposes only metadata and signed object capabilities cannot cross environments", () => {
  const clock = { value: Date.parse("2026-07-30T10:00:00.000Z") };
  const platform = platformAt(clock);
  platform.environments.ensure(SCOPE, principal());
  platform.environments.ensure(OTHER_ENV, principal(OTHER_ENV));
  const secret = platform.secrets.create(SCOPE, { name: "DROPSTAB_KEY", value: "synthetic-test-secret-value", allowedPurposes: ["function", "webhook"] }, principal());
  assert.equal(secret.masked, "••••••••");
  assert.equal(JSON.stringify(secret).includes("synthetic-test-secret-value"), false);
  assert.equal(platform.secrets.resolveForRuntime, undefined);

  const object = platform.storage.put(SCOPE, {
    key: "attachments/report.json",
    contentType: "application/json",
    visibility: "private",
    bytes: Buffer.from("{\"ok\":true}"),
  }, principal());
  const capability = platform.storage.signCapability(SCOPE, object.id, "read", principal(), { ttlSeconds: 60 });
  assert.deepEqual(platform.storage.read(SCOPE, capability, principal()).bytes, Buffer.from("{\"ok\":true}"));
  assert.throws(() => platform.storage.read(OTHER_ENV, capability, principal(OTHER_ENV)), /scope|environment/i);
  clock.value += 61_000;
  assert.throws(() => platform.storage.read(SCOPE, capability, principal()), /expired/i);
});

test("functions, signed webhooks, jobs, cron, realtime, and logs use real in-memory evidence without leaking secrets", async () => {
  const clock = { value: Date.parse("2026-07-30T10:00:00.000Z") };
  const runtime = new managed.InMemoryFunctionRuntime({
    summarize: async (input) => ({ count: input.events.length, authorization: "must-redact" }),
  });
  const platform = managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 3),
    encryptionKey: Buffer.alloc(32, 4),
    now: () => new Date(clock.value),
    functionRuntime: runtime,
  });
  platform.environments.ensure(SCOPE, principal());
  platform.functions.register(SCOPE, {
    name: "summarize",
    version: 1,
    timeoutMs: 1_000,
    input: { events: "json" },
    output: { count: "integer", authorization: "string" },
    allowedNetworkHosts: [],
    secretReferences: [],
  }, principal());
  const invocation = await platform.functions.invoke(SCOPE, "summarize", { events: [{ id: 1 }] }, principal());
  assert.equal(invocation.status, "succeeded");
  assert.equal(invocation.output.count, 1);

  const webhookSecret = platform.secrets.create(SCOPE, { name: "WEBHOOK_SIGNING", value: "webhook-secret-value", allowedPurposes: ["webhook"] }, principal());
  const endpoint = platform.webhooks.register(SCOPE, { name: "dropsbot", signingSecretId: webhookSecret.id, eventType: "wallet.event" }, principal());
  const body = JSON.stringify({ wallet: "0xabc", authorization: "Bearer should-redact" });
  const timestamp = Math.floor(clock.value / 1000);
  const signature = createHmac("sha256", "webhook-secret-value").update(`${timestamp}.nonce-1.${body}`).digest("hex");
  const accepted = platform.webhooks.receive(SCOPE, endpoint.id, { body, timestamp, nonce: "nonce-1", signature });
  assert.equal(accepted.status, "accepted");
  assert.throws(() => platform.webhooks.receive(SCOPE, endpoint.id, { body, timestamp, nonce: "nonce-1", signature }), /replay/i);

  const firstJob = platform.jobs.enqueue(SCOPE, { type: "morning-summary", payload: { eventId: accepted.eventId }, idempotencyKey: "summary-event-1", maxAttempts: 2 }, principal());
  const sameJob = platform.jobs.enqueue(SCOPE, { type: "morning-summary", payload: { eventId: accepted.eventId }, idempotencyKey: "summary-event-1", maxAttempts: 2 }, principal());
  assert.equal(sameJob.id, firstJob.id);
  const ran = await platform.jobs.runNext(SCOPE, { "morning-summary": async () => ({ delivered: false, setupRequired: "Telegram approval required" }) });
  assert.equal(ran.status, "succeeded");

  const schedule = platform.cron.create(SCOPE, { name: "morning", expression: "0 8 * * *", timezone: "UTC", jobType: "morning-summary", enabled: true, overlapPolicy: "skip" }, principal());
  assert.equal(schedule.nextRunAt, "2026-07-31T08:00:00.000Z");
  assert.throws(() => platform.cron.create(managed.managedScope({ ...SCOPE, environment: "production" }), { name: "unsafe", expression: "* * * * *", timezone: "UTC", jobType: "x", enabled: true, overlapPolicy: "skip" }, principal(managed.managedScope({ ...SCOPE, environment: "production" }))), /approval/i);

  const subscription = platform.realtime.subscribe(SCOPE, { collection: "walletEvents" }, principal());
  platform.realtime.publish(SCOPE, "walletEvents", "created", { id: "event-1" }, principal());
  assert.equal(platform.realtime.poll(SCOPE, subscription, principal()).events[0].sequence, 1);
  assert.throws(() => platform.realtime.poll(OTHER_ENV, subscription, principal(OTHER_ENV)), /scope|environment/i);

  const logs = platform.logs.list(SCOPE, principal());
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes("webhook-secret-value"), false);
  assert.equal(serialized.includes("Bearer should-redact"), false);
  assert.equal(serialized.includes("must-redact"), false);
  assert.ok(serialized.includes("[REDACTED]"));
});

test("email challenges are hashed, expiring, attempt-bounded, and single use", async () => {
  const clock = { value: Date.parse("2026-07-30T10:00:00.000Z") };
  let deliveredCode = "";
  const platform = managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 3),
    encryptionKey: Buffer.alloc(32, 4),
    now: () => new Date(clock.value),
    emailAdapter: {
      mode: "test",
      async deliverOneTimeCode(input) {
        deliveredCode = input.code;
        return { evidenceId: "email_evidence_1" };
      },
    },
  });
  platform.environments.ensure(SCOPE, principal());
  const sent = await platform.auth.requestEmailCode(SCOPE, "USER@example.com", principal());
  assert.equal(sent.status, "sent");
  assert.match(sent.challengeId, /^email_challenge_/);
  assert.equal(JSON.stringify(sent).includes(deliveredCode), false);
  assert.throws(() => platform.auth.verifyEmailCode(SCOPE, { challengeId: sent.challengeId, email: "user@example.com", code: "000000" }, principal()), /code/i);
  assert.equal(platform.auth.verifyEmailCode(SCOPE, { challengeId: sent.challengeId, email: "user@example.com", code: deliveredCode }, principal()).status, "verified");
  assert.throws(() => platform.auth.verifyEmailCode(SCOPE, { challengeId: sent.challengeId, email: "user@example.com", code: deliveredCode }, principal()), /used|consumed/i);

  const expiring = await platform.auth.requestEmailCode(SCOPE, "other@example.com", principal());
  clock.value += 10 * 60_000 + 1;
  assert.throws(() => platform.auth.verifyEmailCode(SCOPE, { challengeId: expiring.challengeId, email: "other@example.com", code: deliveredCode }, principal()), /expired/i);
});

test("guest creation and auth metadata require scoped permission and enforce quotas", () => {
  const platform = managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 3),
    encryptionKey: Buffer.alloc(32, 4),
    limits: { maxGuestUsersPerEnvironment: 1 },
  });
  platform.environments.ensure(SCOPE, principal());
  const reader = managed.managedPrincipal({ actorId: "reader", actorType: "user", scope: SCOPE, roles: ["viewer"], permissions: ["backend.data.read"] });
  assert.throws(() => platform.auth.createGuest(SCOPE, reader), /permission/i);
  platform.auth.createGuest(SCOPE, principal());
  assert.throws(() => platform.auth.createGuest(SCOPE, principal()), /quota/i);
  assert.throws(() => platform.auth.exportMetadata(SCOPE, reader), /permission/i);
  assert.throws(() => platform.auth.importMetadata(SCOPE, { users: [] }, reader), /permission/i);
});

test("storage enforces object count and aggregate byte quotas per environment", () => {
  const platform = managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 3),
    encryptionKey: Buffer.alloc(32, 4),
    limits: { maxObjectBytes: 8, maxObjectsPerEnvironment: 2, maxObjectBytesPerEnvironment: 10 },
  });
  platform.environments.ensure(SCOPE, principal());
  const put = (key, bytes) => platform.storage.put(SCOPE, { key, contentType: "text/plain", visibility: "private", bytes: Buffer.from(bytes) }, principal());
  put("one.txt", "12345");
  put("two.txt", "12345");
  assert.throws(() => put("three.txt", "1"), /quota/i);

  const aggregate = managed.createInMemoryManagedPlatform({
    signingKey: Buffer.alloc(32, 5),
    encryptionKey: Buffer.alloc(32, 6),
    limits: { maxObjectBytes: 8, maxObjectsPerEnvironment: 10, maxObjectBytesPerEnvironment: 9 },
  });
  aggregate.environments.ensure(SCOPE, principal());
  aggregate.storage.put(SCOPE, { key: "one.txt", contentType: "text/plain", visibility: "private", bytes: Buffer.from("12345") }, principal());
  assert.throws(() => aggregate.storage.put(SCOPE, { key: "two.txt", contentType: "text/plain", visibility: "private", bytes: Buffer.from("12345") }, principal()), /quota/i);
});

test("webhook replay cache prunes entries outside the replay window", () => {
  const clock = { value: Date.parse("2026-07-30T10:00:00.000Z") };
  const platform = platformAt(clock);
  platform.environments.ensure(SCOPE, principal());
  const secret = platform.secrets.create(SCOPE, { name: "WEBHOOK_CACHE", value: "cache-secret-value", allowedPurposes: ["webhook"] }, principal());
  const endpoint = platform.webhooks.register(SCOPE, { name: "cache", signingSecretId: secret.id, eventType: "cache.event" }, principal());
  const send = (nonce) => {
    const body = JSON.stringify({ nonce });
    const timestamp = Math.floor(clock.value / 1000);
    const signature = createHmac("sha256", "cache-secret-value").update(`${timestamp}.${nonce}.${body}`).digest("hex");
    return platform.webhooks.receive(SCOPE, endpoint.id, { body, timestamp, nonce, signature });
  };
  send("nonce-old");
  assert.equal(platform.webhooks.replayKeys.size, 1);
  clock.value += 301_000;
  send("nonce-new");
  assert.equal(platform.webhooks.replayKeys.size, 1);
});

test("realtime publish requires scoped write permission and polling hides cross-scope subscriptions", () => {
  const platform = platformAt({ value: Date.parse("2026-07-30T10:00:00.000Z") });
  platform.environments.ensure(SCOPE, principal());
  const reader = managed.managedPrincipal({ actorId: "reader", actorType: "user", scope: SCOPE, roles: ["viewer"], permissions: ["backend.realtime.read"] });
  const subscription = platform.realtime.subscribe(SCOPE, { collection: "signals" }, reader);
  assert.throws(() => platform.realtime.publish(SCOPE, "signals", "created", { id: "denied" }, reader), /permission/i);
  platform.realtime.publish(SCOPE, "signals", "created", { id: "allowed" }, principal());
  assert.equal(platform.realtime.poll(SCOPE, subscription, reader).events.length, 1);
  assert.throws(() => platform.realtime.poll(OTHER_ENV, subscription, principal(OTHER_ENV)), /does not exist|scope/i);
});

test("cron follows Vixie day-of-month/day-of-week semantics and validates disabled schedules", () => {
  assert.equal(
    managed.nextCronOccurrence("0 0 1 * 1", "UTC", new Date("2026-08-01T00:01:00.000Z")),
    "2026-08-03T00:00:00.000Z",
  );
  const platform = platformAt({ value: Date.parse("2026-07-30T10:00:00.000Z") });
  assert.throws(() => platform.cron.create(SCOPE, { name: "disabled", expression: "invalid", timezone: "UTC", jobType: "noop", enabled: false, overlapPolicy: "skip" }, principal()), /cron/i);
  assert.throws(() => platform.cron.create(SCOPE, { name: "disabled", expression: "0 0 * * *", timezone: "Mars/Olympus", jobType: "noop", enabled: false, overlapPolicy: "skip" }, principal()), /timezone/i);
});
