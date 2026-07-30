import {
  assertProjectPayloadSafe,
  findArtifactSecrets,
} from "./artifact-security.ts";

const VERCEL_API_ORIGIN = "https://api.vercel.com";
const MAX_DEPLOYMENT_FILES = 160;
const MAX_DEPLOYMENT_BYTES = 3_500_000;
const MAX_LOG_BYTES = 96_000;

export type VercelDeploymentReadyState =
  | "INITIALIZING"
  | "QUEUED"
  | "BUILDING"
  | "READY"
  | "ERROR"
  | "CANCELED";

export interface VercelDeploymentCredentials {
  accessToken: string;
  teamId?: string;
  projectId?: string;
}

export interface VercelDeploymentFile {
  path: string;
  content: string;
}

export interface VercelDeploymentRecord {
  id: string;
  name: string;
  url: string | null;
  inspectorUrl: string | null;
  readyState: VercelDeploymentReadyState;
  createdAt: string;
  readyAt?: string;
  error?: string;
}

export interface VercelDeploymentLog {
  type: "stdout" | "stderr" | "command" | "deployment-state" | "fatal" | "other";
  text: string;
  createdAt: string;
}

export class VercelDeploymentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 502, code = "VERCEL_DEPLOYMENT_FAILED") {
    super(message);
    this.name = "VercelDeploymentError";
    this.status = status;
    this.code = code;
  }
}

type FetchLike = typeof fetch;

function safeToken(value: string): string {
  const token = value.trim();
  if (!token || token.length < 16 || token.length > 512 || /\s/.test(token)) {
    throw new VercelDeploymentError(
      "Connect a valid session-only Vercel access token before deploying.",
      401,
      "VERCEL_TOKEN_REQUIRED",
    );
  }
  return token;
}

function secretFreeProviderText(
  value: unknown,
  fallback: string,
  limit = 240,
): string {
  const text = typeof value === "string" ? value : "";
  if (!text || findArtifactSecrets(text, "Vercel provider output").length) {
    return fallback;
  }
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, limit) || fallback;
}

function safeIdentifier(value: string | undefined): string | undefined {
  const identifier = value?.trim() ?? "";
  if (!identifier) return undefined;
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(identifier)) {
    throw new VercelDeploymentError(
      "Vercel team and project identifiers must use safe provider identifiers.",
      400,
      "VERCEL_IDENTIFIER_INVALID",
    );
  }
  return identifier;
}

function safeProjectName(value: string): string {
  const name = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  if (!name) {
    throw new VercelDeploymentError(
      "A deployment name is required.",
      400,
      "VERCEL_NAME_INVALID",
    );
  }
  return name;
}

function safeFilePath(value: string): string {
  const path = value.trim();
  if (
    !path ||
    path.length > 240 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new VercelDeploymentError(
      `Unsafe deployment file path: ${JSON.stringify(path.slice(0, 80))}.`,
      400,
      "VERCEL_FILE_PATH_INVALID",
    );
  }
  return path;
}

function boundedFiles(files: readonly VercelDeploymentFile[]) {
  if (!files.length || files.length > MAX_DEPLOYMENT_FILES) {
    throw new VercelDeploymentError(
      `A deployment requires 1-${MAX_DEPLOYMENT_FILES} source files.`,
      400,
      "VERCEL_FILE_COUNT_INVALID",
    );
  }
  const seen = new Set<string>();
  let bytes = 0;
  const normalized = files.map((file) => {
    const path = safeFilePath(file.path);
    if (seen.has(path)) {
      throw new VercelDeploymentError(
        `Duplicate deployment file: ${path}.`,
        400,
        "VERCEL_FILE_DUPLICATE",
      );
    }
    seen.add(path);
    bytes += new TextEncoder().encode(file.content).byteLength;
    return { file: path, data: file.content, encoding: "utf-8" as const };
  });
  if (bytes > MAX_DEPLOYMENT_BYTES) {
    throw new VercelDeploymentError(
      "The deployment source exceeds the 3.5 MB direct-upload boundary.",
      413,
      "VERCEL_FILES_TOO_LARGE",
    );
  }
  assertProjectPayloadSafe(normalized, "Vercel deployment files");
  return normalized;
}

