"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { PaymentReturn, postJson } from "@/components/PaymentReturn";

function Inner() {
  const p = useSearchParams();
  const request = useCallback(
    () => postJson("/api/payments/confirm", { orderId: p.get("orderId"), paymentKey: p.get("paymentKey"), amount: p.get("amount") }),
    [p],
  );
  return <PaymentReturn request={request} successText="충전한 토큰이 지갑에 들어왔어요." />;
}

export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
