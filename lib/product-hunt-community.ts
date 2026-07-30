import type { NextRequest, NextResponse } from "next/server.js";
import { z } from "zod";

export const PRODUCT_HUNT_CATEGORIES = [
  "analytics",
  "ai",
  "alerts",
  "community",
  "data",
  "games",
  "media",
  "research",
  "trading-tools",
  "other",
] as const;

export type ProductHuntCategory = (typeof PRODUCT_HUNT_CATEGORIES)[number];
export type ProductHuntSort = "top" | "new";
export type ProductHuntSourceEvidence =
  | "verified-drops-studio-publish"
  | "community-url-unverified";
export type ProductHuntStorageEvidence =
  | "cloudflare-d1"
  | "vercel-blob"
  | "local-memory";

export interface ProductHuntSubmission {
  name: string;
  tagline: string;
  description: string;
  url: string;
  category: ProductHuntCategory;
  makerName: string | null;
  dropsStudioSlug: string | null;
}

export interface ProductHuntLaunch {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  category: ProductHuntCategory;
  makerName: string | null;
  dropsStudioSlug: string | null;
  createdAt: string;
  votes: number;
  viewerHasVoted: boolean;
  evidence: {
    listing: "community-submitted";
    destination: ProductHuntSourceEvidence;
    votes: "browser-session-deduplicated";
    moderation: "unreviewed";
  };
}

export interface StoredProductHuntLaunch extends Omit<ProductHuntLaunch, "votes" | "viewerHasVoted"> {
  urlKey: string;
  submitterHash: string;
  voteCount: number;
}

const normalizedString = z.string().transform((value) => value.normalize("NFKC").trim());

const plainText = (label: string, minimum: number, maximum: number) => normalizedString.pipe(
  z.string()
    .min(minimum, `${label} is too short.`)
    .max(maximum, `${label} is too long.`)
    .refine((value) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), {
      message: `${label} must be plain text without markup or control characters.`,
    }),
);

const submissionSchema = z.object({
  name: plainText("Name", 2, 60),
  tagline: plainText("Tagline", 8, 120),
  description: plainText("Description", 24, 1_200),
  url: normalizedString.pipe(
    z.string().min(1, "A public product URL is required.").max(2_048, "The product URL is too long."),
  ),
  category: z.enum(PRODUCT_HUNT_CATEGORIES),
  makerName: plainText("Maker name", 2, 60).optional().nullable(),
  dropsStudioSlug: normalizedString.pipe(
    z.string().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid Drops Studio project slug."),
  ).optional().nullable(),
}).strict();

export class ProductHuntValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = "ProductHuntValidationError";
    this.fieldErrors = fieldErrors;
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return value === "::"
    || value === "::1"
    || value.startsWith("fc")
    || value.startsWith("fd")
    || /^fe[89ab]/.test(value)
    || value.startsWith("::ffff:127.")
    || value.startsWith("::ffff:10.")
    || value.startsWith("::ffff:192.168.");
}

export function normalizeProductUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.normalize("NFKC").trim());
  } catch {
    throw new ProductHuntValidationError("Enter a valid public http or https URL.", { url: ["Enter a valid public http or https URL."] });
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new ProductHuntValidationError("Enter a public http or https URL without embedded credentials.", {
      url: ["Enter a public http or https URL without embedded credentials."],
    });
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || isPrivateIpv4(hostname)
    || (hostname.includes(":") && isPrivateIpv6(hostname))) {
    throw new ProductHuntValidationError("The launch URL must be publicly reachable.", {
      url: ["The launch URL must be publicly reachable."],
    });
  }
  url.hash = "";
  url.hostname = hostname;
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function parseProductHuntSubmission(value: unknown): ProductHuntSubmission {
  const result = submissionSchema.safeParse(value);
  if (!result.success) {
    const flattened = z.flattenError(result.error);
    throw new ProductHuntValidationError("Check the highlighted launch fields.", flattened.fieldErrors);
  }
  return {
    ...result.data,
    url: normalizeProductUrl(result.data.url),
    makerName: result.data.makerName || null,
    dropsStudioSlug: result.data.dropsStudioSlug || null,
  };
}

export function productUrlKey(value: string): string {
  const url = new URL(normalizeProductUrl(value));
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

export function productHuntSlug(name: string, id: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "crypto-product";
  return `${base}-${id.replace(/-/g, "").slice(0, 7)}`;
}

export const PRODUCT_HUNT_SESSION_COOKIE = "drops-product-hunt-session";
const SESSION_PATTERN = /^[a-f0-9-]{16,64}$/i;

export interface ProductHuntSession {
  id: string;
  isNew: boolean;
  source: "cookie" | "issued";
}

export function resolveProductHuntSession(request: NextRequest): ProductHuntSession {
  const cookie = request.cookies.get(PRODUCT_HUNT_SESSION_COOKIE)?.value?.trim() ?? "";
  if (SESSION_PATTERN.test(cookie)) return { id: cookie, isNew: false, source: "cookie" };
  return { id: crypto.randomUUID(), isNew: true, source: "issued" };
}

export function setProductHuntSessionCookie(response: NextResponse, session: ProductHuntSession): void {
  if (!session.isNew) return;
  response.cookies.set(PRODUCT_HUNT_SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

export function withProductHuntSession(
  response: NextResponse,
  session: ProductHuntSession,
): NextResponse {
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("vary", "cookie");
  setProductHuntSessionCookie(response, session);
  return response;
}

export async function hashProductHuntSession(sessionId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`drops-studio-product-hunt-v1:${sessionId}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isSameOriginMutation(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && !["same-origin", "same-site"].includes(fetchSite)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function productHuntActorEvidence() {
  return {
    authenticated: false as const,
    scope: "browser-session" as const,
    claim: "A browser-session receipt is not proof of a unique person or verified identity." as const,
  };
}

export function publicProductHuntLaunch(
  stored: StoredProductHuntLaunch,
  viewerHasVoted: boolean,
): ProductHuntLaunch {
  return {
    id: stored.id,
    slug: stored.slug,
    name: stored.name,
    tagline: stored.tagline,
    description: stored.description,
    url: stored.url,
    category: stored.category,
    makerName: stored.makerName,
    dropsStudioSlug: stored.dropsStudioSlug,
    createdAt: stored.createdAt,
    evidence: stored.evidence,
    votes: Math.max(0, stored.voteCount),
    viewerHasVoted,
  };
}
