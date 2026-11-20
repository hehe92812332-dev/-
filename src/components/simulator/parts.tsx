"use client";

import { useEffect, useState, type ReactNode } from "react";

export const ink = {
  bg: "#f2f0eb",
  panel: "#fbfaf7",
  line: "#e3dfd6",
  text: "#161616",
  muted: "#6e6a63",
  faint: "#9a958c",
  risk: "#c8402a",
  warn: "#b07a0c",
  info: "#46698c",
  teal: "#0f8b6c",
  left: "#2f6fde",
  right: "#e0662f",
};

export function Label({ n, children, right }: { n?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[#e3dfd6] pb-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6a63]">
        {n && <span className="mr-1.5 tabular-nums text-[#b3ada2]">{n}</span>}
        {children}
      </h3>
      {right}
    </div>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex rounded-[6px] border border-[#d9d4c9] bg-[#f5f3ee] p-[2px]">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[4px] font-semibold transition-colors ${size === "sm" ? "px-2 py-[3px] text-[12px]" : "px-3 py-1.5 text-[13px]"} ${
            value === o.value ? "bg-[#161616] text-white" : "text-[#4a4741] hover:text-[#161616]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-1.5 rounded-[5px] border px-2 py-1 text-[12px] font-semibold transition-colors ${
        on ? "border-[#161616] bg-[#161616] text-white" : "border-[#d9d4c9] bg-white text-[#4a4741] hover:border-[#9a958c]"
      }`}
    >
      <span className={`size-1.5 rounded-full ${on ? "bg-[#57d1a8]" : "bg-[#c9c3b7]"}`} />
      {children}
    </button>
  );
}

export function Btn({ children, onClick, title, kind = "line" }: { children: ReactNode; onClick?: () => void; title?: string; kind?: "line" | "solid" }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[13px] font-semibold transition-colors ${
        kind === "solid" ? "bg-[#161616] text-white hover:bg-[#2b2a27]" : "border border-[#d9d4c9] bg-white text-[#2b2a27] hover:border-[#9a958c]"
      }`}
    >
      {children}
    </button>
  );
}

/** 숫자 입력 + 슬라이더. 표준값 눈금 표시 */
export function Field({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit,
  std,
  onChange,
  digits = 0,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  std?: number;
  onChange: (v: number) => void;
  digits?: number;
}) {
  const [text, setText] = useState(fmt(value, digits));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(fmt(value, digits));
  }, [value, digits, focus]);
  const pct = ((value - min) / (max - min)) * 100;
  const stdPct = std !== undefined ? ((std - min) / (max - min)) * 100 : null;
  const diff = std !== undefined ? value - std : 0;
  const commit = (s: string) => {
    const v = Number(s.replace(",", "."));
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    else setText(fmt(value, digits));
  };
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-2">
        <label className="min-w-0 text-[13px] font-semibold text-[#2b2a27]">
          {label}
          {std !== undefined && Math.abs(diff) >= step * 0.5 && (
            <span className={`ml-1.5 text-[11px] font-semibold tabular-nums ${Math.abs(diff) / (max - min) > 0.06 ? "text-[#b07a0c]" : "text-[#9a958c]"}`}>
              표준 {diff > 0 ? "+" : "−"}
              {fmt(Math.abs(diff), digits)}
            </span>
          )}
        </label>
        <div className="flex items-center rounded-[5px] border border-[#d9d4c9] bg-white focus-within:border-[#161616]">
          <input
            inputMode="decimal"
            aria-label={label}
            value={text}
            onFocus={() => setFocus(true)}
            onBlur={(e) => {
              setFocus(false);
              commit(e.target.value);
            }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-[52px] bg-transparent py-1 pl-2 text-right text-[13px] font-semibold tabular-nums outline-none"
          />
          <span className="pr-2 pl-1 text-[11px] text-[#9a958c]">{unit}</span>
        </div>
      </div>
      <div className="relative mt-1.5 h-4">
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-[#e3dfd6]" />
        <div className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-[#161616]" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        {stdPct !== null && (
          <div className="absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 bg-[#0f8b6c]" style={{ left: `${Math.min(100, Math.max(0, stdPct))}%` }} title="표준 비율" />
        )}
        <input
          type="range"
          aria-label={`${label} 슬라이더`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="sim-range absolute inset-0 w-full"
        />
      </div>
      {hint && <p className="mt-1 text-[11px] leading-[1.45] text-[#8a857c]">{hint}</p>}
    </div>
  );
}

export function fmt(v: number, digits = 0) {
  if (!Number.isFinite(v)) return "–";
  if (Math.abs(v) < 0.5 * 10 ** -digits) v = 0;
  return v.toFixed(digits);
}

export function Tag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "risk" | "warn" | "info" | "teal" }) {
  const c = {
    plain: "border-[#d9d4c9] text-[#6e6a63]",
    risk: "border-[#c8402a]/40 text-[#c8402a]",
    warn: "border-[#b07a0c]/40 text-[#9a6a08]",
    info: "border-[#46698c]/35 text-[#46698c]",
    teal: "border-[#0f8b6c]/35 text-[#0f8b6c]",
  }[tone];
  return <span className={`inline-flex items-center rounded-[3px] border px-1.5 py-[1px] text-[11px] font-semibold ${c}`}>{children}</span>;
}
