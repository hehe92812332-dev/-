"use client";

// 서버 모드 결제 흐름 (브라우저 쪽)
// 1) 서버에 주문 생성 → 2) 토스페이먼츠 결제창 → 3) /payments/success 에서 서버 승인 → 토큰 지급
// 개발용 mock 결제사는 결제창 없이 바로 승인합니다.

import type { MembershipPlanId, PaymentMethodId } from "./config";
import type { User } from "./types";

type Result = { ok: true; id?: string } | { ok: false; error: string };

interface Prepared {
  ok: boolean;
  error?: string;
  orderId: string;
  amount: number;
  orderName: string;
  provider: "toss" | "mock";
  clientKey: string | null;
  customerKey: string;
}

const post = async <T,>(url: string, body: unknown): Promise<T> => {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as T;
  } catch {
    return { ok: false, error: "네트워크 오류가 발생했어요." } as T;
  }
};

const EASY_PAY: Partial<Record<PaymentMethodId, string>> = { kakaopay: "KAKAOPAY", naverpay: "NAVERPAY", tosspay: "TOSSPAY" };

async function sdk(clientKey: string, customerKey: string) {
  const { loadTossPayments } = await import("@tosspayments/tosspayments-sdk");
  const toss = await loadTossPayments(clientKey);
  return toss.payment({ customerKey });
}

export async function startTokenPayment(packageId: string, method: PaymentMethodId, refresh: () => Promise<void>): Promise<Result> {
  const order = await post<Prepared>("/api/payments/prepare", { packageId, method });
  if (!order.ok) return { ok: false, error: order.error ?? "주문을 만들지 못했어요." };

  if (order.provider === "mock") {
    const r = await post<Result>("/api/payments/confirm", { orderId: order.orderId, paymentKey: `mock_${order.orderId}`, amount: order.amount });
    if (r.ok) await refresh();
    return r;
  }

  if (!order.clientKey) return { ok: false, error: "결제 설정(NEXT_PUBLIC_TOSS_CLIENT_KEY)이 없습니다." };
  const payment = await sdk(order.clientKey, order.customerKey);
  const origin = window.location.origin;
  const common = {
    amount: { currency: "KRW" as const, value: order.amount },
    orderId: order.orderId,
    orderName: order.orderName,
    successUrl: `${origin}/payments/success`,
    failUrl: `${origin}/payments/fail`,
  };
  try {
    // 결제창으로 이동한 뒤 successUrl/failUrl 로 돌아옵니다
    if (method === "phone") await payment.requestPayment({ ...common, method: "MOBILE_PHONE" });
    else
      await payment.requestPayment({
        ...common,
        method: "CARD",
        card: EASY_PAY[method] ? ({ flowMode: "DIRECT", easyPay: EASY_PAY[method] } as never) : undefined,
      });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "결제를 취소했어요." };
  }
}

/** 멤버십: 카드 등록(빌링 인증) → /payments/billing 에서 첫 결제 */
export async function startBillingAuth(plan: MembershipPlanId, user: User | null, refresh: () => Promise<void>): Promise<Result> {
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const customerKey = `ck_${user.id}`;
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  if (!clientKey) {
    const r = await post<Result>("/api/billing/issue", { authKey: "mock_auth", customerKey, planId: plan });
    if (r.ok) await refresh();
    return r;
  }
  const payment = await sdk(clientKey, customerKey);
  const origin = window.location.origin;
  try {
    await payment.requestBillingAuth({
      method: "CARD",
      successUrl: `${origin}/payments/billing?plan=${plan}`,
      failUrl: `${origin}/payments/fail`,
      customerName: user.name,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "카드 등록을 취소했어요." };
  }
}
