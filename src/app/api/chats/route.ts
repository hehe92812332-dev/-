import { NextResponse } from "next/server";
import { chatsSince } from "@/server/snapshot";
import { handle, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const after = new URL(req.url).searchParams.get("after") ?? new Date(0).toISOString();
  if (Number.isNaN(Date.parse(after))) return NextResponse.json({ messages: [] });
  return NextResponse.json({ messages: await chatsSince(user, after) }, { headers: { "Cache-Control": "no-store" } });
});
