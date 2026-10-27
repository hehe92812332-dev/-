"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpenCheck, Building2, GraduationCap, ShieldCheck, Timer } from "lucide-react";
import { Avatar, TempGauge, TierBadge } from "@/components/ui";
import { tagCounts, temperatureOf } from "@/lib/manner";
import { CATEGORIES, DEGREES, HOSPITAL_TYPES } from "@/lib/config";
import { userTier, useStore } from "@/lib/store";
import { tierRank } from "@/lib/tier";
import { quoteQuestion } from "@/lib/ledger";

export default function TherapistsPage() {
  const { users, posts, state, currentUser, ratings } = useStore();
  const [spec, setSpec] = useState("전체");
  const [sort, setSort] = useState<"tier" | "temp">("tier");

  const therapists = users
    .filter((u) => u.therapist?.licenseVerified && (spec === "전체" || u.therapist.specialties.includes(spec as (typeof CATEGORIES)[number])))
    .sort((a, b) =>
      sort === "temp"
        ? temperatureOf(ratings, b.id) - temperatureOf(ratings, a.id)
        : tierRank(userTier(b)!.id) - tierRank(userTier(a)!.id) || b.therapist!.experienceYears - a.therapist!.experienceYears,
    );

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

      <div className="mt-4 flex gap-4 text-sm">
        {(
          [
            ["tier", "등급 높은 순"],
            ["temp", "만족도 온도 높은 순"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setSort(k)} className={`font-semibold ${sort === k ? "text-brand-700 underline underline-offset-4" : "text-slate-400"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {therapists.map((u) => {
          const t = u.therapist!;
          const tier = userTier(u)!;
          const topTag = tagCounts(ratings, u.id)[0];
          return (
            <div key={u.id} className="card flex flex-col p-5">
              <Link href={`/users/${u.id}`} className="flex items-center gap-3 hover:opacity-80">
                <Avatar user={u} size={48} />
                <div>
                  <div className="flex items-center gap-1.5 font-bold">
                    {u.name}
                    {t.licenseVerified && <ShieldCheck className="size-4 text-brand-600" aria-label="면허 인증" />}
                  </div>
                  <div className="mt-1">
                    <TierBadge tier={tier.id} showGrade />
                  </div>
                </div>
              </Link>
              <div className="mt-4">
                <TempGauge userId={u.id} />
                {topTag && (
                  <p className="mt-1 text-xs text-slate-500">
                    가장 많이 받은 평가 <b className="text-ink">“{topTag[0]}”</b> {topTag[1]}
                  </p>
                )}
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
                  <BookOpenCheck className="size-3.5" /> 학회 인정 교육 {t.educationHours}시간
                </li>
                <li className="flex items-center gap-1.5">
                  <GraduationCap className="size-3.5" /> {DEGREES[t.degree]}
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
                {currentUser?.id !== u.id && (
                  <Link href={`/qa/new?to=${u.id}`} className="btn-primary !px-3 !py-2 text-xs">
                    1:1 질문 · {quoteQuestion(state, currentUser, { targetTier: tier.id, directTherapistId: u.id }).total}토큰
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
