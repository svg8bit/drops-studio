import { dirname, posix } from "node:path";

import type {
  StabilizerFixer,
  StabilizerFixerMode,
  StabilizerFixerProposal,
} from "./types.ts";

const LUCIDE_SAFE_MAP = Object.freeze({
  BrandTwitter: "Twitter",
  XTwitter: "Twitter",
  Telegram: "Send",
  Discord: "MessageCircle",
  CryptoToken: "Coins",
} as const);

function replaceLucideComponent(content: string, from: string, to: string): string {
  const importExpression = new RegExp(
    `(import\\s*\\{[^}]*?)\\b${from}\\b([^}]*\\}\\s*from\\s*["']lucide-react["'])`,
  );
  if (!importExpression.test(content) || !new RegExp(`<\\/?${from}\\b`).test(content)) {
    return content;
  }
  return content
    .replace(importExpression, `$1${to}$2`)
    .replace(new RegExp(`<${from}\\b`, "g"), `<${to}`)
    .replace(new RegExp(`</${from}\\b`, "g"), `</${to}`);
}

const lucideIconFixer: StabilizerFixer = {
  id: "lucide-curated-icon-map",
  version: "1.0.0",
  defaultMode: "shadow",
  propose(context) {
    if (!/from\s+["']lucide-react["']/.test(context.content)) return null;
    let content = context.content;
    const mapped: string[] = [];
    for (const [from, to] of Object.entries(LUCIDE_SAFE_MAP)) {
      if (!new RegExp(`\\b${from}\\b`).test(content)) continue;
      content = replaceLucideComponent(content, from, to);
      mapped.push(`${from}->${to}`);
    }
    return mapped.length && content !== context.content
      ? proposal(this, context.path, content, `CURATED_LUCIDE_MAP:${mapped.sort().join(",")}`)
      : null;
  },
};

const publicAssetFixer: StabilizerFixer = {
  id: "next-public-asset-path",
  version: "1.0.0",
  defaultMode: "shadow",
  propose(context) {
    let content = context.content;
    const replacements = new Set<string>();
    for (const match of context.content.matchAll(/(["'`])\/public\/([A-Za-z0-9@._+()[\]\/-]+)\1/g)) {
      const relative = match[2];
      if (!context.projectFiles[`public/${relative}`]) continue;
      content = content.replaceAll(match[0], `${match[1]}/${relative}${match[1]}`);
      replacements.add(relative);
    }
    return replacements.size && content !== context.content
      ? proposal(this, context.path, content, `NEXT_PUBLIC_ROOT:${[...replacements].sort().join(",")}`)
      : null;
  },
};

const relativeDataExtensionFixer: StabilizerFixer = {
  id: "relative-data-extension",
  version: "1.0.0",
  defaultMode: "shadow",
  propose(context) {
    let content = context.content;
    const changes: string[] = [];
    const expressions = [
      /\bfrom\s*(["'])(\.\.?\/[A-Za-z0-9@._+()[\]\/-]+)\1/g,
      /\bimport\s*(["'])(\.\.?\/[A-Za-z0-9@._+()[\]\/-]+)\1/g,
    ];
    for (const expression of expressions) {
      for (const match of context.content.matchAll(expression)) {
        const specifier = match[2];
        if (/\.[A-Za-z0-9]+$/.test(specifier)) continue;
        const base = posix.normalize(posix.join(dirname(context.path), specifier));
        const allCandidates = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", "/index.ts", "/index.tsx"]
          .map((extension) => `${base}${extension}`)
          .filter((path) => context.projectFiles[path] !== undefined);
        const candidates = allCandidates.filter((path) => /\.(?:json|css)$/.test(path));
        if (allCandidates.length !== 1 || candidates.length !== 1) continue;
        const extension = candidates[0].slice(base.length);
        const replaced = match[0].replace(specifier, `${specifier}${extension}`);
        content = content.replaceAll(match[0], replaced);
        changes.push(`${specifier}->${specifier}${extension}`);
      }
    }
    return changes.length && content !== context.content
      ? proposal(this, context.path, content, `RELATIVE_DATA_EXTENSION:${changes.sort().join(",")}`)
      : null;
  },
};

const duplicateDependencyFixer: StabilizerFixer = {
  id: "package-duplicate-dependency",
  version: "1.0.0",
  defaultMode: "shadow",
  propose(context) {
    if (context.path !== "package.json") return null;
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(context.content) as Record<string, unknown>;
    } catch {
      return null;
    }
    const dependencies = objectStrings(manifest.dependencies);
    const devDependencies = objectStrings(manifest.devDependencies);
    const duplicates = Object.keys(dependencies).filter(
      (name) => devDependencies[name] === dependencies[name],
    );
    if (!duplicates.length) return null;
    for (const name of duplicates) delete devDependencies[name];
    manifest.devDependencies = devDependencies;
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    return proposal(
      this,
      context.path,
      content,
      `DUPLICATE_DEPENDENCY:${duplicates.sort().join(",")}`,
    );
  },
};

function objectStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function proposal(
  fixer: StabilizerFixer,
  path: string,
  content: string,
  reasonCode: string,
): StabilizerFixerProposal {
  return {
    fixerId: fixer.id,
    version: fixer.version,
    reasonCode,
    path,
    content,
  };
}

export const STABILIZER_FIXERS: readonly StabilizerFixer[] = Object.freeze([
  duplicateDependencyFixer,
  lucideIconFixer,
  publicAssetFixer,
  relativeDataExtensionFixer,
]);

export class StabilizerFixerRegistry {
  readonly #fixers: Map<string, StabilizerFixer>;

  constructor(fixers: readonly StabilizerFixer[] = STABILIZER_FIXERS) {
    this.#fixers = new Map();
    for (const fixer of fixers) {
      if (this.#fixers.has(fixer.id)) throw new Error(`Duplicate stabilizer fixer: ${fixer.id}`);
      this.#fixers.set(fixer.id, fixer);
    }
  }

  list(): StabilizerFixer[] {
    return [...this.#fixers.values()]
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  modeFor(
    fixer: StabilizerFixer,
    overrides: Record<string, StabilizerFixerMode | undefined>,
  ): StabilizerFixerMode {
    return overrides[fixer.id] ?? fixer.defaultMode;
  }
}

export const DEFAULT_STABILIZER_FIXER_REGISTRY = new StabilizerFixerRegistry();
