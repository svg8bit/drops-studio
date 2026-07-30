import type { AgentModelRole } from "./types.ts";

export interface AgentRoleContract {
  role: AgentModelRole;
  promptVersion: string;
  mayMutateFiles: boolean;
  mayRunRuntime: boolean;
  mayPublish: false;
  maxToolRounds: number;
  maxOutputTokens: number;
  instructions: string[];
  stopConditions: string[];
}

const COMMON_STOPS = [
  "Stop on missing authorization or credentials; return setup-required.",
  "Stop before any external mutation or publication.",
  "Return structured evidence, never private chain-of-thought.",
];

const ROLE_CONTRACTS: Record<AgentModelRole, AgentRoleContract> = {
  router: {
    role: "router",
    promptVersion: "2.0.0",
    mayMutateFiles: false,
    mayRunRuntime: false,
    mayPublish: false,
    maxToolRounds: 0,
    maxOutputTokens: 1_000,
    instructions: ["Classify the task and emit reason codes only."],
    stopConditions: COMMON_STOPS,
  },
  planner: {
    role: "planner",
    promptVersion: "2.0.0",
    mayMutateFiles: false,
    mayRunRuntime: false,
    mayPublish: false,
    maxToolRounds: 4,
    maxOutputTokens: 8_000,
    instructions: ["Produce a validated executable plan and scoped task DAG."],
    stopConditions: COMMON_STOPS,
  },
  coder: {
    role: "coder",
    promptVersion: "2.0.0",
    mayMutateFiles: true,
    mayRunRuntime: true,
    mayPublish: false,
    maxToolRounds: 16,
    maxOutputTokens: 24_000,
    instructions: ["Create coherent multi-file changes inside the assigned scope."],
    stopConditions: COMMON_STOPS,
  },
  "quick-edit": {
    role: "quick-edit",
    promptVersion: "2.0.0",
    mayMutateFiles: true,
    mayRunRuntime: true,
    mayPublish: false,
    maxToolRounds: 4,
    maxOutputTokens: 6_000,
    instructions: ["Return a bounded patch for at most four files and 160 changed lines."],
    stopConditions: [
      ...COMMON_STOPS,
      "Escalate on architecture, dependency, permission, scope, or repeated-check failure.",
    ],
  },
  autofix: {
    role: "autofix",
    promptVersion: "2.0.0",
    mayMutateFiles: true,
    mayRunRuntime: true,
    mayPublish: false,
    maxToolRounds: 8,
    maxOutputTokens: 8_000,
    instructions: ["Repair only the classified verified failure with a focused patch."],
    stopConditions: [
      ...COMMON_STOPS,
      "Never repair credential, authorization, or security-policy failures.",
    ],
  },
  verifier: {
    role: "verifier",
    promptVersion: "2.0.0",
    mayMutateFiles: false,
    mayRunRuntime: false,
    mayPublish: false,
    maxToolRounds: 0,
    maxOutputTokens: 4_000,
    instructions: ["Review immutable evidence; deterministic gates remain authoritative."],
    stopConditions: COMMON_STOPS,
  },
  "retrieval-reranker": {
    role: "retrieval-reranker",
    promptVersion: "2.0.0",
    mayMutateFiles: false,
    mayRunRuntime: false,
    mayPublish: false,
    maxToolRounds: 0,
    maxOutputTokens: 2_000,
    instructions: ["Rank provided candidates without inventing context."],
    stopConditions: COMMON_STOPS,
  },
  "eval-judge": {
    role: "eval-judge",
    promptVersion: "2.0.0",
    mayMutateFiles: false,
    mayRunRuntime: false,
    mayPublish: false,
    maxToolRounds: 0,
    maxOutputTokens: 4_000,
    instructions: ["Score offline evidence only; never affect a live project."],
    stopConditions: COMMON_STOPS,
  },
};

export function roleContract(role: AgentModelRole): AgentRoleContract {
  return structuredClone(ROLE_CONTRACTS[role]);
}

export function rolePrompt(role: AgentModelRole): string {
  const contract = roleContract(role);
  return JSON.stringify(contract, null, 2);
}
