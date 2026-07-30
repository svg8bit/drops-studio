"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentEvalSummary, BenchmarkReport } from "@/lib/agent/evals/types";

import styles from "./agent-eval-dashboard.module.css";

interface SummaryPayload {
  summary?: AgentEvalSummary;
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
    } catch (requestError) {
      setSummary(null);
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

  const latestTrace = summary?.latestTraces[0] ?? null;
  const latestReport = summary?.latestReports[0] ?? null;
  const metrics = useMemo(() => summary ? [
    { label: "Working preview", value: percent(summary.workingPreviewRate), detail: "browser + primary interaction", icon: CheckCircle2 },
    { label: "First-pass preview", value: percent(summary.firstPassPreviewRate), detail: "before AutoFix", icon: Activity },
    { label: "Average repairs", value: summary.averageRepairs.toFixed(2), detail: "maximum three", icon: RefreshCw },
    { label: "Average latency", value: duration(summary.averageLatencyMs), detail: `model estimate ${cost(summary.estimatedModelCostUsd)}`, icon: Clock3 },
  ] : [], [summary]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <Link href="/" className={styles.backLink}><ArrowLeft aria-hidden="true" />Drops Studio</Link>
          <Badge variant="secondary">Internal</Badge>
        </div>
        <div className={styles.headingRow}>
          <div>
            <p className={styles.eyebrow}>Agent Intelligence v2</p>
            <h1>Evaluation control room</h1>
            <p>Real run traces, routing, retrieval, parallel-role evidence, verifier outcomes, quality, latency, and cost.</p>
          </div>
          <ShieldCheck className={styles.heroIcon} aria-hidden="true" />
        </div>
      </header>

      <section className={styles.accessPanel} aria-labelledby="eval-access-title">
        <div>
          <h2 id="eval-access-title"><LockKeyhole aria-hidden="true" />Private evidence</h2>
          <p>The access value stays in this page memory and is sent only to the internal API. Traces exclude source, credentials, and private reasoning.</p>
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

      {error ? <div className={styles.error} role="alert"><AlertTriangle aria-hidden="true" />{error}</div> : null}

      {!summary ? (
        <section className={styles.emptyState}>
          <DatabaseZap aria-hidden="true" />
          <h2>No evidence loaded</h2>
          <p>Authenticate to inspect private traces. The dashboard never substitutes sample runs for stored execution evidence.</p>
        </section>
      ) : (
        <>
          <section className={styles.metrics} aria-label="Agent evaluation metrics">
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
                <div><Route aria-hidden="true" /><h2 id="latest-run-title">Latest real run</h2></div>
                {latestTrace ? <Badge variant={latestTrace.verification.verdict.startsWith("PASS") ? "default" : "destructive"}>{latestTrace.verification.verdict}</Badge> : null}
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
              ) : <p className={styles.panelEmpty}>No stored real run trace yet.</p>}
            </section>

            <section className={styles.panel} aria-labelledby="benchmark-title">
              <div className={styles.panelHeading}>
                <div><FlaskConical aria-hidden="true" /><h2 id="benchmark-title">Routing comparison</h2></div>
                <Button variant="outline" onClick={() => void runContractBenchmark()} disabled={busy !== null}>
                  {busy === "run" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : <Play aria-hidden="true" />}
                  Run contract fixtures
                </Button>
              </div>
              <p className={styles.disclosure}>This button runs the labeled offline contract suite. Live Sandbox runs appear separately as real traces.</p>
              {latestReport ? (
                <div className={styles.tableWrap}>
                  <table>
                    <caption>Latest {latestReport.suite} benchmark, {latestReport.cases.length} configuration cases</caption>
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
              <div><Workflow aria-hidden="true" /><h2 id="failure-title">Failure taxonomy</h2></div>
              <span>{summary.traces} traces · {summary.reports} reports</span>
            </div>
            {summary.failureClasses.length ? <ul className={styles.failureList}>{summary.failureClasses.map((entry) => (
              <li key={entry.failureClass}><span>{entry.failureClass}</span><strong>{entry.count}</strong></li>
            ))}</ul> : <p className={styles.panelEmpty}>No classified failures.</p>}
          </section>
        </>
      )}
    </main>
  );
}
