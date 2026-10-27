// 토큰 원장(ledger). 모든 토큰 이동은 이 파일의 순수 함수로만 일어납니다.
// (state, 입력) → 새 state 형태라서, 실서비스에서는 같은 로직을 서버 API의 DB 트랜잭션 안으로 옮기면 됩니다.

import {
  ADOPT_DEADLINE_DAYS,
  DIRECT_ANSWER_HOURS,
  DIRECT_COST_MULTIPLIER,
  MAX_QUESTION_COST,
  MEMBERSHIP_PLANS,
  MIN_WITHDRAW_TOKENS,
  REVOKE_DAYS,
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_HOLD_DAYS,
  TOKEN_KRW,
  TOKEN_PACKAGES,
  WITHHOLDING_TAX_RATE,
  type Category,
  type MembershipPlanId,
  type PaymentMethodId,
  type TierId,
} from "./config";
import { getTier, tierFor, tierRank } from "./tier";
import type { Board, Post, Transaction, User, Wallet } from "./types";

export interface State {
  users: User[];
  posts: Post[];
  transactions: Transaction[];
  currentUserId: string | null;
}

export type Outcome = { ok: true; state: State; id?: string } | { ok: false; error: string };

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const fail = (error: string): Outcome => ({ ok: false, error });
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const iso = (t: number) => new Date(t).toISOString();

// ───────────────────────── 조회 헬퍼 ─────────────────────────

export function userTier(user: User) {
  if (!user.therapist) return undefined;
  return tierFor(user.therapist);
}

export function balanceOf(user: User) {
  return user.wallet.cash + user.wallet.bonus + user.wallet.earned;
}

export function rewardAfterFee(tokens: number) {
  return Math.floor(tokens * (1 - SETTLEMENT_FEE_RATE));
}

export function membershipPlan(user: User | null | undefined) {
  if (!user?.membership) return undefined;
  return MEMBERSHIP_PLANS.find((p) => p.id === user.membership!.plan);
}

/** 정산 대기 중인 획득 토큰 (최근 N일 내 채택 보상·팁) */
export function pendingEarned(state: State, userId: string, now = Date.now()) {
  const user = state.users.find((u) => u.id === userId);
  if (!user) return 0;
  const pending = state.transactions
    .filter(
      (t) =>
        t.userId === userId &&
        (t.type === "reward" || t.type === "tip_received") &&
        now - new Date(t.createdAt).getTime() < SETTLEMENT_HOLD_DAYS * DAY,
    )
    .reduce((sum, t) => sum + t.tokens, 0);
  return Math.min(pending, user.wallet.earned);
}

export function withdrawable(state: State, userId: string, now = Date.now()) {
  const user = state.users.find((u) => u.id === userId);
  return user ? user.wallet.earned - pendingEarned(state, userId, now) : 0;
}

/** 질문 비용 계산: 등급 기본 비용 → (1:1 지정 시) 할증, 최대 MAX_QUESTION_COST → 멤버십 할인 */
export function quoteQuestion(
  state: State,
  asker: User | null,
  opts: { targetTier: TierId; directTherapistId?: string },
) {
  const direct = opts.directTherapistId ? state.users.find((u) => u.id === opts.directTherapistId) : undefined;
  const tier = direct ? userTier(direct)! : getTier(opts.targetTier);
  const base = tier.questionCost;
  const plan = membershipPlan(asker);
  const skipSurcharge = plan && "noDirectSurcharge" in plan && plan.noDirectSurcharge;
  const surcharge = direct && !skipSurcharge ? Math.min(Math.ceil(base * DIRECT_COST_MULTIPLIER), MAX_QUESTION_COST) - base : 0;
  const discount = plan ? Math.floor((base + surcharge) * plan.discountRate) : 0;
  return { tier, base, surcharge, discount, total: base + surcharge - discount, plan };
}

export function canRevoke(state: State, tx: Transaction, now = Date.now()) {
  if (tx.type !== "purchase" || tx.revoked) return false;
  if (now - new Date(tx.createdAt).getTime() > REVOKE_DAYS * DAY) return false;
  const user = state.users.find((u) => u.id === tx.userId);
  return !!user && user.wallet.cash >= tx.tokens;
}

