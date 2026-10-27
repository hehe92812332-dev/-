"use client";

import Link from "next/link";
import { Clock, ShieldCheck, ShieldX } from "lucide-react";
import { useStore } from "@/lib/store";

/** 치료사 서류 심사 상태 */
export default function PendingPage() {
  const { currentUser } = useStore();
  const t = currentUser?.therapist;
  if (!t) return <div className="mx-auto max-w-md px-4 py-16 text-center text-slate-500">치료사 회원만 볼 수 있는 페이지입니다.</div>;

  const status = t.verification ?? (t.licenseVerified ? "approved" : "pending");
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {status === "approved" ? (
        <>
          <ShieldCheck className="mx-auto size-14 text-brand-600" />
          <h1 className="mt-4 text-2xl font-extrabold">심사가 완료되었어요</h1>
          <p className="mt-2 text-sm text-slate-500">이제 환자 질문에 답변하고, 임상 토론과 등급 라운지를 이용할 수 있어요.</p>
          <Link href="/qa" className="btn-primary mt-6">
            답변하러 가기
          </Link>
        </>
      ) : status === "rejected" ? (
        <>
          <ShieldX className="mx-auto size-14 text-rose-500" />
          <h1 className="mt-4 text-2xl font-extrabold">서류 보완이 필요해요</h1>
          <p className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{t.rejectReason || "제출한 서류를 확인할 수 없었어요."}</p>
          <Link href="/signup?role=therapist" className="btn-primary mt-6">
            서류 다시 제출하기
          </Link>
        </>
      ) : (
        <>
          <Clock className="mx-auto size-14 text-amber-500" />
          <h1 className="mt-4 text-2xl font-extrabold">서류를 확인하고 있어요</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            면허·경력·교육·학위 서류를 운영팀이 확인하고 있어요. 보통 영업일 기준 1~2일 걸리며, 심사가 끝나면 보석 등급이 확정됩니다.
            그동안 환자 Q&A를 둘러볼 수 있어요.
          </p>
          <Link href="/qa" className="btn-ghost mt-6">
            환자 Q&A 둘러보기
          </Link>
        </>
      )}
    </div>
  );
}
