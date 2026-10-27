import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/server/db";
import { deleteDocument } from "@/server/storage";
import { HttpError, handle, requireUser } from "@/server/session";

/**
 * 회원 탈퇴: 로그인 연결·서류·면허번호·결제키·이름을 지우고, 법정 보관 대상(거래·결제 기록)은 익명 상태로 남깁니다.
 * 남은 토큰은 소멸합니다 (화면에서 미리 안내).
 */
export const POST = handle(async () => {
  const user = await requireUser({ onboarded: false });
  const openPosts = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.authorId, user.id), eq(schema.posts.status, "open")));
  if (openPosts.length) throw new HttpError(400, "진행 중인 질문이 있어요. 질문을 채택하거나 취소한 뒤 탈퇴해 주세요.");
  const pendingWithdraw = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.userId, user.id), eq(schema.transactions.type, "withdraw"), eq(schema.transactions.status, "requested")));
  if (pendingWithdraw.length) throw new HttpError(400, "처리 중인 환전 신청이 있어요. 입금이 끝난 뒤 탈퇴해 주세요.");

  const now = new Date().toISOString();
  // 객체 저장소에 있는 서류 파일도 삭제
  const docs = await db.select({ storageKey: schema.credentialDocuments.storageKey }).from(schema.credentialDocuments).where(eq(schema.credentialDocuments.userId, user.id));
  await Promise.all(docs.map(deleteDocument));
  await db.transaction(async (tx) => {
    const remaining = user.cash + user.bonus + user.earned;
    if (remaining > 0)
      await tx.insert(schema.transactions).values({
        id: `t-${crypto.randomUUID()}`,
        userId: user.id,
        type: "withdraw_cancel",
        tokens: -remaining,
        memo: "회원 탈퇴로 인한 토큰 소멸",
        createdAt: now,
      });
    await tx.delete(schema.accounts).where(eq(schema.accounts.userId, user.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await tx.delete(schema.credentialDocuments).where(eq(schema.credentialDocuments.userId, user.id));
    await tx.delete(schema.billingKeys).where(eq(schema.billingKeys.userId, user.id));
    await tx.delete(schema.blocks).where(eq(schema.blocks.userId, user.id));
    await tx
      .update(schema.therapistProfiles)
      .set({ licenseNumberEnc: "", bio: "", hospitalName: "", verification: "rejected", rejectReason: "탈퇴" })
      .where(eq(schema.therapistProfiles.userId, user.id));
    await tx
      .update(schema.users)
      .set({
        name: "탈퇴한 회원",
        email: null,
        image: null,
        cash: 0,
        bonus: 0,
        earned: 0,
        membershipPlan: null,
        membershipRenewsAt: null,
        membershipStartedAt: null,
        membershipAutoRenew: false,
        isAdmin: false,
        deletedAt: now,
      })
      .where(eq(schema.users.id, user.id));
    // 라운지 메시지는 숨김 처리
    await tx.update(schema.chatMessages).set({ hidden: true }).where(inArray(schema.chatMessages.authorId, [user.id]));
  });
  return NextResponse.json({ ok: true });
});
