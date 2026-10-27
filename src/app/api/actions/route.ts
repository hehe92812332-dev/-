import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { BOUNTY_ADD_OPTIONS, CATEGORIES, DIRECT_ANSWER_HOURS, LOUNGE_CHANNELS, REPORT_REASONS, TIERS, TIP_OPTIONS } from "@/lib/config";
import { rewardAfterFee } from "@/lib/ledger";
import { notify } from "@/server/notify";
import * as ledger from "@/lib/ledger";
import { encrypt } from "@/server/crypto";
import { db, schema } from "@/server/db";
import { cancelPurchase } from "@/server/payments";
import { firstTimeWithin, rateLimit } from "@/server/rate-limit";
import { runLedger, type Slice } from "@/server/runner";
import { HttpError, handle, requireUser } from "@/server/session";

const id = z.string().min(1).max(100);
const tierIds = TIERS.map((t) => t.id) as [string, ...string[]];

const schemas = {
  createPost: z.object({
    board: z.enum(["patient", "clinical"]),
    title: z.string().max(100),
    body: z.string().max(5000),
    category: z.enum(CATEGORIES),
    targetTier: z.enum(tierIds),
    directTherapistId: id.optional(),
    autoLower: z.boolean().optional(),
  }),
  addBounty: z.object({ postId: id, amount: z.union(BOUNTY_ADD_OPTIONS.map((n) => z.literal(n)) as never) }),
  addAnswer: z.object({ postId: id, body: z.string().max(5000) }),
  adoptAnswer: z.object({ postId: id, answerId: id }),
  cancelPost: z.object({ postId: id }),
  tip: z.object({ postId: id, answerId: id, amount: z.union(TIP_OPTIONS.map((n) => z.literal(n)) as never) }),
  rate: z.object({
    postId: id,
    answerId: id.optional(),
    score: z.enum(["great", "good", "bad"]),
    tags: z.array(z.string().max(30)).max(5),
  }),
  sendChat: z.object({ body: z.string().max(1000), kind: z.enum(["text", "study"]), channel: z.enum(LOUNGE_CHANNELS).default(LOUNGE_CHANNELS[0]) }),
  lowerTier: z.object({ postId: id, tier: z.enum(tierIds) }),
  balanceRefund: z.object({ account: z.string().trim().min(8).max(60) }),
  setAutoRenew: z.object({ on: z.boolean() }),
  withdraw: z.object({ tokens: z.number().int().positive().max(1_000_000), account: z.string().trim().min(8).max(60) }),
  revokePurchase: z.object({ txId: id }),
  report: z.object({
    targetType: z.enum(["post", "answer", "chat", "user"]),
    targetId: id,
    reason: z.enum(REPORT_REASONS),
    detail: z.string().max(1000),
  }),
  block: z.object({ userId: id }),
  unblock: z.object({ userId: id }),
  toggleLike: z.object({ postId: id, answerId: id }),
  view: z.object({ postId: id }),
} as const;

type Action = keyof typeof schemas;

/** 액션별 요청 한도 (회원당) */
const LIMITS: Partial<Record<Action, [number, number]>> = {
  createPost: [10, 3600_000],
  addAnswer: [30, 3600_000],
  sendChat: [30, 60_000],
  report: [20, 3600_000],
  withdraw: [5, 3600_000],
  balanceRefund: [3, 3600_000],
  tip: [30, 3600_000],
};


