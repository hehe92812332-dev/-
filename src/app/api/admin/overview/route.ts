import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { WITHHOLDING_TAX_RATE, TOKEN_KRW } from "@/lib/config";
import { decrypt } from "@/server/crypto";
import { db, schema } from "@/server/db";
import { handle, requireAdmin } from "@/server/session";

export const dynamic = "force-dynamic";

const safeDecrypt = (v: string) => {
  try {
    return decrypt(v);
  } catch {
    return "(복호화 실패)";
  }
};

export const GET = handle(async () => {
  await requireAdmin();
  const { users, therapistProfiles: tp, credentialDocuments: docs, reports, transactions: txs, withdrawalAccounts: wa, paymentOrders: orders } = schema;

  // 1) 서류 심사 대기
  const pending = await db
    .select({ p: tp, name: users.name, email: users.email })
    .from(tp)
    .innerJoin(users, eq(users.id, tp.userId))
    .where(eq(tp.verification, "pending"))
    .orderBy(tp.submittedAt)
    .limit(50);
  const docRows = pending.length
    ? await db
        .select({ id: docs.id, userId: docs.userId, kind: docs.kind, filename: docs.filename, size: docs.size })
        .from(docs)
        .where(inArray(docs.userId, pending.map((x) => x.p.userId)))
    : [];

  // 2) 열린 신고 + 대상 내용
  const openReports = await db.select().from(reports).where(eq(reports.status, "open")).orderBy(reports.createdAt).limit(50);
  const contentOf = async (type: string, id: string) => {
    if (type === "post") return (await db.select({ t: schema.posts.title, b: schema.posts.body }).from(schema.posts).where(eq(schema.posts.id, id)))[0];
    if (type === "answer") return (await db.select({ b: schema.answers.body }).from(schema.answers).where(eq(schema.answers.id, id)))[0];
    if (type === "chat") return (await db.select({ b: schema.chatMessages.body }).from(schema.chatMessages).where(eq(schema.chatMessages.id, id)))[0];
    return undefined;
  };
  const names = new Map(
    (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(openReports.flatMap((r) => [r.reporterId, r.targetUserId]))].concat("")))).map(
      (u) => [u.id, u.name ?? ""],
    ),
  );
  const reportList = await Promise.all(
    openReports.map(async (r) => {
      const c = (await contentOf(r.targetType, r.targetId)) as { t?: string; b?: string } | undefined;
      return { ...r, reporterName: names.get(r.reporterId), targetUserName: names.get(r.targetUserId), content: c ? [c.t, c.b].filter(Boolean).join(" — ").slice(0, 400) : "" };
    }),
  );

  // 3) 환전 신청 (계좌는 여기서만 복호화)
  const withdrawals = await db
    .select({ tx: txs, account: wa.accountEnc, name: users.name, email: users.email })
    .from(txs)
    .innerJoin(wa, eq(wa.txId, txs.id))
    .innerJoin(users, eq(users.id, txs.userId))
    .where(and(inArray(txs.type, ["withdraw", "balance_refund"]), eq(txs.status, "requested")))
    .orderBy(txs.createdAt)
    .limit(100);

  // 4) 결제 현황
  const recentOrders = await db
    .select({ o: orders, name: users.name })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  const [stats] = await db.execute<{ users: string; posts: string; paid: string | null; refunded: string | null; balance: string | null }>(sql`
    select (select count(*) from users where role is not null) as users,
           (select sum(cash) from users) as balance,
           (select count(*) from posts) as posts,
           (select sum(amount) from payment_orders where status = 'paid') as paid,
           (select sum(amount) from payment_orders where status = 'canceled' and payment_key is not null) as refunded`).then((r) => r.rows);
  const logs = await db.select().from(schema.adminLogs).orderBy(desc(schema.adminLogs.createdAt)).limit(30);

  return NextResponse.json({
    stats: { users: Number(stats.users), posts: Number(stats.posts), paidKrw: Number(stats.paid ?? 0), refundedKrw: Number(stats.refunded ?? 0), prepaidKrw: Number(stats.balance ?? 0) * TOKEN_KRW },
    pending: pending.map(({ p, name, email }) => ({
      userId: p.userId,
      name,
      email,
      licenseNumber: safeDecrypt(p.licenseNumberEnc),
      experienceYears: p.experienceYears,
      educationHours: p.educationHours,
      degree: p.degree,
      hospitalName: p.hospitalName,
      submittedAt: p.submittedAt,
      documents: docRows.filter((d) => d.userId === p.userId),
    })),
    reports: reportList,
    withdrawals: withdrawals.map(({ tx, account, name, email }) => ({
      kind: tx.type,
      txId: tx.id,
      userId: tx.userId,
      name,
      email,
      tokens: -tx.tokens,
      grossKrw: -tx.tokens * TOKEN_KRW,
      netKrw: tx.krw,
      // 환전은 원천징수, 잔액 환불은 수수료
      withholdingKrw: tx.type === "withdraw" ? Math.round(-tx.tokens * TOKEN_KRW * WITHHOLDING_TAX_RATE) : -tx.tokens * TOKEN_KRW - (tx.krw ?? 0),
      account: safeDecrypt(account),
      createdAt: tx.createdAt,
    })),
    orders: recentOrders.map(({ o, name }) => ({ ...o, name })),
    logs,
  });
});
