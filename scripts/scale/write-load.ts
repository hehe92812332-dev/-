// 동시 쓰기 부하: 서로 다른 환자 N명이 동시에 질문하고, 치료사들이 동시에 답변 (실제 DB 트랜잭션)
// 실행: DATABASE_URL=.../ptbridge_scale npx tsx --conditions=react-server scripts/scale/write-load.ts
import { inArray, sql } from "drizzle-orm";
import * as ledger from "../../src/lib/ledger";
import { db, schema } from "../../src/server/db";
import { runLedger } from "../../src/server/runner";

const N = Number(process.argv[2] ?? 400);
const OFFSET = Number(process.argv[3] ?? 600000);
async function main() {
  const startedAt = new Date().toISOString();
  const patients = Array.from({ length: N }, (_, i) => `u${OFFSET + i}`);
  await db.update(schema.users).set({ cash: 1000 }).where(inArray(schema.users.id, patients));
  // 같은 사람이 동시에 여러 번 요청하는 경우도 섞음 (잔액 경쟁)
  const greedy = `u${OFFSET + N}`; // 위 목록과 겹치지 않는 회원
  await db.update(schema.users).set({ cash: 1000, bonus: 0, earned: 0 }).where(inArray(schema.users.id, [greedy]));
  let t = performance.now();
  const results = await Promise.all([
    ...patients.map((p) =>
      runLedger(p, {}, (s) =>
        ledger.createPost(s, p, { board: "patient", title: "동시 쓰기 테스트 질문", body: "동시 쓰기 부하 테스트용 질문 본문입니다.", category: "통증", targetTier: "rough" }),
      ),
    ),
    ...Array.from({ length: 100 }, () =>
      runLedger(greedy, {}, (s) =>
        ledger.createPost(s, greedy, { board: "patient", title: "같은 회원 동시 질문", body: "같은 회원이 동시에 여러 번 질문합니다. 잔액 확인용.", category: "통증", targetTier: "diamond" }),
      ),
    ),
  ]);
  const ms1 = performance.now() - t;
  const ok = results.filter((r) => r.ok);
  const postIds = ok.map((r) => (r.ok ? r.id! : "")).slice(0, N);
  // 치료사 100명이 서로 다른 질문에 동시에 답변 + 같은 질문 하나에 50명이 동시에 답변
  t = performance.now();
  const answers = await Promise.all([
    ...postIds.slice(0, 300).map((pid, i) => runLedger(`u${1 + (i % 100)}`, { postIds: [pid] }, (s) => ledger.addAnswer(s, `u${1 + (i % 100)}`, pid, "동시 답변 테스트입니다. 충분히 길게 작성한 답변입니다."))),
    ...Array.from({ length: 50 }, (_, i) =>
      runLedger(`u${200 + i}`, { postIds: [postIds[0]] }, (s) => ledger.addAnswer(s, `u${200 + i}`, postIds[0], "같은 질문 동시 답변 테스트입니다. 충분히 길게 작성합니다.")),
    ),
  ]);
  const ms2 = performance.now() - t;
  const [g] = (await db.execute<{ cash: number; bonus: number; earned: number }>(sql`select cash, bonus, earned from users where id = ${greedy}`)).rows;
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from posts where author_id = ${greedy} and created_at >= ${startedAt}`)).rows;
  const [{ ac }] = (await db.execute<{ ac: number }>(sql`select answer_count as ac from posts where id = ${postIds[0]}`)).rows;
  const [{ real }] = (await db.execute<{ real: number }>(sql`select count(*)::int as real from answers where post_id = ${postIds[0]}`)).rows;
  console.log(`| 질문 ${N + 100}건 동시 | ${ms1.toFixed(0)}ms | 초당 ${Math.round(((N + 100) / ms1) * 1000)}건 | 성공 ${ok.length} |`);
  console.log(`| 답변 350건 동시 | ${ms2.toFixed(0)}ms | 초당 ${Math.round((350 / ms2) * 1000)}건 | 성공 ${answers.filter((r) => r.ok).length} |`);
  console.log(`- 같은 회원 동시 100건(다이아몬드 50토큰, 잔액 1000): 등록 ${n}건, 남은 잔액 ${g.cash + g.bonus + g.earned} (기대: 20건 등록, 잔액 0)`);
  console.log(`- 같은 질문 동시 50건 답변: 저장된 답변 ${real}개, 답변 수 컬럼 ${ac} (일치해야 함)`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
