import { NextRequest, NextResponse } from "next/server";
import {
  deletePublishedProject,
  getPublishedProject,
  insertPublishedProject,
  updatePublishedProject,
} from "@/db/projects";
import {
  ArtifactSecretError,
  assertProjectPayloadSafe,
  assertPublishedArtifactSafe,
} from "@/lib/artifact-security";
import {
  createPublishCapability,
  requestPublishCapability,
  resolvePublishCapabilitySecret,
  verifyPublishCapability,
} from "@/lib/publish-capability";
import { compileProject } from "@/lib/project-compiler";
import {
  insertWithUniquePublishSlug,
  PublishSlugAttemptsExhaustedError,
} from "@/lib/publish-lifecycle";
import {
  evaluateServerReleaseQuality,
  stampProviderEvidence,
} from "@/lib/server-release-quality";
import type {
  GeneratedProjectSpec,
  ProjectQualityReport,
  PublishedProjectRecord,
} from "@/lib/project-types";
import { validateProjectSpec } from "@/lib/project-validator";
import { validateEditableRuntimeHtml } from "@/lib/source-workspace";
import {
  consumeRequestLimit,
  requestIdentity,
} from "@/lib/request-rate-limit";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" };
const PUBLISH_REQUEST_BODY_LIMIT_BYTES = 1_250_000;

class PublishResponseError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(
    status: number,
    payload: Record<string, unknown>,
  ) {
    super(String(payload.error || "Publishing failed."));
    this.name = "PublishResponseError";
    this.status = status;
    this.payload = payload;
  }
}

function json(
  payload: Record<string, unknown>,
  init: { status: number; headers?: Record<string, string> },
) {
  return NextResponse.json(payload, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init.headers },
  });
}

function requireMutationRequest(request: NextRequest): void {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") {
    throw new PublishResponseError(403, {
      error: "Cross-origin publishing requests are not allowed.",
    });
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const host = request.headers.get("host")?.split(",")[0]?.trim();
      const protocol = request.headers
        .get("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim()
        .replace(/:$/, "") || request.nextUrl.protocol.replace(/:$/, "");
      const browserVisibleOrigin = host ? `${protocol}://${host}` : null;
      if (
        originUrl.origin !== request.nextUrl.origin
        && originUrl.origin !== browserVisibleOrigin
      ) {
        throw new Error();
      }
    } catch {
      throw new PublishResponseError(403, {
        error: "Cross-origin publishing requests are not allowed.",
      });
    }
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new PublishResponseError(415, {
      error: "Publishing requests require application/json.",
    });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength)
    && declaredLength > PUBLISH_REQUEST_BODY_LIMIT_BYTES
  ) {
    throw new PublishResponseError(413, {
      error: "The publishing request is too large.",
    });
  }
}

async function requestBody(request: NextRequest): Promise<Record<string, unknown>> {
  const raw = await request.text().catch(() => "");
  if (
    new TextEncoder().encode(raw).byteLength
    > PUBLISH_REQUEST_BODY_LIMIT_BYTES
  ) {
    throw new PublishResponseError(413, {
      error: "The publishing request is too large.",
    });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    // The stable validation response below intentionally covers malformed JSON.
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PublishResponseError(400, { error: "A JSON request body is required." });
  }
  return body as Record<string, unknown>;
}

function incomingSpec(value: unknown): GeneratedProjectSpec {
  if (!value) {
    throw new PublishResponseError(400, {
      error: "A validated project spec is required.",
    });
  }
  try {
    assertProjectPayloadSafe(value, "publish request");
    return validateProjectSpec(value);
  } catch (error) {
    const message =
      error instanceof ArtifactSecretError
        ? "Publishing stopped because the project contains credential-like material. Remove it and use the session-only Connections vault."
        : error instanceof Error
          ? error.message
          : "Invalid project specification.";
    throw new PublishResponseError(400, { error: message });
  }
}

function publishedArtifact(options: {
  id: string;
  slug: string;
  createdAt: string;
  origin: string;
  spec: GeneratedProjectSpec;
  htmlOverride?: string;
}): { project: PublishedProjectRecord; quality: ProjectQualityReport } {
  const publishedSpec = validateProjectSpec({
    ...options.spec,
    slug: options.slug,
    dataEndpoint: `${options.origin}/api/public-data`,
  });
  if (options.htmlOverride) {
    const validation = validateEditableRuntimeHtml(
      publishedSpec,
      options.htmlOverride,
    );
    if (!validation.valid) {
      throw new PublishResponseError(422, {
        error: "The edited source did not pass the server release contract.",
        criticalFailures: validation.issues,
      });
    }
  }
  const html = stampProviderEvidence(
    options.htmlOverride ?? compileProject(publishedSpec),
    "unverified",
  );
  assertPublishedArtifactSafe(publishedSpec, html);
  if (new TextEncoder().encode(html).byteLength > 850_000) {
    throw new PublishResponseError(413, {
      error: "This project is too large for instant publishing.",
    });
  }
  const quality = evaluateServerReleaseQuality(
    publishedSpec,
    html,
    "unverified",
  );
  if (!quality.readyToPublish) {
    throw new PublishResponseError(422, {
      error:
        "The server release gate rejected this build. Fix the reported runtime, category, security or truthfulness checks before publishing.",
      criticalFailures: quality.criticalFailures,
      quality,
    });
  }
  return {
    project: {
      id: options.id,
      slug: options.slug,
      title: publishedSpec.name,
      presetId: publishedSpec.presetId,
      spec: publishedSpec,
      html,
      createdAt: options.createdAt,
    },
    quality,
  };
}

