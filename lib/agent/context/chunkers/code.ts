import type { ChunkDraft, ContextSource } from "../types.ts";
import { normalizeContextText } from "../utils.ts";

const declarationPattern = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;
const routePattern = /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/;
const MAX_CHUNK_LINES = 180;

function blockCommentEnd(lines: string[], start: number): number {
  let index = start;
  while (index < lines.length && !lines[index].includes("*/")) index += 1;
  return Math.min(index + 1, lines.length);
}

function importEnd(lines: string[], start: number): number {
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (/;\s*(?:\/\/.*)?$/u.test(line)
      || /^\s*import\s+["'][^"']+["']\s*$/u.test(line)
      || /\bfrom\s+["'][^"']+["']\s*$/u.test(line)) return index + 1;
    index += 1;
  }
  return lines.length;
}

function modulePreamble(lines: string[]): string[] {
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("//")) {
      index += 1;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      index = blockCommentEnd(lines, index);
      continue;
    }
    break;
  }
  let end = index;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index += 1;
      end = index;
      continue;
    }
    if (/^["'][^"']+["'];?$/u.test(trimmed)) {
      index += 1;
      end = index;
      continue;
    }
    if (/^import\b/u.test(trimmed) || /^(?:const|let|var)\s+.+?=\s*require\(/u.test(trimmed)) {
      index = importEnd(lines, index);
      end = index;
      continue;
    }
    break;
  }
  return lines.slice(0, end);
}

function attachedCommentStart(lines: string[], declarationIndex: number): number {
  let cursor = declarationIndex - 1;
  while (cursor >= 0 && !lines[cursor].trim()) cursor -= 1;
  if (cursor < 0) return declarationIndex;
  if (lines[cursor].trim().startsWith("//")) {
    while (cursor >= 0 && lines[cursor].trim().startsWith("//")) cursor -= 1;
    return cursor + 1;
  }
  if (lines[cursor].trim().endsWith("*/")) {
    while (cursor >= 0 && !lines[cursor].includes("/*")) cursor -= 1;
    if (cursor >= 0) return cursor;
  }
  return declarationIndex;
}

function fallbackChunks(lines: string[], path?: string, language?: string): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  for (let start = 0; start < lines.length; start += MAX_CHUNK_LINES) {
    const end = Math.min(lines.length, start + MAX_CHUNK_LINES);
    const content = normalizeContextText(lines.slice(start, end).join("\n"));
    if (content) chunks.push({ content, ordinal: chunks.length, path, language, lineStart: start + 1, lineEnd: end });
  }
  return chunks;
}

export function chunkCodeSource(source: ContextSource): ChunkDraft[] {
  const lines = source.content.split("\n");
  const imports = modulePreamble(lines);
  const starts: Array<{ index: number; symbol: string; commentStart: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(routePattern) ?? lines[index].match(declarationPattern);
    if (match && index >= imports.length) starts.push({ index, symbol: match[1], commentStart: attachedCommentStart(lines, index) });
  }
  if (!starts.length) return fallbackChunks(lines, source.path, source.language);

  const drafts: ChunkDraft[] = [];
  for (let position = 0; position < starts.length; position += 1) {
    const current = starts[position];
    const end = starts[position + 1]?.commentStart ?? lines.length;
    const commentStart = current.commentStart;
    const body = lines.slice(commentStart, end);
    const prefix = imports.length && commentStart >= imports.length ? [...imports, ""] : [];
    if (body.length <= MAX_CHUNK_LINES) {
      drafts.push({
        content: normalizeContextText([...prefix, ...body].join("\n")),
        ordinal: drafts.length,
        path: source.path,
        language: source.language,
        symbol: current.symbol,
        lineStart: commentStart + 1,
        lineEnd: end,
      });
      continue;
    }
    for (let offset = 0; offset < body.length; offset += MAX_CHUNK_LINES) {
      const segment = body.slice(offset, offset + MAX_CHUNK_LINES);
      drafts.push({
        content: normalizeContextText([...(offset === 0 ? prefix : []), ...segment].join("\n")),
        ordinal: drafts.length,
        path: source.path,
        language: source.language,
        symbol: current.symbol,
        lineStart: commentStart + offset + 1,
        lineEnd: Math.min(end, commentStart + offset + segment.length),
      });
    }
  }
  return drafts.filter((draft) => draft.content.length > 0);
}
