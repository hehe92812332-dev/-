import { NextResponse } from "next/server";
import { buildSnapshot } from "@/server/snapshot";
import { currentUserRow, handle } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const viewer = await currentUserRow();
  return NextResponse.json(await buildSnapshot(viewer), { headers: { "Cache-Control": "private, no-store" } });
});
