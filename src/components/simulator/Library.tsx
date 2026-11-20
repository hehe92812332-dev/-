"use client";

import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, MOVEMENTS } from "@/lib/biomech/moves";
import type { Category } from "@/lib/biomech/types";
import { Seg } from "./parts";

export function Library({ moveId, onPick }: { moveId: string; onPick: (id: string) => void }) {
  const current = MOVEMENTS.find((m) => m.id === moveId);
  const [cat, setCat] = useState<Category>(current?.category ?? "gym");
  const [q, setQ] = useState("");
  // 공유 링크·저장값으로 동작이 바뀌면 그 분류를 연다
  useEffect(() => {
    if (current) setCat(current.category);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? MOVEMENTS : MOVEMENTS.filter((m) => m.category === cat);
    return base.filter((m) => !s || m.name.toLowerCase().includes(s) || m.en.toLowerCase().includes(s) || m.group.includes(s));
  }, [cat, q]);
  const groups = useMemo(() => {
    const g = new Map<string, typeof list>();
    for (const m of list) g.set(m.group, [...(g.get(m.group) ?? []), m]);
    return [...g.entries()];
  }, [list]);
  return (
    <div>
      <Seg
        value={cat}
        onChange={(v) => {
          setCat(v);
          setQ("");
        }}
        size="sm"
        ariaLabel="동작 분류"
        options={CATEGORIES.map((c) => ({ value: c.id, label: c.id === "gym" ? "웨이트" : c.id === "sport" ? "스포츠" : "체대입시" }))}
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="동작 검색 (예: 스쿼트, jump)"
        aria-label="동작 검색"
        className="mt-2 w-full rounded-[6px] border border-[#d9d4c9] bg-white px-2.5 py-1.5 text-[13px] outline-none placeholder:text-[#a8a296] focus:border-[#161616]"
      />
      <p className="mt-1.5 text-[11px] text-[#8a857c]">{q ? `검색 결과 ${list.length}개` : CATEGORIES.find((c) => c.id === cat)?.desc}</p>
      <div className="mt-2 space-y-3">
        {groups.map(([g, ms]) => (
          <div key={g}>
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-[#9a958c]">{g}</div>
            <ul className="space-y-[2px]">
              {ms.map((m) => {
                const on = m.id === moveId;
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => onPick(m.id)}
                      className={`group flex w-full items-baseline justify-between gap-2 rounded-[5px] px-2 py-1.5 text-left transition-colors ${on ? "bg-[#161616] text-white" : "hover:bg-[#ebe8e1]"}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{m.name}</span>
                        <span className={`block truncate text-[11px] ${on ? "text-white/60" : "text-[#9a958c]"}`}>{m.en}</span>
                      </span>
                      <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${on ? "text-[#57d1a8]" : "text-[#b3ada2]"}`}>{m.kind === "dynamic" ? "동적" : m.load ? m.load.label : "맨몸"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {!list.length && <p className="text-[13px] text-[#8a857c]">찾는 동작이 없습니다. 다른 이름으로 검색해 보세요.</p>}
      </div>
    </div>
  );
}
