import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "@/server/db";
import { cancelPurchase, confirmTokenOrder, prepareTokenOrder } from "@/server/payments";
import { makeUser, resetDb, wallet } from "./helpers";

beforeEach(resetDb);
afterAll(resetDb);

describe("결제 (mock 결제사)", () => {
  it("금액을 조작하면 승인하지 않는다", async () => {
    await makeUser("buyer");
    const o = await prepareTokenOrder("buyer", "p300", "card");
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const r = await confirmTokenOrder("buyer", { orderId: o.orderId, paymentKey: "pk", amount: 100 });
    expect(r.ok).toBe(false);
    expect(await wallet("buyer")).toEqual({ cash: 0, bonus: 0, earned: 0 });
  });

  it("같은 주문 승인이 동시에 여러 번 와도 한 번만 지급한다", async () => {
    await makeUser("buyer2");
    const o = await prepareTokenOrder("buyer2", "p300", "kakaopay");
    if (!o.ok) throw new Error(o.error);
    const results = await Promise.all(Array.from({ length: 5 }, () => confirmTokenOrder("buyer2", { orderId: o.orderId, paymentKey: "pk2", amount: 30000 })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await wallet("buyer2")).toEqual({ cash: 300, bonus: 15, earned: 0 });
    const txs = await db.select().from(schema.transactions).where(eq(schema.transactions.userId, "buyer2"));
    expect(txs).toHaveLength(1);
  });

  it("다른 회원의 주문은 승인할 수 없다", async () => {
    await makeUser("buyer3");
    await makeUser("thief");
    const o = await prepareTokenOrder("buyer3", "p300", "card");
    if (!o.ok) throw new Error(o.error);
    expect((await confirmTokenOrder("thief", { orderId: o.orderId, paymentKey: "pk", amount: 30000 })).ok).toBe(false);
  });

  it("청약철회하면 토큰 회수 + 주문 취소", async () => {
    await makeUser("buyer4");
    const o = await prepareTokenOrder("buyer4", "p500", "card");
    if (!o.ok) throw new Error(o.error);
    await confirmTokenOrder("buyer4", { orderId: o.orderId, paymentKey: "pk4", amount: 50000 });
    const [tx] = await db.select().from(schema.transactions).where(eq(schema.transactions.userId, "buyer4"));
    expect((await cancelPurchase("buyer4", tx.id)).ok).toBe(true);
    expect(await wallet("buyer4")).toEqual({ cash: 0, bonus: 0, earned: 0 });
    const [order] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, o.orderId));
    expect(order.status).toBe("canceled");
    expect((await cancelPurchase("buyer4", tx.id)).ok).toBe(false); // 두 번 취소 불가
  });
});
