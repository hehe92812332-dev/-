import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import * as ledger from "@/lib/ledger";
import { db, schema } from "@/server/db";
import { runLedger } from "@/server/runner";
import { HttpError, handle, requireAdmin } from "@/server/session";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), userId: z.string() }),
  z.object({ action: z.literal("reject"), userId: z.string(), reason: z.string().min(2).max(300) }),
  z.object({ action: z.literal("resolveReport"), reportId: z.string(), decision: z.enum(["hide", "suspend", "dismiss"]), note: z.string().max(300).default("") }),
  z.object({ action: z.literal("withdrawPaid"), txId: z.string() }),
  z.object({ action: z.literal("withdrawReject"), txId: z.string(), reason: z.string().min(2).max(300) }),
]);

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "입력값을 확인해 주세요.");
  const a = p.data;

  const log = (target: string, detail = "") => async (tx: Parameters<NonNullable<Parameters<typeof runLedger>[3]>>[0]) => {
    await tx.insert(schema.adminLogs).values({ id: crypto.randomUUID(), adminId: admin.id, action: a.action, targetId: target, detail });
  };

  let r;
  switch (a.action) {
    case "verify":
      r = await runLedger(null, { userIds: [a.userId] }, (s) => ledger.setVerification(s, a.userId, "approved"), log(a.userId));
      break;
    case "reject":
      r = await runLedger(null, { userIds: [a.userId] }, (s) => ledger.setVerification(s, a.userId, "rejected", a.reason), log(a.userId, a.reason));
      break;
    case "resolveReport": {
      const [rp] = await db.select().from(schema.reports).where(eq(schema.reports.id, a.reportId));
      if (!rp) throw new HttpError(404, "신고를 찾을 수 없습니다.");
      let postIds: string[] = [];
      if (rp.targetType === "post") postIds = [rp.targetId];
      if (rp.targetType === "answer") {
        const [ans] = await db.select({ postId: schema.answers.postId }).from(schema.answers).where(eq(schema.answers.id, rp.targetId));
        postIds = ans ? [ans.postId] : [];
      }
      r = await runLedger(
        null,
        { reportIds: [a.reportId], postIds, chatIds: rp.targetType === "chat" ? [rp.targetId] : [], userIds: [rp.targetUserId] },
        (s) => ledger.resolveReport(s, a.reportId, a.decision, a.note),
        log(a.reportId, `${a.decision} ${a.note}`),
      );
      break;
    }
    case "withdrawPaid":
      r = await runLedger(null, { txIds: [a.txId] }, (s) => ledger.markWithdrawalPaid(s, a.txId), async (tx, res) => {
        await tx.update(schema.withdrawalAccounts).set({ processedAt: new Date().toISOString() }).where(eq(schema.withdrawalAccounts.txId, a.txId));
        await log(a.txId)(tx);
        void res;
      });
      break;
    case "withdrawReject": {
      const [t] = await db.select({ userId: schema.transactions.userId }).from(schema.transactions).where(eq(schema.transactions.id, a.txId));
      if (!t) throw new HttpError(404, "환전 신청을 찾을 수 없습니다.");
      r = await runLedger(null, { txIds: [a.txId], userIds: [t.userId] }, (s) => ledger.rejectWithdrawal(s, a.txId, a.reason), log(a.txId, a.reason));
      break;
    }
  }
  return NextResponse.json(r.ok ? { ok: true } : r, { status: r.ok ? 200 : 400 });
});