function query(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelJson(
  path: string,
  credentials: VercelDeploymentCredentials,
  fetchImpl: FetchLike,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${VERCEL_API_ORIGIN}${path}${query(safeIdentifier(credentials.teamId))}`, {
    ...init,
    headers: {
      authorization: `Bearer ${safeToken(credentials.accessToken)}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const providerError = payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : payload;
    throw new VercelDeploymentError(
      secretFreeProviderText(
        providerError.message,
        `Vercel API request failed with status ${response.status}.`,
      ),
      response.status,
      typeof providerError.code === "string"
        ? `VERCEL_${providerError.code.toUpperCase()}`.slice(0, 96)
        : "VERCEL_API_ERROR",
    );
  }
  return payload;
}

function readyState(value: unknown): VercelDeploymentReadyState {
  const normalized = String(value ?? "INITIALIZING").toUpperCase();
  return ["INITIALIZING", "QUEUED", "BUILDING", "READY", "ERROR", "CANCELED"].includes(normalized)
    ? normalized as VercelDeploymentReadyState
    : "INITIALIZING";
}

function deploymentRecord(value: Record<string, unknown>): VercelDeploymentRecord {
  const id = typeof value.id === "string" ? value.id : "";
  if (!/^dpl_[A-Za-z0-9]+$/.test(id)) {
    throw new VercelDeploymentError(
      "Vercel returned an invalid deployment identifier.",
      502,
      "VERCEL_RESPONSE_INVALID",
    );
  }
  const url = typeof value.url === "string" && value.url
    ? `https://${value.url.replace(/^https?:\/\//, "")}`
    : null;
  const created = Number(value.createdAt ?? value.created ?? Date.now());
  const ready = Number(value.ready ?? 0);
  return {
    id,
    name: typeof value.name === "string" ? value.name.slice(0, 80) : "deployment",
    url,
    inspectorUrl: `https://vercel.com/_/${id}`,
    readyState: readyState(value.readyState ?? value.state),
    createdAt: new Date(Number.isFinite(created) ? created : Date.now()).toISOString(),
    ...(ready > 0 ? { readyAt: new Date(ready).toISOString() } : {}),
    ...(typeof value.errorMessage === "string"
      ? { error: secretFreeProviderText(value.errorMessage, "Vercel deployment failed.") }
      : {}),
  };
}

export function vercelDeploymentReadiness(
  env: NodeJS.ProcessEnv = process.env,
): { configured: boolean; source: "platform" | "session-required" } {
  const configured = Boolean(
    env.VERCEL_DEPLOY_TOKEN?.trim() &&
      env.VERCEL_GENERATED_PROJECT_ID?.trim(),
  );
  return {
    configured,
    source: configured ? "platform" : "session-required",
  };
}

export async function createVercelPreviewDeployment(input: {
  credentials: VercelDeploymentCredentials;
  name: string;
  files: readonly VercelDeploymentFile[];
  revisionHash?: string;
  fetchImpl?: FetchLike;
}): Promise<VercelDeploymentRecord> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const project = safeIdentifier(input.credentials.projectId);
  const payload = await vercelJson("/v13/deployments", input.credentials, fetchImpl, {
    method: "POST",
    body: JSON.stringify({
      name: safeProjectName(input.name),
      ...(project ? { project } : {}),
      files: boundedFiles(input.files),
      projectSettings: {
        framework: "nextjs",
        installCommand: "npm install --ignore-scripts",
        buildCommand: "npm run build",
      },
      meta: {
        source: "drops-studio-v2",
        ...(input.revisionHash
          ? { projectRevision: input.revisionHash.replace(/[^a-f0-9]/gi, "").slice(0, 64) }
          : {}),
      },
    }),
  });
  return deploymentRecord(payload);
}

