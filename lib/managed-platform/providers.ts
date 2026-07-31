import type { D1ManagedPlatformDriver, ManagedProviderStatus, PostgresManagedPlatformDriver } from "./contracts.ts";
import { ManagedPlatformError } from "./security.ts";

interface ProviderHealthOptions { timeoutMs?: number }

async function boundedHealth<T>(health: () => Promise<T>, options: ProviderHealthOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new ManagedPlatformError("PROVIDER_HEALTH_TIMEOUT_INVALID", "Provider health timeout is invalid.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      health(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ManagedPlatformError("PROVIDER_HEALTH_TIMEOUT", "Managed provider health check timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function describeD1ManagedProvider(driver?: D1ManagedPlatformDriver): ManagedProviderStatus {
  if (!driver) return { kind: "d1-drizzle", status: "setup-required", reasonCode: "D1_BINDING_REQUIRED" };
  return { kind: "d1-drizzle", status: "unavailable", reasonCode: "HEALTH_CHECK_REQUIRED" };
}

export function describePostgresManagedProvider(driver?: PostgresManagedPlatformDriver): ManagedProviderStatus {
  if (!driver) return { kind: "postgres-drizzle", status: "setup-required", reasonCode: "DATABASE_URL_AND_DRIVER_REQUIRED" };
  return { kind: "postgres-drizzle", status: "unavailable", reasonCode: "HEALTH_CHECK_REQUIRED" };
}

export async function verifyD1ManagedProvider(driver: D1ManagedPlatformDriver, options: ProviderHealthOptions = {}): Promise<ManagedProviderStatus & { latencyMs: number }> {
  try {
    const health = await boundedHealth(() => driver.health(), options);
    return { kind: "d1-drizzle", status: health.status === "working" ? "working" : "unavailable", reasonCode: health.status === "degraded" ? "D1_DEGRADED" : undefined, latencyMs: health.latencyMs };
  } catch (error) {
    return { kind: "d1-drizzle", status: "unavailable", reasonCode: error instanceof ManagedPlatformError && error.code === "PROVIDER_HEALTH_TIMEOUT" ? "D1_HEALTH_TIMEOUT" : "D1_HEALTH_FAILED", latencyMs: 0 };
  }
}

export async function verifyPostgresManagedProvider(driver: PostgresManagedPlatformDriver, options: ProviderHealthOptions = {}): Promise<ManagedProviderStatus & { latencyMs: number }> {
  try {
    const health = await boundedHealth(() => driver.health(), options);
    return { kind: "postgres-drizzle", status: health.status === "working" ? "working" : "unavailable", reasonCode: health.status === "degraded" ? "POSTGRES_DEGRADED" : undefined, latencyMs: health.latencyMs };
  } catch (error) {
    return { kind: "postgres-drizzle", status: "unavailable", reasonCode: error instanceof ManagedPlatformError && error.code === "PROVIDER_HEALTH_TIMEOUT" ? "POSTGRES_HEALTH_TIMEOUT" : "POSTGRES_HEALTH_FAILED", latencyMs: 0 };
  }
}
