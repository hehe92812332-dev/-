"use client";

// 건강 소식 조회·제출 훅. 서버 모드는 /api/news, 데모 모드는 기본 글 모음을 하루 한 편씩 돌려 보여 줍니다.

import { useCallback, useEffect, useRef, useState } from "react";
import { findPersonalInfo, userTier } from "./ledger";
import type { ArticleInput } from "./news-input";
import {
  demoArticles,
  filterArticles,
  relatedOf,
  toSummary,
  todayKST,
  type Article,
  type ArticleSummary,
  type NewsParams,
} from "./news";
import { SERVER_MODE, useStore, type Result } from "./store";

const DRAFTS_KEY = "pt-bridge:news-drafts";

/** 데모 모드에서만 기본 글 모음을 불러옵니다 (서버 모드 화면 용량을 줄이려고) */
const demoList = async () => demoArticles((await import("./news-library")).NEWS_LIBRARY, todayKST());

function readDrafts(): Article[] {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "[]") as Article[];
  } catch {
    return [];
  }
}

async function getJson<T>(path: string): Promise<T | { ok: false; error: string }> {
  try {
    const res = await fetch(path);
    const j = await res.json();
    return res.ok ? (j as T) : { ok: false, error: j.error ?? "불러오지 못했어요." };
  } catch {
    return { ok: false, error: "네트워크 오류가 발생했어요. 연결을 확인해 주세요." };
  }
}

const query = (p: NewsParams & { mine?: boolean }) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "" && v !== false) sp.set(k, v === true ? "1" : String(v));
  return sp.toString();
};

/** 건강 소식 목록 (더 보기 지원). mine=true 이면 내가 보낸 원고 */
export function useNews(params: NewsParams & { mine?: boolean }) {
  const { currentUser } = useStore();
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const key = JSON.stringify(params);
  const req = useRef(0);

  const load = useCallback(
    async (more: boolean) => {
      const id = ++req.current;
      setLoading(true);
      let r: { items: ArticleSummary[]; nextCursor: string | null } | { ok: false; error: string };
      if (SERVER_MODE) r = await getJson(`/api/news?${query({ ...params, cursor: more ? cursor : null })}`);
      else if (params.mine) r = { items: readDrafts().filter((d) => d.authorId === currentUser?.id).map(toSummary), nextCursor: null };
      else r = filterArticles(await demoList(), { ...params, cursor: more ? cursor : null });
      if (id !== req.current) return;
      if ("items" in r) {
        setItems((prev) => (more ? [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))] : r.items));
        setCursor(r.nextCursor);
        setError(undefined);
      } else setError(r.error);
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, cursor, currentUser?.id],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, currentUser?.id]);

  return { items, loading, error, hasMore: !!cursor, loadMore: () => load(true), reload: () => load(false) };
}

/** 오늘의 건강 정보 (가장 최근 공개 글) */
export function useTodayArticle() {
  const { items, loading } = useNews({ limit: 1 });
  return { article: items[0], loading };
}

/** 글 상세 + 관련 글 */
export function useArticle(slug: string) {
  const [data, setData] = useState<{ article?: Article; related: ArticleSummary[]; preview?: boolean; error?: string; loading: boolean }>({ related: [], loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      if (SERVER_MODE) {
        const r = await getJson<{ article: Article; related: ArticleSummary[]; preview: boolean }>(`/api/news/${encodeURIComponent(slug)}`);
        if (alive) setData("article" in r ? { ...r, loading: false } : { related: [], error: r.error, loading: false });
        return;
      }
      const list = await demoList();
      const a = list.find((x) => x.slug === slug) ?? readDrafts().find((x) => x.slug === slug);
      if (alive) setData(a ? { article: a, related: relatedOf(list, a), preview: a.status !== "approved", loading: false } : { related: [], error: "글을 찾을 수 없습니다.", loading: false });
    })();
    return () => {
      alive = false;
    };
  }, [slug]);
  return data;
}

/** 치료사 원고 보내기 → 관리자 검수 대기 */
export function useSubmitArticle() {
  const { currentUser } = useStore();
  return useCallback(
    async (input: ArticleInput): Promise<Result> => {
      const { articleInput, articleText } = await import("./news-input");
      const p = articleInput.safeParse(input);
      if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "입력값을 확인해 주세요." };
      if (SERVER_MODE) {
        try {
          const res = await fetch("/api/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.data) });
          return (await res.json()) as Result;
        } catch {
          return { ok: false, error: "네트워크 오류가 발생했어요. 연결을 확인해 주세요." };
        }
      }
      if (!currentUser || !userTier(currentUser)) return { ok: false, error: "서류 심사를 마친 치료사만 원고를 보낼 수 있어요." };
      if (findPersonalInfo(articleText(p.data))) return { ok: false, error: "휴대폰 번호·주민등록번호 같은 개인정보는 올릴 수 없어요. 해당 부분을 지우고 다시 보내 주세요." };
      const id = `ar-${crypto.randomUUID()}`;
      const draft: Article = {
        ...p.data,
        id,
        slug: `t-${id.slice(3, 11)}`,
        status: "review",
        publishOn: null,
        authorId: currentUser.id,
        authorName: `${currentUser.name} 물리치료사`,
        views: 0,
        createdAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify([draft, ...readDrafts()].slice(0, 30)));
      } catch {
        return { ok: false, error: "브라우저 저장 공간이 부족해요." };
      }
      return { ok: true, id };
    },
    [currentUser],
  );
}
