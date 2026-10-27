"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, CreditCard, Landmark } from "lucide-react";
import { Notice, TokenAmount, timeAgo } from "@/components/ui";
import { MIN_WITHDRAW_TOKENS, TOKEN_KRW, TOKEN_PACKAGES, WITHHOLDING_TAX_RATE } from "@/lib/config";
import { balanceOf, useStore } from "@/lib/store";
import type { TxType } from "@/lib/types";

const TX_LABEL: Record<TxType, string> = {
  purchase: "충전",
  ask: "질문",
  refund: "환불",
  reward: "채택 보상",
  withdraw: "환전",
};

export default function WalletPage() {
  const { currentUser, transactions, buyTokens, withdraw } = useStore();
  const [tab, setTab] = useState<"buy" | "withdraw">("buy");
  const [pkg, setPkg] = useState<string>(TOKEN_PACKAGES[1].id);
  const [amount, setAmount] = useState(MIN_WITHDRAW_TOKENS);
  const [account, setAccount] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  if (!currentUser)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Notice>지갑을 보려면 로그인(우측 상단 데모 계정 선택)이 필요합니다.</Notice>
      </div>
    );

  const isTherapist = currentUser.role === "therapist";
  const myTx = transactions.filter((t) => t.userId === currentUser.id);
  const selected = TOKEN_PACKAGES.find((p) => p.id === pkg)!;
  const gross = amount * TOKEN_KRW;
  const net = Math.floor(gross * (1 - WITHHOLDING_TAX_RATE));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">내 지갑</h1>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="card relative overflow-hidden bg-gradient-to-br from-ink to-slate-700 p-6 text-white md:col-span-1">
          <div className="text-sm text-slate-300">총 보유 토큰</div>
          <div className="mt-2 text-4xl font-extrabold tabular-nums">{balanceOf(currentUser).toLocaleString()}</div>
          <div className="mt-1 text-sm text-slate-400">≈ {(balanceOf(currentUser) * TOKEN_KRW).toLocaleString()}원</div>
        </div>
        <div className="card p-6">
          <div className="text-sm text-slate-500">충전 토큰</div>
          <div className="mt-2">
            <TokenAmount value={currentUser.wallet.purchased} className="text-2xl" />
          </div>
          <p className="mt-2 text-xs text-slate-400">질문에 사용 · 환전 불가</p>
        </div>
        <div className="card p-6">
          <div className="text-sm text-slate-500">획득 토큰</div>
          <div className="mt-2">
            <TokenAmount value={currentUser.wallet.earned} className="text-2xl" />
          </div>
          <p className="mt-2 text-xs text-slate-400">답변 채택으로 획득 · 현금 환전 가능</p>
        </div>
      </div>

      <div className="card mt-6 p-5 md:p-7">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          <button onClick={() => { setTab("buy"); setMsg(null); }} className={`rounded-lg px-4 py-2 ${tab === "buy" ? "bg-white shadow-sm" : "text-slate-500"}`}>
            토큰 충전
          </button>
          <button onClick={() => { setTab("withdraw"); setMsg(null); }} className={`rounded-lg px-4 py-2 ${tab === "withdraw" ? "bg-white shadow-sm" : "text-slate-500"}`}>
            현금 환전
          </button>
        </div>

        {tab === "buy" ? (
          <div className="mt-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {TOKEN_PACKAGES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPkg(p.id)}
                  className={`relative rounded-2xl border-2 p-4 text-left transition ${
                    pkg === p.id ? "border-brand-500 bg-brand-50/50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {"badge" in p && (
                    <span className="absolute -top-2.5 right-3 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-ink">
                      {p.badge}
                    </span>
                  )}
                  <TokenAmount value={p.tokens} className="text-xl" />
                  <div className="mt-1 h-4 text-xs font-semibold text-brand-600">{p.bonus > 0 && `+ 보너스 ${p.bonus}`}</div>
                  <div className="mt-2 font-bold">{p.price.toLocaleString()}원</div>
                </button>
              ))}
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-600">
                결제 금액 <b className="text-ink">{selected.price.toLocaleString()}원</b> · 지급 토큰{" "}
                <b className="text-ink">{selected.tokens + selected.bonus}</b>
              </span>
              <button
                onClick={() => {
                  const r = buyTokens(pkg);
                  setMsg(r.ok ? { tone: "success", text: `${selected.tokens + selected.bonus}토큰이 충전되었어요.` } : { tone: "error", text: r.error });
                }}
                className="btn-primary"
              >
                <CreditCard className="size-4" /> 결제하기
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              * 데모 버전에서는 실제 결제가 이루어지지 않습니다. 사용하지 않은 충전 토큰은 결제일로부터 7일 이내 청약철회가 가능합니다.
            </p>
          </div>
        ) : isTherapist ? (
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="label">환전할 토큰</label>
                <input
                  type="number"
                  min={MIN_WITHDRAW_TOKENS}
                  step={100}
                  className="input"
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Math.floor(+e.target.value)))}
                />
                <p className="mt-1.5 text-xs text-slate-400">
                  환전 가능 {currentUser.wallet.earned.toLocaleString()}토큰 · 최소 {MIN_WITHDRAW_TOKENS}토큰
                </p>
              </div>
              <div>
                <label className="label">입금 계좌</label>
                <input className="input" placeholder="예) 국민은행 123456-78-901234" value={account} onChange={(e) => setAccount(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col rounded-2xl bg-slate-50 p-5 text-sm">
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">환전 금액</span>
                <span className="tabular-nums">{gross.toLocaleString()}원</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-500">원천징수 ({(WITHHOLDING_TAX_RATE * 100).toFixed(1)}%)</span>
                <span className="tabular-nums">-{(gross - net).toLocaleString()}원</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-3 font-bold">
                <span>실 입금액</span>
                <span className="text-lg tabular-nums text-brand-700">{net.toLocaleString()}원</span>
              </div>
              <button
                onClick={() => {
                  const r = withdraw(amount, account);
                  setMsg(r.ok ? { tone: "success", text: `환전 신청 완료! 영업일 기준 2~3일 내 ${net.toLocaleString()}원이 입금됩니다.` } : { tone: "error", text: r.error });
                }}
                className="btn-dark mt-auto"
              >
                <Landmark className="size-4" /> 환전 신청
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <Notice>현금 환전은 답변으로 토큰을 획득한 치료사 회원만 이용할 수 있어요.</Notice>
            <Link href="/signup?role=therapist" className="btn-ghost mt-4">
              치료사로 가입하기
            </Link>
          </div>
        )}

        {msg && (
          <div className="mt-4">
            <Notice tone={msg.tone}>
              {msg.tone === "success" && <Check className="mr-1 inline size-4" />}
              {msg.text}
            </Notice>
          </div>
        )}
      </div>

      <h2 className="mt-10 text-lg font-bold">거래 내역</h2>
      <div className="card mt-4 divide-y divide-slate-100">
        {myTx.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-5 py-4">
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${t.tokens > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>
              {t.tokens > 0 ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{TX_LABEL[t.type]}</div>
              <div className="truncate text-xs text-slate-500">{t.memo}</div>
            </div>
            <div className="text-right">
              <div className={`text-sm font-bold tabular-nums ${t.tokens > 0 ? "text-emerald-600" : "text-ink"}`}>
                {t.tokens > 0 ? "+" : ""}
                {t.tokens.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-400">
                {t.krw ? `${t.krw.toLocaleString()}원 · ` : ""}
                {timeAgo(t.createdAt)}
              </div>
            </div>
          </div>
        ))}
        {myTx.length === 0 && <div className="py-12 text-center text-sm text-slate-500">거래 내역이 없습니다.</div>}
      </div>
    </div>
  );
}
