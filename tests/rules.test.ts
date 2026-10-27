import { describe, expect, it } from "vitest";
import * as ledger from "@/lib/ledger";
import { temperatureOf } from "@/lib/manner";
import { seedChats, seedPosts, seedRatings, seedTransactions, seedUsers } from "@/lib/seed";
import type { Rating } from "@/lib/types";

const demo = (): ledger.State => ({
  users: seedUsers(),
  posts: seedPosts(),
  transactions: seedTransactions(),
  ratings: seedRatings(),
  chats: seedChats(),
  reports: [],
  blocks: [],
  currentUserId: "u-patient",
});

describe("질문 비용", () => {
  it("1:1 지정 할증을 붙여도 최대 50토큰", () => {
    const s = demo();
    const patient = s.users.find((u) => u.id === "u-patient")!;
    expect(ledger.quoteQuestion(s, patient, { targetTier: "rough", directTherapistId: "u-legend" }).total).toBe(50);
    expect(ledger.quoteQuestion(s, patient, { targetTier: "rough", directTherapistId: "u-master" }).total).toBe(50); // 35×1.5=53 → 50
    expect(ledger.quoteQuestion(s, patient, { targetTier: "rough", directTherapistId: "u-expert" }).total).toBe(26); // 17×1.5
  });

  it("멤버십 할인은 상한 적용 후", () => {
    const s = demo();
    const patient = { ...s.users.find((u) => u.id === "u-patient")!, membership: { plan: "premium" as const, startedAt: "", renewsAt: "", autoRenew: true } };
    expect(ledger.quoteQuestion(s, patient, { targetTier: "diamond" }).total).toBe(40);
  });
});

describe("환불은 낸 지갑 그대로", () => {
  it("보너스로 낸 질문을 취소하면 보너스로 돌아온다", () => {
    let s = demo();
    s = { ...s, users: s.users.map((u) => (u.id === "u-patient" ? { ...u, wallet: { cash: 100, bonus: 10, earned: 0 } } : u)) };
    const r = ledger.createPost(s, "u-patient", {
      board: "patient",
      title: "어깨가 아파요 질문",
      body: "팔을 들 때 어깨 앞쪽이 아픕니다. 어떤 운동을 하면 좋을까요?",
      category: "근골격계",
      targetTier: "topaz",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.users.find((u) => u.id === "u-patient")!.wallet).toEqual({ cash: 93, bonus: 0, earned: 0 });
    const c = ledger.cancelPost(r.state, "u-patient", r.id!);
    expect(c.ok && c.state.users.find((u) => u.id === "u-patient")!.wallet).toEqual({ cash: 100, bonus: 10, earned: 0 });
  });
});

describe("개인정보 차단", () => {
  it.each(["010-1234-5678", "01012345678", "010 1234 5678", "900101-1234567"])("%s 차단", (t) => {
    expect(ledger.findPersonalInfo(`연락처 ${t} 입니다`)).toBeTruthy();
  });
  it("일반 숫자는 통과", () => {
    expect(ledger.findPersonalInfo("하루 10시간, 30도 각도로 3세트 10회")).toBeUndefined();
  });
});

describe("블라인드 상호 평가", () => {
  const base = (over: Partial<Rating>): Rating => ({
    id: Math.random().toString(),
    fromId: "a",
    toId: "b",
    postId: "p",
    score: "great",
    tags: [],
    createdAt: new Date().toISOString(),
    ...over,
  });
  it("상대가 평가하기 전에는 반영되지 않는다", () => {
    expect(temperatureOf([base({})], "b")).toBe(36.5);
  });
  it("상대도 평가하면 둘 다 반영된다", () => {
    const rs = [base({}), base({ fromId: "b", toId: "a", score: "good" })];
    expect(temperatureOf(rs, "b")).toBe(37);
    expect(temperatureOf(rs, "a")).toBe(36.7);
  });
  it("7일이 지나면 반영된다", () => {
    expect(temperatureOf([base({ createdAt: new Date(Date.now() - 8 * 86400_000).toISOString() })], "b")).toBe(37);
  });
});

describe("신고 처리", () => {
  it("미마감 질문을 숨기면 질문자에게 환불된다", () => {
    let s = demo();
    const r1 = ledger.report(s, "u-expert", { targetType: "post", targetId: "p-3", reason: "광고·홍보", detail: "" });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    s = r1.state;
    const before = s.users.find((u) => u.id === "u-patient")!.wallet.cash;
    const r2 = ledger.resolveReport(s, s.reports[0].id, "hide");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.posts.find((p) => p.id === "p-3")).toMatchObject({ hidden: true, status: "refunded" });
    expect(r2.state.users.find((u) => u.id === "u-patient")!.wallet.cash).toBe(before + 10);
  });
});
