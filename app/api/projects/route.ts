import { NextRequest, NextResponse } from "next/server.js";

import {
  deleteMemberProject,
  listMemberProjects,
  MEMBER_PROJECT_LIMIT,
  memberProjectStorageConfigured,
  MemberProjectStorageUnavailableError,
  migrateMemberProjectIdentity,
  upsertMemberProject,
} from "../../../db/member-projects.ts";
import {
  billingStorageConfigured,
} from "../../../db/billing.ts";
import {
  readStudioBillingAccount,
  resolveStudioAccount,
  STUDIO_ACCOUNT_COOKIE,
  type StudioAccount,
} from "../../../lib/access-tier.ts";
import {
  billingEntitlements,
  billingTierForAccount,
  stripeProPriceId,
} from "../../../lib/billing.ts";
import {
  ArtifactSecretError,
  assertProjectPayloadSafe,
} from "../../../lib/artifact-security.ts";
import {
  MEMBER_PROJECT_BODY_LIMIT_BYTES,
  sanitizeMemberProjectDraft,
} from "../../../lib/member-project-cloud.ts";
import { consumeRequestLimit } from "../../../lib/request-rate-limit.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

class MemberProjectResponseError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload.error ?? "Member project request failed."));
    this.name = "MemberProjectResponseError";
    this.status = status;
    this.payload = payload;
  }
}

function json(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

async function account(request: NextRequest): Promise<StudioAccount> {
  const resolved = resolveStudioAccount(
    request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
  );
  if (!resolved) {
    throw new MemberProjectResponseError(401, {
      code: "MEMBER_SESSION_REQUIRED",
      error: "Connect a signed Studio account before syncing projects.",
    });
  }
  await migrateMemberProjectIdentity(resolved.identity, resolved.legacyIdentity);
  return resolved;
}

function requireSameOrigin(request: NextRequest): void {
  const site = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (site === "cross-site") {
    throw new MemberProjectResponseError(403, {
      error: "Cross-origin project sync rejected.",
    });
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new MemberProjectResponseError(403, {
      error: "A same-origin project sync request is required.",
    });
  }
  try {
    if (new URL(origin).origin !== request.nextUrl.origin) throw new Error();
  } catch {
    throw new MemberProjectResponseError(403, {
      error: "Cross-origin project sync rejected.",
    });
  }
}

async function body(request: NextRequest): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new MemberProjectResponseError(415, {
      error: "Member project sync requires application/json.",
    });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MEMBER_PROJECT_BODY_LIMIT_BYTES
  ) {
    throw new MemberProjectResponseError(413, {
      error: "Member project sync payload is too large.",
    });
  }
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > MEMBER_PROJECT_BODY_LIMIT_BYTES) {
    throw new MemberProjectResponseError(413, {
      error: "Member project sync payload is too large.",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new MemberProjectResponseError(400, {
      error: "Member project sync requires a valid JSON body.",
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MemberProjectResponseError(400, {
      error: "Member project sync requires a JSON object.",
    });
  }
  return parsed as Record<string, unknown>;
}

function revision(value: unknown, allowZero: boolean): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)
  ) {
    throw new MemberProjectResponseError(400, {
      error: allowZero
        ? "expectedRevision must be a non-negative integer."
        : "expectedRevision must be a positive integer.",
    });
  }
  return value;
}

function projectId(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^[a-z0-9][a-z0-9:_-]{0,127}$/i.test(value)
  ) {
    throw new MemberProjectResponseError(400, {
      error: "Project id is invalid.",
    });
  }
  return value;
}

function projectDraft(value: unknown) {
  try {
    return sanitizeMemberProjectDraft(value);
  } catch (error) {
    if (error instanceof ArtifactSecretError) throw error;
    throw new MemberProjectResponseError(400, {
      error: error instanceof Error
        ? error.message
        : "Member project data is invalid.",
    });
  }
}

function requireBodyFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  assertProjectPayloadSafe(input, "member project sync request");
  const allowedFields = new Set(allowed);
  const unsupported = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unsupported.length) {
    throw new MemberProjectResponseError(400, {
      error: `Member project sync request contains unsupported fields: ${unsupported.join(", ")}.`,
    });
  }
}

