import { NextRequest } from "next/server.js";

import {
  acceptTeamWorkspaceInvite,
  teamWorkspaceStorageConfigured,
  TeamWorkspaceStorageUnavailableError,
} from "@/db/team-workspaces";
import {
  resolveTeamInviteSecret,
  TeamWorkspaceValidationError,
} from "@/lib/team-workspaces";
import {
  enforceTeamRateLimit,
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
    const account = teamAccount(request);
    requireTeamSameOrigin(request);
    const body = await teamRequestBody(request, 8 * 1_024);
    await enforceTeamRateLimit(account.identity, "team-workspace-invite-accept");
    const result = await acceptTeamWorkspaceInvite({
      capability: String(body.capability ?? ""),
      memberIdentity: account.identity,
      consent: body.consent === true,
      secret,
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
