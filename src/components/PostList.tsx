"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, Eye, Lock, MessageSquare, PenSquare, Search } from "lucide-react";
import { CATEGORIES } from "@/lib/config";
import { useStore } from "@/lib/store";
import type { Board, Post } from "@/lib/types";
import { TierBadge, TokenAmount, timeAgo } from "./ui";

const BOARD_META: Record<Board, { base: string; title: string; desc: string; cta: string }> = {
  patient: {
    base: "/qa",
    title: "환자 Q&A",
    desc: "통증·재활·운동이 궁금할 때, 면허 인증된 물리치료사에게 직접 물어보세요.",
    cta: "질문하기",
  },
  clinical: {
    base: "/clinical",
    title: "임상 토론",
    desc: "치료사 회원 전용 공간. 케이스를 공유하고 선배·동료 치료사의 임상 노하우를 얻으세요.",
    cta: "케이스 올리기",
  },
};

export function PostCard({ post }: { post: Post }) {
  const { getUser } = useStore();
  const author = getUser(post.authorId);
  const base = BOARD_META[post.board].base;
  return (
    <Link href={`${base}/${post.id}`} className="card group block p-5 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="chip">{post.category}</span>
        <TierBadge tier={post.targetTier} />
        <span className="text-slate-400">이상 답변 가능</span>
        <span className="ml-auto">
          {post.status === "adopted" ? (
            <span className="inline-flex items-center gap-1 font-semibold text-brand-600">
              <CheckCircle2 className="size-3.5" /> 채택 완료
            </span>
          ) : post.status === "cancelled" ? (
            <span className="font-semibold text-slate-400">취소됨</span>
          ) : (
            <span className="font-semibold text-sky-600">답변 대기</span>
          )}
        </span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-base font-bold leading-snug group-hover:text-brand-700">{post.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-500">{post.body}</p>
      <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
        <span className="font-medium text-slate-600">{author?.name}</span>
        <span>{timeAgo(post.createdAt)}</span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3.5" />
          {post.answers.length}
        </span>
        <span className="inline-flex items-center gap-1">
          <Eye className="size-3.5" />
          {post.views}
        </span>
        <span className="ml-auto rounded-lg bg-amber-50 px-2 py-1">
          <TokenAmount value={post.bounty} className="text-xs" />
        </span>
      </div>
    </Link>
  );
}

export function PostList({ board }: { board: Board }) {
  const { posts, currentUser } = useStore();
  const meta = BOARD_META[board];
  const [category, setCategory] = useState<string>("전체");
  const [status, setStatus] = useState<"all" | "open" | "adopted">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      posts.filter(
        (p) =>
          p.board === board &&
          p.status !== "cancelled" &&
          (category === "전체" || p.category === category) &&
          (status === "all" || p.status === status) &&
          (!q || p.title.includes(q) || p.body.includes(q)),
      ),
    [posts, board, category, status, q],
  );

  const locked = board === "clinical" && currentUser?.role !== "therapist";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{meta.title}</h1>
          <p className="mt-2 text-slate-500">{meta.desc}</p>
        </div>
        {!locked && (
          <Link href={`${meta.base}/new`} className="btn-primary shrink-0">
            <PenSquare className="size-4" /> {meta.cta}
          </Link>
        )}
      </div>

      {locked ? (
        <div className="card mt-8 flex flex-col items-center px-6 py-16 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-slate-100">
            <Lock className="size-6 text-slate-500" />
          </span>
          <h2 className="mt-4 text-lg font-bold">치료사 회원 전용 게시판입니다</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            면허 인증을 완료한 물리치료사만 임상 토론에 참여할 수 있어요. 환자 회원은 환자 Q&A에서 질문해 주세요.
          </p>
          <div className="mt-6 flex gap-2">
            <Link href="/signup?role=therapist" className="btn-primary">
              치료사로 가입하기
            </Link>
            <Link href="/qa" className="btn-ghost">
              환자 Q&A로 이동
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input className="input !pl-10" placeholder="증상, 질환명, 키워드로 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {["전체", ...CATEGORIES].map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                    category === c ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-4 text-sm">
              {(
                [
                  ["all", "전체"],
                  ["open", "답변 대기"],
                  ["adopted", "채택 완료"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setStatus(k)}
                  className={`font-semibold ${status === k ? "text-brand-700 underline underline-offset-4" : "text-slate-400"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {filtered.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
            {filtered.length === 0 && (
              <div className="card col-span-full py-16 text-center text-sm text-slate-500">조건에 맞는 글이 없습니다.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
