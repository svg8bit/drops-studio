import type { PromptInjectionFlag, RedactionFinding, RedactionResult } from "./types.ts";

interface RedactionPattern {
  kind: string;
  placeholder: string;
  expression: RegExp;
}

const REDACTION_VERSION = "context-redaction-v1";

const patterns: RedactionPattern[] = [
  { kind: "TELEGRAM_BOT_TOKEN", placeholder: "[REDACTED:TELEGRAM_BOT_TOKEN]", expression: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g },
  { kind: "JWT", placeholder: "[REDACTED:JWT]", expression: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b/g },
  { kind: "GITHUB_TOKEN", placeholder: "[REDACTED:GITHUB_TOKEN]", expression: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { kind: "VERCEL_TOKEN", placeholder: "[REDACTED:VERCEL_TOKEN]", expression: /\b(?:vercel|vca)_[A-Za-z0-9_-]{20,}\b/gi },
  { kind: "AWS_ACCESS_KEY", placeholder: "[REDACTED:AWS_ACCESS_KEY]", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: "PRIVATE_KEY", placeholder: "[REDACTED:PRIVATE_KEY]", expression: /-----BEGIN (?:ENCRYPTED |RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:ENCRYPTED |RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: "PROVIDER_API_KEY", placeholder: "[REDACTED:PROVIDER_API_KEY]", expression: /\b(?:sk-(?:(?:proj|ant|or-v1)-)?[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/g },
  { kind: "GENERIC_BEARER", placeholder: "[REDACTED:GENERIC_BEARER]", expression: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi },
  {
    kind: "SECRET_ASSIGNMENT",
    placeholder: "[REDACTED:SECRET_ASSIGNMENT]",
    expression: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|secret)\s*[=:]\s*["']?[A-Za-z0-9._~:/+=-]{20,}["']?/gi,
  },
];

const injectionPatterns: Array<{ flag: PromptInjectionFlag; expression: RegExp }> = [
  { flag: "instruction-override", expression: /\b(?:ignore|override|replace|forget)\b[\s\S]{0,48}\b(?:system|developer|previous|higher[- ]priority)\b[\s\S]{0,24}\b(?:instruction|prompt|rule)/i },
  { flag: "secret-exfiltration", expression: /\b(?:print|reveal|exfiltrate|send|upload)\b[\s\S]{0,48}\b(?:secret|token|credential|api key|environment)/i },
  { flag: "unauthorized-tool", expression: /\b(?:run|execute|call)\b[\s\S]{0,40}\b(?:shell|terminal|tool|command)\b[\s\S]{0,40}\b(?:outside|without approval|unrestricted)/i },
  { flag: "provider-or-billing-change", expression: /\b(?:switch|change|charge|bill)\b[\s\S]{0,48}\b(?:provider|billing|subscription|model)/i },
  { flag: "external-publication", expression: /\b(?:publish|deploy|push|send to telegram|open pull request)\b[\s\S]{0,48}\b(?:without approval|immediately|silently)/i },
  { flag: "disable-checks", expression: /\b(?:disable|skip|bypass|remove)\b[\s\S]{0,48}\b(?:test|check|lint|security|verification|guardrail)/i },
  { flag: "conceal-failure", expression: /\b(?:hide|conceal|omit|do not report)\b[\s\S]{0,48}\b(?:failure|error|warning|failed test)/i },
];

export function contextRedactionVersion(): string {
  return REDACTION_VERSION;
}

export function detectPromptInjection(content: string): PromptInjectionFlag[] {
  return injectionPatterns
    .filter(({ expression }) => expression.test(content))
    .map(({ flag }) => flag);
}

export function redactEnvironmentValues(content: string): string {
  return content.replace(
    /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(?!\[REDACTED:)(.*)$/gm,
    (_match, prefix: string, value: string) => value.trim() ? `${prefix}[REDACTED:ENV_VALUE]` : prefix,
  );
}

export function redactContextContent(input: string, options: { environmentFile?: boolean } = {}): RedactionResult {
  let content = input.replace(/\r\n?/g, "\n");
  const findings: RedactionFinding[] = [];
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    const matches = content.match(pattern.expression);
    if (!matches?.length) continue;
    content = content.replace(pattern.expression, pattern.placeholder);
    findings.push({ kind: pattern.kind, placeholder: pattern.placeholder, count: matches.length });
  }
  if (options.environmentFile) {
    const environmentValues = [...content.matchAll(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?!\[REDACTED:)(.+)$/gm)]
      .filter((match) => match[1].trim()).length;
    content = redactEnvironmentValues(content);
    if (environmentValues) findings.push({ kind: "ENV_VALUE", placeholder: "[REDACTED:ENV_VALUE]", count: environmentValues });
  }
  return { content, findings, injectionFlags: detectPromptInjection(content) };
}
