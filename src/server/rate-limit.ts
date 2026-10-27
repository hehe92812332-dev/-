import "server-only";
import { HttpError } from "./session";

// 단일 서버용 간단한 고정 윈도 제한. 여러 인스턴스로 운영할 때는 Redis(Upstash 등)로 교체하세요.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (++b.count > limit) throw new HttpError(429, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
}
