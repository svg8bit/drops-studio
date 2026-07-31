import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server.js";

import {
  COLLABORATION_EVENT_TYPES,
  COLLABORATION_MAX_READ_EVENTS,
  COLLABORATION_MAX_REQUEST_BYTES,
  CollaborationTransport,
  CollaborationTransportError,
  createProductionCollaborationTransport,
  type CollaborationAppendInput,
} from "./collaboration-transport.ts";
import { consumeRequestLimit } from "./request-rate-limit.ts";
import {
  proTeamEntitlements,
  requireTeamSameOrigin,
  teamAccount,
  teamApiError,
  TeamApiError,
  teamJson,
  teamRequestBody,
} from "./team-api.ts";
import {
  teamPermission,
  type TeamWorkspace,
} from "./team-workspaces.ts";
import { ProjectDataError } from "./project-data/index.ts";

const HEALTH_SECRET_MIN_BYTES = 32;

interface CollaborationRouteDependencies {
  environment?: NodeJS.ProcessEnv;
  transport?: CollaborationTransport | null;
  resolveWorkspace?: (actorIdentity: string, workspaceId: string) => Promise<TeamWorkspace | null>;
  enforceRateLimit?: (identity: string, mode: "read" | "write") => Promise<void>;
  enforceHealthRateLimit?: () => Promise<void>;
  requireWriteEntitlement?: (ownerIdentity: string) => Promise<unknown>;
}

let productionTransport: Promise<CollaborationTransport | null> | null = null;

function transportFor(dependencies: CollaborationRouteDependencies): Promise<CollaborationTransport | null> {
  if (Object.prototype.hasOwnProperty.call(dependencies, "transport")) {
    return Promise.resolve(dependencies.transport ?? null);
  }
  productionTransport ??= createProductionCollaborationTransport(
    dependencies.environment ?? process.env,
  ).catch((error: unknown) => {
    productionTransport = null;
    throw error;
  });
  return productionTransport;
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TeamApiError(400, `Collaboration ${name} is required.`);
  }
  return value.trim();
}

function revisionField(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TeamApiError(400, "Collaboration expectedRevision must be a non-negative integer.");
  }
  return value;
}

function idempotencyKeyField(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)
  ) {
    throw new TeamApiError(
      400,
      "Collaboration idempotencyKey must be 8-128 safe characters.",
    );
  }
  return value;
}

function eventTypeField(value: unknown): CollaborationAppendInput["type"] {
  if (
    typeof value !== "string"
    || !(COLLABORATION_EVENT_TYPES as readonly string[]).includes(value)
  ) {
    throw new TeamApiError(400, "Collaboration type is unsupported.");
  }
  return value as CollaborationAppendInput["type"];
}

function exactFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(body).filter((key) => !allowedSet.has(key));
  if (unsupported.length) {
    throw new TeamApiError(
      400,
      `Collaboration request contains unsupported fields: ${unsupported.join(", ")}.`,
    );
  }
}

