import type { ProjectFileV2, ProjectV2 } from "../../project-v2-types.ts";
import {
  DROPSBOT_CAPABILITY_REGISTRY,
} from "../../drops-platform/dropsbot.ts";
import {
  DROPSTAB_ENDPOINT_REGISTRY,
  DROPSTAB_RATE_LIMIT_POLICY,
  DROPSTAB_RETRY_POLICY,
} from "../../drops-platform/dropstab.ts";
import type { ContextSource } from "../context/types.ts";
import type { IntelligentBuilderActorScope } from "./types.ts";

const KNOWLEDGE_VERSION = "drops-platform-adapters-v2";
const KNOWLEDGE_TIMESTAMP = "2026-07-30T00:00:00.000Z";
const MAX_CONTEXT_FILES = 320;
const MAX_CONTEXT_SOURCE_BYTES = 2_500_000;

function projectSourceType(
  file: ProjectFileV2,
): ContextSource["sourceType"] {
  if (file.language === "markdown") return "markdown";
  if (/^(?:openapi|swagger)(?:\.|-)|\/(?:openapi|swagger)(?:\.|-)/i.test(file.path)) {
    return "openapi";
  }
  return "code";
}

function projectLanguage(file: ProjectFileV2): string {
  if (file.language === "tsx" || file.language === "jsx") return file.language;
  if (file.language === "typescript") return "typescript";
  if (file.language === "javascript") return "javascript";
  return file.language;
}

export function projectContextSources(input: {
  project: ProjectV2;
  actor: IntelligentBuilderActorScope;
}): ContextSource[] {
  const files = Object.values(input.project.files).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (files.length > MAX_CONTEXT_FILES) {
    throw new Error("Project context exceeds the bounded file count.");
  }
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  if (bytes > MAX_CONTEXT_SOURCE_BYTES) {
    throw new Error("Project context exceeds the bounded source size.");
  }
  return files.map((file) => ({
    tenantId: input.actor.tenantId,
    workspaceId: input.actor.workspaceId,
    projectId: input.project.id,
    branch: input.actor.branch,
    revision: String(input.project.revision),
    sourceType: projectSourceType(file),
    sourceUri: `project://${input.project.id}/${file.path}`,
    sourceVersion: `${input.project.revision}:${file.hash}`,
    path: file.path,
    language: projectLanguage(file),
    content: file.content,
    trust: "project-authoritative",
    sensitivity: "project-private",
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }));
}

function dropsTabOpenApi(): string {
  const paths = Object.fromEntries(
    Object.values(DROPSTAB_ENDPOINT_REGISTRY).map((endpoint) => [
      endpoint.path,
      {
        get: {
          operationId: `dropstab_${endpoint.capability}`,
          tags: [endpoint.capability, "server-adapter"],
          summary: `Read documented DropsTab ${endpoint.capability} through the Drops Studio server adapter.`,
          "x-limitations": [
            "API credentials remain server-side and are never delivered to generated source or Sandbox.",
            "Provider evidence is required before data may be labelled live DropsTab data.",
            "Demo fallback must be labelled demo and not live provider data.",
          ],
          responses: { "200": { description: "Normalized provider payload with evidence." } },
        },
      },
    ]),
  );
  return JSON.stringify({
    openapi: "3.1.0",
    info: { title: "DropsTab server adapter registry", version: KNOWLEDGE_VERSION },
    servers: [{ url: "server-side-adapter" }],
    security: [{ dropsStudioServerCredential: [] }],
    paths,
    "x-retry-policy": DROPSTAB_RETRY_POLICY,
    "x-rate-limit-policy": DROPSTAB_RATE_LIMIT_POLICY,
  });
}

function dropsBotAdapterContract(): string {
  const capabilities = Object.entries(DROPSBOT_CAPABILITY_REGISTRY)
    .map(([id, definition]) => [
      `## ${id}`,
      `Support: ${definition.support}`,
      `External action: ${definition.externalAction}`,
      `Approval required: ${definition.approvalRequired}`,
      `Completion evidence: ${definition.completionEvidence}`,
      `Contract: ${definition.instructions}`,
    ].join("\n"))
    .join("\n\n");
  return `# Drops Bot server adapter capability registry

This registry is the bounded source of truth used by the current server
adapter. It does not create undocumented remote methods. Provider mutation,
Telegram delivery, webhook registration, and tracked-wallet changes require
explicit approval and provider-confirmed evidence. A received callback is not
proof of a provider signature. Private keys and seed phrases are unsupported.

${capabilities}`;
}

export function officialDropsContextSources(
  actor: IntelligentBuilderActorScope,
): ContextSource[] {
  const common = {
    tenantId: actor.tenantId,
    workspaceId: actor.workspaceId,
    sourceVersion: KNOWLEDGE_VERSION,
    trust: "official" as const,
    sensitivity: "workspace-private" as const,
    createdAt: KNOWLEDGE_TIMESTAMP,
    updatedAt: KNOWLEDGE_TIMESTAMP,
  };
  return [
    {
      ...common,
      sourceType: "openapi",
      sourceUri: "platform://drops/dropstab/server-adapter",
      path: "lib/drops-platform/dropstab.ts",
      language: "json",
      content: dropsTabOpenApi(),
      metadata: { provider: "DropsTab", canonical: true },
    },
    {
      ...common,
      sourceType: "markdown",
      sourceUri: "platform://drops/drops-bot/server-adapter",
      path: "lib/drops-platform/dropsbot.ts",
      language: "markdown",
      content: dropsBotAdapterContract(),
      metadata: { provider: "Drops Bot", canonical: true },
    },
  ];
}
