import { NextRequest } from "next/server.js";

import {
  readTeamWorkspace,
  teamWorkspaceStorageConfigured,
  TeamWorkspaceStorageUnavailableError,
  updateTeamWorkspace,
} from "@/db/team-workspaces";
import {
  TeamWorkspacePermissionError,
  TeamWorkspaceValidationError,
} from "@/lib/team-workspaces";
import {
  enforceTeamRateLimit,
  proTeamEntitlements,
  requireTeamSameOrigin,
  teamAccount,
  teamApiError,
  teamJson,
  teamRequestBody,
} from "@/lib/team-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    if (!teamWorkspaceStorageConfigured()) {
      return teamJson({ error: "Team workspace storage is not configured or unavailable." }, 503);
    }
    const account = teamAccount(request);
    const { workspaceId } = await context.params;
    const ownerIdentity = request.nextUrl.searchParams.get("owner") ?? account.identity;
    const workspace = await readTeamWorkspace(
      ownerIdentity,
      workspaceId,
      account.identity,
    );
    return workspace
      ? teamJson({ workspace })
      : teamJson({ error: "Team workspace not found." }, 404);
  } catch (error) {
    const apiError = teamApiError(error);
    if (apiError) return apiError;
    if (error instanceof TeamWorkspacePermissionError) {
      return teamJson({ error: error.message }, 403);
    }
    if (error instanceof TeamWorkspaceStorageUnavailableError) {
      return teamJson({ error: "Team workspace storage is unavailable." }, 503);
    }
    return teamJson({ error: "Team workspace could not be read safely." }, 400);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    if (!teamWorkspaceStorageConfigured()) {
      return teamJson({ error: "Team workspace storage is not configured or unavailable." }, 503);
    }
    const account = teamAccount(request);
    requireTeamSameOrigin(request);
    const body = await teamRequestBody(request);
    const ownerIdentity = String(body.ownerIdentity ?? "");
    await proTeamEntitlements(ownerIdentity);
    await enforceTeamRateLimit(account.identity, "team-workspace-update");
    const { workspaceId } = await context.params;
    const result = await updateTeamWorkspace({
      actorIdentity: account.identity,
      ownerIdentity,
      workspaceId,
      expectedRevision: Number(body.expectedRevision),
      name: String(body.name ?? ""),
      consent: body.consent === true,
    });
    if (result.status === "not-found") return teamJson({ error: "Team workspace not found." }, 404);
    if (result.status === "forbidden") return teamJson({ error: "Team workspace write permission is required." }, 403);
    if (result.status === "conflict") {
      return teamJson({
        code: "TEAM_REVISION_CONFLICT",
        error: "Team workspace changed in another session.",
        current: result.current,
      }, 409);
    }
    return teamJson({ workspace: result.workspace });
  } catch (error) {
    const apiError = teamApiError(error);
    if (apiError) return apiError;
    if (error instanceof TeamWorkspaceValidationError) return teamJson({ error: error.message }, 400);
    if (error instanceof TeamWorkspaceStorageUnavailableError) {
      return teamJson({ error: "Team workspace storage is unavailable." }, 503);
    }
    return teamJson({ error: "Team workspace could not be updated safely." }, 500);
  }
}
