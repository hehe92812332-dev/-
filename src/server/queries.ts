import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { LOUNGE_CHANNELS, TIERS, type TierId } from "@/lib/config";
import { userTier } from "@/lib/ledger";
import type { User } from "@/lib/types";
import { db, schema } from "./db";
import { toAnswer, toBlock, toChat, toPost, toRating, toTx, toUser } from "./mappers";
import { HttpError } from "./errors";

// 화면별로 필요한 만큼만, 인덱스를 타는 쿼리로 읽습니다.
// (100만 명 규모 측정에서 '전부 내려주기' 방식은 첫 화면이 60~90초·78MB였음)

type UserRow = typeof schema.users.$inferSelect;
const { users, therapistProfiles: tp, posts, answers, answerLikes, ratings, chatMessages, blocks, transactions, notifications, userTagCounts } = schema;

export const PAGE = 20;

export interface Viewer {
  row: UserRow | null;
  user: User | null;
  tierRank: number; // -1 = 등급 없음
}

export async function viewerOf(row: UserRow | null): Promise<Viewer> {
  if (!row) return { row: null, user: null, tierRank: -1 };
  const [p] = await db.select().from(tp).where(eq(tp.userId, row.id));
  const user = toUser(row, p);
  const t = userTier(user);
  return { row, user, tierRank: t ? TIERS.findIndex((x) => x.id === t.id) : -1 };
}

const canSeeClinical = (v: Viewer) => v.tierRank >= 0 || !!v.row?.isAdmin;

/** 다른 회원에게 보여도 되는 정보만 */
function publicUser(u: User, viewerId: string | null): User {
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

/** 회원 요약 (작성자 표시용) */
export async function usersByIds(ids: (string | null | undefined)[], viewerId: string | null, withTopTag = false): Promise<User[]> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return [];
  const rows = await db.select().from(users).where(inArray(users.id, unique));
  const profiles = await db.select().from(tp).where(inArray(tp.userId, unique));
  const tags = withTopTag
    ? await db.execute<{ user_id: string; tag: string; count: number }>(sql`
        select distinct on (user_id) user_id, tag, count from user_tag_counts
        where user_id in ${sql`(${sql.join(unique.map((i) => sql`${i}`), sql`, `)})`} order by user_id, count desc`).then((r) => r.rows)
    : [];
  return rows.map((u) => {
    const t = tags.find((x) => x.user_id === u.id);
    return publicUser(toUser(u, profiles.find((p) => p.userId === u.id), t ? [t.tag, t.count] : undefined), viewerId);
  });
}

const blockedBy = (viewerId: string | null) =>
  viewerId ? sql`${posts.authorId} not in (select ${blocks.blockedId} from ${blocks} where ${blocks.userId} = ${viewerId})` : undefined;

const cursorOf = (r: { createdAt: string; id: string }) => `${new Date(r.createdAt).toISOString()}|${r.id}`;
function afterCursor(cursor?: string | null): SQL | undefined {
  if (!cursor) return undefined;
  const [at, id] = cursor.split("|");
  if (!at || !id || Number.isNaN(Date.parse(at))) return undefined;
  return or(lt(posts.createdAt, at), and(eq(posts.createdAt, at), lt(posts.id, id)));
}

export interface FeedParams {
  board: "patient" | "clinical";
  category?: string;
  status?: "open" | "adopted";
  q?: string;
  /** 치료사: 내가 답변할 수 있는 질문 (답변 가능한 사람이 적은 질문 먼저) */
  forMe?: boolean;
  /** 프로필: 이 회원이 쓴 질문 */
  authorId?: string;
  cursor?: string | null;
  limit?: number;
}

