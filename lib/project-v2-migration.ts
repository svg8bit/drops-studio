import { hashProjectV2CanonicalState } from "./project-v2-hash.ts";
import { createProjectV2File } from "./project-v2-files.ts";
import type {
  BuilderTaskV2,
  ProjectFileLanguageV2,
  ProjectFileRoleV2,
  ProjectIntegrationManifestV2,
  ProjectV2,
} from "./project-v2-types.ts";
import { validateProjectV2 } from "./project-v2-validator.ts";
import type { GeneratedProject, GeneratedProjectSpec } from "./project-types.ts";
import {
  staticWorkspaceServerSource,
  validateProjectWorkspace,
  type ProjectWorkspace,
  type ProjectWorkspaceFile,
} from "./project-workspace.ts";
import { validateProjectSpec } from "./project-validator.ts";

const defaultIntegrations: ProjectIntegrationManifestV2[] = [
  {
    id: "dropstab",
    kind: "dropstab",
    status: "demo",
    capabilities: ["coins", "unlocks", "funding", "activities"],
    proxyPath: "/api/capabilities/dropstab",
    providerEvidenceRequired: true,
  },
  {
    id: "drops-bot",
    kind: "drops-bot",
    status: "setup-required",
    capabilities: ["wallet-events", "alerts", "webhooks"],
    proxyPath: "/api/capabilities/drops-bot",
    providerEvidenceRequired: true,
  },
  {
    id: "telegram",
    kind: "telegram",
    status: "setup-required",
    capabilities: ["approved-delivery"],
    proxyPath: "/api/capabilities/telegram",
    providerEvidenceRequired: true,
  },
  {
    id: "project-data",
    kind: "project-data",
    status: "available",
    capabilities: ["demo-documents", "event-inbox"],
    proxyPath: "/api/project-data",
    providerEvidenceRequired: true,
  },
];

const defaultEnvironment: ProjectV2["environment"] = [
  {
    name: "DROPSTAB_API_KEY",
    description: "Optional server-side DropsTab credential.",
    required: false,
    secret: true,
    scope: "runtime",
  },
  {
    name: "DROPS_BOT_WEBHOOK_SECRET",
    description: "Optional server-side webhook verification secret.",
    required: false,
    secret: true,
    scope: "runtime",
  },
];

const defaultPermissions: ProjectV2["permissions"] = [
  {
    id: "read-market",
    capability: "dropstab:read",
    effect: "allow",
    destructive: false,
    external: true,
  },
  {
    id: "telegram-publish",
    capability: "telegram:publish",
    effect: "approval-required",
    destructive: false,
    external: true,
  },
  {
    id: "wallet-action",
    capability: "wallet:execute",
    effect: "deny",
    destructive: true,
    external: true,
  },
];

function safeTimestamp(value: string | undefined, fallback: string): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return fallback;
  return new Date(value).toISOString();
}

function packageRecords(content: string): {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const value = JSON.parse(content) as Record<string, unknown>;
  const record = (input: unknown): Record<string, string> =>
    input && typeof input === "object" && !Array.isArray(input)
      ? Object.fromEntries(
          Object.entries(input as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    scripts: record(value.scripts),
    dependencies: record(value.dependencies),
    devDependencies: record(value.devDependencies),
  };
}

function workspaceRole(role: ProjectWorkspaceFile["role"]): ProjectFileRoleV2 {
  const roles: Record<ProjectWorkspaceFile["role"], ProjectFileRoleV2> = {
    entry: "entry",
    style: "style",
    client: "source",
    "project-config": "config",
    "integration-config": "integration",
    "package-manifest": "manifest",
    server: "source",
    task: "source",
    test: "test",
    documentation: "documentation",
  };
  return roles[role];
}

function taskKind(task: ProjectWorkspace["tasks"][number]): BuilderTaskV2["kind"] {
  const signal = `${task.id} ${task.args.join(" ")}`.toLowerCase();
  if (/typecheck|check/.test(signal)) return "typecheck";
  if (/lint/.test(signal)) return "lint";
  if (/test/.test(signal)) return "test";
  if (/build/.test(signal)) return "build";
  if (/start|dev|preview/.test(signal)) return "dev";
  return "custom";
}

function workspaceTasks(workspace: ProjectWorkspace): BuilderTaskV2[] {
  return workspace.tasks.map((task) => {
    const kind = taskKind(task);
    return {
      id: task.id,
      label: task.label,
      kind,
      command: "npm",
      args: [...task.args],
      cwd: task.cwd ?? ".",
      timeoutMs: kind === "build" ? 300_000 : 120_000,
      ...(task.port ? { previewPort: task.port } : {}),
      approvalRequired: false,
    };
  });
}

function htmlOnlyDefinitions(project: GeneratedProject, spec: GeneratedProjectSpec) {
  const packageJson = {
    name: spec.slug,
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "node server.mjs",
      start: "node server.mjs",
      test: "node tests/smoke.mjs",
      build: "node scripts/check.mjs",
    },
  };
  return [
    {
      path: "index.html",
      content: project.html,
      language: "html" as const,
      role: "entry" as const,
      editable: true,
    },
    {
      path: "package.json",
      content: JSON.stringify(packageJson, null, 2),
      language: "json" as const,
      role: "manifest" as const,
      editable: true,
    },
    {
      path: "server.mjs",
      content: staticWorkspaceServerSource(),
      language: "javascript" as const,
      role: "source" as const,
      editable: false,
    },
    {
      path: "scripts/check.mjs",
      content: `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nconst html = await readFile(new URL("../index.html", import.meta.url), "utf8");\nassert.match(html, /data-project-kind=/);\nconsole.log("Legacy project build check passed");\n`,
      language: "javascript" as const,
      role: "source" as const,
      editable: false,
    },
    {
      path: "tests/smoke.mjs",
      content: `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nconst html = await readFile(new URL("../index.html", import.meta.url), "utf8");\nassert.match(html, /data-project-kind=${spec.presetId}/);\nconsole.log("Legacy project smoke passed");\n`,
      language: "javascript" as const,
      role: "test" as const,
      editable: true,
    },
  ];
}

