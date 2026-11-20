"use client";

import { useMemo, useState } from "react";
import type { Finding } from "@/lib/biomech/analysis";
import type { RegionRisk } from "@/lib/biomech/injury";
import type { Metric } from "@/lib/biomech/types";
import { Label, Tag, fmt } from "./parts";
import type { LiteFrame, LiteResult } from "./transfer";

const LEVEL = {
  risk: { bar: "bg-[#c8402a]", label: "위험", tone: "risk" as const },
  warn: { bar: "bg-[#d29a1e]", label: "주의", tone: "warn" as const },
  info: { bar: "bg-[#8aa2ba]", label: "참고", tone: "info" as const },
};

export function Findings({ findings, onSeek }: { findings: Finding[]; onSeek: (t: number) => void }) {
  const main = findings.filter((f) => f.cause !== "입력");
  const input = findings.filter((f) => f.cause === "입력");
  return (
    <div>
      {main.length === 0 && (
        <div className="rounded-[6px] border border-[#cfe3da] bg-[#f1f8f4] p-3 text-[13px] leading-relaxed text-[#2e5e4c]">
          이 체형과 가동성에서는 눈에 띄는 보상 동작이 계산되지 않았습니다. 부하나 가동성 값을 바꿔 한계가 어디서 나타나는지 확인해 보세요.
        </div>
      )}
      <ol className="space-y-2">
        {main.map((f) => (
          <li key={f.id} className="relative overflow-hidden rounded-[6px] border border-[#e3dfd6] bg-white">
            <span className={`absolute inset-y-0 left-0 w-[3px] ${LEVEL[f.level].bar}`} />
            <div className="py-2.5 pl-3.5 pr-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag tone={LEVEL[f.level].tone}>{LEVEL[f.level].label}</Tag>
                <Tag>{f.cause}</Tag>
                {f.t !== undefined && (
                  <button onClick={() => onSeek(f.t!)} className="ml-auto text-[11px] font-semibold text-[#6e6a63] underline decoration-[#c9c3b7] underline-offset-2 hover:text-[#161616]">
                    {Math.round(f.t * 100)}% 지점 보기
                  </button>
                )}
              </div>
              <h4 className="mt-1.5 text-[14px] font-bold leading-snug text-[#161616]">{f.title}</h4>
              <p className="mt-1 text-[13px] leading-relaxed text-[#4a4741]">{f.detail}</p>
              {f.tip && <p className="mt-1.5 border-t border-dashed border-[#e3dfd6] pt-1.5 text-[12px] leading-relaxed text-[#6e6a63]">→ {f.tip}</p>}
            </div>
          </li>
        ))}
      </ol>
      {input.length > 0 && (
        <details className="mt-3 rounded-[6px] border border-[#e3dfd6] bg-white p-2.5 text-[12px] text-[#6e6a63]">
          <summary className="cursor-pointer font-semibold">입력값 확인·조정 {input.length}건</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {input.map((f) => (
              <li key={f.id}>{f.detail}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function Metrics({ metrics }: { metrics: Metric[] }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="text-left text-[11px] text-[#9a958c]">
          <th className="pb-1 font-semibold">항목</th>
          <th className="pb-1 text-right font-semibold">내 체형</th>
          <th className="pb-1 text-right font-semibold">표준</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => {
          const d = m.digits ?? 1;
          const diff = m.ref !== undefined ? m.value - m.ref : 0;
          const sig = m.ref !== undefined && Math.abs(diff) >= Math.max(0.5 * 10 ** -d, Math.abs(m.ref) * 0.015);
          const good = m.better ? (m.better === "high" ? diff > 0 : diff < 0) : null;
          return (
            <tr key={m.id} className="border-t border-[#efece6] align-top">
              <td className="py-1.5 pr-2 text-[#3c3a36]">
                {m.label}
                {m.note && <div className="text-[11px] leading-snug text-[#9a958c]">{m.note}</div>}
              </td>
              <td className="whitespace-nowrap py-1.5 text-right font-bold tabular-nums">
                {fmt(m.value, d)}
                <span className="ml-0.5 text-[11px] font-semibold text-[#9a958c]">{m.unit}</span>
                {sig && (
                  <div className={`text-[11px] font-semibold ${good === null ? "text-[#6e6a63]" : good ? "text-[#0f8b6c]" : "text-[#c8402a]"}`}>
                    {diff > 0 ? "+" : "−"}
                    {fmt(Math.abs(diff), d)}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums text-[#9a958c]">{m.ref !== undefined ? fmt(m.ref, d) : "–"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Now({ f, bodyMass }: { f: LiteFrame | null; bodyMass: number }) {
  if (!f) return null;
  const a = f.angles;
  const rows: [string, number, number | null, string][] = [
    ["무릎 굴곡", a.kneeFlex[0], a.kneeFlex[1], "°"],
    ["고관절 굴곡", a.hipFlex[0], a.hipFlex[1], "°"],
    ["발목 배측굴곡", a.ankleDF[0], a.ankleDF[1], "°"],
    ["어깨 굴곡", a.shoulderFlex[0], a.shoulderFlex[1], "°"],
    ["무릎 안쪽 이동", f.kneeMedial[0] * 100, f.kneeMedial[1] * 100, "cm"],
    ["몸통 숙임", a.trunkLean, null, "°"],
    ["골반 좌우 기울기", a.pelvisObliq, null, "°"],
  ];
  const feet = f.loads.filter((l) => l.id === "L" || l.id === "R");
  const bw = bodyMass * 9.81;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-bold">{f.phase}</span>
        <span className="text-[11px] tabular-nums text-[#9a958c]">{(f.time).toFixed(2)}초 · {Math.round(f.t * 100)}%</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[11px] text-[#9a958c]">
            <th className="text-left font-semibold" />
            <th className="text-right font-semibold text-[#2f6fde]">좌</th>
            <th className="text-right font-semibold text-[#c4521f]">우</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([l, x, y, u]) => (
            <tr key={l} className="border-t border-[#efece6]">
              <td className="py-1 text-[#4a4741]">{l}</td>
              <td className="py-1 text-right font-semibold tabular-nums" colSpan={y === null ? 2 : 1}>
                {fmt(x, u === "cm" ? 1 : 0)}
                {u}
              </td>
              {y !== null && (
                <td className="py-1 text-right font-semibold tabular-nums">
                  {fmt(y, u === "cm" ? 1 : 0)}
                  {u}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {feet.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold text-[#9a958c]">발 하중 (뒤꿈치 ← → 발끝)</div>
          {feet.map((l) => (
            <div key={l.id} className="mb-1.5 flex items-center gap-2 text-[12px]">
              <span className={`w-5 font-bold ${l.id === "L" ? "text-[#2f6fde]" : "text-[#c4521f]"}`}>{l.id === "L" ? "좌" : "우"}</span>
              <div className="relative h-3 flex-1 rounded-[2px] bg-[#efece6]">
                <div className={`absolute inset-y-0 left-0 rounded-[2px] ${l.id === "L" ? "bg-[#2f6fde]/25" : "bg-[#e0662f]/25"}`} style={{ width: `${l.share * 100}%` }} />
                <div className="absolute top-[-2px] h-[16px] w-[2px] bg-[#161616]" style={{ left: `calc(${l.fore * 100}% - 1px)` }} title="압력 중심" />
              </div>
              <span className="w-[74px] text-right font-semibold tabular-nums">
                {Math.round(l.share * 100)}% {Math.round(l.kg)}kg
              </span>
            </div>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-3 gap-2 text-[12px]">
        {[
          ["지면반력", f.grf / bw, "×체중", 2],
          ["무릎 모멘트", f.moments.knee, "N·m", 0],
          ["고관절 모멘트", f.moments.hip, "N·m", 0],
          ["허리 모멘트", f.moments.lumbar, "N·m", 0],
          ["발목 모멘트", f.moments.ankle, "N·m", 0],
          ["어깨 모멘트", f.moments.shoulder, "N·m", 0],
        ].map(([l, v, u, d]) => (
          <div key={l as string} className="rounded-[5px] border border-[#e3dfd6] bg-white px-2 py-1.5">
            <dt className="text-[10px] text-[#9a958c]">{l}</dt>
            <dd className="font-bold tabular-nums">
              {fmt(Math.max(0, v as number), d as number)}
              <span className="ml-0.5 text-[10px] font-semibold text-[#9a958c]">{u}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

interface Series {
  label: string;
  unit: string;
  get: (f: LiteFrame) => number | [number, number];
  digits?: number;
}

const SERIES: Series[] = [
  { label: "무릎 굴곡", unit: "°", get: (f) => [f.angles.kneeFlex[0], f.angles.kneeFlex[1]] },
  { label: "고관절 굴곡", unit: "°", get: (f) => [f.angles.hipFlex[0], f.angles.hipFlex[1]] },
  { label: "몸통 숙임", unit: "°", get: (f) => f.angles.trunkLean },
  { label: "발목 배측굴곡", unit: "°", get: (f) => [f.angles.ankleDF[0], f.angles.ankleDF[1]] },
  { label: "수직 지면반력", unit: "×BW", get: (f) => f.grf, digits: 2 },
  { label: "허리 신전 모멘트", unit: "N·m", get: (f) => f.moments.lumbar },
];

export function Charts({ res, t }: { res: LiteResult; t: number }) {
  const bw = res.bodyMass * 9.81;
  const data = useMemo(
    () =>
      SERIES.map((s) => {
        const conv = (v: number) => (s.label === "수직 지면반력" ? v / bw : v);
        const mine = res.frames.map((f) => {
          const v = s.get(f);
          return Array.isArray(v) ? [conv(v[0]), conv(v[1])] : [conv(v)];
        });
        const ref = res.ref?.map((f) => {
          const v = s.get(f);
          return conv(Array.isArray(v) ? v[0] : v);
        });
        return { s, mine, ref };
      }),
    [res, bw],
  );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
      {data.map(({ s, mine, ref }) => (
        <Spark key={s.label} title={s.label} unit={s.unit} mine={mine} refLine={ref} t={t} digits={s.digits ?? 0} />
      ))}
    </div>
  );
}

function Spark({ title, unit, mine, refLine, t, digits }: { title: string; unit: string; mine: number[][]; refLine?: number[]; t: number; digits: number }) {
  const W = 280,
    H = 76,
    pad = { l: 4, r: 4, t: 6, b: 6 };
  const all = [...mine.flat(), ...(refLine ?? [])].filter(Number.isFinite);
  let lo = Math.min(...all),
    hi = Math.max(...all);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-6) {
    hi += 1;
    lo -= 1;
  }
  const n = mine.length;
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const series = mine[0].length;
  const cur = Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
  const curV = mine[cur];
  return (
    <figure className="rounded-[6px] border border-[#e3dfd6] bg-white p-2">
      <figcaption className="flex items-baseline justify-between text-[11px]">
        <span className="font-semibold text-[#3c3a36]">{title}</span>
        <span className="tabular-nums">
          {curV.map((v, i) => (
            <span key={i} className={`ml-1.5 font-bold ${series === 1 ? "text-[#161616]" : i === 0 ? "text-[#2f6fde]" : "text-[#c4521f]"}`}>
              {fmt(v, digits)}
            </span>
          ))}
          <span className="ml-0.5 text-[#9a958c]">{unit}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block h-[76px] w-full" preserveAspectRatio="none" role="img" aria-label={`${title} 그래프`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(lo)} y2={y(lo)} stroke="#efece6" />
        <line x1={pad.l} x2={W - pad.r} y1={y(hi)} y2={y(hi)} stroke="#efece6" />
        {refLine && <path d={path(refLine)} fill="none" stroke="#a8a296" strokeWidth={1.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        {Array.from({ length: series }, (_, k) => (
          <path key={k} d={path(mine.map((v) => v[k]))} fill="none" stroke={series === 1 ? "#161616" : k === 0 ? "#2f6fde" : "#e0662f"} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={x(cur)} x2={x(cur)} y1={pad.t - 4} y2={H - pad.b + 4} stroke="#0f8b6c" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-[#a8a296]">
        <span>
          {fmt(lo, digits)} ~ {fmt(hi, digits)}
          {unit}
        </span>
        {refLine && <span>점선 = 표준 체형</span>}
      </div>
    </figure>
  );
}

export function Summary({ res }: { res: LiteResult }) {
  const f = res.findings.filter((x) => x.cause !== "입력");
  const n = { risk: f.filter((x) => x.level === "risk").length, warn: f.filter((x) => x.level === "warn").length, info: f.filter((x) => x.level === "info").length };
  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="flex items-center gap-1 font-semibold">
        <i className="size-2 rounded-full bg-[#c8402a]" /> 위험 {n.risk}
      </span>
      <span className="flex items-center gap-1 font-semibold">
        <i className="size-2 rounded-full bg-[#d29a1e]" /> 주의 {n.warn}
      </span>
      <span className="flex items-center gap-1 font-semibold">
        <i className="size-2 rounded-full bg-[#8aa2ba]" /> 참고 {n.info}
      </span>
    </div>
  );
}

export { Label };

const RISK = {
  high: { label: "높음", bar: "#d9432b", tone: "risk" as const },
  moderate: { label: "주의", bar: "#d29a1e", tone: "warn" as const },
  low: { label: "낮음", bar: "#7fb69e", tone: "teal" as const },
};

export function Injury({ list, onSeek }: { list: RegionRisk[]; onSeek: (t: number) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = list.filter((r) => r.score > 0);
  const quiet = list.filter((r) => r.score === 0);
  return (
    <div>
      <ul className="divide-y divide-[#efece6] rounded-[6px] border border-[#e3dfd6] bg-white">
        {shown.map((r) => {
          const lv = RISK[r.level];
          const isOpen = open === r.region || (open === null && r === shown[0] && r.level !== "low");
          return (
            <li key={r.region}>
              <button onClick={() => setOpen(isOpen ? "" : r.region)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left" aria-expanded={isOpen}>
                <span className="w-[112px] shrink-0 text-[13px] font-semibold">
                  {r.name}
                  {r.side && r.side !== "both" && <span className="ml-1 text-[11px] text-[#9a958c]">{r.side === "L" ? "왼쪽" : "오른쪽"}</span>}
                </span>
                <span className="relative h-2 flex-1 rounded-full bg-[#efece6]">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(3, r.score)}%`, background: lv.bar }} />
                  <span className="absolute inset-y-[-3px] left-[30%] w-px bg-[#d9d4c9]" />
                  <span className="absolute inset-y-[-3px] left-[60%] w-px bg-[#d9d4c9]" />
                </span>
                <span className="w-7 text-right text-[13px] font-bold tabular-nums">{r.score}</span>
                <Tag tone={lv.tone}>{lv.label}</Tag>
              </button>
              {isOpen && (
                <div className="px-2.5 pb-2.5">
                  <ul className="space-y-0.5 text-[12px] text-[#4a4741]">
                    {r.factors.map((f) => (
                      <li key={f.label} className="flex justify-between gap-2">
                        <span>· {f.label}</span>
                        <span className="shrink-0 tabular-nums text-[#9a958c]">+{f.points}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[#6e6a63]">→ {r.advice}</p>
                  {r.t !== undefined && (
                    <button onClick={() => onSeek(r.t!)} className="mt-1 text-[11px] font-semibold text-[#6e6a63] underline decoration-[#c9c3b7] underline-offset-2 hover:text-[#161616]">
                      가장 위험한 순간({Math.round(r.t * 100)}%) 보기
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {quiet.length > 0 && <p className="mt-1.5 text-[11px] text-[#9a958c]">부담이 거의 없는 부위: {quiet.map((r) => r.name).join(", ")}</p>}
      <p className="mt-1 text-[11px] leading-relaxed text-[#9a958c]">보상 각도·관절 모멘트·충격·가동범위 끝 사용·좌우 차이를 더한 상대 지표입니다. 30 이상 주의, 60 이상 높음. 통증이 있다면 전문가와 상담하세요.</p>
    </div>
  );
}
