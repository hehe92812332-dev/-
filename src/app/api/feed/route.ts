import { guestCached, jsonFor } from "@/server/http-cache";
import { CATEGORIES } from "@/lib/config";
import { feed, viewerOf } from "@/server/queries";
import { currentUserRow, handle } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const viewer = await viewerOf(await currentUserRow());
  const category = sp.get("category") ?? undefined;
  const status = sp.get("status");
  const run = () => feed(viewer, {
    board: sp.get("board") === "clinical" ? "clinical" : "patient",
    category: category && (CATEGORIES as readonly string[]).includes(category) ? category : undefined,
    status: status === "open" || status === "adopted" ? status : undefined,
    q: sp.get("q")?.slice(0, 50) ?? undefined,
    forMe: sp.get("forMe") === "1",
    authorId: sp.get("authorId") ?? undefined,
    cursor: sp.get("cursor"),
    limit: Number(sp.get("limit") ?? 20) || 20,
  });
  const guest = !viewer.row;
  return jsonFor(guest, guest ? await guestCached(`feed:${url.search}`, 10_000, run) : await run());
});
