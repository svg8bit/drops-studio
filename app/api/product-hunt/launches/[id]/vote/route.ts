import { NextRequest, NextResponse } from "next/server.js";

import {
  ProductHuntCapacityError,
  ProductHuntLaunchNotFoundError,
  ProductHuntStorageUnavailableError,
  voteForProductHuntLaunch,
} from "../../../../../../db/product-hunt.ts";
import {
  hashProductHuntSession,
  isSameOriginMutation,
  productHuntActorEvidence,
  resolveProductHuntSession,
  withProductHuntSession,
} from "../../../../../../lib/product-hunt-community.ts";
import { consumeProductHuntRequestLimit } from "../../../../../../lib/product-hunt-rate-limit.ts";
import { requestIdentity } from "../../../../../../lib/request-rate-limit.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = resolveProductHuntSession(request);
  if (!isSameOriginMutation(request)) {
    return withProductHuntSession(NextResponse.json({ error: "Cross-site votes are not accepted." }, { status: 403 }), session);
  }
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    return withProductHuntSession(NextResponse.json({ error: "Invalid community launch id." }, { status: 400 }), session);
  }

  const identity = requestIdentity(request) ?? `session:${session.id}`;
  const limit = await consumeProductHuntRequestLimit({
    identity,
    namespace: "product-hunt-vote",
    max: 60,
    windowMs: 60 * 60 * 1_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return withProductHuntSession(NextResponse.json({ error: "This browser or network reached the hourly vote request limit." }, {
      status: 429,
      headers: { "retry-after": "3600" },
    }), session);
  }
  if (limit === "unavailable") {
    return withProductHuntSession(NextResponse.json({ error: "Protected community voting is temporarily unavailable." }, {
      status: 503,
      headers: { "retry-after": "60" },
    }), session);
  }

  try {
    const result = await voteForProductHuntLaunch({
      launchId: id,
      voterHash: await hashProductHuntSession(session.id),
      createdAt: new Date().toISOString(),
    });
    return withProductHuntSession(NextResponse.json({
      accepted: result.accepted,
      duplicate: !result.accepted,
      votes: result.votes,
      viewerHasVoted: true,
      actor: productHuntActorEvidence(),
      providerEvidence: {
        storage: result.storage,
        vote: result.accepted ? "browser-session-receipt-created" : "existing-browser-session-receipt",
      },
    }, { status: result.accepted ? 201 : 200 }), session);
  } catch (error) {
    if (error instanceof ProductHuntLaunchNotFoundError) {
      return withProductHuntSession(NextResponse.json({ error: error.message }, { status: 404 }), session);
    }
    if (error instanceof ProductHuntCapacityError || error instanceof ProductHuntStorageUnavailableError) {
      return withProductHuntSession(NextResponse.json({ error: error.message }, {
        status: 503,
        headers: { "retry-after": "60" },
      }), session);
    }
    return withProductHuntSession(NextResponse.json({ error: "The community vote could not be recorded." }, {
      status: 503,
      headers: { "retry-after": "60" },
    }), session);
  }
}
