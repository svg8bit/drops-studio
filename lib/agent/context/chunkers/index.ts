import type { ChunkDraft, ContextSource } from "../types.ts";
import { chunkCodeSource } from "./code.ts";
import { chunkMarkdownSource } from "./markdown.ts";
import { chunkOpenApiSource } from "./openapi.ts";
import { normalizeContextText } from "../utils.ts";

export function chunkContextSource(source: ContextSource): ChunkDraft[] {
  if (source.sourceType === "code") return chunkCodeSource(source);
  if (source.sourceType === "markdown" || source.sourceType === "skill" || source.sourceType === "design-reference" || source.sourceType === "memory") {
    return chunkMarkdownSource(source);
  }
  if (source.sourceType === "openapi") return chunkOpenApiSource(source);
  const content = normalizeContextText(source.content);
  return content ? [{ content, ordinal: 0, path: source.path, language: source.language, lineStart: 1, lineEnd: source.content.split("\n").length }] : [];
}
