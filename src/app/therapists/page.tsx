"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, GraduationCap, ShieldCheck, Timer } from "lucide-react";
import { Avatar, TierBadge } from "@/components/ui";
import { CATEGORIES, HOSPITAL_TYPES } from "@/lib/config";
import { userTier, useStore } from "@/lib/store";
import { calcScore } from "@/lib/tier";

export default function TherapistsPage() {
  const { users, posts } = useStore();
  const [spec, setSpec] = useState("전체");

  const therapists = users
    .filter((u) => u.therapist && (spec === "전체" || u.therapist.specialties.includes(spec as (typeof CATEGORIES)[number])))
    .sort((a, b) => calcScore(b.therapist!).total - calcScore(a.therapist!).total);

  const adoptedCount = (id: string) =>
    posts.filter((p) => p.adoptedAnswerId && p.answers.find((a) => a.id === p.adoptedAnswerId)?.authorId === id).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">치료사 찾기</h1>
      <p className="mt-2 text-slate-500">면허 인증을 마친 물리치료사들의 경력과 전문 분야를 확인하세요.</p>

      <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {["전체", ...CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setSpec(c)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              spec === c ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {therapists.map((u) => {
          const t = u.therapist!;
          const tier = userTier(u)!;
          const score = calcScore(t).total;
          return (
            <div key={u.id} className="card flex flex-col p-5">
              <div className="flex items-center gap-3">
                <Avatar user={u} size={48} />
                <div>
                  <div className="flex items-center gap-1.5 font-bold">
                    {u.name}
                    {t.licenseVerified && <ShieldCheck className="size-4 text-brand-600" aria-label="면허 인증" />}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <TierBadge tier={tier.id} />
                    <span className="text-xs text-slate-400">{score}점</span>
                  </div>
                </div>
              </div>
              <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-slate-600">{t.bio}</p>
              <ul className="mt-4 space-y-1.5 text-xs text-slate-500">
                <li className="flex items-center gap-1.5">
                  <Building2 className="size-3.5" /> {t.hospitalName} · {HOSPITAL_TYPES[t.hospitalType].label}
                </li>
                <li className="flex items-center gap-1.5">
                  <Timer className="size-3.5" /> 임상 경력 {t.experienceYears}년
                </li>
                <li className="flex items-center gap-1.5">
                  <GraduationCap className="size-3.5" /> 교육 이수 {t.educationHours}시간
                </li>
              </ul>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {t.specialties.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex items-center justify-between pt-5">
                <span className="text-xs text-slate-500">
                  채택 답변 <b className="text-ink">{adoptedCount(u.id)}</b>
                </span>
                <Link href="/qa/new" className="text-xs font-bold text-brand-700">
                  질문하기 →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
