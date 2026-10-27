import { NextResponse } from "next/server";
import { listNotifications, markNotificationsRead } from "@/server/queries";
import { handle, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser();
  return NextResponse.json({ items: await listNotifications(user.id) }, { headers: { "Cache-Control": "no-store" } });
});

/** 모두 읽음 처리 */
export const POST = handle(async () => {
  const user = await requireUser();
  await markNotificationsRead(user.id);
  return NextResponse.json({ ok: true });
});