export async function getVercelDeployment(input: {
  credentials: VercelDeploymentCredentials;
  deploymentId: string;
  fetchImpl?: FetchLike;
}): Promise<VercelDeploymentRecord> {
  if (!/^dpl_[A-Za-z0-9]+$/.test(input.deploymentId)) {
    throw new VercelDeploymentError("Invalid deployment identifier.", 400, "VERCEL_DEPLOYMENT_ID_INVALID");
  }
  const payload = await vercelJson(
    `/v13/deployments/${encodeURIComponent(input.deploymentId)}`,
    input.credentials,
    input.fetchImpl ?? fetch,
  );
  return deploymentRecord(payload);
}

export async function waitForVercelDeployment(input: {
  credentials: VercelDeploymentCredentials;
  deploymentId: string;
  timeoutMs?: number;
  pollMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<VercelDeploymentRecord> {
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 150_000, 1_000), 240_000);
  const pollMs = Math.min(Math.max(input.pollMs ?? 2_000, 100), 10_000);
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + timeoutMs;
  let record = await getVercelDeployment(input);
  while (!["READY", "ERROR", "CANCELED"].includes(record.readyState) && Date.now() < deadline) {
    await sleep(pollMs);
    record = await getVercelDeployment(input);
  }
  if (!["READY", "ERROR", "CANCELED"].includes(record.readyState)) {
    throw new VercelDeploymentError(
      "Vercel accepted the deployment, but it did not reach a terminal state before the bounded wait expired.",
      504,
      "VERCEL_DEPLOYMENT_TIMEOUT",
    );
  }
  return record;
}

export async function getVercelDeploymentLogs(input: {
  credentials: VercelDeploymentCredentials;
  deploymentId: string;
  fetchImpl?: FetchLike;
}): Promise<VercelDeploymentLog[]> {
  if (!/^dpl_[A-Za-z0-9]+$/.test(input.deploymentId)) {
    throw new VercelDeploymentError("Invalid deployment identifier.", 400, "VERCEL_DEPLOYMENT_ID_INVALID");
  }
  const response = await (input.fetchImpl ?? fetch)(
    `${VERCEL_API_ORIGIN}/v3/deployments/${encodeURIComponent(input.deploymentId)}/events${query(input.credentials.teamId)}${input.credentials.teamId ? "&" : "?"}direction=backward&limit=100&builds=1`,
    {
      headers: { authorization: `Bearer ${safeToken(input.credentials.accessToken)}` },
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => [])) as unknown;
  if (!response.ok || !Array.isArray(payload)) {
    throw new VercelDeploymentError("Vercel deployment logs are unavailable.", response.status || 502, "VERCEL_LOGS_UNAVAILABLE");
  }
  let bytes = 0;
  const logs: VercelDeploymentLog[] = [];
  for (const event of payload) {
    if (!event || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    const nested = record.payload && typeof record.payload === "object"
      ? record.payload as Record<string, unknown>
      : record;
    const providerText = String(nested.text ?? nested.message ?? "").slice(0, 8_000);
    const text = findArtifactSecrets(providerText, "Vercel deployment log").length
      ? "[redacted secret material]"
      : providerText
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
          .slice(0, 8_000);
    if (!text) continue;
    bytes += new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_LOG_BYTES) break;
    const type = String(record.type ?? nested.type ?? "other");
    logs.push({
      type: ["stdout", "stderr", "command", "deployment-state", "fatal"].includes(type)
        ? type as VercelDeploymentLog["type"]
        : "other",
      text,
      createdAt: new Date(Number(record.created ?? nested.date ?? Date.now())).toISOString(),
    });
  }
  return logs;
}

export async function cancelVercelDeployment(input: {
  credentials: VercelDeploymentCredentials;
  deploymentId: string;
  fetchImpl?: FetchLike;
}): Promise<VercelDeploymentRecord> {
  if (!/^dpl_[A-Za-z0-9]+$/.test(input.deploymentId)) {
    throw new VercelDeploymentError("Invalid deployment identifier.", 400, "VERCEL_DEPLOYMENT_ID_INVALID");
  }
  const payload = await vercelJson(
    `/v12/deployments/${encodeURIComponent(input.deploymentId)}/cancel`,
    input.credentials,
    input.fetchImpl ?? fetch,
    { method: "PATCH", body: "{}" },
  );
  return deploymentRecord(payload);
}
