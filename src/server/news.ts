import "server-only";
import { and, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { ARTICLE_REWARD_TOKENS } from "@/lib/config";
import * as ledger from "@/lib/ledger";
import { NEWS_PAGE, nextFreeDate, scheduleGaps, toSummary, todayKST, addDays, type Article, type NewsParams } from "@/lib/news";
import type { ArticleData } from "@/lib/news-input";
import { db, schema, type Tx } from "./db";
import { HttpError } from "./errors";
import { notify } from "./notify";
import { runLedger } from "./runner";

// 건강 소식: 관리자 검수(approved)를 거친 글이 publish_on(한국 날짜)이 되면 공개됩니다.

type Row = typeof schema.articles.$inferSelect;
const { articles } = schema;

export const toArticle = (r: Row): Article => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  category: r.category as Article["category"],
  bodyPart: r.bodyPart as Article["bodyPart"],
  summary: r.summary,
  causes: r.causes,
  exercises: r.exercises,
  redFlags: r.redFlags,
  emergency: r.emergency ?? undefined,
  tips: r.tips,
  status: r.status,
  publishOn: r.publishOn,
  authorId: r.authorId,
  authorName: r.authorName,
  reviewNote: r.reviewNote ?? undefined,
  views: r.views,
  createdAt: new Date(r.createdAt).toISOString(),
});

const published = (today = todayKST()) => and(eq(articles.status, "approved"), lte(articles.publishOn, today));
const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => "\\" + c);

/** 공개된 글 목록 (게시일 최신순). 첫 번째 글이 '오늘의 건강 정보' */
export async function listArticles(p: NewsParams) {
  const limit = Math.min(Math.max(p.limit ?? NEWS_PAGE, 1), 50);
  const conds: (SQL | undefined)[] = [published()];
  if (p.category) conds.push(eq(articles.category, p.category));
  if (p.bodyPart) conds.push(eq(articles.bodyPart, p.bodyPart));
  if (p.q?.trim()) {
    const like = `%${likeEscape(p.q.trim())}%`;
    conds.push(or(sql`${articles.title} ilike ${like}`, sql`${articles.summary} ilike ${like}`));
  }
  if (p.cursor) {
    const [day, id] = p.cursor.split("|");
    if (day && id) conds.push(sql`(${articles.publishOn}, ${articles.id}) < (${day}, ${id})`);
  }
  const rows = await db
    .select()
    .from(articles)
    .where(and(...conds))
    .orderBy(desc(articles.publishOn), desc(articles.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { items: page.map((r) => toSummary(toArticle(r))), nextCursor: rows.length > limit && last ? `${last.publishOn}|${last.id}` : null };
}

/** 내가 제출한 원고 (상태 포함) */
export async function myArticles(userId: string) {
  const rows = await db.select().from(articles).where(eq(articles.authorId, userId)).orderBy(desc(articles.createdAt)).limit(50);
  return { items: rows.map((r) => toSummary(toArticle(r))), nextCursor: null };
}

/** 글 상세 + 관련 글. 공개 전 글은 작성자·관리자만 미리 볼 수 있습니다 */
export async function getArticle(slug: string, viewer: { id: string; isAdmin: boolean } | null) {
  const [r] = await db.select().from(articles).where(eq(articles.slug, slug));
  if (!r) throw new HttpError(404, "글을 찾을 수 없습니다.");
  const a = toArticle(r);
  const isPublic = a.status === "approved" && !!a.publishOn && a.publishOn <= todayKST();
  if (!isPublic && !viewer?.isAdmin && viewer?.id !== a.authorId) throw new HttpError(404, "글을 찾을 수 없습니다.");
  const related = await db
    .select()
    .from(articles)
    .where(and(published(), ne(articles.id, a.id), or(eq(articles.bodyPart, a.bodyPart), eq(articles.category, a.category))))
    .orderBy(sql`(${articles.bodyPart} = ${a.bodyPart}) desc`, desc(articles.publishOn))
    .limit(3);
  return { article: a, related: related.map((x) => toSummary(toArticle(x))), preview: !isPublic };
}

export async function countView(id: string) {
  await db.update(articles).set({ views: sql`${articles.views} + 1` }).where(eq(articles.id, id));
}

/** 치료사 원고 제출 → 검수 대기 */
export async function submitArticle(author: { id: string; name: string }, input: ArticleData) {
  const id = `ar-${crypto.randomUUID()}`;
  await db.insert(articles).values({
    id,
    slug: `t-${crypto.randomUUID().slice(0, 8)}`,
    ...input,
    emergency: input.emergency ?? null,
    status: "review",
    authorId: author.id,
    authorName: `${author.name} 물리치료사`,
  });
  return id;
}

/** 오늘 이후 이미 예약된 게시일 */
async function takenDates(tx: Tx | typeof db, from: string) {
  const rows = await tx.select({ d: articles.publishOn }).from(articles).where(and(eq(articles.status, "approved"), gte(articles.publishOn, from)));
  return rows.map((r) => r.d!).filter(Boolean);
}

/** 관리자 화면: 검수 대기 원고 + 앞으로 14일 게시 일정 */
export async function adminNews() {
  const today = todayKST();
  const queue = await db.select().from(articles).where(eq(articles.status, "review")).orderBy(articles.createdAt).limit(50);
  const end = addDays(today, 13);
  const scheduled = await db
    .select()
    .from(articles)
    .where(and(eq(articles.status, "approved"), gte(articles.publishOn, today), lte(articles.publishOn, end)))
    .orderBy(articles.publishOn);
  const taken = await takenDates(db, today);
  return {
    today,
    queue: queue.map(toArticle),
    schedule: scheduled.map((r) => toSummary(toArticle(r))),
    gaps: scheduleGaps(taken, today, 14),
    nextFree: nextFreeDate(taken, addDays(today, 1)),
  };
}

const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** 승인 + 게시일 예약 + 원고료 지급 (치료사 원고). 같은 원고가 두 번 승인되지 않도록 상태 조건으로 갱신합니다 */
export async function approveArticle(adminId: string, articleId: string, opts: { publishOn?: string; note?: string }) {
  if (opts.publishOn && (!ymd.test(opts.publishOn) || opts.publishOn < todayKST())) throw new HttpError(400, "게시일은 오늘 이후 날짜로 정해 주세요.");
  const [a] = await db.select().from(articles).where(eq(articles.id, articleId));
  if (!a) throw new HttpError(404, "원고를 찾을 수 없습니다.");
  if (a.status !== "review") throw new HttpError(409, "이미 처리된 원고입니다.");

  const finish = async (tx: Tx) => {
    const publishOn = opts.publishOn ?? nextFreeDate(await takenDates(tx, todayKST()), addDays(todayKST(), 1));
    const done = await tx
      .update(articles)
      .set({ status: "approved", publishOn, reviewNote: opts.note || null })
      .where(and(eq(articles.id, articleId), eq(articles.status, "review")))
      .returning({ id: articles.id });
    if (!done.length) throw new HttpError(409, "이미 처리된 원고입니다.");
    await tx.insert(schema.adminLogs).values({ id: crypto.randomUUID(), adminId, action: "articleApprove", targetId: articleId, detail: `${publishOn} ${opts.note ?? ""}`.trim() });
    if (a.authorId)
      await notify(tx, a.authorId, "article", `원고 「${a.title}」가 검수를 통과해 ${publishOn}에 게시돼요. 원고료 ${ARTICLE_REWARD_TOKENS}토큰을 드렸어요.`, `/news/${a.slug}`);
    return publishOn;
  };

  let publishOn = "";
  if (a.authorId) {
    const r = await runLedger(null, { userIds: [a.authorId] }, (s) => ledger.rewardArticle(s, a.authorId!, ARTICLE_REWARD_TOKENS, a.title), async (tx) => {
      publishOn = await finish(tx);
    });
    if (!r.ok) throw new HttpError(400, r.error);
  } else publishOn = await db.transaction((tx) => finish(tx));
  return { publishOn };
}

/** 반려(검수 대기) 또는 게시 중단(승인된 글) */
export async function setArticleStatus(adminId: string, articleId: string, status: "rejected" | "archived", reason: string) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(articles).where(eq(articles.id, articleId)).for("update");
    if (!a) throw new HttpError(404, "원고를 찾을 수 없습니다.");
    if (status === "rejected" && a.status !== "review") throw new HttpError(409, "검수 대기 중인 원고만 반려할 수 있습니다.");
    if (status === "archived" && a.status !== "approved") throw new HttpError(409, "게시된(예약된) 글만 내릴 수 있습니다.");
    await tx.update(articles).set({ status, reviewNote: reason }).where(eq(articles.id, articleId));
    await tx.insert(schema.adminLogs).values({ id: crypto.randomUUID(), adminId, action: status === "rejected" ? "articleReject" : "articleArchive", targetId: articleId, detail: reason });
    if (a.authorId)
      await notify(
        tx,
        a.authorId,
        "article",
        status === "rejected" ? `원고 「${a.title}」 보완이 필요해요: ${reason}` : `글 「${a.title}」 게시가 중단됐어요: ${reason}`,
        "/news/write",
      );
  });
}

