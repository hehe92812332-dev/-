"use client";

import Link from "next/link";
import { BookOpenCheck, Building2, GraduationCap, ShieldCheck, Timer } from "lucide-react";
import { DEGREES, HOSPITAL_TYPES, RATING_SCORES } from "@/lib/config";
import { quoteQuestion } from "@/lib/ledger";
import { satisfactionRate, tagCounts, visibleRatings } from "@/lib/manner";
import { userTier, useStore } from "@/lib/store";
import type { RatingScore } from "@/lib/types";
import { PostCard } from "./PostList";
import { ReportMenu } from "./ReportMenu";
import { Avatar, TempGauge, TierBadge, timeAgo } from "./ui";

export function UserProfile({ id }: { id: string }) {
  const { getUser, ratings, posts, state, currentUser } = useStore();
  const user = getUser(id);
  if (!user) return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-slate-500">회원을 찾을 수 없습니다.</div>;

  const t = user.therapist;
  const tier = userTier(user);
  const received = visibleRatings(ratings, id);
  const tags = tagCounts(ratings, id);
  const rate = satisfactionRate(ratings, id);
  const scoreCount = (k: RatingScore) => received.filter((r) => r.score === k).length;
  const answered = posts.filter((p) => p.answers.some((a) => a.authorId === id));
  const adopted = answered.filter((p) => p.answers.find((a) => a.id === p.adoptedAnswerId)?.authorId === id);
  const asked = posts.filter((p) => p.authorId === id && p.status !== "refunded");
  // 임상 토론 글은 치료사 회원에게만 보여줍니다
  const visible = (t ? answered : asked).filter((p) => p.board === "patient" || (currentUser && userTier(currentUser)));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">
      <div className="card p-6 md:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <div className="flex flex-1 items-center gap-4">
            <Avatar user={user} size={64} />
            <div>
              <div className="flex items-center gap-1.5 text-xl font-extrabold">
                {user.name}
                <ReportMenu targetType="user" targetId={user.id} authorId={user.id} authorName={user.name} onMessage={(_t, text) => alert(text)} />
                {t?.licenseVerified && <ShieldCheck className="size-5 text-brand-600" aria-label="면허 인증" />}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-sm text-slate-500">
                {tier ? <TierBadge tier={tier.id} showGrade /> : "환자 회원"}
                <span>· 가입 {timeAgo(user.joinedAt)}</span>
              </div>
            </div>
          </div>
          <div className="md:w-72">
            <TempGauge userId={id} size="lg" />
          </div>
        </div>

        {t && (
          <>
            <p className="mt-6 leading-relaxed text-slate-700">{t.bio}</p>
            <ul className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <li className="flex items-center gap-2">
                <Building2 className="size-4 text-slate-400" /> {t.hospitalName} · {HOSPITAL_TYPES[t.hospitalType].label}
              </li>
              <li className="flex items-center gap-2">
                <Timer className="size-4 text-slate-400" /> 임상 경력 {t.experienceYears}년
              </li>
              <li className="flex items-center gap-2">
                <BookOpenCheck className="size-4 text-slate-400" /> 학회 인정 교육 {t.educationHours}시간
              </li>
              <li className="flex items-center gap-2">
                <GraduationCap className="size-4 text-slate-400" /> {DEGREES[t.degree]}
              </li>
            </ul>
            {currentUser?.id !== id && (
              <Link href={`/qa/new?to=${id}`} className="btn-primary mt-6">
                1:1 질문하기 · {quoteQuestion(state, currentUser, { targetTier: tier!.id, directTherapistId: id }).total}토큰
              </Link>
            )}
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <div className="card p-5">
          <h2 className="font-bold">만족도 조사 결과</h2>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {(Object.keys(RATING_SCORES) as RatingScore[]).map((k) => (
              <div key={k} className="rounded-xl bg-slate-50 py-3">
                <div className="text-2xl">{RATING_SCORES[k].emoji}</div>
                <div className="mt-1 text-xs text-slate-500">{RATING_SCORES[k].label}</div>
                <div className="font-extrabold tabular-nums">{scoreCount(k)}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">만족 비율</div>
              <div className="text-lg font-extrabold">{rate === undefined ? "–" : `${rate}%`}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">{t ? "채택된 답변" : "작성한 질문"}</div>
              <div className="text-lg font-extrabold">{t ? adopted.length : asked.length}</div>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-bold">받은 평가 항목</h2>
          {tags.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">아직 받은 평가가 없어요.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {tags.map(([tag, n]) => (
                <li key={tag} className="flex items-center gap-3 text-sm">
                  <span className="flex-1">{tag}</span>
                  <span className="inline-flex min-w-9 justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                    {n}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <h2 className="mt-10 text-lg font-bold">{t ? "답변한 질문" : "작성한 질문"}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {visible.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
        {visible.length === 0 && <div className="card col-span-full py-12 text-center text-sm text-slate-500">아직 활동 내역이 없어요.</div>}
      </div>
    </div>
  );
}
