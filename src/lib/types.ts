import type { Category, Degree, HospitalType, MembershipPlanId, PaymentMethodId, TierId } from "./config";

export type Role = "therapist" | "patient";

export type VerificationStatus = "pending" | "approved" | "rejected";

export interface TherapistProfile {
  /** 면허·경력·교육·학위 서류 심사 통과 여부. 통과 전에는 등급이 없고 답변·라운지를 이용할 수 없습니다. */
  licenseVerified: boolean;
  verification?: VerificationStatus;
  /** 반려 사유 (본인에게만 표시) */
  rejectReason?: string;
  experienceYears: number;
  /** 물리치료학회 인정 교육 이수 시간 */
  educationHours: number;
  degree: Degree;
  hospitalType: HospitalType;
  hospitalName: string;
  specialties: Category[];
  bio: string;
}

/**
 * 토큰 지갑. 사용 순서는 bonus → cash → earned.
 * - cash: 현금으로 충전한 토큰. 질문에 사용, 미사용분은 청약철회 가능, 환전 불가
 * - bonus: 충전·멤버십 보너스. 질문에 사용, 환전·청약철회 불가
 * - earned: 답변 채택·팁으로 받은 토큰. 정산 대기 후 현금 환전 가능
 */
export interface Wallet {
  cash: number;
  bonus: number;
  earned: number;
}

export interface Membership {
  plan: MembershipPlanId;
  startedAt: string;
  renewsAt: string;
  autoRenew: boolean;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  avatarColor: string;
  joinedAt: string;
  therapist?: TherapistProfile;
  wallet: Wallet;
  membership?: Membership;
  isAdmin?: boolean;
  /** 이용 정지 종료 시각 (신고 처리 결과) */
  suspendedUntil?: string;
  /** 서버가 미리 계산해 내려주는 값 (서버 모드). 없으면 화면에서 평가 목록으로 계산 */
  stats?: UserStats;
}

export interface UserStats {
  temperature: number;
  ratingCount: number;
  adoptedCount: number;
  topTag?: [string, number];
}

/** clinical: 치료사 전용 임상 토론, patient: 환자 Q&A */
export type Board = "clinical" | "patient";

export interface Answer {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  likes: string[];
  /** 받은 감사 팁 합계 (수수료 차감 전) */
  tips: number;
  /** 신고 처리로 숨김 */
  hidden?: boolean;
}

export interface Post {
  id: string;
  board: Board;
  authorId: string;
  title: string;
  body: string;
  category: Category;
  /** 답변 가능한 최소 등급 */
  targetTier: TierId;
  /** 1:1 지정 질문이면 지정된 치료사 id. 이 치료사만 답변할 수 있습니다. */
  directTherapistId?: string;
  /** 답변이 없으면 하루마다 한 단계씩 등급을 낮추고 차액 환불 (기본 켜짐) */
  autoLower?: boolean;
  /** 마지막으로 등급이 정해진 시각 (작성 또는 낮춤) */
  tierChangedAt?: string;
  /** 질문자가 걸어 둔 토큰 (에스크로). 현상금 추가 시 늘어납니다. */
  bounty: number;
  /** 에스크로 토큰이 어느 지갑에서 나왔는지 — 환불 시 같은 곳으로 돌려줍니다. */
  paidFrom: Wallet;
  status: "open" | "adopted" | "refunded";
  adoptedAnswerId?: string;
  /** 자동 채택/환불이 일어난 경우 사유 */
  closedReason?: "auto_adopt" | "no_answer" | "cancelled";
  createdAt: string;
  /** 이 시각이 지나면 자동 정산 (일반 질문 7일, 1:1 질문은 48시간 내 답변 없으면 환불) */
  expiresAt: string;
  views: number;
  answers: Answer[];
  /** 목록 조회 시 답변 본문 없이 개수만 받을 때 */
  answerCount?: number;
  hidden?: boolean;
}

export type TxType =
  | "purchase"
  | "revoke"
  | "membership"
  | "ask"
  | "bounty"
  | "refund"
  | "reward"
  | "tip_sent"
  | "tip_received"
  | "withdraw"
  | "withdraw_cancel"
  | "balance_refund"
  | "balance_refund_cancel"
  | "lower_tier"
  | "article_reward";

export interface Transaction {
  id: string;
  userId: string;
  type: TxType;
  /** 토큰 증감 (+/-) */
  tokens: number;
  /** 보너스 토큰 증감 (충전·멤버십 보너스) */
  bonusTokens?: number;
  krw?: number;
  method?: PaymentMethodId;
  memo: string;
  createdAt: string;
  /** purchase: 청약철회 완료 여부 */
  revoked?: boolean;
  postId?: string;
  /** 결제 주문 id (purchase·membership) — 결제 취소 시 PG 환불에 사용 */
  orderId?: string;
  /** withdraw: 환전 처리 상태 */
  status?: "requested" | "paid" | "rejected";
}

export type RatingScore = "great" | "good" | "bad";

/** 만족도 평가. 질문자 → 답변자(answerId 있음), 답변자 → 질문자(answerId 없음) 양방향 */
export interface Rating {
  id: string;
  fromId: string;
  toId: string;
  postId: string;
  answerId?: string;
  score: RatingScore;
  tags: string[];
  createdAt: string;
  /** 서버가 공개 여부를 판정해 내려준 경우 true (상호 평가 완료 또는 블라인드 기간 경과) */
  revealed?: boolean;
}

/** 등급 라운지 채팅. study 메시지는 방 상단에 스터디 공지로 고정됩니다. */
export interface ChatMessage {
  id: string;
  room: TierId;
  authorId: string;
  body: string;
  kind: "text" | "study";
  /** 라운지 채널 (LOUNGE_CHANNELS) */
  channel?: string;
  createdAt: string;
  hidden?: boolean;
}

export type ReportTarget = "post" | "answer" | "chat" | "user";

export interface Report {
  id: string;
  reporterId: string;
  targetType: ReportTarget;
  targetId: string;
  targetUserId: string;
  reason: string;
  detail: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  resolution?: string;
}

export interface Block {
  userId: string;
  blockedId: string;
  createdAt: string;
}