/** 예약된 글의 게시일 변경 */
export async function rescheduleArticle(adminId: string, articleId: string, publishOn: string) {
  if (!ymd.test(publishOn) || publishOn < todayKST()) throw new HttpError(400, "게시일은 오늘 이후 날짜로 정해 주세요.");
  const done = await db
    .update(articles)
    .set({ publishOn })
    .where(and(eq(articles.id, articleId), eq(articles.status, "approved")))
    .returning({ id: articles.id });
  if (!done.length) throw new HttpError(409, "승인된 글만 게시일을 바꿀 수 있습니다.");
  await db.insert(schema.adminLogs).values({ id: crypto.randomUUID(), adminId, action: "articleReschedule", targetId: articleId, detail: publishOn });
}

/** 기본 글 모음 넣기 (이미 있는 slug는 건너뜀) */
export async function importLibrary(list: Omit<Article, "id" | "views" | "createdAt" | "authorId">[]) {
  if (!list.length) return 0;
  const existing = new Set(
    (await db.select({ slug: articles.slug }).from(articles).where(inArray(articles.slug, list.map((a) => a.slug)))).map((r) => r.slug),
  );
  const fresh = list.filter((a) => !existing.has(a.slug));
  if (fresh.length)
    await db.insert(articles).values(
      fresh.map((a) => ({ ...a, id: `ar-${a.slug}`, emergency: a.emergency ?? null, reviewNote: a.reviewNote ?? null, authorId: null })),
    );
  return fresh.length;
}
