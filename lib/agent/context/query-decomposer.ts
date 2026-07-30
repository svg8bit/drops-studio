import type { RetrievalQuery, RetrievalQueryKind } from "./types.ts";
import { compareContextText, contextSha256, lexicalTerms, stableContextJson } from "./utils.ts";
import { redactContextContent } from "./redaction.ts";

function symbolsFromTask(task: string): string[] {
  const quoted = [...task.matchAll(/[`"']([A-Za-z_$][\w$]{2,})[`"']/g)].map((match) => match[1]);
  const identifiers = task.match(/\b[A-Z][A-Za-z0-9_$]{2,}\b/g) ?? [];
  return [...new Set([...quoted, ...identifiers])].sort(compareContextText).slice(0, 12);
}

function addQuery(entries: Array<Omit<RetrievalQuery, "id">>, kind: RetrievalQueryKind, text: string, symbols: string[] = [], sourceTypes?: RetrievalQuery["sourceTypes"]): void {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return;
  entries.push({ kind, text: normalized, terms: lexicalTerms(normalized), symbols, sourceTypes });
}

export async function decomposeRetrievalQueries(task: string): Promise<RetrievalQuery[]> {
  const boundedTask = redactContextContent(task.trim().slice(0, 12_000)).content;
  if (!boundedTask) throw new Error("Context retrieval task cannot be empty.");
  const symbols = symbolsFromTask(boundedTask);
  const entries: Array<Omit<RetrievalQuery, "id">> = [];
  addQuery(entries, "target-files", `${boundedTask} routes components files imports`, symbols, ["code", "json-schema"]);
  if (symbols.length) addQuery(entries, "symbol-definition", `symbol definitions ${symbols.join(" ")}`, symbols, ["code"]);
  if (/dropstab|drops\s*bot|telegram|wallet|unlock|funding|market cap|fdv|webhook/i.test(boundedTask)) {
    const endpoints = boundedTask.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[^\s,;]+|\/api\/[A-Za-z0-9_./{}:-]+/gi) ?? [];
    addQuery(entries, "integration-endpoint", `${boundedTask} documented endpoint method path auth limitations ${endpoints.join(" ")}`, [], ["openapi", "markdown"]);
  }
  if (/error|failed|exception|stack|typeerror|cannot find|diagnostic/i.test(boundedTask)) {
    addQuery(entries, "error-diagnosis", `${boundedTask} exact error stack changed files repair`, symbols, ["runtime-log", "browser-report", "test-report", "code"]);
  }
  if (/security|secret|token|permission|webhook|signature|ssrf|approval/i.test(boundedTask)) {
    addQuery(entries, "security-policy", `${boundedTask} security policy approval secrets verification`, [], ["markdown", "skill", "code"]);
  }
  if (/design|layout|responsive|mobile|component|ui|accessib/i.test(boundedTask)) {
    addQuery(entries, "design-rule", `${boundedTask} design tokens component rules accessibility viewport`, [], ["design-reference", "markdown", "skill"]);
  }
  addQuery(entries, "project-architecture", `${boundedTask} project architecture manifest accepted decisions`, [], ["code", "markdown", "memory"]);
  addQuery(entries, "test-pattern", `${boundedTask} test smoke verification expected behavior`, symbols, ["code", "test-report", "markdown"]);

  const unique = new Map<string, Omit<RetrievalQuery, "id">>();
  for (const entry of entries) unique.set(stableContextJson([entry.kind, entry.text, entry.symbols]), entry);
  const sorted = [...unique.values()].sort((left, right) => compareContextText(left.kind, right.kind) || compareContextText(left.text, right.text));
  return Promise.all(sorted.map(async (entry) => ({ ...entry, id: (await contextSha256(stableContextJson(entry))).slice(0, 24) })));
}
