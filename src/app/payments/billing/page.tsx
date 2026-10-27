"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { PaymentReturn, postJson } from "@/components/PaymentReturn";

function Inner() {
  const p = useSearchParams();
  const request = useCallback(
    () => postJson("/api/billing/issue", { authKey: p.get("authKey"), customerKey: p.get("customerKey"), planId: p.get("plan") }),
    [p],
  );
  return <PaymentReturn request={request} successText="멤버십이 시작되었어요. 이번 달 토큰이 지급되었습니다." />;
}

export default function Page() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
