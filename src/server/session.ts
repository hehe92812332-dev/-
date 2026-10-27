import "server-only";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "./db";

export async function currentUserRow() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return u && !u.deletedAt ? u : null;
}

import { HttpError } from "./errors";

export { HttpError };

export async function requireUser(opts: { onboarded?: boolean } = { onboarded: true }) {
  const u = await currentUserRow();
  if (!u) throw new HttpError(401, "로그인이 필요합니다.");
  if (opts.onboarded && !u.role) throw new HttpError(403, "회원가입(온보딩)을 먼저 완료해 주세요.");
  return u;
}

export async function requireAdmin() {
  const u = await requireUser({ onboarded: false });
  if (!u.isAdmin) throw new HttpError(403, "관리자만 접근할 수 있습니다.");
  return u;
}

/** API 라우트 공통 오류 처리 */
export function handle<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ ok: false, error: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
  };
}
