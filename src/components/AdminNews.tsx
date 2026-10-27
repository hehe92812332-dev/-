"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CalendarX2 } from "lucide-react";
import { ARTICLE_REWARD_TOKENS } from "@/lib/config";
import type { Article, ArticleSummary } from "@/lib/news";
import { Notice } from "./ui";

interface NewsAdmin {
  today: string;
  queue: Article[];
  schedule: ArticleSummary[];
  gaps: string[];
  nextFree: string;
}

const day = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}(${"일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
};

/** 관리자 콘솔 · 건강 소식: 원고 검수와 게시 일정 */
export function AdminNews({ onCount }: { onCount?: (n: number) => void }) {
  const [data, setData] = useState<NewsAdmin | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/news");
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setData(j);
      onCount?.(j.queue.length);
    } else setMsg({ tone: "error", text: j.error ?? "불러오지 못했어요." });
  }, [onCount]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (body: object, success: string) => {
    const r = await fetch("/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, error: "오류" }));
    setMsg(j.ok ? { tone: "success", text: success + (j.publishOn ? ` (${j.publishOn} 게시)` : "") } : { tone: "error", text: j.error });
    if (j.ok) load();
  };
  const ask = (label: string) => {
    const v = prompt(label);
    return v && v.trim().length >= 2 ? v.trim() : null;
  };

  if (!data) return <p className="mt-10 text-center text-sm text-slate-400">불러오는 중…</p>;
  const byDay = new Map(data.schedule.map((a) => [a.publishOn!, a]));

  return (
    <div className="space-y-6">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <section className="card p-5">
        <h3 className="flex items-center gap-2 font-bold">
          <CalendarClock className="size-4" /> 앞으로 14일 게시 일정
        </h3>
        {data.gaps.length > 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-600">
            <CalendarX2 className="size-4" /> 비어 있는 날 {data.gaps.length}일 — 그날은 지난 글이 계속 &lsquo;오늘의 건강 정보&rsquo;로 보여요.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">14일 동안 매일 게시글이 예약되어 있어요.</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 14 }, (_, i) => {
            const d = new Date(Date.parse(data.today + "T00:00:00Z") + i * 86400_000).toISOString().slice(0, 10);
            const a = byDay.get(d);
            return (
              <div key={d} className={`rounded-xl p-2.5 text-xs ${a ? "bg-brand-50" : "bg-rose-50 ring-1 ring-rose-200"}`}>
                <div className="font-bold text-slate-500">{day(d)}{i === 0 && " · 오늘"}</div>
                {a ? (
                  <Link href={`/news/${a.slug}`} className="mt-1 line-clamp-2 font-semibold text-ink hover:underline">{a.title}</Link>
                ) : (
                  <div className="mt-1 font-semibold text-rose-600">비어 있음</div>
                )}
                {a && (
                  <button
                    className="mt-1.5 text-[11px] text-slate-400 underline"
                    onClick={() => {
                      const to = prompt("새 게시일 (YYYY-MM-DD)", d);
                      if (to) act({ action: "articleReschedule", articleId: a.id, publishOn: to }, "게시일을 바꿨어요.");
                    }}
                  >
                    날짜 변경
                  </button>
                )}
                {a && (
                  <button
                    className="ml-2 mt-1.5 text-[11px] text-rose-400 underline"
                    onClick={() => {
                      const reason = ask("게시 중단 사유");
                      if (reason) act({ action: "articleArchive", articleId: a.id, reason }, "게시를 중단했어요.");
                    }}
                  >
                    내리기
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="font-bold">검수 대기 원고 {data.queue.length}건</h3>
        <p className="mt-1 text-sm text-slate-500">
          의학적 정확성, 병원에 가야 하는 신호 누락, 과장·홍보 표현을 확인해 주세요. 치료사 원고를 승인하면 원고료 {ARTICLE_REWARD_TOKENS}토큰이 지급돼요.
        </p>
        <div className="mt-3 space-y-3">
          {data.queue.length === 0 && <p className="card p-6 text-center text-sm text-slate-400">검수할 원고가 없어요.</p>}
          {data.queue.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="chip">{a.category}</span>
                <span className="chip">{a.bodyPart}</span>
                <span>{a.authorName}</span>
                <span>{new Date(a.createdAt).toLocaleDateString("ko-KR")}</span>
              </div>
              <h4 className="mt-2 font-bold">{a.title}</h4>
              <p className="mt-1 text-sm text-slate-600">{a.summary}</p>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-slate-500">본문 보기</summary>
                <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-4 text-slate-700">
                  <div><b>원인</b><ul className="ml-4 list-disc">{a.causes.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  <div>
                    <b>운동</b>
                    {a.exercises.map((e) => (
                      <div key={e.name} className="ml-2 mt-1">
                        · {e.name} ({e.dose}) — {e.how.join(" → ")}
                        {e.caution && <span className="text-amber-700"> / 주의: {e.caution}</span>}
                      </div>
                    ))}
                  </div>
                  <div><b>병원에 가야 할 신호</b><ul className="ml-4 list-disc">{a.redFlags.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  {a.emergency && <div className="text-rose-700"><b>119</b><ul className="ml-4 list-disc">{a.emergency.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                  {a.tips.length > 0 && <div><b>생활 수칙</b><ul className="ml-4 list-disc">{a.tips.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                </div>
              </details>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  className="input !w-auto !py-2 text-xs"
                  min={data.today}
                  value={dates[a.id] ?? data.nextFree}
                  onChange={(e) => setDates((d) => ({ ...d, [a.id]: e.target.value }))}
                />
                <button className="btn-primary !py-2 text-xs" onClick={() => act({ action: "articleApprove", articleId: a.id, publishOn: dates[a.id] ?? data.nextFree }, "승인했어요.")}>
                  승인하고 예약
                </button>
                <button
                  className="btn-ghost !py-2 text-xs text-rose-600"
                  onClick={() => {
                    const reason = ask("보완 요청 사유 (작성자에게 전달돼요)");
                    if (reason) act({ action: "articleReject", articleId: a.id, reason }, "보완을 요청했어요.");
                  }}
                >
                  보완 요청
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
