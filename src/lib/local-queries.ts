// 데모 모드용 조회 — 서버의 src/server/queries.ts 와 같은 결과 형태·정렬·권한 규칙을 브라우저 데이터로 흉내 냅니다.

import { TIERS, type TierId } from "./config";
import { userTier, type State } from "./ledger";
import { tagCounts, visibleRatings } from "./manner";
import { tierRank } from "./tier";
import type { Post, User } from "./types";

export interface FeedParams {
  board: "patient" | "clinical";
  category?: string;
  status?: "open" | "adopted";
  q?: string;
  forMe?: boolean;
  authorId?: string;
  cursor?: string | null;
  limit?: number;
}

export interface TherapistParams {
  spec?: string;
  tier?: TierId;
  sort?: "tier" | "temp";
  cursor?: string | null;
  limit?: number;
}

const viewerTierRank = (s: State) => {
  const me = s.users.find((u) => u.id === s.currentUserId);
  const t = me && userTier(me);
  return t ? tierRank(t.id) : -1;
};

const blockedIds = (s: State) => new Set(s.blocks.filter((b) => b.userId === s.currentUserId).map((b) => b.blockedId));

function page<T>(xs: T[], cursor: string | null | undefined, limit: number) {
  const start = Number(cursor ?? 0) || 0;
  const slice = xs.slice(start, start + limit);
  return { slice, nextCursor: start + limit < xs.length ? String(start + limit) : null };
}

export function localFeed(s: State, p: FeedParams) {
  const limit = p.limit ?? 20;
  const blocked = blockedIds(s);
  const me = s.currentUserId;
  let list: Post[];
  if (p.forMe) {
    const rank = viewerTierRank(s);
    list = s.posts
      .filter(
        (x) =>
          x.board === "patient" &&
          x.status === "open" &&
          !x.hidden &&
          x.authorId !== me &&
          tierRank(x.targetTier) <= rank &&
          (!x.directTherapistId || x.directTherapistId === me) &&
          !x.answers.some((a) => a.authorId === me) &&
          x.answers.length < 3 &&
          !blocked.has(x.authorId),
      )
      .sort(
        (a, b) =>
          Number(!!b.directTherapistId) - Number(!!a.directTherapistId) ||
          a.answers.length - b.answers.length ||
          tierRank(b.targetTier) - tierRank(a.targetTier) ||
          a.expiresAt.localeCompare(b.expiresAt),
      );
  } else {
    const q = p.q?.trim();
    list = s.posts
      .filter(
        (x) =>
          x.board === p.board &&
          !x.hidden &&
          (p.authorId ? x.authorId === p.authorId : x.status !== "refunded") &&
          (!p.category || x.category === p.category) &&
          (!p.status || x.status === p.status) &&
          (!q || x.title.includes(q) || x.body.includes(q)) &&
          !blocked.has(x.authorId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { slice, nextCursor } = page(list, p.cursor, limit);
  return { ids: slice.map((x) => x.id), nextCursor };
}

const adoptedCount = (s: State, id: string) =>
  s.posts.filter((p) => p.adoptedAnswerId && p.answers.find((a) => a.id === p.adoptedAnswerId)?.authorId === id).length;

/** 데모 회원 표시값 (서버 모드에서는 서버가 계산해 User.stats로 내려줌) */
export function localStats(s: State, u: User) {
  const vis = visibleRatings(s.ratings, u.id);
  const tags = tagCounts(s.ratings, u.id);
  const temp = vis.reduce((t, r) => t + ({ great: 0.5, good: 0.2, bad: -0.5 } as const)[r.score], 36.5);
  return { temperature: Math.round(Math.min(99, Math.max(0, temp)) * 10) / 10, ratingCount: vis.length, adoptedCount: adoptedCount(s, u.id), topTag: tags[0] };
}

export function localTherapists(s: State, p: TherapistParams) {
  const withStats = s.users
    .filter((u) => u.therapist?.licenseVerified)
    .filter((u) => !p.spec || u.therapist!.specialties.includes(p.spec as never))
    .filter((u) => !p.tier || userTier(u)?.id === p.tier)
    .map((u) => ({ u, st: localStats(s, u) }));
  withStats.sort((a, b) =>
    p.sort === "temp"
      ? b.st.temperature - a.st.temperature
      : tierRank(userTier(b.u)!.id) - tierRank(userTier(a.u)!.id) || b.u.therapist!.experienceYears - a.u.therapist!.experienceYears,
  );
  const { slice, nextCursor } = page(withStats, p.cursor, p.limit ?? 30);
  return { ids: slice.map((x) => x.u.id), nextCursor };
}

export function localTierCounts(s: State) {
  const counts: Record<string, number> = {};
  for (const u of s.users) {
    const t = userTier(u);
    if (t) counts[t.id] = (counts[t.id] ?? 0) + 1;
  }
  return counts;
}

export function localProfile(s: State, id: string) {
  const u = s.users.find((x) => x.id === id);
  if (!u) return null;
  const vis = visibleRatings(s.ratings, id);
  const scoreCounts: Record<string, number> = {};
  for (const r of vis) scoreCounts[r.score] = (scoreCounts[r.score] ?? 0) + 1;
  const canSeeClinical = viewerTierRank(s) >= 0;
  const posts = (u.therapist ? s.posts.filter((p) => p.answers.some((a) => a.authorId === id)) : s.posts.filter((p) => p.authorId === id && p.status !== "refunded"))
    .filter((p) => !p.hidden && (p.board === "patient" || canSeeClinical))
    .slice(0, 20);
  return { scoreCounts, tags: tagCounts(s.ratings, id).slice(0, 10), postIds: posts.map((p) => p.id) };
}

/** 답변 가능한 치료사 수 (질문 등급 이상) */
export function eligibleFromCounts(counts: Record<string, number>, tier: TierId) {
  return TIERS.slice(tierRank(tier)).reduce((n, t) => n + (counts[t.id] ?? 0), 0);
}
