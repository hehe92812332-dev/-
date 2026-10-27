"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Coins,
  CreditCard,
  Crown,
  Gift,
  MessageCircleQuestion,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  Trophy,
  UserRoundCheck,
} from "lucide-react";
import { TodayHealthCard } from "@/components/News";
import { PostCard } from "@/components/PostList";
import { TierBadge, TokenAmount } from "@/components/ui";
import { TIERS } from "@/lib/config";
import { useFeed, useSiteStats } from "@/lib/queries";
import { userTier, useStore } from "@/lib/store";

const STEPS = [
  { icon: Coins, title: "토큰 충전", desc: "카드·간편결제로 토큰을 충전해요." },
  { icon: MessageCircleQuestion, title: "등급 골라 질문", desc: "원하는 치료사 등급을 고르면 토큰이 보관돼요." },
  { icon: Stethoscope, title: "치료사 답변", desc: "해당 등급 이상의 인증 치료사가 답변해요." },
  { icon: Trophy, title: "채택 · 보상", desc: "채택된 답변자에게 토큰이 지급돼요." },
  { icon: Banknote, title: "현금 환전", desc: "치료사는 모은 토큰을 현금으로 환전해요." },
];

export default function Home() {
  const { currentUser } = useStore();
  const stats = useSiteStats();
  const therapistCount = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  const isVerified = !!currentUser && !!userTier(currentUser);
  const recentQa = useFeed({ board: "patient", limit: 4 }).posts;
  const recentClinical = useFeed(isVerified ? { board: "clinical", limit: 2 } : null).posts;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-white to-slate-50">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-brand-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 top-40 size-[360px] rounded-full bg-sky-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 md:pb-24 md:pt-24">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100">
            <ShieldCheck className="size-3.5" /> 면허 인증 물리치료사만 답변합니다
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.15] tracking-tight md:text-6xl">
            재활이 궁금할 땐,
            <br />
            <span className="bg-gradient-to-r from-brand-600 to-sky-500 bg-clip-text text-transparent">물리치료사</span>에게
            직접.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
            경력·학회 인정 교육·학위로 검증된 보석 등급의 치료사에게 질문하세요. 치료사끼리는 임상 케이스를 나누고, 좋은 답변은
            토큰으로 보상받습니다.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/qa/new" className="btn-primary !px-6 !py-3.5 text-base">
              무료 가입하고 질문하기 <ArrowRight className="size-4" />
            </Link>
            <Link href="/clinical" className="btn-ghost !px-6 !py-3.5 text-base">
              치료사 임상 토론 둘러보기
            </Link>
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6">
            {[
              ["인증 치료사", `${therapistCount}명+`],
              ["누적 질문", `${stats.questions.toLocaleString()}건+`],
              ["평균 첫 답변", "2시간"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="mt-1 text-2xl font-extrabold tracking-tight">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Two audiences */}
      <section className="mx-auto grid max-w-6xl gap-4 px-4 md:grid-cols-2">
        <Link href="/qa" className="card group relative overflow-hidden p-7 transition hover:shadow-lg">
          <span className="grid size-12 place-items-center rounded-2xl bg-sky-100 text-sky-600">
            <MessageCircleQuestion className="size-6" />
          </span>
          <h2 className="mt-5 text-xl font-bold">환자·보호자라면</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            수술 후 재활, 만성 통증, 운동 방법까지. 원하는 등급의 치료사를 골라 질문하고 답변을 받아보세요.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-sky-600">
            환자 Q&A 바로가기 <ArrowRight className="size-4 transition group-hover:translate-x-1" />
          </span>
        </Link>
        <Link href="/clinical" className="card group relative overflow-hidden p-7 transition hover:shadow-lg">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-700">
            <Stethoscope className="size-6" />
          </span>
          <h2 className="mt-5 text-xl font-bold">물리치료사라면</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            어려운 케이스를 동료·선배와 토론하고, 환자 질문에 답변해 토큰을 모으세요. 모은 토큰은 현금으로 환전됩니다.
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-brand-700">
            임상 토론 바로가기 <ArrowRight className="size-4 transition group-hover:translate-x-1" />
          </span>
        </Link>
      </section>

      {/* 오늘의 건강 정보 */}
      <section className="mx-auto mt-12 max-w-6xl px-4">
        <TodayHealthCard />
      </section>

      {/* How it works */}
      <section className="mx-auto mt-20 max-w-6xl px-4">
        <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">토큰으로 움직이는 신뢰의 구조</h2>
        <p className="mt-2 text-slate-500">질문자는 원하는 수준의 답변을, 치료사는 전문성에 맞는 보상을 받습니다.</p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(({ icon: Icon, title, desc }, i) => (
            <li key={title} className="card p-5">
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-slate-100">
                  <Icon className="size-5 text-slate-700" />
                </span>
                <span className="text-xs font-bold text-slate-300">0{i + 1}</span>
              </div>
              <div className="mt-4 font-bold">{title}</div>
              <p className="mt-1 text-sm text-slate-500">{desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Payment features */}
      <section className="mx-auto mt-20 max-w-6xl px-4">
        <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">내 상황에 맞는 결제 방식</h2>
        <p className="mt-2 text-slate-500">필요할 때만 충전하거나, 자주 묻는다면 멤버십으로 더 저렴하게.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Coins, color: "bg-amber-100 text-amber-600", title: "토큰 충전", desc: "300토큰부터 충전, 많이 충전할수록 보너스 최대 15%.", href: "/wallet" },
            { icon: Crown, color: "bg-violet-100 text-violet-600", title: "월 멤버십", desc: "매달 토큰 지급 + 모든 질문 최대 20% 할인.", href: "/wallet?tab=membership" },
            { icon: UserRoundCheck, color: "bg-sky-100 text-sky-600", title: "1:1 지정 질문", desc: "원하는 선생님께 직접. 48시간 무응답 시 자동 환불.", href: "/therapists" },
            { icon: Gift, color: "bg-rose-100 text-rose-500", title: "감사 팁", desc: "도움이 된 답변에 토큰으로 마음을 전하세요.", href: "/qa" },
          ].map(({ icon: Icon, color, title, desc, href }) => (
            <Link key={title} href={href} className="card group p-5 transition hover:shadow-md">
              <span className={`grid size-10 place-items-center rounded-xl ${color}`}>
                <Icon className="size-5" />
              </span>
              <div className="mt-4 font-bold">{title}</div>
              <p className="mt-1 text-sm text-slate-500">{desc}</p>
            </Link>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-2xl bg-white px-5 py-4 text-sm text-slate-600 ring-1 ring-slate-200">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-brand-600" /> 토큰은 채택 전까지 안전하게 보관</span>
          <span className="inline-flex items-center gap-1.5"><RotateCcw className="size-4 text-brand-600" /> 답변 없으면 자동 환불</span>
          <span className="inline-flex items-center gap-1.5"><CreditCard className="size-4 text-brand-600" /> 7일 내 미사용 충전분 결제 취소</span>
        </div>
      </section>

      {/* Tiers */}
      <section className="mx-auto mt-20 max-w-6xl px-4">
        <div className="card overflow-hidden">
          <div className="grid md:grid-cols-[1fr_1.4fr]">
            <div className="bg-ink p-7 text-white md:p-10">
              <BadgeCheck className="size-8 text-brand-400" />
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight">8단계 보석 등급</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                임상 경력, 물리치료학회 인정 교육 시간, 석·박사 학위를 기준으로 1등급 다이아몬드부터 8등급 진주까지 나눕니다.
                등급이 높을수록 질문 비용과 답변 보상이 커집니다.
              </p>
              <Link href="/tiers" className="btn mt-6 bg-white text-ink hover:bg-slate-100">
                내 보석 등급 확인하기
              </Link>
            </div>
            <ul className="divide-y divide-slate-100">
              {[...TIERS].reverse().map((t) => (
                <li key={t.id} className="flex items-center gap-4 px-6 py-3">
                  <TierBadge tier={t.id} size="md" />
                  <span className="hidden text-sm text-slate-500 sm:block">{t.description}</span>
                  <span className="ml-auto text-sm">
                    질문당 <TokenAmount value={t.questionCost} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Recent */}
      <section className="mx-auto mt-20 max-w-6xl px-4">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-extrabold tracking-tight">최근 환자 질문</h2>
          <Link href="/qa" className="text-sm font-semibold text-brand-700">
            전체 보기
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {recentQa.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>

        <div className="mt-14 flex items-end justify-between">
          <h2 className="text-2xl font-extrabold tracking-tight">치료사 임상 토론</h2>
          <Link href="/clinical" className="text-sm font-semibold text-brand-700">
            전체 보기
          </Link>
        </div>
        {isVerified ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {recentClinical.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        ) : (
          <div className="card mt-6 px-6 py-10 text-center text-sm text-slate-500">
            임상 토론은 서류 심사를 마친 치료사 회원만 볼 수 있어요.
            <Link href="/signup?role=therapist" className="ml-2 font-semibold text-brand-700">
              치료사로 가입하기 →
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
