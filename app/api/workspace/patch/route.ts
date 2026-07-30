import { NextRequest, NextResponse } from "next/server.js";
import {
  applyWorkspaceAiPatch,
  assertRunnableWorkspaceAiRevision,
  parseWorkspaceAiPatchRequest,
  WorkspaceAiPatchConflictError,
  WorkspaceAiPatchValidationError,
  type WorkspaceAiPatchRequest,
} from "@/lib/workspace-ai-patch";
import {
  generateWorkspaceAiPatch,
  WorkspaceAiProviderResponseError,
  WorkspaceAiProviderUnavailableError,
  type GeneratedWorkspaceAiPatch,
  type WorkspaceAiProviderCredentials,
} from "@/lib/workspace-ai-provider";
import {
  reserveWorkspacePlatformQuota,
  WorkspaceAiQuotaLimitError,
  WorkspaceAiQuotaUnavailableError,
  type WorkspaceAiQuotaReservation,
} from "@/lib/workspace-ai-entitlement";
import {
  consumeRequestLimit,
  requestIdentity,
  type RequestLimitStatus,
} from "@/lib/request-rate-limit";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "@/lib/http-request-boundary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_750_000;
const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" };

type GenerateWorkspacePatch = (
  request: WorkspaceAiPatchRequest,
  credentials: WorkspaceAiProviderCredentials,
) => Promise<GeneratedWorkspaceAiPatch>;

type ConsumeWorkspacePatchLimit = (input: {
  identity: string | null;
  namespace: string;
  max: number;
  windowMs: number;
}) => Promise<RequestLimitStatus>;

export interface WorkspaceAiPatchRouteDependencies {
  generate?: GenerateWorkspacePatch;
  consumeLimit?: ConsumeWorkspacePatchLimit;
  reservePlatformQuota?: (
    request: NextRequest,
  ) => Promise<WorkspaceAiQuotaReservation>;
  now?: () => Date;
}

