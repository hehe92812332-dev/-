import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as ledger from "@/lib/ledger";
import { db, schema } from "@/server/db";
import { runLedger } from "@/server/runner";
import { makeUser, resetDb, wallet } from "./helpers";

const post = { board: "patient" as const, title: "무릎이 아파요 질문", body: "계단을 내려갈 때 무릎 앞쪽이 시큰합니다. 운동 방법이 궁금해요.", category: "근골격계" as const, targetTier: "topaz" as const };

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
});

describe("원장 실행기 (실제 PostgreSQL)", () => {
  it("충전 후 질문하면 등급 비용만큼 차감되고 거래가 기록된다", async () => {
    await makeUser("p1");
    const r1 = await runLedger("p1", {}, (s) => ledger.purchase(s, "p1", "p300", "card", "order-1"));
    expect(r1.ok).toBe(true);
    expect(await wallet("p1")).toEqual({ cash: 300, bonus: 15, earned: 0 });

    const r2 = await runLedger("p1", {}, (s) => ledger.createPost(s, "p1", post));
    expect(r2.ok).toBe(true);
    // 토파즈 17토큰, 보너스부터 차감
    expect(await wallet("p1")).toEqual({ cash: 298, bonus: 0, earned: 0 });
    const txs = await db.select().from(schema.transactions).where(sql`user_id = 'p1'`);
    expect(txs.map((t) => t.type).sort()).toEqual(["ask", "purchase"]);
  });

  it("동시에 여러 질문을 올려도 잔액이 음수가 되거나 이중 차감되지 않는다", async () => {
    await makeUser("p2", { cash: 50 });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => runLedger("p2", {}, (s) => ledger.createPost(s, "p2", post))),
    );
    const ok = results.filter((r) => r.ok).length;
    expect(ok).toBe(2); // 17 × 2 = 34 ≤ 50 < 51
    expect(await wallet("p2")).toEqual({ cash: 16, bonus: 0, earned: 0 });
    const [{ count }] = await db.execute<{ count: string }>(sql`select count(*) from posts where author_id = 'p2'`).then((r) => r.rows);
    expect(Number(count)).toBe(2);
  });

  it("답변 채택 시 답변자에게 수수료를 뺀 보상이 지급된다", async () => {
    await makeUser("asker", { cash: 100 });
    await makeUser("pt", { role: "therapist", years: 5, hours: 300 });
    const created = await runLedger("asker", {}, (s) => ledger.createPost(s, "asker", post));
    const postId = created.ok ? created.id! : "";
    const ans = await runLedger("pt", { postIds: [postId] }, (s) =>
      ledger.addAnswer(s, "pt", postId, "계단을 내려갈 때는 수술하지 않은 다리부터… 벽 스쿼트를 추천합니다."),
    );
    expect(ans.ok).toBe(true);
    const answerId = ans.ok ? ans.state.posts[0].answers[0].id : "";
    const adopted = await runLedger("asker", { postIds: [postId] }, (s) => ledger.adopt(s, "asker", postId, answerId));
    expect(adopted.ok).toBe(true);
    expect((await wallet("pt")).earned).toBe(14); // floor(17 × 0.85)
  });

  it("서류 심사 전 치료사는 답변할 수 없다", async () => {
    await makeUser("asker2", { cash: 100 });
    await makeUser("newpt", { role: "therapist", verified: false });
    const created = await runLedger("asker2", {}, (s) => ledger.createPost(s, "asker2", { ...post, targetTier: "rough" }));
    const postId = created.ok ? created.id! : "";
    const ans = await runLedger("newpt", { postIds: [postId] }, (s) => ledger.addAnswer(s, "newpt", postId, "답변 내용입니다. 충분히 긴 답변을 작성합니다."));
    expect(ans).toEqual({ ok: false, error: expect.stringContaining("서류 심사") });
  });

  it("개인정보가 포함된 질문은 거절된다", async () => {
    await makeUser("p3", { cash: 100 });
    const r = await runLedger("p3", {}, (s) => ledger.createPost(s, "p3", { ...post, body: post.body + " 연락은 010-1234-5678로 주세요" }));
    expect(r.ok).toBe(false);
    expect(await wallet("p3")).toEqual({ cash: 100, bonus: 0, earned: 0 });
  });

  it("정산 대기 중인 수익은 환전할 수 없고, 반려 시 토큰이 돌아온다", async () => {
    await makeUser("pt2", { role: "therapist", earned: 800 });
    await db.insert(schema.transactions).values({ id: "t-recent", userId: "pt2", type: "reward", tokens: 200, memo: "보상", createdAt: new Date().toISOString() });
    const tooMuch = await runLedger("pt2", { recentTxOf: ["pt2"] }, (s) => ledger.withdraw(s, "pt2", 800, "국민 123456789012"));
    expect(tooMuch.ok).toBe(false);
    const ok = await runLedger("pt2", { recentTxOf: ["pt2"] }, (s) => ledger.withdraw(s, "pt2", 600, "국민 123456789012"));
    expect(ok.ok).toBe(true);
    expect((await wallet("pt2")).earned).toBe(200);
    const txId = ok.ok ? ok.id! : "";
    const [row] = await db.select().from(schema.transactions).where(sql`id = ${txId}`);
    expect(row.memo).toContain("********9012");
    const rej = await runLedger(null, { txIds: [txId], userIds: ["pt2"] }, (s) => ledger.rejectWithdrawal(s, txId, "계좌 불일치"));
    expect(rej.ok).toBe(true);
    expect((await wallet("pt2")).earned).toBe(800);
  });
});
