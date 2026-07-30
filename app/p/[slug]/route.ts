import { getPublishedProject } from "@/db/projects";
import {
  addProjectArtifactCspMeta,
  PROJECT_PUBLIC_RUNTIME_CSP,
} from "@/lib/artifact-csp";
import {
  buildPublicProjectShell,
  publicProjectShellCsp,
} from "@/lib/public-project-shell";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{4,72}$/.test(slug)) return new Response("Project not found", { status: 404 });
  try {
    const project = await getPublishedProject(slug);
    if (!project) return new Response("Project not found", { status: 404 });
    const runtimeRequest = new URL(request.url).searchParams.get("runtime") === "1";
    if (runtimeRequest) {
      return new Response(addProjectArtifactCspMeta(project.html), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, max-age=0",
          "content-security-policy": PROJECT_PUBLIC_RUNTIME_CSP,
          "cross-origin-resource-policy": "same-origin",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-frame-options": "SAMEORIGIN",
        },
      });
    }
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const shell = buildPublicProjectShell({
      nonce,
      presetId: project.presetId,
      runtimeUrl: `/p/${slug}?runtime=1`,
      slug,
      title: project.title,
    });
    return new Response(shell, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "content-security-policy": publicProjectShellCsp(nonce),
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  } catch {
    return new Response("Project cloud is temporarily unavailable", { status: 503 });
  }
}
