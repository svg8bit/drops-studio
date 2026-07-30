import { NextRequest } from "next/server.js";

import {
  changeTeamMemberRole,
  teamWorkspaceStorageConfigured,
  TeamWorkspaceStorageUnavailableError,
} from "@/db/team-workspaces";
import { TeamWorkspaceValidationError } from "@/lib/team-workspaces";
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

export async function PATCH(request: NextRequest, context: Context) {
  try {
    if (!teamWorkspaceStorageConfigured()) {
      return teamJson({ error: "Team workspace storage is not configured or unavailable." }, 503);
    }
    const account = await teamAccount(request);
    requireTeamSameOrigin(request);
    const body = await teamRequestBody(request);
    const ownerIdentity = String(body.ownerIdentity ?? "");
    await proTeamEntitlements(ownerIdentity);
    await enforceTeamRateLimit(account.identity, "team-workspace-member-role", account.legacyIdentity);
    const { workspaceId } = await context.params;
    const result = await changeTeamMemberRole({
      actorIdentity: account.identity,
      ownerIdentity,
      workspaceId,
      memberIdentity: String(body.memberIdentity ?? ""),
      role: body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : body.role as never,
      expectedRevision: Number(body.expectedRevision),
      consent: body.consent === true,
    });
    if (result.status === "not-found") return teamJson({ error: "Team workspace or member not found." }, 404);
    if (result.status === "forbidden") return teamJson({ error: "Only the team owner can change roles." }, 403);
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
    return teamJson({ error: "Team member role could not be changed safely." }, 500);
  }
}
