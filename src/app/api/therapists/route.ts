import { guestCached, jsonFor } from "@/server/http-cache";
import { CATEGORIES, TIERS, type TierId } from "@/lib/config";
import { therapistDirectory, viewerOf } from "@/server/queries";
import { currentUserRow, handle } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const spec = sp.get("spec") ?? undefined;
  const tier = sp.get("tier") as TierId | null;
  const viewer = await viewerOf(await currentUserRow());
  // 치료사 목록은 로그인 여부와 관계없이 같은 공개 정보이므로, 항상 '비회원' 기준으로 만들어 함께 캐시 (1분)
  // (로그인한 회원 기준으로 만들면 본인 지갑 등이 캐시에 섞일 수 있음)
  const run = async () =>
    therapistDirectory(await viewerOf(null), {
      spec: spec && (CATEGORIES as readonly string[]).includes(spec) ? spec : undefined,
      tier: tier && TIERS.some((t) => t.id === tier) ? tier : undefined,
      sort: sp.get("sort") === "temp" ? "temp" : "tier",
      cursor: sp.get("cursor"),
      limit: Number(sp.get("limit") ?? 30) || 30,
    });
  return jsonFor(!viewer.row, await guestCached(`therapists:${new URL(req.url).search}`, 60_000, run), 60);
});
