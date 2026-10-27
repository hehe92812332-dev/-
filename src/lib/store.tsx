"use client";

// 데모용 클라이언트 저장소 (localStorage).
// 실서비스에서는 이 파일의 액션들을 서버 API(DB + 결제대행사 연동)로 교체하면 됩니다.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  MIN_WITHDRAW_TOKENS,
  SETTLEMENT_FEE_RATE,
  TOKEN_KRW,
  TOKEN_PACKAGES,
  WITHHOLDING_TAX_RATE,
  type Category,
  type TierId,
} from "./config";
import { seedPosts, seedTransactions, seedUsers } from "./seed";
import { calcScore, getTier, tierForScore, tierRank } from "./tier";
import type { Board, Post, Transaction, User } from "./types";

const STORAGE_KEY = "pt-bridge:v1";

interface State {
  users: User[];
  posts: Post[];
  transactions: Transaction[];
  currentUserId: string | null;
}

type Result = { ok: true; id?: string } | { ok: false; error: string };

const initialState: State = {
  users: seedUsers,
  posts: seedPosts,
  transactions: seedTransactions,
  currentUserId: "u-patient",
};

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();

export function userTier(user: User) {
  if (!user.therapist) return undefined;
  return tierForScore(calcScore(user.therapist).total);
}

export function balanceOf(user: User) {
  return user.wallet.purchased + user.wallet.earned;
}

