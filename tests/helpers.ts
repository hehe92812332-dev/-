import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

export async function resetDb() {
  await db.execute(sql`TRUNCATE users, posts, answers, answer_likes, transactions, ratings, chat_messages, reports, blocks,
    payment_orders, billing_keys, withdrawal_accounts, therapist_profiles, credential_documents, accounts, admin_logs, notifications, user_tag_counts, articles RESTART IDENTITY CASCADE`);
}

export async function makeUser(
  id: string,
  opts: { role?: "patient" | "therapist"; cash?: number; earned?: number; years?: number; hours?: number; degree?: string; verified?: boolean } = {},
) {
  await db.insert(schema.users).values({ id, name: id, email: `${id}@test.dev`, role: opts.role ?? "patient", cash: opts.cash ?? 0, earned: opts.earned ?? 0 });
  if (opts.role === "therapist")
    await db.insert(schema.therapistProfiles).values({
      userId: id,
      experienceYears: opts.years ?? 5,
      educationHours: opts.hours ?? 300,
      degree: opts.degree ?? "none",
      hospitalType: "hospital",
      hospitalName: "테스트병원",
      specialties: ["근골격계"],
      verification: opts.verified === false ? "pending" : "approved",
      licenseNumberEnc: "x",
    });
}

export async function wallet(id: string) {
  const [u] = await db.select().from(schema.users).where(sql`id = ${id}`);
  return { cash: u.cash, bonus: u.bonus, earned: u.earned };
}