export async function feed(v: Viewer, p: FeedParams) {
  if (p.board === "clinical" && !canSeeClinical(v)) throw new HttpError(403, "임상 토론은 서류 심사를 마친 치료사만 볼 수 있어요.");
  const limit = Math.min(p.limit ?? PAGE, 50);
  const viewerId = v.row?.id ?? null;

  if (p.forMe) {
    if (v.tierRank < 0 || !viewerId) throw new HttpError(403, "서류 심사를 마친 치료사만 쓸 수 있는 목록이에요.");
    const eligible = TIERS.slice(0, v.tierRank + 1).map((t) => t.id);
    const page = Number(p.cursor ?? 0) || 0;
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.board, "patient"),
          eq(posts.status, "open"),
          eq(posts.hidden, false),
          ne(posts.authorId, viewerId),
          inArray(posts.targetTier, eligible),
          // 이미 답변이 3개 이상인 질문은 빼서 답변이 한 질문에 몰리지 않게
          lt(posts.answerCount, 3),
          or(isNull(posts.directTherapistId), eq(posts.directTherapistId, viewerId)),
          sql`not exists (select 1 from ${answers} where ${answers.postId} = ${posts.id} and ${answers.authorId} = ${viewerId})`,
          blockedBy(viewerId),
        ),
      )
      // 나에게 온 1:1 → 답변이 적은 질문 → 답변할 수 있는 사람이 적은(높은 등급) 질문 → 마감이 가까운 질문
      // (등급을 먼저 보면 모두가 같은 상위 질문에 몰려 낮은 등급 질문이 방치됨 — 1년 시뮬레이션에서 확인)
      .orderBy(
        sql`(${posts.directTherapistId} is not null) desc`,
        posts.answerCount,
        sql`array_position(array[${sql.join(TIERS.map((t) => sql`${t.id}`), sql`, `)}]::text[], ${posts.targetTier}) desc`,
        posts.expiresAt,
      )
      .limit(limit)
      .offset(page * limit);
    return {
      posts: rows.map((r) => toPost(r, [])),
      users: await usersByIds(rows.flatMap((r) => [r.authorId, r.directTherapistId]), viewerId),
      nextCursor: rows.length === limit ? String(page + 1) : null,
    };
  }

  const q = p.q?.trim();
  const conds = [
    eq(posts.board, p.board),
    eq(posts.hidden, false),
    p.authorId ? eq(posts.authorId, p.authorId) : ne(posts.status, "refunded"),
    p.category ? eq(posts.category, p.category) : undefined,
    p.status ? eq(posts.status, p.status) : undefined,
    // 트라이그램 인덱스는 2글자 이상에서 동작
    q && q.length >= 2 ? sql`(${posts.title} || ' ' || ${posts.body}) ilike ${"%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%"}` : undefined,
    blockedBy(viewerId),
    afterCursor(p.cursor),
  ];
  const rows = await db
    .select()
    .from(posts)
    .where(and(...conds))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit);
  return {
    posts: rows.map((r) => toPost(r, [])),
    users: await usersByIds(rows.flatMap((r) => [r.authorId, r.directTherapistId]), viewerId),
    nextCursor: rows.length === limit ? cursorOf(rows[rows.length - 1]) : null,
  };
}

/** 질문 상세: 답변·추천 + 내가 남긴 평가(중복 평가 방지 표시용) */
export async function postDetail(v: Viewer, id: string) {
  const viewerId = v.row?.id ?? null;
  const [row] = await db.select().from(posts).where(eq(posts.id, id));
  if (!row || (row.hidden && !v.row?.isAdmin && row.authorId !== viewerId)) throw new HttpError(404, "글을 찾을 수 없습니다.");
  if (row.board === "clinical" && !canSeeClinical(v)) throw new HttpError(403, "임상 토론은 서류 심사를 마친 치료사만 볼 수 있어요.");
  const answerRows = await db.select().from(answers).where(eq(answers.postId, id)).orderBy(answers.createdAt);
  const visible = answerRows.filter((a) => !a.hidden || v.row?.isAdmin);
  const likes = visible.length ? await db.select().from(answerLikes).where(inArray(answerLikes.answerId, visible.map((a) => a.id))) : [];
  const myRatings = viewerId
    ? (await db.select().from(ratings).where(and(eq(ratings.postId, id), eq(ratings.fromId, viewerId)))).map((r) => ({ ...toRating(r), revealed: !!r.revealedAt }))
    : [];
  return {
    post: toPost(
      row,
      visible.map((a) => toAnswer(a, likes.filter((l) => l.answerId === a.id).map((l) => l.userId))),
    ),
    users: await usersByIds([row.authorId, row.directTherapistId, ...visible.map((a) => a.authorId)], viewerId, true),
    myRatings,
  };
}