async function enforceLimit(
  member: StudioAccount,
  mode: "read" | "write",
): Promise<void> {
  const localProof = process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
  const state = await consumeRequestLimit({
    identity: member.identity,
    legacyIdentity: member.legacyIdentity,
    namespace: `member-project-${mode}`,
    max: localProof ? 5_000 : 600,
    windowMs: 60 * 60 * 1_000,
  });
  if (state === "limited") {
    throw new MemberProjectResponseError(429, {
      error: "Project sync is receiving too many requests. Retry shortly; the browser copy is still safe.",
    });
  }
  if (state === "unavailable" && process.env.NODE_ENV === "production") {
    throw new MemberProjectResponseError(503, {
      error: "Secure project sync protection is temporarily unavailable.",
    });
  }
}

function requireStorage(): void {
  if (!memberProjectStorageConfigured()) {
    throw new MemberProjectResponseError(503, {
      error: "Member cloud project storage is not configured. Your browser project remains available.",
    });
  }
}

async function privateProjectLimit(member: StudioAccount): Promise<number> {
  const expectedPriceId = stripeProPriceId();
  if (!expectedPriceId || !billingStorageConfigured()) return MEMBER_PROJECT_LIMIT;
  try {
    const billing = await readStudioBillingAccount(member);
    return billingEntitlements(
      billingTierForAccount(billing, expectedPriceId),
    ).privateProjects;
  } catch {
    // Paid storage expansion is fail-closed when billing proof is unavailable.
    return MEMBER_PROJECT_LIMIT;
  }
}

function responseError(error: unknown): NextResponse {
  if (error instanceof MemberProjectResponseError) {
    return json(error.payload, error.status);
  }
  if (error instanceof ArtifactSecretError) {
    return json({
      code: "PROJECT_SECRET_REJECTED",
      error: "Project sync stopped because the payload contains credential-like material. Keep credentials in the session-only Connections vault.",
    }, 400);
  }
  if (error instanceof MemberProjectStorageUnavailableError) {
    return json({
      error: "Member cloud project storage is temporarily unavailable. The browser copy remains available.",
    }, 503);
  }
  console.error("Unexpected member project sync failure.", error);
  return json({
    error: "Member project sync is temporarily unavailable. The browser copy remains available.",
  }, 503);
}

export async function GET(request: NextRequest) {
  try {
    const member = await account(request);
    requireStorage();
    await enforceLimit(member, "read");
    const [projects, limit] = await Promise.all([
      listMemberProjects(member.identity),
      privateProjectLimit(member),
    ]);
    return json({
      projects,
      limit,
      materialization: "compile-spec-client-side",
    }, 200);
  } catch (error) {
    return responseError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const member = await account(request);
    requireSameOrigin(request);
    requireStorage();
    await enforceLimit(member, "write");
    const input = await body(request);
    requireBodyFields(input, ["project", "expectedRevision"]);
    const expectedRevision = revision(input.expectedRevision, true);
    const draft = projectDraft(input.project);
    const limit = await privateProjectLimit(member);
    const result = await upsertMemberProject(
      member.identity,
      draft,
      expectedRevision,
      undefined,
      limit,
    );
    if (result.status === "conflict") {
      return json({
        code: "PROJECT_REVISION_CONFLICT",
        error: "This project changed in another session. Merge from the returned current revision before retrying.",
        ...(result.current ? { current: result.current } : {}),
      }, 409);
    }
    if (result.status === "limit") {
      return json({
        code: "PROJECT_LIMIT",
        error: `This account can sync up to ${limit} projects. Delete or export one before adding another.`,
      }, 409);
    }
    if (result.status === "too-large") {
      return json({
        code: "PROJECT_STORAGE_LIMIT",
        error: "This account's synced project data is too large. Remove embedded media or export older projects before retrying.",
      }, 413);
    }
    return json({ project: result.project }, result.project.revision === 1 ? 201 : 200);
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const member = await account(request);
    requireSameOrigin(request);
    requireStorage();
    await enforceLimit(member, "write");
    const input = await body(request);
    requireBodyFields(input, ["id", "expectedRevision"]);
    const id = projectId(input.id);
    const expectedRevision = revision(input.expectedRevision, false);
    const result = await deleteMemberProject(
      member.identity,
      id,
      expectedRevision,
    );
    if (result.status === "not-found") {
      return json({ error: "Synced project not found." }, 404);
    }
    if (result.status === "conflict") {
      return json({
        code: "PROJECT_REVISION_CONFLICT",
        error: "This project changed in another session. Confirm the current revision before deleting it.",
        current: result.current,
      }, 409);
    }
    return new NextResponse(null, {
      status: 204,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return responseError(error);
  }
}