function useStoreValue() {
  const [state, setState] = useState<State>(initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setState(JSON.parse(saved));
    } catch {
      /* 저장소를 쓸 수 없으면 시드 데이터로 동작 */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* noop */
    }
  }, [state, ready]);

  const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? null;
  const getUser = useCallback((id: string) => state.users.find((u) => u.id === id), [state.users]);

  const switchUser = (id: string | null) => setState((s) => ({ ...s, currentUserId: id }));

  const resetDemo = () => setState(initialState);

  const signup = (user: Omit<User, "id" | "joinedAt" | "wallet">): Result => {
    const id = uid("u");
    setState((s) => ({
      ...s,
      users: [...s.users, { ...user, id, joinedAt: now(), wallet: { purchased: 0, earned: 0 } }],
      currentUserId: id,
    }));
    return { ok: true, id };
  };

  const buyTokens = (packageId: string): Result => {
    const pkg = TOKEN_PACKAGES.find((p) => p.id === packageId);
    if (!currentUser || !pkg) return { ok: false, error: "로그인이 필요합니다." };
    const total = pkg.tokens + pkg.bonus;
    setState((s) => ({
      ...s,
      users: s.users.map((u) =>
        u.id === currentUser.id ? { ...u, wallet: { ...u.wallet, purchased: u.wallet.purchased + total } } : u,
      ),
      transactions: [
        {
          id: uid("t"),
          userId: currentUser.id,
          type: "purchase",
          tokens: total,
          krw: pkg.price,
          memo: `토큰 ${pkg.tokens}개${pkg.bonus ? ` + 보너스 ${pkg.bonus}개` : ""} 구매`,
          createdAt: now(),
        },
        ...s.transactions,
      ],
    }));
    return { ok: true };
  };

  const withdraw = (tokens: number, bankAccount: string): Result => {
    if (!currentUser) return { ok: false, error: "로그인이 필요합니다." };
    if (currentUser.role !== "therapist") return { ok: false, error: "환전은 치료사 회원만 가능합니다." };
    if (tokens < MIN_WITHDRAW_TOKENS) return { ok: false, error: `최소 ${MIN_WITHDRAW_TOKENS}토큰부터 환전할 수 있습니다.` };
    if (tokens > currentUser.wallet.earned) return { ok: false, error: "환전 가능한 토큰이 부족합니다." };
    if (!bankAccount.trim()) return { ok: false, error: "입금 받을 계좌를 입력해 주세요." };
    const gross = tokens * TOKEN_KRW;
    const net = Math.floor(gross * (1 - WITHHOLDING_TAX_RATE));
    setState((s) => ({
      ...s,
      users: s.users.map((u) =>
        u.id === currentUser.id ? { ...u, wallet: { ...u.wallet, earned: u.wallet.earned - tokens } } : u,
      ),
      transactions: [
        {
          id: uid("t"),
          userId: currentUser.id,
          type: "withdraw",
          tokens: -tokens,
          krw: net,
          memo: `환전 신청 → ${bankAccount} (원천징수 3.3% 차감)`,
          createdAt: now(),
        },
        ...s.transactions,
      ],
    }));
    return { ok: true };
  };

  const createPost = (input: {
    board: Board;
    title: string;
    body: string;
    category: Category;
    targetTier: TierId;
  }): Result => {
    if (!currentUser) return { ok: false, error: "로그인이 필요합니다." };
    if (input.board === "clinical" && currentUser.role !== "therapist")
      return { ok: false, error: "임상 토론방은 치료사 회원만 이용할 수 있습니다." };
    if (input.title.trim().length < 5) return { ok: false, error: "제목을 5자 이상 입력해 주세요." };
    if (input.body.trim().length < 20) return { ok: false, error: "내용을 20자 이상 입력해 주세요." };
    const cost = getTier(input.targetTier).questionCost;
    if (balanceOf(currentUser) < cost) return { ok: false, error: "토큰이 부족합니다. 충전 후 다시 시도해 주세요." };

    // 구매 토큰을 먼저 사용하고, 부족하면 획득 토큰에서 차감
    const fromPurchased = Math.min(cost, currentUser.wallet.purchased);
    const fromEarned = cost - fromPurchased;
    const id = uid("p");
    setState((s) => ({
      ...s,
      users: s.users.map((u) =>
        u.id === currentUser.id
          ? { ...u, wallet: { purchased: u.wallet.purchased - fromPurchased, earned: u.wallet.earned - fromEarned } }
          : u,
      ),
      posts: [
        {
          id,
          ...input,
          authorId: currentUser.id,
          bounty: cost,
          status: "open",
          createdAt: now(),
          views: 0,
          answers: [],
        },
        ...s.posts,
      ],
      transactions: [
        { id: uid("t"), userId: currentUser.id, type: "ask", tokens: -cost, memo: `질문 등록: ${input.title.slice(0, 20)}…`, createdAt: now() },
        ...s.transactions,
      ],
    }));
    return { ok: true, id };
  };

  const addAnswer = (postId: string, body: string): Result => {
    const post = state.posts.find((p) => p.id === postId);
    if (!currentUser || !post) return { ok: false, error: "로그인이 필요합니다." };
    if (currentUser.role !== "therapist") return { ok: false, error: "답변은 면허 인증된 치료사만 작성할 수 있습니다." };
    if (post.authorId === currentUser.id) return { ok: false, error: "본인 질문에는 답변할 수 없습니다." };
    if (post.status !== "open") return { ok: false, error: "이미 마감된 질문입니다." };
    const tier = userTier(currentUser)!;
    if (tierRank(tier.id) < tierRank(post.targetTier))
      return { ok: false, error: `${getTier(post.targetTier).name} 등급 이상만 답변할 수 있는 질문입니다.` };
    if (body.trim().length < 20) return { ok: false, error: "답변을 20자 이상 입력해 주세요." };
    setState((s) => ({
      ...s,
      posts: s.posts.map((p) =>
        p.id === postId
          ? { ...p, answers: [...p.answers, { id: uid("a"), authorId: currentUser.id, body, createdAt: now(), likes: [] }] }
          : p,
      ),
    }));
    return { ok: true };
  };

  const adoptAnswer = (postId: string, answerId: string): Result => {
    const post = state.posts.find((p) => p.id === postId);
    const answer = post?.answers.find((a) => a.id === answerId);
    if (!currentUser || !post || !answer) return { ok: false, error: "잘못된 요청입니다." };
    if (post.authorId !== currentUser.id) return { ok: false, error: "질문자만 채택할 수 있습니다." };
    if (post.status !== "open") return { ok: false, error: "이미 마감된 질문입니다." };
    const reward = Math.floor(post.bounty * (1 - SETTLEMENT_FEE_RATE));
    setState((s) => ({
      ...s,
      posts: s.posts.map((p) => (p.id === postId ? { ...p, status: "adopted", adoptedAnswerId: answerId } : p)),
      users: s.users.map((u) =>
        u.id === answer.authorId ? { ...u, wallet: { ...u.wallet, earned: u.wallet.earned + reward } } : u,
      ),
      transactions: [
        {
          id: uid("t"),
          userId: answer.authorId,
          type: "reward",
          tokens: reward,
          memo: `답변 채택 보상 (수수료 ${Math.round(SETTLEMENT_FEE_RATE * 100)}% 차감)`,
          createdAt: now(),
        },
        ...s.transactions,
      ],
    }));
    return { ok: true };
  };

  const cancelPost = (postId: string): Result => {
    const post = state.posts.find((p) => p.id === postId);
    if (!currentUser || !post || post.authorId !== currentUser.id) return { ok: false, error: "잘못된 요청입니다." };
    if (post.answers.length > 0) return { ok: false, error: "답변이 달린 질문은 취소할 수 없습니다." };
    if (post.status !== "open") return { ok: false, error: "이미 마감된 질문입니다." };
    setState((s) => ({
      ...s,
      posts: s.posts.map((p) => (p.id === postId ? { ...p, status: "cancelled" } : p)),
      users: s.users.map((u) =>
        u.id === currentUser.id ? { ...u, wallet: { ...u.wallet, purchased: u.wallet.purchased + post.bounty } } : u,
      ),
      transactions: [
        { id: uid("t"), userId: currentUser.id, type: "refund", tokens: post.bounty, memo: "질문 취소 환불", createdAt: now() },
        ...s.transactions,
      ],
    }));
    return { ok: true };
  };

  const toggleLike = (postId: string, answerId: string) => {
    if (!currentUser) return;
    setState((s) => ({
      ...s,
      posts: s.posts.map((p) =>
        p.id !== postId
          ? p
          : {
              ...p,
              answers: p.answers.map((a) =>
                a.id !== answerId
                  ? a
                  : {
                      ...a,
                      likes: a.likes.includes(currentUser.id)
                        ? a.likes.filter((x) => x !== currentUser.id)
                        : [...a.likes, currentUser.id],
                    },
              ),
            },
      ),
    }));
  };

  const viewPost = useCallback((postId: string) => {
    setState((s) => ({ ...s, posts: s.posts.map((p) => (p.id === postId ? { ...p, views: p.views + 1 } : p)) }));
  }, []);

  return {
    ...state,
    ready,
    currentUser,
    getUser,
    switchUser,
    resetDemo,
    signup,
    buyTokens,
    withdraw,
    createPost,
    addAnswer,
    adoptAnswer,
    cancelPost,
    toggleLike,
    viewPost,
  };
}

type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  // 저장된 데이터를 불러오기 전에는 렌더링하지 않아 서버/클라이언트 불일치를 막습니다.
  if (!value.ready) return <div className="min-h-dvh" />;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
