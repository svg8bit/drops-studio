import { NextRequest, NextResponse } from "next/server.js";
import {
  aggregateAgentEvals,
  agentEvalsAccessConfigured,
  authorizeAgentEvals,
  DefaultAgentEvalStore,
} from "../../../../../lib/agent/evals/index.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export interface AgentEvalSummaryRouteDependencies {
  store?: DefaultAgentEvalStore;
  env?: NodeJS.ProcessEnv;
}

export async function handleAgentEvalSummary(
  request: NextRequest,
  dependencies: AgentEvalSummaryRouteDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  if (!agentEvalsAccessConfigured(env)) {
    return NextResponse.json({ code: "EVALS_NOT_CONFIGURED", error: "Internal agent evaluations are not configured." }, { status: 503 });
  }
  if (!authorizeAgentEvals(request.headers, env)) {
    return NextResponse.json({ code: "EVALS_UNAUTHORIZED", error: "Internal evaluation access is required." }, { status: 401 });
  }
  try {
    const store = dependencies.store ?? new DefaultAgentEvalStore();
    const [traces, reports] = await Promise.all([store.listTraces(100), store.listReports(20)]);
    return NextResponse.json(
      { summary: aggregateAgentEvals(traces, reports), storage: "private" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ code: "EVALS_STORAGE_UNAVAILABLE", error: "Internal evaluation evidence is temporarily unavailable." }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  return handleAgentEvalSummary(request);
}
