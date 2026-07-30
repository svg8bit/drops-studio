import type { AgentRunState } from "./types.ts";

export interface AgentRunStore {
  save(run: AgentRunState): Promise<void>;
  get(runId: string): Promise<AgentRunState | null>;
  delete(runId: string): Promise<void>;
}

export class MemoryAgentRunStore implements AgentRunStore {
  readonly #runs = new Map<string, AgentRunState>();

  async save(run: AgentRunState): Promise<void> {
    this.#runs.set(run.runId, structuredClone(run));
  }

  async get(runId: string): Promise<AgentRunState | null> {
    const run = this.#runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  async delete(runId: string): Promise<void> {
    this.#runs.delete(runId);
  }
}
