import { createSign } from "node:crypto";
import {
  assertProjectPayloadSafe,
  findArtifactSecrets,
} from "./artifact-security.ts";
import {
  ProviderResponseBoundaryError,
  readBoundedProviderJson,
} from "./provider-response-boundary.ts";

const GITHUB_API = "https://api.github.com";
const MAX_FILES = 140;
const MAX_BYTES = 3_000_000;
const MAX_GITHUB_RESPONSE_BYTES = 5 * 1_024 * 1_024;
const MAX_GITHUB_TOKEN_RESPONSE_BYTES = 128 * 1_024;
const IMPORT_CONCURRENCY = 4;

export interface GitHubIntegrationCredentials {
  accessToken?: string;
  appId?: string;
  privateKey?: string;
  installationId?: string;
}

export interface GitHubProjectFile {
  path: string;
  content: string;
}

export interface GitHubRepositoryState {
  owner: string;
  repo: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}

export interface GitHubPublishResult {
  branch: string;
  commitSha: string;
  commitUrl: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  status: "pull-request-open";
}

export class GitHubIntegrationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 502, code = "GITHUB_INTEGRATION_FAILED") {
    super(message);
    this.name = "GitHubIntegrationError";
    this.status = status;
    this.code = code;
  }
}

type FetchLike = typeof fetch;

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function githubAppJwt(appId: string, privateKey: string, now = Date.now()): string {
  if (!/^\d{1,20}$/.test(appId)) {
    throw new GitHubIntegrationError("GitHub App configuration is invalid.", 503, "GITHUB_APP_INVALID");
  }
  const issuedAt = Math.floor(now / 1_000) - 30;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 570, iss: appId }));
  const material = `${header}.${payload}`;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(material);
    signer.end();
    return `${material}.${signer.sign(privateKey, "base64url")}`;
  } catch {
    throw new GitHubIntegrationError("GitHub App signing is unavailable.", 503, "GITHUB_APP_INVALID");
  }
}

function safeToken(token: string | undefined): string | undefined {
  const value = token?.trim() ?? "";
  if (!value) return undefined;
  if (value.length < 20 || value.length > 512 || /\s/.test(value)) {
    throw new GitHubIntegrationError("Connect a valid session-only GitHub token.", 401, "GITHUB_TOKEN_INVALID");
  }
  return value;
}

function safeProviderMessage(value: unknown, fallback: string): string {
  const message = typeof value === "string" ? value : "";
  if (!message || findArtifactSecrets(message, "GitHub provider error").length) {
    return fallback;
  }
  return message
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 240) || fallback;
}

function safeRepoPart(value: string, label: string): string {
  const part = value.trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(part) || part === "." || part === "..") {
    throw new GitHubIntegrationError(`Invalid GitHub ${label}.`, 400, "GITHUB_REPOSITORY_INVALID");
  }
  return part;
}

function safePath(value: string): string {
  const path = value.trim();
  if (
    !path ||
    path.length > 240 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    /^(?:\.git|node_modules)(?:\/|$)/i.test(path)
  ) {
    throw new GitHubIntegrationError(`Unsafe GitHub file path: ${path.slice(0, 80)}.`, 400, "GITHUB_FILE_PATH_INVALID");
  }
  return path;
}

function safeBranchSuffix(value: string): string {
  const suffix = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[./-]+|[./-]+$/g, "")
    .slice(0, 72);
  return suffix || `build-${Date.now().toString(36)}`;
}

function boundedFiles(files: readonly GitHubProjectFile[]): GitHubProjectFile[] {
  if (!files.length || files.length > MAX_FILES) {
    throw new GitHubIntegrationError(`GitHub sync requires 1-${MAX_FILES} files.`, 400, "GITHUB_FILE_COUNT_INVALID");
  }
  const seen = new Set<string>();
  let bytes = 0;
  const normalized = files.map((file) => {
    const path = safePath(file.path);
    if (seen.has(path)) throw new GitHubIntegrationError(`Duplicate project file: ${path}.`, 400, "GITHUB_FILE_DUPLICATE");
    seen.add(path);
    bytes += Buffer.byteLength(file.content, "utf8");
    return { path, content: file.content };
  });
  if (bytes > MAX_BYTES) {
    throw new GitHubIntegrationError("GitHub sync source exceeds 3 MB.", 413, "GITHUB_FILES_TOO_LARGE");
  }
  assertProjectPayloadSafe(normalized, "GitHub project files");
  return normalized;
}

