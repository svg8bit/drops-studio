import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server.js";

import {
  createDropsBotWebhookConnection,
  dropsBotWebhookStorageConfigured,
  DropsBotWebhookCapacityError,
  DropsBotWebhookStorageUnavailableError,
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
      error: "Cross-origin Drops Bot callback creation rejected.",
    });
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new DropsBotWebhookResponseError(403, {
      error: "A same-origin Drops Bot callback request is required.",
    });
  }
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) throw new Error();
  } catch {
    throw new DropsBotWebhookResponseError(403, {
      error: "Cross-origin Drops Bot callback creation rejected.",
    });
  }
}

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  if (!hasJsonMediaType(request)) {
    throw new DropsBotWebhookResponseError(415, {
      error: "Drops Bot callback creation requires application/json.",
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
      error: "Drops Bot callback creation requires a valid JSON body.",
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DropsBotWebhookResponseError(400, {
      error: "Drops Bot callback creation requires a JSON object.",
    });
  }
  const input = parsed as Record<string, unknown>;
  const unsupported = Object.keys(input).filter((key) => !["projectId", "consent"].includes(key));
  if (unsupported.length) {
    throw new DropsBotWebhookResponseError(400, {
      error: `Drops Bot callback creation contains unsupported fields: ${unsupported.join(", ")}.`,
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

function responseError(error: unknown): NextResponse {
  if (error instanceof DropsBotWebhookResponseError) {
    return json(error.payload, error.status);
  }
  if (error instanceof DropsBotWebhookValidationError) {
    return json({ code: error.code, error: error.message }, error.status);
  }
  if (
    error instanceof DropsBotWebhookCapacityError
    || error instanceof DropsBotWebhookStorageUnavailableError
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
    if (!dropsBotWebhookStorageConfigured()) {
      throw new DropsBotWebhookStorageUnavailableError();
    }
    const input = await body(request);
    if (input.consent !== true) {
      throw new DropsBotWebhookResponseError(400, {
        code: "DROPSBOT_CONSENT_REQUIRED",
        error: "Explicit consent is required before creating a secret callback URL.",
      });
    }
    const ownedProjectId = projectId(input.projectId);
    const projects = await listMemberProjects(member.identity);
    if (!projects.some((project) => project.id === ownedProjectId)) {
      throw new DropsBotWebhookResponseError(404, {
        error: "Signed project not found.",
      });
    }

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

    const callbackUrl = new URL(
      `/api/dropsbot/webhooks/${connectionId}/${capability.secret}`,
      request.nextUrl.origin,
    ).toString();
    return json({
      connectionId,
      projectId: ownedProjectId,
      callbackUrl,
      createdAt,
      registration: {
        mode: "manual-in-@drops",
        officialSurface: "https://t.me/Drops",
        claimedConfigured: false,
        note: "Add this callback URL through the official @drops product. Drops Studio does not guess an undocumented provider endpoint or signature header.",
      },
      callbackEvidence: result.project.callbackEvidence,
    }, 201);
  } catch (error) {
    return responseError(error);
  }
}
