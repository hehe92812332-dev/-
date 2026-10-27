"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gem, Home, MessageCircleQuestion, Newspaper, Stethoscope, Users, Wallet } from "lucide-react";
import { userTier, useStore } from "@/lib/store";

// 환자·비회원: 건강 소식과 치료사 찾기 / 치료사: 임상 토론과 등급 라운지
const PATIENT_TABS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/qa", label: "Q&A", icon: MessageCircleQuestion },
  { href: "/news", label: "건강소식", icon: Newspaper },
  { href: "/therapists", label: "치료사", icon: Users },
  { href: "/wallet", label: "지갑", icon: Wallet },
];
const THERAPIST_TABS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/qa", label: "Q&A", icon: MessageCircleQuestion },
  { href: "/clinical", label: "임상토론", icon: Stethoscope },
  { href: "/lounge", label: "라운지", icon: Gem },
  { href: "/wallet", label: "지갑", icon: Wallet },
];

export function MobileNav() {
  const pathname = usePathname();
  const { currentUser } = useStore();
  const tabs = currentUser && userTier(currentUser) ? THERAPIST_TABS : PATIENT_TABS;
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
