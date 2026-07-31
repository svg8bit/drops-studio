import { assertPrivacySafeTrace } from "./privacy.ts";
import type { AgentRunTrace, AgentV3EvidenceSnapshot, BenchmarkReport } from "./types.ts";

type EvalBlobStorage = Pick<typeof import("@vercel/blob"), "get" | "put" | "list" | "del">;

const TRACE_PREFIX = "drops-studio/agent-intelligence/v2/traces/";
const REPORT_PREFIX = "drops-studio/agent-intelligence/v2/reports/";
const EVIDENCE_PREFIX = "drops-studio/agent-intelligence/v3/evidence/";
const MAX_TRACE_BYTES = 2_000_000;
const MAX_REPORT_BYTES = 4_000_000;
const MAX_EVIDENCE_BYTES = 1_000_000;

declare global {
  var __DROPS_AGENT_EVAL_TRACES__: Map<string, AgentRunTrace> | undefined;
  var __DROPS_AGENT_EVAL_REPORTS__: Map<string, BenchmarkReport> | undefined;
  var __DROPS_AGENT_EVIDENCE_SNAPSHOTS__: Map<string, AgentV3EvidenceSnapshot> | undefined;
}

export interface AgentEvalStore {
  writeTrace(trace: AgentRunTrace): Promise<void>;
  writeReport(report: BenchmarkReport): Promise<void>;
  listTraces(limit?: number): Promise<AgentRunTrace[]>;
  listReports(limit?: number): Promise<BenchmarkReport[]>;
  writeEvidenceSnapshot(snapshot: AgentV3EvidenceSnapshot): Promise<void>;
  listEvidenceSnapshots(limit?: number): Promise<AgentV3EvidenceSnapshot[]>;
  deleteProject(actorHash: string, projectId: string): Promise<void>;
  enforceRetention(now?: Date): Promise<{ deleted: number }>;
}

export class AgentEvalStoreUnavailableError extends Error {
  constructor(message = "Agent evaluation storage is temporarily unavailable.") {
    super(message);
    this.name = "AgentEvalStoreUnavailableError";
  }
}

function localEnabled(): boolean {
  return process.env.DROPS_STUDIO_LOCAL_PROJECT_STORE === "1" && !process.env.VERCEL;
}

function blobConfigured(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && (process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL)),
  );
}

function traceMap(): Map<string, AgentRunTrace> {
  return globalThis.__DROPS_AGENT_EVAL_TRACES__ ??= new Map();
}

function reportMap(): Map<string, BenchmarkReport> {
  return globalThis.__DROPS_AGENT_EVAL_REPORTS__ ??= new Map();
}

function evidenceMap(): Map<string, AgentV3EvidenceSnapshot> {
  return globalThis.__DROPS_AGENT_EVIDENCE_SNAPSHOTS__ ??= new Map();
}

function safeSegment(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(value)) throw new Error(`${label} is invalid.`);
  return encodeURIComponent(value);
}

function tracePath(trace: Pick<AgentRunTrace, "actorHash" | "projectId" | "traceId">): string {
  if (!/^[a-f0-9]{64}$/.test(trace.actorHash)) throw new Error("Trace actor hash is invalid.");
  return `${TRACE_PREFIX}${trace.actorHash}/${safeSegment(trace.projectId, "Trace project id")}/${safeSegment(trace.traceId, "Trace id")}.json`;
}

function reportPath(reportId: string): string {
  return `${REPORT_PREFIX}${safeSegment(reportId, "Benchmark report id")}.json`;
}

function evidencePath(snapshotId: string): string {
  return `${EVIDENCE_PREFIX}${safeSegment(snapshotId, "Evidence snapshot id")}.json`;
}

function serialized(value: unknown, maxBytes: number, label: string): string {
  const raw = JSON.stringify(value);
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error(`${label} exceeds its storage limit.`);
  return raw;
}

function retentionDays(): number {
  const value = Number(process.env.DROPS_AGENT_TRACE_RETENTION_DAYS ?? 30);
  return Number.isSafeInteger(value) && value >= 1 && value <= 365 ? value : 30;
}

async function blobClient(override?: EvalBlobStorage): Promise<EvalBlobStorage> {
  return override ?? import("@vercel/blob");
}

