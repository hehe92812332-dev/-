"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { LoginRequired } from "@/components/LoginRequired";
import { Notice } from "@/components/ui";
import { balanceOf, useStore } from "@/lib/store";

export default function AccountPage() {
  const { currentUser, serverMode, resetDemo } = useStore();
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!currentUser) return <LoginRequired what="계정을 관리하려면" />;
  const balance = balanceOf(currentUser);

  const remove = async () => {
    if (!serverMode) {
      resetDemo();
      return;
    }
    const r = await fetch("/api/account/delete", { method: "POST" }).then((x) => x.json());
    if (!r.ok) return setError(r.error);
    await signOut({ redirectTo: "/" });
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-extrabold">회원 탈퇴</h1>
      <div className="card mt-6 space-y-3 p-6 text-sm leading-relaxed text-slate-600">
        <p>탈퇴하면 다음 내용이 처리돼요.</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            남은 토큰 <b className="text-ink">{balance.toLocaleString()}토큰</b>은 소멸하며 돌려받을 수 없어요. 수익 토큰은 먼저 환전해 주세요.
          </li>
          <li>로그인 연결, 이름, 면허번호, 증빙 서류, 결제 카드 정보가 삭제돼요.</li>
          <li>작성한 질문·답변은 &apos;탈퇴한 회원&apos;으로 남고, 결제·정산 기록은 관련 법에 따라 정해진 기간 보관 후 파기돼요.</li>
          <li>진행 중인 질문이나 처리 중인 환전 신청이 있으면 탈퇴할 수 없어요.</li>
        </ul>
        <label className="block pt-2">
          확인을 위해 <b>탈퇴합니다</b>를 입력해 주세요.
          <input className="input mt-2" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button disabled={confirmText !== "탈퇴합니다"} onClick={remove} className="btn w-full bg-rose-600 text-white hover:bg-rose-700">
          회원 탈퇴
        </button>
      </div>
    </div>
  );
}