export interface TherapistParams {
  spec?: string;
  tier?: TierId;
  sort?: "tier" | "temp";
  cursor?: string | null;
  limit?: number;
}

/** 치료사 찾기 (승인된 치료사만) */
export async function therapistDirectory(v: Viewer, p: TherapistParams) {
  const limit = Math.min(p.limit ?? 30, 60);
  const page = Number(p.cursor ?? 0) || 0;
  const rows = await db
    .select({ u: users, p: tp })
    .from(tp)
    .innerJoin(users, eq(users.id, tp.userId))
    .where(
      and(
        eq(tp.verification, "approved"),
        isNull(users.deletedAt),
        p.spec ? sql`${tp.specialties} @> ${JSON.stringify([p.spec])}::jsonb` : undefined,
        p.tier ? eq(tp.tier, p.tier) : undefined,
      ),
    )
    .orderBy(...(p.sort === "temp" ? [desc(users.temperature), desc(tp.tierRank)] : [desc(tp.tierRank), desc(tp.experienceYears)]), users.id)
    .limit(limit)
    .offset(page * limit);
  const withTags = await usersByIds(rows.map((r) => r.u.id), v.row?.id ?? null, true);
  return { ids: rows.map((r) => r.u.id), users: withTags, nextCursor: rows.length === limit ? String(page + 1) : null };
}

/** 등급별 승인 치료사 수 (5분 캐시) */
let tierCache: { at: number; counts: Record<string, number>; questions: number } | null = null;
export async function tierCounts() {
  if (tierCache && Date.now() - tierCache.at < 300_000) return tierCache;
  const rows = await db
    .select({ tier: tp.tier, n: sql<number>`count(*)::int` })
    .from(tp)
    .innerJoin(users, eq(users.id, tp.userId))
    .where(and(eq(tp.verification, "approved"), isNull(users.deletedAt)))
    .groupBy(tp.tier);
  const counts = Object.fromEntries(rows.map((r) => [r.tier ?? "rough", r.n]));
  // 전체 질문 수는 통계 추정치 사용 (count(*)는 큰 테이블에서 느림)
  const [est] = await db.execute<{ n: number }>(sql`select greatest(reltuples, 0)::bigint as n from pg_class where relname = 'posts'`).then((r) => r.rows);
  tierCache = { at: Date.now(), counts, questions: Number(est?.n ?? 0) };
  return tierCache;
}

/** 회원 프로필: 공개된 평가 집계 + 받은 항목 + 활동 */
export async function profile(v: Viewer, id: string) {
  const viewerId = v.row?.id ?? null;
  const [u] = await usersByIds([id], viewerId, true);
  if (!u) throw new HttpError(404, "회원을 찾을 수 없습니다.");
  const scoreRows = await db
    .select({ score: ratings.score, n: sql<number>`count(*)::int` })
    .from(ratings)
    .where(and(eq(ratings.toId, id), isNotNull(ratings.revealedAt)))
    .groupBy(ratings.score);
  const tagRows = await db.select().from(userTagCounts).where(eq(userTagCounts.userId, id)).orderBy(desc(userTagCounts.count)).limit(10);
  const boards = canSeeClinical(v) ? ["patient", "clinical"] : ["patient"];
  const activity = u.therapist
    ? await db
        .select({ p: posts })
        .from(answers)
        .innerJoin(posts, eq(posts.id, answers.postId))
        .where(and(eq(answers.authorId, id), eq(answers.hidden, false), eq(posts.hidden, false), inArray(posts.board, boards as ("patient" | "clinical")[])))
        .orderBy(desc(answers.createdAt))
        .limit(20)
        .then((r) => r.map((x) => x.p))
    : await db
        .select()
        .from(posts)
        .where(and(eq(posts.authorId, id), eq(posts.hidden, false), ne(posts.status, "refunded"), inArray(posts.board, boards as ("patient" | "clinical")[])))
        .orderBy(desc(posts.createdAt))
        .limit(20);
  return {
    user: u,
    scoreCounts: Object.fromEntries(scoreRows.map((r) => [r.score, r.n])) as Record<string, number>,
    tags: tagRows.map((t) => [t.tag, t.count] as [string, number]),
    posts: activity.map((r) => toPost(r, [])),
    users: await usersByIds(activity.map((r) => r.authorId), viewerId),
  };
}

