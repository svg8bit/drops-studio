import { NextRequest } from "next/server.js";

import {
  acceptTeamWorkspaceInvite,
  resolveTeamWorkspaceIdentity,
  teamWorkspaceStorageConfigured,
  TeamWorkspaceStorageUnavailableError,
} from "@/db/team-workspaces";
import {
  resolveTeamInviteSecret,
  TeamWorkspaceValidationError,
  verifyTeamInviteCapability,
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

export async function POST(request: NextRequest) {
  try {
    const secret = resolveTeamInviteSecret();
    if (!secret || !teamWorkspaceStorageConfigured()) {
      return teamJson({ error: "Team invite acceptance is not configured or unavailable." }, 503);
    }
    const account = await teamAccount(request);
    requireTeamSameOrigin(request);
    const body = await teamRequestBody(request, 8 * 1_024);
    const capability = String(body.capability ?? "");
    const invite = verifyTeamInviteCapability(capability, secret);
    if (!invite) {
      throw new TeamWorkspaceValidationError("Team invite is invalid or expired.");
    }
    const ownerIdentity = await resolveTeamWorkspaceIdentity(invite.ownerIdentity);
    const entitlements = await proTeamEntitlements(ownerIdentity);
    await enforceTeamRateLimit(account.identity, "team-workspace-invite-accept", account.legacyIdentity);
    const result = await acceptTeamWorkspaceInvite({
      capability,
      memberIdentity: account.identity,
      consent: body.consent === true,
      secret,
      maxCollaborators: entitlements.collaboratorsPerWorkspace,
    });
    if (result.status === "not-found") return teamJson({ error: "Team invite not found." }, 404);
    return teamJson({
      status: result.status,
      workspace: result.workspace,
    });
  } catch (error) {
    const apiError = teamApiError(error);
    if (apiError) return apiError;
    if (error instanceof TeamWorkspaceValidationError) {
      return teamJson({ error: "Team invite is invalid, expired or missing consent." }, 400);
    }
    if (error instanceof TeamWorkspaceStorageUnavailableError) {
      return teamJson({ error: "Team invite storage is unavailable." }, 503);
    }
    return teamJson({ error: "Team invite could not be accepted safely." }, 500);
  }
}
