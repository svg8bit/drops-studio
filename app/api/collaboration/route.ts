import { createCollaborationRouteHandlers } from "@/lib/collaboration-transport-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createCollaborationRouteHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
