// 토큰 원장(ledger). 모든 토큰 이동은 이 파일의 순수 함수로만 일어납니다.
// (state, 입력) → 새 state 형태라서, 실서비스에서는 같은 로직을 서버 API의 DB 트랜잭션 안으로 옮기면 됩니다.

import {
  ADOPT_DEADLINE_DAYS,
  BALANCE_REFUND_FEE_RATE,
  LOUNGE_CHANNELS,
  DIRECT_ANSWER_HOURS,
  DIRECT_COST_MULTIPLIER,
  MAX_QUESTION_COST,
  MIN_PURCHASE_TOKENS,
  MEMBERSHIP_PLANS,
  MIN_WITHDRAW_TOKENS,
  NO_ANSWER_NUDGE_HOURS,
  TIERS,
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
import type { Block, Board, ChatMessage, Post, Rating, RatingScore, Report, ReportTarget, Transaction, User, VerificationStatus, Wallet } from "./types";

export interface State {
  users: User[];
  posts: Post[];
  transactions: Transaction[];
  ratings: Rating[];
  chats: ChatMessage[];
  reports: Report[];
  blocks: Block[];
  currentUserId: string | null;
}

export type Outcome = { ok: true; state: State; id?: string } | { ok: false; error: string };

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const fail = (error: string): Outcome => ({ ok: false, error });
const uid = (p: string) => `${p}-${crypto.randomUUID()}`;
const iso = (t: number) => new Date(t).toISOString();

// ───────────────────────── 조회 헬퍼 ─────────────────────────

/** 서류 심사를 통과한 치료사만 등급을 가집니다 */
export function userTier(user: User) {
  if (!user.therapist?.licenseVerified) return undefined;
  return tierFor(user.therapist);
}

export function balanceOf(user: User) {
  return user.wallet.cash + user.wallet.bonus + user.wallet.earned;
}

/** 환자 개인정보(휴대폰·주민등록번호)가 들어 있으면 해당 문자열 반환 */
export function findPersonalInfo(text: string) {
  const patterns = [/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/, /\d{6}[-\s]?[1-4]\d{6}/];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return undefined;
}

const PII_ERROR = "휴대폰 번호·주민등록번호 같은 개인정보는 올릴 수 없어요. 해당 부분을 지우고 다시 시도해 주세요.";

function isSuspended(user: User, now = Date.now()) {
  return !!user.suspendedUntil && new Date(user.suspendedUntil).getTime() > now;
}

const SUSPENDED_ERROR = "신고 처리로 이용이 일시 정지된 계정입니다.";

export function maskAccount(account: string) {
  return account.replace(/\d(?=(?:\D*\d){4})/g, "*");
}

export const tierName = (id: TierId) => getTier(id).name;

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

export function purchase(s: State, userId: string, packageId: string, method: PaymentMethodId, orderId?: string): Outcome {
  const pkg = TOKEN_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return fail("상품을 찾을 수 없습니다.");
  if (pkg.tokens < MIN_PURCHASE_TOKENS) return fail(`최소 ${MIN_PURCHASE_TOKENS}토큰부터 충전할 수 있습니다.`);
  s = updateUser(s, userId, (u) => ({ ...u, wallet: addWallet(u.wallet, { cash: pkg.tokens, bonus: pkg.bonus }) }));
  s = addTx(s, {
    userId,
    type: "purchase",
    tokens: pkg.tokens,
    bonusTokens: pkg.bonus,
    krw: pkg.price,
    method,
    orderId,
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

export function subscribe(s: State, userId: string, planId: MembershipPlanId, method: PaymentMethodId, orderId?: string): Outcome {
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
    orderId,
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
    status: "requested",
    memo: `환전 신청 → ${maskAccount(bankAccount)} (원천징수 ${(WITHHOLDING_TAX_RATE * 100).toFixed(1)}% 차감)`,
  });
  return { ok: true, state: s, id: s.transactions[0].id };
}

/** 관리자: 계좌 이체를 마친 환전 신청을 지급 완료로 표시 */
export function markWithdrawalPaid(s: State, txId: string): Outcome {
  const tx = s.transactions.find((t) => t.id === txId);
  if (!tx || (tx.type !== "withdraw" && tx.type !== "balance_refund") || tx.status !== "requested") return fail("처리할 수 없는 신청입니다.");
  return { ok: true, state: { ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, status: "paid" } : t)) } };
}

