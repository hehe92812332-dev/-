import { NextResponse } from "next/server";
import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/config";
import { prepareTokenOrder } from "@/server/payments";
import { rateLimit } from "@/server/rate-limit";
import { HttpError, handle, requireUser } from "@/server/session";

const body = z.object({
  packageId: z.string(),
  method: z.enum(PAYMENT_METHODS.map((m) => m.id) as [string, ...string[]]),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  rateLimit(`prepare:${user.id}`, 20, 3600_000);
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "잘못된 요청입니다.");
  const r = await prepareTokenOrder(user.id, p.data.packageId, p.data.method as never);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
});
