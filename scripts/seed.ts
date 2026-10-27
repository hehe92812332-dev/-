// 스테이징/개발 DB에 데모 데이터를 넣습니다. 운영 DB에서는 실행하지 마세요.
// 실행: npm run db:seed
import { sql } from "drizzle-orm";
import { seedChats, seedPosts, seedRatings, seedTransactions, seedUsers } from "../src/lib/seed";
import { encrypt } from "../src/server/crypto";
import { db, schema } from "../src/server/db";
import { fromPost, fromTx } from "../src/server/mappers";
import { NEWS_LIBRARY } from "../src/lib/news-library";
import { addDays, todayKST } from "../src/lib/news-types";
import { importLibrary } from "../src/server/news";
import { backfill } from "./backfill";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") throw new Error("운영 환경에서는 시드를 넣을 수 없습니다.");
  const [{ count }] = (await db.execute<{ count: string }>(sql`select count(*) from users`)).rows;
  if (Number(count) > 0 && !process.argv.includes("--force")) {
    console.log("이미 데이터가 있어 건너뜁니다. 덮어쓰려면 --force");
    process.exit(0);
  }
  await db.execute(sql`TRUNCATE users, posts, answers, answer_likes, transactions, ratings, chat_messages, reports, blocks,
    payment_orders, billing_keys, withdrawal_accounts, therapist_profiles, credential_documents, accounts, admin_logs, notifications, user_tag_counts, articles CASCADE`);

  for (const u of seedUsers()) {
    await db.insert(schema.users).values({
      id: u.id,
      name: u.name,
      email: `${u.id}@demo.ptbridge`,
      role: u.role,
      avatarColor: u.avatarColor,
      joinedAt: u.joinedAt,
      cash: u.wallet.cash,
      bonus: u.wallet.bonus,
      earned: u.wallet.earned,
      termsAgreedAt: u.joinedAt,
    });
    if (u.therapist)
      await db.insert(schema.therapistProfiles).values({
        userId: u.id,
        experienceYears: u.therapist.experienceYears,
        educationHours: u.therapist.educationHours,
        degree: u.therapist.degree,
        hospitalType: u.therapist.hospitalType,
        hospitalName: u.therapist.hospitalName,
        specialties: u.therapist.specialties,
        bio: u.therapist.bio,
        verification: "approved",
        licenseNumberEnc: encrypt(String(10000 + Math.floor(Math.random() * 90000))),
        reviewedAt: new Date().toISOString(),
      });
  }
  await db.insert(schema.users).values({ id: "u-admin", name: "운영자", email: "admin@ptbridge.dev", role: "patient", isAdmin: true, termsAgreedAt: new Date().toISOString() });

  for (const p of seedPosts()) {
    await db.insert(schema.posts).values(fromPost(p));
    for (const a of p.answers) {
      await db.insert(schema.answers).values({ id: a.id, postId: p.id, authorId: a.authorId, body: a.body, createdAt: a.createdAt, tips: a.tips });
      for (const userId of a.likes) await db.insert(schema.answerLikes).values({ answerId: a.id, userId });
    }
  }
  for (const t of seedTransactions()) await db.insert(schema.transactions).values(fromTx(t));
  for (const { revealed: _r, ...r } of seedRatings()) await db.insert(schema.ratings).values({ ...r, answerId: r.answerId ?? null });
  for (const c of seedChats()) await db.insert(schema.chatMessages).values({ ...c, channel: c.channel ?? "자유" });
  // 건강 소식: 기본 글 모음을 2주 전부터 하루 한 편씩 (개발·스테이징용 — 운영은 npm run news:import 로 검수 대기 상태로 넣으세요)
  const start = addDays(todayKST(), -14);
  await importLibrary(NEWS_LIBRARY.map((a, i) => ({ ...a, status: "approved" as const, publishOn: addDays(start, i), authorName: "PT 브릿지 편집팀" })));
  await backfill();
  console.log("시드 완료: 데모 회원 이메일 <id>@demo.ptbridge (예: u-patient@demo.ptbridge), 관리자 admin@ptbridge.dev");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