async function readPrivateJson<T>(storage: EvalBlobStorage, path: string, maxBytes: number): Promise<T | null> {
  const result = await storage.get(path, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  if (Number(result.blob.size ?? 0) > maxBytes) return null;
  const raw = await new Response(result.stream).text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return null;
  return JSON.parse(raw) as T;
}

export class DefaultAgentEvalStore implements AgentEvalStore {
  readonly #storage?: EvalBlobStorage;

  constructor(options: { storage?: EvalBlobStorage } = {}) {
    this.#storage = options.storage;
  }

  async #durable(): Promise<EvalBlobStorage> {
    if (!this.#storage && !blobConfigured()) throw new AgentEvalStoreUnavailableError();
    return blobClient(this.#storage);
  }

  async writeTrace(trace: AgentRunTrace): Promise<void> {
    assertPrivacySafeTrace(trace);
    const path = tracePath(trace);
    if (!this.#storage && localEnabled()) {
      traceMap().set(path, structuredClone(trace));
      return;
    }
    try {
      await (await this.#durable()).put(path, serialized(trace, MAX_TRACE_BYTES, "Agent trace"), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
    } catch (error) {
      if (error instanceof AgentEvalStoreUnavailableError) throw error;
      throw new AgentEvalStoreUnavailableError();
    }
  }

  async writeReport(report: BenchmarkReport): Promise<void> {
    assertPrivacySafeTrace(report);
    const path = reportPath(report.reportId);
    if (!this.#storage && localEnabled()) {
      reportMap().set(path, structuredClone(report));
      return;
    }
    try {
      await (await this.#durable()).put(path, serialized(report, MAX_REPORT_BYTES, "Benchmark report"), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
    } catch (error) {
      if (error instanceof AgentEvalStoreUnavailableError) throw error;
      throw new AgentEvalStoreUnavailableError();
    }
  }

  async listTraces(limit = 100): Promise<AgentRunTrace[]> {
    const bounded = Math.min(Math.max(1, limit), 500);
    if (!this.#storage && localEnabled()) {
      return [...traceMap().values()]
        .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
        .slice(0, bounded)
        .map((entry) => structuredClone(entry));
    }
    try {
      const storage = await this.#durable();
      const page = await storage.list({ prefix: TRACE_PREFIX, limit: bounded });
      const values = await Promise.all(page.blobs.map((blob) => readPrivateJson<AgentRunTrace>(storage, blob.pathname, MAX_TRACE_BYTES)));
      return values.filter((value): value is AgentRunTrace => Boolean(value?.schemaVersion === 2))
        .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
    } catch (error) {
      if (error instanceof AgentEvalStoreUnavailableError) throw error;
      throw new AgentEvalStoreUnavailableError();
    }
  }

  async listReports(limit = 50): Promise<BenchmarkReport[]> {
    const bounded = Math.min(Math.max(1, limit), 100);
    if (!this.#storage && localEnabled()) {
      return [...reportMap().values()]
        .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
        .slice(0, bounded)
        .map((entry) => structuredClone(entry));
    }
    try {
      const storage = await this.#durable();
      const page = await storage.list({ prefix: REPORT_PREFIX, limit: bounded });
      const values = await Promise.all(page.blobs.map((blob) => readPrivateJson<BenchmarkReport>(storage, blob.pathname, MAX_REPORT_BYTES)));
      return values.filter((value): value is BenchmarkReport => Boolean(value?.schemaVersion === 1))
        .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
    } catch (error) {
      if (error instanceof AgentEvalStoreUnavailableError) throw error;
      throw new AgentEvalStoreUnavailableError();
    }
  }

  async writeEvidenceSnapshot(snapshot: AgentV3EvidenceSnapshot): Promise<void> {
    assertPrivacySafeTrace(snapshot);
    if (!/^[a-f0-9]{64}$/.test(snapshot.snapshotId)) {
      throw new Error("Evidence snapshot id must be a 64-character lowercase hexadecimal digest.");
    }
    const path = evidencePath(snapshot.snapshotId);
    if (!this.#storage && localEnabled()) {
      if (evidenceMap().has(path)) throw new Error("Evidence snapshot already exists.");
      evidenceMap().set(path, structuredClone(snapshot));
      return;
    }
    try {
      await (await this.#durable()).put(path, serialized(snapshot, MAX_EVIDENCE_BYTES, "Agent evidence snapshot"), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
      });
    } catch (error) {
      if (error instanceof AgentEvalStoreUnavailableError) throw error;
      throw new AgentEvalStoreUnavailableError();
    }
  }

  async listEvidenceSnapshots(limit = 10): Promise<AgentV3EvidenceSnapshot[]> {
    const bounded = Math.min(Math.max(1, limit), 50);
    if (!this.#storage && localEnabled()) {
      return [...evidenceMap().values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, bounded)
        .map((entry) => structuredClone(entry));
    }
    try {
      const storage = await this.#durable();
      const page = await storage.list({ prefix: EVIDENCE_PREFIX, limit: bounded });
      const values = await Promise.all(page.blobs.map((blob) =>
        readPrivateJson<AgentV3EvidenceSnapshot>(storage, blob.pathname, MAX_EVIDENCE_BYTES)));
      return values.filter((value): value is AgentV3EvidenceSnapshot => Boolean(
        value?.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(value.snapshotId),
      )).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    } catch (error) {
      if (error instanceof AgentEvalStoreUnavailableError) throw error;
      throw new AgentEvalStoreUnavailableError();
    }
  }

  async deleteProject(actorHash: string, projectId: string): Promise<void> {
    const prefix = `${TRACE_PREFIX}${actorHash}/${safeSegment(projectId, "Trace project id")}/`;
    if (!this.#storage && localEnabled()) {
      for (const path of traceMap().keys()) if (path.startsWith(prefix)) traceMap().delete(path);
      return;
    }
    const storage = await this.#durable();
    const page = await storage.list({ prefix, limit: 1_000 });
    if (page.blobs.length) await storage.del(page.blobs.map((blob) => blob.pathname));
  }

  async enforceRetention(now = new Date()): Promise<{ deleted: number }> {
    const cutoff = now.getTime() - retentionDays() * 24 * 60 * 60_000;
    if (!this.#storage && localEnabled()) {
      let deleted = 0;
      for (const [path, trace] of traceMap()) {
        if (Date.parse(trace.finishedAt) < cutoff) {
          traceMap().delete(path);
          deleted += 1;
        }
      }
      return { deleted };
    }
    const storage = await this.#durable();
    const page = await storage.list({ prefix: TRACE_PREFIX, limit: 1_000 });
    const expired = page.blobs.filter((blob) => new Date(blob.uploadedAt).getTime() < cutoff).map((blob) => blob.pathname);
    if (expired.length) await storage.del(expired);
    return { deleted: expired.length };
  }
}
