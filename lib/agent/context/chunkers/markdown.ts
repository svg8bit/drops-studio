import type { ChunkDraft, ContextSource } from "../types.ts";
import { normalizeContextText } from "../utils.ts";

interface HeadingStart {
  index: number;
  level: number;
  title: string;
  hierarchy: string[];
}

export function chunkMarkdownSource(source: ContextSource): ChunkDraft[] {
  const lines = source.content.split("\n");
  const headings: HeadingStart[] = [];
  const hierarchy: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim();
    hierarchy.length = level - 1;
    hierarchy[level - 1] = title;
    headings.push({ index, level, title, hierarchy: hierarchy.filter(Boolean) });
  }
  if (!headings.length) {
    const content = normalizeContextText(source.content);
    return content ? [{ content, ordinal: 0, path: source.path, language: source.language, lineStart: 1, lineEnd: lines.length }] : [];
  }
  const drafts: ChunkDraft[] = [];
  if (headings[0].index > 0) {
    const preface = normalizeContextText(lines.slice(0, headings[0].index).join("\n"));
    if (preface) drafts.push({ content: preface, ordinal: drafts.length, path: source.path, language: source.language, headingPath: [], lineStart: 1, lineEnd: headings[0].index });
  }
  for (let position = 0; position < headings.length; position += 1) {
    const heading = headings[position];
    const end = headings[position + 1]?.index ?? lines.length;
    const content = normalizeContextText(lines.slice(heading.index, end).join("\n"));
    if (!content) continue;
    drafts.push({
      content,
      ordinal: drafts.length,
      path: source.path,
      language: source.language,
      headingPath: heading.hierarchy,
      symbol: heading.title,
      lineStart: heading.index + 1,
      lineEnd: end,
    });
  }
  return drafts;
}
