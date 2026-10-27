import { NextResponse } from "next/server";
import { tierCounts } from "@/server/queries";
import { handle } from "@/server/session";

export const GET = handle(async () => {
  const { counts, questions } = await tierCounts();
  return NextResponse.json({ counts, questions }, { headers: { "Cache-Control": "public, max-age=300" } });
});
