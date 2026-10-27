"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { XCircle } from "lucide-react";

function Inner() {
  const p = useSearchParams();
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <XCircle className="mx-auto size-14 text-rose-500" />
      <h1 className="mt-4 text-2xl font-extrabold">결제가 진행되지 않았어요</h1>
      <p className="mt-2 text-sm text-slate-500">{p.get("message") ?? "결제를 취소했거나 오류가 발생했어요."}</p>
      <Link href="/wallet" className="btn-ghost mt-6">
        지갑으로 돌아가기
      </Link>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
