"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { ARTICLE_REWARD_TOKENS } from "@/lib/config";
import { BODY_PARTS, NEWS_CATEGORIES, type BodyPart, type NewsCategory } from "@/lib/news";
import { useNews, useSubmitArticle } from "@/lib/news-client";
import { userTier, useStore } from "@/lib/store";
import { LoginRequired } from "./LoginRequired";
import { NewsCard } from "./News";
import { Notice } from "./ui";

/** 한 줄에 하나씩 입력한 내용을 목록으로 */
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

interface ExerciseDraft {
  name: string;
  how: string;
  dose: string;
  caution: string;
}
const emptyExercise = (): ExerciseDraft => ({ name: "", how: "", dose: "", caution: "" });

export function NewsWriteForm() {
  const { currentUser } = useStore();
  const submit = useSubmitArticle();
  const mine = useNews({ mine: true });
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<NewsCategory>(NEWS_CATEGORIES[0]);
  const [bodyPart, setBodyPart] = useState<BodyPart>(BODY_PARTS[0]);
  const [summary, setSummary] = useState("");
  const [causes, setCauses] = useState("");
  const [exercises, setExercises] = useState<ExerciseDraft[]>([emptyExercise()]);
  const [redFlags, setRedFlags] = useState("");
  const [emergency, setEmergency] = useState("");
  const [tips, setTips] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  if (!currentUser) return <LoginRequired what="원고를 보내려면" />;
  if (!userTier(currentUser))
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Notice>건강 소식 원고는 서류 심사를 마친 물리치료사만 보낼 수 있어요.</Notice>
        <Link href="/news" className="btn-ghost mt-4">건강 소식으로</Link>
      </div>
    );

  const setEx = (i: number, patch: Partial<ExerciseDraft>) => setExercises((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await submit({
      title,
      category,
      bodyPart,
      summary,
      causes: lines(causes),
      exercises: exercises.map((x) => ({ name: x.name, how: lines(x.how), dose: x.dose, caution: x.caution || undefined })),
      redFlags: lines(redFlags),
      emergency: lines(emergency),
      tips: lines(tips),
    });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "error", text: r.error });
    setMsg({ tone: "success", text: "원고를 보냈어요. 관리자 검수 후 게시일이 정해지면 알림으로 알려 드려요." });
    setTitle("");
    setSummary("");
    setCauses("");
    setExercises([emptyExercise()]);
    setRedFlags("");
    setEmergency("");
    setTips("");
    void mine.reload();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <Link href="/news" className="text-sm font-semibold text-slate-400 hover:text-ink">← 건강 소식</Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">건강 소식 원고 보내기</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        환자분들이 읽기 쉬운 말로 원인 · 집에서 할 운동 · 병원에 가야 할 신호를 정리해 주세요. 관리자 검수를 통과해 게시가 확정되면 원고료{" "}
        <b className="text-ink">{ARTICLE_REWARD_TOKENS}토큰</b>을 드려요.
      </p>
      {msg && <div className="mt-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}

      <form onSubmit={onSubmit} className="card mt-6 space-y-6 p-5 md:p-7">
        <div>
          <label className="label">제목</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="예: 아침마다 뻣뻣한 손가락, 방아쇠수지일까요?" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">분류</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as NewsCategory)}>
              {NEWS_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">부위</label>
            <select className="input" value={bodyPart} onChange={(e) => setBodyPart(e.target.value as BodyPart)}>
              {BODY_PARTS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">한 줄 요약</label>
          <textarea className="input min-h-20" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200} />
        </div>
        <div>
          <label className="label">원인 <span className="font-normal text-slate-400">(한 줄에 하나)</span></label>
          <textarea className="input min-h-28" value={causes} onChange={(e) => setCauses(e.target.value)} />
        </div>

        <div>
          <label className="label">집에서 해 보는 운동</label>
          <div className="space-y-4">
            {exercises.map((x, i) => (
              <div key={i} className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-500">운동 {i + 1}</span>
                  {exercises.length > 1 && (
                    <button type="button" onClick={() => setExercises((xs) => xs.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600" aria-label="운동 삭제">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input className="input" placeholder="운동 이름" value={x.name} onChange={(e) => setEx(i, { name: e.target.value })} maxLength={40} />
                  <input className="input" placeholder="횟수·시간 (예: 10회 × 2세트)" value={x.dose} onChange={(e) => setEx(i, { dose: e.target.value })} maxLength={60} />
                </div>
                <textarea className="input mt-3 min-h-24" placeholder="따라 하는 순서 (한 줄에 한 단계)" value={x.how} onChange={(e) => setEx(i, { how: e.target.value })} />
                <input className="input mt-3" placeholder="주의할 점 (선택)" value={x.caution} onChange={(e) => setEx(i, { caution: e.target.value })} maxLength={200} />
              </div>
            ))}
          </div>
          {exercises.length < 5 && (
            <button type="button" className="btn-ghost mt-3 !py-2 text-xs" onClick={() => setExercises((xs) => [...xs, emptyExercise()])}>
              <Plus className="size-4" /> 운동 추가
            </button>
          )}
        </div>

        <div>
          <label className="label">이럴 땐 병원에 <span className="font-normal text-slate-400">(한 줄에 하나)</span></label>
          <textarea className="input min-h-28" value={redFlags} onChange={(e) => setRedFlags(e.target.value)} />
        </div>
        <div>
          <label className="label">바로 119가 필요한 증상 <span className="font-normal text-slate-400">(선택, 한 줄에 하나)</span></label>
          <textarea className="input min-h-20" value={emergency} onChange={(e) => setEmergency(e.target.value)} />
        </div>
        <div>
          <label className="label">생활 속 수칙 <span className="font-normal text-slate-400">(선택, 한 줄에 하나)</span></label>
          <textarea className="input min-h-20" value={tips} onChange={(e) => setTips(e.target.value)} />
        </div>

        <p className="text-xs leading-relaxed text-slate-400">
          근거가 확실한 일반 정보만 적어 주세요. 특정 제품·병원 홍보, 환자 개인정보, 진단을 단정하는 표현은 반려될 수 있어요.
        </p>
        <button className="btn-primary w-full" disabled={busy}>
          <Send className="size-4" /> {busy ? "보내는 중…" : "검수 요청하기"}
        </button>
      </form>

      {mine.items.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-extrabold">내가 보낸 원고</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {mine.items.map((a) => <NewsCard key={a.id} a={a} showStatus />)}
          </div>
        </section>
      )}
    </div>
  );
}
