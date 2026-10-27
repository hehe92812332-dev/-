import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import * as ledger from "@/lib/ledger";
import { db, schema } from "@/server/db";
import { notify } from "@/server/notify";
import { approveArticle, rescheduleArticle, setArticleStatus } from "@/server/news";
import { runLedger } from "@/server/runner";
import { HttpError, handle, requireAdmin } from "@/server/session";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), userId: z.string() }),
  z.object({ action: z.literal("reject"), userId: z.string(), reason: z.string().min(2).max(300) }),
  z.object({ action: z.literal("resolveReport"), reportId: z.string(), decision: z.enum(["hide", "suspend", "dismiss"]), note: z.string().max(300).default("") }),
  z.object({ action: z.literal("withdrawPaid"), txId: z.string() }),
  z.object({ action: z.literal("withdrawReject"), txId: z.string(), reason: z.string().min(2).max(300) }),
  z.object({ action: z.literal("articleApprove"), articleId: z.string(), publishOn: z.string().optional(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("articleReject"), articleId: z.string(), reason: z.string().min(2).max(300) }),
  z.object({ action: z.literal("articleArchive"), articleId: z.string(), reason: z.string().min(2).max(300) }),
  z.object({ action: z.literal("articleReschedule"), articleId: z.string(), publishOn: z.string() }),
]);

export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "입력값을 확인해 주세요.");
  const a = p.data;

  const log = (target: string, detail = "") => async (tx: Parameters<NonNullable<Parameters<typeof runLedger>[3]>>[0]) => {
    await tx.insert(schema.adminLogs).values({ id: crypto.randomUUID(), adminId: admin.id, action: a.action, targetId: target, detail });
  };

  // 건강 소식 검수
  switch (a.action) {
    case "articleApprove":
      return NextResponse.json({ ok: true, ...(await approveArticle(admin.id, a.articleId, { publishOn: a.publishOn || undefined, note: a.note })) });
    case "articleReject":
    case "articleArchive":
      await setArticleStatus(admin.id, a.articleId, a.action === "articleReject" ? "rejected" : "archived", a.reason);
      return NextResponse.json({ ok: true });
    case "articleReschedule":
      await rescheduleArticle(admin.id, a.articleId, a.publishOn);
      return NextResponse.json({ ok: true });
  }

  let r;
  switch (a.action) {
    case "verify":
      r = await runLedger(null, { userIds: [a.userId] }, (s) => ledger.setVerification(s, a.userId, "approved"), async (tx) => {
        await log(a.userId)(tx);
        await notify(tx, a.userId, "verification", "서류 심사가 완료되었어요. 이제 답변·임상 토론·등급 라운지를 이용할 수 있어요.", "/signup/pending");
      });
      break;
    case "reject":
      r = await runLedger(null, { userIds: [a.userId] }, (s) => ledger.setVerification(s, a.userId, "rejected", a.reason), async (tx) => {
        await log(a.userId, a.reason)(tx);
        await notify(tx, a.userId, "verification", `서류 보완이 필요해요: ${a.reason}`, "/signup/pending");
      });
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
        const t = res.state.transactions.find((x) => x.id === a.txId)!;
        await notify(tx, t.userId, "payout", `${t.type === "withdraw" ? "환전" : "잔액 환불"} ${t.krw?.toLocaleString()}원을 입금했어요`, "/wallet");
      });
      break;
    case "withdrawReject": {
      const [t] = await db.select({ userId: schema.transactions.userId }).from(schema.transactions).where(eq(schema.transactions.id, a.txId));
      if (!t) throw new HttpError(404, "환전 신청을 찾을 수 없습니다.");
      r = await runLedger(null, { txIds: [a.txId], userIds: [t.userId] }, (s) => ledger.rejectWithdrawal(s, a.txId, a.reason), async (tx) => {
        await log(a.txId, a.reason)(tx);
        await notify(tx, t.userId, "payout", `신청이 반려되어 토큰을 돌려드렸어요: ${a.reason}`, "/wallet");
      });
      break;
    }
  }
  return NextResponse.json(r.ok ? { ok: true } : r, { status: r.ok ? 200 : 400 });
});