/** 등급 라운지 메시지: 최신 50개 / after 이후 새 메시지 / before 이전 기록 */
export async function loungeMessages(v: Viewer, channel: string, opts: { after?: string; before?: string }) {
  if (v.tierRank < 0 || !v.row) throw new HttpError(403, "등급 라운지는 서류 심사를 마친 치료사만 이용할 수 있어요.");
  if (!(LOUNGE_CHANNELS as readonly string[]).includes(channel)) throw new HttpError(400, "없는 채널입니다.");
  const room = TIERS[v.tierRank].id;
  const base = and(eq(chatMessages.room, room), eq(chatMessages.channel, channel), eq(chatMessages.hidden, false));
  const rows = opts.after
    ? await db.select().from(chatMessages).where(and(base, gt(chatMessages.createdAt, opts.after))).orderBy(chatMessages.createdAt).limit(200)
    : (
        await db
          .select()
          .from(chatMessages)
          .where(and(base, opts.before ? lt(chatMessages.createdAt, opts.before) : undefined))
          .orderBy(desc(chatMessages.createdAt))
          .limit(50)
      ).reverse();
  // 채널별 마지막 메시지 시각 (새 글 표시용) — 채널마다 인덱스 끝 한 건만 읽음
  // (방 전체를 묶어 세면 100만 명 규모에서 200ms 이상 걸려 폴링에 부담)
  const last = await db
    .execute<{ channel: string; at: string | null }>(
      sql`select c as channel, (select max(${chatMessages.createdAt}) from ${chatMessages} where ${chatMessages.room} = ${room} and ${chatMessages.channel} = c) as at
          from unnest(array[${sql.join(LOUNGE_CHANNELS.map((c) => sql`${c}`), sql`, `)}]::text[]) as c`,
    )
    .then((r) => r.rows.filter((x) => x.at));
  return {
    messages: rows.map(toChat),
    users: await usersByIds(rows.map((r) => r.authorId), v.row.id),
    channels: Object.fromEntries(last.map((l) => [l.channel, new Date(l.at!).toISOString()])) as Record<string, string>,
    hasMore: !opts.after && rows.length === 50,
  };
}

/** 첫 화면: 내 정보·지갑·거래·차단·알림 수만 (다른 데이터는 화면별 API) */
export async function bootstrap(v: Viewer) {
  if (!v.row) return { me: null, user: null, transactions: [], blocks: [], unread: 0 };
  const id = v.row.id;
  const [tx, bl, unread] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.userId, id)).orderBy(desc(transactions.createdAt)).limit(100),
    db.select().from(blocks).where(eq(blocks.userId, id)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, id), eq(notifications.read, false))),
  ]);
  return {
    me: { id, name: v.row.name ?? "", email: v.row.email, needsOnboarding: !v.row.role, isAdmin: v.row.isAdmin },
    user: v.row.role ? v.user : null,
    transactions: tx.map(toTx),
    blocks: bl.map(toBlock),
    unread: unread[0]?.n ?? 0,
  };
}

export async function listNotifications(userId: string) {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(30);
}

export async function markNotificationsRead(userId: string) {
  await db.update(notifications).set({ read: true }).where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
}

