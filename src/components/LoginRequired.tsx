"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import { Notice } from "./ui";

export function LoginRequired({ what }: { what: string }) {
  const { serverMode } = useStore();
  const pathname = usePathname();
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {serverMode ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <p className="text-sm text-slate-600">{what} 로그인이 필요해요.</p>
          <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="btn-primary mt-4">
            로그인
          </Link>
        </div>
      ) : (
        <Notice>{what} 로그인(우측 상단 데모 계정 선택)이 필요합니다.</Notice>
      )}
    </div>
  );
}
