import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Kakao from "next-auth/providers/kakao";
import Naver from "next-auth/providers/naver";
import { db, schema } from "@/server/db";

const AVATAR_COLORS = ["#f472b6", "#fb923c", "#38bdf8", "#a78bfa", "#34d399", "#f87171", "#facc15", "#60a5fa"];

/** 개발용 이메일 로그인 — 운영 환경에서는 절대 켜지지 않습니다 */
export const devLoginEnabled = process.env.DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

const isAdminEmail = (email?: string | null) =>
  !!email &&
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(email.toLowerCase());

export const enabledProviders = {
  kakao: !!process.env.AUTH_KAKAO_ID,
  naver: !!process.env.AUTH_NAVER_ID,
  dev: devLoginEnabled,
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  // 개발용 로그인(Credentials)과 함께 쓰기 위해 JWT 세션 사용. 회원 정보는 매 요청 DB에서 다시 읽습니다.
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: { signIn: "/login" },
  providers: [
    ...(enabledProviders.kakao ? [Kakao] : []),
    ...(enabledProviders.naver ? [Naver] : []),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: "dev",
            name: "개발용 로그인",
            credentials: { email: { label: "이메일" } },
            async authorize(c) {
              const email = String(c?.email ?? "").trim().toLowerCase();
              if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
              const [found] = await db.select().from(schema.users).where(eq(schema.users.email, email));
              if (found) return { id: found.id, name: found.name, email: found.email };
              const [created] = await db
                .insert(schema.users)
                .values({ id: crypto.randomUUID(), email, name: email.split("@")[0], avatarColor: AVATAR_COLORS[email.length % AVATAR_COLORS.length] })
                .returning();
              return { id: created.id, name: created.name, email: created.email };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      await db
        .update(schema.users)
        .set({ avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] })
        .where(eq(schema.users.id, user.id));
    },
    async signIn({ user }) {
      // ADMIN_EMAILS에 등록된 이메일은 로그인 시 관리자 권한 부여
      if (user.id && isAdminEmail(user.email)) await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, user.id));
    },
  },
});
