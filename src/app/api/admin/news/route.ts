import { NextResponse } from "next/server";
import { adminNews } from "@/server/news";
import { handle, requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  return NextResponse.json(await adminNews());
});
