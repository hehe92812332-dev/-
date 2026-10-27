import "server-only";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { SETTLEMENT_HOLD_DAYS, REVOKE_DAYS } from "@/lib/config";
import type { Outcome, State } from "@/lib/ledger";
import { db, schema, type Tx } from "./db";
import { fromPost, fromTx, toAnswer, toBlock, toChat, toPost, toRating, toReport, toTx, toUser } from "./mappers";
import { revealMutual, tierColumns } from "./stats";

/** 액션 하나가 읽어야 하는 데이터 범위 */
export interface Slice {
  userIds?: string[];
  postIds?: string[];
  /** 이 회원들의 최근 거래 (정산 대기·결제 취소 판단용) */
  recentTxOf?: string[];
  txIds?: string[];
  chatIds?: string[];
  reportIds?: string[];
  /** 이 회원이 남긴 신고·차단 */
  reportsBy?: string;
  blocksOf?: string;
  /** 이 질문들에 대한 평가 */
  ratingsOfPosts?: string[];
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export async function loadState(tx: Tx, slice: Slice, currentUserId: string | null): Promise<State> {
  // 잠금 순서를 항상 같게(질문 → 회원 → 거래·신고, 각각 id 순) 해서 교착을 피합니다
  const postRows = slice.postIds?.length
    ? await tx.select().from(schema.posts).where(inArray(schema.posts.id, slice.postIds)).orderBy(schema.posts.id).for("update")
    : [];
  const answerRows = postRows.length
    ? await tx.select().from(schema.answers).where(inArray(schema.answers.postId, postRows.map((p) => p.id)))
    : [];
  const likeRows = answerRows.length
    ? await tx.select().from(schema.answerLikes).where(inArray(schema.answerLikes.answerId, answerRows.map((a) => a.id)))
    : [];
  const posts = postRows.map((p) =>
    toPost(
      p,
      answerRows
        .filter((a) => a.postId === p.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((a) => toAnswer(a, likeRows.filter((l) => l.answerId === a.id).map((l) => l.userId))),
    ),
  );

  const chatRows = slice.chatIds?.length ? await tx.select().from(schema.chatMessages).where(inArray(schema.chatMessages.id, slice.chatIds)) : [];

  // 관련 회원: 지정된 회원 + 질문·답변 작성자 + 1:1 지정 치료사 + 채팅 작성자
  const userIds = uniq([
    currentUserId,
    ...(slice.userIds ?? []),
    ...postRows.flatMap((p) => [p.authorId, p.directTherapistId]),
    ...answerRows.map((a) => a.authorId),
    ...chatRows.map((c) => c.authorId),
  ]);
  // 지갑 행을 잠가 동시에 들어온 결제·차감이 서로를 덮어쓰지 않게 합니다
  const userRows = userIds.length
    ? await tx.select().from(schema.users).where(inArray(schema.users.id, userIds)).orderBy(schema.users.id).for("update")
    : [];
  const profiles = userIds.length
    ? await tx.select().from(schema.therapistProfiles).where(inArray(schema.therapistProfiles.userId, userIds))
    : [];

  const since = new Date(Date.now() - Math.max(SETTLEMENT_HOLD_DAYS, REVOKE_DAYS + 1) * 86400_000).toISOString();
  const txConds = [];
  if (slice.recentTxOf?.length) txConds.push(and(inArray(schema.transactions.userId, slice.recentTxOf), gte(schema.transactions.createdAt, since)));
  if (slice.txIds?.length) txConds.push(inArray(schema.transactions.id, slice.txIds));
  // 특정 거래(환전 처리·결제 취소)는 잠가서 두 번 처리되지 않게
  const lockedTx = slice.txIds?.length
    ? await tx.select().from(schema.transactions).where(inArray(schema.transactions.id, slice.txIds)).orderBy(schema.transactions.id).for("update")
    : [];
  const txRows = txConds.length ? await tx.select().from(schema.transactions).where(or(...txConds)) : [];
  for (const t of lockedTx) if (!txRows.some((x) => x.id === t.id)) txRows.push(t);

  const ratingRows = slice.ratingsOfPosts?.length
    ? await tx.select().from(schema.ratings).where(inArray(schema.ratings.postId, slice.ratingsOfPosts))
    : [];
  const reportConds = [];
  if (slice.reportIds?.length) reportConds.push(inArray(schema.reports.id, slice.reportIds));
  if (slice.reportsBy) reportConds.push(and(eq(schema.reports.reporterId, slice.reportsBy), eq(schema.reports.status, "open")));
  const reportRows = reportConds.length ? await tx.select().from(schema.reports).where(or(...reportConds)).orderBy(schema.reports.id).for("update") : [];
  // 같은 대상의 열린 신고도 함께 처리되도록 포함
  const sameTarget = reportRows.length
    ? await tx
        .select()
        .from(schema.reports)
        .where(and(inArray(schema.reports.targetId, reportRows.map((r) => r.targetId)), eq(schema.reports.status, "open")))
    : [];
  const blockRows = slice.blocksOf ? await tx.select().from(schema.blocks).where(eq(schema.blocks.userId, slice.blocksOf)) : [];

  return {
    users: userRows.map((u) => toUser(u, profiles.find((p) => p.userId === u.id))),
    posts,
    transactions: txRows.map(toTx).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ratings: ratingRows.map(toRating),
    chats: chatRows.map(toChat),
    reports: [...new Map([...reportRows, ...sameTarget].map((r) => [r.id, toReport(r)])).values()],
    blocks: blockRows.map(toBlock),
    currentUserId,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** before → after 차이만 DB에 기록 */
export async function persistDiff(tx: Tx, before: State, after: State) {
  for (const u of after.users) {
    const prev = before.users.find((x) => x.id === u.id);
    if (!prev) continue;
    if (!same([prev.wallet, prev.membership, prev.suspendedUntil], [u.wallet, u.membership, u.suspendedUntil])) {
      await tx
        .update(schema.users)
        .set({
          cash: u.wallet.cash,
          bonus: u.wallet.bonus,
          earned: u.wallet.earned,
          membershipPlan: u.membership?.plan ?? null,
          membershipStartedAt: u.membership?.startedAt ?? null,
          membershipRenewsAt: u.membership?.renewsAt ?? null,
          membershipAutoRenew: u.membership?.autoRenew ?? false,
          suspendedUntil: u.suspendedUntil ?? null,
        })
        .where(eq(schema.users.id, u.id));
    }
    if (u.therapist && !same([prev.therapist?.verification, prev.therapist?.rejectReason], [u.therapist.verification, u.therapist.rejectReason])) {
      const approved = u.therapist.verification === "approved";
      await tx
        .update(schema.therapistProfiles)
        .set({
          verification: u.therapist.verification ?? "pending",
          rejectReason: u.therapist.rejectReason ?? null,
          reviewedAt: new Date().toISOString(),
          // 승인 시 등급을 계산해 두어 목록에서 바로 정렬·필터
          ...(approved ? tierColumns(u.therapist) : { tier: null, tierRank: null }),
        })
        .where(eq(schema.therapistProfiles.userId, u.id));
    }
  }

  for (const p of after.posts) {
    const prev = before.posts.find((x) => x.id === p.id);
    const { answers, ...row } = p;
    const answerCount = answers.filter((a) => !a.hidden).length;
    const prevCount = prev?.answers.filter((a) => !a.hidden).length;
    if (!prev) await tx.insert(schema.posts).values({ ...fromPost(p), answerCount });
    else if (!same({ ...prev, answers: [] }, { ...row, answers: [] }) || prevCount !== answerCount) {
      const { id: _id, ...set } = fromPost(p);
      await tx.update(schema.posts).set({ ...set, answerCount }).where(eq(schema.posts.id, p.id));
    }
    for (const a of answers) {
      const pa = prev?.answers.find((x) => x.id === a.id);
      if (!pa)
        await tx.insert(schema.answers).values({ id: a.id, postId: p.id, authorId: a.authorId, body: a.body, createdAt: a.createdAt, tips: a.tips, hidden: !!a.hidden });
      else if (pa.tips !== a.tips || !!pa.hidden !== !!a.hidden)
        await tx.update(schema.answers).set({ tips: a.tips, hidden: !!a.hidden }).where(eq(schema.answers.id, a.id));
    }
  }

  for (const t of after.transactions) {
    const prev = before.transactions.find((x) => x.id === t.id);
    if (!prev) {
      await tx.insert(schema.transactions).values(fromTx(t));
      // 채택 보상이 생기면 채택 답변 수 증가
      if (t.type === "reward") await tx.update(schema.users).set({ adoptedCount: sql`${schema.users.adoptedCount} + 1` }).where(eq(schema.users.id, t.userId));
    }
    else if (!!prev.revoked !== !!t.revoked || prev.status !== t.status)
      await tx.update(schema.transactions).set({ revoked: !!t.revoked, status: t.status ?? null }).where(eq(schema.transactions.id, t.id));
  }

  const newRatings = after.ratings.filter((r) => !before.ratings.some((x) => x.id === r.id));
  for (const { revealed: _revealed, ...r } of newRatings) await tx.insert(schema.ratings).values({ ...r, answerId: r.answerId ?? null });
  // 서로 평가했다면 즉시 공개해 온도에 반영
  await revealMutual(tx, newRatings.map((r) => r.id));

  for (const c of after.chats) {
    const prev = before.chats.find((x) => x.id === c.id);
    if (!prev) await tx.insert(schema.chatMessages).values({ ...c, channel: c.channel ?? "자유", hidden: !!c.hidden });
    else if (!!prev.hidden !== !!c.hidden) await tx.update(schema.chatMessages).set({ hidden: !!c.hidden }).where(eq(schema.chatMessages.id, c.id));
  }

  for (const r of after.reports) {
    const prev = before.reports.find((x) => x.id === r.id);
    if (!prev) await tx.insert(schema.reports).values({ ...r, resolution: r.resolution ?? null });
    else if (prev.status !== r.status)
      await tx.update(schema.reports).set({ status: r.status, resolution: r.resolution ?? null }).where(eq(schema.reports.id, r.id));
  }

  for (const b of after.blocks)
    if (!before.blocks.some((x) => x.userId === b.userId && x.blockedId === b.blockedId)) await tx.insert(schema.blocks).values(b);
  for (const b of before.blocks)
    if (!after.blocks.some((x) => x.userId === b.userId && x.blockedId === b.blockedId))
      await tx.delete(schema.blocks).where(and(eq(schema.blocks.userId, b.userId), eq(schema.blocks.blockedId, b.blockedId)));
}

export type RunResult = { ok: true; id?: string; state: State } | { ok: false; error: string };

/**
 * 원장 규칙(ledger.ts)을 DB 트랜잭션 안에서 실행합니다.
 * 바꿀 행(질문·회원 지갑·거래·신고)을 먼저 FOR UPDATE로 잠그고 읽으므로, 같은 행을 건드리는 요청은 줄을 서서 차례로 처리됩니다.
 * (100만 명 동시 쓰기 테스트에서 SERIALIZABLE 방식은 같은 질문에 50명이 동시에 답하면 충돌 재시도가 바닥나 실패했음)
 * 교착(40P01)·직렬화 실패(40001)는 재시도합니다.
 * after 콜백은 같은 트랜잭션 안에서 부가 기록(주문 상태, 계좌 등)을 남길 때 씁니다.
 */
export async function runLedger(
  currentUserId: string | null,
  slice: Slice,
  fn: (s: State) => Outcome,
  after?: (tx: Tx, result: { state: State; id?: string }) => Promise<void>,
): Promise<RunResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(
        async (tx) => {
          const before = await loadState(tx, slice, currentUserId);
          const out = fn(before);
          if (!out.ok) return out;
          await persistDiff(tx, before, out.state);
          if (after) await after(tx, { state: out.state, id: out.id });
          return { ok: true as const, id: out.id, state: out.state };
        },
        { isolationLevel: "read committed" },
      );
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if ((code === "40001" || code === "40P01") && attempt < 8) {
        await new Promise((r) => setTimeout(r, 20 * 2 ** Math.min(attempt, 5) + Math.random() * 50));
        continue;
      }
      throw e;
    }
  }
}