async function createFiles(
  definitions: Array<{
    path: string;
    content: string;
    language: ProjectFileLanguageV2;
    role: ProjectFileRoleV2;
    editable: boolean;
  }>,
  provenance: "generated" | "manual",
  createdAt: string,
  updatedAt: string,
): Promise<ProjectV2["files"]> {
  const files = await Promise.all(
    definitions.map(async (definition) => ({
      ...(await createProjectV2File({
        ...definition,
        provenance,
        now: updatedAt,
      })),
      createdAt,
      updatedAt,
    })),
  );
  return Object.fromEntries(files.map((file) => [file.path, file]));
}

export interface ProjectV2MigrationAdapter {
  readonly sourceSchemaVersion: 1;
  migrate(project: GeneratedProject): Promise<ProjectV2>;
}

export async function migrateGeneratedProjectToV2(
  input: GeneratedProject,
): Promise<ProjectV2> {
  const fallbackNow = new Date().toISOString();
  const spec = validateProjectSpec(input.spec);
  const createdAt = safeTimestamp(input.createdAt, fallbackNow);
  const updatedAt = safeTimestamp(input.updatedAt, createdAt);
  const workspaceValidation = input.workspace
    ? validateProjectWorkspace(spec, input.workspace)
    : null;
  const workspace = workspaceValidation?.valid ? input.workspace : undefined;
  const definitions = workspace
    ? workspace.files.map((file) => ({
        path: file.path,
        content: file.content,
        language: file.language,
        role: workspaceRole(file.role),
        editable: file.editable,
      }))
    : htmlOnlyDefinitions(input, spec);
  const files = await createFiles(
    definitions,
    input.sourceEditedAt ? "manual" : "generated",
    createdAt,
    workspace ? safeTimestamp(workspace.updatedAt, updatedAt) : updatedAt,
  );
  const packageManifest = packageRecords(files["package.json"].content);
  const tasks: BuilderTaskV2[] = workspace
    ? workspaceTasks(workspace)
    : [
        { id: "test", label: "Run tests", kind: "test", command: "npm", args: ["test"], cwd: ".", timeoutMs: 120_000, approvalRequired: false },
        { id: "build", label: "Build release", kind: "build", command: "npm", args: ["run", "build"], cwd: ".", timeoutMs: 300_000, approvalRequired: false },
        { id: "dev", label: "Start preview", kind: "dev", command: "npm", args: ["run", "dev"], cwd: ".", timeoutMs: 120_000, previewPort: 4173, approvalRequired: false },
      ];
  const sourceKind = workspace ? "project-workspace-v1" : "generated-project-v1";
  const project: ProjectV2 = {
    schemaVersion: 2,
    id: input.id,
    revision: workspace?.revision ?? 1,
    contentHash: "",
    manifest: {
      schemaVersion: 2,
      name: spec.name,
      slug: spec.slug,
      packageManager: "npm",
      framework: { name: "legacy-html", version: "1.0.0" },
      runtime: { name: "nodejs", version: "24" },
      scripts: packageManifest.scripts,
      dependencies: packageManifest.dependencies,
      devDependencies: packageManifest.devDependencies,
      entrypoints: ["index.html"],
      legacyFallback: {
        supported: true,
        adapter: "legacy-html",
        reason: "The original deterministic standalone HTML runtime is preserved exactly for compatibility.",
        sourceSchemaVersion: 1,
      },
    },
    files,
    productSpec: spec,
    integrations: structuredClone(defaultIntegrations),
    environment: structuredClone(defaultEnvironment),
    permissions: structuredClone(defaultPermissions),
    tasks,
    runs: [],
    logs: [],
    checkpoints: [],
    deployment: {
      status: input.publishedSlug || input.publishedUrl ? "ready" : "none",
      provider: "legacy-publish",
      ...(input.publishedSlug ? { legacyPublishedSlug: input.publishedSlug } : {}),
      ...(input.publishedUrl ? { legacyPublishedUrl: input.publishedUrl } : {}),
      ...(input.publishedAt ? { createdAt: safeTimestamp(input.publishedAt, updatedAt) } : {}),
    },
    migration: {
      sourceSchemaVersion: 1,
      sourceKind,
      sourceProjectId: input.id,
      sourceFidelity: input.workspace && !workspace ? "reconstructed" : "exact",
      adapter: "legacy-html",
      migratedAt: updatedAt,
    },
    createdAt,
    updatedAt,
  };
  project.contentHash = await hashProjectV2CanonicalState(project);
  return validateProjectV2(project);
}

export class LegacyProjectV2MigrationAdapter implements ProjectV2MigrationAdapter {
  readonly sourceSchemaVersion = 1 as const;

  migrate(project: GeneratedProject): Promise<ProjectV2> {
    return migrateGeneratedProjectToV2(project);
  }
}