async function requestJson(
  path: string,
  token: string,
  fetchImpl: FetchLike,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "drops-studio-v2",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  let payload: Record<string, unknown>;
  try {
    const parsed = await readBoundedProviderJson(response, MAX_GITHUB_RESPONSE_BYTES);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    throw new GitHubIntegrationError(
      error instanceof ProviderResponseBoundaryError && error.reason === "too-large"
        ? "GitHub returned an oversized response."
        : "GitHub returned an invalid response.",
      502,
      "GITHUB_RESPONSE_INVALID",
    );
  }
  if (!response.ok) {
    throw new GitHubIntegrationError(
      safeProviderMessage(
        payload.message,
        `GitHub API failed with ${response.status}.`,
      ),
      response.status,
      response.status === 404 ? "GITHUB_NOT_FOUND" : response.status === 403 ? "GITHUB_FORBIDDEN" : "GITHUB_API_ERROR",
    );
  }
  return payload;
}

async function installationToken(
  credentials: GitHubIntegrationCredentials,
  fetchImpl: FetchLike,
  repository: string,
): Promise<string> {
  const direct = safeToken(credentials.accessToken);
  if (direct) return direct;
  const appId = credentials.appId?.trim() ?? "";
  const privateKey = credentials.privateKey?.replace(/\\n/g, "\n").trim() ?? "";
  const installationId = credentials.installationId?.trim() ?? "";
  if (!appId || !privateKey || !/^\d{1,24}$/.test(installationId)) {
    throw new GitHubIntegrationError(
      "GitHub App is not configured. Connect a session-only token or install the configured app.",
      503,
      "GITHUB_CONFIGURATION_REQUIRED",
    );
  }
  const jwt = githubAppJwt(appId, privateKey);
  const scopedRepository = safeRepoPart(repository, "repository");
  const response = await fetchImpl(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      "user-agent": "drops-studio-v2",
      "x-github-api-version": "2022-11-28",
    },
    // A platform GitHub App credential is narrowed to exactly the repository
    // selected by the server-side allowlist before any repository API call.
    body: JSON.stringify({
      repositories: [scopedRepository],
      permissions: {
        contents: "write",
        pull_requests: "write",
        metadata: "read",
      },
    }),
    cache: "no-store",
  });
  let payload: Record<string, unknown> = {};
  try {
    const parsed = await readBoundedProviderJson(response, MAX_GITHUB_TOKEN_RESPONSE_BYTES);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    throw new GitHubIntegrationError(
      "GitHub App installation access returned an invalid response.",
      502,
      "GITHUB_APP_TOKEN_FAILED",
    );
  }
  if (!response.ok || typeof payload.token !== "string") {
    throw new GitHubIntegrationError("GitHub App installation access could not be granted.", response.status || 502, "GITHUB_APP_TOKEN_FAILED");
  }
  return safeToken(payload.token) ?? "";
}

function repositoryPath(owner: string, repo: string): string {
  return `/repos/${safeRepoPart(owner, "owner")}/${safeRepoPart(repo, "repository")}`;
}

export function githubIntegrationReadiness(env: NodeJS.ProcessEnv = process.env) {
  const allowedRepositories = (env.GITHUB_APP_ALLOWED_REPOSITORIES ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/.test(value));
  const appConfigured = Boolean(
    env.GITHUB_APP_ID?.trim() &&
      env.GITHUB_APP_PRIVATE_KEY?.trim() &&
      env.GITHUB_APP_INSTALLATION_ID?.trim() &&
      allowedRepositories.length,
  );
  return {
    configured: appConfigured,
    mode: appConfigured ? "github-app" as const : "session-token-required" as const,
    permissions: ["contents:write", "pull_requests:write", "metadata:read"],
  };
}

