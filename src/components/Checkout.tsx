"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Lock, X } from "lucide-react";
import { PAYMENT_METHODS, REVOKE_DAYS, type PaymentMethodId } from "@/lib/config";

const METHOD_STYLE: Record<PaymentMethodId, string> = {
  card: "bg-slate-800 text-white",
  kakaopay: "bg-[#FEE500] text-[#191919]",
  naverpay: "bg-[#03C75A] text-white",
  tosspay: "bg-[#0064FF] text-white",
  phone: "bg-slate-200 text-slate-700",
};

export interface CheckoutItem {
  title: string;
  lines: [string, string][];
  price: number;
  recurring?: boolean;
}

/**
 * 결제 시트. 실서비스에서는 onPay 안에서 PG(토스페이먼츠·포트원 등) 결제창을 띄우고,
 * 서버에서 결제 승인·검증이 끝난 뒤에 토큰을 지급해야 합니다.
 */
export function Checkout({
  item,
  onClose,
  onPay,
}: {
  item: CheckoutItem | null;
  onClose: () => void;
  onPay: (method: PaymentMethodId) => { ok: boolean; error?: string };
}) {
  const [method, setMethod] = useState<PaymentMethodId>("card");
  const [agree, setAgree] = useState(false);
  const [phase, setPhase] = useState<"form" | "paying" | "done">("form");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setPhase("form");
      setAgree(false);
      setError(null);
    }
  }, [item]);

  if (!item) return null;

  const pay = () => {
    setPhase("paying");
    setTimeout(() => {
      const r = onPay(method);
      if (r.ok) setPhase("done");
      else {
        setError(r.error ?? "결제에 실패했습니다.");
        setPhase("form");
      }
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === "done" ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto size-14 text-brand-500" />
            <h2 className="mt-4 text-xl font-extrabold">결제가 완료되었어요</h2>
            <p className="mt-2 text-sm text-slate-500">{item.title}</p>
            <button onClick={onClose} className="btn-primary mt-6 w-full">
              확인
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold">결제하기</h2>
              <button onClick={onClose} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">
              <div className="font-bold">{item.title}</div>
              {item.lines.map(([k, v]) => (
                <div key={k} className="mt-1.5 flex justify-between text-slate-500">
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-extrabold">
                <span>결제 금액</span>
                <span>
                  {item.price.toLocaleString()}원{item.recurring && <span className="text-xs font-semibold text-slate-400"> / 월</span>}
                </span>
              </div>
            </div>

            <div className="mt-5 text-sm font-semibold">결제 수단</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm font-semibold transition ${
                    method === m.id ? "border-brand-500" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <span className={`grid size-6 place-items-center rounded-md text-[10px] font-black ${METHOD_STYLE[m.id]}`}>
                    {m.label.slice(0, 1)}
                  </span>
                  {m.label}
                </button>
              ))}
            </div>

            <label className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                주문 내용을 확인했으며 결제에 동의합니다.
                {item.recurring
                  ? " 매월 같은 날 자동 결제되며, 언제든 자동 갱신을 해지할 수 있습니다."
                  : ` 사용하지 않은 충전 토큰은 ${REVOKE_DAYS}일 이내 결제 취소할 수 있으며, 보너스 토큰은 환불되지 않습니다.`}
              </span>
            </label>

            {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}

            <button onClick={pay} disabled={!agree || phase === "paying"} className="btn-primary mt-5 w-full !py-3.5 text-base">
              {phase === "paying" ? <Loader2 className="size-5 animate-spin" /> : <Lock className="size-4" />}
              {phase === "paying" ? "결제 진행 중…" : `${item.price.toLocaleString()}원 결제하기`}
            </button>
            <p className="mt-3 text-center text-[11px] text-slate-400">데모 버전 — 실제 결제는 이루어지지 않습니다.</p>
          </>
        )}
      </div>
    </div>
  );
}
