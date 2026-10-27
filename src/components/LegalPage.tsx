import { BUSINESS } from "@/lib/config";

export function LegalPage({ title, effective, children }: { title: string; effective: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 md:py-14">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <b>초안</b> — 실제 서비스 게시 전 법률 전문가의 검토를 받고, 사업자 정보와 위탁 업체를 실제 내용으로 바꿔 주세요.
      </div>
      <h1 className="mt-8 text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        시행일: {effective} · {BUSINESS.companyName}
      </p>
      <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_table]:w-full [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-2 [&_th]:text-left">
        {children}
      </div>
    </article>
  );
}
