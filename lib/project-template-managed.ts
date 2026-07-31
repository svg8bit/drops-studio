import type {
  ProjectEnvironmentDefinitionV2,
  ProjectFileLanguageV2,
  ProjectFileRoleV2,
  ProjectIntegrationManifestV2,
} from "./project-v2-types.ts";
import type { GeneratedProjectSpec } from "./project-types.ts";

export interface ManagedProjectTemplateFile {
  path: string;
  content: string;
  language?: ProjectFileLanguageV2;
  role?: ProjectFileRoleV2;
}

export interface ManagedProjectTemplate {
  enabled: boolean;
  capabilities: string[];
  integration?: ProjectIntegrationManifestV2;
  environment: ProjectEnvironmentDefinitionV2[];
  files: ManagedProjectTemplateFile[];
  readme: string;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

function requestedCapabilities(spec: GeneratedProjectSpec): string[] {
  const corpus = JSON.stringify({
    name: spec.name,
    description: spec.description,
    tagline: spec.tagline,
    prompt: spec.prompt,
    experience: spec.experience,
    blueprint: spec.blueprint,
  }).toLowerCase();
  const requested = (pattern: RegExp) => pattern.test(corpus);
  const enabled = spec.presetId === "custom-product"
    || requested(/backend|database|data model|saas|webhook|collaborat|organization|workspace|auth|storage|cron|job|realtime|multi-user/);
  if (!enabled) return [];
  const capabilities = ["data", "schema"];
  if (requested(/auth|login|sign[ -]?in|user|member|organization|workspace|multi-user|collaborat/)) capabilities.push("auth");
  if (requested(/storage|upload|file|asset|image/)) capabilities.push("storage");
  if (requested(/function|server action|api route|workflow|enrich|score|summary/)) capabilities.push("functions");
  if (requested(/job|queue|retry|dead.?letter|background/)) capabilities.push("jobs");
  if (requested(/cron|schedule|daily|hourly|morning/)) capabilities.push("cron");
  if (requested(/webhook|wallet event|drops bot|dropsbot/)) capabilities.push("webhooks");
  if (requested(/realtime|presence|cursor|collaborat|live update/)) capabilities.push("realtime", "collaboration");
  if (requested(/organization|rbac|role|permission|oidc|sso|enterprise|audit|retention/)) capabilities.push("enterprise-policy");
  return [...new Set(capabilities)];
}

const MANAGED_SERVER_SOURCE = `import "server-only";

const DEFAULT_ORIGIN = "https://drops-studio.vercel.app";

function managedOrigin(): string {
  const candidate = process.env.DROPS_MANAGED_API_ORIGIN?.trim() || DEFAULT_ORIGIN;
  const url = new URL(candidate);
  if (url.protocol !== "https:") throw new Error("Managed API origin must use HTTPS.");
  return url.origin;
}

export function managedBackendStatus() {
  return {
    state: process.env.DROPS_MANAGED_PROJECT_CAPABILITY?.trim() ? "configured" : "setup-required",
    mode: process.env.DROPS_MANAGED_PROJECT_CAPABILITY?.trim() ? "server-capability" : "labelled-browser-local-fallback",
  } as const;
}

export async function managedBackendRequest(path: string, init: RequestInit = {}) {
  const capability = process.env.DROPS_MANAGED_PROJECT_CAPABILITY?.trim();
  if (!capability) throw new Error("Managed project capability is not configured.");
  if (!path.startsWith("/") || path.includes("..")) throw new Error("Managed API path is invalid.");
  const origin = managedOrigin();
  const target = new URL(path, origin);
  if (target.origin !== origin) throw new Error("Managed API path escaped its configured origin.");
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer " + capability);
  return fetch(target, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(10_000),
  });
}
`;

const MANAGED_STATUS_ROUTE = `import { NextResponse } from "next/server";

import { managedBackendStatus } from "../../../../lib/drops-managed-server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(managedBackendStatus(), { headers: { "cache-control": "private, no-store" } });
}
`;

const MANAGED_COLLECTION_ROUTE = `import { managedBackendRequest } from "../../../../../lib/drops-managed-server";

export const dynamic = "force-dynamic";

const ALLOWED_COLLECTIONS = new Set(["workflow_items", "wallet_events", "alerts", "comments"]);
const BODY_LIMIT_BYTES = 128 * 1024;

async function collection(params: Promise<{ collection: string }>) {
  const value = (await params).collection;
  if (!ALLOWED_COLLECTIONS.has(value)) throw new Error("Managed collection is not declared by this project.");
  return value;
}

function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).origin === new URL(request.url).origin;
}

async function forward(request: Request, params: Promise<{ collection: string }>, method: "GET" | "POST") {
  try {
    if (method === "POST" && !sameOrigin(request)) return Response.json({ state: "permission-denied" }, { status: 403 });
    const name = await collection(params);
    const body = method === "POST" ? await request.text() : undefined;
    if (body && new TextEncoder().encode(body).byteLength > BODY_LIMIT_BYTES) return Response.json({ state: "quota-exceeded" }, { status: 413 });
    const upstream = await managedBackendRequest("/v1/collections/" + encodeURIComponent(name), {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body,
    });
    const payload = await upstream.text();
    return new Response(payload, {
      status: upstream.status,
      headers: { "cache-control": "private, no-store", "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch {
    return Response.json({ state: "setup-required", message: "Managed backend is not configured; use the labelled browser-local fallback." }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}

export function GET(request: Request, context: { params: Promise<{ collection: string }> }) {
  return forward(request, context.params, "GET");
}

export function POST(request: Request, context: { params: Promise<{ collection: string }> }) {
  return forward(request, context.params, "POST");
}
`;

const MANAGED_COLLECTION_CLIENT = `"use client";

import { useCallback, useEffect, useState } from "react";

export type ManagedCollectionMode = "loading" | "managed" | "browser-local";

interface WorkflowItem { id: string; title: string }

function localKey(collection: string) { return "drops-managed-demo:" + collection; }
function localItems(collection: string): WorkflowItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(localKey(collection)) || "[]");
    return Array.isArray(value) ? value.filter((item): item is WorkflowItem => Boolean(item && typeof item.id === "string" && typeof item.title === "string")).slice(0, 100) : [];
  } catch { return []; }
}

function normalizeRows(payload: unknown): WorkflowItem[] {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(record.rows) ? record.rows : Array.isArray(record.documents) ? record.documents : [];
  return rows.map((row) => {
    const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const data = value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value;
    return { id: String(value._id || value.id || crypto.randomUUID()), title: String(data.title || "Untitled item").slice(0, 160) };
  }).slice(0, 100);
}

export function useManagedCollection(collection: string) {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [mode, setMode] = useState<ManagedCollectionMode>("loading");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/backend/collections/" + encodeURIComponent(collection), { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("managed backend unavailable");
        const rows = normalizeRows(await response.json());
        if (!cancelled) { setItems(rows); setMode("managed"); }
      })
      .catch(() => {
        if (!cancelled) { setItems(localItems(collection)); setMode("browser-local"); }
      });
    return () => { cancelled = true; };
  }, [collection]);

  const addItem = useCallback(async (title: string) => {
    const normalized = title.trim().slice(0, 160);
    if (!normalized) return false;
    if (mode === "loading") throw new Error("Managed backend mode is still loading.");
    if (mode === "managed") {
      const response = await fetch("/api/backend/collections/" + encodeURIComponent(collection), {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { title: normalized, done: false } }),
      }).catch(() => null);
      if (response?.ok) {
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        const created = normalizeRows({ rows: [payload.record || payload.document || payload] })[0];
        if (created) setItems((current) => [created, ...current].slice(0, 100));
        return true;
      }
      setMode("browser-local");
    }
    const next = [{ id: crypto.randomUUID(), title: normalized }, ...items].slice(0, 100);
    setItems(next);
    localStorage.setItem(localKey(collection), JSON.stringify(next));
    return true;
  }, [collection, items, mode]);

  return {
    items,
    mode,
    addItem,
    status: mode === "managed" ? "Managed write confirmed" : mode === "loading" ? "Checking managed backend" : "Browser-local demo · cloud setup required",
  };
}
`;

const MANAGED_TEST_SOURCE = `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manifest, schema, policies, server] = await Promise.all([
  readFile(new URL("../backend/manifest.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../backend/schema.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../backend/policies.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../lib/drops-managed-server.ts", import.meta.url), "utf8"),
]);
assert.equal(manifest.productionProvider, "setup-required-until-health-receipt");
assert.ok(Object.keys(schema.collections).length >= 3);
assert.ok(policies.approvals.includes("telegram.publish"));
  assert.match(server, /server-only/);
  assert.match(server, /target\.origin !== origin/);
  assert.match(server, /redirect: "error"/);
assert.doesNotMatch(JSON.stringify({ manifest, schema, policies }), /sk-|ghp_|xox[baprs]-|BEGIN PRIVATE KEY/);
console.log("Managed backend manifest passed");
`;

export function projectManagedTemplate(spec: GeneratedProjectSpec): ManagedProjectTemplate {
  const capabilities = requestedCapabilities(spec);
  if (!capabilities.length) return { enabled: false, capabilities, environment: [], files: [], readme: "" };
  const manifest = {
    schemaVersion: 1,
    mode: "managed-with-labelled-local-fallback",
    environments: ["development", "preview", "production"],
    capabilities,
    serverProxy: "/api/backend/status",
    productionProvider: "setup-required-until-health-receipt",
    boundaries: {
      secrets: "server-environment-only",
      externalMutations: "explicit-approval-required",
      trading: "denied",
      localPersistence: "demo-only-and-labelled",
    },
  };
  const schema = {
    schemaVersion: 1,
    collections: {
      wallet_events: {
        rowPolicy: "project",
        fields: {
          wallet: { type: "string", required: true },
          chain: { type: "string", required: true },
          eventType: { type: "string", required: true },
          occurredAt: { type: "datetime", required: true },
          enrichment: { type: "json", required: false },
        },
        indexes: [{ name: "wallet_events_time", fields: ["occurredAt"] }],
      },
      alerts: {
        rowPolicy: "owner",
        fields: {
          status: { type: "enum", required: true, enumValues: ["draft", "approved", "delivered", "failed"] },
          score: { type: "float", required: true },
          evidence: { type: "json", required: true },
          approvedAt: { type: "datetime", required: false },
        },
        indexes: [{ name: "alerts_status", fields: ["status"] }],
      },
      comments: {
        rowPolicy: "roles",
        allowedRoles: ["owner", "admin", "developer", "designer", "analyst", "viewer"],
        fields: {
          targetPath: { type: "string", required: true },
          body: { type: "text", required: true },
          resolved: { type: "boolean", required: true, default: false },
        },
        indexes: [{ name: "comments_target", fields: ["targetPath"] }],
      },
      workflow_items: {
        rowPolicy: "roles",
        allowedRoles: ["owner", "admin", "developer", "designer", "analyst", "viewer"],
        fields: {
          title: { type: "string", required: true },
          done: { type: "boolean", required: true, default: false },
        },
        indexes: [{ name: "workflow_items_title", fields: ["title"] }],
      },
    },
  };
  const policies = {
    schemaVersion: 1,
    approvals: ["telegram.publish", "webhook.register", "deployment.create", "github.push", "external-database.write"],
    denied: ["wallet.private-key.read", "wallet.trade.execute", "production-environment.inherit"],
    retention: { demoDays: 7, production: "organization-policy" },
  };
  return {
    enabled: true,
    capabilities,
    integration: {
      id: "managed-backend",
      kind: "custom",
      status: "setup-required",
      capabilities,
      proxyPath: "/api/backend/status",
      providerEvidenceRequired: true,
    },
    environment: [
      { name: "DROPS_MANAGED_API_ORIGIN", description: "Approved HTTPS origin for the Drops Studio managed data plane.", required: false, secret: false, scope: "runtime" },
      { name: "DROPS_MANAGED_PROJECT_CAPABILITY", description: "Server-only project capability issued after explicit backend setup.", required: false, secret: true, scope: "runtime" },
    ],
    files: [
      { path: "backend/manifest.json", content: safeJson(manifest), language: "json", role: "manifest" },
      { path: "backend/schema.json", content: safeJson(schema), language: "json", role: "config" },
      { path: "backend/policies.json", content: safeJson(policies), language: "json", role: "config" },
      { path: "lib/drops-managed-server.ts", content: MANAGED_SERVER_SOURCE, language: "typescript", role: "integration" },
      { path: "lib/use-managed-collection.ts", content: MANAGED_COLLECTION_CLIENT, language: "typescript", role: "integration" },
      { path: "app/api/backend/status/route.ts", content: MANAGED_STATUS_ROUTE, language: "typescript", role: "integration" },
      { path: "app/api/backend/collections/[collection]/route.ts", content: MANAGED_COLLECTION_ROUTE, language: "typescript", role: "integration" },
      { path: "tests/managed-backend-manifest.test.mjs", content: MANAGED_TEST_SOURCE, language: "javascript", role: "test" },
    ],
    readme: " The `backend/` directory declares the managed data model, policies and production boundaries. `/api/backend/status` reports only real server configuration; without `DROPS_MANAGED_PROJECT_CAPABILITY` the app stays runnable with its labelled browser-local fallback.",
  };
}
