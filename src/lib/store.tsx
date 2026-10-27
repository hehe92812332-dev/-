"use client";

// 화면과 데이터를 잇는 저장소. 두 가지 모드로 동작합니다.
// - demo  : 브라우저(localStorage)에 시드 데이터를 두고 ledger.ts 규칙을 바로 실행 (설치 없이 체험용)
// - server: 모든 쓰기를 /api 로 보내고, 서버가 DB 트랜잭션 안에서 같은 ledger.ts 규칙을 실행
// 모드는 NEXT_PUBLIC_APP_MODE 환경변수로 정합니다.

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Category, Degree, HospitalType, MembershipPlanId, PaymentMethodId, ReportReason, TierId } from "./config";
import * as ledger from "./ledger";
import type { Outcome, State } from "./ledger";
import {
  localFeed,
  localProfile,
  localStats,
  localTherapists,
  localTierCounts,
  type FeedParams,
  type TherapistParams,
} from "./local-queries";
import { startBillingAuth, startTokenPayment } from "./payments-client";
import { seedChats, seedPosts, seedRatings, seedTransactions, seedUsers } from "./seed";
import type { Block, Board, ChatMessage, Post, Rating, RatingScore, ReportTarget, Role, Transaction, User, UserStats } from "./types";

export { balanceOf, userTier } from "./ledger";

export const SERVER_MODE = process.env.NEXT_PUBLIC_APP_MODE === "server";

const STORAGE_KEY = "pt-bridge:v9";
/** 데모에서 선택한 계정. 공유 데이터와 분리해 탭마다 다른 계정으로 채팅을 시험할 수 있게 합니다. */
const ME_KEY = "pt-bridge:me";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

export interface Me {
  id: string;
  name: string;
  email: string | null;
  needsOnboarding: boolean;
  isAdmin: boolean;
}

export interface SignupInput {
  name: string;
  role: Role;
  therapist?: {
    license: string;
    experienceYears: number;
    educationHours: number;
    degree: Degree;
    hospitalType: HospitalType;
    hospitalName: string;
    specialties: Category[];
    bio: string;
  };
  documents?: Partial<Record<"license" | "career" | "education" | "degree", File[]>>;
}

const emptyState = (): State => ({ users: [], posts: [], transactions: [], ratings: [], chats: [], reports: [], blocks: [], currentUserId: null });

const demoState = (): State => ({
  users: seedUsers(),
  posts: seedPosts(),
  transactions: seedTransactions(),
  ratings: seedRatings(),
  chats: seedChats(),
  reports: [],
  blocks: [],
  currentUserId: "u-patient",
});

/** 로그인 없이 볼 수 있는 경로 (온보딩 강제 이동에서 제외) */
const PUBLIC_PATHS = ["/signup", "/login", "/terms", "/privacy", "/refund"];

async function api<T = Result>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(path, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
    return (await res.json()) as T;
  } catch {
    return { ok: false, error: "네트워크 오류가 발생했어요. 연결을 확인해 주세요." } as T;
  }
}