/** 관리자: 환전 신청 반려 — 토큰을 수익 지갑으로 돌려줍니다 */
export function rejectWithdrawal(s: State, txId: string, reason: string): Outcome {
  const tx = s.transactions.find((t) => t.id === txId);
  if (!tx || (tx.type !== "withdraw" && tx.type !== "balance_refund") || tx.status !== "requested") return fail("처리할 수 없는 신청입니다.");
  const refundOfBalance = tx.type === "balance_refund";
  s = { ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, status: "rejected" } : t)) };
  s = updateUser(s, tx.userId, (u) => ({ ...u, wallet: addWallet(u.wallet, refundOfBalance ? { cash: -tx.tokens } : { earned: -tx.tokens }) }));
  return {
    ok: true,
    state: addTx(s, {
      userId: tx.userId,
      type: refundOfBalance ? "balance_refund_cancel" : "withdraw_cancel",
      tokens: -tx.tokens,
      memo: `${refundOfBalance ? "잔액 환불" : "환전"} 반려: ${reason}`,
    }),
  };
}

/**
 * 충전 잔액 환불 신청: 청약철회 기간이 지난 미사용 충전 토큰을 수수료를 빼고 돌려받습니다 (관리자 이체).
 * 1년 시뮬레이션에서 최소 충전 300토큰 때문에 환자 1인당 약 290토큰이 남는 것으로 나와 추가.
 */
export function requestBalanceRefund(s: State, userId: string, bankAccount: string): Outcome {
  const user = s.users.find((u) => u.id === userId);
  if (!user) return fail("로그인이 필요합니다.");
  const tokens = user.wallet.cash;
  if (tokens <= 0) return fail("환불할 충전 토큰이 없습니다. (보너스·수익 토큰은 환불 대상이 아니에요)");
  if (!bankAccount.trim()) return fail("입금 받을 계좌를 입력해 주세요.");
  const krw = Math.floor(tokens * TOKEN_KRW * (1 - BALANCE_REFUND_FEE_RATE));
  s = updateUser(s, userId, (u) => ({ ...u, wallet: addWallet(u.wallet, { cash: -tokens }) }));
  s = addTx(s, {
    userId,
    type: "balance_refund",
    tokens: -tokens,
    krw,
    status: "requested",
    memo: `충전 잔액 환불 신청 → ${maskAccount(bankAccount)} (수수료 ${Math.round(BALANCE_REFUND_FEE_RATE * 100)}%)`,
  });
  return { ok: true, state: s, id: s.transactions[0].id };
}

// ───────────────────────── 질문·답변 ─────────────────────────

