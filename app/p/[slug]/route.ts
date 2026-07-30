import { getPublishedProject } from "@/db/projects";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  if (!/^[a-z0-9-]{4,72}$/.test(slug)) return new Response("Project not found", { status: 404 });
  try {
    const project = await getPublishedProject(slug);
    if (!project) return new Response("Project not found", { status: 404 });
    return new Response(project.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "content-security-policy": "default-src 'self' data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'none'; form-action 'self' https://t.me https://dropstab.com https://polymarket.com",
      },
    });
  } catch {
    return new Response("Project cloud is temporarily unavailable", { status: 503 });
  }
}
