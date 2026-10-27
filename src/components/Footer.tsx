import Link from "next/link";
import { BUSINESS, SITE } from "@/lib/config";

export function Footer() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-slate-500 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <div className="font-extrabold text-ink">{SITE.name}</div>
          <p className="mt-2 leading-relaxed">
            {SITE.name}에서 제공되는 답변은 건강 정보 제공 목적이며, 의사의 진단이나 처방을 대신하지 않습니다.
            증상이 심하거나 응급 상황이라면 즉시 의료기관을 방문하세요.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-slate-700">서비스</span>
          <Link href="/qa">환자 Q&A</Link>
          <Link href="/clinical">임상 토론</Link>
          <Link href="/therapists">치료사 찾기</Link>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-slate-700">안내</span>
          <Link href="/tiers">등급·토큰 정책</Link>
          <Link href="/wallet">토큰 충전·환전</Link>
          <Link href="/signup">회원가입</Link>
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy" className="font-semibold text-slate-700">
            개인정보 처리방침
          </Link>
          <Link href="/refund">환불 정책</Link>
        </div>
      </div>
      <div className="mx-auto max-w-6xl border-t border-slate-100 px-4 py-4 text-[11px] leading-relaxed text-slate-400">
        {BUSINESS.companyName} · 대표 {BUSINESS.ceo} · 사업자등록번호 {BUSINESS.registrationNumber} · 통신판매업신고 {BUSINESS.mailOrderNumber}
        <br />
        {BUSINESS.address} · {BUSINESS.email} · {BUSINESS.phone}
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {SITE.nameEn}. All rights reserved.
      </div>
    </footer>
  );
}
