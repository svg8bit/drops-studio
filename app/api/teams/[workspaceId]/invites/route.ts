import { NextRequest } from "next/server.js";

import {
  createTeamWorkspaceInvite,
  teamWorkspaceStorageConfigured,
  TeamWorkspaceStorageUnavailableError,
} from "@/db/team-workspaces";
import {
  resolveTeamInviteSecret,
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

export async function POST(request: NextRequest, context: Context) {
  try {
    const secret = resolveTeamInviteSecret();
    if (!secret || !teamWorkspaceStorageConfigured()) {
      return teamJson({ error: "Team invites are not configured or unavailable." }, 503);
    }
    const account = teamAccount(request);
    requireTeamSameOrigin(request);
    const body = await teamRequestBody(request, 8 * 1_024);
    const ownerIdentity = String(body.ownerIdentity ?? "");
    const entitlements = await proTeamEntitlements(ownerIdentity);
    await enforceTeamRateLimit(account.identity, "team-workspace-invite");
    const hours = Number(body.expiresInHours);
    if (!Number.isSafeInteger(hours) || hours < 1 || hours > 24 * 30) {
      return teamJson({ error: "Team invite expiry must be 1 to 720 hours." }, 400);
    }
    const { workspaceId } = await context.params;
    const result = await createTeamWorkspaceInvite({
      actorIdentity: account.identity,
      ownerIdentity,
      workspaceId,
      expectedRevision: Number(body.expectedRevision),
      role: body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : body.role as never,
      expiresAt: new Date(Date.now() + hours * 60 * 60 * 1_000).toISOString(),
      consent: body.consent === true,
      secret,
      maxCollaborators: entitlements.collaboratorsPerWorkspace,
    });
    if (result.status === "not-found") return teamJson({ error: "Team workspace not found." }, 404);
    if (result.status === "forbidden") return teamJson({ error: "Only the team owner can create invites." }, 403);
    if (result.status === "conflict") {
      return teamJson({
        code: "TEAM_REVISION_CONFLICT",
        error: "Team workspace changed in another session.",
        current: result.current,
      }, 409);
    }
    return teamJson({
      workspace: result.workspace,
      invite: result.invite,
      capability: result.capability,
    }, 201);
  } catch (error) {
    const apiError = teamApiError(error);
    if (apiError) return apiError;
    if (error instanceof TeamWorkspaceValidationError) return teamJson({ error: error.message }, 400);
    if (error instanceof TeamWorkspaceStorageUnavailableError) {
      return teamJson({ error: "Team invite storage is unavailable." }, 503);
    }
    return teamJson({ error: "Team invite could not be created safely." }, 500);
  }
}
