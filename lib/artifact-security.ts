export type ArtifactSecretKind =
  | "telegram-bot-token"
  | "jwt"
  | "github-token"
  | "aws-access-key"
  | "provider-api-key"
  | "bearer-token"
  | "secret-assignment";

export interface ArtifactSecretFinding {
  kind: ArtifactSecretKind;
  location: string;
  preview: string;
}

interface SecretPattern {
  kind: ArtifactSecretKind;
  expression: RegExp;
}

const secretPatterns: SecretPattern[] = [
  { kind: "telegram-bot-token", expression: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g },
  { kind: "jwt", expression: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b/g },
  { kind: "github-token", expression: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: "aws-access-key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: "provider-api-key", expression: /\b(?:sk-(?:(?:proj|ant|or-v1)-)?[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g },
  { kind: "bearer-token", expression: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi },
  {
    kind: "secret-assignment",
    expression: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|secret)\s*[=:]\s*["']?([A-Za-z0-9._~:/+=-]{20,})["']?/gi,
  },
];

function redactedPreview(kind: ArtifactSecretKind): string {
  return `[redacted ${kind}]`;
}

export function findArtifactSecrets(text: string, location = "artifact"): ArtifactSecretFinding[] {
  const findings: ArtifactSecretFinding[] = [];
  for (const pattern of secretPatterns) {
    pattern.expression.lastIndex = 0;
    const matchCount = [...text.matchAll(pattern.expression)].length;
    for (let index = 0; index < matchCount; index += 1) {
      findings.push({ kind: pattern.kind, location, preview: redactedPreview(pattern.kind) });
    }
  }
  return findings;
}

export class ArtifactSecretError extends Error {
  readonly locations: string[];
  readonly kinds: ArtifactSecretKind[];

  constructor(findings: ArtifactSecretFinding[]) {
    const locations = [...new Set(findings.map((finding) => finding.location))];
    super(`Potential secret material was found in ${locations.length} release artifact${locations.length === 1 ? "" : "s"}. Remove it and connect credentials through the session-only vault.`);
    this.name = "ArtifactSecretError";
    this.locations = locations;
    this.kinds = [...new Set(findings.map((finding) => finding.kind))];
  }
}

export function assertProjectPayloadSafe(value: unknown, location = "project payload"): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("The project payload must be serializable before release.");
  }
  const findings = findArtifactSecrets(serialized, location);
  if (findings.length) throw new ArtifactSecretError(findings);
}

export function assertArtifactFilesSafe(files: Record<string, Uint8Array>): void {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const findings = Object.entries(files).flatMap(([name, content]) =>
    findArtifactSecrets(decoder.decode(content), name),
  );
  if (findings.length) throw new ArtifactSecretError(findings);
}

export function assertPublishedArtifactSafe(spec: unknown, html: string): void {
  assertProjectPayloadSafe(spec, "published project spec");
  const findings = findArtifactSecrets(html, "published index.html");
  if (findings.length) throw new ArtifactSecretError(findings);
}
