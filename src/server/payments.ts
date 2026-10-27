import "server-only";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { MEMBERSHIP_PLANS, TOKEN_PACKAGES, type MembershipPlanId, type PaymentMethodId } from "@/lib/config";
import * as ledger from "@/lib/ledger";
import { decrypt, encrypt } from "./crypto";
import { db, schema } from "./db";
import { paymentProvider, requireEnv } from "./env";
import { runLedger } from "./runner";

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ───────────── PG 어댑터 (토스페이먼츠 / 개발용 mock) ─────────────

interface PaymentResult {
  paymentKey: string;
  method: PaymentMethodId;
}

class PgError extends Error {}

async function toss<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`https://api.tosspayments.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${requireEnv("TOSS_SECRET_KEY")}:`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!res.ok) throw new PgError(json.message ?? `결제사 오류 (${res.status})`);
  return json;
}

type TossPayment = { paymentKey: string; status: string; method?: string; easyPay?: { provider?: string } };

function methodOf(p: TossPayment): PaymentMethodId {
  const provider = p.easyPay?.provider ?? "";
  if (provider.includes("카카오")) return "kakaopay";
  if (provider.includes("네이버")) return "naverpay";
  if (provider.includes("토스")) return "tosspay";
  if (p.method === "휴대폰") return "phone";
  return "card";
}

const pg = {
  async confirm(order: { id: string; amount: number }, paymentKey: string, hint: PaymentMethodId): Promise<PaymentResult> {
    if (paymentProvider() === "mock") return { paymentKey, method: hint };
    const p = await toss<TossPayment>("/v1/payments/confirm", { paymentKey, orderId: order.id, amount: order.amount }, `confirm-${order.id}`);
    if (p.status !== "DONE") throw new PgError("결제가 완료되지 않았습니다.");
    return { paymentKey: p.paymentKey, method: methodOf(p) };
  },
  async cancel(paymentKey: string, reason: string) {
    if (paymentProvider() === "mock") return;
    await toss(`/v1/payments/${paymentKey}/cancel`, { cancelReason: reason }, `cancel-${paymentKey}`);
  },
  async issueBillingKey(authKey: string, customerKey: string) {
    if (paymentProvider() === "mock") return { billingKey: `mock_bk_${customerKey}`, cardLabel: "테스트카드 ****" };
    const r = await toss<{ billingKey: string; cardCompany?: string; card?: { number?: string } }>("/v1/billing/authorizations/issue", {
      authKey,
      customerKey,
    });
    return { billingKey: r.billingKey, cardLabel: `${r.cardCompany ?? "카드"} ${r.card?.number ?? ""}`.trim() };
  },
  async chargeBilling(billingKey: string, customerKey: string, order: { id: string; amount: number; name: string }): Promise<PaymentResult> {
    if (paymentProvider() === "mock") return { paymentKey: `mock_${order.id}`, method: "card" };
    const p = await toss<TossPayment>(
      `/v1/billing/${billingKey}`,
      { customerKey, amount: order.amount, orderId: order.id, orderName: order.name },
      `billing-${order.id}`,
    );
    if (p.status !== "DONE") throw new PgError("정기결제가 승인되지 않았습니다.");
    return { paymentKey: p.paymentKey, method: "card" };
  },
};

export const customerKeyOf = (userId: string) => `ck_${userId}`;

// ───────────── 토큰 충전 ─────────────

/** 주문 생성: 금액은 항상 서버의 상품 정보로 결정합니다 */
export async function prepareTokenOrder(userId: string, packageId: string, method: PaymentMethodId) {
  const pkg = TOKEN_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) return { ok: false as const, error: "상품을 찾을 수 없습니다." };
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
  await db.insert(schema.paymentOrders).values({
    id: orderId,
    userId,
    kind: "tokens",
    productId: pkg.id,
    amount: pkg.price,
    status: "pending",
    provider: paymentProvider(),
    method,
  });
  return {
    ok: true as const,
    orderId,
    amount: pkg.price,
    orderName: `토큰 ${pkg.tokens}개${pkg.bonus ? ` + 보너스 ${pkg.bonus}개` : ""}`,
    provider: paymentProvider(),
    clientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? null,
    customerKey: customerKeyOf(userId),
  };
}

