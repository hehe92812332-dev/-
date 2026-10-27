"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { AdminNews } from "@/components/AdminNews";
import { Notice } from "@/components/ui";
import { DEGREES, type Degree } from "@/lib/config";
import { useStore } from "@/lib/store";
import { tierFor } from "@/lib/tier";
import { GemIcon } from "@/components/ui";

interface Overview {
  stats: { users: number; posts: number; paidKrw: number; refundedKrw: number; prepaidKrw: number };
  pending: {
    userId: string;
    name: string;
    email: string;
    licenseNumber: string;
    experienceYears: number;
    educationHours: number;
    degree: Degree;
    hospitalName: string;
    submittedAt: string;
    documents: { id: string; kind: string; filename: string; size: number }[];
  }[];
  reports: {
    id: string;
    targetType: string;
    reason: string;
    detail: string;
    content: string;
    reporterName: string;
    targetUserName: string;
    createdAt: string;
  }[];
  withdrawals: {
    kind: "withdraw" | "balance_refund";
    txId: string;
    name: string;
    email: string;
    tokens: number;
    grossKrw: number;
    withholdingKrw: number;
    netKrw: number;
    account: string;
    createdAt: string;
  }[];
  orders: { id: string; name: string; kind: string; productId: string; amount: number; status: string; method: string; createdAt: string; failReason: string | null }[];
  logs: { id: string; action: string; targetId: string; detail: string; createdAt: string }[];
}

const DOC_LABEL: Record<string, string> = { license: "면허증", career: "경력증명서", education: "교육 이수증", degree: "학위증명서" };
const TARGET_LABEL: Record<string, string> = { post: "질문", answer: "답변", chat: "라운지 메시지", user: "회원" };
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

type Tab = "pending" | "reports" | "withdrawals" | "news" | "orders" | "logs";

