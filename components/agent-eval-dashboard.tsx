"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Blocks,
  Bot,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  FlaskConical,
  GitBranch,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Palette,
  Play,
  RefreshCw,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AGENT_V3_DASHBOARD_CONTRACT,
  type AgentV3PlatformEvidence,
} from "@/lib/agent/evals/dashboard-types";
import type { AgentEvalSummary, BenchmarkReport } from "@/lib/agent/evals/types";

import styles from "./agent-eval-dashboard.module.css";

interface SummaryPayload {
  summary?: AgentEvalSummary;
  platform?: AgentV3PlatformEvidence;
  storage?: "private";
  error?: string;
}

interface RunPayload {
  report?: BenchmarkReport;
  executionMode?: "offline-contract-fixture";
  error?: string;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function duration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function cost(value: number): string {
  return value > 0 ? `$${value.toFixed(value < 0.01 ? 4 : 2)}` : "$0.00";
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
    : "—";
}

export function AgentEvalDashboard() {
  const [secret, setSecret] = useState("");
  const [summary, setSummary] = useState<AgentEvalSummary | null>(null);
  const [platform, setPlatform] = useState<AgentV3PlatformEvidence | null>(null);
  const [busy, setBusy] = useState<"load" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-drops-evals-secret": secret,
        ...init?.headers,
      },
      cache: "no-store",
    });
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Internal evaluation request failed.");
    return payload;
  }, [secret]);

  const loadSummary = useCallback(async () => {
    if (!secret.trim()) {
      setError("Enter the configured internal access secret.");
      return;
    }
    setBusy("load");
    setError(null);
    try {
      const payload = await request<SummaryPayload>("/api/internal/agent-evals/summary");
      setSummary(payload.summary ?? null);
      setPlatform(payload.platform ?? null);
    } catch (requestError) {
      setSummary(null);
      setPlatform(null);
      setError(requestError instanceof Error ? requestError.message : "Internal evaluation evidence is unavailable.");
    } finally {
      setBusy(null);
    }
  }, [request, secret]);

  const submit = useCallback((event: FormEvent) => {
    event.preventDefault();
    void loadSummary();
  }, [loadSummary]);

  const runContractBenchmark = useCallback(async () => {
    setBusy("run");
    setError(null);
    try {
      const result = await request<RunPayload>("/api/internal/agent-evals/run", {
        method: "POST",
        body: JSON.stringify({ suite: "local-fast" }),
      });
      if (result.executionMode !== "offline-contract-fixture") {
        throw new Error("The benchmark did not return its execution mode.");
      }
      await loadSummary();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The contract benchmark failed.");
      setBusy(null);
    }
  }, [loadSummary, request]);

  const registry = platform?.registry;
  const systemCards = [
    {
      title: "Compact operating core",
      metric: `${registry?.promptRoles ?? AGENT_V3_DASHBOARD_CONTRACT.promptRoles} roles · ${registry?.runtimeSkills ?? AGENT_V3_DASHBOARD_CONTRACT.runtimeSkills} skills`,
      detail: registry?.compactCore.available
        ? `${registry.compactCore.estimatedTokens ?? "—"} estimated tokens · ${registry.compactCore.enabledForRequest ? "enabled for this runtime" : "feature-gated candidate"}`
        : "Repository contract registered; production default unchanged.",
      state: registry?.compactCore.enabledForRequest ? "Request-enabled" : "Candidate",
      icon: Layers3,
    },
    {
      title: "Streaming Stabilizer",
      metric: `${registry?.stabilizerFixers ?? AGENT_V3_DASHBOARD_CONTRACT.stabilizerFixers} deterministic fixers`,
      detail: "Shadow proposals are recorded without mutating canonical project files.",
      state: `${registry?.stabilizerDefaultMode ?? "shadow"} mode`,
      icon: Wrench,
    },
    {
      title: "Canonical benchmark corpus",
      metric: `${registry?.benchmarkCases ?? AGENT_V3_DASHBOARD_CONTRACT.benchmarkCases} cases · ${registry ? Object.keys(registry.benchmarkDistribution).length : AGENT_V3_DASHBOARD_CONTRACT.benchmarkSlices} slices`,
      detail: "Repository-owned deterministic fixtures; live model runs are reported separately.",
      state: "Registered",
      icon: FlaskConical,
    },
    {
      title: "Repair evidence dataset",
      metric: `${registry?.acceptedRepairRecords ?? AGENT_V3_DASHBOARD_CONTRACT.syntheticRepairRecords} accepted records`,
      detail: `${registry?.repairFailureClasses ?? 12} source-level failure classes · synthetic fixtures · build/browser not applicable.`,
      state: "Synthetic",
      icon: GitBranch,
    },
    {
      title: "Design verification",
      metric: "Design Agent + Visual Verifier",
      detail: `${registry?.design.requiredViewports.length ?? AGENT_V3_DASHBOARD_CONTRACT.requiredDesignViewports} required viewports · verifier remains read-only.`,
      state: "Evidence-bound",
      icon: Palette,
    },
  ];

  const latestTrace = summary?.latestTraces[0] ?? null;
  const latestReport = summary?.latestReports[0] ?? null;
  const metrics = useMemo(() => summary ? [
    { label: "Working preview", value: percent(summary.workingPreviewRate), detail: "stored browser + primary interaction evidence", icon: CheckCircle2 },
    { label: "First-pass preview", value: percent(summary.firstPassPreviewRate), detail: "before AutoFix", icon: Activity },
    { label: "Average repairs", value: summary.averageRepairs.toFixed(2), detail: "stored real traces only", icon: RefreshCw },
    { label: "Average latency", value: duration(summary.averageLatencyMs), detail: `recorded model estimate ${cost(summary.estimatedModelCostUsd)}`, icon: Clock3 },
  ] : [], [summary]);
  const gateBlockers = platform?.dataGate.blockers ?? [
    "Load private evidence to evaluate the immutable V2 baseline.",
    "Authorized live model matrix evidence is not loaded.",
    "Failure-cluster and Design Agent reports are not loaded.",
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <Link href="/" className={styles.backLink}><ArrowLeft aria-hidden="true" /><span className={styles.brandMark}>D</span>Drops Studio</Link>
          <div className={styles.headerBadges}><Badge variant="secondary">Internal</Badge><Badge variant="outline">V3 candidate</Badge></div>
        </div>
        <div className={styles.headingRow}>
          <div>
            <p className={styles.eyebrow}><Sparkles aria-hidden="true" />Agent system evidence</p>
            <h1>Quality control for every build.</h1>
            <p>One truthful view of the deterministic core, model runs, repair evidence, design verification, and the data gate protecting production defaults.</p>
          </div>
          <aside className={styles.heroReceipt} aria-label="Promotion state">
            <span><ShieldCheck aria-hidden="true" />Promotion gate</span>
            <strong>{platform?.dataGate.passed ? "Eligible for candidate review" : "Blocked by evidence"}</strong>
            <small>Production default unchanged</small>
          </aside>
        </div>
      </header>

      <section className={styles.systemMap} aria-labelledby="system-map-title">
        <div className={styles.sectionHeading}>
          <div><Blocks aria-hidden="true" /><span><small>V3 architecture</small><h2 id="system-map-title">Registered system map</h2></span></div>
          <Badge variant={platform ? "secondary" : "outline"}>{platform ? "Registry validated" : "Repository contract"}</Badge>
        </div>
        <div className={styles.systemGrid}>
          {systemCards.map(({ title, metric, detail, state, icon: Icon }, index) => (
            <article key={title} className={styles.systemCard}>
              <div className={styles.systemCardTop}><span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span><Icon aria-hidden="true" /></div>
              <h3>{title}</h3>
              <strong>{metric}</strong>
              <p>{detail}</p>
              <Badge variant="outline">{state}</Badge>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.controlGrid}>
        <section className={styles.accessPanel} aria-labelledby="eval-access-title">
          <div>
            <h2 id="eval-access-title"><LockKeyhole aria-hidden="true" />Private execution evidence</h2>
            <p>The access value stays in page memory and is sent only to the internal API. Traces exclude source, credentials, and private reasoning.</p>
          </div>
          <form className={styles.accessForm} onSubmit={submit}>
            <label htmlFor="eval-access-secret">Internal access secret</label>
            <div>
              <Input
                id="eval-access-secret"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="Configured server-side"
              />
              <Button type="submit" disabled={busy !== null}>
                {busy === "load" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                Load evidence
              </Button>
            </div>
          </form>
        </section>

        <section className={styles.gatePanel} aria-labelledby="data-gate-title">
          <div className={styles.panelHeading}>
            <div><ScanSearch aria-hidden="true" /><h2 id="data-gate-title">Data gate</h2></div>
            <Badge variant={platform?.dataGate.passed ? "default" : "destructive"}>{platform?.dataGate.passed ? "Passed" : "Blocked"}</Badge>
          </div>
          <ul className={styles.gateList}>
            {gateBlockers.length ? gateBlockers.map((blocker) => <li key={blocker}><AlertTriangle aria-hidden="true" /><span>{blocker}</span></li>) : <li className={styles.gateClear}><CheckCircle2 aria-hidden="true" /><span>All required evidence is recorded for candidate review.</span></li>}
          </ul>
        </section>
      </div>

      {error ? <div className={styles.error} role="alert"><AlertTriangle aria-hidden="true" />{error}</div> : null}

      {!summary ? (
        <section className={styles.emptyState}>
          <div className={styles.emptyVisual}><DatabaseZap aria-hidden="true" /><Bot aria-hidden="true" /></div>
          <div><h2>Stored runs stay private</h2><p>Authenticate to inspect real model routes, Sandbox checks, browser receipts, costs, and failures. Repository fixtures above are labeled separately and never presented as live activity.</p></div>
        </section>
      ) : (
        <>
          <section className={styles.metrics} aria-label="Stored agent evaluation metrics">
            {metrics.map(({ label, value, detail, icon: Icon }) => (
              <article key={label} className={styles.metricCard}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </article>
            ))}
          </section>

          <div className={styles.grid}>
            <section className={styles.panel} aria-labelledby="latest-run-title">
              <div className={styles.panelHeading}>
                <div><Route aria-hidden="true" /><h2 id="latest-run-title">Latest stored run</h2></div>
                {latestTrace ? <Badge variant={latestTrace.verification.verdict.startsWith("PASS") ? "default" : "destructive"}>{latestTrace.verification.verdict}</Badge> : <Badge variant="outline">No trace</Badge>}
              </div>
              {latestTrace ? (
                <div className={styles.runDetail}>
                  <div className={styles.runMeta}><strong>{latestTrace.promptSummary}</strong><span>{displayDate(latestTrace.finishedAt)} · revision {latestTrace.projectRevisionStart} → {latestTrace.projectRevisionFinal}</span></div>
                  <dl>
                    <div><dt>Routes</dt><dd>{latestTrace.routes.map((entry) => `${entry.role}: ${entry.model}`).join(" · ") || "Deterministic fallback"}</dd></div>
                    <div><dt>Context</dt><dd>{latestTrace.contextPackages.map((entry) => `${entry.retrievalMode} · ${entry.chunkIds.length} chunks`).join(" · ") || "No context package recorded"}</dd></div>
                    <div><dt>Roles</dt><dd>{latestTrace.roleRuns.map((entry) => `${entry.role} ${entry.status}`).join(" · ") || "No delegated role runs"}</dd></div>
                    <div><dt>Evidence</dt><dd>{latestTrace.checks.filter((entry) => entry.status === "passed").map((entry) => entry.name).join(" · ") || "No passing check evidence"}</dd></div>
                  </dl>
                  <div className={styles.runStats}>
                    <span>{latestTrace.repairs.length} repairs</span>
                    <span>{duration(latestTrace.usage.totalLatencyMs)}</span>
                    <span>{cost(latestTrace.usage.estimatedModelCostUsd)}</span>
                  </div>
                </div>
              ) : <p className={styles.panelEmpty}>No stored real run trace yet. No sample activity is substituted.</p>}
            </section>

            <section className={styles.panel} aria-labelledby="benchmark-title">
              <div className={styles.panelHeading}>
                <div><FlaskConical aria-hidden="true" /><h2 id="benchmark-title">Offline routing comparison</h2></div>
                <Button variant="outline" onClick={() => void runContractBenchmark()} disabled={busy !== null}>
                  {busy === "run" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Play aria-hidden="true" />}
                  Run contract fixtures
                </Button>
              </div>
              <p className={styles.disclosure}>This runs the labeled local-fast contract slice. It does not call live models or prove a Sandbox preview.</p>
              {latestReport ? (
                <div className={styles.tableWrap}>
                  <table>
                    <caption>Latest {latestReport.suite} report, {latestReport.cases.length} configuration cases</caption>
                    <thead><tr><th>Configuration</th><th>Success</th><th>First pass</th><th>Repairs</th><th>Cost</th></tr></thead>
                    <tbody>{latestReport.configurations.map((entry) => (
                      <tr key={entry.id}>
                        <th scope="row">{entry.label}</th>
                        <td>{percent(entry.successRate)}</td>
                        <td>{percent(entry.firstPassRate)}</td>
                        <td>{entry.averageRepairCount.toFixed(2)}</td>
                        <td>{cost(entry.totalEstimatedCostUsd)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className={styles.panelEmpty}>No benchmark report stored.</p>}
            </section>
          </div>

          <section className={styles.panel} aria-labelledby="failure-title">
            <div className={styles.panelHeading}>
              <div><Workflow aria-hidden="true" /><h2 id="failure-title">Observed failure taxonomy</h2></div>
              <span>{summary.traces} traces · {summary.reports} reports</span>
            </div>
            {summary.failureClasses.length ? <ul className={styles.failureList}>{summary.failureClasses.map((entry) => (
              <li key={entry.failureClass}><span>{entry.failureClass}</span><strong>{entry.count}</strong></li>
            ))}</ul> : <p className={styles.panelEmpty}>No classified failures in stored traces.</p>}
          </section>
        </>
      )}
    </main>
  );
}
