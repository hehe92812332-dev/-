"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useStore } from "@/lib/store";

/** 결제창에서 돌아온 뒤 서버 승인을 한 번만 요청하고 결과를 보여줍니다 */
export function PaymentReturn({ request, successText }: { request: () => Promise<{ ok: boolean; error?: string }>; successText: string }) {
  const { refresh } = useStore();
  const [state, setState] = useState<{ phase: "loading" | "done" | "error"; error?: string }>({ phase: "loading" });
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    request().then(async (r) => {
      if (r.ok) await refresh();
      setState(r.ok ? { phase: "done" } : { phase: "error", error: r.error });
    });
  }, [request, refresh]);

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      {state.phase === "loading" && (
        <>
          <Loader2 className="mx-auto size-12 animate-spin text-brand-600" />
          <p className="mt-4 font-semibold">결제를 확인하고 있어요…</p>
          <p className="mt-1 text-sm text-slate-500">창을 닫지 말고 잠시만 기다려 주세요.</p>
        </>
      )}
      {state.phase === "done" && (
        <>
          <CheckCircle2 className="mx-auto size-14 text-brand-500" />
          <h1 className="mt-4 text-2xl font-extrabold">결제가 완료되었어요</h1>
          <p className="mt-2 text-sm text-slate-500">{successText}</p>
          <Link href="/wallet" className="btn-primary mt-6">
            내 지갑으로
          </Link>
        </>
      )}
      {state.phase === "error" && (
        <>
          <XCircle className="mx-auto size-14 text-rose-500" />
          <h1 className="mt-4 text-2xl font-extrabold">결제를 완료하지 못했어요</h1>
          <p className="mt-2 text-sm text-slate-500">{state.error}</p>
          <Link href="/wallet" className="btn-ghost mt-6">
            지갑으로 돌아가기
          </Link>
        </>
      )}
    </div>
  );
}

export const postJson = async (url: string, body: unknown) => {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "네트워크 오류가 발생했어요. 지갑에서 충전 내역을 확인해 주세요." };
  }
};
