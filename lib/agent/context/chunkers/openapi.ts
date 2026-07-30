import type { ChunkDraft, ContextEndpointMetadata, ContextSource } from "../types.ts";
import { normalizeContextText, stableContextJson } from "../utils.ts";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function providerFor(source: ContextSource): string {
  const provider = source.metadata?.provider;
  return typeof provider === "string" && provider.trim() ? provider.trim() : "unknown";
}

function authenticationMode(document: Record<string, unknown>, operation: Record<string, unknown>): string {
  const security = operation.security ?? document.security;
  if (!Array.isArray(security) || !security.length) return "none-documented";
  const names = security.flatMap((entry) => Object.keys(objectRecord(entry) ?? {}));
  return names.length ? names.sort().join("+") : "documented-security";
}

function chunksFromJson(source: ContextSource, document: Record<string, unknown>): ChunkDraft[] {
  const paths = objectRecord(document.paths) ?? {};
  const drafts: ChunkDraft[] = [];
  for (const endpointPath of Object.keys(paths).sort()) {
    const pathItem = objectRecord(paths[endpointPath]);
    if (!pathItem) continue;
    for (const method of Object.keys(pathItem).sort()) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const operation = objectRecord(pathItem[method]);
      if (!operation) continue;
      const operationId = typeof operation.operationId === "string" ? operation.operationId : undefined;
      const limitations = stringArray(operation["x-limitations"] ?? operation["x-drops-limitations"]);
      const capabilityTags = stringArray(operation.tags ?? operation["x-capability-tags"]);
      const endpoint: ContextEndpointMetadata = {
        provider: providerFor(source),
        method: method.toUpperCase(),
        path: endpointPath,
        operationId,
        authMode: authenticationMode(document, operation),
        capabilityTags,
        limitations,
      };
      const content = normalizeContextText([
        `${endpoint.method} ${endpoint.path}`,
        operationId ? `operationId: ${operationId}` : "",
        `provider: ${endpoint.provider}`,
        `authMode: ${endpoint.authMode}`,
        capabilityTags.length ? `capabilities: ${capabilityTags.join(", ")}` : "",
        limitations.length ? `limitations: ${limitations.join("; ")}` : "",
        `operation: ${stableContextJson(operation)}`,
      ].filter(Boolean).join("\n"));
      drafts.push({ content, ordinal: drafts.length, path: source.path, language: "json", symbol: operationId, endpoint });
    }
  }
  return drafts;
}

function chunksFromYaml(source: ContextSource): ChunkDraft[] {
  const lines = source.content.split("\n");
  const drafts: ChunkDraft[] = [];
  let currentPath: { value: string; index: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const pathMatch = lines[index].match(/^\s{2}(\/[^:]+):\s*$/u);
    if (pathMatch) {
      currentPath = { value: pathMatch[1].trim(), index };
      continue;
    }
    const methodMatch = lines[index].match(/^\s{4}(get|post|put|patch|delete|head|options|trace):\s*$/iu);
    if (!currentPath || !methodMatch) continue;
    let end = index + 1;
    while (end < lines.length && !/^\s{2}\/[^:]+:\s*$/u.test(lines[end]) && !/^\s{4}(?:get|post|put|patch|delete|head|options|trace):\s*$/iu.test(lines[end])) end += 1;
    const body = lines.slice(index, end).join("\n");
    const operationId = body.match(/^\s{6,}operationId:\s*["']?([^\s"']+)/mu)?.[1];
    const method = methodMatch[1].toUpperCase();
    const endpoint: ContextEndpointMetadata = {
      provider: providerFor(source),
      method,
      path: currentPath.value,
      operationId,
      authMode: /\n\s{6,}security:/u.test(`\n${body}`) ? "documented-security" : "none-documented",
      capabilityTags: [],
      limitations: [],
    };
    drafts.push({
      content: normalizeContextText(`${method} ${currentPath.value}\nprovider: ${endpoint.provider}\n${body}`),
      ordinal: drafts.length,
      path: source.path,
      language: "yaml",
      symbol: operationId,
      endpoint,
      lineStart: index + 1,
      lineEnd: end,
    });
  }
  return drafts;
}

export function chunkOpenApiSource(source: ContextSource): ChunkDraft[] {
  try {
    const document = objectRecord(JSON.parse(source.content));
    if (document) return chunksFromJson(source, document);
  } catch {
    // YAML and incomplete provider documents use the bounded structural parser below.
  }
  return chunksFromYaml(source);
}
