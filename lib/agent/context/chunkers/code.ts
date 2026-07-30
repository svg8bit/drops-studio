import type { ChunkDraft, ContextSource } from "../types.ts";
import { normalizeContextText } from "../utils.ts";

const declarationPattern = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;
const routePattern = /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/;
const MAX_CHUNK_LINES = 180;

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
  const imports: string[] = [];
  for (const line of lines) {
    if (/^\s*(?:import\b|(?:const|let|var)\s+.+?=\s*require\()/u.test(line)) imports.push(line);
    else if (line.trim() && !line.trim().startsWith("//")) break;
  }
  const starts: Array<{ index: number; symbol: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(routePattern) ?? lines[index].match(declarationPattern);
    if (match) starts.push({ index, symbol: match[1] });
  }
  if (!starts.length) return fallbackChunks(lines, source.path, source.language);

  const drafts: ChunkDraft[] = [];
  for (let position = 0; position < starts.length; position += 1) {
    const current = starts[position];
    const end = starts[position + 1]?.index ?? lines.length;
    const commentStart = (() => {
      let cursor = current.index - 1;
      while (cursor >= 0 && (lines[cursor].trim().startsWith("//") || lines[cursor].trim().startsWith("*") || lines[cursor].trim().startsWith("/*") || !lines[cursor].trim())) cursor -= 1;
      return cursor + 1;
    })();
    const body = lines.slice(commentStart, end);
    const prefix = imports.length && commentStart > imports.length ? [...imports, ""] : [];
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
