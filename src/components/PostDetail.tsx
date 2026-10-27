"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, CheckCircle2, Clock, Eye, Gift, Heart, Lock, Plus, UserRoundCheck } from "lucide-react";
import { BOUNTY_ADD_OPTIONS, TIP_OPTIONS } from "@/lib/config";
import { canRateAnswer, canRateAsker, rewardAfterFee } from "@/lib/ledger";
import { RatingForm } from "./RatingForm";
import { userTier, useStore } from "@/lib/store";
import { getTier, tierRank } from "@/lib/tier";
import { Notice, TierBadge, TokenAmount, UserLine, timeAgo } from "./ui";

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "곧 마감";
  const h = Math.floor(ms / 3600_000);
  return h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간 남음` : `${h}시간 ${Math.floor((ms % 3600_000) / 60_000)}분 남음`;
}

export function PostDetail({ id }: { id: string }) {
  const store = useStore();
  const { posts, getUser, currentUser, viewPost, state } = store;
  const post = posts.find((p) => p.id === id);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [tipFor, setTipFor] = useState<string | null>(null);
  const [showBounty, setShowBounty] = useState(false);
  const [ratingFor, setRatingFor] = useState<string | null>(null);

  useEffect(() => {
    viewPost(id);
  }, [id, viewPost]);

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
  const direct = post.directTherapistId ? getUser(post.directTherapistId) : undefined;
  const isOwner = currentUser?.id === post.authorId;
  const reward = rewardAfterFee(post.bounty);
  const myTier = currentUser ? userTier(currentUser) : undefined;
  const canAnswer =
    post.status === "open" &&
    !isOwner &&
    !!myTier &&
    tierRank(myTier.id) >= tierRank(post.targetTier) &&
    (!post.directTherapistId || post.directTherapistId === currentUser?.id);
  const sortedAnswers = [...post.answers].sort((a, b) =>
    a.id === post.adoptedAnswerId ? -1 : b.id === post.adoptedAnswerId ? 1 : b.likes.length - a.likes.length,
  );

  const show = (r: { ok: boolean; error?: string }, success: string) =>
    setMsg(r.ok ? { tone: "success", text: success } : { tone: "error", text: r.error ?? "오류가 발생했습니다." });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <Link href={base} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink">
        <ArrowLeft className="size-4" /> 목록으로
      </Link>

      <article className="card mt-4 p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="chip">{post.category}</span>
          {direct ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">
              <UserRoundCheck className="size-3" /> {direct.name} 선생님 1:1 질문
            </span>
          ) : (
            <>
              <TierBadge tier={post.targetTier} />
              <span className="text-slate-400">이상 답변 가능</span>
            </>
          )}
        </div>
        <h1 className="mt-3 text-xl font-extrabold leading-snug tracking-tight md:text-2xl">{post.title}</h1>
        <div className="mt-4 flex items-center justify-between gap-3">
          <UserLine user={author} sub={timeAgo(post.createdAt)} />
          <span className="inline-flex items-center gap-1 text-xs text-slate-400">
            <Eye className="size-3.5" /> {post.views}
          </span>
        </div>
        <p className="mt-6 whitespace-pre-wrap leading-relaxed text-slate-700">{post.body}</p>

        <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Award className="size-5 text-amber-500" />
            <span>
              채택 보상 <TokenAmount value={post.bounty} />
              <span className="ml-1 text-xs text-slate-500">(답변자 수령 {reward}토큰)</span>
            </span>
            {post.status === "open" && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Clock className="size-3.5" />
                {direct && post.answers.length === 0 ? "답변 기한" : "채택 기한"} {timeLeft(post.expiresAt)}
              </span>
            )}
            {isOwner && post.status === "open" && (
              <span className="ml-auto flex gap-3">
                <button onClick={() => setShowBounty((v) => !v)} className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-700">
                  <Plus className="size-3.5" /> 현상금 추가
                </button>
                {post.answers.length === 0 && (
                  <button
                    onClick={() => show(store.cancelPost(post.id), "질문을 취소하고 토큰을 환불했어요.")}
                    className="text-xs font-semibold text-slate-500 underline"
                  >
                    취소·환불
                  </button>
                )}
              </span>
            )}
          </div>
          {showBounty && post.status === "open" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-amber-200/60 pt-3">
              <span className="text-xs text-slate-600">더 빠르고 자세한 답변을 원하면 현상금을 올려 보세요. 기한도 연장돼요.</span>
              <div className="flex gap-1.5">
                {BOUNTY_ADD_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      show(store.addBounty(post.id, n), `현상금 ${n}토큰을 추가했어요.`);
                      setShowBounty(false);
                    }}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </div>
          )}
          {post.status === "refunded" && (
            <p className="mt-2 text-xs text-slate-500">
              {post.closedReason === "no_answer" ? "기한 내 답변이 없어 질문자에게 전액 환불되었습니다." : "질문자가 취소하여 환불되었습니다."}
            </p>
          )}
          {post.closedReason === "auto_adopt" && (
            <p className="mt-2 text-xs text-slate-500">채택 기한이 지나 추천이 가장 많은 답변이 자동 채택되었습니다.</p>
          )}
        </div>
      </article>

      {msg && (
        <div className="mt-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}

      {currentUser && canRateAsker(state, currentUser.id, post) && (
        <RatingForm postId={post.id} targetName={author.name} onDone={(text) => setMsg({ tone: "success", text })} />
      )}

      <h2 className="mt-10 text-lg font-bold">
        답변 <span className="text-brand-600">{post.answers.length}</span>
      </h2>

      <div className="mt-4 space-y-4">
        {sortedAnswers.map((a) => {
          const u = getUser(a.authorId)!;
          const adopted = post.adoptedAnswerId === a.id;
          const liked = currentUser ? a.likes.includes(currentUser.id) : false;
          const mine = currentUser?.id === a.authorId;
          return (
            <div key={a.id} className={`card p-5 md:p-6 ${adopted ? "ring-2 ring-brand-500" : ""}`}>
              {adopted && (
                <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white">
                  <CheckCircle2 className="size-3.5" /> {post.closedReason === "auto_adopt" ? "자동 채택" : "질문자 채택"}
                </div>
              )}
              <Link href={`/users/${u.id}`} className="block w-fit rounded-lg hover:opacity-80">
                <UserLine user={u} sub={`${u.therapist?.hospitalName ?? ""} · ${timeAgo(a.createdAt)}`} />
              </Link>
              <p className="mt-4 whitespace-pre-wrap leading-relaxed text-slate-700">{a.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => store.toggleLike(post.id, a.id)}
                  disabled={!currentUser}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    liked ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Heart className={`size-3.5 ${liked ? "fill-current" : ""}`} /> 도움돼요 {a.likes.length}
                </button>
                <button
                  onClick={() => setTipFor(tipFor === a.id ? null : a.id)}
                  disabled={!currentUser || mine}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
                >
                  <Gift className="size-3.5" /> 감사 팁{a.tips > 0 && ` · ${a.tips}`}
                </button>
                {currentUser && canRateAnswer(state, currentUser.id, post, a.id) && ratingFor !== a.id && (
                  <button
                    onClick={() => setRatingFor(a.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-100"
                  >
                    🌡️ 만족도 평가
                  </button>
                )}
                {isOwner && post.status === "open" && (
                  <button
                    onClick={() => {
                      const r = store.adoptAnswer(post.id, a.id);
                      show(r, `답변을 채택했어요. ${u.name} 선생님께 ${reward}토큰이 지급되었습니다. 답변 만족도도 남겨 주세요!`);
                      if (r.ok) setRatingFor(a.id);
                    }}
                    className="btn-primary ml-auto !py-1.5 text-xs"
                  >
                    이 답변 채택하기
                  </button>
                )}
              </div>
              {ratingFor === a.id && currentUser && canRateAnswer(state, currentUser.id, post, a.id) && (
                <RatingForm
                  postId={post.id}
                  answerId={a.id}
                  targetName={u.name}
                  highlight={adopted}
                  onDone={(text) => {
                    setRatingFor(null);
                    setMsg({ tone: "success", text });
                  }}
                />
              )}
              {tipFor === a.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3">
                  <span className="text-xs text-slate-600">{u.name} 선생님께 감사의 토큰을 보내세요.</span>
                  {TIP_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        show(store.tip(post.id, a.id, n), `${u.name} 선생님께 ${n}토큰을 보냈어요. 고마운 마음이 전달됐어요!`);
                        setTipFor(null);
                      }}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
                    >
                      {n}토큰
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {post.answers.length === 0 && (
          <div className="card py-12 text-center text-sm text-slate-500">
            {direct ? `${direct.name} 선생님의 답변을 기다리고 있어요.` : "아직 답변이 없어요. 곧 치료사 선생님이 답변해 드릴 거예요."}
          </div>
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
                    const r = store.addAnswer(post.id, draft);
                    if (r.ok) setDraft("");
                    show(r, "답변이 등록되었어요.");
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
                : direct
                  ? `${direct.name} 선생님에게 온 1:1 질문이라 다른 치료사는 답변할 수 없어요.`
                  : `이 질문은 ${getTier(post.targetTier).name} 등급 이상만 답변할 수 있어요. (내 등급: ${myTier?.name})`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