async function publishLimit(request: NextRequest): Promise<NextResponse | null> {
  const localProofStore =
    process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" &&
    !process.env.VERCEL;
  const limit = await consumeRequestLimit({
    identity: requestIdentity(request),
    namespace: "project-publish",
    // Parallel browser proofs publish all category-native products against the
    // explicit local-only store. Production keeps the conservative ceiling.
    max: localProofStore ? 200 : 20,
    windowMs: 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return json(
      {
        error:
          "Too many instant publishes. Try again later or export the runnable source now.",
      },
      { status: 429, headers: { "retry-after": "3600" } },
    );
  }
  if (limit === "unavailable") {
    return json(
      {
        error:
          "Secure instant publishing is temporarily unavailable. Your local project and source remain available.",
      },
      { status: 503 },
    );
  }
  return null;
}

function configuredSecret(): string {
  const secret = resolvePublishCapabilitySecret();
  if (!secret) {
    throw new PublishResponseError(503, {
      error:
        "Secure instant publishing is temporarily unavailable. Your local project and source remain available.",
    });
  }
  return secret;
}

function publishedSlug(value: unknown): string {
  const slug = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z0-9-]{4,72}$/.test(slug)) {
    throw new PublishResponseError(400, {
      error: "A valid published project slug is required.",
    });
  }
  return slug;
}

function requireCapability(
  request: NextRequest,
  slug: string,
  secret: string,
): void {
  const capability = requestPublishCapability(request);
  if (!verifyPublishCapability(slug, capability, secret)) {
    throw new PublishResponseError(403, {
      code: "PUBLISH_CAPABILITY_INVALID",
      error:
        "This browser cannot change that public link. Publish a new version to receive a new managed URL.",
    });
  }
}

function routeError(error: unknown): NextResponse {
  if (error instanceof PublishResponseError) {
    return json(error.payload, { status: error.status });
  }
  if (error instanceof ArtifactSecretError) {
    return json(
      {
        error:
          "Publishing stopped because a generated artifact contains credential-like material.",
      },
      { status: 400 },
    );
  }
  if (error instanceof PublishSlugAttemptsExhaustedError) {
    return json(
      {
        error:
          "A unique public URL could not be reserved. Try publishing again.",
      },
      { status: 503 },
    );
  }
  return json(
    {
      error:
        "The project cloud could not publish this build. Your local project and source remain available.",
    },
    { status: 503 },
  );
}

export async function POST(request: NextRequest) {
  try {
    requireMutationRequest(request);
    const limited = await publishLimit(request);
    if (limited) return limited;
    const body = await requestBody(request);
    const spec = incomingSpec(body.spec);
    const htmlOverride =
      typeof body.html === "string" && body.html.trim() ? body.html : undefined;
    const secret = configuredSecret();
    const createdAt = new Date().toISOString();
    let quality: ProjectQualityReport | null = null;
    let capability = "";
    const project = await insertWithUniquePublishSlug({
      baseSlug: spec.slug,
      createEntropy: () =>
        crypto.randomUUID().replaceAll("-", "").slice(0, 24),
      createRecord: (slug) => {
        capability = createPublishCapability(slug, secret);
        const artifact = publishedArtifact({
          id: crypto.randomUUID(),
          slug,
          createdAt,
          origin: request.nextUrl.origin,
          spec,
          htmlOverride,
        });
        quality = artifact.quality;
        return artifact.project;
      },
      insert: insertPublishedProject,
    });
    return json(
      {
        id: project.id,
        slug: project.slug,
        url: `${request.nextUrl.origin}/p/${project.slug}`,
        capability,
        providerEvidence: "unverified",
        quality,
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    requireMutationRequest(request);
    const limited = await publishLimit(request);
    if (limited) return limited;
    const body = await requestBody(request);
    const slug = publishedSlug(body.slug);
    const secret = configuredSecret();
    requireCapability(request, slug, secret);
    const current = await getPublishedProject(slug);
    if (!current) {
      return json({ error: "Published project not found." }, { status: 404 });
    }
    const spec = incomingSpec(body.spec);
    const htmlOverride =
      typeof body.html === "string" && body.html.trim() ? body.html : undefined;
    const artifact = publishedArtifact({
      id: current.id,
      slug,
      createdAt: current.createdAt,
      origin: request.nextUrl.origin,
      spec,
      htmlOverride,
    });
    if (!(await updatePublishedProject(artifact.project))) {
      return json(
        {
          error:
            "The public version changed while this update was publishing. Retry from the latest local project.",
        },
        { status: 409 },
      );
    }
    return json(
      {
        id: current.id,
        slug,
        url: `${request.nextUrl.origin}/p/${slug}`,
        providerEvidence: "unverified",
        quality: artifact.quality,
      },
      { status: 200 },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    requireMutationRequest(request);
    const limited = await publishLimit(request);
    if (limited) return limited;
    const body = await requestBody(request);
    const slug = publishedSlug(body.slug);
    const secret = configuredSecret();
    requireCapability(request, slug, secret);
    if (!(await deletePublishedProject(slug))) {
      return json({ error: "Published project not found." }, { status: 404 });
    }
    return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS });
  } catch (error) {
    return routeError(error);
  }
}
