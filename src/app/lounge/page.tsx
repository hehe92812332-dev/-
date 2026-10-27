"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Megaphone, Send, Users } from "lucide-react";
import { ReportMenu } from "@/components/ReportMenu";
import { Avatar, GemIcon, Notice, TempChip } from "@/components/ui";
import { TIERS } from "@/lib/config";
import { userTier, useStore } from "@/lib/store";
import { gradeLabel } from "@/lib/tier";

function clock(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} ${time}`;
}

export default function LoungePage() {
  const { currentUser, users, chats, getUser, sendChat, pollChats, blocks } = useStore();
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [asStudy, setAsStudy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const tier = currentUser ? userTier(currentUser) : undefined;
  const messages = useMemo(() => (tier ? chats.filter((c) => c.room === tier.id) : []), [chats, tier]);
  const members = tier ? users.filter((u) => userTier(u)?.id === tier.id) : [];
  const blockedIds = new Set(blocks.filter((b) => b.userId === currentUser?.id).map((b) => b.blockedId));
  const study = [...messages].reverse().find((m) => m.kind === "study" && !blockedIds.has(m.authorId));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // 서버 모드: 3초마다 새 메시지 확인 (화면이 보일 때만)
  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === "visible" && pollChats(), 3000);
    return () => clearInterval(timer);
  }, [pollChats]);

  if (!currentUser || !tier)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <div className="flex -space-x-2">
            {[...TIERS].reverse().slice(0, 5).map((t) => (
              <span key={t.id} className="grid size-11 place-items-center rounded-full bg-white ring-2 ring-white">
                <GemIcon tier={t.id} className="size-7" />
              </span>
            ))}
          </div>
          <h1 className="mt-5 text-xl font-extrabold">등급 라운지는 치료사 회원 전용이에요</h1>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            같은 보석 등급의 치료사끼리 케이스를 나누고 함께 공부하는 채팅방입니다. 면허 인증 후 내 등급 라운지에 입장할 수 있어요.
          </p>
          <Link href="/signup?role=therapist" className="btn-primary mt-6">
            치료사로 가입하기
          </Link>
        </div>
      </div>
    );

  const send = async () => {
    if (sending) return;
    setSending(true);
    const r = await sendChat(draft, asStudy ? "study" : "text");
    setSending(false);
    if (!r.ok) return setError(r.error);
    setDraft("");
    setAsStudy(false);
    setError(null);
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 md:h-[calc(100dvh-4rem)] md:grid-cols-[260px_1fr] md:py-6">
      {/* 사이드바 */}
      <aside className="hidden flex-col gap-4 overflow-y-auto md:flex">
        <div className="card p-5" style={{ background: `linear-gradient(135deg, ${tier.colors[0]}2e, #fff)` }}>
          <GemIcon tier={tier.id} className="size-10" />
          <div className="mt-3 text-xs font-semibold text-slate-500">{gradeLabel(tier)}</div>
          <div className="text-lg font-extrabold" style={{ color: tier.text }}>
            {tier.name} 라운지
          </div>
          <p className="mt-1 text-xs text-slate-500">같은 등급 치료사끼리 의견을 나누고 함께 공부하는 공간이에요.</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-sm font-bold">
            <Users className="size-4" /> 멤버 {members.length}
          </div>
          <ul className="mt-3 space-y-2.5">
            {members.map((m) => (
              <li key={m.id}>
                <Link href={`/users/${m.id}`} className="flex items-center gap-2 hover:opacity-80">
                  <Avatar user={m} size={28} />
                  <span className="flex-1 truncate text-sm font-semibold">
                    {m.name}
                    {m.id === currentUser.id && <span className="ml-1 text-xs font-medium text-slate-400">(나)</span>}
                  </span>
                  <TempChip userId={m.id} />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-4">
          <div className="text-sm font-bold">다른 라운지</div>
          <ul className="mt-3 space-y-2">
            {[...TIERS].reverse().filter((t) => t.id !== tier.id).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm text-slate-400">
                <GemIcon tier={t.id} className="size-4 opacity-60" />
                <span className="flex-1">{t.name}</span>
                <Lock className="size-3.5" />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">등급이 오르면 새 라운지가 열려요.</p>
        </div>
      </aside>

      {/* 채팅 */}
      <section className="card flex h-[calc(100dvh-4rem-6rem)] min-h-0 flex-col overflow-hidden md:h-auto">
        <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <GemIcon tier={tier.id} className="size-7" />
          <div className="min-w-0 flex-1">
            <div className="font-extrabold" style={{ color: tier.text }}>
              {tier.name} 라운지
            </div>
            <div className="truncate text-xs text-slate-500">
              {gradeLabel(tier)} 치료사 {members.length}명 · {members.map((m) => m.name).join(", ")}
            </div>
          </div>
        </header>

        {study && (
          <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-sm">
            <Megaphone className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-amber-700">스터디 공지 · {getUser(study.authorId)?.name}</div>
              <p className="line-clamp-2 text-slate-700">{study.body}</p>
            </div>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4">
          {messages.length === 0 && (
            <div className="py-16 text-center text-sm text-slate-500">
              아직 대화가 없어요. 첫 메시지로 스터디 주제를 제안해 보세요!
            </div>
          )}
          {messages.map((m, i) => {
            const author = getUser(m.authorId);
            const mine = m.authorId === currentUser.id;
            const grouped = i > 0 && messages[i - 1].authorId === m.authorId && messages[i - 1].kind === "text" && m.kind === "text";
            if (!author) return null;
            return (
              <div key={m.id} className={`flex gap-2 ${mine ? "flex-row-reverse" : ""} ${grouped ? "!mt-1" : ""}`}>
                {!mine && <div className="w-8 shrink-0">{!grouped && <Avatar user={author} size={32} />}</div>}
                <div className={`flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  {!mine && !grouped && (
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      {author.name} <TempChip userId={author.id} />
                    </div>
                  )}
                  <div className={`group flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                    <div
                      className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        m.kind === "study"
                          ? "border border-amber-200 bg-amber-50 text-slate-800"
                          : mine
                            ? "bg-brand-600 text-white"
                            : "bg-white text-slate-800 ring-1 ring-slate-200"
                      }`}
                    >
                      {m.kind === "study" && (
                        <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-amber-700">
                          <Megaphone className="size-3" /> 스터디 공지
                        </div>
                      )}
                      {blockedIds.has(m.authorId) ? <span className="text-slate-400">차단한 회원의 메시지입니다.</span> : m.body}
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-400">{clock(m.createdAt)}</span>
                    {!mine && (
                      <ReportMenu
                        targetType="chat"
                        targetId={m.id}
                        authorId={author.id}
                        authorName={author.name}
                        onMessage={(tone, text) => setError(tone === "error" ? text : null)}
                        className="opacity-0 transition group-hover:opacity-100 max-md:opacity-100"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-slate-100 p-3">
          {error && (
            <div className="mb-2">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={asStudy ? "스터디 주제·일정을 공지하세요" : "메시지 입력 (Shift+Enter 줄바꿈)"}
              className="input max-h-32 min-h-[44px] resize-none"
            />
            <button onClick={send} disabled={!draft.trim()} className="btn-primary h-11 shrink-0 !px-3.5" aria-label="보내기">
              <Send className="size-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <label className="flex items-center gap-1.5 font-semibold text-slate-600">
              <input type="checkbox" className="size-3.5 accent-amber-500" checked={asStudy} onChange={(e) => setAsStudy(e.target.checked)} />
              📚 스터디 공지로 올리기
            </label>
            <span className="text-right">환자 이름·연락처·사진 등 개인정보는 공유하지 마세요.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
