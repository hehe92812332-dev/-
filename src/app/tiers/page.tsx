"use client";

import { useState } from "react";
import { GraduationCap, Hospital, Timer } from "lucide-react";
import { TierBadge, TokenAmount } from "@/components/ui";
import {
  HOSPITAL_TYPES,
  MIN_WITHDRAW_TOKENS,
  SCORE_RULES,
  SETTLEMENT_FEE_RATE,
  TIERS,
  TOKEN_KRW,
  WITHHOLDING_TAX_RATE,
  type HospitalType,
} from "@/lib/config";
import { calcScore, nextTier, tierForScore } from "@/lib/tier";

export default function TiersPage() {
  const [years, setYears] = useState(5);
  const [hours, setHours] = useState(120);
  const [hospital, setHospital] = useState<HospitalType>("hospital");
  const score = calcScore({ experienceYears: years, educationHours: hours, hospitalType: hospital });
  const tier = tierForScore(score.total);
  const next = nextTier(tier.id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">등급 · 토큰 안내</h1>
      <p className="mt-2 text-slate-500">치료사 등급은 100점 만점 점수로 산정되며, 정보가 갱신될 때마다 자동으로 다시 계산됩니다.</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          { icon: Timer, title: "임상 경력", max: SCORE_RULES.experienceMax, rule: `1년당 ${SCORE_RULES.experiencePerYear}점` },
          { icon: GraduationCap, title: "교육 이수 시간", max: SCORE_RULES.educationMax, rule: `보수·학회 교육 ${SCORE_RULES.educationHoursPerPoint}시간당 1점` },
          { icon: Hospital, title: "근무 기관 종류", max: 30, rule: "기관 종류별 15~30점" },
        ].map(({ icon: Icon, title, max, rule }) => (
          <div key={title} className="card p-5">
            <Icon className="size-6 text-brand-600" />
            <div className="mt-3 font-bold">{title}</div>
            <div className="mt-1 text-sm text-slate-500">{rule}</div>
            <div className="mt-3 text-2xl font-extrabold">
              최대 {max}
              <span className="text-base font-semibold text-slate-400">점</span>
            </div>
          </div>
        ))}
      </div>

      {/* Calculator */}
      <div className="card mt-6 grid gap-8 p-6 md:grid-cols-2 md:p-8">
        <div className="space-y-6">
          <h2 className="text-lg font-bold">내 등급 미리 계산하기</h2>
          <div>
            <div className="flex justify-between text-sm font-semibold">
              <span>임상 경력</span>
              <span className="text-brand-700">{years}년</span>
            </div>
            <input type="range" min={0} max={30} value={years} onChange={(e) => setYears(+e.target.value)} className="mt-2 w-full accent-brand-600" />
          </div>
          <div>
            <div className="flex justify-between text-sm font-semibold">
              <span>교육 이수 시간</span>
              <span className="text-brand-700">{hours}시간</span>
            </div>
            <input type="range" min={0} max={500} step={10} value={hours} onChange={(e) => setHours(+e.target.value)} className="mt-2 w-full accent-brand-600" />
          </div>
          <div>
            <label className="label">근무 기관</label>
            <select className="input" value={hospital} onChange={(e) => setHospital(e.target.value as HospitalType)}>
              {Object.entries(HOSPITAL_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label} ({v.points}점)
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-slate-50 p-6">
          <div className="text-sm text-slate-500">예상 점수</div>
          <div className="mt-1 text-5xl font-extrabold tracking-tight">{score.total}</div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full transition-all" style={{ width: `${score.total}%`, backgroundColor: tier.color }} />
          </div>
          <div className="mt-2 flex gap-3 text-xs text-slate-500">
            <span>경력 {score.experience}</span>
            <span>교육 {score.education}</span>
            <span>기관 {score.hospital}</span>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <TierBadge tier={tier.id} size="md" />
            <span className="text-sm text-slate-600">
              질문 1건 답변 시 최대 <TokenAmount value={Math.floor(tier.questionCost * (1 - SETTLEMENT_FEE_RATE))} /> 획득
            </span>
          </div>
          {next && (
            <p className="mt-3 text-xs text-slate-500">
              {next.name}까지 {next.minScore - score.total}점 남았어요.
            </p>
          )}
        </div>
      </div>

      {/* Tier table */}
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">등급</th>
              <th className="px-5 py-3">필요 점수</th>
              <th className="px-5 py-3">질문 비용</th>
              <th className="px-5 py-3">채택 시 답변자 수령</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {TIERS.map((t, i) => (
              <tr key={t.id}>
                <td className="px-5 py-3.5">
                  <TierBadge tier={t.id} size="md" />
                </td>
                <td className="px-5 py-3.5 tabular-nums">
                  {t.minScore}
                  {TIERS[i + 1] ? `~${TIERS[i + 1].minScore - 1}` : "+"}점
                </td>
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
          ["토큰 가치", `1토큰 = ${TOKEN_KRW}원. 카드·간편결제로 충전하며 많이 충전할수록 보너스 토큰이 붙어요.`],
          ["에스크로 보관", "질문 시 토큰은 플랫폼이 보관하고, 답변 채택 시점에 답변자에게 지급됩니다. 답변 전 취소하면 전액 환불돼요."],
          ["정산 수수료", `채택 보상에서 플랫폼 수수료 ${Math.round(SETTLEMENT_FEE_RATE * 100)}%를 제외한 토큰이 지급됩니다.`],
          [
            "현금 환전",
            `답변으로 획득한 토큰만 ${MIN_WITHDRAW_TOKENS}토큰부터 환전할 수 있으며, 사업소득 원천징수 ${(WITHHOLDING_TAX_RATE * 100).toFixed(1)}%가 공제됩니다.`,
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
