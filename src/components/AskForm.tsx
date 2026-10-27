"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { CATEGORIES, TIERS, type Category, type TierId } from "@/lib/config";
import { balanceOf, userTier, useStore } from "@/lib/store";
import { getTier, tierRank } from "@/lib/tier";
import type { Board } from "@/lib/types";
import { Notice, TierBadge, TokenAmount } from "./ui";

export function AskForm({ board }: { board: Board }) {
  const router = useRouter();
  const { currentUser, createPost, users } = useStore();
  const base = board === "patient" ? "/qa" : "/clinical";
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [targetTier, setTargetTier] = useState<TierId>("pro");
  const [error, setError] = useState<string | null>(null);

  const cost = getTier(targetTier).questionCost;
  const balance = currentUser ? balanceOf(currentUser) : 0;

  const eligibleCount = (tier: TierId) =>
    users.filter((u) => {
      const t = userTier(u);
      return t && tierRank(t.id) >= tierRank(tier);
    }).length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = createPost({ board, title, body, category, targetTier });
    if (!res.ok) return setError(res.error);
    router.push(`${base}/${res.id}`);
  };

  if (!currentUser)
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Notice>질문을 작성하려면 로그인(우측 상단 데모 계정 선택)이 필요합니다.</Notice>
      </div>
    );

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <Link href={base} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-ink">
        <ArrowLeft className="size-4" /> 목록으로
      </Link>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
        {board === "patient" ? "물리치료사에게 질문하기" : "임상 케이스 올리기"}
      </h1>

      <div className="card mt-6 space-y-5 p-5 md:p-6">
        <div>
          <label className="label">분야</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  category === c ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="title">
            제목
          </label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={board === "patient" ? "예) 허리 디스크 수술 후 언제부터 걷기 운동을 해도 될까요?" : "예) [케이스] 회전근개 봉합술 후 6주, ROM 회복이 더딘 경우"}
          />
        </div>
        <div>
          <label className="label" htmlFor="body">
            내용
          </label>
          <textarea
            id="body"
            rows={8}
            className="input resize-y leading-relaxed"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              board === "patient"
                ? "나이·성별, 증상이 시작된 시기, 아픈 부위와 상황, 받은 진단이나 치료를 적어주시면 더 정확한 답변을 받을 수 있어요."
                : "환자 정보(익명화), 평가 결과, 현재 중재, 고민되는 지점을 구체적으로 작성해 주세요."
            }
          />
          <p className="mt-1.5 text-xs text-slate-400">
            이름·연락처·병원명 등 개인을 특정할 수 있는 정보는 적지 마세요.
          </p>
        </div>
      </div>

      <div className="card mt-4 p-5 md:p-6">
        <div className="flex items-center justify-between">
          <label className="label !mb-0">답변 받을 등급 선택</label>
          <Link href="/tiers" className="text-xs font-semibold text-brand-700">
            등급 기준 보기
          </Link>
        </div>
        <p className="mt-1 text-sm text-slate-500">선택한 등급 이상의 치료사만 답변할 수 있어요. 등급이 높을수록 토큰이 더 듭니다.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {TIERS.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setTargetTier(t.id)}
              className={`rounded-xl border-2 p-3 text-left transition ${
                targetTier === t.id ? "border-brand-500 bg-brand-50/50" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <TierBadge tier={t.id} />
              <div className="mt-2">
                <TokenAmount value={t.questionCost} />
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">답변 가능 {eligibleCount(t.id)}명</div>
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-600">
          <Info className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <span>
            토큰은 질문 등록 시 보관(에스크로)되고, 답변을 <b>채택</b>하면 답변한 치료사에게 지급됩니다. 답변이 달리기 전에는
            언제든 취소하고 전액 돌려받을 수 있어요.
          </span>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="sticky bottom-20 mt-6 flex items-center justify-between gap-4 rounded-2xl bg-ink px-5 py-4 text-white shadow-xl md:bottom-4">
        <div className="text-sm">
          <div className="text-slate-400">
            보유 <span className="font-semibold text-white">{balance.toLocaleString()}</span> 토큰
          </div>
          <div className="mt-0.5 font-bold">
            사용 <span className="text-amber-400">{cost}</span> 토큰
          </div>
        </div>
        {balance < cost ? (
          <Link href="/wallet" className="btn bg-amber-400 text-ink hover:bg-amber-300">
            토큰 충전하기
          </Link>
        ) : (
          <button type="submit" className="btn bg-brand-500 text-white hover:bg-brand-400">
            질문 등록
          </button>
        )}
      </div>
    </form>
  );
}
