import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

// ───────────── 회원 (Auth.js 테이블 + 서비스 필드) ─────────────

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").unique(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    image: text("image"),
    /** 온보딩 전에는 null */
    role: text("role").$type<"therapist" | "patient">(),
    avatarColor: text("avatar_color").notNull().default("#64748b"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    cash: integer("cash").notNull().default(0),
    bonus: integer("bonus").notNull().default(0),
    earned: integer("earned").notNull().default(0),
    membershipPlan: text("membership_plan"),
    membershipStartedAt: ts("membership_started_at"),
    membershipRenewsAt: ts("membership_renews_at"),
    membershipAutoRenew: boolean("membership_auto_renew").notNull().default(false),
    isAdmin: boolean("is_admin").notNull().default(false),
    suspendedUntil: ts("suspended_until"),
    termsAgreedAt: ts("terms_agreed_at"),
    /** 민감정보(건강정보) 별도 동의 시각 — 개인정보보호법 제23조 */
    sensitiveConsentAt: ts("sensitive_consent_at"),
    /** 회원 탈퇴 시각. 법정 보관 기록(거래 등)은 남기고 개인정보는 지웁니다 */
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    // 잔액이 음수가 되는 일은 DB 수준에서도 막습니다
    check("wallet_non_negative", sql`${t.cash} >= 0 AND ${t.bonus} >= 0 AND ${t.earned} >= 0`),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const therapistProfiles = pgTable("therapist_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  experienceYears: integer("experience_years").notNull(),
  educationHours: integer("education_hours").notNull(),
  degree: text("degree").notNull(),
  hospitalType: text("hospital_type").notNull(),
  hospitalName: text("hospital_name").notNull(),
  specialties: jsonb("specialties").$type<string[]>().notNull(),
  bio: text("bio").notNull().default(""),
  verification: text("verification").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
  rejectReason: text("reject_reason"),
  /** 면허번호 (AES-256-GCM 암호화) */
  licenseNumberEnc: text("license_number_enc").notNull(),
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  reviewedAt: ts("reviewed_at"),
});

/** 면허증·경력증명서·교육 이수증·학위증명서 */
export const credentialDocuments = pgTable(
  "credential_documents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"license" | "career" | "education" | "degree">().notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    uploadedAt: ts("uploaded_at").notNull().defaultNow(),
  },
  (t) => [index("documents_user_idx").on(t.userId)],
);

// ───────────── 질문·답변 ─────────────

export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    board: text("board").$type<"clinical" | "patient">().notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull(),
    targetTier: text("target_tier").notNull(),
    directTherapistId: text("direct_therapist_id").references(() => users.id),
    bounty: integer("bounty").notNull(),
    paidCash: integer("paid_cash").notNull(),
    paidBonus: integer("paid_bonus").notNull(),
    paidEarned: integer("paid_earned").notNull(),
    status: text("status").$type<"open" | "adopted" | "refunded">().notNull(),
    adoptedAnswerId: text("adopted_answer_id"),
    closedReason: text("closed_reason"),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    views: integer("views").notNull().default(0),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [index("posts_board_created_idx").on(t.board, t.createdAt), index("posts_open_expires_idx").on(t.status, t.expiresAt)],
);

export const answers = pgTable(
  "answers",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull(),
    tips: integer("tips").notNull().default(0),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [index("answers_post_idx").on(t.postId)],
);

export const answerLikes = pgTable(
  "answer_likes",
  {
    answerId: text("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.answerId, t.userId] })],
);

// ───────────── 토큰 원장 ─────────────

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    tokens: integer("tokens").notNull(),
    bonusTokens: integer("bonus_tokens"),
    krw: integer("krw"),
    method: text("method"),
    memo: text("memo").notNull(),
    createdAt: ts("created_at").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    postId: text("post_id"),
    orderId: text("order_id"),
    status: text("status"),
  },
  (t) => [index("tx_user_created_idx").on(t.userId, t.createdAt), index("tx_type_status_idx").on(t.type, t.status)],
);

export const ratings = pgTable(
  "ratings",
  {
    id: text("id").primaryKey(),
    fromId: text("from_id")
      .notNull()
      .references(() => users.id),
    toId: text("to_id")
      .notNull()
      .references(() => users.id),
    postId: text("post_id").notNull(),
    answerId: text("answer_id"),
    score: text("score").$type<"great" | "good" | "bad">().notNull(),
    tags: jsonb("tags").$type<string[]>().notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("ratings_to_idx").on(t.toId), index("ratings_post_idx").on(t.postId)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    room: text("room").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    kind: text("kind").$type<"text" | "study">().notNull(),
    createdAt: ts("created_at").notNull(),
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [index("chat_room_created_idx").on(t.room, t.createdAt)],
);

// ───────────── 신고·차단 ─────────────

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    detail: text("detail").notNull(),
    status: text("status").$type<"open" | "resolved" | "dismissed">().notNull(),
    createdAt: ts("created_at").notNull(),
    resolution: text("resolution"),
  },
  (t) => [index("reports_status_idx").on(t.status, t.createdAt)],
);

export const blocks = pgTable(
  "blocks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.blockedId] })],
);

// ───────────── 결제·정산 ─────────────

export const paymentOrders = pgTable(
  "payment_orders",
  {
    /** PG에 보내는 주문번호 */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").$type<"tokens" | "membership" | "membership_renewal">().notNull(),
    productId: text("product_id").notNull(),
    amount: integer("amount").notNull(),
    status: text("status").$type<"pending" | "paid" | "failed" | "canceled">().notNull(),
    provider: text("provider").notNull(),
    paymentKey: text("payment_key"),
    method: text("method"),
    failReason: text("fail_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    approvedAt: ts("approved_at"),
    canceledAt: ts("canceled_at"),
  },
  (t) => [index("orders_user_idx").on(t.userId, t.createdAt)],
);

/** 멤버십 정기결제용 빌링키 (암호화 저장) */
export const billingKeys = pgTable("billing_keys", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  customerKey: text("customer_key").notNull(),
  billingKeyEnc: text("billing_key_enc").notNull(),
  cardLabel: text("card_label"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** 환전 신청 입금 계좌 (암호화 저장, 관리자만 열람) */
export const withdrawalAccounts = pgTable("withdrawal_accounts", {
  txId: text("tx_id")
    .primaryKey()
    .references(() => transactions.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  accountEnc: text("account_enc").notNull(),
  processedAt: ts("processed_at"),
});

/** 관리자 처리 기록 (감사 로그) */
export const adminLogs = pgTable(
  "admin_logs",
  {
    id: text("id").primaryKey(),
    adminId: text("admin_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("admin_logs_created_idx").on(t.createdAt)],
);
