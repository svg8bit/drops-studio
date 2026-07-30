import { assertPublishedArtifactSafe } from "./artifact-security.ts";
import { unexpectedRuntimeActiveContent } from "./runtime-active-content.ts";
import {
  getProductReality,
  studioTelegramConnectionUrl,
} from "./product-reality.ts";
import type { GeneratedProjectSpec } from "./project-types.ts";

export const SOURCE_WORKSPACE_HTML_LIMIT_BYTES = 1_500_000;
const LOOPBACK_ORIGIN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/gi;
const PROJECT_SPEC_MARKER = '<script type="application/json" id="projectSpec">';
const STUDIO_TELEGRAM_URL_ASSIGNMENT = /\bvar studioTelegramUrl=("(?:\\.|[^"\\])*");/g;

export interface SourceWorkspaceValidation {
  valid: boolean;
  issues: string[];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export class PublishedRuntimeBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedRuntimeBindingError";
  }
}

/**
 * Binds a manually edited generated runtime to its server-issued public slug.
 * The bridge continues to reject messages for every other slug; only the two
 * compiler-owned values that address Studio services are changed.
 */
export function bindPublishedRuntimeHtml(
  html: string,
  publishedSpec: GeneratedProjectSpec,
): string {
  const markerAt = html.indexOf(PROJECT_SPEC_MARKER);
  if (markerAt < 0 || markerAt !== html.lastIndexOf(PROJECT_SPEC_MARKER)) {
    throw new PublishedRuntimeBindingError(
      "Edited source must keep exactly one generated projectSpec payload.",
    );
  }
  const payloadAt = markerAt + PROJECT_SPEC_MARKER.length;
  const payloadEnd = html.indexOf("</script>", payloadAt);
  if (payloadEnd < 0) {
    throw new PublishedRuntimeBindingError(
      "Edited source has an incomplete generated projectSpec payload.",
    );
  }

  let embeddedSpec: Record<string, unknown>;
  try {
    const value = JSON.parse(html.slice(payloadAt, payloadEnd)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    embeddedSpec = value as Record<string, unknown>;
  } catch {
    throw new PublishedRuntimeBindingError(
      "Edited source has an unreadable generated projectSpec payload.",
    );
  }

  const reboundPayload = safeJson({
    ...embeddedSpec,
    slug: publishedSpec.slug,
    dataEndpoint: publishedSpec.dataEndpoint,
  });
  let rebound = `${html.slice(0, payloadAt)}${reboundPayload}${html.slice(payloadEnd)}`;
  const telegramAssignments = [...rebound.matchAll(STUDIO_TELEGRAM_URL_ASSIGNMENT)];
  if (telegramAssignments.length !== 1) {
    throw new PublishedRuntimeBindingError(
      "Edited source must keep the generated Telegram handoff binding.",
    );
  }
  const telegramUrl = safeJson(studioTelegramConnectionUrl(
    publishedSpec.dataEndpoint,
    publishedSpec.slug,
  ));
  rebound = rebound.replace(
    STUDIO_TELEGRAM_URL_ASSIGNMENT,
    () => `var studioTelegramUrl=${telegramUrl};`,
  );
  return rebound;
}

/**
 * Makes Studio-generated source safe to edit and run from the current host.
 * Only loopback origins are removed; root-relative product and brand assets
 * intentionally remain root-relative so the srcdoc preview keeps rendering.
 */
export function prepareEditableRuntimeHtml(html: string): string {
  return html.replace(LOOPBACK_ORIGIN, "");
}

export function validateEditableRuntimeHtml(
  spec: GeneratedProjectSpec,
  html: string,
): SourceWorkspaceValidation {
  const issues: string[] = [];
  const source = html.trim();
  if (!source) issues.push("index.html is empty.");
  if (byteLength(source) > SOURCE_WORKSPACE_HTML_LIMIT_BYTES) {
    issues.push("index.html exceeds the 1.5 MB source-workspace limit.");
  }
  if (!/^<!doctype html>/i.test(source)) {
    issues.push("index.html must start with an HTML doctype.");
  }
  if (!/<html(?:\s|>)/i.test(source) || !/<body(?:\s|>)/i.test(source)) {
    issues.push("index.html must contain complete html and body elements.");
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(source)) {
    issues.push("index.html must keep a responsive viewport meta tag.");
  }
  if (!/<title>[\s\S]*?<\/title>/i.test(source)) {
    issues.push("index.html must keep a document title.");
  }
  if (!source.includes(`data-project-kind="${spec.presetId}"`)) {
    issues.push("index.html must keep the generated product-kind contract.");
  }
  const reality = getProductReality(spec.presetId);
  if (!source.includes(`data-delivery-mode="${reality.deliveryMode}"`)) {
    issues.push("index.html must keep the truthful delivery-mode contract.");
  }
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) {
    issues.push("eval and Function constructors are blocked in runnable source.");
  }
  if (/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i.test(source)) {
    issues.push("Runnable source cannot depend on a loopback URL.");
  }
  issues.push(...unexpectedRuntimeActiveContent(source, "compiled-runtime"));
  try {
    assertPublishedArtifactSafe(spec, source);
  } catch (error) {
    issues.push(
      error instanceof Error
        ? error.message
        : "Runnable source contains unsafe release material.",
    );
  }
  return { valid: issues.length === 0, issues };
}
