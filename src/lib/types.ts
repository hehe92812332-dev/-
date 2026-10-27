import type { Category, HospitalType, TierId } from "./config";

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

export interface User {
  id: string;
  name: string;
  role: Role;
  avatarColor: string;
  joinedAt: string;
  therapist?: TherapistProfile;
  wallet: {
    /** 현금으로 구매한 토큰 (환전 불가, 질문에 사용) */
    purchased: number;
    /** 답변 채택으로 받은 토큰 (환전 가능) */
    earned: number;
  };
}

/** clinical: 치료사 전용 임상 토론, patient: 환자 Q&A */
export type Board = "clinical" | "patient";

export interface Answer {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  likes: string[];
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
  /** 질문자가 걸어 둔 토큰 (에스크로) */
  bounty: number;
  status: "open" | "adopted" | "cancelled";
  adoptedAnswerId?: string;
  createdAt: string;
  views: number;
  answers: Answer[];
}

export type TxType = "purchase" | "ask" | "refund" | "reward" | "withdraw";

export interface Transaction {
  id: string;
  userId: string;
  type: TxType;
  /** 토큰 증감 (+/-) */
  tokens: number;
  krw?: number;
  memo: string;
  createdAt: string;
}
