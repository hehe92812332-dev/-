"use client";

// 화면용 조회 훅. 서버 모드에서는 API에서 필요한 만큼(페이지 단위) 받아 오고, 데모 모드에서는 브라우저 데이터로 계산합니다.

import { useCallback, useEffect, useRef, useState } from "react";
import { localFeed, localTherapists, type FeedParams, type TherapistParams } from "./local-queries";
import { SERVER_MODE, useStore } from "./store";

/** 질문 목록 (더 보기 지원) */
export function useFeed(params: FeedParams | null) {
  const { fetchFeed, posts, state } = useStore();
  const [ids, setIds] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const key = JSON.stringify(params);
  const reqId = useRef(0);

  const load = useCallback(
    async (more: boolean) => {
      if (!params) return;
      const id = ++reqId.current;
      setLoading(true);
      const r = await fetchFeed({ ...params, cursor: more ? cursor : null });
      if (id !== reqId.current) return; // 필터가 바뀌어 오래된 응답은 버림
      setIds((prev) => (more ? [...prev, ...r.ids.filter((x) => !prev.includes(x))] : r.ids));
      setCursor(r.nextCursor);
      setError(r.error);
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, cursor, fetchFeed],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 데모 모드: 브라우저 데이터가 바뀌면(새 질문 등) 바로 반영되도록 매번 계산
  const [demoPages, setDemoPages] = useState(1);
  const demo = !SERVER_MODE && params ? localFeed(state, { ...params, cursor: null, limit: (params.limit ?? 20) * demoPages }) : null;

  const map = new Map(posts.map((p) => [p.id, p]));
  if (demo)
    return {
      posts: demo.ids.map((id) => map.get(id)!).filter(Boolean),
      loading: false,
      error: undefined,
      hasMore: !!demo.nextCursor,
      loadMore: async () => setDemoPages((n) => n + 1),
      reload: async () => {},
    };
  return {
    posts: ids.map((id) => map.get(id)).filter((p): p is NonNullable<typeof p> => !!p),
    loading,
    error,
    hasMore: !!cursor,
    loadMore: () => load(true),
    reload: () => load(false),
  };
}

/** 질문 상세 */
export function usePost(id: string) {
  const { fetchPost, posts } = useStore();
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    let alive = true;
    fetchPost(id).then((r) => alive && setState({ loading: false, error: r.ok ? undefined : r.error }));
    return () => {
      alive = false;
    };
  }, [id, fetchPost]);
  return { post: posts.find((p) => p.id === id), ...state, reload: () => fetchPost(id) };
}

/** 치료사 목록 */
export function useTherapists(params: TherapistParams | null) {
  const { fetchTherapists, users, state } = useStore();
  const [ids, setIds] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params);

  const load = useCallback(
    async (more: boolean) => {
      if (!params) return;
      setLoading(true);
      const r = await fetchTherapists({ ...params, cursor: more ? cursor : null });
      setIds((prev) => (more ? [...prev, ...r.ids.filter((x) => !prev.includes(x))] : r.ids));
      setCursor(r.nextCursor);
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, cursor, fetchTherapists],
  );
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const map = new Map(users.map((u) => [u.id, u]));
  if (!SERVER_MODE && params) {
    const d = localTherapists(state, { ...params, cursor: null, limit: 500 });
    return { users: d.ids.map((id) => map.get(id)!).filter(Boolean), loading: false, hasMore: false, loadMore: async () => {} };
  }
  return { users: ids.map((id) => map.get(id)).filter((u): u is NonNullable<typeof u> => !!u), loading, hasMore: !!cursor, loadMore: () => load(true) };
}

/** 회원 프로필 */
export function useProfile(id: string) {
  const { fetchProfile, posts } = useStore();
  const [data, setData] = useState<{ scoreCounts: Record<string, number>; tags: [string, number][]; postIds: string[] } | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchProfile(id).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [id, fetchProfile]);
  const map = new Map(posts.map((p) => [p.id, p]));
  return {
    loading: data === undefined,
    notFound: data === null,
    scoreCounts: data?.scoreCounts ?? {},
    tags: data?.tags ?? [],
    posts: (data?.postIds ?? []).map((x) => map.get(x)).filter((p): p is NonNullable<typeof p> => !!p),
  };
}

/** 사이트 통계: 등급별 승인 치료사 수, 전체 질문 수 */
export function useSiteStats() {
  const { fetchTierCounts } = useStore();
  const [stats, setStats] = useState<{ counts: Record<string, number>; questions: number }>({ counts: {}, questions: 0 });
  useEffect(() => {
    fetchTierCounts().then(setStats);
  }, [fetchTierCounts]);
  return stats;
}

/** 등급별 승인 치료사 수 */
export function useTierCounts() {
  return useSiteStats().counts;
}
