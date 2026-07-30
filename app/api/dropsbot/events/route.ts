import { NextRequest, NextResponse } from "next/server.js";

import {
  dropsBotWebhookStorageConfigured,
  DropsBotWebhookStorageUnavailableError,
  listDropsBotWebhookProject,
} from "../../../../db/dropsbot-webhooks.ts";
import {
  listMemberProjects,
  MemberProjectStorageUnavailableError,
} from "../../../../db/member-projects.ts";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "../../../../lib/access-tier.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

function json(payload: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function projectId(value: string | null): string | null {
  return value && /^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value) ? value : null;
}

function eventLimit(value: string | null): number | null {
  if (value === null || value === "") return 50;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const member = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  if (!member) {
    return json({
      code: "DROPSBOT_ACCOUNT_REQUIRED",
      error: "Connect a signed Studio account before reading callback events.",
    }, 401);
  }
  const requestedProjectId = projectId(request.nextUrl.searchParams.get("projectId"));
  const limit = eventLimit(request.nextUrl.searchParams.get("limit"));
  if (!requestedProjectId || limit === null) {
    return json({
      error: "A valid projectId and an optional limit from 1 to 100 are required.",
    }, 400);
  }

  try {
    if (!dropsBotWebhookStorageConfigured()) {
      throw new DropsBotWebhookStorageUnavailableError();
    }
    const projects = await listMemberProjects(member.identity);
    if (!projects.some((project) => project.id === requestedProjectId)) {
      return json({ error: "Signed project not found." }, 404);
    }
    const project = await listDropsBotWebhookProject(member.identity, requestedProjectId);
    if (!project) {
      return json({ error: "Drops Bot callback not found for this project." }, 404);
    }
    return json({
      connection: {
        id: project.connectionId,
        projectId: project.projectId,
        createdAt: project.createdAt,
        consentedAt: project.consentedAt,
      },
      events: project.events.slice(0, limit),
      callbackEvidence: project.callbackEvidence,
      registration: {
        mode: "manual-in-@drops",
        officialSurface: "https://t.me/Drops",
        claimedConfigured: false,
      },
    }, 200);
  } catch (error) {
    if (
      error instanceof DropsBotWebhookStorageUnavailableError
      || error instanceof MemberProjectStorageUnavailableError
    ) {
      return json({
        error: "Callback event storage is temporarily unavailable.",
      }, 503);
    }
    console.error("Unexpected callback event list failure.", error);
    return json({
      error: "Callback events are temporarily unavailable.",
    }, 503);
  }
}
