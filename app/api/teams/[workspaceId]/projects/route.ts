import { NextRequest } from "next/server.js";

import {
  TeamWorkspaceCapacityError,
  teamWorkspaceStorageConfigured,
  TeamWorkspaceStorageUnavailableError,
  upsertTeamWorkspaceProject,
} from "@/db/team-workspaces";
import {
  MemberProjectValidationError,
  MEMBER_PROJECT_BODY_LIMIT_BYTES,
} from "@/lib/member-project-cloud";
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

export async function PUT(request: NextRequest, context: Context) {
  try {
    if (!teamWorkspaceStorageConfigured()) {
      return teamJson({ error: "Team workspace storage is not configured or unavailable." }, 503);
    }
    const account = teamAccount(request);
    requireTeamSameOrigin(request);
    const body = await teamRequestBody(request, MEMBER_PROJECT_BODY_LIMIT_BYTES);
    const ownerIdentity = String(body.ownerIdentity ?? "");
    await proTeamEntitlements(ownerIdentity);
    await enforceTeamRateLimit(account.identity, "team-workspace-project-write");
    const { workspaceId } = await context.params;
    const result = await upsertTeamWorkspaceProject({
      actorIdentity: account.identity,
      ownerIdentity,
      workspaceId,
      expectedWorkspaceRevision: Number(body.expectedWorkspaceRevision),
      expectedProjectRevision: Number(body.expectedProjectRevision),
      project: body.project,
      consent: body.consent === true,
    });
    if (result.status === "not-found") return teamJson({ error: "Team workspace not found." }, 404);
    if (result.status === "forbidden") return teamJson({ error: "Team project write permission is required." }, 403);
    if (result.status === "conflict") {
      return teamJson({
        code: "TEAM_PROJECT_REVISION_CONFLICT",
        error: "Team workspace or shared project changed in another session.",
        current: result.current,
        ...(result.currentProject ? { currentProject: result.currentProject } : {}),
      }, 409);
    }
    return teamJson({ workspace: result.workspace, project: result.project },
      result.project.revision === 1 ? 201 : 200);
  } catch (error) {
    const apiError = teamApiError(error);
    if (apiError) return apiError;
    if (error instanceof TeamWorkspaceCapacityError) {
      return teamJson({
        code: "TEAM_SOURCE_CAPACITY_REACHED",
        error: error.message,
      }, 413);
    }
    if (error instanceof TeamWorkspaceStorageUnavailableError) {
      return teamJson({ error: "Team workspace storage is unavailable." }, 503);
    }
    if (error instanceof TeamWorkspaceValidationError) {
      return teamJson({ error: error.message }, 400);
    }
    if (error instanceof MemberProjectValidationError) {
      return teamJson({ error: error.message }, 400);
    }
    console.error("Unexpected team shared project write failure.", error);
    return teamJson({ error: "Team shared project could not be saved safely." }, 500);
  }
}
