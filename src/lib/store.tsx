"use client";

// 데모용 클라이언트 저장소 (localStorage).
// 토큰 로직은 ledger.ts에 있고, 이 파일은 상태 보관과 화면 연결만 담당합니다.
// 실서비스에서는 각 액션을 서버 API 호출로 바꾸면 됩니다.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Category, MembershipPlanId, PaymentMethodId, TierId } from "./config";
import * as ledger from "./ledger";
import type { Outcome, State } from "./ledger";
import { seedChats, seedPosts, seedRatings, seedTransactions, seedUsers } from "./seed";
import type { Board, ChatMessage, RatingScore, User } from "./types";

export { balanceOf, userTier } from "./ledger";

const STORAGE_KEY = "pt-bridge:v5";
/** 데모에서 선택한 계정. 공유 데이터와 분리해 탭마다 다른 계정으로 채팅을 시험할 수 있게 합니다. */
const ME_KEY = "pt-bridge:me";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const initialState = (): State => ({
  users: seedUsers(),
  posts: seedPosts(),
  transactions: seedTransactions(),
  ratings: seedRatings(),
  chats: seedChats(),
  currentUserId: "u-patient",
});

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function useStoreValue() {
  const [state, setState] = useState<State>(initialState);
  const [ready, setReady] = useState(false);
  // 액션이 항상 최신 상태를 기준으로 실행되도록 (결제창처럼 지연 실행되는 경우 대비)
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const me = localStorage.getItem(ME_KEY);
      setState((s) => ({ ...(saved ? (JSON.parse(saved) as State) : s), currentUserId: me ?? s.currentUserId }));
    } catch {
      /* 저장소를 쓸 수 없으면 시드 데이터로 동작 */
    }
    setState((s) => ledger.sweep(s));
    setReady(true);
    // 기한 만료 질문 자동 정산 (서버에서는 크론 작업으로 대체)
    const timer = setInterval(() => setState((s) => ledger.sweep(s)), 60_000);
    // 다른 탭에서 바뀐 내용(채팅 등)을 바로 반영 — 실서비스에서는 웹소켓/실시간 DB로 대체
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue) as State;
        setState((s) => ({ ...next, currentUserId: s.currentUserId }));
      } catch {
        /* noop */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      // 값이 같으면 storage 이벤트가 발생하지 않아 탭 간 무한 반영이 생기지 않습니다.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, currentUserId: null }));
      if (state.currentUserId) localStorage.setItem(ME_KEY, state.currentUserId);
      else localStorage.removeItem(ME_KEY);
    } catch {
      /* noop */
    }
  }, [state, ready]);

  const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? null;
  const getUser = useCallback((id: string) => state.users.find((u) => u.id === id), [state.users]);

  /** 로그인한 사용자로 원장 함수를 실행하고 결과를 반영 */
  const run = (fn: (s: State, userId: string) => Outcome): Result => {
    const s = latest.current;
    if (!s.currentUserId) return { ok: false, error: "로그인이 필요합니다." };
    const r = fn(s, s.currentUserId);
    if (!r.ok) return r;
    latest.current = r.state;
    setState(r.state);
    return { ok: true, id: r.id };
  };

  const signup = (user: Omit<User, "id" | "joinedAt" | "wallet">): Result => {
    const id = uid("u");
    setState((s) => ({
      ...s,
      users: [...s.users, { ...user, id, joinedAt: new Date().toISOString(), wallet: { cash: 0, bonus: 0, earned: 0 } }],
      currentUserId: id,
    }));
    return { ok: true, id };
  };

  const viewPost = useCallback((postId: string) => {
    setState((s) => ({ ...s, posts: s.posts.map((p) => (p.id === postId ? { ...p, views: p.views + 1 } : p)) }));
  }, []);

  const toggleLike = (postId: string, answerId: string) => {
    if (!currentUser) return;
    const me = currentUser.id;
    setState((s) => ({
      ...s,
      posts: s.posts.map((p) =>
        p.id !== postId
          ? p
          : {
              ...p,
              answers: p.answers.map((a) =>
                a.id !== answerId ? a : { ...a, likes: a.likes.includes(me) ? a.likes.filter((x) => x !== me) : [...a.likes, me] },
              ),
            },
      ),
    }));
  };

  return {
    ...state,
    state,
    ready,
    currentUser,
    getUser,
    signup,
    viewPost,
    toggleLike,
    switchUser: (id: string | null) => setState((s) => ({ ...s, currentUserId: id })),
    resetDemo: () => setState(initialState()),
    buyTokens: (packageId: string, method: PaymentMethodId) => run((s, u) => ledger.purchase(s, u, packageId, method)),
    revokePurchase: (txId: string) => run((s, u) => ledger.revokePurchase(s, u, txId)),
    subscribe: (plan: MembershipPlanId, method: PaymentMethodId) => run((s, u) => ledger.subscribe(s, u, plan, method)),
    setAutoRenew: (on: boolean) => run((s, u) => ledger.setAutoRenew(s, u, on)),
    withdraw: (tokens: number, account: string) => run((s, u) => ledger.withdraw(s, u, tokens, account)),
    createPost: (input: {
      board: Board;
      title: string;
      body: string;
      category: Category;
      targetTier: TierId;
      directTherapistId?: string;
    }) => run((s, u) => ledger.createPost(s, u, input)),
    addBounty: (postId: string, amount: number) => run((s, u) => ledger.addBounty(s, u, postId, amount)),
    addAnswer: (postId: string, body: string) => run((s, u) => ledger.addAnswer(s, u, postId, body)),
    adoptAnswer: (postId: string, answerId: string) => run((s, u) => ledger.adopt(s, u, postId, answerId)),
    cancelPost: (postId: string) => run((s, u) => ledger.cancelPost(s, u, postId)),
    tip: (postId: string, answerId: string, amount: number) => run((s, u) => ledger.tip(s, u, postId, answerId, amount)),
    rate: (input: { postId: string; answerId?: string; score: RatingScore; tags: string[] }) => run((s, u) => ledger.rate(s, u, input)),
    sendChat: (body: string, kind: ChatMessage["kind"] = "text") => run((s, u) => ledger.sendChat(s, u, body, kind)),
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
