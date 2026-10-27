import { guestCached, jsonFor } from "@/server/http-cache";
import { profile, viewerOf } from "@/server/queries";
import { currentUserRow, handle } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const viewer = await viewerOf(await currentUserRow());
  const guest = !viewer.row;
  return jsonFor(guest, guest ? await guestCached(`user:${id}`, 30_000, () => profile(viewer, id)) : await profile(viewer, id), 30);
});
