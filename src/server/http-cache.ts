import "server-only";
import { NextResponse } from "next/server";

// 비회원 조회 응답 짧은 캐시.
// 100만 명 부하 테스트에서 대부분의 트래픽은 로그인하지 않은 목록·상세 조회였고, 같은 페이지를 여러 사람이 동시에 봄.
// - 서버 메모리: 같은 주소는 TTL 동안 한 번만 DB 조회 (동시 요청도 하나로 합침)
// - CDN(Vercel 등): s-maxage 로 엣지에서 바로 응답
const cache = new Map<string, { at: number; body: unknown; pending?: Promise<unknown> }>();
const MAX_ENTRIES = 2000;

export async function guestCached(key: string, ttlMs: number, compute: () => Promise<unknown>) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.pending ? hit.pending : hit.body;
  const pending = compute();
  cache.set(key, { at: now, body: undefined, pending });
  try {
    const body = await pending;
    cache.set(key, { at: now, body });
    if (cache.size > MAX_ENTRIES) for (const k of [...cache.keys()].slice(0, cache.size - MAX_ENTRIES)) cache.delete(k);
    return body;
  } catch (e) {
    cache.delete(key);
    throw e;
  }
}

/** 로그인 여부에 따라 캐시 헤더를 달리한 JSON 응답 */
export function jsonFor(isGuest: boolean, body: unknown, sMaxAge = 15) {
  return NextResponse.json(body, {
    headers: isGuest
      ? {
          // 브라우저는 매번 확인(stale-while-revalidate를 브라우저에도 주면 뒤에서 재검증 요청이 계속 생김), CDN만 짧게 캐시
          "Cache-Control": `public, max-age=0, s-maxage=${sMaxAge}, must-revalidate`,
          "CDN-Cache-Control": `public, s-maxage=${sMaxAge}, stale-while-revalidate=60`,
          Vary: "Cookie",
        }
      : { "Cache-Control": "private, no-store" },
  });
}
