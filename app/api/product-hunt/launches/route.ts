import { NextRequest, NextResponse } from "next/server.js";

import {
  DuplicateProductHuntLaunchError,
  insertProductHuntLaunch,
  listProductHuntLaunches,
  ProductHuntCapacityError,
  ProductHuntStorageUnavailableError,
} from "../../../../db/product-hunt.ts";
import { getPublishedProject } from "../../../../db/projects.ts";
import {
  hashProductHuntSession,
  isSameOriginMutation,
  normalizeProductUrl,
  parseProductHuntSubmission,
  productHuntActorEvidence,
  productHuntSlug,
  ProductHuntValidationError,
  resolveProductHuntSession,
  type ProductHuntSort,
  type ProductHuntSourceEvidence,
  withProductHuntSession,
} from "../../../../lib/product-hunt-community.ts";
import { consumeProductHuntRequestLimit } from "../../../../lib/product-hunt-rate-limit.ts";
import { requestIdentity } from "../../../../lib/request-rate-limit.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_SUBMISSION_BYTES = 16_384;

async function readSubmissionBody(request: NextRequest): Promise<{ tooLarge: boolean; value: unknown }> {
  if (!request.body) return { tooLarge: false, value: null };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SUBMISSION_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true, value: null };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { tooLarge: false, value: JSON.parse(text) as unknown };
  } catch {
    return { tooLarge: false, value: null };
  }
}

function storageFailure(
  error: unknown,
  session: ReturnType<typeof resolveProductHuntSession>,
): NextResponse {
  if (error instanceof ProductHuntValidationError) {
    return withProductHuntSession(NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 }), session);
  }
  if (error instanceof DuplicateProductHuntLaunchError) {
    return withProductHuntSession(NextResponse.json({ error: error.message }, { status: 409 }), session);
  }
  if (error instanceof ProductHuntCapacityError || error instanceof ProductHuntStorageUnavailableError) {
    return withProductHuntSession(NextResponse.json({ error: error.message }, { status: 503, headers: { "retry-after": "60" } }), session);
  }
  return withProductHuntSession(NextResponse.json({ error: "The community launch store could not complete this request." }, {
    status: 503,
    headers: { "retry-after": "60" },
  }), session);
}

function requestLimitIdentity(request: NextRequest, sessionId: string): string {
  return requestIdentity(request) ?? `session:${sessionId}`;
}

export async function GET(request: NextRequest) {
  const session = resolveProductHuntSession(request);
  const sortValue = request.nextUrl.searchParams.get("sort") ?? "top";
  const limitValue = request.nextUrl.searchParams.get("limit") ?? "24";
  if (sortValue !== "top" && sortValue !== "new") {
    return withProductHuntSession(NextResponse.json({ error: "Sort must be top or new." }, { status: 400 }), session);
  }
  if (!/^\d{1,2}$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 50) {
    return withProductHuntSession(NextResponse.json({ error: "Limit must be an integer from 1 to 50." }, { status: 400 }), session);
  }

  const limit = await consumeProductHuntRequestLimit({
    identity: requestLimitIdentity(request, session.id),
    namespace: "product-hunt-list",
    max: 240,
    windowMs: 10 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return withProductHuntSession(NextResponse.json({ error: "Too many community feed requests. Try again shortly." }, {
      status: 429,
      headers: { "retry-after": "600" },
    }), session);
  }
  if (limit === "unavailable") {
    return withProductHuntSession(NextResponse.json({ error: "The protected community feed is temporarily unavailable." }, {
      status: 503,
      headers: { "retry-after": "60" },
    }), session);
  }

  try {
    const viewerHash = await hashProductHuntSession(session.id);
    const result = await listProductHuntLaunches({
      sort: sortValue as ProductHuntSort,
      limit: Number(limitValue),
      viewerHash,
    });
    return withProductHuntSession(NextResponse.json({
      launches: result.launches,
      total: result.total,
      sort: sortValue,
      actor: productHuntActorEvidence(),
      providerEvidence: {
        storage: result.storage,
        listings: "community-submitted",
        moderation: "unreviewed",
      },
    }), session);
  } catch (error) {
    return storageFailure(error, session);
  }
}

export async function POST(request: NextRequest) {
  const session = resolveProductHuntSession(request);
  if (!isSameOriginMutation(request)) {
    return withProductHuntSession(NextResponse.json({ error: "Cross-site community submissions are not accepted." }, { status: 403 }), session);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return withProductHuntSession(NextResponse.json({ error: "Send the launch as application/json." }, { status: 415 }), session);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_SUBMISSION_BYTES) {
    return withProductHuntSession(NextResponse.json({ error: "The launch submission is too large." }, { status: 413 }), session);
  }
  const body = await readSubmissionBody(request);
  if (body.tooLarge) {
    return withProductHuntSession(NextResponse.json({ error: "The launch submission is too large." }, { status: 413 }), session);
  }

  const limit = await consumeProductHuntRequestLimit({
    identity: requestLimitIdentity(request, session.id),
    namespace: "product-hunt-submit",
    max: 3,
    windowMs: 24 * 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return withProductHuntSession(NextResponse.json({ error: "This browser or network reached the daily launch submission limit." }, {
      status: 429,
      headers: { "retry-after": "86400" },
    }), session);
  }
  if (limit === "unavailable") {
    return withProductHuntSession(NextResponse.json({ error: "Protected community submissions are temporarily unavailable." }, {
      status: 503,
      headers: { "retry-after": "60" },
    }), session);
  }

  try {
    const submission = parseProductHuntSubmission(body.value);
    let sourceEvidence: ProductHuntSourceEvidence = "community-url-unverified";
    if (submission.dropsStudioSlug) {
      let expectedUrl: URL;
      let submittedUrl: URL;
      try {
        expectedUrl = new URL(`/p/${submission.dropsStudioSlug}`, request.nextUrl.origin);
        submittedUrl = new URL(normalizeProductUrl(submission.url));
      } catch (error) {
        if (error instanceof ProductHuntValidationError) throw error;
        throw new ProductHuntValidationError("Enter a valid Drops Studio project URL and slug.", {
          url: ["The product URL or Drops Studio project slug is invalid."],
        });
      }
      if (submittedUrl.origin !== expectedUrl.origin || submittedUrl.pathname !== expectedUrl.pathname) {
        throw new ProductHuntValidationError("The URL does not match the submitted Drops Studio project slug.", {
          url: [`Use ${expectedUrl.toString()} for this Drops Studio project.`],
        });
      }
      const published = await getPublishedProject(submission.dropsStudioSlug);
      if (!published) {
        throw new ProductHuntValidationError("Publish the Drops Studio project before listing it.", {
          dropsStudioSlug: ["No published Drops Studio artifact was found for this slug."],
        });
      }
      sourceEvidence = "verified-drops-studio-publish";
    }

    const id = crypto.randomUUID();
    const result = await insertProductHuntLaunch({
      id,
      slug: productHuntSlug(submission.name, id),
      submission,
      submitterHash: await hashProductHuntSession(session.id),
      createdAt: new Date().toISOString(),
      sourceEvidence,
    });
    return withProductHuntSession(NextResponse.json({
      launch: result.launch,
      actor: productHuntActorEvidence(),
      providerEvidence: {
        storage: result.storage,
        destination: result.launch.evidence.destination,
        moderation: "unreviewed",
      },
    }, { status: 201 }), session);
  } catch (error) {
    return storageFailure(error, session);
  }
}
