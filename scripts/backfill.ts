// 미리 계산하는 값(등급·답변 수·온도·평가 항목·채택 수)을 기존 데이터로 다시 채웁니다. 여러 번 실행해도 안전합니다.
// 실행: npm run db:backfill   (마이그레이션 직후, 또는 시드 후)
import { sql } from "drizzle-orm";
import { RATING_BLIND_DAYS, RATING_SCORES, TIERS } from "../src/lib/config";
import { db } from "../src/server/db";

// 등급 조건을 SQL CASE 로 변환 (높은 등급부터 검사)
const tierCase = sql.join(
  [...TIERS]
    .map((t, rank) => ({ t, rank }))
    .reverse()
    .map(
      ({ t, rank }) =>
        sql`when experience_years >= ${t.minYears} and education_hours >= ${t.minHours} ${t.needsDegree ? sql`and degree <> 'none'` : sql``} then ${sql.raw(`'${t.id}'`)}::text || '|' || ${rank}`,
    ),
  sql` `,
);
const delta = sql.raw(
  `case score ${Object.entries(RATING_SCORES)
    .map(([k, v]) => `when '${k}' then ${v.delta}`)
    .join(" ")} end`,
);

export async function backfill() {
  const t0 = Date.now();
  await db.execute(sql`
    update therapist_profiles set tier = split_part(x.v, '|', 1), tier_rank = split_part(x.v, '|', 2)::int
    from (select user_id, case ${tierCase} else 'rough|0' end as v from therapist_profiles where verification = 'approved') x
    where therapist_profiles.user_id = x.user_id`);
  await db.execute(sql`update therapist_profiles set tier = null, tier_rank = null where verification <> 'approved'`);
  await db.execute(sql`
    update posts set answer_count = coalesce(a.n, 0)
    from (select p.id, (select count(*) from answers where post_id = p.id and not hidden) as n from posts p) a
    where posts.id = a.id and posts.answer_count is distinct from a.n`);
  await db.execute(sql`
    update ratings r set revealed_at = now()
    where revealed_at is null and (created_at < now() - ${sql.raw(`interval '${RATING_BLIND_DAYS} days'`)}
      or exists (select 1 from ratings o where o.post_id = r.post_id and o.from_id = r.to_id and o.to_id = r.from_id))`);
  await db.execute(sql`update users set temperature = 36.5, rating_count = 0`);
  await db.execute(sql`
    update users u set temperature = least(99, greatest(0, round((36.5 + s.total)::numeric, 1))), rating_count = s.n
    from (select to_id, sum(${delta}) as total, count(*) as n from ratings where revealed_at is not null group by to_id) s
    where u.id = s.to_id`);
  await db.execute(sql`delete from user_tag_counts`);
  await db.execute(sql`
    insert into user_tag_counts (user_id, tag, count)
    select to_id, tag, count(*) from ratings, jsonb_array_elements_text(tags) as tag where revealed_at is not null group by 1, 2`);
  await db.execute(sql`update users set adopted_count = 0`);
  await db.execute(sql`
    update users u set adopted_count = s.n
    from (select a.author_id, count(*) as n from posts p join answers a on a.id = p.adopted_answer_id group by 1) s
    where u.id = s.author_id`);
  await db.execute(sql`analyze`);
  return Date.now() - t0;
}

if (process.argv[1]?.endsWith("backfill.ts"))
  backfill()
    .then((ms) => {
      console.log(`백필 완료 (${(ms / 1000).toFixed(1)}초)`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
