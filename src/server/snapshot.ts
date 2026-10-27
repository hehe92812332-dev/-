import "server-only";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import type { State } from "@/lib/ledger";
import { userTier } from "@/lib/ledger";
import { isRevealed } from "@/lib/manner";
import type { User } from "@/lib/types";
import { db, schema } from "./db";
import { toAnswer, toBlock, toChat, toPost, toRating, toReport, toTx, toUser } from "./mappers";

type UserRow = typeof schema.users.$inferSelect;

const POST_LIMIT = 200;

export interface Me {
  id: string;
  name: string;
  email: string | null;
  needsOnboarding: boolean;
  isAdmin: boolean;
}

/** 다른 회원에게 보여도 되는 정보만 남깁니다 */
function sanitize(u: User, viewerId: string | null): User {
  if (u.id === viewerId) return u;
  return {
    ...u,
    wallet: { cash: 0, bonus: 0, earned: 0 },
    membership: undefined,
    isAdmin: undefined,
    suspendedUntil: undefined,
    therapist: u.therapist ? { ...u.therapist, rejectReason: undefined } : undefined,
  };
}

/** 로그인한 회원(또는 비회원)이 볼 수 있는 범위의 데이터 */
export async function buildSnapshot(viewer: UserRow | null): Promise<{ state: State; me: Me | null }> {
  const viewerId = viewer?.id ?? null;
  const [viewerProfile] = viewer
    ? await db.select().from(schema.therapistProfiles).where(eq(schema.therapistProfiles.userId, viewer.id))
    : [];
  const viewerUser = viewer ? toUser(viewer, viewerProfile) : null;
  const viewerTier = viewerUser ? userTier(viewerUser) : undefined;
  const canSeeClinical = !!viewerTier || !!viewer?.isAdmin;

  const boards = canSeeClinical ? ["patient", "clinical"] : ["patient"];
  const postRows = await db
    .select()
    .from(schema.posts)
    .where(
      or(
        and(inArray(schema.posts.board, boards as ("patient" | "clinical")[]), eq(schema.posts.hidden, false)),
        viewerId ? eq(schema.posts.authorId, viewerId) : undefined,
      ),
    )
    .orderBy(desc(schema.posts.createdAt))
    .limit(POST_LIMIT * 2);
  const postIds = postRows.map((p) => p.id);
  const answerRows = postIds.length ? await db.select().from(schema.answers).where(inArray(schema.answers.postId, postIds)) : [];
  const likeRows = answerRows.length
    ? await db.select().from(schema.answerLikes).where(inArray(schema.answerLikes.answerId, answerRows.map((a) => a.id)))
    : [];
  const posts = postRows.map((p) =>
    toPost(
      p,
      answerRows
        .filter((a) => a.postId === p.id && (!a.hidden || viewer?.isAdmin))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((a) => toAnswer(a, likeRows.filter((l) => l.answerId === a.id).map((l) => l.userId))),
    ),
  );

  const chatRows = viewerTier
    ? (
        await db
          .select()
          .from(schema.chatMessages)
          .where(and(eq(schema.chatMessages.room, viewerTier.id), eq(schema.chatMessages.hidden, false)))
          .orderBy(desc(schema.chatMessages.createdAt))
          .limit(200)
      ).reverse()
    : [];

  // 승인된 치료사 전원 + 화면에 등장하는 회원
  const approved = await db.select().from(schema.therapistProfiles).where(eq(schema.therapistProfiles.verification, "approved"));
  const referenced = new Set<string>([
    ...approved.map((p) => p.userId),
    ...postRows.flatMap((p) => [p.authorId, p.directTherapistId ?? ""]),
    ...answerRows.map((a) => a.authorId),
    ...chatRows.map((c) => c.authorId),
    ...(viewerId ? [viewerId] : []),
  ]);
  referenced.delete("");
  const userRows = await db.select().from(schema.users).where(inArray(schema.users.id, [...referenced]));
  const profileRows = await db.select().from(schema.therapistProfiles).where(inArray(schema.therapistProfiles.userId, [...referenced]));
  const users = userRows.map((u) => sanitize(toUser(u, profileRows.find((p) => p.userId === u.id)), viewerId));

  // 평가: 블라인드가 풀린 것만, 평가자는 익명 (내가 남긴 평가는 중복 평가 방지용으로 포함)
  const allRatings = (await db.select().from(schema.ratings).where(inArray(schema.ratings.toId, [...referenced]))).map(toRating);
  const mine = viewerId ? (await db.select().from(schema.ratings).where(eq(schema.ratings.fromId, viewerId))).map(toRating) : [];
  const ratings = [
    ...allRatings
      .filter((r) => r.fromId !== viewerId && isRevealed(r, allRatings))
      .map((r) => ({ ...r, fromId: "", revealed: true })),
    ...mine.map((r) => ({ ...r, revealed: isRevealed(r, [...allRatings, ...mine]) })),
  ];

  const txRows = viewerId
    ? await db.select().from(schema.transactions).where(eq(schema.transactions.userId, viewerId)).orderBy(desc(schema.transactions.createdAt)).limit(300)
    : [];
  const reportRows = viewerId
    ? await db.select().from(schema.reports).where(and(eq(schema.reports.reporterId, viewerId), eq(schema.reports.status, "open")))
    : [];
  const blockRows = viewerId ? await db.select().from(schema.blocks).where(eq(schema.blocks.userId, viewerId)) : [];

  return {
    state: {
      users,
      posts,
      transactions: txRows.map(toTx),
      ratings,
      chats: chatRows.map(toChat),
      reports: reportRows.map(toReport),
      blocks: blockRows.map(toBlock),
      currentUserId: viewer?.role ? viewerId : null,
    },
    me: viewer
      ? { id: viewer.id, name: viewer.name ?? "", email: viewer.email, needsOnboarding: !viewer.role, isAdmin: viewer.isAdmin }
      : null,
  };
}

/** 라운지 새 메시지 (폴링) */
export async function chatsSince(viewer: UserRow, after: string) {
  const [profile] = await db.select().from(schema.therapistProfiles).where(eq(schema.therapistProfiles.userId, viewer.id));
  const tier = userTier(toUser(viewer, profile));
  if (!tier) return [];
  const rows = await db
    .select()
    .from(schema.chatMessages)
    .where(and(eq(schema.chatMessages.room, tier.id), eq(schema.chatMessages.hidden, false), gt(schema.chatMessages.createdAt, after)))
    .orderBy(schema.chatMessages.createdAt)
    .limit(200);
  return rows.map(toChat);
}
