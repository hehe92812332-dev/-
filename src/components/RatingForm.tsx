"use client";

import { useState } from "react";
import {
  ANSWER_COMPLAINT_TAGS,
  ANSWER_PRAISE_TAGS,
  ASKER_COMPLAINT_TAGS,
  ASKER_PRAISE_TAGS,
  RATING_SCORES,
} from "@/lib/config";
import { useStore } from "@/lib/store";
import type { RatingScore } from "@/lib/types";

/** 만족도 조사 — 질문자는 답변을, 답변자는 질문자를 평가합니다. */
export function RatingForm({
  postId,
  answerId,
  targetName,
  highlight,
  onDone,
}: {
  postId: string;
  /** 있으면 답변 평가, 없으면 질문자 평가 */
  answerId?: string;
  targetName: string;
  highlight?: boolean;
  onDone: (message: string) => void;
}) {
  const { rate } = useStore();
  const [score, setScore] = useState<RatingScore | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const options = answerId
    ? score === "bad"
      ? ANSWER_COMPLAINT_TAGS
      : ANSWER_PRAISE_TAGS
    : score === "bad"
      ? ASKER_COMPLAINT_TAGS
      : ASKER_PRAISE_TAGS;

  const pick = (s: RatingScore) => {
    // 좋음 ↔ 아쉬움 전환 시 태그 목록이 바뀌므로 초기화
    if ((s === "bad") !== (score === "bad")) setTags([]);
    setScore(s);
  };

  const submit = () => {
    if (!score) return;
    const r = rate({ postId, answerId, score, tags });
    if (!r.ok) return setError(r.error);
    onDone(`${targetName}님에 대한 평가가 반영되어 만족도 온도가 ${RATING_SCORES[score].delta > 0 ? "올라갔어요" : "내려갔어요"}.`);
  };

  return (
    <div className={`mt-4 rounded-2xl border p-4 ${highlight ? "border-brand-300 bg-brand-50/60" : "border-slate-200 bg-slate-50/60"}`}>
      <div className="text-sm font-bold">
        {answerId ? `${targetName} 선생님의 답변은 어땠나요?` : `질문자 ${targetName}님과의 소통은 어땠나요?`}
      </div>
      <p className="mt-0.5 text-xs text-slate-500">평가는 상대의 만족도 온도에 반영되며, 누가 평가했는지는 공개되지 않아요.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(Object.keys(RATING_SCORES) as RatingScore[]).map((k) => (
          <button
            key={k}
            onClick={() => pick(k)}
            className={`rounded-xl border-2 py-2.5 text-sm font-bold transition ${
              score === k ? "border-brand-500 bg-white" : "border-transparent bg-white/70 text-slate-500 hover:bg-white"
            }`}
          >
            <span className="block text-xl">{RATING_SCORES[k].emoji}</span>
            {RATING_SCORES[k].label}
          </button>
        ))}
      </div>
      {score && (
        <>
          <div className="mt-3 text-xs font-semibold text-slate-500">{score === "bad" ? "어떤 점이 아쉬웠나요?" : "어떤 점이 좋았나요?"} (선택)</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {options.map((t) => {
              const on = tags.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${on ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <button onClick={submit} className="btn-primary mt-4 w-full">
            평가 보내기
          </button>
        </>
      )}
      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}
