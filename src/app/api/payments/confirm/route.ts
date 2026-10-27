import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmTokenOrder } from "@/server/payments";
import { HttpError, handle, requireUser } from "@/server/session";

const body = z.object({ orderId: z.string().max(64), paymentKey: z.string().max(200), amount: z.coerce.number().int() });

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "잘못된 요청입니다.");
  const r = await confirmTokenOrder(user.id, p.data);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
});
