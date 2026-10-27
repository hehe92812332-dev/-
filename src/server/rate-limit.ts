import "server-only";
import { HttpError } from "./errors";

// 단일 서버용 간단한 고정 윈도 제한. 여러 인스턴스로 운영할 때는 Redis(Upstash 등)로 교체하세요.
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

/** 만료된 항목 정리 — 회원이 많아도 메모리가 계속 늘지 않도록 (100만 명 점검에서 발견) */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}

/** 정해진 시간 동안 처음 한 번만 true (조회수 중복 방지 등) */
export function firstTimeWithin(key: string, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (b && b.resetAt >= now) return false;
  buckets.set(key, { count: 1, resetAt: now + windowMs });
  return true;
}

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (++b.count > limit) throw new HttpError(429, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
}
