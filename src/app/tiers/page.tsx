"use client";

import { useState } from "react";
import { BookOpenCheck, GraduationCap, Timer } from "lucide-react";
import { GemIcon, TierBadge, TokenAmount } from "@/components/ui";
import {
  ADOPT_DEADLINE_DAYS,
  DEGREES,
  DIRECT_ANSWER_HOURS,
  DIRECT_COST_MULTIPLIER,
  MAX_QUESTION_COST,
  MIN_PURCHASE_TOKENS,
  MIN_WITHDRAW_TOKENS,
  REVOKE_DAYS,
  SETTLEMENT_FEE_RATE,
  SETTLEMENT_HOLD_DAYS,
  TIERS,
  TOKEN_KRW,
  WITHHOLDING_TAX_RATE,
  type Degree,
  type Tier,
} from "@/lib/config";
import { gradeLabel, missingFor, nextTier, tierFor } from "@/lib/tier";

/** 경력·교육 구간별로 [학위 있음, 학위 없음] 등급을 묶은 표 (위가 상위) */
const BANDS = [...new Set(TIERS.filter((t) => t.grade).map((t) => t.minYears))]
  .sort((a, b) => b - a)
  .map((years) => {
    const pair = TIERS.filter((t) => t.grade && t.minYears === years);
    return { years, hours: pair[0].minHours, withDegree: pair.find((t) => t.needsDegree)!, without: pair.find((t) => !t.needsDegree)! };
  });

function GemCell({ tier, active }: { tier: Tier; active: boolean }) {
  return (
    <div
      className={`flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border-2 p-2.5 text-center transition sm:flex-row sm:gap-3 sm:p-3 sm:text-left md:p-4 ${active ? "shadow-md" : "border-transparent bg-slate-50"}`}
      style={active ? { borderColor: tier.colors[0], backgroundColor: `${tier.colors[0]}1a` } : undefined}
    >
      <GemIcon tier={tier.id} className="size-8 shrink-0 md:size-11" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-slate-400">{gradeLabel(tier)}</div>
        <div className="truncate text-sm font-extrabold sm:text-base" style={{ color: tier.text }}>
          {tier.name}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          질문 <b className="text-amber-600">{tier.questionCost}</b>토큰
        </div>
      </div>
    </div>
  );
}

