import { NextResponse } from "next/server";
import { z } from "zod";
import { MEMBERSHIP_PLANS } from "@/lib/config";
import { startMembership } from "@/server/payments";
import { rateLimit } from "@/server/rate-limit";
import { HttpError, handle, requireUser } from "@/server/session";

const body = z.object({
  authKey: z.string().max(300),
  customerKey: z.string().max(60),
  planId: z.enum(MEMBERSHIP_PLANS.map((p) => p.id) as [string, ...string[]]),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  rateLimit(`billing:${user.id}`, 10, 3600_000);
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "잘못된 요청입니다.");
  const r = await startMembership(user.id, p.data as never);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
});