/** 결제 승인: PG 승인 → 같은 주문으로 한 번만 토큰 지급 (중복 요청에도 안전) */
export async function confirmTokenOrder(userId: string, input: { orderId: string; paymentKey: string; amount: number }): Promise<Ok> {
  const [order] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, input.orderId));
  if (!order || order.userId !== userId || order.kind !== "tokens") return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (order.status === "paid") return { ok: true };
  if (order.status !== "pending") return { ok: false, error: "이미 처리된 주문입니다." };
  if (order.amount !== input.amount) return { ok: false, error: "결제 금액이 주문 금액과 다릅니다." };

  let paid: PaymentResult;
  try {
    paid = await pg.confirm(order, input.paymentKey, (order.method as PaymentMethodId) ?? "card");
  } catch (e) {
    await db.update(schema.paymentOrders).set({ status: "failed", failReason: (e as Error).message }).where(eq(schema.paymentOrders.id, order.id));
    return { ok: false, error: e instanceof PgError ? e.message : "결제 승인에 실패했습니다." };
  }

  try {
    const r = await runLedger(
      userId,
      {},
      (s) => ledger.purchase(s, userId, order.productId, paid.method, order.id),
      async (tx) => {
        const updated = await tx
          .update(schema.paymentOrders)
          .set({ status: "paid", paymentKey: paid.paymentKey, method: paid.method, approvedAt: new Date().toISOString() })
          .where(and(eq(schema.paymentOrders.id, order.id), eq(schema.paymentOrders.status, "pending")))
          .returning();
        // 동시에 들어온 같은 주문 승인 요청은 한 번만 반영
        if (updated.length === 0) throw new Error("ALREADY_PROCESSED");
      },
    );
    return r.ok ? { ok: true } : r;
  } catch (e) {
    if ((e as Error).message === "ALREADY_PROCESSED") return { ok: true };
    // 토큰 지급에 실패하면 결제를 취소해 돈만 빠져나가는 일을 막습니다
    await pg.cancel(paid.paymentKey, "시스템 오류로 인한 자동 취소").catch(() => {});
    await db.update(schema.paymentOrders).set({ status: "canceled", failReason: "지급 실패 자동 취소" }).where(eq(schema.paymentOrders.id, order.id));
    throw e;
  }
}

/** 청약철회: 미사용 충전분 회수 + PG 결제 취소를 한 트랜잭션으로 */
export async function cancelPurchase(userId: string, txId: string): Promise<Ok> {
  return runLedger(
    userId,
    { txIds: [txId] },
    (s) => ledger.revokePurchase(s, userId, txId),
    async (tx, r) => {
      const t = r.state.transactions.find((x) => x.id === txId);
      if (!t?.orderId) return; // 주문 없이 지급된 데모·이관 데이터
      const [order] = await tx.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, t.orderId));
      if (!order?.paymentKey) throw new Error("결제 정보를 찾을 수 없습니다.");
      await pg.cancel(order.paymentKey, "고객 요청 청약철회");
      await tx.update(schema.paymentOrders).set({ status: "canceled", canceledAt: new Date().toISOString() }).where(eq(schema.paymentOrders.id, order.id));
    },
  ).then((r) => (r.ok ? { ok: true as const } : r));
}

// ───────────── 멤버십 정기결제 ─────────────

/** 카드 등록(빌링 인증) 성공 후: 빌링키 발급 → 첫 달 결제 → 멤버십 시작 */
export async function startMembership(userId: string, input: { authKey: string; customerKey: string; planId: MembershipPlanId }): Promise<Ok> {
  const plan = MEMBERSHIP_PLANS.find((p) => p.id === input.planId);
  if (!plan) return { ok: false, error: "플랜을 찾을 수 없습니다." };
  if (input.customerKey !== customerKeyOf(userId)) return { ok: false, error: "잘못된 결제 요청입니다." };

  let issued: { billingKey: string; cardLabel: string };
  try {
    issued = await pg.issueBillingKey(input.authKey, input.customerKey);
  } catch (e) {
    return { ok: false, error: e instanceof PgError ? e.message : "카드 등록에 실패했습니다." };
  }
  await db
    .insert(schema.billingKeys)
    .values({ userId, customerKey: input.customerKey, billingKeyEnc: encrypt(issued.billingKey), cardLabel: issued.cardLabel })
    .onConflictDoUpdate({ target: schema.billingKeys.userId, set: { billingKeyEnc: encrypt(issued.billingKey), cardLabel: issued.cardLabel } });

  return chargeMembership(userId, plan.id, "membership");
}

