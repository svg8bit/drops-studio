import { NextRequest, NextResponse } from "next/server.js";
import {
  runWorkspaceSandbox,
  validateWorkspaceSandboxRun,
  WorkspaceSandboxProviderError,
  WorkspaceSandboxUnavailableError,
  WorkspaceSandboxValidationError,
} from "@/lib/workspace-sandbox";
import {
  consumeRequestLimit,
  requestIdentity,
} from "@/lib/request-rate-limit";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "@/lib/http-request-boundary";
import {
  reserveWorkspaceExecutionQuota,
  WorkspaceAiQuotaLimitError,
  WorkspaceAiQuotaUnavailableError,
  type WorkspaceAiQuotaReservation,
} from "@/lib/workspace-ai-entitlement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 1_750_000;
const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" };

export interface WorkspaceRunRouteDependencies {
  consumeLimit?: typeof consumeRequestLimit;
  reserveExecutionQuota?: (
    request: NextRequest,
  ) => Promise<WorkspaceAiQuotaReservation>;
  run?: typeof runWorkspaceSandbox;
}

function json(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function withQuotaCookies(
  response: NextResponse,
  quota: WorkspaceAiQuotaReservation | null,
): NextResponse {
  for (const cookie of quota?.cookies ?? []) {
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: cookie.maxAge,
      path: "/",
    });
  }
  return response;
}

function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol =
      request.headers
        .get("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim()
        .replace(/:$/, "") || request.nextUrl.protocol.replace(/:$/, "");
    const visibleOrigin = host ? `${protocol}://${host}` : null;
    return (
      originUrl.origin === request.nextUrl.origin ||
      originUrl.origin === visibleOrigin
    );
  } catch {
    return false;
  }
}

type RequestBodyResult =
  | { status: "ok"; value: unknown }
  | { status: "invalid" }
  | { status: "too-large" };

async function requestBody(request: NextRequest): Promise<RequestBodyResult> {
  let raw: string;
  try {
    raw = decodeUtf8Body(await readBoundedRequestBody(request, MAX_BODY_BYTES));
  } catch (error) {
    return error instanceof RequestBodyBoundaryError && error.reason === "too-large"
      ? { status: "too-large" }
      : { status: "invalid" };
  }
  try {
    return { status: "ok", value: JSON.parse(raw) as unknown };
  } catch {
    return { status: "invalid" };
  }
}

export async function handleWorkspaceRunRequest(
  request: NextRequest,
  dependencies: WorkspaceRunRouteDependencies = {},
) {
  if (!sameOrigin(request)) {
    return json(
      { error: "Cross-origin workspace execution is not allowed." },
      403,
    );
  }
  if (!hasJsonMediaType(request)) {
    return json(
      { error: "Workspace execution requires application/json." },
      415,
    );
  }

  const localProofStore =
    process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" &&
    !process.env.VERCEL;
  const limit = await (dependencies.consumeLimit ?? consumeRequestLimit)({
    identity: requestIdentity(request),
    namespace: "workspace-sandbox-run",
    max: localProofStore ? 200 : 12,
    windowMs: 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return NextResponse.json(
      { error: "Too many workspace execution requests. Try again later." },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "retry-after": "3600" },
      },
    );
  }
  if (limit === "unavailable") {
    return json(
      {
        error:
          "Secure workspace execution identity and rate limiting are unavailable.",
      },
      503,
    );
  }

  const body = await requestBody(request);
  if (body.status === "too-large") {
    return json(
      {
        code: "WORKSPACE_EXECUTION_BODY_TOO_LARGE",
        error: "The bounded workspace execution request exceeds 1.75 MB.",
      },
      413,
    );
  }
  if (body.status === "invalid") {
    return json(
      {
        code: "WORKSPACE_EXECUTION_INVALID_REQUEST",
        error: "A bounded workspace execution request is required.",
      },
      400,
    );
  }

  try {
    validateWorkspaceSandboxRun(body.value);
  } catch (error) {
    if (error instanceof WorkspaceSandboxValidationError) {
      return json({ error: error.message }, 400);
    }
    return json({ error: "A valid bounded workspace execution request is required." }, 400);
  }

  let quota: WorkspaceAiQuotaReservation;
  try {
    quota = await (
      dependencies.reserveExecutionQuota ?? reserveWorkspaceExecutionQuota
    )(request);
  } catch (error) {
    if (error instanceof WorkspaceAiQuotaLimitError) {
      return NextResponse.json({
        code: "WORKSPACE_EXECUTION_DAILY_LIMIT",
        error: "Workspace execution daily allowance reached.",
        tier: error.tier,
        limit: error.limit,
        remaining: 0,
      }, {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "retry-after": "86400" },
      });
    }
    if (error instanceof WorkspaceAiQuotaUnavailableError) {
      return json({
        code: "WORKSPACE_EXECUTION_UNAVAILABLE",
        error: "Funded workspace execution entitlement is not configured or unavailable.",
      }, 503);
    }
    return json({
      code: "WORKSPACE_EXECUTION_UNAVAILABLE",
      error: "Funded workspace execution entitlement could not be reserved safely.",
    }, 503);
  }

  try {
    const receipt = await (dependencies.run ?? runWorkspaceSandbox)(body.value);
    return withQuotaCookies(json({
      receipt,
      quota: {
        purpose: "execution",
        tier: quota.tier,
        limit: quota.limit,
        used: quota.used,
        remaining: quota.remaining,
        reset: quota.reset,
      },
    }, 200), quota);
  } catch (error) {
    if (error instanceof WorkspaceSandboxValidationError) {
      return withQuotaCookies(json({ error: error.message }, 400), quota);
    }
    if (error instanceof WorkspaceSandboxUnavailableError) {
      return withQuotaCookies(json(
        {
          error: "Workspace sandbox execution is not configured or unavailable.",
        },
        503,
      ), quota);
    }
    if (error instanceof WorkspaceSandboxProviderError) {
      return withQuotaCookies(json(
        { error: "Workspace sandbox provider could not complete this task." },
        502,
      ), quota);
    }
    return withQuotaCookies(json(
      { error: "Workspace sandbox execution failed safely." },
      502,
    ), quota);
  }
}

export async function POST(request: NextRequest) {
  return handleWorkspaceRunRequest(request);
}
