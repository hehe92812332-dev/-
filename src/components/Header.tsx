"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, RotateCcw, UserPlus } from "lucide-react";
import { SITE } from "@/lib/config";
import { balanceOf, useStore } from "@/lib/store";
import { Avatar, TokenAmount, UserLine } from "./ui";

export const NAV = [
  { href: "/qa", label: "환자 Q&A" },
  { href: "/clinical", label: "임상 토론" },
  { href: "/therapists", label: "치료사 찾기" },
  { href: "/lounge", label: "등급 라운지" },
  { href: "/tiers", label: "등급·토큰 안내" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight">
      <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M4 15c3-6 13-6 16 0" />
          <circle cx="12" cy="7" r="2.2" fill="currentColor" stroke="none" />
          <path d="M4 15v4M20 15v4" />
        </svg>
      </span>
      <span className="text-lg">{SITE.name}</span>
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  const { currentUser, users, switchUser, resetDemo, serverMode, me } = useStore();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                pathname.startsWith(n.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:text-ink"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2" ref={menuRef}>
          {currentUser && (
            <Link href="/wallet" className="hidden rounded-xl bg-amber-50 px-3 py-2 text-sm sm:block" title="내 지갑">
              <TokenAmount value={balanceOf(currentUser)} />
            </Link>
          )}
          {serverMode && !me && (
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="btn-primary !py-2">
              로그인
            </Link>
          )}
          {serverMode && me && (
            <div className="relative">
              <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white py-1 pl-1 pr-2 text-sm font-semibold hover:bg-slate-50"
                aria-expanded={open}
              >
                {currentUser ? <Avatar user={currentUser} size={30} /> : <span className="px-2">{me.name || "내 계정"}</span>}
                <ChevronDown className="size-4 text-slate-400" />
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl">
                  {currentUser && (
                    <Link href={`/users/${currentUser.id}`} className="block px-4 py-2.5 text-sm hover:bg-slate-50">
                      내 프로필
                    </Link>
                  )}
                  <Link href="/wallet" className="block px-4 py-2.5 text-sm hover:bg-slate-50">
                    내 지갑
                  </Link>
                  {currentUser?.therapist && (
                    <Link href="/signup/pending" className="block px-4 py-2.5 text-sm hover:bg-slate-50">
                      서류 심사 상태
                    </Link>
                  )}
                  {me.isAdmin && (
                    <Link href="/admin" className="block px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-slate-50">
                      관리자 콘솔
                    </Link>
                  )}
                  <Link href="/account" className="block px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-50">
                    회원 탈퇴
                  </Link>
                  <button
                    onClick={() => signOut({ redirectTo: "/" })}
                    className="block w-full border-t border-slate-100 px-4 py-2.5 text-left text-sm text-slate-500 hover:bg-slate-50"
                  >
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          )}
          <div className={`relative ${serverMode ? "hidden" : ""}`}>
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white py-1 pl-1 pr-2 text-sm font-semibold hover:bg-slate-50"
              aria-expanded={open}
            >
              {currentUser ? <Avatar user={currentUser} size={30} /> : <span className="px-2">로그인</span>}
              <ChevronDown className="size-4 text-slate-400" />
            </button>
            {open && !serverMode && (
              <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500">
                  데모 계정 전환 (실서비스에서는 로그인으로 대체)
                </div>
                <ul className="max-h-80 overflow-y-auto py-1">
                  {users.map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => switchUser(u.id)}
                        className={`w-full px-4 py-2.5 text-left hover:bg-slate-50 ${u.id === currentUser?.id ? "bg-brand-50/60" : ""}`}
                      >
                        <UserLine user={u} sub={`보유 ${balanceOf(u).toLocaleString()} 토큰`} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3">
                  <Link href="/signup" className="btn-ghost !py-2 text-xs">
                    <UserPlus className="size-4" /> 회원가입
                  </Link>
                  <button onClick={resetDemo} className="btn-ghost !py-2 text-xs">
                    <RotateCcw className="size-4" /> 데모 초기화
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {currentUser?.therapist && !currentUser.therapist.licenseVerified && (
        <Link href="/signup/pending" className="block bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-800">
          {currentUser.therapist.verification === "rejected"
            ? "서류 보완이 필요해요. 눌러서 확인하세요 →"
            : "서류 심사 중이에요. 심사가 끝나면 답변·임상 토론·라운지를 이용할 수 있어요."}
        </Link>
      )}
    </header>
  );
}
