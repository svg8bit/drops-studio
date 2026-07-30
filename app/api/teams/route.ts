import { NextRequest, NextResponse } from "next/server.js";

import {
  billingEntitlements,
  billingTierForAccount,
  stripeProPriceId,
} from "@/lib/billing";
import {
  billingStorageConfigured,
  BillingStorageUnavailableError,
  readBillingAccount,
} from "@/db/billing";
import {
  createTeamWorkspace,
  listTeamWorkspaces,
  listTeamWorkspacesForMember,
  teamWorkspaceStorageConfigured,
  TeamWorkspaceStorageUnavailableError,
} from "@/db/team-workspaces";
import {
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
} from "@/lib/access-tier";
import { TeamWorkspaceValidationError } from "@/lib/team-workspaces";
import { consumeRequestLimit } from "@/lib/request-rate-limit";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "@/lib/http-request-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store, max-age=0", vary: "Cookie" };

function json(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

function account(request: NextRequest) {
  return resolveStudioAccount(request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value);
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const member = account(request);
  if (!member) return json({ error: "A signed Studio member account is required." }, 401);
  if (!teamWorkspaceStorageConfigured()) {
    return json({ error: "Team workspace storage is not configured or unavailable." }, 503);
  }
  const ownerIdentity = request.nextUrl.searchParams.get("owner");
  try {
    const workspaces = ownerIdentity
      ? await listTeamWorkspaces(ownerIdentity, member.identity)
      : await listTeamWorkspacesForMember(member.identity);
    return json({ workspaces, accountIdentity: member.identity }, 200);
  } catch (error) {
    if (error instanceof TeamWorkspaceStorageUnavailableError) {
      return json({ error: "Team workspace storage is unavailable." }, 503);
    }
    return json({ error: "Team workspaces could not be read safely." }, 400);
  }
}

export async function POST(request: NextRequest) {
  if (!teamWorkspaceStorageConfigured() || !billingStorageConfigured()) {
    return json({ error: "Team workspaces are not configured or unavailable." }, 503);
  }
  const member = account(request);
  if (!member) return json({ error: "A signed Studio member account is required." }, 401);
  if (!sameOrigin(request)) return json({ error: "Cross-origin team request rejected." }, 403);
  if (!hasJsonMediaType(request)) {
    return json({ error: "Team creation requires application/json." }, 415);
  }
  let raw: string;
  try {
    raw = decodeUtf8Body(await readBoundedRequestBody(request, 4_096));
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      return json({ error: "Team creation request is too large." }, 413);
    }
    return json({ error: "Team creation request is invalid." }, 400);
  }
  let body: { name?: unknown; consent?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "Team creation request is invalid." }, 400);
  }
  try {
    const billing = await readBillingAccount(member.identity);
    const entitlements = billingEntitlements(
      billingTierForAccount(billing, stripeProPriceId()),
    );
    if (entitlements.teamWorkspaces < 1) {
      return json({
        code: "PRO_REQUIRED",
        error: "A verified active Pro subscription is required to create team workspaces.",
      }, 403);
    }
    const limit = await consumeRequestLimit({
      identity: member.identity,
      namespace: "team-workspace-create",
      max: 20,
      windowMs: 60 * 60 * 1_000,
    });
    if (limit === "limited") return json({ error: "Too many team requests. Try again later." }, 429);
    if (limit === "unavailable") return json({ error: "Team request protection is unavailable." }, 503);
    const workspace = await createTeamWorkspace({
      ownerIdentity: member.identity,
      name: String(body.name ?? ""),
      consent: body.consent === true,
      maxWorkspaces: entitlements.teamWorkspaces,
    });
    return json({ workspace }, 201);
  } catch (error) {
    if (error instanceof TeamWorkspaceValidationError) {
      return json({ error: error.message }, 400);
    }
    if (
      error instanceof TeamWorkspaceStorageUnavailableError
      || error instanceof BillingStorageUnavailableError
    ) {
      return json({ error: "Team workspaces are not configured or unavailable." }, 503);
    }
    return json({ error: "Team workspace could not be created safely." }, 500);
  }
}
