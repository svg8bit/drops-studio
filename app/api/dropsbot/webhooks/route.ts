import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server.js";

import {
  createDropsBotWebhookConnection,
  dropsBotWebhookStorageConfigured,
  DropsBotWebhookCapacityError,
  DropsBotWebhookStorageUnavailableError,
  revokeDropsBotWebhookConnection,
  rotateDropsBotWebhookConnection,
} from "../../../../db/dropsbot-webhooks.ts";
import {
  listMemberProjects,
  MemberProjectStorageUnavailableError,
} from "../../../../db/member-projects.ts";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
  type StudioAccount,
} from "../../../../lib/access-tier.ts";
import {
  createDropsBotWebhookCapability,
  DROPSBOT_WEBHOOK_CREATE_BODY_LIMIT_BYTES,
  DropsBotWebhookValidationError,
  readDropsBotWebhookBody,
} from "../../../../lib/dropsbot-webhook.ts";
import { hasJsonMediaType } from "../../../../lib/http-request-boundary.ts";
import { consumeRequestLimit } from "../../../../lib/request-rate-limit.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  vary: "Cookie",
};

class DropsBotWebhookResponseError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? "Drops Bot webhook request failed."));
    this.name = "DropsBotWebhookResponseError";
    this.status = status;
    this.payload = payload;
  }
}

function json(payload: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function account(request: NextRequest): StudioAccount {
  const resolved = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  if (!resolved) {
    throw new DropsBotWebhookResponseError(401, {
      code: "DROPSBOT_ACCOUNT_REQUIRED",
      error: "Connect a signed Studio account before creating a Drops Bot callback.",
    });
  }
  return resolved;
}

function requireSameOrigin(request: NextRequest): void {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new DropsBotWebhookResponseError(403, {
      error: "Cross-origin Drops Bot callback mutation rejected.",
    });
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new DropsBotWebhookResponseError(403, {
      error: "A same-origin Drops Bot callback mutation is required.",
    });
  }
  try {
    const originUrl = new URL(origin);
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim()
      .replace(/:$/, "") || request.nextUrl.protocol.replace(/:$/, "");
    const browserVisibleOrigin = host ? `${protocol}://${host}` : null;
    if (
      originUrl.origin !== request.nextUrl.origin
      && originUrl.origin !== browserVisibleOrigin
    ) {
      throw new Error();
    }
  } catch {
    throw new DropsBotWebhookResponseError(403, {
      error: "Cross-origin Drops Bot callback mutation rejected.",
    });
  }
}

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  if (!hasJsonMediaType(request)) {
    throw new DropsBotWebhookResponseError(415, {
      error: "Drops Bot callback mutations require application/json.",
    });
  }
  const raw = await readDropsBotWebhookBody(
    request,
    DROPSBOT_WEBHOOK_CREATE_BODY_LIMIT_BYTES,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown;
  } catch {
    throw new DropsBotWebhookResponseError(400, {
      error: "Drops Bot callback mutations require a valid JSON body.",
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DropsBotWebhookResponseError(400, {
      error: "Drops Bot callback mutations require a JSON object.",
    });
  }
  const input = parsed as Record<string, unknown>;
  const unsupported = Object.keys(input).filter((key) => !["projectId", "consent"].includes(key));
  if (unsupported.length) {
    throw new DropsBotWebhookResponseError(400, {
      error: `Drops Bot callback mutation contains unsupported fields: ${unsupported.join(", ")}.`,
    });
  }
  return input;
}

function projectId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value)) {
    throw new DropsBotWebhookResponseError(400, {
      error: "Drops Bot callback project id is invalid.",
    });
  }
  return value;
}

function requireConsent(input: Record<string, unknown>, action: string): void {
  if (input.consent !== true) {
    throw new DropsBotWebhookResponseError(400, {
      code: "DROPSBOT_CONSENT_REQUIRED",
      error: `Explicit consent is required before ${action} a secret callback URL.`,
    });
  }
}