export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action as Action;
  if (!action || !(action in schemas)) throw new HttpError(400, "알 수 없는 요청입니다.");
  const parsed = schemas[action].safeParse(body);
  if (!parsed.success) throw new HttpError(400, "입력값을 확인해 주세요.");
  // 아래 switch에서 액션별 스키마로 이미 검증된 값입니다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = parsed.data as any;
  const [limit, windowMs] = LIMITS[action] ?? [120, 60_000];
  rateLimit(`${action}:${user.id}`, limit, windowMs);
  const me = user.id;

  const run = async (slice: Slice, fn: Parameters<typeof runLedger>[2], after?: Parameters<typeof runLedger>[3]) => {
    const r = await runLedger(me, slice, fn, after);
    return NextResponse.json(r.ok ? { ok: true, id: r.id } : r, { status: r.ok ? 200 : 400 });
  };

  switch (action) {
    case "createPost":
      return run(
        { userIds: a.directTherapistId ? [a.directTherapistId] : [] },
        (s) => ledger.createPost(s, me, a),
        async (tx, r) => {
          if (a.directTherapistId)
            await notify(tx, a.directTherapistId, "direct_question", `1:1 질문이 도착했어요. ${DIRECT_ANSWER_HOURS}시간 안에 답변해 주세요: ${a.title.slice(0, 30)}`, `/qa/${r.id}`);
        },
      );
    case "addBounty":
      return run({ postIds: [a.postId] }, (s) => ledger.addBounty(s, me, a.postId, a.amount));
    case "lowerTier":
      return run({ postIds: [a.postId] }, (s) => ledger.lowerTargetTier(s, me, a.postId, a.tier));
    case "addAnswer":
      return run(
        { postIds: [a.postId] },
        (s) => ledger.addAnswer(s, me, a.postId, a.body),
        async (tx, r) => {
          const post = r.state.posts.find((p) => p.id === a.postId)!;
          await notify(tx, post.authorId, "answer", `질문에 새 답변이 달렸어요: ${post.title.slice(0, 30)}`, `/${post.board === "patient" ? "qa" : "clinical"}/${post.id}`);
        },
      );
    case "adoptAnswer":
      return run(
        { postIds: [a.postId] },
        (s) => ledger.adopt(s, me, a.postId, a.answerId),
        async (tx, r) => {
          const post = r.state.posts.find((p) => p.id === a.postId)!;
          const answer = post.answers.find((x) => x.id === a.answerId)!;
          await notify(tx, answer.authorId, "adopted", `답변이 채택되어 ${rewardAfterFee(post.bounty)}토큰을 받았어요`, `/${post.board === "patient" ? "qa" : "clinical"}/${post.id}`);
        },
      );
    case "cancelPost":
      return run({ postIds: [a.postId] }, (s) => ledger.cancelPost(s, me, a.postId));
    case "tip":
      return run(
        { postIds: [a.postId] },
        (s) => ledger.tip(s, me, a.postId, a.answerId, a.amount),
        async (tx, r) => {
          const answer = r.state.posts.flatMap((p) => p.answers).find((x) => x.id === a.answerId)!;
          await notify(tx, answer.authorId, "tip", `감사 팁 ${a.amount}토큰을 받았어요`, `/qa/${a.postId}`);
        },
      );
    case "rate":
      return run({ postIds: [a.postId], ratingsOfPosts: [a.postId] }, (s) => ledger.rate(s, me, a));
    case "sendChat":
      return run({}, (s) => ledger.sendChat(s, me, a.body, a.kind, a.channel));
    case "balanceRefund":
      return run(
        {},
        (s) => ledger.requestBalanceRefund(s, me, a.account),
        async (tx, r) => {
          await tx.insert(schema.withdrawalAccounts).values({ txId: r.id!, userId: me, accountEnc: encrypt(a.account) });
        },
      );
    case "setAutoRenew":
      return run({}, (s) => ledger.setAutoRenew(s, me, a.on));
    case "withdraw":
      return run(
        { recentTxOf: [me] },
        (s) => ledger.withdraw(s, me, a.tokens, a.account),
        // 입금 계좌는 거래 메모에는 가려서 남기고, 원본은 암호화해 관리자만 열람
        async (tx, r) => {
          await tx.insert(schema.withdrawalAccounts).values({ txId: r.id!, userId: me, accountEnc: encrypt(a.account) });
        },
      );
    case "revokePurchase": {
      const r = await cancelPurchase(me, a.txId);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "report": {
      const slice: Slice = { reportsBy: me };
      if (a.targetType === "post") slice.postIds = [a.targetId];
      if (a.targetType === "chat") slice.chatIds = [a.targetId];
      if (a.targetType === "user") slice.userIds = [a.targetId];
      if (a.targetType === "answer") {
        const [ans] = await db.select({ postId: schema.answers.postId }).from(schema.answers).where(eq(schema.answers.id, a.targetId));
        if (!ans) throw new HttpError(404, "신고 대상을 찾을 수 없습니다.");
        slice.postIds = [ans.postId];
      }
      return run(slice, (s) => ledger.report(s, me, a));
    }
    case "block":
      return run({ blocksOf: me, userIds: [a.userId] }, (s) => ledger.block(s, me, a.userId));
    case "unblock":
      return run({ blocksOf: me }, (s) => ledger.unblock(s, me, a.userId));
    case "toggleLike": {
      const where = and(eq(schema.answerLikes.answerId, a.answerId), eq(schema.answerLikes.userId, me));
      const [ans] = await db.select().from(schema.answers).where(and(eq(schema.answers.id, a.answerId), eq(schema.answers.postId, a.postId)));
      if (!ans) throw new HttpError(404, "답변을 찾을 수 없습니다.");
      const deleted = await db.delete(schema.answerLikes).where(where).returning();
      if (deleted.length === 0) await db.insert(schema.answerLikes).values({ answerId: a.answerId, userId: me }).onConflictDoNothing();
      return NextResponse.json({ ok: true });
    }
    case "view": {
      // 같은 회원이 1시간 내 다시 보면 조회수를 올리지 않음
      if (firstTimeWithin(`view:${me}:${a.postId}`, 3600_000)) {
        await db.update(schema.posts).set({ views: sql`${schema.posts.views} + 1` }).where(eq(schema.posts.id, a.postId));
      }
      return NextResponse.json({ ok: true });
    }
  }
});
