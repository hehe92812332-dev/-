"use client";

import { useId } from "react";
import { Coins, ShieldCheck } from "lucide-react";
import type { TierId } from "@/lib/config";
import { getTier } from "@/lib/tier";
import { temperatureOf, temperatureStyle, visibleRatings } from "@/lib/manner";
import { userTier, useStore } from "@/lib/store";
import type { User } from "@/lib/types";

/** 등급별 보석 아이콘. 진주는 구슬, 원석은 다듬어지지 않은 돌 모양 */
export function GemIcon({ tier, className = "size-3.5" }: { tier: TierId; className?: string }) {
  const t = getTier(tier);
  // 인스턴스마다 고유 id — 같은 id가 숨겨진(display:none) 요소 안에 먼저 있으면 그라데이션이 렌더링되지 않습니다
  const id = `gem-${t.id}-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.colors[0]} />
          <stop offset="1" stopColor={t.colors[1]} />
        </linearGradient>
      </defs>
      {t.id === "pearl" ? (
        <>
          <circle cx="12" cy="12" r="9" fill={`url(#${id})`} />
          <circle cx="9" cy="8.5" r="2.6" fill="#fff" opacity=".7" />
        </>
      ) : t.id === "rough" ? (
        <path d="M5 9l5-5 7 2 3 7-4 7-8-1-4-5z" fill={`url(#${id})`} />
      ) : (
        <>
          <path d="M7 3h10l5 6-10 12L2 9z" fill={`url(#${id})`} />
          <path d="M2 9h20M7 3l5 18M17 3l-5 18M7 3l2 6M17 3l-2 6" stroke="#fff" strokeOpacity=".45" strokeWidth="1" fill="none" />
        </>
      )}
    </svg>
  );
}

export function TierBadge({ tier, size = "sm", showGrade }: { tier: TierId; size?: "sm" | "md"; showGrade?: boolean }) {
  const t = getTier(tier);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold ring-1 ring-inset ${
        size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"
      }`}
      style={{ color: t.text, backgroundColor: `${t.colors[0]}26`, ["--tw-ring-color" as string]: `${t.colors[0]}66` }}
    >
      <GemIcon tier={tier} className={size === "md" ? "size-4" : "size-3.5"} />
      {(showGrade ?? size === "md") && t.grade && <span className="opacity-70">{t.grade}등급</span>}
      {t.name}
    </span>
  );
}

export function TokenAmount({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-bold tabular-nums text-amber-600 ${className}`}>
      <Coins className="size-4" />
      {value.toLocaleString()}
    </span>
  );
}

export function Avatar({ user, size = 36 }: { user: User; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, backgroundColor: user.avatarColor, fontSize: size * 0.4 }}
    >
      {user.name.slice(0, 1)}
    </span>
  );
}

/** 만족도 온도 칩 — 이름 옆에 작게 */
export function TempChip({ userId }: { userId: string }) {
  const { ratings } = useStore();
  const temp = temperatureOf(ratings, userId);
  const { color, face } = temperatureStyle(temp);
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums" style={{ color }} title="만족도 온도">
      {temp.toFixed(1)}°C <span aria-hidden>{face}</span>
    </span>
  );
}

/** 만족도 온도 게이지 (당근 매너온도 방식) */
export function TempGauge({ userId, size = "sm" }: { userId: string; size?: "sm" | "lg" }) {
  const { ratings } = useStore();
  const temp = temperatureOf(ratings, userId);
  const { color, face } = temperatureStyle(temp);
  const count = visibleRatings(ratings, userId).length;
  return (
    <div>
      <div className="flex items-end justify-between">
        <span className={`font-semibold text-slate-500 underline decoration-dotted underline-offset-4 ${size === "lg" ? "text-sm" : "text-xs"}`}>
          만족도 온도
        </span>
        <span className={`flex items-center gap-1 font-extrabold tabular-nums ${size === "lg" ? "text-2xl" : "text-base"}`} style={{ color }}>
          {temp.toFixed(1)}°C <span className={size === "lg" ? "text-3xl" : "text-lg"}>{face}</span>
        </span>
      </div>
      <div className={`mt-1.5 overflow-hidden rounded-full bg-slate-100 ${size === "lg" ? "h-2.5" : "h-1.5"}`}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, temp)}%`, backgroundColor: color }} />
      </div>
      <div className="mt-1 text-right text-[11px] text-slate-400">받은 평가 {count}개 · 첫 온도 36.5°C</div>
    </div>
  );
}

export function UserLine({ user, sub }: { user: User; sub?: string }) {
  const tier = userTier(user);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar user={user} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          {user.name}
          {user.role === "therapist" ? (
            <>
              <span className="text-xs font-medium text-slate-500">물리치료사</span>
              {user.therapist?.licenseVerified && <ShieldCheck className="size-3.5 text-brand-600" aria-label="면허 인증" />}
              {tier && <TierBadge tier={tier.id} />}
            </>
          ) : (
            <span className="text-xs font-medium text-slate-500">환자 회원</span>
          )}
          <TempChip userId={user.id} />
        </div>
        {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "bg-sky-50 text-sky-800 border-sky-100",
    error: "bg-rose-50 text-rose-700 border-rose-100",
    success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  }[tone];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}
