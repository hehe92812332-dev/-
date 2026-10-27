import type { Category, Degree, HospitalType, MembershipPlanId, PaymentMethodId, TierId } from "@/lib/config";
import type { Answer, Block, ChatMessage, Post, Rating, Report, ReportTarget, Transaction, TxType, User } from "@/lib/types";
import type { schema } from "./db";

type UserRow = typeof schema.users.$inferSelect;
type ProfileRow = typeof schema.therapistProfiles.$inferSelect;
type PostRow = typeof schema.posts.$inferSelect;
type AnswerRow = typeof schema.answers.$inferSelect;
type TxRow = typeof schema.transactions.$inferSelect;
type RatingRow = typeof schema.ratings.$inferSelect;
type ChatRow = typeof schema.chatMessages.$inferSelect;
type ReportRow = typeof schema.reports.$inferSelect;
type BlockRow = typeof schema.blocks.$inferSelect;

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : undefined);

export function toUser(u: UserRow, p?: ProfileRow | null, topTag?: [string, number]): User {
  return {
    stats: { temperature: u.temperature, ratingCount: u.ratingCount, adoptedCount: u.adoptedCount, topTag },
    id: u.id,
    name: u.name ?? "회원",
    role: u.role ?? "patient",
    avatarColor: u.avatarColor,
    joinedAt: iso(u.joinedAt)!,
    wallet: { cash: u.cash, bonus: u.bonus, earned: u.earned },
    membership:
      u.membershipPlan && u.membershipRenewsAt
        ? {
            plan: u.membershipPlan as MembershipPlanId,
            startedAt: iso(u.membershipStartedAt) ?? iso(u.membershipRenewsAt)!,
            renewsAt: iso(u.membershipRenewsAt)!,
            autoRenew: u.membershipAutoRenew,
          }
        : undefined,
    isAdmin: u.isAdmin,
    suspendedUntil: iso(u.suspendedUntil),
    therapist: p
      ? {
          licenseVerified: p.verification === "approved",
          verification: p.verification,
          rejectReason: p.rejectReason ?? undefined,
          experienceYears: p.experienceYears,
          educationHours: p.educationHours,
          degree: p.degree as Degree,
          hospitalType: p.hospitalType as HospitalType,
          hospitalName: p.hospitalName,
          specialties: p.specialties as Category[],
          bio: p.bio,
        }
      : undefined,
  };
}

export function toAnswer(a: AnswerRow, likes: string[]): Answer {
  return { id: a.id, authorId: a.authorId, body: a.body, createdAt: iso(a.createdAt)!, likes, tips: a.tips, hidden: a.hidden || undefined };
}

export function toPost(p: PostRow, answers: Answer[]): Post {
  return {
    id: p.id,
    board: p.board,
    authorId: p.authorId,
    title: p.title,
    body: p.body,
    category: p.category as Category,
    targetTier: p.targetTier as TierId,
    directTherapistId: p.directTherapistId ?? undefined,
    bounty: p.bounty,
    paidFrom: { cash: p.paidCash, bonus: p.paidBonus, earned: p.paidEarned },
    status: p.status,
    adoptedAnswerId: p.adoptedAnswerId ?? undefined,
    closedReason: (p.closedReason as Post["closedReason"]) ?? undefined,
    createdAt: iso(p.createdAt)!,
    expiresAt: iso(p.expiresAt)!,
    views: p.views,
    answers,
    answerCount: p.answerCount,
    autoLower: p.autoLower,
    tierChangedAt: iso(p.tierChangedAt),
    hidden: p.hidden || undefined,
  };
}

export function fromPost(p: Post): typeof schema.posts.$inferInsert {
  return {
    id: p.id,
    board: p.board,
    authorId: p.authorId,
    title: p.title,
    body: p.body,
    category: p.category,
    targetTier: p.targetTier,
    directTherapistId: p.directTherapistId ?? null,
    bounty: p.bounty,
    paidCash: p.paidFrom.cash,
    paidBonus: p.paidFrom.bonus,
    paidEarned: p.paidFrom.earned,
    status: p.status,
    adoptedAnswerId: p.adoptedAnswerId ?? null,
    closedReason: p.closedReason ?? null,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    views: p.views,
    hidden: !!p.hidden,
    autoLower: !!p.autoLower,
    tierChangedAt: p.tierChangedAt ?? p.createdAt,
  };
}

export function toTx(t: TxRow): Transaction {
  return {
    id: t.id,
    userId: t.userId,
    type: t.type as TxType,
    tokens: t.tokens,
    bonusTokens: t.bonusTokens ?? undefined,
    krw: t.krw ?? undefined,
    method: (t.method as PaymentMethodId) ?? undefined,
    memo: t.memo,
    createdAt: iso(t.createdAt)!,
    revoked: t.revoked || undefined,
    postId: t.postId ?? undefined,
    orderId: t.orderId ?? undefined,
    status: (t.status as Transaction["status"]) ?? undefined,
  };
}

export function fromTx(t: Transaction): typeof schema.transactions.$inferInsert {
  return {
    id: t.id,
    userId: t.userId,
    type: t.type,
    tokens: t.tokens,
    bonusTokens: t.bonusTokens ?? null,
    krw: t.krw ?? null,
    method: t.method ?? null,
    memo: t.memo,
    createdAt: t.createdAt,
    revoked: !!t.revoked,
    postId: t.postId ?? null,
    orderId: t.orderId ?? null,
    status: t.status ?? null,
  };
}

export const toRating = (r: RatingRow): Rating => ({
  id: r.id,
  fromId: r.fromId,
  toId: r.toId,
  postId: r.postId,
  answerId: r.answerId ?? undefined,
  score: r.score,
  tags: r.tags,
  createdAt: iso(r.createdAt)!,
});

export const toChat = (c: ChatRow): ChatMessage => ({
  id: c.id,
  room: c.room as TierId,
  authorId: c.authorId,
  body: c.body,
  kind: c.kind,
  channel: c.channel,
  createdAt: iso(c.createdAt)!,
  hidden: c.hidden || undefined,
});

export const toReport = (r: ReportRow): Report => ({
  id: r.id,
  reporterId: r.reporterId,
  targetType: r.targetType as ReportTarget,
  targetId: r.targetId,
  targetUserId: r.targetUserId,
  reason: r.reason,
  detail: r.detail,
  status: r.status,
  createdAt: iso(r.createdAt)!,
  resolution: r.resolution ?? undefined,
});

export const toBlock = (b: BlockRow): Block => ({ userId: b.userId, blockedId: b.blockedId, createdAt: iso(b.createdAt)! });