function useStoreValue() {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<State>(SERVER_MODE ? emptyState : demoState);
  const [me, setMe] = useState<Me | null>(null);
  const [unread, setUnread] = useState(0);
  const [ready, setReady] = useState(false);
  // 액션이 항상 최신 상태를 기준으로 실행되도록 (결제창처럼 지연 실행되는 경우 대비)
  const latest = useRef(state);
  latest.current = state;

  // ───────── 서버 모드 캐시: 화면이 필요한 만큼 받아 합칩니다 ─────────
  const mergeUsers = useCallback((list: User[]) => {
    if (!list.length) return;
    setState((s) => {
      const map = new Map(s.users.map((u) => [u.id, u]));
      for (const u of list) {
        const old = map.get(u.id);
        // 내 지갑은 bootstrap 값만 신뢰 (다른 응답의 공개용 사본이 덮어쓰지 않게)
        map.set(u.id, old && u.id === s.currentUserId ? { ...u, wallet: old.wallet, membership: old.membership } : { ...old, ...u, stats: { ...old?.stats, ...u.stats } as UserStats });
      }
      return { ...s, users: [...map.values()] };
    });
  }, []);

  const mergePosts = useCallback((list: Post[]) => {
    if (!list.length) return;
    setState((s) => {
      const map = new Map(s.posts.map((p) => [p.id, p]));
      for (const p of list) {
        const old = map.get(p.id);
        // 목록 응답(답변 본문 없음)이 상세에서 받은 답변을 지우지 않게
        map.set(p.id, old && p.answers.length === 0 && (p.answerCount ?? 0) > 0 ? { ...old, ...p, answers: old.answers } : { ...old, ...p });
      }
      return { ...s, posts: [...map.values()] };
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!SERVER_MODE) return;
    const r = await api<{ me: Me | null; user: User | null; transactions: Transaction[]; blocks: Block[]; unread: number }>("/api/bootstrap");
    if (!r || !("me" in r)) return;
    setMe(r.me);
    setUnread(r.unread);
    setState((s) => {
      const users = r.user ? [r.user, ...s.users.filter((u) => u.id !== r.user!.id)] : s.users;
      return { ...s, users, transactions: r.transactions, blocks: r.blocks, currentUserId: r.user?.id ?? null };
    });
  }, []);

  useEffect(() => {
    if (SERVER_MODE) {
      refresh().then(() => setReady(true));
      // 다른 회원의 활동을 주기적으로 반영 (화면이 보일 때만)
      const timer = setInterval(() => document.visibilityState === "visible" && refresh(), 30_000);
      const onFocus = () => refresh();
      window.addEventListener("focus", onFocus);
      return () => {
        clearInterval(timer);
        window.removeEventListener("focus", onFocus);
      };
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const meId = localStorage.getItem(ME_KEY);
      setState((s) => ({ ...(saved ? (JSON.parse(saved) as State) : s), currentUserId: meId ?? s.currentUserId }));
    } catch {
      /* 저장소를 쓸 수 없으면 시드 데이터로 동작 */
    }
    setState((s) => ledger.sweep(s));
    setReady(true);
    // 기한 만료 질문 자동 정산 (서버 모드에서는 크론 작업)
    const timer = setInterval(() => setState((s) => ledger.sweep(s)), 60_000);
    // 다른 탭에서 바뀐 내용(채팅 등)을 바로 반영
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
  }, [refresh]);

  useEffect(() => {
    if (SERVER_MODE || !ready) return;
    try {
      // 값이 같으면 storage 이벤트가 발생하지 않아 탭 간 무한 반영이 생기지 않습니다.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, currentUserId: null }));
      if (state.currentUserId) localStorage.setItem(ME_KEY, state.currentUserId);
      else localStorage.removeItem(ME_KEY);
    } catch {
      /* noop */
    }
  }, [state, ready]);

  // 로그인 페이지에서 돌아오면(레이아웃은 그대로 유지되므로) 로그인 정보를 다시 불러옴
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current.startsWith("/login") && !pathname.startsWith("/login")) void refresh();
    prevPath.current = pathname;
  }, [pathname, refresh]);

  // 소셜 로그인 직후 회원 유형을 고르지 않았다면 가입 단계로 안내
  useEffect(() => {
    if (SERVER_MODE && me?.needsOnboarding && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) router.replace("/signup");
  }, [me, pathname, router]);

  const currentUser = state.users.find((u) => u.id === state.currentUserId) ?? null;
  const getUser = useCallback((id: string) => state.users.find((u) => u.id === id), [state.users]);

  // ───────── 조회 (두 모드 같은 형태) ─────────
  const fetchPost = useCallback(
    async (id: string): Promise<Result> => {
      if (!SERVER_MODE) return latest.current.posts.some((p) => p.id === id) ? { ok: true } : { ok: false, error: "글을 찾을 수 없습니다." };
      const r = await api<{ post?: Post; users?: User[]; myRatings?: Rating[]; ok?: false; error?: string }>(`/api/posts/${encodeURIComponent(id)}`);
      if (!r.post) return { ok: false, error: r.error ?? "글을 찾을 수 없습니다." };
      mergeUsers(r.users ?? []);
      setState((s) => ({
        ...s,
        posts: [r.post!, ...s.posts.filter((p) => p.id !== id)],
        ratings: [...s.ratings.filter((x) => x.postId !== id), ...(r.myRatings ?? [])],
      }));
      return { ok: true };
    },
    [mergeUsers],
  );

  const fetchFeed = useCallback(
    async (params: FeedParams): Promise<{ ids: string[]; nextCursor: string | null; error?: string }> => {
      if (!SERVER_MODE) return localFeed(latest.current, params);
      const qs = new URLSearchParams(
        Object.entries({ ...params, forMe: params.forMe ? "1" : undefined }).filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, string][],
      );
      const r = await api<{ posts?: Post[]; users?: User[]; nextCursor?: string | null; error?: string }>(`/api/feed?${qs}`);
      if (!r.posts) return { ids: [], nextCursor: null, error: r.error };
      mergeUsers(r.users ?? []);
      mergePosts(r.posts);
      return { ids: r.posts.map((p) => p.id), nextCursor: r.nextCursor ?? null };
    },
    [mergePosts, mergeUsers],
  );

  const fetchTherapists = useCallback(
    async (params: TherapistParams): Promise<{ ids: string[]; nextCursor: string | null }> => {
      if (!SERVER_MODE) return localTherapists(latest.current, params);
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
      const r = await api<{ ids?: string[]; users?: User[]; nextCursor?: string | null }>(`/api/therapists?${qs}`);
      mergeUsers(r.users ?? []);
      return { ids: r.ids ?? [], nextCursor: r.nextCursor ?? null };
    },
    [mergeUsers],
  );

  const fetchProfile = useCallback(
    async (id: string): Promise<{ scoreCounts: Record<string, number>; tags: [string, number][]; postIds: string[] } | null> => {
      if (!SERVER_MODE) return localProfile(latest.current, id);
      const r = await api<{ user?: User; scoreCounts: Record<string, number>; tags: [string, number][]; posts: Post[]; users: User[] }>(
        `/api/users/${encodeURIComponent(id)}`,
      );
      if (!r.user) return null;
      mergeUsers([r.user, ...r.users]);
      mergePosts(r.posts);
      return { scoreCounts: r.scoreCounts, tags: r.tags, postIds: r.posts.map((p) => p.id) };
    },
    [mergePosts, mergeUsers],
  );

  const fetchTierCounts = useCallback(async (): Promise<{ counts: Record<string, number>; questions: number }> => {
    if (!SERVER_MODE) return { counts: localTierCounts(latest.current), questions: latest.current.posts.length };
    const r = await api<{ counts?: Record<string, number>; questions?: number }>("/api/stats/tiers");
    return { counts: r.counts ?? {}, questions: r.questions ?? 0 };
  }, []);

  /** 라운지 채널: 최신 50개 또는 이전 기록(before) 불러오기 */
  const loadChannel = useCallback(
    async (channel: string, before?: string): Promise<{ hasMore: boolean; channels: Record<string, string> }> => {
      if (!SERVER_MODE) return { hasMore: false, channels: {} };
      const qs = new URLSearchParams({ channel, ...(before ? { before } : {}) });
      const r = await api<{ messages?: ChatMessage[]; users?: User[]; channels?: Record<string, string>; hasMore?: boolean }>(`/api/chats?${qs}`);
      mergeUsers(r.users ?? []);
      if (r.messages?.length)
        setState((s) => ({
          ...s,
          chats: [...r.messages!, ...s.chats.filter((c) => !r.messages!.some((m) => m.id === c.id))].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        }));
      return { hasMore: !!r.hasMore, channels: r.channels ?? {} };
    },
    [mergeUsers],
  );

  /** 라운지 새 메시지 확인 (폴링) */
  const pollChannel = useCallback(
    async (channel: string): Promise<Record<string, string>> => {
      if (!SERVER_MODE) return {};
      const mine = latest.current.chats.filter((c) => (c.channel ?? "자유") === channel);
      const after = mine.length ? mine[mine.length - 1].createdAt : new Date(0).toISOString();
      const r = await api<{ messages?: ChatMessage[]; users?: User[]; channels?: Record<string, string> }>(
        `/api/chats?${new URLSearchParams({ channel, after })}`,
      );
      mergeUsers(r.users ?? []);
      if (r.messages?.length) setState((s) => ({ ...s, chats: [...s.chats, ...r.messages!.filter((m) => !s.chats.some((c) => c.id === m.id))] }));
      return r.channels ?? {};
    },
    [mergeUsers],
  );

  /** 회원 표시값: 서버가 준 값, 없으면(데모) 직접 계산 */
  const statsOf = useCallback(
    (userId: string): UserStats => {
      const u = state.users.find((x) => x.id === userId);
      if (SERVER_MODE && u?.stats) return u.stats;
      return u ? localStats(state, u) : { temperature: 36.5, ratingCount: 0, adoptedCount: 0 };
    },
    [state],
  );

  /** 데모: 원장 함수를 바로 실행 / 서버: API 호출 후 필요한 부분만 새로고침 */
  const run = async (action: string, args: object, fn: (s: State, userId: string) => Outcome): Promise<Result> => {
    if (SERVER_MODE) {
      const r = await api("/api/actions", { method: "POST", body: JSON.stringify({ action, ...args }) });
      if (r.ok) {
        const postId = (args as { postId?: string }).postId;
        await Promise.all([refresh(), postId ? fetchPost(postId) : null]);
      }
      return r;
    }
    const s = latest.current;
    if (!s.currentUserId) return { ok: false, error: "로그인이 필요합니다." };
    const r = fn(s, s.currentUserId);
    if (!r.ok) return r;
    latest.current = r.state;
    setState(r.state);
    return { ok: true, id: r.id };
  };

  const signup = async (input: SignupInput): Promise<Result> => {
    if (SERVER_MODE) {
      const fd = new FormData();
      fd.set("name", input.name);
      fd.set("role", input.role);
      // 필수 동의(약관·만 14세·민감정보)는 가입 화면에서 확인한 뒤에만 이 함수가 호출됩니다
      fd.set("agree", "true");
      fd.set("adult", "true");
      fd.set("sensitive", "true");
      if (input.therapist) {
        const t = input.therapist;
        fd.set("license", t.license);
        fd.set("years", String(t.experienceYears));
        fd.set("hours", String(t.educationHours));
        fd.set("degree", t.degree);
        fd.set("hospitalType", t.hospitalType);
        fd.set("hospitalName", t.hospitalName);
        fd.set("specialties", JSON.stringify(t.specialties));
        fd.set("bio", t.bio);
      }
      for (const [kind, files] of Object.entries(input.documents ?? {})) for (const f of files ?? []) fd.append(`doc_${kind}`, f);
      const r = await api("/api/onboarding", { method: "POST", body: fd });
      if (r.ok) await refresh();
      return r;
    }
    const id = `u-${crypto.randomUUID()}`;
    const { license: _license, ...profile } = input.therapist ?? ({} as NonNullable<SignupInput["therapist"]>);
    const user: User = {
      id,
      name: input.name,
      role: input.role,
      avatarColor: ["#f472b6", "#fb923c", "#38bdf8", "#a78bfa", "#34d399"][input.name.length % 5],
      joinedAt: new Date().toISOString(),
      wallet: { cash: 0, bonus: 0, earned: 0 },
      // 데모에서는 서류 심사를 생략하고 바로 승인
      therapist: input.therapist ? { ...profile, licenseVerified: true, verification: "approved" } : undefined,
    };
    setState((s) => ({ ...s, users: [...s.users, user], currentUserId: id }));
    return { ok: true, id };
  };

  const viewPost = useCallback((postId: string) => {
    if (SERVER_MODE) {
      void api("/api/actions", { method: "POST", body: JSON.stringify({ action: "view", postId }) });
      return;
    }
    setState((s) => ({ ...s, posts: s.posts.map((p) => (p.id === postId ? { ...p, views: p.views + 1 } : p)) }));
  }, []);

  const toggleLike = async (postId: string, answerId: string) => {
    if (!currentUser) return;
    const me = currentUser.id;
    // 화면은 바로 반영하고, 서버 모드에서는 뒤이어 저장
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
    if (SERVER_MODE) await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "toggleLike", postId, answerId }) });
  };


  return {
    ...state,
    state,
    ready,
    me,
    serverMode: SERVER_MODE,
    currentUser,
    getUser,
    refresh,
    unread,
    setUnread,
    signup,
    viewPost,
    toggleLike,
    fetchPost,
    fetchFeed,
    fetchTherapists,
    fetchProfile,
    fetchTierCounts,
    loadChannel,
    pollChannel,
    statsOf,
    switchUser: (id: string | null) => setState((s) => ({ ...s, currentUserId: id })),
    resetDemo: () => setState(demoState()),
    buyTokens: (packageId: string, method: PaymentMethodId): Promise<Result> =>
      SERVER_MODE ? startTokenPayment(packageId, method, refresh) : run("", {}, (s, u) => ledger.purchase(s, u, packageId, method)),
    subscribe: (plan: MembershipPlanId, method: PaymentMethodId): Promise<Result> =>
      SERVER_MODE ? startBillingAuth(plan, currentUser, refresh) : run("", {}, (s, u) => ledger.subscribe(s, u, plan, method)),
    revokePurchase: (txId: string) => run("revokePurchase", { txId }, (s, u) => ledger.revokePurchase(s, u, txId)),
    setAutoRenew: (on: boolean) => run("setAutoRenew", { on }, (s, u) => ledger.setAutoRenew(s, u, on)),
    withdraw: (tokens: number, account: string) => run("withdraw", { tokens, account }, (s, u) => ledger.withdraw(s, u, tokens, account)),
    createPost: (input: { board: Board; title: string; body: string; category: Category; targetTier: TierId; directTherapistId?: string; autoLower?: boolean }) =>
      run("createPost", input, (s, u) => ledger.createPost(s, u, input)),
    addBounty: (postId: string, amount: number) => run("addBounty", { postId, amount }, (s, u) => ledger.addBounty(s, u, postId, amount)),
    addAnswer: (postId: string, body: string) => run("addAnswer", { postId, body }, (s, u) => ledger.addAnswer(s, u, postId, body)),
    adoptAnswer: (postId: string, answerId: string) => run("adoptAnswer", { postId, answerId }, (s, u) => ledger.adopt(s, u, postId, answerId)),
    cancelPost: (postId: string) => run("cancelPost", { postId }, (s, u) => ledger.cancelPost(s, u, postId)),
    tip: (postId: string, answerId: string, amount: number) => run("tip", { postId, answerId, amount }, (s, u) => ledger.tip(s, u, postId, answerId, amount)),
    rate: (input: { postId: string; answerId?: string; score: RatingScore; tags: string[] }) => run("rate", input, (s, u) => ledger.rate(s, u, input)),
    sendChat: async (body: string, kind: ChatMessage["kind"] = "text", channel = "자유") => {
      const r = await run("sendChat", { body, kind, channel }, (s, u) => ledger.sendChat(s, u, body, kind, channel));
      if (r.ok) await pollChannel(channel);
      return r;
    },
    lowerTier: (postId: string, tier: TierId) => run("lowerTier", { postId, tier }, (s, u) => ledger.lowerTargetTier(s, u, postId, tier)),
    balanceRefund: (account: string) => run("balanceRefund", { account }, (s, u) => ledger.requestBalanceRefund(s, u, account)),
    report: (input: { targetType: ReportTarget; targetId: string; reason: ReportReason; detail: string }) =>
      run("report", input, (s, u) => ledger.report(s, u, input)),
    block: (userId: string) => run("block", { userId }, (s, u) => ledger.block(s, u, userId)),
    unblock: (userId: string) => run("unblock", { userId }, (s, u) => ledger.unblock(s, u, userId)),
  };
}

type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  // 데이터를 불러오기 전에는 렌더링하지 않아 서버/클라이언트 불일치를 막습니다.
  if (!value.ready) return <div className="min-h-dvh" />;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
