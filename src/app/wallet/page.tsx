"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Crown, CreditCard, Hourglass, Landmark } from "lucide-react";
import { Checkout, type CheckoutItem } from "@/components/Checkout";
import { Notice, TokenAmount, timeAgo } from "@/components/ui";
import {
  MEMBERSHIP_PLANS,
  MIN_PURCHASE_TOKENS,
  MIN_WITHDRAW_TOKENS,
  PAYMENT_METHODS,
  REVOKE_DAYS,
  SETTLEMENT_HOLD_DAYS,
  TOKEN_KRW,
  TOKEN_PACKAGES,
  WITHHOLDING_TAX_RATE,
  type PaymentMethodId,
} from "@/lib/config";
import { canRevoke, membershipPlan, pendingEarned, withdrawable } from "@/lib/ledger";
import { balanceOf, useStore } from "@/lib/store";
import type { TxType } from "@/lib/types";

const TX_LABEL: Record<TxType, string> = {
  purchase: "토큰 충전",
  revoke: "결제 취소",
  membership: "멤버십",
  ask: "질문 등록",
  bounty: "현상금 추가",
  refund: "환불",
  reward: "채택 보상",
  tip_sent: "팁 보냄",
  tip_received: "팁 받음",
  withdraw: "현금 환전",
};

type Tab = "buy" | "membership" | "withdraw";

