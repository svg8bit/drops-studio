import { NextRequest, NextResponse } from "next/server.js";
import { readProjectV2Snapshot } from "@/db/project-v2-snapshots";
import {
  GUEST_IDENTITY_COOKIE,
  resolveStudioProjectActor,
  STUDIO_ACCOUNT_COOKIE,
  type StudioProjectActor,
} from "@/lib/access-tier";
import {
  githubIntegrationReadiness,
  GitHubIntegrationError,
  importGitHubRepository,
  inspectGitHubRepository,
  publishProjectToGitHub,
  type GitHubIntegrationCredentials,
} from "@/lib/github-integration";
import {
  decodeUtf8Body,
  hasJsonMediaType,
  readBoundedRequestBody,
  RequestBodyBoundaryError,
} from "@/lib/http-request-boundary";
import { secretFreeRuntimeMessage } from "@/lib/project-runtime-adapter";
import { consumeRequestLimit } from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY_BYTES = 3_300_000;
const NO_STORE = { "cache-control": "no-store, max-age=0" };

function json(payload: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, { status, headers: { ...NO_STORE, ...headers } });
}

function sameOrigin(request: NextRequest): boolean {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const host = request.headers.get("host")?.split(",")[0]?.trim();
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "")
      || request.nextUrl.protocol.replace(/:$/, "");
    const visible = host ? `${protocol}://${host}` : request.nextUrl.origin;
    const parsed = new URL(origin).origin;
    return parsed === request.nextUrl.origin || parsed === visible;
  } catch {
    return false;
  }
}

async function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const raw = decodeUtf8Body(await readBoundedRequestBody(request, MAX_BODY_BYTES));
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyBoundaryError && error.reason === "too-large") {
      throw new GitHubIntegrationError("The GitHub request exceeds 3.3 MB.", 413, "GITHUB_REQUEST_TOO_LARGE");
    }
    throw new GitHubIntegrationError("A valid JSON GitHub request is required.", 400, "GITHUB_REQUEST_INVALID");
  }
}

function headerCredential(request: NextRequest, name: string): string | undefined {
  const value = request.headers.get(name)?.trim() ?? "";
  return value && value.length <= 512 && !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}

function actor(request: NextRequest): StudioProjectActor {
  const resolved = resolveStudioProjectActor({
    accountCookie: request.cookies.get(STUDIO_ACCOUNT_COOKIE)?.value,
    guestCookie: request.cookies.get(GUEST_IDENTITY_COOKIE)?.value,
  });
  if (!resolved) {
    throw new GitHubIntegrationError(
      "Start a signed Studio session before using GitHub integration.",
      401,
      "GITHUB_SESSION_REQUIRED",
    );
  }
  return resolved;
}

function allowedPlatformRepository(owner: string, repo: string): boolean {
  const target = `${owner}/${repo}`.toLowerCase();
  return (process.env.GITHUB_APP_ALLOWED_REPOSITORIES ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === target);
}

function credentials(
  request: NextRequest,
  projectActor: StudioProjectActor,
  owner: string,
  repo: string,
): GitHubIntegrationCredentials {
  const accessToken = headerCredential(request, "x-github-access-token");
  if (accessToken) return { accessToken };
  if (projectActor.kind !== "member" || !allowedPlatformRepository(owner, repo)) {
    throw new GitHubIntegrationError(
      "Connect a session-only GitHub token for this repository.",
      403,
      "GITHUB_CONNECTION_REQUIRED",
    );
  }
  return {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
  };
}

function text(input: Record<string, unknown>, key: string): string {
  return typeof input[key] === "string" ? input[key] as string : "";
}

function studioProjectId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value)) {
    throw new GitHubIntegrationError(
      "A valid Studio Project V2 id is required.",
      400,
      "GITHUB_PROJECT_ID_INVALID",
    );
  }
  return value;
}

export async function GET() {
  return json({
    provider: "github",
    ...githubIntegrationReadiness(),
    sessionTokenSupported: true,
    explicitApprovalRequired: ["branch", "commit", "pull-request"],
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return json({ error: "Cross-origin GitHub requests are not allowed.", code: "GITHUB_CROSS_ORIGIN" }, 403);
  }
  if (!hasJsonMediaType(request)) {
    return json({ error: "GitHub requests require application/json.", code: "GITHUB_CONTENT_TYPE" }, 415);
  }
  try {
    const projectActor = actor(request);
    const limit = await consumeRequestLimit({
      identity: projectActor.identity,
      namespace: "github-project-sync",
      max: process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL ? 100 : 20,
      windowMs: 60 * 60 * 1_000,
    }).catch(() => "unavailable" as const);
    if (limit === "limited") return json({ error: "GitHub request limit reached.", code: "GITHUB_RATE_LIMIT" }, 429, { "retry-after": "3600" });
    if (limit === "unavailable") return json({ error: "Durable GitHub rate limiting is unavailable.", code: "GITHUB_RATE_LIMIT_UNAVAILABLE" }, 503);
    const input = await parseBody(request);
    const action = text(input, "action") || "inspect";
    const owner = text(input, "owner");
    const repo = text(input, "repo");
    const common = {
      credentials: credentials(request, projectActor, owner, repo),
      owner,
      repo,
    };
    if (action === "inspect") {
      return json({ repository: await inspectGitHubRepository(common) });
    }
    if (action === "import") {
      if (input.approved !== true) {
        return json({ error: "Importing repository source requires explicit approval.", code: "GITHUB_APPROVAL_REQUIRED" }, 409);
      }
      return json(await importGitHubRepository({ ...common, branch: text(input, "branch") || undefined }));
    }
    if (action === "publish") {
      if (input.approved !== true) {
        return json({ error: "Creating a branch, commit and pull request requires explicit approval.", code: "GITHUB_APPROVAL_REQUIRED" }, 409);
      }
      const stored = await readProjectV2Snapshot(
        projectActor.identity,
        studioProjectId(input.studioProjectId),
      );
      if (!stored) {
        return json({ error: "The authorized Project V2 snapshot was not found.", code: "GITHUB_PROJECT_NOT_FOUND" }, 404);
      }
      const result = await publishProjectToGitHub({
        ...common,
        files: Object.values(stored.project.files).map((file) => ({
          path: file.path,
          content: file.content,
        })),
        conversationId: text(input, "conversationId"),
        title: stored.project.manifest.name,
        description: text(input, "description") || "Review this generated project before merge.",
        baseBranch: text(input, "baseBranch") || undefined,
      });
      return json({ result, confirmed: true });
    }
    return json({ error: "Unsupported GitHub action.", code: "GITHUB_ACTION_INVALID" }, 400);
  } catch (error) {
    const failure = error instanceof GitHubIntegrationError
      ? error
      : new GitHubIntegrationError("GitHub integration failed.");
    return json({
      error: secretFreeRuntimeMessage(failure, "GitHub integration failed."),
      code: failure.code,
    }, failure.status);
  }
}