// ───────────────────────── 내부 유틸 ─────────────────────────

/** bonus → cash → earned 순서로 차감 */
function spend(w: Wallet, amount: number): { wallet: Wallet; from: Wallet } {
  const bonus = Math.min(w.bonus, amount);
  const cash = Math.min(w.cash, amount - bonus);
  const earned = amount - bonus - cash;
  return {
    wallet: { cash: w.cash - cash, bonus: w.bonus - bonus, earned: w.earned - earned },
    from: { cash, bonus, earned },
  };
}

const addWallet = (a: Wallet, b: Partial<Wallet>): Wallet => ({
  cash: a.cash + (b.cash ?? 0),
  bonus: a.bonus + (b.bonus ?? 0),
  earned: a.earned + (b.earned ?? 0),
});

const updateUser = (s: State, id: string, fn: (u: User) => User): State => ({
  ...s,
  users: s.users.map((u) => (u.id === id ? fn(u) : u)),
});

const updatePost = (s: State, id: string, fn: (p: Post) => Post): State => ({
  ...s,
  posts: s.posts.map((p) => (p.id === id ? fn(p) : p)),
});

const addTx = (s: State, tx: Omit<Transaction, "id" | "createdAt"> & { createdAt?: string }): State => ({
  ...s,
  transactions: [{ id: uid("t"), createdAt: iso(Date.now()), ...tx }, ...s.transactions],
});

function settleAdopt(s: State, post: Post, answerId: string, reason?: "auto_adopt"): State {
  const answer = post.answers.find((a) => a.id === answerId)!;
  const reward = rewardAfterFee(post.bounty);
  s = updatePost(s, post.id, (p) => ({ ...p, status: "adopted", adoptedAnswerId: answerId, closedReason: reason }));
  s = updateUser(s, answer.authorId, (u) => ({ ...u, wallet: addWallet(u.wallet, { earned: reward }) }));
  return addTx(s, {
    userId: answer.authorId,
    type: "reward",
    tokens: reward,
    postId: post.id,
    memo: `${reason ? "자동 채택" : "답변 채택"} 보상 ${post.bounty}토큰 (수수료 ${Math.round(SETTLEMENT_FEE_RATE * 100)}% 차감)`,
  });
}

function refundPost(s: State, post: Post, reason: "no_answer" | "cancelled"): State {
  s = updatePost(s, post.id, (p) => ({ ...p, status: "refunded", closedReason: reason }));
  s = updateUser(s, post.authorId, (u) => ({ ...u, wallet: addWallet(u.wallet, post.paidFrom) }));
  return addTx(s, {
    userId: post.authorId,
    type: "refund",
    tokens: post.bounty,
    postId: post.id,
    memo: reason === "cancelled" ? "질문 취소 환불" : "기한 내 답변이 없어 자동 환불",
  });
}

// ───────────────────────── 결제 ─────────────────────────

export function purchase(s: State, userId: string, packageId: string, method: PaymentMethodId): Outcome {
  const pkg = TOKEN_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return fail("상품을 찾을 수 없습니다.");
  s = updateUser(s, userId, (u) => ({ ...u, wallet: addWallet(u.wallet, { cash: pkg.tokens, bonus: pkg.bonus }) }));
  s = addTx(s, {
    userId,
    type: "purchase",
    tokens: pkg.tokens,
    bonusTokens: pkg.bonus,
    krw: pkg.price,
    method,
    memo: `토큰 ${pkg.tokens}개${pkg.bonus ? ` + 보너스 ${pkg.bonus}개` : ""} 충전`,
  });
  return { ok: true, state: s };
}

