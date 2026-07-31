import type {
  ManagedScope,
  ManagedTransaction,
  PostgresManagedPlatformDriver,
} from "./contracts.ts";
import { ManagedPlatformError } from "./security.ts";

function connectionString(environment: NodeJS.ProcessEnv): string {
  const value = environment.DROPS_MANAGED_DATABASE_URL?.trim()
    || environment.DROPS_MANAGED_POSTGRES_URL?.trim();
  if (!value) {
    throw new ManagedPlatformError(
      "DATABASE_URL_REQUIRED",
      "The managed Postgres provider is not configured.",
    );
  }
  return value;
}

export function postgresManagedProviderConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.DROPS_MANAGED_DATA_PROVIDER === "postgres"
    && Boolean(
      environment.DROPS_MANAGED_DATABASE_URL?.trim()
        || environment.DROPS_MANAGED_POSTGRES_URL?.trim(),
    );
}

export function createNeonManagedPlatformDriver(
  environment: NodeJS.ProcessEnv = process.env,
): PostgresManagedPlatformDriver {
  const url = connectionString(environment);
  return {
    kind: "postgres-drizzle",
    async transaction<T>(
      _scope: ManagedScope,
      operation: (transaction: ManagedTransaction) => Promise<T>,
    ): Promise<T> {
      const { Pool } = await import("@neondatabase/serverless");
      const pool = new Pool({ connectionString: url });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation({
          async execute(statement, parameters) {
            const response = await client.query(statement, [...parameters]);
            return {
              rows: response.rows as unknown[],
              affectedRows: response.rowCount ?? 0,
            };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
        await pool.end();
      }
    },
    async health() {
      const startedAt = performance.now();
      const { neon } = await import("@neondatabase/serverless");
      const sql = neon(url);
      const rows = await sql`SELECT 1 AS ok`;
      if (rows[0]?.ok !== 1) {
        throw new ManagedPlatformError(
          "POSTGRES_HEALTH_FAILED",
          "The managed Postgres health query returned an invalid result.",
        );
      }
      return {
        status: "working",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    },
  };
}
