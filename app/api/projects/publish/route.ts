import { NextRequest, NextResponse } from "next/server";
import { insertPublishedProject } from "@/db/projects";
import { compileProject } from "@/lib/project-compiler";
import { validateProjectSpec } from "@/lib/project-validator";

export const dynamic = "force-dynamic";

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 7);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { spec?: unknown } | null;
  if (!body?.spec) return NextResponse.json({ error: "A validated project spec is required." }, { status: 400 });

  let spec: ReturnType<typeof validateProjectSpec>;
  try {
    spec = validateProjectSpec(body.spec);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid project specification." }, { status: 400 });
  }

  try {
    const id = crypto.randomUUID();
    const slug = `${spec.slug.slice(0, 52)}-${randomSuffix()}`;
    const publishedSpec = validateProjectSpec({ ...spec, slug, dataEndpoint: `${request.nextUrl.origin}/api/public-data` });
    const html = compileProject(publishedSpec);
    if (new TextEncoder().encode(html).byteLength > 850_000) {
      return NextResponse.json({ error: "This project is too large for instant publishing." }, { status: 413 });
    }
    await insertPublishedProject({ id, slug, title: publishedSpec.name, presetId: publishedSpec.presetId, spec: publishedSpec, html, createdAt: new Date().toISOString() });
    return NextResponse.json({ id, slug, url: `${request.nextUrl.origin}/p/${slug}` }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The project cloud could not publish this build. Your local project and source remain available." }, { status: 503 });
  }
}