/** 청약철회: 기한 내, 해당 충전분을 쓰지 않았을 때만 결제 취소 */
export function revokePurchase(s: State, userId: string, txId: string): Outcome {
  const tx = s.transactions.find((t) => t.id === txId && t.userId === userId);
  if (!tx || !canRevoke(s, tx)) return fail(`충전 후 ${REVOKE_DAYS}일 이내, 사용하지 않은 충전분만 결제 취소할 수 있습니다.`);
  const user = s.users.find((u) => u.id === userId)!;
  const bonusBack = Math.min(user.wallet.bonus, tx.bonusTokens ?? 0);
  s = updateUser(s, userId, (u) => ({ ...u, wallet: addWallet(u.wallet, { cash: -tx.tokens, bonus: -bonusBack }) }));
  s = { ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, revoked: true } : t)) };
  s = addTx(s, {
    userId,
    type: "revoke",
    tokens: -tx.tokens,
    bonusTokens: -bonusBack,
    krw: tx.krw,
    method: tx.method,
    memo: "충전 결제 취소 (청약철회)",
  });
  return { ok: true, state: s };
}

export function subscribe(s: State, userId: string, planId: MembershipPlanId, method: PaymentMethodId): Outcome {
  const plan = MEMBERSHIP_PLANS.find((p) => p.id === planId);
  const user = s.users.find((u) => u.id === userId);
  if (!plan || !user) return fail("잘못된 요청입니다.");
  if (user.membership?.plan === planId && user.membership.autoRenew) return fail("이미 이용 중인 멤버십입니다.");
  const now = Date.now();
  s = updateUser(s, userId, (u) => ({
    ...u,
    membership: { plan: planId, startedAt: iso(now), renewsAt: iso(now + 30 * DAY), autoRenew: true },
    wallet: addWallet(u.wallet, { cash: plan.monthlyTokens, bonus: plan.monthlyBonus }),
  }));
  s = addTx(s, {
    userId,
    type: "membership",
    tokens: plan.monthlyTokens,
    bonusTokens: plan.monthlyBonus,
    krw: plan.price,
    method,
    memo: `${plan.name} 멤버십 결제 (월 정기결제)`,
  });
  return { ok: true, state: s };
}

export function setAutoRenew(s: State, userId: string, autoRenew: boolean): Outcome {
  const user = s.users.find((u) => u.id === userId);
  if (!user?.membership) return fail("이용 중인 멤버십이 없습니다.");
  return { ok: true, state: updateUser(s, userId, (u) => ({ ...u, membership: { ...u.membership!, autoRenew } })) };
}

export function withdraw(s: State, userId: string, tokens: number, bankAccount: string): Outcome {
  const user = s.users.find((u) => u.id === userId);
  if (!user) return fail("로그인이 필요합니다.");
  if (user.role !== "therapist") return fail("환전은 치료사 회원만 가능합니다.");
  if (tokens < MIN_WITHDRAW_TOKENS) return fail(`최소 ${MIN_WITHDRAW_TOKENS}토큰부터 환전할 수 있습니다.`);
  if (tokens > withdrawable(s, userId)) return fail("환전 가능한 토큰이 부족합니다. (정산 대기 토큰 제외)");
  if (!bankAccount.trim()) return fail("입금 받을 계좌를 입력해 주세요.");
  const net = Math.floor(tokens * TOKEN_KRW * (1 - WITHHOLDING_TAX_RATE));
  s = updateUser(s, userId, (u) => ({ ...u, wallet: addWallet(u.wallet, { earned: -tokens }) }));
  s = addTx(s, {
    userId,
    type: "withdraw",
    tokens: -tokens,
    krw: net,
    memo: `환전 신청 → ${bankAccount} (원천징수 ${(WITHHOLDING_TAX_RATE * 100).toFixed(1)}% 차감)`,
  });
  return { ok: true, state: s };
}

// ───────────────────────── 질문·답변 ─────────────────────────

