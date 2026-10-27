import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORIES, DEGREES, HOSPITAL_TYPES } from "@/lib/config";
import { encrypt } from "@/server/crypto";
import { putDocument } from "@/server/storage";
import { db, schema } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { HttpError, handle, requireUser } from "@/server/session";

const MAX_FILE = 5 * 1024 * 1024;
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const DOC_KINDS = ["license", "career", "education", "degree"] as const;

const base = z.object({
  name: z.string().trim().min(2).max(20),
  role: z.enum(["patient", "therapist"]),
  agree: z.literal("true"),
  adult: z.literal("true"),
  sensitive: z.literal("true"),
});

const therapist = z.object({
  license: z.string().regex(/^\d{4,10}$/, "면허번호를 숫자로 입력해 주세요."),
  years: z.coerce.number().int().min(0).max(60),
  hours: z.coerce.number().int().min(0).max(10000),
  degree: z.enum(Object.keys(DEGREES) as [string, ...string[]]),
  hospitalType: z.enum(Object.keys(HOSPITAL_TYPES) as [string, ...string[]]),
  hospitalName: z.string().trim().max(60),
  specialties: z.array(z.enum(CATEGORIES)).min(1).max(5),
  bio: z.string().trim().max(200),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser({ onboarded: false });
  rateLimit(`onboarding:${user.id}`, 10, 3600_000);
  const form = await req.formData();
  const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);

  const b = base.safeParse({ name: get("name"), role: get("role"), agree: get("agree"), adult: get("adult"), sensitive: get("sensitive") });
  if (!b.success) throw new HttpError(400, "이름(2~20자), 회원 유형, 필수 동의 항목을 확인해 주세요.");
  const consent = { termsAgreedAt: new Date().toISOString(), sensitiveConsentAt: new Date().toISOString() };
  if (user.role && user.role !== b.data.role) throw new HttpError(400, "회원 유형은 변경할 수 없습니다. 고객센터로 문의해 주세요.");

  if (b.data.role === "patient") {
    await db.update(schema.users).set({ name: b.data.name, role: "patient", ...consent }).where(eq(schema.users.id, user.id));
    return NextResponse.json({ ok: true });
  }

  const t = therapist.safeParse({
    license: get("license"),
    years: get("years"),
    hours: get("hours"),
    degree: get("degree"),
    hospitalType: get("hospitalType"),
    hospitalName: get("hospitalName") ?? "",
    specialties: JSON.parse(get("specialties") ?? "[]"),
    bio: get("bio") ?? "",
  });
  if (!t.success) throw new HttpError(400, t.error.issues[0]?.message ?? "치료사 정보를 확인해 주세요.");

  const files: { kind: (typeof DOC_KINDS)[number]; file: File }[] = [];
  for (const kind of DOC_KINDS)
    for (const f of form.getAll(`doc_${kind}`))
      if (f instanceof File && f.size > 0) {
        if (f.size > MAX_FILE) throw new HttpError(400, "서류 파일은 5MB 이하만 올릴 수 있습니다.");
        if (!MIME.includes(f.type)) throw new HttpError(400, "서류는 PDF·JPG·PNG 파일만 올릴 수 있습니다.");
        files.push({ kind, file: f });
      }

  const [existing] = await db.select().from(schema.therapistProfiles).where(eq(schema.therapistProfiles.userId, user.id));
  if (existing?.verification === "approved") throw new HttpError(400, "이미 심사가 완료되었습니다. 정보 변경은 고객센터로 문의해 주세요.");
  if (!existing && !files.some((f) => f.kind === "license")) throw new HttpError(400, "면허증 사본을 첨부해 주세요.");
  if (t.data.years >= 3 && !existing && !files.some((f) => f.kind === "career"))
    throw new HttpError(400, "경력 3년 이상이면 경력증명서를 첨부해 주세요. (등급 심사에 필요합니다)");

  const profile = {
    experienceYears: t.data.years,
    educationHours: t.data.hours,
    degree: t.data.degree,
    hospitalType: t.data.hospitalType,
    hospitalName: t.data.hospitalName || HOSPITAL_TYPES[t.data.hospitalType as keyof typeof HOSPITAL_TYPES].label,
    specialties: t.data.specialties,
    bio: t.data.bio,
    verification: "pending" as const,
    rejectReason: null,
    licenseNumberEnc: encrypt(t.data.license),
    submittedAt: new Date().toISOString(),
  };

  // 파일은 트랜잭션 밖에서 먼저 저장 (객체 저장소 업로드가 DB 트랜잭션을 오래 붙잡지 않도록)
  const stored = await Promise.all(
    files.map(async ({ kind, file }) => {
      const id = crypto.randomUUID();
      return { id, kind, file, ...(await putDocument(user.id, id, file.type, Buffer.from(await file.arrayBuffer()))) };
    }),
  );
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ name: b.data.name, role: "therapist", ...consent }).where(eq(schema.users.id, user.id));
    if (existing) await tx.update(schema.therapistProfiles).set(profile).where(eq(schema.therapistProfiles.userId, user.id));
    else await tx.insert(schema.therapistProfiles).values({ userId: user.id, ...profile });
    for (const d of stored)
      await tx.insert(schema.credentialDocuments).values({
        id: d.id,
        userId: user.id,
        kind: d.kind,
        filename: d.file.name.slice(0, 120),
        mime: d.file.type,
        size: d.file.size,
        data: d.data,
        storageKey: d.storageKey,
      });
  });
  return NextResponse.json({ ok: true });
});
