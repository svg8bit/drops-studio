import { strToU8, zipSync } from "fflate";

import { assertArtifactFilesSafe } from "./artifact-security.ts";
import { normalizeProjectV2Path } from "./project-v2-path.ts";
import type { ProjectV2 } from "./project-v2-types.ts";
import { validateProjectV2 } from "./project-v2-validator.ts";

const GENERATED_EXPORT_PATHS = [
  ".drops-studio/EXPORT.md",
  ".drops-studio/export.json",
  ".env.example",
] as const;
const ZIP_MIN_YEAR = 1980;
const ZIP_MAX_YEAR = 2107;

export interface ProjectV2ArchiveOptions {
  timestamp?: string | number | Date;
}

function archiveTimestamp(
  value: ProjectV2ArchiveOptions["timestamp"],
  fallback: string,
): Date {
  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value ?? fallback);
  const year = date.getUTCFullYear();
  if (
    !Number.isFinite(date.getTime()) ||
    year < ZIP_MIN_YEAR ||
    year > ZIP_MAX_YEAR
  ) {
    throw new Error(
      `Project V2 export timestamp must be between ${ZIP_MIN_YEAR} and ${ZIP_MAX_YEAR}.`,
    );
  }
  return date;
}

function environmentNames(project: ProjectV2): string[] {
  return [...new Set(project.environment.map((definition) => definition.name))]
    .sort();
}

function environmentExample(names: readonly string[]): string {
  return [
    "# Drops Studio Project V2 environment template.",
    "# Add values only in your local or deployment environment; never commit them.",
    ...names.map((name) => `${name}=`),
    "",
  ].join("\n");
}

function commandInstructions(project: ProjectV2): string[] {
  const commands = ["npm install --ignore-scripts"];
  for (const script of ["typecheck", "lint", "test", "build", "dev", "start"]) {
    if (project.manifest.scripts[script]) commands.push(`npm run ${script}`);
  }
  return commands;
}

function exportInstructions(
  project: ProjectV2,
  names: readonly string[],
): string {
  const commands = commandInstructions(project)
    .map((command) => `- \`${command}\``)
    .join("\n");
  const variables = names.length
    ? names.map((name) => `- \`${name}\``).join("\n")
    : "- None for the basic/demo mode.";
  return `# ${project.manifest.name}: source export

This archive contains the real Project V2 filesystem. It does not contain the
Drops Studio editor, sandbox identifiers, command logs, runs, checkpoints, or
deployment credentials.

## Local and self-hosted run

Use Node.js 24 and npm. From the extracted archive run:

${commands}

The project remains in its documented demo/setup-required mode until its
server-side capabilities are configured.

## Environment

Copy \`.env.example\` to the environment mechanism used by your host and add
only the approved values there. The archive includes variable names, never
their values:

${variables}

## Deploy to Vercel

Import this extracted folder into Vercel, configure the required variables in
Project Settings, and create a preview deployment first. Do not expose provider
credentials through \`NEXT_PUBLIC_*\` variables or commit a populated env file.
`;
}

function exportMetadata(
  project: ProjectV2,
  names: readonly string[],
  timestamp: Date,
): string {
  return JSON.stringify(
    {
      exportSchemaVersion: 1,
      projectSchemaVersion: 2,
      projectRevision: project.revision,
      contentHash: project.contentHash,
      framework: project.manifest.framework,
      runtime: project.manifest.runtime,
      packageManager: project.manifest.packageManager,
      entrypoints: [...project.manifest.entrypoints],
      environmentVariableNames: names,
      credentialsIncluded: false,
      exportedAt: timestamp.toISOString(),
    },
    null,
    2,
  );
}

function assertNoGeneratedPathCollision(project: ProjectV2): void {
  for (const path of GENERATED_EXPORT_PATHS) {
    if (project.files[path]) {
      throw new Error(`Project source collides with reserved export path ${path}.`);
    }
  }
}

export function projectV2ArchiveFilename(project: Pick<ProjectV2, "manifest">): string {
  const slug = project.manifest.slug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 72) {
    throw new Error("Project V2 export filename requires a valid project slug.");
  }
  return `${slug}.zip`;
}

export async function createProjectV2Archive(
  project: ProjectV2,
  options: ProjectV2ArchiveOptions = {},
): Promise<Uint8Array> {
  const validated = await validateProjectV2(project);
  projectV2ArchiveFilename(validated);
  assertNoGeneratedPathCollision(validated);
  const timestamp = archiveTimestamp(options.timestamp, validated.updatedAt);
  const names = environmentNames(validated);
  const files: Record<string, Uint8Array> = {};

  for (const path of Object.keys(validated.files).sort()) {
    const normalized = normalizeProjectV2Path(path);
    if (normalized !== path || validated.files[path].path !== path) {
      throw new Error(`Project V2 export rejected unsafe file path ${path}.`);
    }
    files[path] = strToU8(validated.files[path].content);
  }
  files[".env.example"] = strToU8(environmentExample(names));
  files[".drops-studio/EXPORT.md"] = strToU8(
    exportInstructions(validated, names),
  );
  files[".drops-studio/export.json"] = strToU8(
    exportMetadata(validated, names, timestamp),
  );
  assertArtifactFilesSafe(files);

  const ordered = Object.fromEntries(
    Object.entries(files).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
  return zipSync(ordered, { level: 6, mtime: timestamp });
}

export async function createProjectV2ArchiveBlob(
  project: ProjectV2,
  options: ProjectV2ArchiveOptions = {},
): Promise<Blob> {
  const bytes = await createProjectV2Archive(project, options);
  const copy = Uint8Array.from(bytes);
  return new Blob([copy.buffer], { type: "application/zip" });
}
