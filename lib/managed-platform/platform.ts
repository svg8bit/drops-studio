import type { FunctionRuntimeAdapter, ManagedEmailAdapter, ManagedPlatformLimits, ManagedPrincipal, ManagedScope } from "./contracts.ts";
import { ManagedAuthService } from "./auth.ts";
import { ManagedBackupService } from "./backups.ts";
import { InMemoryManagedData } from "./data.ts";
import { ManagedLogStore } from "./logs.ts";
import {
  ManagedCronService,
  ManagedFunctionService,
  ManagedJobService,
  ManagedRealtimeService,
  ManagedWebhookService,
  SetupRequiredFunctionRuntime,
} from "./runtime-services.ts";
import { ManagedPlatformError, assertScope, requirePermission } from "./security.ts";
import { ManagedSecretVault } from "./secrets.ts";
import { ManagedObjectStorage } from "./storage.ts";

const DEFAULT_LIMITS: ManagedPlatformLimits = {
  maxRowsPerEnvironment: 10_000,
  maxQueryComplexity: 12,
  maxObjectBytes: 10 * 1024 * 1024,
  maxObjectsPerEnvironment: 1_000,
  maxObjectBytesPerEnvironment: 512 * 1024 * 1024,
  maxGuestUsersPerEnvironment: 1_000,
  maxRealtimeEvents: 2_000,
  maxRealtimeSubscriptions: 100,
  maxJobsPerEnvironment: 1_000,
};

export interface InMemoryManagedPlatformOptions {
  signingKey: Uint8Array;
  encryptionKey: Uint8Array;
  now?: () => Date;
  limits?: Partial<ManagedPlatformLimits>;
  emailAdapter?: ManagedEmailAdapter;
  functionRuntime?: FunctionRuntimeAdapter;
  objectScanner?: (bytes: Uint8Array) => "clean" | "rejected";
}

export function createInMemoryManagedPlatform(options: InMemoryManagedPlatformOptions) {
  if (options.signingKey.byteLength < 32) throw new ManagedPlatformError("SIGNING_KEY_INVALID", "Managed capability signing key must be at least 32 bytes.");
  const now = options.now ?? (() => new Date());
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const logs = new ManagedLogStore(now);
  const dataCore = new InMemoryManagedData({ now, limits });
  const secrets = new ManagedSecretVault({ key: options.encryptionKey, now, logs });
  const storage = new ManagedObjectStorage({ signingKey: options.signingKey, now, limits, logs, scan: options.objectScanner });
  const auth = new ManagedAuthService({ now, logs, limits, emailAdapter: options.emailAdapter });
  const functions = new ManagedFunctionService({ runtime: options.functionRuntime ?? new SetupRequiredFunctionRuntime(), now, logs });
  const webhooks = new ManagedWebhookService({ now, logs, secrets });
  const jobs = new ManagedJobService({ now, logs, limits });
  const cron = new ManagedCronService({ now, logs });
  const realtime = new ManagedRealtimeService({ now, logs, limits });
  const backups = new ManagedBackupService({ now, data: dataCore, auth, storage, functions, webhooks, jobs, secrets, logs });

  const environments = {
    ensure(scope: ManagedScope, principal: ManagedPrincipal) {
      return dataCore.ensureEnvironment(scope, principal);
    },
    status(scope: ManagedScope, principal: ManagedPrincipal) {
      assertScope(scope, principal);
      requirePermission(principal, "backend.data.read");
      return { environment: scope.environment, status: dataCore.hasEnvironment(scope) ? "working" as const : "setup-required" as const };
    },
  };

  const schema = {
    snapshot: dataCore.snapshot.bind(dataCore),
    plan: dataCore.plan.bind(dataCore),
    apply(scope: ManagedScope, plan: Parameters<InMemoryManagedData["apply"]>[1], principal: ManagedPrincipal, applyOptions: { approvalReceipt?: string; backupId?: string } = {}) {
      if (scope.environment === "production" && plan.destructive) {
        if (!applyOptions.backupId || !backups.verifyForScope(applyOptions.backupId, scope)) {
          throw new ManagedPlatformError("MIGRATION_BACKUP_REQUIRED", "A verified production backup is required before destructive migration.");
        }
      }
      return dataCore.apply(scope, plan, principal, applyOptions);
    },
  };

  const data = {
    create: dataCore.create.bind(dataCore),
    read: dataCore.read.bind(dataCore),
    query: dataCore.query.bind(dataCore),
    update: dataCore.update.bind(dataCore),
    delete: dataCore.delete.bind(dataCore),
  };

  const secretControls = Object.freeze({
    mode: secrets.mode,
    create: secrets.create.bind(secrets),
    list: secrets.list.bind(secrets),
    rotate: secrets.rotate.bind(secrets),
    revoke: secrets.revoke.bind(secrets),
  });

  return Object.freeze({
    mode: "in-memory-test" as const,
    environments,
    schema,
    data,
    auth,
    storage,
    functions,
    webhooks,
    jobs,
    cron,
    realtime,
    secrets: secretControls,
    logs: { list: logs.list.bind(logs) },
    backups,
    capabilities: Object.freeze({
      data: "working-test-adapter",
      auth: options.emailAdapter ? "working-configured-email" : "setup-required-email",
      storage: "working-test-adapter",
      functions: options.functionRuntime?.mode ?? "setup-required",
      webhooks: "working-signed-inbox",
      jobs: "working-test-adapter",
      cron: "working-test-adapter",
      realtime: "in-memory-test-not-live-cursors",
      secrets: "encrypted-in-memory-test",
      backups: "metadata-and-data-working-object-bytes-excluded",
    }),
  });
}
