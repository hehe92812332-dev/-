// 서비스 정책 값. 등급 기준·토큰 가격·수수료를 바꿀 때는 이 파일만 수정하면 됩니다.

export const SITE = {
  name: "PT 브릿지",
  nameEn: "PT Bridge",
  tagline: "물리치료사와 환자를 잇는 임상 지식 플랫폼",
};

/** 토큰 1개당 원화 가치 */
export const TOKEN_KRW = 100;

/** 답변 채택 시 플랫폼 수수료 (답변자가 받는 토큰에서 차감) */
export const SETTLEMENT_FEE_RATE = 0.15;

/** 환전 시 원천징수 (사업소득 3.3%) */
export const WITHHOLDING_TAX_RATE = 0.033;

/** 최소 환전 토큰 수 */
export const MIN_WITHDRAW_TOKENS = 500;

/** 질문 후 답변 채택 기한(일). 기한 내 채택이 없으면 가장 추천 많은 답변이 자동 채택, 답변이 없으면 전액 환불됩니다. */
export const ADOPT_DEADLINE_DAYS = 7;

/** 1:1 지정 질문: 지정한 치료사가 이 시간 안에 답변하지 않으면 자동 환불 (숨고의 미열람 견적 환불 방식) */
export const DIRECT_ANSWER_HOURS = 48;

/** 1:1 지정 질문 비용 = 해당 치료사 등급 질문 비용 × 배수 (JustAnswer식 전문가 지정) */
export const DIRECT_COST_MULTIPLIER = 1.5;

/** 채택 보상·팁이 환전 가능해지기까지의 정산 대기 기간 (크몽식 구매확정 후 정산) */
export const SETTLEMENT_HOLD_DAYS = 3;

/** 충전 후 이 기간 안에, 사용하지 않은 충전 토큰은 결제 취소(청약철회) 가능 */
export const REVOKE_DAYS = 7;

/** 좋은 답변에 보내는 감사 팁 (토스·카카오 후원, 슈퍼챗 방식) */
export const TIP_OPTIONS = [5, 10, 30] as const;

/** 현상금 추가 단위 (지식iN 내공 추가 / Stack Overflow bounty 방식) */
export const BOUNTY_ADD_OPTIONS = [10, 20, 50] as const;

export const PAYMENT_METHODS = [
  { id: "card", label: "신용·체크카드" },
  { id: "kakaopay", label: "카카오페이" },
  { id: "naverpay", label: "네이버페이" },
  { id: "tosspay", label: "토스페이" },
  { id: "phone", label: "휴대폰 결제" },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

/** 월 멤버십: 매달 토큰 지급 + 질문 할인 (JustAnswer·쿠팡 와우식 구독) */
export const MEMBERSHIP_PLANS = [
  {
    id: "basic",
    name: "베이직",
    price: 9_900,
    monthlyTokens: 99,
    monthlyBonus: 15,
    discountRate: 0.1,
    perks: ["매월 99토큰 + 보너스 15토큰", "모든 질문 10% 할인", "답변 등록 알림"],
  },
  {
    id: "premium",
    name: "프리미엄",
    price: 29_000,
    monthlyTokens: 290,
    monthlyBonus: 70,
    discountRate: 0.2,
    noDirectSurcharge: true,
    perks: ["매월 290토큰 + 보너스 70토큰", "모든 질문 20% 할인", "1:1 지정 질문 할증 면제"],
    badge: "추천",
  },
] as const;

export type MembershipPlanId = (typeof MEMBERSHIP_PLANS)[number]["id"];

export const TOKEN_PACKAGES = [
  { id: "p100", tokens: 100, bonus: 0, price: 10_000 },
  { id: "p300", tokens: 300, bonus: 15, price: 30_000, badge: "인기" },
  { id: "p500", tokens: 500, bonus: 40, price: 50_000 },
  { id: "p1000", tokens: 1000, bonus: 120, price: 100_000, badge: "최대 혜택" },
] as const;

export type HospitalType =
  | "tertiary"
  | "general"
  | "rehab"
  | "hospital"
  | "nursing"
  | "clinic"
  | "sports"
  | "korean";

export const HOSPITAL_TYPES: Record<HospitalType, { label: string; points: number }> = {
  tertiary: { label: "상급종합병원", points: 30 },
  general: { label: "종합병원", points: 25 },
  rehab: { label: "재활전문병원", points: 25 },
  hospital: { label: "병원", points: 20 },
  nursing: { label: "요양병원", points: 15 },
  clinic: { label: "의원 (정형외과·재활의학과 등)", points: 15 },
  sports: { label: "스포츠·재활센터", points: 15 },
  korean: { label: "한방병원", points: 15 },
};

/** 점수 산정 방식: 경력 최대 40점 + 교육시간 최대 30점 + 근무기관 최대 30점 = 100점 */
export const SCORE_RULES = {
  experiencePerYear: 2,
  experienceMax: 40,
  educationHoursPerPoint: 10,
  educationMax: 30,
};

export type TierId = "rookie" | "pro" | "expert" | "master" | "legend";

export interface Tier {
  id: TierId;
  name: string;
  minScore: number;
  /** 이 등급 이상의 치료사에게 질문할 때 드는 토큰 */
  questionCost: number;
  color: string;
  description: string;
}

export const TIERS: Tier[] = [
  {
    id: "rookie",
    name: "루키",
    minScore: 0,
    questionCost: 10,
    color: "#64748b",
    description: "면허 인증을 마친 신규 치료사",
  },
  {
    id: "pro",
    name: "프로",
    minScore: 30,
    questionCost: 20,
    color: "#0ea5e9",
    description: "임상 경험을 쌓아가는 치료사",
  },
  {
    id: "expert",
    name: "엑스퍼트",
    minScore: 50,
    questionCost: 35,
    color: "#10b981",
    description: "전문 분야를 갖춘 숙련 치료사",
  },
  {
    id: "master",
    name: "마스터",
    minScore: 70,
    questionCost: 60,
    color: "#8b5cf6",
    description: "풍부한 경력과 교육 이수를 갖춘 치료사",
  },
  {
    id: "legend",
    name: "레전드",
    minScore: 85,
    questionCost: 100,
    color: "#f59e0b",
    description: "최상위 임상 전문가",
  },
];

export const CATEGORIES = [
  "근골격계",
  "신경계",
  "스포츠 재활",
  "소아",
  "심폐",
  "노인·요양",
  "도수치료",
  "운동치료",
  "통증",
  "기타",
] as const;

export type Category = (typeof CATEGORIES)[number];
