import { NextResponse } from "next/server.js";
import { MEMBER_USAGE_COOKIE, STUDIO_ACCOUNT_COOKIE } from "../../../../lib/access-tier.ts";

export const runtime = "nodejs";

export async function DELETE() {
  const response = NextResponse.json(
    { disconnected: true },
    { headers: { "cache-control": "no-store" } },
  );
  for (const name of [STUDIO_ACCOUNT_COOKIE, MEMBER_USAGE_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: new Date(0),
      path: "/",
    });
  }
  return response;
}
