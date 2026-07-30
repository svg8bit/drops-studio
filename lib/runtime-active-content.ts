export type RuntimeDocumentProfile = "canonical-workspace" | "compiled-runtime";

const CANONICAL_STYLESHEET_LINK =
  '<link rel="stylesheet" href="./src/styles.css">';
const CANONICAL_RUNTIME_SCRIPT = '<script src="./src/app.js"></script>';
const PROJECT_SPEC_OPEN = '<script type="application/json" id="projectSpec">';
const PROJECT_SPEC_ELEMENT =
  /<script type="application\/json" id="projectSpec">([\s\S]*?)<\/script>/g;
const COMPILED_RUNTIME_ELEMENT = /<script>([\s\S]*?)<\/script>/g;
const BLOCKED_ACTIVE_ELEMENTS = new Set([
  "applet",
  "base",
  "embed",
  "frame",
  "frameset",
  "iframe",
  "object",
  "portal",
]);

function htmlAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    "i",
  ).exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function withoutStyleContents(source: string): string {
  return source.replace(
    /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
    "<style></style>",
  );
}

function startTags(source: string): string[] {
  const tags: string[] = [];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] !== "<" || !/[a-z]/i.test(source[offset + 1] ?? "")) {
      continue;
    }
    let quote = "";
    let cursor = offset + 1;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (quote) {
        if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === ">") {
        tags.push(source.slice(offset, cursor + 1));
        offset = cursor;
        break;
      }
    }
  }
  return tags;
}

function removeSingleMatch(
  source: string,
  expression: RegExp,
): { source: string; content: string | null; count: number } {
  expression.lastIndex = 0;
  const matches = [...source.matchAll(expression)];
  expression.lastIndex = 0;
  return {
    source: source.replace(expression, ""),
    content: matches[0]?.[1] ?? null,
    count: matches.length,
  };
}

function validProjectSpecJson(source: string | null): boolean {
  if (!source || source.includes("<")) return false;
  try {
    const value = JSON.parse(source) as unknown;
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  } catch {
    return false;
  }
}

function hasScriptScheme(value: string | null): boolean {
  return /^(?:javascript|vbscript):/i.test(value?.trim() ?? "");
}

/**
 * Enforces the two trusted HTML shapes used by Drops Studio:
 * the editable canonical entry graph and its compiled single-file runtime.
 */
export function unexpectedRuntimeActiveContent(
  html: string,
  profile: RuntimeDocumentProfile,
): string[] {
  const issues: string[] = [];
  let remaining = html;

  const metadata = removeSingleMatch(remaining, PROJECT_SPEC_ELEMENT);
  remaining = metadata.source;
  if (
    metadata.count !== 1 ||
    !validProjectSpecJson(metadata.content) ||
    !html.includes(PROJECT_SPEC_OPEN)
  ) {
    issues.push(
      "Runtime active content must keep exactly one inert projectSpec application/json script.",
    );
  }

  if (profile === "canonical-workspace") {
    const runtimeCount = remaining.split(CANONICAL_RUNTIME_SCRIPT).length - 1;
    remaining = remaining.replace(CANONICAL_RUNTIME_SCRIPT, "");
    if (runtimeCount !== 1) {
      issues.push(
        "Runtime active content must keep exactly one canonical src/app.js script.",
      );
    }
  } else {
    const runtime = removeSingleMatch(remaining, COMPILED_RUNTIME_ELEMENT);
    remaining = runtime.source;
    if (runtime.count !== 1 || !runtime.content?.trim()) {
      issues.push(
        "Compiled runtime active content must contain exactly one classic inline application script.",
      );
    }
  }

  const markup = withoutStyleContents(remaining);
  const tags = startTags(markup);
  if (tags.some((tag) => /^<script\b/i.test(tag))) {
    issues.push("Unexpected script active content is blocked.");
  }

  const linkTags = tags.filter((tag) => /^<link\b/i.test(tag));
  if (
    profile === "canonical-workspace"
      ? linkTags.length !== 1 || linkTags[0] !== CANONICAL_STYLESHEET_LINK
      : linkTags.length !== 0
  ) {
    issues.push(
      "Unexpected link active content is blocked; only the canonical local stylesheet is allowed.",
    );
  }

  for (const tag of tags) {
    const nameMatch = /^<([a-z][a-z0-9:-]*)\b([\s\S]*?)>$/i.exec(tag);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    const attributes = nameMatch[2];

    if (BLOCKED_ACTIVE_ELEMENTS.has(name)) {
      issues.push(`Unexpected ${name} active content is blocked.`);
    }
    if (/(?:^|\s)on[a-z0-9:_-]+\s*=/i.test(attributes)) {
      issues.push("Inline event-handler active content is blocked.");
    }
    if (
      ["href", "src", "action", "formaction", "xlink:href"].some((attribute) =>
        hasScriptScheme(htmlAttribute(attributes, attribute)),
      )
    ) {
      issues.push("javascript: and vbscript: active-content URLs are blocked.");
    }
    if (
      name === "meta" &&
      htmlAttribute(attributes, "http-equiv")?.trim().toLowerCase() === "refresh"
    ) {
      issues.push("Meta refresh active content is blocked.");
    }
    if (
      (name === "form" && htmlAttribute(attributes, "action")?.trim()) ||
      ((name === "button" || name === "input") &&
        htmlAttribute(attributes, "formaction")?.trim())
    ) {
      issues.push("Outbound form active content is blocked.");
    }
  }

  return [...new Set(issues)];
}
