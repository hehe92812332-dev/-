import { NextResponse } from "next/server";
import { ARTICLE_SUBMIT_PER_DAY } from "@/lib/config";
import { findPersonalInfo, userTier } from "@/lib/ledger";
import { BODY_PARTS, NEWS_CATEGORIES } from "@/lib/news";
import { articleInput, articleText } from "@/lib/news-input";
import { guestCached, jsonFor } from "@/server/http-cache";
import { listArticles, myArticles, submitArticle } from "@/server/news";
import { viewerOf } from "@/server/queries";
import { rateLimit } from "@/server/rate-limit";
import { HttpError, handle, requireUser } from "@/server/session";

export const dynamic = "force-dynamic";

const oneOf = <T extends string>(list: readonly T[], v: string | null) => (v && (list as readonly string[]).includes(v) ? (v as T) : undefined);

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const sp = url.searchParams;
  if (sp.get("mine") === "1") {
    const u = await requireUser();
    return NextResponse.json(await myArticles(u.id), { headers: { "Cache-Control": "private, no-store" } });
  }
  const params = {
    category: oneOf(NEWS_CATEGORIES, sp.get("category")),
    bodyPart: oneOf(BODY_PARTS, sp.get("bodyPart")),
    q: sp.get("q")?.slice(0, 50) || undefined,
    cursor: sp.get("cursor")?.slice(0, 120) || null,
    limit: Number(sp.get("limit") ?? 0) || undefined,
  };
  // 글 목록은 누구에게나 같으므로 로그인 여부와 상관없이 짧게 캐시
  return jsonFor(true, await guestCached(`news:${url.search}`, 30_000, () => listArticles(params)), 60);
});

export const POST = handle(async (req: Request) => {
  const u = await requireUser();
  const viewer = await viewerOf(u);
  if (!viewer.user || !userTier(viewer.user)) throw new HttpError(403, "서류 심사를 마친 치료사만 원고를 보낼 수 있어요.");
  if (u.suspendedUntil && new Date(u.suspendedUntil).getTime() > Date.now()) throw new HttpError(403, "신고 처리로 이용이 일시 정지된 계정입니다.");
  rateLimit(`article:${u.id}`, ARTICLE_SUBMIT_PER_DAY, 86400_000);
  const p = articleInput.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
  if (findPersonalInfo(articleText(p.data))) throw new HttpError(400, "휴대폰 번호·주민등록번호 같은 개인정보는 올릴 수 없어요. 해당 부분을 지우고 다시 보내 주세요.");
  const id = await submitArticle({ id: u.id, name: u.name ?? "회원" }, p.data);
  return NextResponse.json({ ok: true, id });
});