export default function TiersPage() {
  const [years, setYears] = useState(5);
  const [hours, setHours] = useState(300);
  const [degree, setDegree] = useState<Degree>("none");
  const input = { experienceYears: years, educationHours: hours, degree };
  const tier = tierFor(input);
  const next = nextTier(tier.id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">보석 등급 안내</h1>
      <p className="mt-2 text-slate-500">
        치료사 등급은 1등급 다이아몬드부터 8등급 진주까지 8단계입니다. 세 가지 조건을 <b>모두</b> 충족한 가장 높은 등급이
        부여되며, 같은 경력·교육 구간에서는 석·박사 학위가 있으면 한 단계 위 보석이 됩니다.
      </p>

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {[
          { icon: Timer, title: "임상 경력", desc: "면허 취득 후 물리치료사로 근무한 기간 (3 · 5 · 10 · 15년 이상)" },
          { icon: BookOpenCheck, title: "학회 인정 교육", desc: "물리치료학회에서 인정하는 교육 이수 시간 (200 · 300 · 400 · 500시간 이상)" },
          { icon: GraduationCap, title: "석사 · 박사 학위", desc: "같은 구간 안에서 학위 보유 시 한 단계 상위 보석" },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="card flex gap-4 p-5">
            <Icon className="size-6 shrink-0 text-brand-600" />
            <div>
              <div className="font-bold">{title}</div>
              <p className="mt-1 text-sm text-slate-500">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 등급 매트릭스 */}
      <div className="card mt-6 overflow-hidden">
        <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-slate-100 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-500 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)] md:px-5">
          <span>경력 · 교육</span>
          <span>석사 · 박사</span>
          <span>학위 없음</span>
        </div>
        <div className="space-y-2 p-3 md:p-5">
          {BANDS.map((b) => (
            <div key={b.years} className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="text-xs md:text-sm">
                <div className="font-extrabold">{b.years}년+</div>
                <div className="text-[11px] text-slate-500 md:text-xs">교육 {b.hours}h+</div>
              </div>
              <GemCell tier={b.withDegree} active={tier.id === b.withDegree.id} />
              <GemCell tier={b.without} active={tier.id === b.without.id} />
            </div>
          ))}
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2 md:grid-cols-[180px_1fr]">
            <div className="text-sm">
              <div className="font-extrabold">그 외</div>
              <div className="text-xs text-slate-500">면허 인증 회원</div>
            </div>
            <GemCell tier={TIERS[0]} active={tier.id === TIERS[0].id} />
          </div>
        </div>
      </div>

      {/* 계산기 */}
      <div className="card mt-6 grid gap-8 p-6 md:grid-cols-2 md:p-8">
        <div className="space-y-6">
          <h2 className="text-lg font-bold">내 보석 등급 확인하기</h2>
          <div>
            <div className="flex justify-between text-sm font-semibold">
              <span>임상 경력</span>
              <span className="text-brand-700">{years}년</span>
            </div>
            <input type="range" min={0} max={30} value={years} onChange={(e) => setYears(+e.target.value)} className="mt-2 w-full accent-brand-600" />
          </div>
          <div>
            <div className="flex justify-between text-sm font-semibold">
              <span>학회 인정 교육</span>
              <span className="text-brand-700">{hours}시간</span>
            </div>
            <input type="range" min={0} max={800} step={10} value={hours} onChange={(e) => setHours(+e.target.value)} className="mt-2 w-full accent-brand-600" />
          </div>
          <div>
            <div className="label">최종 학위</div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(DEGREES) as Degree[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDegree(d)}
                  className={`rounded-xl py-2.5 text-sm font-semibold ${degree === d ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {DEGREES[d]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="flex flex-col items-center justify-center rounded-2xl p-6 text-center"
          style={{ background: `linear-gradient(135deg, ${tier.colors[0]}26, ${tier.colors[1]}1a)` }}
        >
          <GemIcon tier={tier.id} className="size-20 drop-shadow-lg" />
          <div className="mt-3 text-sm font-semibold text-slate-500">{gradeLabel(tier)}</div>
          <div className="text-3xl font-extrabold tracking-tight" style={{ color: tier.text }}>
            {tier.name}
          </div>
          <div className="mt-3 text-sm text-slate-600">
            답변 채택 시 최대 <TokenAmount value={Math.floor(tier.questionCost * (1 - SETTLEMENT_FEE_RATE))} /> 획득
          </div>
          {next && (
            <p className="mt-3 rounded-full bg-white/70 px-3 py-1 text-xs text-slate-600">
              <b style={{ color: next.text }}>{next.name}</b>까지 {missingFor(next, input).join(" · ")} 필요
            </p>
          )}
        </div>
      </div>

      {/* 등급표 */}
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">등급</th>
              <th className="px-5 py-3">조건 (모두 충족)</th>
              <th className="px-5 py-3">질문 비용</th>
              <th className="px-5 py-3">채택 시 답변자 수령</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...TIERS].reverse().map((t) => (
              <tr key={t.id}>
                <td className="px-5 py-3.5">
                  <TierBadge tier={t.id} size="md" />
                </td>
                <td className="px-5 py-3.5 text-slate-600">{t.description}</td>
                <td className="px-5 py-3.5">
                  <TokenAmount value={t.questionCost} />{" "}
                  <span className="text-xs text-slate-400">({(t.questionCost * TOKEN_KRW).toLocaleString()}원)</span>
                </td>
                <td className="px-5 py-3.5">
                  <TokenAmount value={Math.floor(t.questionCost * (1 - SETTLEMENT_FEE_RATE))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Token policy */}
      <h2 className="mt-14 text-xl font-extrabold tracking-tight">토큰 정책</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {[
          ["토큰 가치", `1토큰 = ${TOKEN_KRW}원, 최소 ${MIN_PURCHASE_TOKENS}토큰부터 충전. 카드·카카오페이·네이버페이·토스페이·휴대폰으로 충전하며, 많이 충전할수록 보너스 토큰이 붙어요.`],
          ["3가지 지갑", "충전 토큰(현금 충전분) · 보너스 토큰(혜택, 환불·환전 불가) · 수익 토큰(답변 보상, 환전 가능). 질문 시 보너스부터 사용돼요."],
          ["에스크로 보관", `질문 시 토큰은 플랫폼이 보관하고 채택 시점에 지급돼요. 답변 전 취소하면 전액 환불, ${ADOPT_DEADLINE_DAYS}일 내 채택이 없으면 추천순 자동 채택, 답변이 없으면 자동 환불돼요.`],
          ["1:1 지정 질문", `원하는 치료사를 지정해 질문할 수 있어요. 비용은 그 치료사 등급 비용의 ${DIRECT_COST_MULTIPLIER}배(최대 ${MAX_QUESTION_COST}토큰)이며, ${DIRECT_ANSWER_HOURS}시간 안에 답변이 없으면 전액 환불돼요.`],
          ["현상금 추가 · 감사 팁", "답변이 더 필요하면 현상금을 올려 기한을 연장하고, 도움이 된 답변에는 채택과 별도로 감사 팁을 보낼 수 있어요."],
          ["멤버십", "월 정기결제로 매달 토큰과 보너스를 받고, 모든 질문을 10~20% 할인받아요. 자동 갱신은 언제든 해지할 수 있어요."],
          ["정산 · 수수료", `채택 보상과 팁에서 플랫폼 수수료 ${Math.round(SETTLEMENT_FEE_RATE * 100)}%를 제외한 토큰이 지급되며, ${SETTLEMENT_HOLD_DAYS}일의 정산 대기 후 환전할 수 있어요.`],
          [
            "현금 환전 · 결제 취소",
            `수익 토큰만 ${MIN_WITHDRAW_TOKENS}토큰부터 환전 가능(원천징수 ${(WITHHOLDING_TAX_RATE * 100).toFixed(1)}% 공제). 충전 후 ${REVOKE_DAYS}일 이내 미사용 충전분은 결제 취소할 수 있어요.`,
          ],
        ].map(([t, d]) => (
          <div key={t} className="card p-5">
            <div className="font-bold">{t}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