export function createPost(
  s: State,
  userId: string,
  input: { board: Board; title: string; body: string; category: Category; targetTier: TierId; directTherapistId?: string },
): Outcome {
  const user = s.users.find((u) => u.id === userId);
  if (!user) return fail("로그인이 필요합니다.");
  if (input.board === "clinical" && user.role !== "therapist") return fail("임상 토론방은 치료사 회원만 이용할 수 있습니다.");
  if (input.directTherapistId === userId) return fail("본인에게는 질문할 수 없습니다.");
  if (input.title.trim().length < 5) return fail("제목을 5자 이상 입력해 주세요.");
  if (input.body.trim().length < 20) return fail("내용을 20자 이상 입력해 주세요.");
  const quote = quoteQuestion(s, user, input);
  if (balanceOf(user) < quote.total) return fail("토큰이 부족합니다. 충전 후 다시 시도해 주세요.");

  const { wallet, from } = spend(user.wallet, quote.total);
  const now = Date.now();
  const id = uid("p");
  s = updateUser(s, userId, (u) => ({ ...u, wallet }));
  s = {
    ...s,
    posts: [
      {
        id,
        ...input,
        targetTier: quote.tier.id,
        authorId: userId,
        bounty: quote.total,
        paidFrom: from,
        status: "open",
        createdAt: iso(now),
        expiresAt: iso(now + (input.directTherapistId ? DIRECT_ANSWER_HOURS * HOUR : ADOPT_DEADLINE_DAYS * DAY)),
        views: 0,
        answers: [],
      },
      ...s.posts,
    ],
  };
  s = addTx(s, {
    userId,
    type: "ask",
    tokens: -quote.total,
    postId: id,
    memo: `${input.directTherapistId ? "1:1 지정 질문" : "질문"} 등록: ${input.title.slice(0, 18)}…`,
  });
  return { ok: true, state: s, id };
}

/** 답변이 더 필요할 때 질문자가 현상금을 추가 */
export function addBounty(s: State, userId: string, postId: string, amount: number): Outcome {
  const user = s.users.find((u) => u.id === userId);
  const post = s.posts.find((p) => p.id === postId);
  if (!user || !post || post.authorId !== userId) return fail("질문자만 현상금을 추가할 수 있습니다.");
  if (post.status !== "open") return fail("이미 마감된 질문입니다.");
  if (balanceOf(user) < amount) return fail("토큰이 부족합니다.");
  const { wallet, from } = spend(user.wallet, amount);
  s = updateUser(s, userId, (u) => ({ ...u, wallet }));
  s = updatePost(s, postId, (p) => ({
    ...p,
    bounty: p.bounty + amount,
    paidFrom: addWallet(p.paidFrom, from),
    // 현상금을 올리면 답변 기한도 연장
    expiresAt: iso(Math.max(new Date(p.expiresAt).getTime(), Date.now() + 3 * DAY)),
  }));
  return { ok: true, state: addTx(s, { userId, type: "bounty", tokens: -amount, postId, memo: `현상금 추가: ${post.title.slice(0, 18)}…` }) };
}

export function addAnswer(s: State, userId: string, postId: string, body: string): Outcome {
  const user = s.users.find((u) => u.id === userId);
  const post = s.posts.find((p) => p.id === postId);
  if (!user || !post) return fail("로그인이 필요합니다.");
  if (user.role !== "therapist") return fail("답변은 면허 인증된 치료사만 작성할 수 있습니다.");
  if (post.authorId === userId) return fail("본인 질문에는 답변할 수 없습니다.");
  if (post.status !== "open") return fail("이미 마감된 질문입니다.");
  if (post.directTherapistId && post.directTherapistId !== userId) return fail("지정된 치료사만 답변할 수 있는 1:1 질문입니다.");
  if (tierRank(userTier(user)!.id) < tierRank(post.targetTier))
    return fail(`${getTier(post.targetTier).name} 등급 이상만 답변할 수 있는 질문입니다.`);
  if (body.trim().length < 20) return fail("답변을 20자 이상 입력해 주세요.");
  return {
    ok: true,
    state: updatePost(s, postId, (p) => ({
      ...p,
      answers: [...p.answers, { id: uid("a"), authorId: userId, body, createdAt: iso(Date.now()), likes: [], tips: 0 }],
      // 1:1 질문은 답변이 달리면 채택 기한(7일)으로 전환
      expiresAt: p.directTherapistId && p.answers.length === 0 ? iso(Date.now() + ADOPT_DEADLINE_DAYS * DAY) : p.expiresAt,
    })),
  };
}

