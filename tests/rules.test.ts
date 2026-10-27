import { describe, expect, it, vi } from "vitest";
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

describe("1년 시뮬레이션 후 추가한 규칙", () => {
  const ask = (s: ledger.State, autoLower = true) =>
    ledger.createPost(s, "u-patient", {
      board: "patient",
      title: "무릎 통증 질문입니다",
      body: "계단을 내려갈 때 무릎 앞쪽이 아파요. 어떤 운동이 좋을까요?",
      category: "근골격계",
      targetTier: "diamond",
      autoLower,
    });

  it("답변 없이 하루가 지나면 한 단계 낮추고 차액을 돌려준다 (기한은 그대로)", () => {
    const r = ask(demo());
    if (!r.ok) throw new Error(r.error);
    const before = r.state.users.find((u) => u.id === "u-patient")!.wallet;
    const post = r.state.posts.find((p) => p.id === r.id)!;
    const later = new Date(post.createdAt).getTime() + 25 * 3600_000;
    vi.useFakeTimers();
    vi.setSystemTime(later);
    const { state, lowered } = ledger.autoLowerDue(r.state, later);
    expect(lowered).toHaveLength(1);
    const p2 = state.posts.find((p) => p.id === r.id)!;
    expect(p2.targetTier).toBe("ruby");
    expect(p2.bounty).toBe(42);
    expect(p2.expiresAt).toBe(post.expiresAt);
    expect(ledger.balanceOf(state.users.find((u) => u.id === "u-patient")!)).toBe(ledger.balanceOf({ wallet: before } as never) + 8);
    // 같은 날 다시 돌려도 더 낮추지 않음
    expect(ledger.autoLowerDue(state, later).lowered).toHaveLength(0);
    vi.useRealTimers();
  });

  it("자동 낮추기를 끄거나 답변이 있으면 낮추지 않는다", () => {
    const r = ask(demo(), false);
    if (!r.ok) throw new Error(r.error);
    expect(ledger.autoLowerDue(r.state, Date.now() + 3 * 86400_000).lowered).toHaveLength(0);
  });

  it("충전 잔액 환불은 충전 토큰만, 수수료 10%를 빼고 신청된다", () => {
    const s = demo();
    const r = ledger.requestBalanceRefund(s, "u-patient", "국민 123456789012");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = r.state.users.find((x) => x.id === "u-patient")!;
    expect(u.wallet.cash).toBe(0);
    expect(u.wallet.bonus).toBe(s.users.find((x) => x.id === "u-patient")!.wallet.bonus);
    expect(r.state.transactions[0]).toMatchObject({ type: "balance_refund", status: "requested", krw: Math.floor(420 * 100 * 0.9) });
    const back = ledger.rejectWithdrawal(r.state, r.id!, "계좌 확인 불가");
    expect(back.ok && back.state.users.find((x) => x.id === "u-patient")!.wallet.cash).toBe(420);
  });

  it("'내가 답변할 수 있는 질문'은 답변 없는 질문을 등급보다 먼저 보여준다", async () => {
    const { localFeed } = await import("@/lib/local-queries");
    let s = { ...demo(), currentUserId: "u-legend" };
    const ids = localFeed(s, { board: "patient", forMe: true }).ids;
    const posts = ids.map((id) => s.posts.find((p) => p.id === id)!);
    const counts = posts.filter((p) => !p.directTherapistId).map((p) => p.answers.length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(posts.every((p) => p.answers.length < 3)).toBe(true);
    s = { ...s, currentUserId: "u-rookie" };
    expect(localFeed(s, { board: "patient", forMe: true }).ids.every((id) => ["rough"].includes(s.posts.find((p) => p.id === id)!.targetTier))).toBe(true);
  });
});
