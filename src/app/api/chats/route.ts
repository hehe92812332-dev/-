import { NextResponse } from "next/server";
import { LOUNGE_CHANNELS } from "@/lib/config";
import { loungeMessages, viewerOf } from "@/server/queries";
import { handle, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const valid = (x: string | null) => (x && !Number.isNaN(Date.parse(x)) ? x : undefined);
  return NextResponse.json(
    await loungeMessages(await viewerOf(user), sp.get("channel") ?? LOUNGE_CHANNELS[0], { after: valid(sp.get("after")), before: valid(sp.get("before")) }),
    { headers: { "Cache-Control": "no-store" } },
  );
});
