import { NextRequest, NextResponse } from "next/server.js";

import {
  acceptDropsBotWebhookEvent,
  DropsBotWebhookCapacityError,
  DropsBotWebhookStorageUnavailableError,
} from "../../../../../../db/dropsbot-webhooks.ts";
import {
  dropsBotWebhookEventId,
  DropsBotWebhookValidationError,
  hashDropsBotWebhookCapability,
  hashDropsBotWebhookContent,
  parseDropsBotWebhookPayload,
  readDropsBotWebhookBody,
  validDropsBotWebhookCapability,
} from "../../../../../../lib/dropsbot-webhook.ts";
import { hasJsonMediaType } from "../../../../../../lib/http-request-boundary.ts";
import {
  consumeRequestLimit,
  requestIdentity,
} from "../../../../../../lib/request-rate-limit.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "referrer-policy": "no-referrer",
};

function json(payload: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function notFound(): NextResponse {
  return json({ error: "Drops Bot callback not found." }, 404);
}

function validConnectionId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ connectionId: string; capability: string }> },
): Promise<NextResponse> {
  const { connectionId, capability } = await context.params;
  if (!validConnectionId(connectionId) || !validDropsBotWebhookCapability(capability)) {
    return notFound();
  }
  if (!hasJsonMediaType(request)) {
    return json({
      code: "DROPSBOT_WEBHOOK_CONTENT_TYPE",
      error: "Drops Bot callbacks require application/json.",
    }, 415);
  }

  const limit = await consumeRequestLimit({
    identity: `${connectionId}:${requestIdentity(request)}`,
    namespace: "dropsbot-callback",
    max: 120,
    windowMs: 60_000,
  }).catch(() => "unavailable" as const);
  if (limit === "limited") {
    return NextResponse.json({
      code: "DROPSBOT_WEBHOOK_RATE_LIMITED",
      error: "Too many Drops Bot callbacks. Retry after the current rate-limit window.",
    }, {
      status: 429,
      headers: { ...NO_STORE_HEADERS, "retry-after": "60" },
    });
  }
  if (limit === "unavailable") {
    return NextResponse.json({
      code: "DROPSBOT_WEBHOOK_RATE_LIMIT_UNAVAILABLE",
      error: "Drops Bot callback protection is temporarily unavailable.",
    }, {
      status: 503,
      headers: { ...NO_STORE_HEADERS, "retry-after": "60" },
    });
  }

  try {
    const raw = await readDropsBotWebhookBody(request);
    const payload = parseDropsBotWebhookPayload(raw, [capability]);
    const contentHash = hashDropsBotWebhookContent(raw);
    const event = {
      id: dropsBotWebhookEventId(connectionId, contentHash),
      contentHash,
      receivedAt: new Date().toISOString(),
      payload,
    };
    const result = await acceptDropsBotWebhookEvent({
      connectionId,
      capabilityHash: hashDropsBotWebhookCapability(capability),
      event,
    });
    if (result.status === "not-found") return notFound();

    const accepted = result.status === "accepted";
    return json({
      accepted,
      duplicate: !accepted,
      eventId: result.event.id,
      contentHash: result.event.contentHash,
      receivedAt: result.event.receivedAt,
      callbackEvidence: result.callbackEvidence,
    }, accepted ? 202 : 200);
  } catch (error) {
    if (error instanceof DropsBotWebhookValidationError) {
      return json({ code: error.code, error: error.message }, error.status);
    }
    if (error instanceof DropsBotWebhookCapacityError) {
      return NextResponse.json({
        error: "Drops Bot callback storage reached its safe MVP capacity.",
      }, {
        status: 503,
        headers: { ...NO_STORE_HEADERS, "retry-after": "3600" },
      });
    }
    if (error instanceof DropsBotWebhookStorageUnavailableError) {
      return NextResponse.json({
        error: "Drops Bot callback storage is temporarily unavailable.",
      }, {
        status: 503,
        headers: { ...NO_STORE_HEADERS, "retry-after": "60" },
      });
    }
    console.error("Unexpected Drops Bot callback ingestion failure.", error);
    return NextResponse.json({
      error: "Drops Bot callback ingestion is temporarily unavailable.",
    }, {
      status: 503,
      headers: { ...NO_STORE_HEADERS, "retry-after": "60" },
    });
  }
}