async function chargeMembership(userId: string, planId: MembershipPlanId, kind: "membership" | "membership_renewal"): Promise<Ok> {
  const plan = MEMBERSHIP_PLANS.find((p) => p.id === planId)!;
  const [bk] = await db.select().from(schema.billingKeys).where(eq(schema.billingKeys.userId, userId));
  if (!bk) return { ok: false, error: "등록된 결제 카드가 없습니다." };
  const orderId = `sub_${crypto.randomUUID().replace(/-/g, "")}`;
  await db.insert(schema.paymentOrders).values({ id: orderId, userId, kind, productId: plan.id, amount: plan.price, status: "pending", provider: paymentProvider(), method: "card" });

  let paid: PaymentResult;
  try {
    paid = await pg.chargeBilling(decrypt(bk.billingKeyEnc), bk.customerKey, { id: orderId, amount: plan.price, name: `${plan.name} 멤버십` });
  } catch (e) {
    await db.update(schema.paymentOrders).set({ status: "failed", failReason: (e as Error).message }).where(eq(schema.paymentOrders.id, orderId));
    return { ok: false, error: e instanceof PgError ? e.message : "정기결제에 실패했습니다." };
  }
  const markPaid = async (tx: Parameters<NonNullable<Parameters<typeof runLedger>[3]>>[0]) => {
    await tx
      .update(schema.paymentOrders)
      .set({ status: "paid", paymentKey: paid.paymentKey, approvedAt: new Date().toISOString() })
      .where(eq(schema.paymentOrders.id, orderId));
  };
  const r =
    kind === "membership"
      ? await runLedger(userId, {}, (s) => ledger.subscribe(s, userId, plan.id, "card", orderId), markPaid)
      : await runLedger(userId, {}, (s) => ({ ok: true, state: ledger.renewMembership(s, userId, orderId) }), markPaid);
  if (!r.ok) {
    await pg.cancel(paid.paymentKey, "멤버십 처리 실패 자동 취소").catch(() => {});
    await db.update(schema.paymentOrders).set({ status: "canceled", failReason: r.error }).where(eq(schema.paymentOrders.id, orderId));
    return r;
  }
  return { ok: true };
}

// ───────────── 크론: 기한 정산 + 멤버십 갱신 ─────────────

export async function runScheduledJobs() {
  const now = new Date().toISOString();
  // 1) 기한 지난 질문 자동 채택·환불 (한 건씩 독립 트랜잭션)
  const expired = await db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.status, "open"), lte(schema.posts.expiresAt, now)))
    .limit(500);
  let settled = 0;
  for (const { id } of expired) {
    const r = await runLedger(null, { postIds: [id] }, (s) => ({ ok: true, state: ledger.sweepPosts(s) }));
    if (r.ok) settled++;
  }

  // 2) 멤버십: 자동 갱신이면 결제 후 지급, 해지했거나 결제 실패면 종료
  const due = await db
    .select({ id: schema.users.id, plan: schema.users.membershipPlan, autoRenew: schema.users.membershipAutoRenew })
    .from(schema.users)
    .where(and(isNotNull(schema.users.membershipPlan), lte(schema.users.membershipRenewsAt, now)))
    .limit(500);
  let renewed = 0;
  let ended = 0;
  for (const u of due) {
    const r = u.autoRenew ? await chargeMembership(u.id, u.plan as MembershipPlanId, "membership_renewal") : { ok: false };
    if (r.ok) renewed++;
    else {
      await runLedger(u.id, {}, (s) => ({ ok: true, state: ledger.endMembership(s, u.id) }));
      ended++;
    }
  }
  return { settled, renewed, ended };
}
