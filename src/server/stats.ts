import "server-only";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { RATING_BLIND_DAYS, RATING_SCORES, type Degree } from "@/lib/config";
import { tierFor, tierRank } from "@/lib/tier";
import { schema, type Tx } from "./db";

/** 승인된 프로필의 보석 등급 */
export function tierColumns(p: { experienceYears: number; educationHours: number; degree: string }) {
  const t = tierFor({ experienceYears: p.experienceYears, educationHours: p.educationHours, degree: p.degree as Degree });
  return { tier: t.id, tierRank: tierRank(t.id) };
}

type RatingRow = typeof schema.ratings.$inferSelect;

/** 평가를 공개하고 받은 사람의 온도·평가 수·항목 집계에 반영 */
export async function applyReveal(tx: Tx, rows: RatingRow[]) {
  const now = new Date().toISOString();
  for (const r of rows) {
    if (r.revealedAt) continue;
    const updated = await tx
      .update(schema.ratings)
      .set({ revealedAt: now })
      .where(and(eq(schema.ratings.id, r.id), isNull(schema.ratings.revealedAt)))
      .returning({ id: schema.ratings.id });
    if (!updated.length) continue; // 다른 요청이 먼저 반영
    await tx
      .update(schema.users)
      .set({
        temperature: sql`least(99, greatest(0, round((${schema.users.temperature} + ${RATING_SCORES[r.score].delta})::numeric, 1)))`,
        ratingCount: sql`${schema.users.ratingCount} + 1`,
      })
      .where(eq(schema.users.id, r.toId));
    for (const tag of r.tags)
      await tx
        .insert(schema.userTagCounts)
        .values({ userId: r.toId, tag, count: 1 })
        .onConflictDoUpdate({ target: [schema.userTagCounts.userId, schema.userTagCounts.tag], set: { count: sql`${schema.userTagCounts.count} + 1` } });
  }
}

/** 새 평가가 들어오면, 같은 질문에서 서로 평가했는지 보고 둘 다 공개 */
export async function revealMutual(tx: Tx, ratingIds: string[]) {
  if (!ratingIds.length) return;
  const fresh = await tx.select().from(schema.ratings).where(inArray(schema.ratings.id, ratingIds));
  for (const r of fresh) {
    const [other] = await tx
      .select()
      .from(schema.ratings)
      .where(and(eq(schema.ratings.postId, r.postId), eq(schema.ratings.fromId, r.toId), eq(schema.ratings.toId, r.fromId)));
    if (other) await applyReveal(tx, [r, other]);
  }
}

/** 블라인드 기간이 지난 평가 공개 (크론) */
export async function revealExpired(tx: Tx, limit = 5000) {
  const cutoff = new Date(Date.now() - RATING_BLIND_DAYS * 86400_000).toISOString();
  const rows = await tx.select().from(schema.ratings).where(and(isNull(schema.ratings.revealedAt), lte(schema.ratings.createdAt, cutoff))).limit(limit);
  await applyReveal(tx, rows);
  return rows.length;
}
