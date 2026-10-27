// 건강 소식 공용 규칙 — 서버(src/server/news.ts)와 데모 모드가 같이 씁니다.

import { addDays, type Article, type ArticleContent } from "./news-types";

export * from "./news-types";

export const NEWS_PAGE = 12;

/** 목록 카드용 (본문 제외) */
export type ArticleSummary = Pick<Article, "id" | "slug" | "title" | "category" | "bodyPart" | "summary" | "publishOn" | "authorName" | "views" | "status" | "reviewNote">;

export const toSummary = ({ id, slug, title, category, bodyPart, summary, publishOn, authorName, views, status, reviewNote }: Article): ArticleSummary => ({
  id,
  slug,
  title,
  category,
  bodyPart,
  summary,
  publishOn,
  authorName,
  views,
  status,
  reviewNote,
});

export interface NewsParams {
  category?: string;
  bodyPart?: string;
  q?: string;
  cursor?: string | null;
  limit?: number;
}

/** from 날짜부터 비어 있는 첫 게시일 */
export function nextFreeDate(taken: Iterable<string>, from: string) {
  const set = new Set(taken);
  let d = from;
  while (set.has(d)) d = addDays(d, 1);
  return d;
}

/** from부터 days일 동안 게시글이 없는 날짜 */
export function scheduleGaps(taken: Iterable<string>, from: string, days: number) {
  const set = new Set(taken);
  return Array.from({ length: days }, (_, i) => addDays(from, i)).filter((d) => !set.has(d));
}

// ───────── 데모 모드: 기본 글 모음을 하루 한 편씩 돌려 가며 공개 ─────────

const EPOCH = "2026-01-01";
const dayIndex = (ymd: string) => Math.round((Date.parse(ymd + "T00:00:00Z") - Date.parse(EPOCH + "T00:00:00Z")) / 86400_000);

/** 오늘부터 거꾸로 글 모음 개수만큼의 날짜에 한 편씩 배정 (매일 다른 글이 '오늘의 글'이 됨) */
export function demoArticles(library: ArticleContent[], today: string): Article[] {
  const n = library.length;
  const base = dayIndex(today);
  return Array.from({ length: n }, (_, i) => {
    const a = library[(((base - i) % n) + n) % n];
    return {
      ...a,
      id: `lib-${a.slug}`,
      status: "approved" as const,
      publishOn: addDays(today, -i),
      authorId: null,
      authorName: "PT 브릿지 편집팀",
      views: 0,
      createdAt: new Date(Date.parse(addDays(today, -i) + "T00:00:00+09:00")).toISOString(),
    };
  });
}

/** 데모용 목록 필터 — 서버 쿼리와 같은 정렬(게시일 최신순) */
export function filterArticles(list: Article[], p: NewsParams) {
  const q = p.q?.trim().toLowerCase();
  const limit = p.limit ?? NEWS_PAGE;
  const filtered = list
    .filter((a) => (!p.category || a.category === p.category) && (!p.bodyPart || a.bodyPart === p.bodyPart))
    .filter((a) => !q || a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q))
    .sort((a, b) => (b.publishOn ?? "").localeCompare(a.publishOn ?? "") || b.id.localeCompare(a.id));
  const start = Number(p.cursor ?? 0) || 0;
  return { items: filtered.slice(start, start + limit).map(toSummary), nextCursor: start + limit < filtered.length ? String(start + limit) : null };
}

/** 같은 부위 → 같은 분류 순으로 관련 글 */
export function relatedOf(list: Article[], a: Article, n = 3) {
  const others = list.filter((x) => x.id !== a.id);
  return [...others.filter((x) => x.bodyPart === a.bodyPart), ...others.filter((x) => x.bodyPart !== a.bodyPart && x.category === a.category)].slice(0, n).map(toSummary);
}
