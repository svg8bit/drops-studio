"use client";

import {
  Blocks,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileSearch,
  GitMerge,
  Palette,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UsersRound,
  Waves,
  Wrench,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AGENT_V3_DASHBOARD_CONTRACT } from "@/lib/agent/evals/dashboard-types";
import type { AgentRunTrace } from "@/lib/agent/evals/types";

import styles from "./project-v2-agent-intelligence.module.css";

export interface ProjectV2AgentIntelligenceProps {
  trace?: AgentRunTrace | null;
}

function duration(value: number): string {
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function verdictVariant(verdict: AgentRunTrace["verification"]["verdict"]): "default" | "destructive" | "outline" {
  if (verdict === "PASS") return "default";
  if (verdict === "PASS_WITH_SETUP_REQUIRED") return "outline";
  return "destructive";
}

export function ProjectV2AgentIntelligence({ trace }: ProjectV2AgentIntelligenceProps) {
  return (
    <div className={styles.layout}>
      <section className={styles.systemHero}>
        <div className={styles.systemHeading}>
          <div><Sparkles aria-hidden="true" /><span><small>Agent system V3</small><strong>Evidence before automation</strong></span></div>
          <Badge variant="outline">Candidate · default unchanged</Badge>
        </div>
        <p>Deterministic streaming, compact role prompts, repair data, and visual verification are registered separately from run-specific model and Sandbox proof.</p>
        <div className={styles.systemRail}>
          <article><Blocks aria-hidden="true" /><span><strong>{AGENT_V3_DASHBOARD_CONTRACT.promptRoles} roles · {AGENT_V3_DASHBOARD_CONTRACT.runtimeSkills} skills</strong><small>Compact core is feature-gated</small></span></article>
          <article><Waves aria-hidden="true" /><span><strong>{AGENT_V3_DASHBOARD_CONTRACT.stabilizerFixers} shadow fixers</strong><small>No canonical file mutation</small></span></article>
          <article><ScanSearch aria-hidden="true" /><span><strong>{AGENT_V3_DASHBOARD_CONTRACT.benchmarkCases} benchmark cases</strong><small>Repository fixtures, not live runs</small></span></article>
          <article><Palette aria-hidden="true" /><span><strong>Design Agent + Verifier</strong><small>Read-only at 1440 / 1024 / 390</small></span></article>
        </div>
      </section>

      {!trace ? (
        <section className={`${styles.card} ${styles.traceEmpty}`}>
          <BrainCircuit aria-hidden="true" />
          <div><h2>No real run evidence attached</h2><p>Start a Project V2 agent build to attach routing, retrieval, role, AutoFix, Sandbox, browser, and Verifier receipts. Static registry evidence above is never substituted for execution.</p></div>
          <Button render={<Link href="/internal/agent-evals" />} variant="outline">
            <ExternalLink aria-hidden="true" />Open eval control room
          </Button>
        </section>
      ) : (
        <>
          <section className={styles.summary}>
            <div className={styles.heading}>
              <div><BrainCircuit aria-hidden="true" /><span><small>Attached real run</small><strong>Run {trace.runId.slice(0, 12)}</strong></span></div>
              <Badge variant={verdictVariant(trace.verification.verdict)}>{trace.verification.verdict}</Badge>
            </div>
            <p>{trace.promptSummary}</p>
            <div className={styles.stats}>
              <span><Clock3 aria-hidden="true" />{duration(trace.usage.totalLatencyMs)}</span>
              <span><Wrench aria-hidden="true" />{trace.repairs.length} repairs</span>
              <span><GitMerge aria-hidden="true" />revision {trace.projectRevisionStart} → {trace.projectRevisionFinal}</span>
              <span><ShieldCheck aria-hidden="true" />{trace.verification.deterministicGatePassed ? "gate passed" : "gate blocked"}</span>
            </div>
          </section>

          <section className={styles.card}>
            <header><Route aria-hidden="true" /><div><small>Composite routing</small><strong>Authorized role models</strong></div></header>
            {trace.routes.length ? <ol className={styles.timeline}>{trace.routes.map((route) => (
              <li key={route.routeId}>
                <span>{route.role}</span>
                <strong>{route.model}</strong>
                <small>{route.provider} · {route.policy}{route.fallback ? " · disclosed fallback" : ""}</small>
              </li>
            ))}</ol> : <p className={styles.missing}>This run used the explicit deterministic fallback and made no model routing claim.</p>}
          </section>

          <section className={styles.card}>
            <header><FileSearch aria-hidden="true" /><div><small>Context Compiler</small><strong>Retrieved provenance</strong></div></header>
            {trace.contextPackages.length ? <div className={styles.packageList}>{trace.contextPackages.map((entry) => (
              <article key={entry.packageId}>
                <div><Badge variant="outline">{entry.retrievalMode}</Badge><span>{entry.estimatedTokens} tokens</span></div>
                <strong>{entry.chunkIds.length} selected chunks</strong>
                <small>{entry.sourceIds.slice(0, 4).join(" · ") || "No source ids"}</small>
              </article>
            ))}</div> : <p className={styles.missing}>No compiled context package was recorded.</p>}
          </section>

          <section className={styles.card}>
            <header><UsersRound aria-hidden="true" /><div><small>Parallel roles</small><strong>Real task timeline</strong></div></header>
            {trace.roleRuns.length ? <ol className={styles.timeline}>{trace.roleRuns.map((role) => (
              <li key={role.roleRunId}>
                <span>{role.role}</span>
                <strong>{role.status}</strong>
                <small>{role.writeScopes.length ? role.writeScopes.join(" · ") : "read-only"}</small>
              </li>
            ))}</ol> : <p className={styles.missing}>No delegated role run was executed; the UI does not invent parallel agents.</p>}
          </section>

          <section className={`${styles.card} ${styles.wide}`}>
            <header><CheckCircle2 aria-hidden="true" /><div><small>Release authority</small><strong>Checks and findings</strong></div></header>
            {trace.checks.length ? (
              <div className={styles.checkGrid}>
                {trace.checks.map((check) => (
                  <article key={check.checkId} data-status={check.status}>
                    {check.status === "passed" ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
                    <span><strong>{check.name}</strong><small>{check.status} · {duration(check.durationMs)}</small></span>
                  </article>
                ))}
              </div>
            ) : <p className={styles.missing}>No deterministic check receipts were recorded; this run cannot be presented as release-ready.</p>}
            {trace.findings.length ? <ul className={styles.findings}>{trace.findings.map((finding) => (
              <li key={finding.findingId}><Badge variant={finding.blocksVerification ? "destructive" : "outline"}>{finding.severity}</Badge><span><strong>{finding.title}</strong><small>{finding.category}</small></span></li>
            ))}</ul> : <p className={styles.missing}>No structured QA, Security, Verifier, or release-gate findings.</p>}
            <Button render={<Link href="/internal/agent-evals" />} variant="outline">
              <ExternalLink aria-hidden="true" />Open full eval dashboard
            </Button>
          </section>
        </>
      )}
    </div>
  );
}
