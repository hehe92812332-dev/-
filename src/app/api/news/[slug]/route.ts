import { NextResponse } from "next/server";
import { guestCached, jsonFor } from "@/server/http-cache";
import { countView, getArticle } from "@/server/news";
import { firstTimeWithin } from "@/server/rate-limit";
import { currentUserRow, handle } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const row = await currentUserRow();
  const r = row
    ? await getArticle(slug, { id: row.id, isAdmin: row.isAdmin })
    : ((await guestCached(`article:${slug}`, 30_000, () => getArticle(slug, null))) as Awaited<ReturnType<typeof getArticle>>);
  // 조회수: 같은 사람(회원 id 또는 IP)은 6시간에 한 번만
  const who = row?.id ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  if (!r.preview && firstTimeWithin(`av:${who}:${r.article.id}`, 6 * 3600_000)) await countView(r.article.id);
  return row ? NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } }) : jsonFor(true, r, 60);
});
