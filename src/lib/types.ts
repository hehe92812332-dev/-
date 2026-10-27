import type { Category, HospitalType, MembershipPlanId, PaymentMethodId, TierId } from "./config";

export type Role = "therapist" | "patient";

export interface TherapistProfile {
  licenseVerified: boolean;
  experienceYears: number;
  educationHours: number;
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
  | "withdraw";

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
}
