import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const STUDIO_CONNECTION_PROVIDERS = [
  "dropstab",
  "dropsbot",
  "openai",
  "anthropic",
  "openrouter",
  "kimi",
  "custom",
  "telegram",
] as const;

export type StudioConnectionProvider = (typeof STUDIO_CONNECTION_PROVIDERS)[number];

export interface StudioAccountProfile {
  provider: "google" | "openrouter";
  subject: string;
  name: string;
  email?: string;
  picture?: string;
  updatedAt: string;
}

export interface StudioConnectionStatus {
  provider: StudioConnectionProvider;
  connected: boolean;
  model?: string;
  endpointHost?: string;
  label?: string;
  updatedAt?: string;
}

export interface EncryptedStudioConnection {
  provider: StudioConnectionProvider;
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
  model?: string;
  endpointHost?: string;
  label?: string;
  updatedAt: string;
}

export interface StudioAccountState {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  profile?: StudioAccountProfile;
  connections: Partial<Record<StudioConnectionProvider, EncryptedStudioConnection>>;
}

const MINIMUM_VAULT_KEY_BYTES = 32;
const MAXIMUM_CREDENTIAL_BYTES = 32 * 1_024;

export function isStudioConnectionProvider(value: unknown): value is StudioConnectionProvider {
  return typeof value === "string"
    && (STUDIO_CONNECTION_PROVIDERS as readonly string[]).includes(value);
}

export function resolveConnectionVaultKey(
  environment: Partial<Record<"DROPS_CONNECTION_VAULT_KEY" | "NODE_ENV", string | undefined>> = process.env,
): Buffer | null {
  const configured = environment.DROPS_CONNECTION_VAULT_KEY?.trim() ?? "";
  if (!configured || Buffer.byteLength(configured, "utf8") < MINIMUM_VAULT_KEY_BYTES) {
    return null;
  }
  return createHash("sha256").update(configured, "utf8").digest();
}

export function connectionVaultConfigured(): boolean {
  return Boolean(resolveConnectionVaultKey());
}

function connectionAad(identity: string, provider: StudioConnectionProvider): Buffer {
  return Buffer.from(`drops-studio-connection:v1:${identity}:${provider}`, "utf8");
}

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n\0]/.test(normalized)) return undefined;
  return normalized;
}

export function endpointHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.host.toLowerCase();
  } catch {
    return undefined;
  }
}

export function encryptStudioConnection(input: {
  identity: string;
  provider: StudioConnectionProvider;
  credential: string;
  model?: string;
  endpoint?: string;
  label?: string;
  now?: string;
  key?: Buffer | null;
}): EncryptedStudioConnection {
  if (!/^[a-f0-9]{64}$/.test(input.identity)) throw new Error("Invalid Studio account identity.");
  const credential = input.credential.trim();
  const credentialBytes = Buffer.byteLength(credential, "utf8");
  if (!credential || credentialBytes > MAXIMUM_CREDENTIAL_BYTES || /\0/.test(credential)) {
    throw new Error("Connection credential is invalid or too large.");
  }
  const key = input.key ?? resolveConnectionVaultKey();
  if (!key) throw new Error("Connection vault encryption is not configured.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(connectionAad(input.identity, input.provider));
  const ciphertext = Buffer.concat([
    cipher.update(credential, "utf8"),
    cipher.final(),
  ]);
  return {
    provider: input.provider,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ...(optionalText(input.model, 240) ? { model: optionalText(input.model, 240) } : {}),
    ...(endpointHost(input.endpoint) ? { endpointHost: endpointHost(input.endpoint) } : {}),
    ...(optionalText(input.label, 160) ? { label: optionalText(input.label, 160) } : {}),
    updatedAt: input.now ?? new Date().toISOString(),
  };
}

export function decryptStudioConnection(input: {
  identity: string;
  connection: EncryptedStudioConnection;
  key?: Buffer | null;
}): string {
  if (!/^[a-f0-9]{64}$/.test(input.identity)) throw new Error("Invalid Studio account identity.");
  const key = input.key ?? resolveConnectionVaultKey();
  if (!key) throw new Error("Connection vault encryption is not configured.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(input.connection.iv, "base64url"),
  );
  decipher.setAAD(connectionAad(input.identity, input.connection.provider));
  decipher.setAuthTag(Buffer.from(input.connection.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.connection.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function publicConnectionStatuses(
  state: StudioAccountState,
): StudioConnectionStatus[] {
  return STUDIO_CONNECTION_PROVIDERS.map((provider) => {
    const connection = state.connections[provider];
    return {
      provider,
      connected: Boolean(connection),
      ...(connection?.model ? { model: connection.model } : {}),
      ...(connection?.endpointHost ? { endpointHost: connection.endpointHost } : {}),
      ...(connection?.label ? { label: connection.label } : {}),
      ...(connection?.updatedAt ? { updatedAt: connection.updatedAt } : {}),
    };
  });
}