export function adopt(s: State, userId: string, postId: string, answerId: string): Outcome {
  const post = s.posts.find((p) => p.id === postId);
  if (!post || !post.answers.some((a) => a.id === answerId)) return fail("잘못된 요청입니다.");
  if (post.authorId !== userId) return fail("질문자만 채택할 수 있습니다.");
  if (post.status !== "open") return fail("이미 마감된 질문입니다.");
  return { ok: true, state: settleAdopt(s, post, answerId) };
}

export function cancelPost(s: State, userId: string, postId: string): Outcome {
  const post = s.posts.find((p) => p.id === postId);
  if (!post || post.authorId !== userId) return fail("잘못된 요청입니다.");
  if (post.answers.length > 0) return fail("답변이 달린 질문은 취소할 수 없습니다.");
  if (post.status !== "open") return fail("이미 마감된 질문입니다.");
  return { ok: true, state: refundPost(s, post, "cancelled") };
}

export function tip(s: State, userId: string, postId: string, answerId: string, amount: number): Outcome {
  const user = s.users.find((u) => u.id === userId);
  const answer = s.posts.find((p) => p.id === postId)?.answers.find((a) => a.id === answerId);
  if (!user || !answer) return fail("로그인이 필요합니다.");
  if (answer.authorId === userId) return fail("본인 답변에는 팁을 보낼 수 없습니다.");
  if (balanceOf(user) < amount) return fail("토큰이 부족합니다.");
  const received = rewardAfterFee(amount);
  s = updateUser(s, userId, (u) => ({ ...u, wallet: spend(u.wallet, amount).wallet }));
  s = updateUser(s, answer.authorId, (u) => ({ ...u, wallet: addWallet(u.wallet, { earned: received }) }));
  s = updatePost(s, postId, (p) => ({
    ...p,
    answers: p.answers.map((a) => (a.id === answerId ? { ...a, tips: a.tips + amount } : a)),
  }));
  s = addTx(s, { userId, type: "tip_sent", tokens: -amount, postId, memo: "감사 팁 보내기" });
  s = addTx(s, { userId: answer.authorId, type: "tip_received", tokens: received, postId, memo: `감사 팁 ${amount}토큰 받음 (수수료 차감)` });
  return { ok: true, state: s };
}

// ───────────────────────── 자동 정산 (서버에서는 크론 작업) ─────────────────────────

/** 기한이 지난 질문을 자동 채택·환불하고, 멤버십 갱신일이 지난 회원을 갱신·해지합니다. */
export function sweep(s: State, now = Date.now()): State {
  let next = s;
  for (const post of s.posts) {
    if (post.status !== "open" || new Date(post.expiresAt).getTime() > now) continue;
    if (post.answers.length === 0) {
      next = refundPost(next, post, "no_answer");
    } else {
      const best = [...post.answers].sort(
        (a, b) => b.likes.length - a.likes.length || a.createdAt.localeCompare(b.createdAt),
      )[0];
      next = settleAdopt(next, post, best.id, "auto_adopt");
    }
  }
  for (const user of s.users) {
    const m = user.membership;
    if (!m || new Date(m.renewsAt).getTime() > now) continue;
    if (!m.autoRenew) {
      next = updateUser(next, user.id, (u) => ({ ...u, membership: undefined }));
      continue;
    }
    const plan = MEMBERSHIP_PLANS.find((p) => p.id === m.plan)!;
    next = updateUser(next, user.id, (u) => ({
      ...u,
      membership: { ...m, renewsAt: iso(new Date(m.renewsAt).getTime() + 30 * DAY) },
      wallet: addWallet(u.wallet, { cash: plan.monthlyTokens, bonus: plan.monthlyBonus }),
    }));
    next = addTx(next, {
      userId: user.id,
      type: "membership",
      tokens: plan.monthlyTokens,
      bonusTokens: plan.monthlyBonus,
      krw: plan.price,
      memo: `${plan.name} 멤버십 정기결제 갱신`,
    });
  }
  return next;
}