export default function AdminPage() {
  const { serverMode, me } = useStore();
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [newsQueue, setNewsQueue] = useState<number>();
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    fetch("/api/admin/news")
      .then((x) => (x.ok ? x.json() : null))
      .then((j) => j && setNewsQueue(j.queue.length))
      .catch(() => {});
    const r = await fetch("/api/admin/overview");
    if (r.ok) setData(await r.json());
    else setMsg({ tone: "error", text: (await r.json().catch(() => ({}))).error ?? "불러오지 못했어요." });
  }, []);

  useEffect(() => {
    if (serverMode && me?.isAdmin) load();
  }, [serverMode, me, load]);

  if (!serverMode) return <div className="mx-auto max-w-3xl px-4 py-12"><Notice>관리자 콘솔은 서버 모드에서만 사용할 수 있어요.</Notice></div>;
  if (!me?.isAdmin) return <div className="mx-auto max-w-3xl px-4 py-12"><Notice tone="error">관리자만 접근할 수 있어요.</Notice></div>;

  const act = async (body: object, success: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const r = await fetch("/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, error: "오류" }));
    setMsg(j.ok ? { tone: "success", text: success } : { tone: "error", text: j.error });
    if (j.ok) load();
  };
  const ask = (label: string) => {
    const v = prompt(label);
    return v && v.trim().length >= 2 ? v.trim() : null;
  };

  const tabs: [Tab, string, number?][] = [
    ["pending", "서류 심사", data?.pending.length],
    ["reports", "신고", data?.reports.length],
    ["withdrawals", "환전·환불", data?.withdrawals.length],
    ["news", "건강 소식", newsQueue],
    ["orders", "결제 내역"],
    ["logs", "처리 기록"],
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">관리자 콘솔</h1>
        <button onClick={load} className="btn-ghost !py-2 text-xs">
          <RefreshCw className="size-4" /> 새로고침
        </button>
      </div>

      {data && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["가입 회원", `${data.stats.users.toLocaleString()}명`],
            ["질문", `${data.stats.posts.toLocaleString()}건`],
            ["결제 금액", `${data.stats.paidKrw.toLocaleString()}원`],
            ["환불 금액", `${data.stats.refundedKrw.toLocaleString()}원`],
            // 전자금융거래법 선불업 등록 기준(발행잔액) 확인용 — 보너스·획득 토큰은 제외한 현금 충전분
            ["미사용 충전 잔액", `${data.stats.prepaidKrw.toLocaleString()}원`],
          ].map(([k, v]) => (
            <div key={k} className="card p-4">
              <div className="text-xs text-slate-500">{k}</div>
              <div className="mt-1 text-xl font-extrabold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === k ? "bg-ink text-white" : "bg-white ring-1 ring-slate-200"}`}>
            {label}
            {!!n && <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-[11px] text-white">{n}</span>}
          </button>
        ))}
      </div>

      {msg && (
        <div className="mt-4">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}

      {tab === "news" ? (
        <div className="mt-4">
          <AdminNews onCount={setNewsQueue} />
        </div>
      ) : !data ? (
        <p className="mt-10 text-center text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {tab === "pending" &&
            (data.pending.length === 0 ? (
              <Empty />
            ) : (
              data.pending.map((p) => {
                const tier = tierFor({ experienceYears: p.experienceYears, educationHours: p.educationHours, degree: p.degree });
                return (
                  <div key={p.userId} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-bold">
                          {p.name} <span className="text-sm font-normal text-slate-400">{p.email}</span>
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          면허번호 <b className="tabular-nums">{p.licenseNumber}</b> · 경력 {p.experienceYears}년 · 교육 {p.educationHours}시간 ·{" "}
                          {DEGREES[p.degree]} · {p.hospitalName}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-sm">
                          신청 등급 <GemIcon tier={tier.id} className="size-4" /> <b style={{ color: tier.text }}>{tier.name}</b>
                          <span className="text-xs text-slate-400">· 제출 {when(p.submittedAt)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => act({ action: "verify", userId: p.userId }, `${p.name}님을 승인했어요.`, `${p.name}님을 ${tier.name} 등급으로 승인할까요?`)} className="btn-primary !py-2 text-xs">
                          승인
                        </button>
                        <button
                          onClick={() => {
                            const reason = ask("반려 사유 (회원에게 표시됩니다)");
                            if (reason) act({ action: "reject", userId: p.userId, reason }, "반려했어요.");
                          }}
                          className="btn-ghost !py-2 text-xs"
                        >
                          반려
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {p.documents.map((d) => (
                        <a key={d.id} href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="chip hover:bg-slate-200">
                          <FileText className="size-3.5" /> {DOC_LABEL[d.kind]} · {d.filename} ({Math.ceil(d.size / 1024)}KB)
                        </a>
                      ))}
                      {p.documents.length === 0 && <span className="text-xs text-rose-500">첨부 서류 없음</span>}
                    </div>
                    <p className="mt-2 text-xs text-slate-400">면허 진위는 한국보건의료인국가시험원 면허 조회 등으로 확인하세요. 경력·교육 시간·학위가 서류와 일치하는지 확인 후 승인합니다.</p>
                  </div>
                );
              })
            ))}

          {tab === "reports" &&
            (data.reports.length === 0 ? (
              <Empty />
            ) : (
              data.reports.map((r) => (
                <div key={r.id} className="card p-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="chip">{TARGET_LABEL[r.targetType]}</span>
                    <b className="text-rose-600">{r.reason}</b>
                    <span className="text-xs text-slate-400">
                      신고자 {r.reporterName} → 대상 {r.targetUserName} · {when(r.createdAt)}
                    </span>
                  </div>
                  {r.content && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{r.content}</p>}
                  {r.detail && <p className="mt-2 text-sm text-slate-500">신고 내용: {r.detail}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => act({ action: "resolveReport", reportId: r.id, decision: "hide", note: "" }, "숨김 처리했어요.")} className="btn-dark !py-2 text-xs">
                      콘텐츠 숨김
                    </button>
                    <button
                      onClick={() => act({ action: "resolveReport", reportId: r.id, decision: "suspend", note: "" }, "숨김 + 7일 정지 처리했어요.", `${r.targetUserName}님을 7일간 이용 정지할까요?`)}
                      className="btn !py-2 text-xs bg-rose-600 text-white hover:bg-rose-700"
                    >
                      숨김 + 7일 정지
                    </button>
                    <button onClick={() => act({ action: "resolveReport", reportId: r.id, decision: "dismiss", note: "" }, "문제 없음으로 처리했어요.")} className="btn-ghost !py-2 text-xs">
                      문제 없음
                    </button>
                  </div>
                </div>
              ))
            ))}

          {tab === "withdrawals" &&
            (data.withdrawals.length === 0 ? (
              <Empty />
            ) : (
              data.withdrawals.map((w) => (
                <div key={w.txId} className="card flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="text-sm">
                    <div className="font-bold">
                      <span className="chip mr-1">{w.kind === "withdraw" ? "수익 환전" : "충전 잔액 환불"}</span>
                      {w.name} <span className="font-normal text-slate-400">{w.email}</span>
                    </div>
                    <div className="mt-1 text-slate-600">
                      {w.tokens.toLocaleString()}토큰 = {w.grossKrw.toLocaleString()}원 − {w.kind === "withdraw" ? "원천징수" : "수수료"} {w.withholdingKrw.toLocaleString()}원 →{" "}
                      <b className="text-brand-700">{w.netKrw.toLocaleString()}원 입금</b>
                    </div>
                    <div className="mt-1 text-slate-600">
                      입금 계좌 <b className="tabular-nums">{w.account}</b> · 신청 {when(w.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => act({ action: "withdrawPaid", txId: w.txId }, "지급 완료로 처리했어요.", `${w.netKrw.toLocaleString()}원을 이체했나요?`)} className="btn-primary !py-2 text-xs">
                      이체 완료
                    </button>
                    <button
                      onClick={() => {
                        const reason = ask("반려 사유 (토큰은 회원에게 돌려줍니다)");
                        if (reason) act({ action: "withdrawReject", txId: w.txId, reason }, "반려하고 토큰을 돌려줬어요.");
                      }}
                      className="btn-ghost !py-2 text-xs"
                    >
                      반려
                    </button>
                  </div>
                </div>
              ))
            ))}

          {tab === "orders" && (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    {["주문번호", "회원", "상품", "금액", "수단", "상태", "일시"].map((h) => (
                      <th key={h} className="px-4 py-2.5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.orders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-4 py-2.5 font-mono text-xs">{o.id.slice(0, 16)}…</td>
                      <td className="px-4 py-2.5">{o.name}</td>
                      <td className="px-4 py-2.5">{o.kind === "tokens" ? `토큰 ${o.productId}` : `멤버십 ${o.productId}`}</td>
                      <td className="px-4 py-2.5 tabular-nums">{o.amount.toLocaleString()}원</td>
                      <td className="px-4 py-2.5">{o.method}</td>
                      <td className="px-4 py-2.5" title={o.failReason ?? ""}>
                        {{ pending: "대기", paid: "완료", failed: "실패", canceled: "취소" }[o.status]}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{when(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "logs" && (
            <div className="card divide-y divide-slate-100">
              {data.logs.map((l) => (
                <div key={l.id} className="flex gap-3 px-4 py-2.5 text-sm">
                  <span className="w-32 shrink-0 text-xs text-slate-400">{when(l.createdAt)}</span>
                  <b>{l.action}</b>
                  <span className="truncate text-slate-500">
                    {l.targetId} {l.detail}
                  </span>
                </div>
              ))}
              {data.logs.length === 0 && <Empty />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <div className="card py-12 text-center text-sm text-slate-500">처리할 항목이 없어요.</div>;
}
