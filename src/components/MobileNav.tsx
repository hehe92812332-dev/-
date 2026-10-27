"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gem, Home, MessageCircleQuestion, Stethoscope, Users, Wallet } from "lucide-react";
import { useStore } from "@/lib/store";

const TABS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/qa", label: "Q&A", icon: MessageCircleQuestion },
  { href: "/clinical", label: "임상토론", icon: Stethoscope },
  { href: "/therapists", label: "치료사", icon: Users },
  { href: "/wallet", label: "지갑", icon: Wallet },
];

export function MobileNav() {
  const pathname = usePathname();
  const { currentUser } = useStore();
  // 치료사는 '치료사 찾기' 대신 등급 라운지를 탭에 둡니다
  const tabs = currentUser?.role === "therapist" ? TABS.map((t) => (t.href === "/therapists" ? { href: "/lounge", label: "라운지", icon: Gem } : t)) : TABS;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${
                  active ? "text-brand-600" : "text-slate-400"
                }`}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