export function createPost(
  s: State,
  userId: string,
  input: { board: Board; title: string; body: string; category: Category; targetTier: TierId; directTherapistId?: string; autoLower?: boolean },
): Outcome {
  const user = s.users.find((u) => u.id === userId);
  if (!user) return fail("로그인이 필요합니다.");
  if (input.board === "clinical" && user.role !== "therapist") return fail("임상 토론방은 치료사 회원만 이용할 수 있습니다.");
  if (input.directTherapistId === userId) return fail("본인에게는 질문할 수 없습니다.");
  if (isSuspended(user)) return fail(SUSPENDED_ERROR);
  if (input.board === "clinical" && !userTier(user)) return fail("서류 심사가 끝난 치료사만 임상 토론에 글을 쓸 수 있습니다.");
  if (input.title.trim().length < 5) return fail("제목을 5자 이상 입력해 주세요.");
  if (input.body.trim().length < 20) return fail("내용을 20자 이상 입력해 주세요.");
  if (input.title.length > 100 || input.body.length > 5000) return fail("제목은 100자, 내용은 5000자까지 쓸 수 있습니다.");
  if (findPersonalInfo(`${input.title} ${input.body}`)) return fail(PII_ERROR);
  const directUser = input.directTherapistId ? s.users.find((u) => u.id === input.directTherapistId) : undefined;
  if (input.directTherapistId && (!directUser || !userTier(directUser))) return fail("지정할 수 없는 치료사입니다.");
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
        autoLower: !input.directTherapistId && input.autoLower !== false,
        tierChangedAt: iso(now),
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
  if (user.role !== "therapist" || !userTier(user)) return fail("답변은 서류 심사를 마친 치료사만 작성할 수 있습니다.");
  if (isSuspended(user)) return fail(SUSPENDED_ERROR);
  if (post.authorId === userId) return fail("본인 질문에는 답변할 수 없습니다.");
  if (post.status !== "open") return fail("이미 마감된 질문입니다.");
  if (post.directTherapistId && post.directTherapistId !== userId) return fail("지정된 치료사만 답변할 수 있는 1:1 질문입니다.");
  if (tierRank(userTier(user)!.id) < tierRank(post.targetTier))
    return fail(`${getTier(post.targetTier).name} 등급 이상만 답변할 수 있는 질문입니다.`);
  if (body.trim().length < 20) return fail("답변을 20자 이상 입력해 주세요.");
  if (body.length > 5000) return fail("답변은 5000자까지 쓸 수 있습니다.");
  if (findPersonalInfo(body)) return fail(PII_ERROR);
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

/** 답변이 없는 질문의 답변 등급을 낮추고 차액을 돌려받습니다 (더 많은 치료사가 볼 수 있게) */
export function lowerTargetTier(s: State, userId: string, postId: string, newTier: TierId, extendDeadline = true): Outcome {
  const post = s.posts.find((p) => p.id === postId);
  if (!post || post.authorId !== userId) return fail("질문자만 바꿀 수 있습니다.");
  if (post.status !== "open" || post.directTherapistId) return fail("등급을 바꿀 수 없는 질문입니다.");
  if (post.answers.some((a) => !a.hidden)) return fail("이미 답변이 달린 질문입니다.");
  if (tierRank(newTier) >= tierRank(post.targetTier)) return fail("지금보다 낮은 등급만 고를 수 있어요.");
  const newBounty = Math.max(1, Math.round((post.bounty * getTier(newTier).questionCost) / getTier(post.targetTier).questionCost));
  const refund = post.bounty - newBounty;
  // 낸 지갑으로 되돌리되, 수익 → 충전 → 보너스 순서 (쓸 때와 반대)
  const back = { earned: Math.min(refund, post.paidFrom.earned), cash: 0, bonus: 0 };
  back.cash = Math.min(refund - back.earned, post.paidFrom.cash);
  back.bonus = refund - back.earned - back.cash;
  s = updatePost(s, postId, (p) => ({
    ...p,
    targetTier: newTier,
    tierChangedAt: iso(Date.now()),
    bounty: newBounty,
    paidFrom: addWallet(p.paidFrom, { cash: -back.cash, bonus: -back.bonus, earned: -back.earned }),
    // 직접 낮추면 기한을 새로 주고, 자동으로 낮출 때는 원래 기한을 유지
    expiresAt: extendDeadline ? iso(Date.now() + ADOPT_DEADLINE_DAYS * DAY) : p.expiresAt,
  }));
  s = updateUser(s, userId, (u) => ({ ...u, wallet: addWallet(u.wallet, back) }));
  return {
    ok: true,
    state: addTx(s, { userId, type: "lower_tier", tokens: refund, postId, memo: `답변 등급을 ${getTier(newTier).name}(으)로 낮춰 차액 환불` }),
  };
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

// ───────────────────────── 만족도 평가 (매너온도) ─────────────────────────

/** 질문자가 이 답변을 평가할 수 있는지 */
export function canRateAnswer(s: State, userId: string, post: Post, answerId: string) {
  const answer = post.answers.find((a) => a.id === answerId);
  return (
    !!answer &&
    post.authorId === userId &&
    answer.authorId !== userId &&
    !s.ratings.some((r) => r.fromId === userId && r.answerId === answerId)
  );
}

/** 답변자가 질문자를 평가할 수 있는지 (질문이 마감된 뒤, 질문당 1회) */
export function canRateAsker(s: State, userId: string, post: Post) {
  return (
    post.status === "adopted" &&
    post.authorId !== userId &&
    post.answers.some((a) => a.authorId === userId) &&
    !s.ratings.some((r) => r.fromId === userId && r.postId === post.id && !r.answerId)
  );
}

export function rate(
  s: State,
  userId: string,
  input: { postId: string; answerId?: string; score: RatingScore; tags: string[] },
): Outcome {
  const post = s.posts.find((p) => p.id === input.postId);
  if (!post) return fail("잘못된 요청입니다.");
  if (input.tags.length > 5 || input.tags.some((t) => t.length > 30)) return fail("잘못된 평가 항목입니다.");
  let toId: string;
  if (input.answerId) {
    if (!canRateAnswer(s, userId, post, input.answerId)) return fail("이미 평가했거나 평가할 수 없는 답변입니다.");
    toId = post.answers.find((a) => a.id === input.answerId)!.authorId;
  } else {
    if (!canRateAsker(s, userId, post)) return fail("이미 평가했거나 평가할 수 없는 질문입니다.");
    toId = post.authorId;
  }
  return {
    ok: true,
    state: {
      ...s,
      ratings: [
        { id: uid("r"), fromId: userId, toId, postId: post.id, answerId: input.answerId, score: input.score, tags: input.tags, createdAt: iso(Date.now()) },
        ...s.ratings,
      ],
    },
  };
}

// ───────────────────────── 등급 라운지 채팅 ─────────────────────────

export function sendChat(s: State, userId: string, body: string, kind: ChatMessage["kind"], channel: string = LOUNGE_CHANNELS[0]): Outcome {
  const user = s.users.find((u) => u.id === userId);
  const tier = user && userTier(user);
  if (!tier) return fail("등급 라운지는 면허 인증된 치료사만 이용할 수 있습니다.");
  const text = body.trim();
  if (!text) return fail("메시지를 입력해 주세요.");
  if (text.length > 1000) return fail("메시지는 1000자까지 보낼 수 있습니다.");
  if (isSuspended(user!)) return fail(SUSPENDED_ERROR);
  if (findPersonalInfo(text)) return fail(PII_ERROR);
  if (!(LOUNGE_CHANNELS as readonly string[]).includes(channel)) return fail("없는 채널입니다.");
  return {
    ok: true,
    state: {
      ...s,
      chats: [...s.chats, { id: uid("c"), room: tier.id, channel, authorId: userId, body: text, kind, createdAt: iso(Date.now()) }],
    },
  };
}

// ───────────────────────── 신고·차단 ─────────────────────────

export function report(
  s: State,
  userId: string,
  input: { targetType: ReportTarget; targetId: string; reason: string; detail: string },
): Outcome {
  let targetUserId: string | undefined;
  if (input.targetType === "post") targetUserId = s.posts.find((p) => p.id === input.targetId)?.authorId;
  if (input.targetType === "answer")
    targetUserId = s.posts.flatMap((p) => p.answers).find((a) => a.id === input.targetId)?.authorId;
  if (input.targetType === "chat") targetUserId = s.chats.find((c) => c.id === input.targetId)?.authorId;
  if (input.targetType === "user") targetUserId = s.users.find((u) => u.id === input.targetId)?.id;
  if (!targetUserId) return fail("신고 대상을 찾을 수 없습니다.");
  if (targetUserId === userId) return fail("본인은 신고할 수 없습니다.");
  if (s.reports.some((r) => r.reporterId === userId && r.targetId === input.targetId && r.status === "open"))
    return fail("이미 신고한 내용이에요. 운영팀이 확인 중입니다.");
  const report: Report = {
    id: uid("rp"),
    reporterId: userId,
    targetType: input.targetType,
    targetId: input.targetId,
    targetUserId,
    reason: input.reason,
    detail: input.detail.slice(0, 1000),
    status: "open",
    createdAt: iso(Date.now()),
  };
  return { ok: true, state: { ...s, reports: [report, ...s.reports] } };
}

export function block(s: State, userId: string, blockedId: string): Outcome {
  if (userId === blockedId) return fail("본인은 차단할 수 없습니다.");
  if (s.blocks.some((b) => b.userId === userId && b.blockedId === blockedId)) return { ok: true, state: s };
  return { ok: true, state: { ...s, blocks: [...s.blocks, { userId, blockedId, createdAt: iso(Date.now()) }] } };
}

export function unblock(s: State, userId: string, blockedId: string): Outcome {
  return { ok: true, state: { ...s, blocks: s.blocks.filter((b) => !(b.userId === userId && b.blockedId === blockedId)) } };
}

/** 관리자: 신고 처리. hide = 해당 콘텐츠 숨김(미마감 질문은 환불), suspend = 작성자 7일 정지 */
export function resolveReport(s: State, reportId: string, action: "hide" | "suspend" | "dismiss", note = ""): Outcome {
  const rp = s.reports.find((r) => r.id === reportId);
  if (!rp || rp.status !== "open") return fail("처리할 수 없는 신고입니다.");
  if (action === "hide" || action === "suspend") {
    if (rp.targetType === "post") {
      const post = s.posts.find((p) => p.id === rp.targetId);
      if (post?.status === "open") s = refundPost(s, post, "cancelled");
      s = updatePost(s, rp.targetId, (p) => ({ ...p, hidden: true }));
    }
    if (rp.targetType === "answer")
      s = { ...s, posts: s.posts.map((p) => ({ ...p, answers: p.answers.map((a) => (a.id === rp.targetId ? { ...a, hidden: true } : a)) })) };
    if (rp.targetType === "chat") s = { ...s, chats: s.chats.map((c) => (c.id === rp.targetId ? { ...c, hidden: true } : c)) };
  }
  if (action === "suspend") s = updateUser(s, rp.targetUserId, (u) => ({ ...u, suspendedUntil: iso(Date.now() + 7 * DAY) }));
  const resolution = { hide: "콘텐츠 숨김", suspend: "콘텐츠 숨김 + 작성자 7일 이용 정지", dismiss: "문제 없음" }[action] + (note ? ` (${note})` : "");
  // 같은 대상에 대한 열린 신고를 함께 처리
  s = {
    ...s,
    reports: s.reports.map((r) =>
      r.targetId === rp.targetId && r.status === "open" ? { ...r, status: action === "dismiss" ? "dismissed" : "resolved", resolution } : r,
    ),
  };
  return { ok: true, state: s };
}

/** 관리자: 치료사 서류 심사 결과 반영 */
export function setVerification(s: State, userId: string, status: VerificationStatus, reason = ""): Outcome {
  const user = s.users.find((u) => u.id === userId);
  if (!user?.therapist) return fail("치료사 회원이 아닙니다.");
  return {
    ok: true,
    state: updateUser(s, userId, (u) => ({
      ...u,
      therapist: { ...u.therapist!, verification: status, licenseVerified: status === "approved", rejectReason: status === "rejected" ? reason : undefined },
    })),
  };
}

// ───────────────────────── 자동 정산 (서버에서는 크론 작업) ─────────────────────────

/** 기한이 지난 질문을 자동 채택(답변 있음)하거나 환불(답변 없음)합니다. */
export function sweepPosts(s: State, now = Date.now()): State {
  let next = s;
  for (const post of s.posts) {
    if (post.status !== "open" || new Date(post.expiresAt).getTime() > now) continue;
    const visible = post.answers.filter((a) => !a.hidden);
    if (visible.length === 0) {
      next = refundPost(next, post, "no_answer");
    } else {
      const best = [...visible].sort((a, b) => b.likes.length - a.likes.length || a.createdAt.localeCompare(b.createdAt))[0];
      next = settleAdopt(next, post, best.id, "auto_adopt");
    }
  }
  return next;
}

/**
 * 자동 등급 낮추기: 답변 없이 하루가 지난 질문을 한 단계 낮추고 차액을 돌려줍니다.
 * 1년 시뮬레이션에서 치료사의 56%가 원석인데 질문은 중·상위 등급에 몰려, 수동 제안만으로는 무답변 환불이 29%로 남았음.
 */
export function autoLowerDue(s: State, now = Date.now()): { state: State; lowered: Post[] } {
  let next = s;
  const lowered: Post[] = [];
  for (const p of s.posts) {
    if (p.status !== "open" || !p.autoLower || p.directTherapistId || p.targetTier === "rough") continue;
    if (p.answers.some((a) => !a.hidden)) continue;
    if (now - new Date(p.tierChangedAt ?? p.createdAt).getTime() < NO_ANSWER_NUDGE_HOURS * HOUR) continue;
    const r = lowerTargetTier(next, p.authorId, p.id, TIERS[tierRank(p.targetTier) - 1].id, false);
    if (r.ok) {
      next = r.state;
      lowered.push(next.posts.find((x) => x.id === p.id)!);
    }
  }
  return { state: next, lowered };
}

/** 갱신일이 지난 멤버십 회원 */
export function dueMemberships(s: State, now = Date.now()) {
  return s.users.filter((u) => u.membership && new Date(u.membership.renewsAt).getTime() <= now);
}

/** 정기결제 성공 후 호출: 다음 달 토큰 지급 */
export function renewMembership(s: State, userId: string, orderId?: string): State {
  const user = s.users.find((u) => u.id === userId);
  const m = user?.membership;
  if (!m) return s;
  const plan = MEMBERSHIP_PLANS.find((p) => p.id === m.plan)!;
  s = updateUser(s, userId, (u) => ({
    ...u,
    membership: { ...m, renewsAt: iso(new Date(m.renewsAt).getTime() + 30 * DAY) },
    wallet: addWallet(u.wallet, { cash: plan.monthlyTokens, bonus: plan.monthlyBonus }),
  }));
  return addTx(s, {
    userId,
    type: "membership",
    tokens: plan.monthlyTokens,
    bonusTokens: plan.monthlyBonus,
    krw: plan.price,
    orderId,
    memo: `${plan.name} 멤버십 정기결제 갱신`,
  });
}

/** 자동 갱신 해지 또는 정기결제 실패 시 멤버십 종료 */
export function endMembership(s: State, userId: string): State {
  return updateUser(s, userId, (u) => ({ ...u, membership: undefined }));
}

/** 데모 모드 전용: 자동 등급 낮추기 + 질문 정산 + (결제 없이) 멤버십 갱신·종료 */
export function sweep(s: State, now = Date.now()): State {
  let next = sweepPosts(autoLowerDue(s, now).state, now);
  for (const u of dueMemberships(next, now)) next = u.membership!.autoRenew ? renewMembership(next, u.id) : endMembership(next, u.id);
  return next;
}