async function enforceMutationLimit(identity: string): Promise<void> {
  const status = await consumeRequestLimit({
    identity,
    namespace: "dropsbot-webhook-mutation",
    max: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL
      ? 1_000
      : 20,
    windowMs: 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (status === "limited") {
    throw new DropsBotWebhookResponseError(429, {
      code: "DROPSBOT_WEBHOOK_RATE_LIMITED",
      error: "Drops Bot callback mutation limit reached. Retry after the current window.",
    });
  }
  if (status === "unavailable" && process.env.NODE_ENV === "production") {
    throw new DropsBotWebhookResponseError(503, {
      code: "DROPSBOT_WEBHOOK_RATE_LIMIT_UNAVAILABLE",
      error: "Drops Bot callback request protection is temporarily unavailable.",
    });
  }
}

async function requireOwnedProject(
  member: StudioAccount,
  input: Record<string, unknown>,
): Promise<string> {
  const ownedProjectId = projectId(input.projectId);
  const projects = await listMemberProjects(member.identity);
  if (!projects.some((project) => project.id === ownedProjectId)) {
    throw new DropsBotWebhookResponseError(404, {
      error: "Signed project not found.",
    });
  }
  return ownedProjectId;
}

function callbackUrl(
  request: NextRequest,
  connectionId: string,
  capability: string,
): string {
  return new URL(
    `/api/dropsbot/webhooks/${connectionId}/${capability}`,
    request.nextUrl.origin,
  ).toString();
}

function registration(note: string) {
  return {
    mode: "manual-in-@drops",
    officialSurface: "https://t.me/Drops",
    claimedConfigured: false,
    note,
  } as const;
}

function responseError(error: unknown): NextResponse {
  if (error instanceof DropsBotWebhookResponseError) {
    return json(error.payload, error.status);
  }
  if (error instanceof DropsBotWebhookValidationError) {
    return json({ code: error.code, error: error.message }, error.status);
  }
  if (error instanceof DropsBotWebhookCapacityError) {
    return NextResponse.json({
      code: "DROPSBOT_CALLBACK_CAPACITY_REACHED",
      error: error.message,
    }, {
      status: 507,
      headers: { ...NO_STORE_HEADERS, "retry-after": "3600" },
    });
  }
  if (
    error instanceof DropsBotWebhookStorageUnavailableError
    || error instanceof MemberProjectStorageUnavailableError
  ) {
    return json({
      error: "Drops Bot callback storage is temporarily unavailable.",
    }, 503);
  }
  console.error("Unexpected Drops Bot callback creation failure.", error);
  return json({
    error: "Drops Bot callback creation is temporarily unavailable.",
  }, 503);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const member = account(request);
    requireSameOrigin(request);
    await enforceMutationLimit(member.identity);
    if (!dropsBotWebhookStorageConfigured()) {
      throw new DropsBotWebhookStorageUnavailableError();
    }
    const input = await body(request);
    requireConsent(input, "creating");
    const ownedProjectId = await requireOwnedProject(member, input);

    const createdAt = new Date().toISOString();
    const capability = createDropsBotWebhookCapability();
    const connectionId = randomUUID();
    const result = await createDropsBotWebhookConnection({
      id: connectionId,
      ownerIdentity: member.identity,
      projectId: ownedProjectId,
      capabilityHash: capability.hash,
      createdAt,
      consentedAt: createdAt,
    });
    if (result.status === "exists") {
      throw new DropsBotWebhookResponseError(409, {
        code: "DROPSBOT_CALLBACK_EXISTS",
        error: "This project already has a Drops Bot callback. Its secret URL is never re-disclosed.",
      });
    }

    return json({
      connectionId,
      projectId: ownedProjectId,
      callbackUrl: callbackUrl(request, connectionId, capability.secret),
      createdAt,
      registration: registration("Add this callback URL through the official @drops product. Drops Studio does not guess an undocumented provider endpoint or signature header."),
      callbackEvidence: result.project.callbackEvidence,
    }, 201);
  } catch (error) {
    return responseError(error);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const member = account(request);
    requireSameOrigin(request);
    await enforceMutationLimit(member.identity);
    if (!dropsBotWebhookStorageConfigured()) {
      throw new DropsBotWebhookStorageUnavailableError();
    }
    const input = await body(request);
    requireConsent(input, "rotating");
    const ownedProjectId = await requireOwnedProject(member, input);
    const rotatedAt = new Date().toISOString();
    const capability = createDropsBotWebhookCapability();
    const result = await rotateDropsBotWebhookConnection({
      ownerIdentity: member.identity,
      projectId: ownedProjectId,
      capabilityHash: capability.hash,
      consentedAt: rotatedAt,
    });
    if (result.status === "not-found") {
      throw new DropsBotWebhookResponseError(404, {
        error: "Drops Bot callback not found for this project.",
      });
    }
    return json({
      connectionId: result.project.connectionId,
      projectId: ownedProjectId,
      callbackUrl: callbackUrl(
        request,
        result.project.connectionId,
        capability.secret,
      ),
      rotatedAt,
      registration: registration("Replace the previous URL inside the official @drops product. The previous secret stopped working when this URL was issued."),
      callbackEvidence: result.project.callbackEvidence,
    }, 200);
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const member = account(request);
    requireSameOrigin(request);
    await enforceMutationLimit(member.identity);
    if (!dropsBotWebhookStorageConfigured()) {
      throw new DropsBotWebhookStorageUnavailableError();
    }
    const input = await body(request);
    requireConsent(input, "revoking");
    const ownedProjectId = await requireOwnedProject(member, input);
    const result = await revokeDropsBotWebhookConnection(
      member.identity,
      ownedProjectId,
    );
    if (result.status === "not-found") {
      throw new DropsBotWebhookResponseError(404, {
        error: "Drops Bot callback not found for this project.",
      });
    }
    return json({
      revoked: true,
      projectId: ownedProjectId,
      revokedAt: new Date().toISOString(),
    }, 200);
  } catch (error) {
    return responseError(error);
  }
}