function WalletInner() {
  const params = useSearchParams();
  const store = useStore();
  const { currentUser, state, transactions } = store;
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "buy");
  const [pkg, setPkg] = useState<string>(TOKEN_PACKAGES[0].id);
  const [amount, setAmount] = useState(MIN_WITHDRAW_TOKENS);
  const [account, setAccount] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [checkout, setCheckout] = useState<{ item: CheckoutItem; pay: (m: PaymentMethodId) => { ok: boolean; error?: string } } | null>(null);

  if (!currentUser)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Notice>지갑을 보려면 로그인(우측 상단 데모 계정 선택)이 필요합니다.</Notice>
      </div>
    );

  const isTherapist = currentUser.role === "therapist";
  const { cash, bonus, earned } = currentUser.wallet;
  const pending = pendingEarned(state, currentUser.id);
  const available = withdrawable(state, currentUser.id);
  const myTx = transactions.filter((t) => t.userId === currentUser.id);
  const plan = membershipPlan(currentUser);
  const gross = amount * TOKEN_KRW;
  const net = Math.floor(gross * (1 - WITHHOLDING_TAX_RATE));

  const switchTab = (t: Tab) => {
    setTab(t);
    setMsg(null);
  };

  const openPackage = () => {
    const p = TOKEN_PACKAGES.find((x) => x.id === pkg)!;
    setCheckout({
      item: {
        title: `토큰 ${p.tokens}개 충전`,
        lines: [
          ["충전 토큰", `${p.tokens}`],
          ["보너스 토큰", `+${p.bonus}`],
        ],
        price: p.price,
      },
      pay: (m) => store.buyTokens(p.id, m),
    });
  };

  const openPlan = (planId: (typeof MEMBERSHIP_PLANS)[number]["id"]) => {
    const p = MEMBERSHIP_PLANS.find((x) => x.id === planId)!;
    setCheckout({
      item: {
        title: `${p.name} 멤버십`,
        lines: [
          ["매월 지급", `${p.monthlyTokens} + 보너스 ${p.monthlyBonus}토큰`],
          ["질문 할인", `${Math.round(p.discountRate * 100)}%`],
        ],
        price: p.price,
        recurring: true,
      },
      pay: (m) => store.subscribe(p.id, m),
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">내 지갑</h1>
        {plan && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">
            <Crown className="size-3.5" /> {plan.name} 멤버
          </span>
        )}
      </div>

      {/* 잔액 요약 */}
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <div className="card bg-gradient-to-br from-ink to-slate-700 p-6 text-white md:row-span-2 md:flex md:flex-col md:justify-between">
          <div>
            <div className="text-sm text-slate-300">총 보유 토큰</div>
            <div className="mt-2 text-4xl font-extrabold tabular-nums">{balanceOf(currentUser).toLocaleString()}</div>
            <div className="mt-1 text-sm text-slate-400">≈ {(balanceOf(currentUser) * TOKEN_KRW).toLocaleString()}원</div>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-slate-400">질문할 때는 보너스 → 충전 → 수익 토큰 순서로 사용돼요.</p>
        </div>
        {[
          ["충전 토큰", cash, `질문에 사용 · ${REVOKE_DAYS}일 내 미사용분 결제 취소 가능`],
          ["보너스 토큰", bonus, "충전·멤버십 혜택 · 환전·환불 불가"],
          ["수익 토큰", earned, isTherapist ? "답변 채택·팁으로 획득 · 현금 환전" : "답변 채택·팁으로 획득"],
        ].map(([label, value, desc]) => (
          <div key={label as string} className="card p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <TokenAmount value={value as number} className="mt-1.5 text-2xl" />
            <p className="mt-1.5 text-xs text-slate-400">{desc}</p>
          </div>
        ))}
        {isTherapist && (
          <div className="card flex items-center gap-4 p-5 md:col-span-3">
            <Hourglass className="size-5 shrink-0 text-amber-500" />
            <div className="flex-1 text-sm">
              <span className="text-slate-500">환전 가능</span> <b className="tabular-nums">{available.toLocaleString()}</b>
              <span className="mx-2 text-slate-300">|</span>
              <span className="text-slate-500">정산 대기</span> <b className="tabular-nums">{pending.toLocaleString()}</b>
              <p className="mt-0.5 text-xs text-slate-400">채택 보상·팁은 {SETTLEMENT_HOLD_DAYS}일의 정산 대기 후 환전할 수 있어요.</p>
            </div>
          </div>
        )}
      </div>

      <div className="card mt-6 p-5 md:p-7">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          {(
            [
              ["buy", "토큰 충전"],
              ["membership", "멤버십"],
              ["withdraw", "현금 환전"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => switchTab(k)} className={`rounded-lg px-4 py-2 ${tab === k ? "bg-white shadow-sm" : "text-slate-500"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "buy" && (
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
                    <span className="absolute -top-2.5 right-3 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-ink">{p.badge}</span>
                  )}
                  <TokenAmount value={p.tokens} className="text-xl" />
                  <div className="mt-1 h-4 text-xs font-semibold text-brand-600">
                    {p.bonus > 0 && `+ 보너스 ${p.bonus} (${Math.round((p.bonus / p.tokens) * 100)}%)`}
                  </div>
                  <div className="mt-2 font-bold">{p.price.toLocaleString()}원</div>
                </button>
              ))}
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-600">
                최소 {MIN_PURCHASE_TOKENS}토큰부터 충전할 수 있어요. 카드 · 카카오페이 · 네이버페이 · 토스페이 · 휴대폰 결제 지원.
                {!plan && (
                  <button onClick={() => switchTab("membership")} className="ml-1 font-semibold text-violet-700 underline underline-offset-2">
                    멤버십이면 매달 할인!
                  </button>
                )}
              </span>
              <button onClick={openPackage} className="btn-primary">
                <CreditCard className="size-4" /> 충전하기
              </button>
            </div>
          </div>
        )}

        {tab === "membership" && (
          <div className="mt-6">
            <div className="grid gap-4 md:grid-cols-2">
              {MEMBERSHIP_PLANS.map((p) => {
                const active = currentUser.membership?.plan === p.id;
                return (
                  <div key={p.id} className={`relative rounded-2xl border-2 p-6 ${active ? "border-violet-500 bg-violet-50/40" : "border-slate-200"}`}>
                    {"badge" in p && (
                      <span className="absolute -top-2.5 right-4 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">{p.badge}</span>
                    )}
                    <div className="flex items-center gap-2 font-extrabold">
                      <Crown className="size-5 text-violet-600" /> {p.name}
                    </div>
                    <div className="mt-3 text-3xl font-extrabold">
                      {p.price.toLocaleString()}
                      <span className="text-base font-semibold text-slate-400">원 / 월</span>
                    </div>
                    <ul className="mt-4 space-y-2 text-sm">
                      {p.perks.map((perk) => (
                        <li key={perk} className="flex items-center gap-2">
                          <Check className="size-4 text-violet-600" /> {perk}
                        </li>
                      ))}
                    </ul>
                    {active ? (
                      <div className="mt-6 space-y-2 text-sm">
                        <div className="text-slate-500">
                          다음 {currentUser.membership!.autoRenew ? "결제일" : "종료일"}:{" "}
                          <b className="text-ink">{new Date(currentUser.membership!.renewsAt).toLocaleDateString("ko-KR")}</b>
                        </div>
                        <button
                          onClick={() => {
                            const on = !currentUser.membership!.autoRenew;
                            const r = store.setAutoRenew(on);
                            setMsg(r.ok ? { tone: "success", text: on ? "자동 갱신을 다시 켰어요." : "자동 갱신을 해지했어요. 남은 기간까지 혜택이 유지됩니다." } : { tone: "error", text: r.error });
                          }}
                          className="btn-ghost w-full"
                        >
                          {currentUser.membership!.autoRenew ? "자동 갱신 해지" : "자동 갱신 다시 켜기"}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => openPlan(p.id)} className="btn mt-6 w-full bg-violet-600 text-white hover:bg-violet-700">
                        {plan ? `${p.name}(으)로 변경` : "구독하기"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "withdraw" &&
          (isTherapist ? (
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
                  <div className="mt-1.5 flex justify-between text-xs text-slate-400">
                    <span>
                      환전 가능 {available.toLocaleString()}토큰 · 최소 {MIN_WITHDRAW_TOKENS}토큰
                    </span>
                    <button onClick={() => setAmount(available)} className="font-semibold text-brand-700">
                      전액
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">입금 계좌 (본인 명의)</label>
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
                    const r = store.withdraw(amount, account);
                    setMsg(r.ok ? { tone: "success", text: `환전 신청 완료! 영업일 기준 2~3일 내 ${net.toLocaleString()}원이 입금됩니다.` } : { tone: "error", text: r.error });
                  }}
                  className="btn-dark mt-4"
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
          ))}

        {msg && (
          <div className="mt-4">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        )}
      </div>

      <h2 className="mt-10 text-lg font-bold">거래 내역</h2>
      <div className="card mt-4 divide-y divide-slate-100">
        {myTx.map((t) => {
          const total = t.tokens + (t.bonusTokens ?? 0);
          const plus = total > 0;
          return (
            <div key={t.id} className="flex items-center gap-3 px-5 py-4">
              <span className={`grid size-9 shrink-0 place-items-center rounded-full ${plus ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>
                {plus ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {TX_LABEL[t.type]}
                  {t.revoked && <span className="chip !py-0.5 !text-[10px]">취소됨</span>}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {t.memo}
                  {t.method && ` · ${PAYMENT_METHODS.find((m) => m.id === t.method)?.label}`}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold tabular-nums ${plus ? "text-emerald-600" : "text-ink"}`}>
                  {plus ? "+" : ""}
                  {total.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-400">
                  {t.krw ? `${t.krw.toLocaleString()}원 · ` : ""}
                  {timeAgo(t.createdAt)}
                </div>
                {canRevoke(state, t) && (
                  <button
                    onClick={() => {
                      if (!confirm(`${t.krw?.toLocaleString()}원 결제를 취소할까요? 이 충전으로 받은 토큰이 회수됩니다.`)) return;
                      const r = store.revokePurchase(t.id);
                      setMsg(r.ok ? { tone: "success", text: "결제를 취소했어요. 결제 수단으로 환불됩니다." } : { tone: "error", text: r.error });
                    }}
                    className="mt-1 text-[11px] font-semibold text-rose-500 underline"
                  >
                    결제 취소
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {myTx.length === 0 && <div className="py-12 text-center text-sm text-slate-500">거래 내역이 없습니다.</div>}
      </div>

      <Checkout item={checkout?.item ?? null} onClose={() => setCheckout(null)} onPay={(m) => checkout!.pay(m)} />
    </div>
  );
}

export default function WalletPage() {
  return (
    <Suspense>
      <WalletInner />
    </Suspense>
  );
}
