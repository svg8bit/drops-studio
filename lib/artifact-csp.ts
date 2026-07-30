const PROJECT_ARTIFACT_BASE_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
] as const;

export const PROJECT_ARTIFACT_META_CSP =
  PROJECT_ARTIFACT_BASE_DIRECTIVES.join("; ");

export const PROJECT_ARTIFACT_CSP = [
  ...PROJECT_ARTIFACT_BASE_DIRECTIVES,
  "frame-ancestors 'self'",
].join("; ");

/** Header-only policy for a public runtime, including direct URL visits. */
export const PROJECT_PUBLIC_RUNTIME_CSP = [
  ...PROJECT_ARTIFACT_BASE_DIRECTIVES,
  "sandbox allow-scripts allow-forms allow-downloads",
  "frame-ancestors 'self'",
].join("; ");

export const PROJECT_WORKSPACE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export function addProjectArtifactCspMeta(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PROJECT_ARTIFACT_META_CSP}">`;
  const head = findHtmlOpeningTag(html, "head");
  if (head) {
    return `${html.slice(0, head.end)}${meta}${html.slice(head.end)}`;
  }
  const root = findHtmlOpeningTag(html, "html");
  if (!root) {
    throw new Error("Artifact CSP requires a complete, well-formed html opening tag.");
  }
  return `${html.slice(0, root.end)}<head>${meta}</head>${html.slice(root.end)}`;
}
import { findHtmlOpeningTag } from "./html-opening-tag.ts";
