import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CAPABILITY_VERSION = "dsp1";
const MINIMUM_SECRET_BYTES = 32;
const NONCE_BYTES = 24;

type PublishCapabilityEnv = Partial<
  Record<"NODE_ENV" | "DROPS_PUBLISH_CAPABILITY_SECRET", string | undefined>
>;

export class PublishCapabilityConfigurationError extends Error {
  constructor() {
    super("Publish capability signing is not configured.");
    this.name = "PublishCapabilityConfigurationError";
  }
}

export function resolvePublishCapabilitySecret(
  env: PublishCapabilityEnv = process.env,
): string {
  const configured = env.DROPS_PUBLISH_CAPABILITY_SECRET?.trim() ?? "";
  if (configured) {
    return Buffer.byteLength(configured, "utf8") >= MINIMUM_SECRET_BYTES
      ? configured
      : "";
  }
  return env.NODE_ENV === "production"
    ? ""
    : "drops-studio-development-only-publish-capability-secret";
}

function assertSlug(slug: string): void {
  if (!/^[a-z0-9-]{4,72}$/.test(slug)) {
    throw new Error("Invalid published project slug.");
  }
}

function signature(slug: string, nonce: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`drops-studio:publish-capability:v1:${slug}:${nonce}`)
    .digest("base64url");
}

export function createPublishCapability(
  slug: string,
  secret = resolvePublishCapabilitySecret(),
): string {
  assertSlug(slug);
  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new PublishCapabilityConfigurationError();
  }
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  return `${CAPABILITY_VERSION}.${nonce}.${signature(slug, nonce, secret)}`;
}

export function verifyPublishCapability(
  slug: string,
  capability: string,
  secret = resolvePublishCapabilitySecret(),
): boolean {
  if (
    !/^[a-z0-9-]{4,72}$/.test(slug) ||
    Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES
  ) {
    return false;
  }
  const match = capability.match(
    /^dsp1\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/,
  );
  if (!match) return false;
  const provided = Buffer.from(match[2], "base64url");
  const expected = Buffer.from(signature(slug, match[1], secret), "base64url");
  return (
    provided.toString("base64url") === match[2] &&
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export function requestPublishCapability(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}
