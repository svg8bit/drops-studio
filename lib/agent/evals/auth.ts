import { timingSafeEqual } from "node:crypto";

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function agentEvalsAccessConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.DROPS_EVALS_INTERNAL_ACCESS_SECRET?.trim() ?? "";
  return Boolean(secret && (env.NODE_ENV !== "production" || Buffer.byteLength(secret, "utf8") >= 32));
}

export function authorizeAgentEvals(headers: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!agentEvalsAccessConfigured(env)) return false;
  const configured = env.DROPS_EVALS_INTERNAL_ACCESS_SECRET!.trim();
  const authorization = headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const header = headers.get("x-drops-evals-secret")?.trim() ?? "";
  const provided = bearer || header;
  return provided.length <= 512 && constantTimeEqual(provided, configured);
}
