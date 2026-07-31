import { createHash, randomBytes } from "node:crypto";

import {
  OidcProviderError,
  type OidcAuthorizationCodeRecord,
  type OidcAuthorizationCodeStore,
} from "./oidc-provider.ts";

type BlobStorage = Pick<typeof import("@vercel/blob"), "del" | "get" | "put">;

interface StoredAuthorizationCode {
  record: OidcAuthorizationCodeRecord;
  etag: string;
}

function storageConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    environment.BLOB_READ_WRITE_TOKEN
      || (environment.BLOB_STORE_ID && (environment.VERCEL_OIDC_TOKEN || environment.VERCEL)),
  );
}

function codePathname(code: string): string {
  const digest = createHash("sha256").update(code, "ascii").digest("hex");
  return `drops-studio/enterprise/oidc/codes/${digest}.json`;
}

function validRecord(value: unknown): OidcAuthorizationCodeRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<OidcAuthorizationCodeRecord>;
  if (
    record.version !== 1
    || typeof record.clientId !== "string"
    || record.clientId.length < 8
    || record.clientId.length > 128
    || typeof record.redirectUri !== "string"
    || record.redirectUri.length > 512
    || typeof record.subject !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(record.subject)
    || typeof record.scope !== "string"
    || record.scope.length > 160
    || typeof record.nonce !== "string"
    || record.nonce.length < 16
    || record.nonce.length > 256
    || typeof record.codeChallenge !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(record.codeChallenge)
    || !Number.isSafeInteger(record.authTime)
    || Number(record.authTime) <= 0
    || !Number.isSafeInteger(record.issuedAt)
    || Number(record.issuedAt) <= 0
    || !Number.isSafeInteger(record.expiresAt)
    || Number(record.expiresAt) <= Number(record.issuedAt)
    || (record.consumedAt !== null && (!Number.isSafeInteger(record.consumedAt) || Number(record.consumedAt) <= 0))
  ) return null;
  return record as OidcAuthorizationCodeRecord;
}

async function readCode(
  storage: BlobStorage,
  pathname: string,
): Promise<StoredAuthorizationCode | null> {
  const current = await storage.get(pathname, { access: "private", useCache: false });
  if (!current) return null;
  if (current.statusCode !== 200 || current.blob.size > 8_192 || !current.blob.etag) {
    throw new Error("OIDC authorization-code record is invalid.");
  }
  const raw = await new Response(current.stream).text();
  if (Buffer.byteLength(raw, "utf8") > 8_192) throw new Error("OIDC authorization-code record is invalid.");
  const record = validRecord(JSON.parse(raw) as unknown);
  if (!record) throw new Error("OIDC authorization-code record is invalid.");
  return { record, etag: current.blob.etag };
}

export class BlobOidcAuthorizationCodeStore implements OidcAuthorizationCodeStore {
  readonly #storage: BlobStorage;

  constructor(storage: BlobStorage) {
    this.#storage = storage;
  }

  async issue(code: string, record: OidcAuthorizationCodeRecord): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !validRecord(record)) {
      throw new OidcProviderError("temporarily_unavailable", "OIDC authorization code could not be issued.", 503);
    }
    try {
      await this.#storage.put(codePathname(code), JSON.stringify(record), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
    } catch {
      throw new OidcProviderError("temporarily_unavailable", "OIDC authorization-code storage is unavailable.", 503);
    }
  }

  async consume(code: string, nowSeconds: number): Promise<OidcAuthorizationCodeRecord | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) return null;
    try {
      const pathname = codePathname(code);
      const current = await readCode(this.#storage, pathname);
      if (!current || current.record.consumedAt !== null) return null;
      if (current.record.expiresAt < nowSeconds) {
        await this.#storage.del(pathname, { ifMatch: current.etag }).catch(() => undefined);
        return null;
      }
      const consumed = { ...current.record, consumedAt: nowSeconds } satisfies OidcAuthorizationCodeRecord;
      let consumedEtag = "";
      try {
        const result = await this.#storage.put(pathname, JSON.stringify(consumed), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          contentType: "application/json; charset=utf-8",
          ifMatch: current.etag,
        });
        consumedEtag = result.etag;
      } catch {
        // An ETag race means another instance redeemed the same code first.
        // Confirm that durable state before classifying the request as replay.
        const latest = await readCode(this.#storage, pathname);
        if (latest?.record.consumedAt !== null) return null;
        throw new Error("OIDC authorization-code CAS failed.");
      }
      await this.#storage.del(pathname, { ifMatch: consumedEtag }).catch(() => undefined);
      return current.record;
    } catch (error) {
      if (error instanceof OidcProviderError) throw error;
      throw new OidcProviderError("temporarily_unavailable", "OIDC authorization-code storage is unavailable.", 503);
    }
  }

  async health(): Promise<boolean> {
    const pathname = "drops-studio/enterprise/oidc/provider-health.json";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const nonceHash = createHash("sha256").update(randomBytes(32)).digest("hex");
        const current = await this.#storage.get(pathname, { access: "private", useCache: false });
        const body = JSON.stringify({ version: 1, checkedAt: Date.now(), nonceHash });
        if (!current) {
          await this.#storage.put(pathname, body, {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
            contentType: "application/json; charset=utf-8",
          });
        } else {
          if (current.statusCode !== 200 || !current.blob.etag) return false;
          await this.#storage.put(pathname, body, {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60,
            contentType: "application/json; charset=utf-8",
            ifMatch: current.blob.etag,
          });
        }
        const verified = await this.#storage.get(pathname, { access: "private", useCache: false });
        if (!verified || verified.statusCode !== 200 || verified.blob.size > 2_048) return false;
        const parsed = JSON.parse(await new Response(verified.stream).text()) as { nonceHash?: unknown };
        if (parsed.nonceHash === nonceHash) return true;
      } catch {
        // A concurrent health probe can win the ETag race; retry with a fresh read.
      }
    }
    return false;
  }
}

export async function durableOidcAuthorizationCodeStore(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<BlobOidcAuthorizationCodeStore> {
  if (!storageConfigured(environment)) {
    throw new OidcProviderError("temporarily_unavailable", "Private OIDC authorization-code storage is not configured.", 503);
  }
  const storage = await import("@vercel/blob").catch(() => null);
  if (!storage) {
    throw new OidcProviderError("temporarily_unavailable", "Private OIDC authorization-code storage is unavailable.", 503);
  }
  return new BlobOidcAuthorizationCodeStore(storage);
}
