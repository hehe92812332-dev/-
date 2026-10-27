"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, Banknote, Coins, MessageCircleQuestion, ShieldCheck, Stethoscope, Trophy } from "lucide-react";
import { PostCard } from "@/components/PostList";
import { TierBadge, TokenAmount } from "@/components/ui";
import { TIERS } from "@/lib/config";
import { useStore } from "@/lib/store";

const STEPS = [
  { icon: Coins, title: "토큰 충전", desc: "카드·간편결제로 토큰을 충전해요." },
  { icon: MessageCircleQuestion, title: "등급 골라 질문", desc: "원하는 치료사 등급을 고르면 토큰이 보관돼요." },
  { icon: Stethoscope, title: "치료사 답변", desc: "해당 등급 이상의 인증 치료사가 답변해요." },
  { icon: Trophy, title: "채택 · 보상", desc: "채택된 답변자에게 토큰이 지급돼요." },
  { icon: Banknote, title: "현금 환전", desc: "치료사는 모은 토큰을 현금으로 환전해요." },
];

export default function Home() {
  const { posts, users } = useStore();
  const therapistCount = users.filter((u) => u.role === "therapist").length;
  const recentQa = posts.filter((p) => p.board === "patient" && p.status !== "cancelled").slice(0, 4);
  const recentClinical = posts.filter((p) => p.board === "clinical" && p.status !== "cancelled").slice(0, 2);

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
            경력·교육시간·근무기관으로 검증된 등급의 치료사에게 질문하세요. 치료사끼리는 임상 케이스를 나누고, 좋은 답변은
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
              ["누적 질문", `${posts.length}건+`],
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

      {/* Tiers */}
      <section className="mx-auto mt-20 max-w-6xl px-4">
        <div className="card overflow-hidden">
          <div className="grid md:grid-cols-[1fr_1.4fr]">
            <div className="bg-ink p-7 text-white md:p-10">
              <BadgeCheck className="size-8 text-brand-400" />
              <h2 className="mt-4 text-2xl font-extrabold tracking-tight">검증된 등급제</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                임상 경력, 보수·학회 교육 이수 시간, 근무 기관 종류를 점수화해 5단계 등급을 부여합니다. 등급이 높을수록 질문
                비용과 답변 보상이 커집니다.
              </p>
              <Link href="/tiers" className="btn mt-6 bg-white text-ink hover:bg-slate-100">
                내 등급 계산해 보기
              </Link>
            </div>
            <ul className="divide-y divide-slate-100">
              {TIERS.map((t) => (
                <li key={t.id} className="flex items-center gap-4 px-6 py-4">
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
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {recentClinical.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      </section>
    </>
  );
}
