import { NextResponse } from "next/server";
import { runScheduledJobs } from "@/server/payments";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 기한 정산·멤버십 갱신. Vercel Cron 등에서 Authorization: Bearer CRON_SECRET 으로 호출 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await runScheduledJobs()) });
}
