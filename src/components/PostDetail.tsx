"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, CheckCircle2, Eye, Heart, Lock } from "lucide-react";
import { ADOPT_DEADLINE_DAYS, SETTLEMENT_FEE_RATE } from "@/lib/config";
import { userTier, useStore } from "@/lib/store";
import { getTier, tierRank } from "@/lib/tier";
import { Notice, TierBadge, TokenAmount, UserLine, timeAgo } from "./ui";

export function PostDetail({ id }: { id: string }) {
  const { posts, ready, getUser, currentUser, addAnswer, adoptAnswer, cancelPost, toggleLike, viewPost } = useStore();
  const post = posts.find((p) => p.id === id);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    if (ready) viewPost(id);
  }, [ready, id, viewPost]);

  if (!ready) return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-slate-400">불러오는 중…</div>;
  if (!post) return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-slate-500">글을 찾을 수 없습니다.</div>;

  const base = post.board === "patient" ? "/qa" : "/clinical";
  if (post.board === "clinical" && currentUser?.role !== "therapist")
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Notice>
          <Lock className="mr-1 inline size-4" /> 임상 토론은 치료사 회원 전용입니다.
        </Notice>
      </div>
    );

  const author = getUser(post.authorId)!;
  const isOwner = currentUser?.id === post.authorId;
  const reward = Math.floor(post.bounty * (1 - SETTLEMENT_FEE_RATE));
  const myTier = currentUser ? userTier(currentUser) : undefined;
  const canAnswer =
    post.status === "open" && !isOwner && myTier && tierRank(myTier.id) >= tierRank(post.targetTier);
  const sortedAnswers = [...post.answers].sort((a, b) =>
    a.id === post.adoptedAnswerId ? -1 : b.id === post.adoptedAnswerId ? 1 : b.likes.length - a.likes.length,
  );

  const run = (fn: () => { ok: boolean; error?: string }, success: string) => {
    const r = fn();
    setMsg(r.ok ? { tone: "success", text: success } : { tone: "error", text: (r as { error: string }).error });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <Link href={base} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink">
        <ArrowLeft className="size-4" /> 목록으로
      </Link>

      <article className="card mt-4 p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="chip">{post.category}</span>
          <TierBadge tier={post.targetTier} />
          <span className="text-slate-400">이상 답변 가능</span>
        </div>
        <h1 className="mt-3 text-xl font-extrabold leading-snug tracking-tight md:text-2xl">{post.title}</h1>
        <div className="mt-4 flex items-center justify-between gap-3">
          <UserLine user={author} sub={timeAgo(post.createdAt)} />
          <span className="inline-flex items-center gap-1 text-xs text-slate-400">
            <Eye className="size-3.5" /> {post.views}
          </span>
        </div>
        <p className="mt-6 whitespace-pre-wrap leading-relaxed text-slate-700">{post.body}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm">
          <Award className="size-5 text-amber-500" />
          <span>
            채택 보상 <TokenAmount value={post.bounty} />
            <span className="ml-1 text-xs text-slate-500">(수수료 제외 시 답변자 수령 {reward}토큰)</span>
          </span>
          {post.status === "open" && (
            <span className="text-xs text-slate-500">· {ADOPT_DEADLINE_DAYS}일 내 채택하지 않으면 추천순 자동 채택</span>
          )}
          {isOwner && post.status === "open" && post.answers.length === 0 && (
            <button
              onClick={() => run(() => cancelPost(post.id), "질문을 취소하고 토큰을 환불했어요.")}
              className="ml-auto text-xs font-semibold text-slate-500 underline"
            >
              질문 취소·환불
            </button>
          )}
        </div>
      </article>

      {msg && (
        <div className="mt-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}

      <h2 className="mt-10 text-lg font-bold">
        답변 <span className="text-brand-600">{post.answers.length}</span>
      </h2>

      <div className="mt-4 space-y-4">
        {sortedAnswers.map((a) => {
          const u = getUser(a.authorId)!;
          const adopted = post.adoptedAnswerId === a.id;
          const liked = currentUser ? a.likes.includes(currentUser.id) : false;
          return (
            <div key={a.id} className={`card p-5 md:p-6 ${adopted ? "ring-2 ring-brand-500" : ""}`}>
              {adopted && (
                <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">
                  <CheckCircle2 className="size-3.5" /> 질문자 채택
                </div>
              )}
              <UserLine user={u} sub={`${u.therapist?.hospitalName ?? ""} · ${timeAgo(a.createdAt)}`} />
              <p className="mt-4 whitespace-pre-wrap leading-relaxed text-slate-700">{a.body}</p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => toggleLike(post.id, a.id)}
                  disabled={!currentUser}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    liked ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Heart className={`size-3.5 ${liked ? "fill-current" : ""}`} /> 도움돼요 {a.likes.length}
                </button>
                {isOwner && post.status === "open" && (
                  <button
                    onClick={() => run(() => adoptAnswer(post.id, a.id), `답변을 채택했어요. ${u.name} 선생님께 ${reward}토큰이 지급되었습니다.`)}
                    className="btn-primary ml-auto !py-1.5 text-xs"
                  >
                    이 답변 채택하기
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {post.answers.length === 0 && (
          <div className="card py-12 text-center text-sm text-slate-500">아직 답변이 없어요. 곧 치료사 선생님이 답변해 드릴 거예요.</div>
        )}
      </div>

      {post.status === "open" && !isOwner && (
        <div className="card mt-6 p-5 md:p-6">
          <h3 className="font-bold">답변 작성</h3>
          {canAnswer ? (
            <>
              <textarea
                rows={6}
                className="input mt-3 leading-relaxed"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  post.board === "patient"
                    ? "진단·처방이 아닌 정보 제공 범위에서 답변해 주세요. 필요 시 의료기관 방문을 권해 주세요."
                    : "근거·경험을 바탕으로 의견을 공유해 주세요."
                }
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">채택되면 {reward}토큰을 받아요.</span>
                <button
                  onClick={() => {
                    const r = addAnswer(post.id, draft);
                    if (r.ok) setDraft("");
                    setMsg(r.ok ? { tone: "success", text: "답변이 등록되었어요." } : { tone: "error", text: r.error });
                  }}
                  className="btn-primary"
                >
                  답변 등록
                </button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              {currentUser?.role !== "therapist"
                ? "답변은 면허 인증된 물리치료사 회원만 작성할 수 있어요."
                : `이 질문은 ${getTier(post.targetTier).name} 등급 이상만 답변할 수 있어요. (내 등급: ${myTier?.name})`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
