import "server-only";
import { schema, type Tx } from "./db";

export type NotificationType =
  | "answer"
  | "adopted"
  | "direct_question"
  | "tip"
  | "verification"
  | "payout"
  | "no_answer"
  | "closed"
  | "article";

/** 알림 저장. 실서비스에서는 여기서 카카오 알림톡·이메일·푸시 발송을 함께 붙이면 됩니다. */
export async function notify(tx: Tx, userId: string, type: NotificationType, title: string, link?: string) {
  await tx.insert(schema.notifications).values({ id: `n-${crypto.randomUUID()}`, userId, type, title, link: link ?? null });
}
