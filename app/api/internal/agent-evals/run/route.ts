import { NextRequest, NextResponse } from "next/server.js";
import { z } from "zod";
import {
  agentEvalsAccessConfigured,
  activateAgentV3Evidence,
  authorizeAgentEvals,
  benchmarkCasesForSuite,
  DEFAULT_BENCHMARK_CONFIGURATIONS,
  DefaultAgentEvalStore,
  executeOfflineContractBenchmark,
  runAgentBenchmark,
} from "../../../../../lib/agent/evals/index.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const inputSchema = z.object({
  suite: z.enum(["local-fast", "ci", "nightly", "release"]).default("local-fast"),
  activateEvidence: z.boolean().default(false),
}).strict();

export interface AgentEvalRunRouteDependencies {
  store?: DefaultAgentEvalStore;
  env?: NodeJS.ProcessEnv;
  execute?: typeof executeOfflineContractBenchmark;
  activate?: typeof activateAgentV3Evidence;
}

export async function handleAgentEvalRun(
  request: NextRequest,
  dependencies: AgentEvalRunRouteDependencies = {},
) {
  const env = dependencies.env ?? process.env;
  if (!agentEvalsAccessConfigured(env)) {
    return NextResponse.json({ code: "EVALS_NOT_CONFIGURED", error: "Internal agent evaluations are not configured." }, { status: 503 });
  }
  if (!authorizeAgentEvals(request.headers, env)) {
    return NextResponse.json({ code: "EVALS_UNAUTHORIZED", error: "Internal evaluation access is required." }, { status: 401 });
  }
  let input: z.infer<typeof inputSchema>;
  try {
    const raw = await request.text();
    if (raw.length > 4_096) throw new Error("too large");
    input = inputSchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return NextResponse.json({ code: "EVALS_INVALID_REQUEST", error: "A valid bounded evaluation request is required." }, { status: 400 });
  }
  const suite = input.activateEvidence ? "release" : input.suite;
  if ((suite === "nightly" && env.DROPS_EVALS_NIGHTLY_ENABLED !== "1") || (suite === "release" && env.NODE_ENV !== "production" && env.DROPS_EVALS_NIGHTLY_ENABLED !== "1")) {
    return NextResponse.json({ code: "EVALS_SUITE_DISABLED", error: `${suite} evaluations are disabled.` }, { status: 409 });
  }
  try {
    const store = dependencies.store ?? new DefaultAgentEvalStore();
    const report = await runAgentBenchmark({
      suite,
      cases: benchmarkCasesForSuite(suite),
      configurations: DEFAULT_BENCHMARK_CONFIGURATIONS,
      execute: dependencies.execute ?? executeOfflineContractBenchmark,
      concurrency: input.activateEvidence ? 8 : 3,
    });
    await store.writeReport(report);
    const snapshot = input.activateEvidence
      ? await (dependencies.activate ?? activateAgentV3Evidence)(report)
      : null;
    if (snapshot) await store.writeEvidenceSnapshot(snapshot);
    return NextResponse.json(
      {
        report,
        evidenceActivated: Boolean(snapshot),
        snapshotId: snapshot?.snapshotId ?? null,
        executionMode: snapshot ? "offline-contract-fixture+live-model-matrix" : "offline-contract-fixture",
      },
      { status: report.releaseGate.passed ? 200 : 422, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ code: "EVALS_RUN_FAILED", error: "The evaluation run failed safely." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handleAgentEvalRun(request);
}
