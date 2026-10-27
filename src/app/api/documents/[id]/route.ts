import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getDocument } from "@/server/storage";
import { HttpError, handle, requireUser } from "@/server/session";

/** 서류 열람: 관리자 또는 본인만 */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ onboarded: false });
  const { id } = await ctx.params;
  const [doc] = await db.select().from(schema.credentialDocuments).where(eq(schema.credentialDocuments.id, id));
  if (!doc || (!user.isAdmin && doc.userId !== user.id)) throw new HttpError(404, "서류를 찾을 수 없습니다.");
  const body = await getDocument(doc);
  if (!body) throw new HttpError(404, "서류 파일을 찾을 수 없습니다.");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
