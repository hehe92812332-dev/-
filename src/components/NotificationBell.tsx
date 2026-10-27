"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useStore } from "@/lib/store";
import { timeAgo } from "./ui";

interface Item {
  id: string;
  title: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/** 알림 (서버 모드): 답변 도착, 채택, 1:1 질문, 심사 결과, 입금 등 */
export function NotificationBell() {
  const { unread, setUnread, me } = useStore();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!me || me.needsOnboarding) return null;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const r = await fetch("/api/notifications").then((x) => x.json());
    setItems(r.items ?? []);
    if (unread > 0) {
      await fetch("/api/notifications", { method: "POST" });
      setUnread(0);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} aria-label={`알림 ${unread}개`} className="relative rounded-xl p-2 text-slate-600 hover:bg-slate-100">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-bold">알림</div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null && <li className="px-4 py-6 text-center text-sm text-slate-400">불러오는 중…</li>}
            {items?.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">새 알림이 없어요.</li>}
            {items?.map((n) => (
              <li key={n.id} className={n.read ? "" : "bg-brand-50/50"}>
                <Link href={n.link ?? "#"} onClick={() => setOpen(false)} className="block px-4 py-3 text-sm hover:bg-slate-50">
                  <div className="leading-snug">{n.title}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
