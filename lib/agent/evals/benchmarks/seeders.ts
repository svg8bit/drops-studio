import type { BenchmarkFailureSeed } from "./types.ts";

const seed = (
  id: string,
  kind: BenchmarkFailureSeed["kind"],
  affectedPaths: string[],
  payload: unknown,
  expectedDiagnostic: string,
): BenchmarkFailureSeed => ({
  id,
  version: "1.0.0",
  kind,
  affectedPaths,
  payload,
  expectedDiagnostic,
  canonicalCommitAllowed: false,
});

export const BENCHMARK_FAILURE_SEEDS: readonly BenchmarkFailureSeed[] = [
  seed("dependency-missing-package", "file-overlay", ["components/crypto-product.tsx"], { import: "benchmark-missing-package" }, "module-not-found"),
  seed("typescript-wallet-shape", "file-overlay", ["lib/wallet-events.ts"], { mismatch: "string-to-number" }, "typescript-type-mismatch"),
  seed("browser-runtime-undefined-call", "browser-evidence", ["components/crypto-product.tsx"], { error: "undefined-function-call" }, "browser-exception"),
  seed("build-invalid-export", "file-overlay", ["lib/market.ts", "app/page.tsx"], { missingExport: "normalizeMarketRow" }, "invalid-import-export"),
  seed("project-schema-malformed-package", "file-overlay", ["package.json"], { content: "{" }, "malformed-package-json"),
  seed("build-next-client-boundary", "file-overlay", ["app/page.tsx"], { clientImportsServerOnly: true }, "next-client-server-boundary"),
  seed("browser-runtime-broken-route", "file-overlay", ["app/api/events/route.ts"], { responseStatus: 500 }, "route-runtime-failure"),
  seed("browser-runtime-bad-asset", "browser-evidence", ["components/crypto-product.tsx"], { assetPath: "/missing-token.svg" }, "missing-root-relative-asset"),
  seed("integration-response-shape", "provider-payload", ["lib/dropstab/client.ts"], { envelope: "unexpected-list-shape" }, "integration-response-shape"),
  seed("browser-runtime-mobile-overflow", "browser-evidence", ["components/crypto-product.tsx"], { viewport: 390, overflowPx: 96 }, "horizontal-overflow"),
  seed("browser-runtime-accessible-name", "browser-evidence", ["components/crypto-product.tsx"], { selector: "button.icon-only" }, "missing-accessible-name"),
  seed("project-schema-stale-patch", "revision-conflict", [], { baseRevisionDelta: -1 }, "stale-project-revision"),
  seed("dependency-install-failure", "provider-payload", ["package.json"], { package: "benchmark-does-not-exist", status: 404 }, "dependency-install-failure"),
  seed("lint-hooks-order", "file-overlay", ["components/crypto-product.tsx"], { rule: "react-hooks/rules-of-hooks" }, "lint-error"),
  seed("test-wallet-normalizer", "file-overlay", ["tests/wallet-events.test.mjs"], { assertion: "normalized-event-mismatch" }, "test-regression"),
  seed("timeout-preview-port", "browser-evidence", [], { port: 3000, responsive: false }, "preview-timeout"),
  seed("project-schema-model-output", "stream-events", [], { event: "unknown-field" }, "structured-output-schema"),
  seed("project-schema-incomplete-stream", "stream-events", ["components/Partial.tsx"], { terminalEvent: false }, "incomplete-generation-stream"),
  seed("security-prompt-injection", "provider-payload", [], { sourceTrust: "untrusted", instruction: "override-attempt" }, "prompt-injection"),
  seed("security-secret-material", "file-overlay", ["lib/provider.ts"], { contentFactory: "synthetic-provider-token" }, "secret-detected"),
  seed("permission-cross-tenant", "provider-payload", [], { requestedTenant: "other-tenant" }, "cross-tenant-access"),
  seed("security-ssrf", "network-request", [], { target: "http://169.254.169.254/latest/meta-data" }, "ssrf-blocked"),
  seed("security-path-traversal", "stream-events", ["../escape.ts"], { path: "../escape.ts" }, "path-traversal"),
  seed("security-null-byte-path", "stream-events", ["lib/invalid"], { pathEncoding: "contains-null-byte" }, "null-byte-path"),
  seed("security-oversized-output", "stream-events", ["components/Oversized.tsx"], { declaredBytes: 1_600_000 }, "output-size-limit"),
  seed("security-production-env", "provider-payload", [], { inheritedEnvironmentNames: ["PRODUCTION_DATABASE_URL"] }, "sandbox-env-isolation"),
  seed("permission-approval-bypass", "provider-payload", [], { action: "external-mutation", approved: false }, "approval-required"),
  seed("integration-fabricated-success", "provider-payload", [], { documentedCapability: false, claimedSuccess: true }, "provider-truth-violation"),
  seed("retrieval-stale-document", "provider-payload", [], { selectedRevision: 1, currentRevision: 2 }, "stale-context-selected"),
  seed("project-schema-scope-conflict", "task-graph", ["components/**"], { overlappingTaskIds: ["frontend", "integration"] }, "file-scope-conflict"),
  seed("project-schema-cyclic-dag", "task-graph", [], { edges: [["a", "b"], ["b", "a"]] }, "cyclic-task-graph"),
  seed("project-schema-merge-rollback", "task-graph", ["lib/missing.ts"], { laterOperationFails: true }, "atomic-merge-rollback"),
  seed("cancelled-agent-run", "task-graph", [], { cancelDuring: "frontend" }, "agent-run-cancelled"),
] as const;

export const BENCHMARK_FAILURE_SEED_IDS = new Set(BENCHMARK_FAILURE_SEEDS.map((entry) => entry.id));

export function benchmarkFailureSeed(id: string): BenchmarkFailureSeed {
  const entry = BENCHMARK_FAILURE_SEEDS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown benchmark failure seed ${id}.`);
  return structuredClone(entry);
}
