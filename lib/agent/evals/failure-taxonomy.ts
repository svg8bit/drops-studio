import type { AgentFailureClass } from "./types.ts";

const rules: Array<[AgentFailureClass, RegExp]> = [
  ["security", /secret|credential|private key|unsafe|ssrf|signature|replay/i],
  ["permission", /unauthori[sz]ed|permission|approval|required scope/i],
  ["project-schema", /project (?:v2 )?schema|manifest|invalid path|revision conflict/i],
  ["dependency", /cannot find module|module not found|npm (?:err|error)|dependency/i],
  ["typescript", /typescript|typecheck|\bts\d{4}\b|type .* is not assignable/i],
  ["lint", /eslint|lint/i],
  ["test", /test failed|assertionerror|expect\(/i],
  ["build", /build failed|compilation failed|webpack|turbopack|vinext/i],
  ["preview", /preview|dev server|port 3000|port 8080/i],
  ["browser-runtime", /page error|console error|hydration|browser|uncaught/i],
  ["integration", /dropstab|drops bot|telegram|webhook|provider evidence/i],
  ["provider", /rate limit|provider|model|api request/i],
  ["timeout", /timeout|timed out|deadline/i],
  ["cancelled", /cancelled|canceled|abort/i],
];

export function classifyAgentFailure(evidence: readonly string[]): AgentFailureClass {
  if (!evidence.length) return "none";
  const text = evidence.slice(0, 32).join("\n").slice(0, 24_000);
  return rules.find(([, expression]) => expression.test(text))?.[0] ?? "unknown";
}
