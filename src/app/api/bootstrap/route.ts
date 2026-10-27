import { NextResponse } from "next/server";
import { bootstrap, viewerOf } from "@/server/queries";
import { currentUserRow, handle } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  return NextResponse.json(await bootstrap(await viewerOf(await currentUserRow())), { headers: { "Cache-Control": "private, no-store" } });
});