function numericQuery(value: string | null, fallback: number, name: string): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new TeamApiError(400, `Collaboration ${name} is invalid.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TeamApiError(400, `Collaboration ${name} is invalid.`);
  return parsed;
}

async function defaultWorkspaceResolver(
  actorIdentity: string,
  workspaceId: string,
): Promise<TeamWorkspace | null> {
  const { listTeamWorkspacesForMember } = await import("../db/team-workspaces.ts");
  const workspaces = await listTeamWorkspacesForMember(actorIdentity);
  return workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

async function defaultRateLimit(identity: string, mode: "read" | "write"): Promise<void> {
  const status = await consumeRequestLimit({
    identity,
    namespace: `collaboration:${mode}`,
    max: mode === "read" ? 720 : 180,
    windowMs: 60 * 60 * 1_000,
  });
  if (status === "limited") throw new TeamApiError(429, "Collaboration request limit reached.");
  if (status === "unavailable") {
    throw new TeamApiError(503, "Collaboration request protection is unavailable.");
  }
}

async function defaultHealthRateLimit(): Promise<void> {
  const status = await consumeRequestLimit({
    identity: "operator-health",
    namespace: "collaboration:health",
    max: 12,
    windowMs: 60 * 60 * 1_000,
  });
  if (status === "limited") {
    throw new TeamApiError(429, "Collaboration health request limit reached.");
  }
  if (status === "unavailable") {
    throw new TeamApiError(503, "Collaboration health request protection is unavailable.");
  }
}

async function authorizedWorkspace(
  dependencies: CollaborationRouteDependencies,
  actorIdentity: string,
  workspaceId: string,
  projectId: string,
  action: "read" | "write",
): Promise<TeamWorkspace> {
  const resolveWorkspace = dependencies.resolveWorkspace ?? defaultWorkspaceResolver;
  const workspace = await resolveWorkspace(actorIdentity, workspaceId);
  if (!workspace || !teamPermission(workspace, actorIdentity, action)) {
    throw new TeamApiError(action === "read" ? 404 : 403, "Collaboration workspace is unavailable.");
  }
  if (!workspace.projects.some((project) => project.projectId === projectId)) {
    throw new TeamApiError(404, "Collaboration project is not shared in this workspace.");
  }
  return workspace;
}

function bearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function validHealthAuthorization(request: NextRequest, environment: NodeJS.ProcessEnv): boolean {
  const expected = environment.DROPS_PLATFORM_HEALTH_OPERATOR_SECRET?.trim() ?? "";
  const supplied = bearerToken(request);
  if (
    Buffer.byteLength(expected, "utf8") < HEALTH_SECRET_MIN_BYTES
    || Buffer.byteLength(supplied, "utf8") !== Buffer.byteLength(expected, "utf8")
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"));
}

function transportError(error: unknown): NextResponse | null {
  if (error instanceof CollaborationTransportError) {
    return teamJson({
      code: error.code.toUpperCase(),
      error: error.message,
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    }, error.status);
  }
  if (error instanceof ProjectDataError) {
    return teamJson({ code: error.code.toUpperCase(), error: error.message }, error.status);
  }
  return teamApiError(error);
}

function unavailable(): NextResponse {
  return teamJson({
    status: "unavailable",
    code: "COLLABORATION_STORAGE_UNAVAILABLE",
    error: "Durable collaboration storage is not configured or unavailable.",
  }, 503);
}

export function createCollaborationRouteHandlers(
  dependencies: CollaborationRouteDependencies = {},
) {
  return {
    async GET(request: NextRequest): Promise<NextResponse> {
      try {
        if (request.nextUrl.searchParams.get("health") === "1") {
          const environment = dependencies.environment ?? process.env;
          const configured = environment.DROPS_PLATFORM_HEALTH_OPERATOR_SECRET?.trim() ?? "";
          if (Buffer.byteLength(configured, "utf8") < HEALTH_SECRET_MIN_BYTES) {
            return teamJson({
              status: "unavailable",
              code: "HEALTH_OPERATOR_SECRET_NOT_CONFIGURED",
            }, 503);
          }
          if (!validHealthAuthorization(request, environment)) {
            return teamJson({ status: "unauthorized" }, 401);
          }
          await (dependencies.enforceHealthRateLimit ?? defaultHealthRateLimit)();
          const transport = await transportFor(dependencies);
          if (!transport) return unavailable();
          return teamJson({ ...await transport.liveHealth() });
        }

        const member = teamAccount(request);
        const workspaceId = stringField(request.nextUrl.searchParams.get("workspaceId"), "workspaceId");
        const projectId = stringField(request.nextUrl.searchParams.get("projectId"), "projectId");
        const afterRevision = numericQuery(
          request.nextUrl.searchParams.get("afterRevision"),
          0,
          "afterRevision",
        );
        const limit = numericQuery(
          request.nextUrl.searchParams.get("limit"),
          COLLABORATION_MAX_READ_EVENTS,
          "limit",
        );
        await (dependencies.enforceRateLimit ?? defaultRateLimit)(member.identity, "read");
        await authorizedWorkspace(dependencies, member.identity, workspaceId, projectId, "read");
        const transport = await transportFor(dependencies);
        if (!transport) return unavailable();
        const result = await transport.read({ workspaceId, projectId }, { afterRevision, limit });
        return teamJson({
          status: "working",
          mode: transport.mode,
          ...result,
        });
      } catch (error) {
        return transportError(error) ?? teamJson({ error: "Collaboration read failed safely." }, 503);
      }
    },

    async POST(request: NextRequest): Promise<NextResponse> {
      try {
        const member = teamAccount(request);
        requireTeamSameOrigin(request);
        const body = await teamRequestBody(request, COLLABORATION_MAX_REQUEST_BYTES);
        exactFields(body, [
          "workspaceId",
          "projectId",
          "expectedRevision",
          "idempotencyKey",
          "type",
          "payload",
        ]);
        const input: CollaborationAppendInput = {
          workspaceId: stringField(body.workspaceId, "workspaceId"),
          projectId: stringField(body.projectId, "projectId"),
          actorId: member.identity,
          expectedRevision: revisionField(body.expectedRevision),
          idempotencyKey: idempotencyKeyField(body.idempotencyKey),
          type: eventTypeField(body.type),
          payload: body.payload,
        };
        await (dependencies.enforceRateLimit ?? defaultRateLimit)(member.identity, "write");
        const workspace = await authorizedWorkspace(
          dependencies,
          member.identity,
          input.workspaceId,
          input.projectId,
          "write",
        );
        await (dependencies.requireWriteEntitlement ?? proTeamEntitlements)(workspace.ownerIdentity);
        const transport = await transportFor(dependencies);
        if (!transport) return unavailable();
        const result = await transport.append(input);
        return teamJson({
          status: "working",
          mode: transport.mode,
          ...result,
        }, result.idempotent ? 200 : 201);
      } catch (error) {
        return transportError(error) ?? teamJson({ error: "Collaboration write failed safely." }, 503);
      }
    },
  };
}
