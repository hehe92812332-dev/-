// 100만 명 규모 DB에서 주요 서버 경로의 응답 시간과 응답 크기를 측정합니다.
// 실행: DATABASE_URL=.../ptbridge_scale npx tsx --conditions=react-server scripts/scale/bench.ts
import { eq, sql } from "drizzle-orm";
import * as ledger from "../../src/lib/ledger";
import { db, schema } from "../../src/server/db";
import { runLedger } from "../../src/server/runner";
import * as Q from "../../src/server/queries";
import { runScheduledJobs } from "../../src/server/payments";

const results: [string, string, string][] = [];
async function time<T>(label: string, fn: () => Promise<T>, size?: (r: T) => number, n = 3) {
  const runs: number[] = [];
  let last: T | undefined;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    last = await fn();
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  const kb = size && last !== undefined ? `${(size(last) / 1024).toFixed(0)} KB` : "";
  const mid = runs[Math.floor(runs.length / 2)];
  results.push([label, `${mid.toFixed(0)} ms`, kb]);
  console.error(label, mid.toFixed(0), "ms", kb);
  return last!;
}
const json = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
const row = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0];

async function main() {
  const patient = await row("u500000");
  const therapist = await row("u10");
  await db.update(schema.users).set({ cash: 100000 }).where(eq(schema.users.id, "u500000"));
  const vp = await Q.viewerOf(patient);
  const vt = await Q.viewerOf(therapist);
  const guest = await Q.viewerOf(null);

  await time("첫 화면 데이터 (환자)", () => Q.bootstrap(vp), json);
  await time("첫 화면 데이터 (치료사)", () => Q.bootstrap(vt), json);
  const first = await time("질문 목록 1페이지 (비회원)", () => Q.feed(guest, { board: "patient" }), json);
  await time("질문 목록 2페이지", () => Q.feed(guest, { board: "patient", cursor: first.nextCursor }), json);
  await time("목록: 카테고리+답변대기", () => Q.feed(vp, { board: "patient", category: "소아", status: "open" }), json);
  await time("검색 '무릎'", () => Q.feed(vp, { board: "patient", q: "무릎" }), json);
  await time("검색 '고관절 스트레칭'", () => Q.feed(vp, { board: "patient", q: "고관절 스트레칭" }), json);
  await time("내가 답변할 수 있는 질문 (치료사)", () => Q.feed(vt, { board: "patient", forMe: true }), json);
  await time("임상 토론 목록 (치료사)", () => Q.feed(vt, { board: "clinical" }), json);
  await time("질문 상세", () => Q.postDetail(vp, first.posts[0].id), json);
  await time("치료사 찾기 (등급순)", () => Q.therapistDirectory(vp, { sort: "tier" }), json);
  await time("치료사 찾기 (온도순·분야)", () => Q.therapistDirectory(vp, { sort: "temp", spec: "통증" }), json);
  await time("회원 프로필 (치료사)", () => Q.profile(vp, "u10"), json);
  await time("등급별 치료사 수", () => Q.tierCounts(), json);
  await time("라운지 채널 열기 (최신 50개)", () => Q.loungeMessages(vt, "자유", {}), json);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  await time("라운지 새 메시지 확인 (폴링 1회)", () => Q.loungeMessages(vt, "자유", { after: hourAgo }), json);

  let postId = "";
  await time("질문 등록", async () => {
    const r = await runLedger("u500000", {}, (s) =>
      ledger.createPost(s, "u500000", { board: "patient", title: "부하 테스트 질문", body: "부하 테스트용 질문 본문입니다. 충분히 길게 씁니다.", category: "통증", targetTier: "rough" }),
    );
    postId = r.ok ? r.id! : "";
    return r;
  });
  await time("답변 등록", () => runLedger("u10", { postIds: [postId] }, (s) => ledger.addAnswer(s, "u10", postId, "부하 테스트 답변입니다. 충분히 길게 작성합니다.")));
  await time("예약 작업 1회 (기한 정산·평가 공개·알림)", () => runScheduledJobs(), undefined, 1);

  console.log("| 경로 | 응답 시간(중앙값) | 응답 크기 |\n|---|---|---|");
  for (const [a, b, c] of results) console.log(`| ${a} | ${b} | ${c} |`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