export async function inspectGitHubRepository(input: {
  credentials: GitHubIntegrationCredentials;
  owner: string;
  repo: string;
  fetchImpl?: FetchLike;
}): Promise<GitHubRepositoryState> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await installationToken(input.credentials, fetchImpl, input.repo);
  const payload = await requestJson(repositoryPath(input.owner, input.repo), token, fetchImpl);
  const owner = safeRepoPart(input.owner, "owner");
  const repo = safeRepoPart(input.repo, "repository");
  return {
    owner,
    repo,
    defaultBranch: typeof payload.default_branch === "string" ? payload.default_branch : "main",
    private: payload.private === true,
    url: typeof payload.html_url === "string" ? payload.html_url : `https://github.com/${owner}/${repo}`,
  };
}

export async function importGitHubRepository(input: {
  credentials: GitHubIntegrationCredentials;
  owner: string;
  repo: string;
  branch?: string;
  fetchImpl?: FetchLike;
}): Promise<{ repository: GitHubRepositoryState; files: GitHubProjectFile[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await installationToken(input.credentials, fetchImpl, input.repo);
  const repository = await inspectGitHubRepository({ ...input, fetchImpl });
  const branch = input.branch?.trim() || repository.defaultBranch;
  const tree = await requestJson(`${repositoryPath(input.owner, input.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token, fetchImpl);
  if (tree.truncated === true) {
    throw new GitHubIntegrationError("The repository tree is truncated and cannot be imported safely.", 413, "GITHUB_IMPORT_TOO_LARGE");
  }
  const entries = Array.isArray(tree.tree) ? tree.tree : [];
  const blobs = entries.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return item.type === "blob" && typeof item.path === "string" && typeof item.sha === "string";
  });
  if (!blobs.length || blobs.length > MAX_FILES) {
    throw new GitHubIntegrationError("The repository exceeds the bounded import file count.", 413, "GITHUB_IMPORT_TOO_LARGE");
  }
  const announcedBytes = blobs.reduce((total, entry) => {
    const size = Number(entry.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES) {
      throw new GitHubIntegrationError("The repository contains an unbounded file.", 413, "GITHUB_IMPORT_TOO_LARGE");
    }
    return total + size;
  }, 0);
  if (announcedBytes > MAX_BYTES) {
    throw new GitHubIntegrationError("The repository exceeds the bounded import size.", 413, "GITHUB_IMPORT_TOO_LARGE");
  }
  const files: GitHubProjectFile[] = [];
  let actualBytes = 0;
  for (let offset = 0; offset < blobs.length; offset += IMPORT_CONCURRENCY) {
    const batch = await Promise.all(blobs.slice(offset, offset + IMPORT_CONCURRENCY).map(async (entry) => {
      const path = safePath(String(entry.path));
      const blob = await requestJson(`${repositoryPath(input.owner, input.repo)}/git/blobs/${encodeURIComponent(String(entry.sha))}`, token, fetchImpl);
      if (blob.encoding !== "base64" || typeof blob.content !== "string") {
        throw new GitHubIntegrationError(`Unsupported repository file: ${path}.`, 422, "GITHUB_BINARY_UNSUPPORTED");
      }
      const encoded = blob.content.replace(/\s/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
        throw new GitHubIntegrationError(`Unsupported repository file: ${path}.`, 422, "GITHUB_BINARY_UNSUPPORTED");
      }
      const bytes = Buffer.from(encoded, "base64");
      if (
        bytes.includes(0) ||
        bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
      ) {
        throw new GitHubIntegrationError(`Binary repository file is not supported: ${path}.`, 422, "GITHUB_BINARY_UNSUPPORTED");
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new GitHubIntegrationError(`Binary repository file is not supported: ${path}.`, 422, "GITHUB_BINARY_UNSUPPORTED");
      }
      return { path, content, bytes: bytes.byteLength };
    }));
    for (const file of batch) {
      actualBytes += file.bytes;
      if (actualBytes > MAX_BYTES) {
        throw new GitHubIntegrationError("The repository exceeds the bounded import size.", 413, "GITHUB_IMPORT_TOO_LARGE");
      }
      files.push({ path: file.path, content: file.content });
    }
  }
  return { repository, files: boundedFiles(files) };
}

export async function publishProjectToGitHub(input: {
  credentials: GitHubIntegrationCredentials;
  owner: string;
  repo: string;
  files: readonly GitHubProjectFile[];
  conversationId: string;
  title: string;
  description: string;
  baseBranch?: string;
  fetchImpl?: FetchLike;
}): Promise<GitHubPublishResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await installationToken(input.credentials, fetchImpl, input.repo);
  const repository = await inspectGitHubRepository({ ...input, fetchImpl });
  const base = input.baseBranch?.trim() || repository.defaultBranch;
  const branch = `drops-studio/${safeBranchSuffix(input.conversationId)}`;
  const repoPath = repositoryPath(input.owner, input.repo);
  const reference = await requestJson(`${repoPath}/git/ref/heads/${encodeURIComponent(base)}`, token, fetchImpl);
  const baseSha = reference.object && typeof reference.object === "object"
    ? String((reference.object as Record<string, unknown>).sha ?? "")
    : "";
  if (!/^[a-f0-9]{40}$/i.test(baseSha)) throw new GitHubIntegrationError("The repository base branch is invalid.", 422, "GITHUB_BASE_INVALID");

  await requestJson(`${repoPath}/git/refs`, token, fetchImpl, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  const baseCommit = await requestJson(`${repoPath}/git/commits/${baseSha}`, token, fetchImpl);
  const baseTree = baseCommit.tree && typeof baseCommit.tree === "object"
    ? String((baseCommit.tree as Record<string, unknown>).sha ?? "")
    : "";
  if (!/^[a-f0-9]{40}$/i.test(baseTree)) throw new GitHubIntegrationError("The repository base tree is invalid.", 422, "GITHUB_BASE_INVALID");

  const files = boundedFiles(input.files);
  const treeEntries = await Promise.all(files.map(async (file) => {
    const blob = await requestJson(`${repoPath}/git/blobs`, token, fetchImpl, {
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
    });
    const sha = String(blob.sha ?? "");
    if (!/^[a-f0-9]{40}$/i.test(sha)) throw new GitHubIntegrationError("GitHub returned an invalid blob.", 502, "GITHUB_RESPONSE_INVALID");
    return { path: file.path, mode: "100644", type: "blob", sha };
  }));
  const tree = await requestJson(`${repoPath}/git/trees`, token, fetchImpl, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
  });
  const treeSha = String(tree.sha ?? "");
  const commit = await requestJson(`${repoPath}/git/commits`, token, fetchImpl, {
    method: "POST",
    body: JSON.stringify({
      message: `Build ${input.title.slice(0, 80)} with Drops Studio`,
      tree: treeSha,
      parents: [baseSha],
    }),
  });
  const commitSha = String(commit.sha ?? "");
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new GitHubIntegrationError("GitHub returned an invalid commit.", 502, "GITHUB_RESPONSE_INVALID");
  await requestJson(`${repoPath}/git/refs/heads/${encodeURIComponent(branch)}`, token, fetchImpl, {
    method: "PATCH",
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  const pull = await requestJson(`${repoPath}/pulls`, token, fetchImpl, {
    method: "POST",
    body: JSON.stringify({
      title: input.title.slice(0, 120),
      body: `${input.description.slice(0, 4_000)}\n\nGenerated by Drops Studio V2. External actions remain reviewable before merge.`,
      head: branch,
      base,
      draft: false,
    }),
  });
  const number = Number(pull.number);
  if (!Number.isSafeInteger(number) || number <= 0) throw new GitHubIntegrationError("GitHub returned an invalid pull request.", 502, "GITHUB_RESPONSE_INVALID");
  return {
    branch,
    commitSha,
    commitUrl: typeof commit.html_url === "string" ? commit.html_url : `https://github.com/${repository.owner}/${repository.repo}/commit/${commitSha}`,
    pullRequestNumber: number,
    pullRequestUrl: typeof pull.html_url === "string" ? pull.html_url : `https://github.com/${repository.owner}/${repository.repo}/pull/${number}`,
    status: "pull-request-open",
  };
}