function json(
  payload: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(payload, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
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

function headerCredential(request: NextRequest, name: string): string | undefined {
  const value = request.headers.get(name)?.trim() ?? "";
  return value || undefined;
}

function directCredentialError(
  request: WorkspaceAiPatchRequest,
  credentials: WorkspaceAiProviderCredentials,
): string | null {
  if (request.provider === "openrouter" && !credentials.openRouterKey) {
    return "Connect OpenRouter with a request-only API key before generating workspace files.";
  }
  if (
    ["openai", "anthropic", "kimi"].includes(request.provider) &&
    !credentials.providerKey
  ) {
    return `Connect ${request.provider} with a request-only API key before generating workspace files.`;
  }
  return null;
}

export async function handleWorkspaceAiPatchRequest(
  request: NextRequest,
  dependencies: WorkspaceAiPatchRouteDependencies = {},
) {
  if (!sameOrigin(request)) {
    return json(
      {
        error: "Cross-origin AI workspace generation is not allowed.",
        code: "WORKSPACE_AI_CROSS_ORIGIN",
      },
      403,
    );
  }
  if (!hasJsonMediaType(request)) {
    return json(
      {
        error: "AI workspace generation requires application/json.",
        code: "WORKSPACE_AI_CONTENT_TYPE",
      },
      415,
    );
  }

  const identity = requestIdentity(request);
  const localProofStore =
    process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" &&
    !process.env.VERCEL;
  const consumeLimit = dependencies.consumeLimit ?? consumeRequestLimit;
  const limit = await consumeLimit({
    identity,
    namespace: "workspace-ai-patch",
    max: localProofStore ? 200 : 12,
    windowMs: 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return json(
      {
        error: "Too many AI workspace requests. Try again later.",
        code: "WORKSPACE_AI_RATE_LIMIT",
      },
      429,
      { "retry-after": "3600" },
    );
  }
  if (limit === "unavailable") {
    return json(
      {
        error:
          "Secure AI workspace request identity and rate limiting are unavailable.",
        code: "WORKSPACE_AI_RATE_LIMIT_UNAVAILABLE",
      },
      503,
    );
  }

  const body = await requestBody(request);
  if (body.status === "too-large") {
    return json(
      {
        error: "The bounded workspace AI request exceeds 1.75 MB.",
        code: "WORKSPACE_AI_BODY_TOO_LARGE",
      },
      413,
    );
  }
  if (body.status === "invalid") {
    return json(
      {
        error: "A bounded workspace AI request is required.",
        code: "WORKSPACE_AI_INVALID_REQUEST",
      },
      400,
    );
  }

  let parsed: WorkspaceAiPatchRequest;
  try {
    parsed = parseWorkspaceAiPatchRequest(body.value);
  } catch (error) {
    if (error instanceof WorkspaceAiPatchConflictError) {
      return json(
        {
          error: error.message,
          code: "WORKSPACE_REVISION_CONFLICT",
          expectedRevision: error.expectedRevision,
          receivedRevision: error.receivedRevision,
        },
        409,
      );
    }
    return json(
      {
        error: "A bounded workspace AI request is required.",
        code: "WORKSPACE_AI_INVALID_REQUEST",
      },
      400,
    );
  }

  const credentials: WorkspaceAiProviderCredentials = {
    identity: identity ?? undefined,
    openRouterKey: headerCredential(request, "x-openrouter-key"),
    providerKey: headerCredential(request, "x-provider-key"),
  };
  const connectionError = directCredentialError(parsed, credentials);
  if (connectionError) {
    return json(
      { error: connectionError, code: "WORKSPACE_AI_CONNECTION_REQUIRED" },
      400,
    );
  }

  let baseline: ReturnType<typeof assertRunnableWorkspaceAiRevision>;
  try {
    baseline = assertRunnableWorkspaceAiRevision(parsed.workspace);
  } catch {
    return json(
      {
        error: "The current workspace must pass canonical validation before AI editing.",
        code: "WORKSPACE_AI_INVALID_BASE",
      },
      400,
    );
  }

  let quota: WorkspaceAiQuotaReservation | null = null;
  if (parsed.provider === "platform") {
    try {
      quota = await (
        dependencies.reservePlatformQuota ?? reserveWorkspacePlatformQuota
      )(request);
      credentials.identity = quota.identity;
    } catch (error) {
      if (error instanceof WorkspaceAiQuotaLimitError) {
        return json(
          {
            error: "Platform AI daily allowance reached.",
            code: "WORKSPACE_AI_DAILY_LIMIT",
            tier: error.tier,
            limit: error.limit,
            remaining: 0,
            connect: "openrouter",
          },
          429,
          { "retry-after": "86400" },
        );
      }
      if (error instanceof WorkspaceAiQuotaUnavailableError) {
        return json(
          {
            error: "Platform AI entitlement is not configured or unavailable.",
            code: "WORKSPACE_AI_UNAVAILABLE",
          },
          503,
        );
      }
      return json(
        {
          error: "Platform AI entitlement could not be reserved safely.",
          code: "WORKSPACE_AI_UNAVAILABLE",
        },
        503,
      );
    }
  }

  let generated: GeneratedWorkspaceAiPatch;
  try {
    generated = await (dependencies.generate ?? generateWorkspaceAiPatch)(
      parsed,
      credentials,
    );
  } catch (error) {
    if (error instanceof WorkspaceAiProviderUnavailableError) {
      return withQuotaCookies(json(
        {
          error: "AI workspace generation is not configured or unavailable.",
          code: "WORKSPACE_AI_UNAVAILABLE",
        },
        503,
      ), quota);
    }
    if (error instanceof WorkspaceAiProviderResponseError) {
      return withQuotaCookies(json(
        {
          error: "The AI provider could not return a valid workspace patch.",
          code: "WORKSPACE_AI_PROVIDER_FAILURE",
        },
        502,
      ), quota);
    }
    return withQuotaCookies(json(
      {
        error: "AI workspace generation failed safely.",
        code: "WORKSPACE_AI_PROVIDER_FAILURE",
      },
      502,
    ), quota);
  }

  try {
    const applied = applyWorkspaceAiPatch(
      parsed.workspace,
      parsed.baseRevision,
      generated.patch,
      { now: dependencies.now },
    );
    const runnable = assertRunnableWorkspaceAiRevision(applied.workspace);
    if (runnable.spec.presetId !== baseline.spec.presetId) {
      return withQuotaCookies(json(
        {
          error: "An AI workspace patch cannot change the product category.",
          code: "WORKSPACE_AI_CATEGORY_MISMATCH",
        },
        502,
      ), quota);
    }
    return withQuotaCookies(json(
      {
        workspace: applied.workspace,
        spec: runnable.spec,
        change: {
          baseRevision: parsed.baseRevision,
          revision: applied.workspace.revision,
          summary: applied.patch.summary,
          created: applied.appliedOperations.created,
          updated: applied.appliedOperations.updated,
          deleted: applied.appliedOperations.deleted,
        },
        providerEvidence: generated.evidence,
        quota: quota
          ? {
              tier: quota.tier,
              limit: quota.limit,
              used: quota.used,
              remaining: quota.remaining,
              reset: quota.reset,
            }
          : null,
        validation: {
          status: "canonical-compiled",
          compiledRuntimeBytes: new TextEncoder().encode(runnable.runtimeHtml)
            .byteLength,
          persisted: false,
        },
      },
      200,
    ), quota);
  } catch (error) {
    if (error instanceof WorkspaceAiPatchConflictError) {
      return withQuotaCookies(json(
        {
          error: error.message,
          code: "WORKSPACE_REVISION_CONFLICT",
          expectedRevision: error.expectedRevision,
          receivedRevision: error.receivedRevision,
        },
        409,
      ), quota);
    }
    if (error instanceof WorkspaceAiPatchValidationError || error instanceof Error) {
      return withQuotaCookies(json(
        {
          error:
            "The generated workspace revision failed canonical validation.",
          code: "WORKSPACE_AI_INVALID_REVISION",
        },
        502,
      ), quota);
    }
    return withQuotaCookies(json(
      {
        error: "The generated workspace revision failed safely.",
        code: "WORKSPACE_AI_INVALID_REVISION",
      },
      502,
    ), quota);
  }
}

export async function POST(request: NextRequest) {
  return handleWorkspaceAiPatchRequest(request);
}
