import { ContextSourceRegistry } from "./source-registry.ts";
import type { ContextScope, ContextSource } from "./types.ts";

export type ProjectMemoryBasis =
  | "explicit-user-decision"
  | "accepted-build-plan"
  | "verified-architecture"
  | "stable-project-convention";

export interface ProjectMemoryWrite extends ContextScope {
  memoryId: string;
  revision: string;
  title: string;
  content: string;
  basis: ProjectMemoryBasis;
  acceptedAt: string;
}

export class ProjectContextMemory {
  readonly #registry: ContextSourceRegistry;

  constructor(registry = new ContextSourceRegistry()) {
    this.#registry = registry;
  }

  write(input: ProjectMemoryWrite): ContextSource {
    if (!input.projectId) throw new Error("Project memory requires a project ID.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.memoryId)) throw new Error("Project memory ID is invalid.");
    const source = this.#registry.register({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      branch: input.branch,
      revision: input.revision,
      sourceType: "memory",
      sourceUri: `memory://${input.projectId}/${input.memoryId}`,
      sourceVersion: input.revision,
      content: `# ${input.title}\n\n${input.content}\n\nBasis: ${input.basis}`,
      trust: "project-authoritative",
      sensitivity: "project-private",
      createdAt: input.acceptedAt,
      updatedAt: input.acceptedAt,
      metadata: { basis: input.basis },
    });
    if (!source) throw new Error("Project memory was not accepted for indexing.");
    return source;
  }

  list(scope: ContextScope): ContextSource[] {
    return this.#registry.list(scope).filter((source) => source.sourceType === "memory");
  }

  deleteProject(scope: ContextScope): number {
    return this.#registry.clearScope(scope);
  }
}
