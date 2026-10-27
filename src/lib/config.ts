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

/** 접근성을 위한 질문 1건 비용 상한. 1:1 할증을 포함해도 이 값을 넘지 않습니다 (멤버십 할인은 상한 적용 후). */
export const MAX_QUESTION_COST = 100;

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

/** 최소 충전 토큰 수 (모든 충전 상품은 이 이상) */
export const MIN_PURCHASE_TOKENS = 300;

export const TOKEN_PACKAGES = [
  { id: "p300", tokens: 300, bonus: 15, price: 30_000, badge: "인기" },
  { id: "p500", tokens: 500, bonus: 40, price: 50_000 },
  { id: "p1000", tokens: 1000, bonus: 120, price: 100_000 },
  { id: "p2000", tokens: 2000, bonus: 300, price: 200_000, badge: "최대 혜택" },
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

/** 근무 기관 (프로필 표시용, 등급 산정에는 쓰지 않음) */
export const HOSPITAL_TYPES: Record<HospitalType, { label: string }> = {
  tertiary: { label: "상급종합병원" },
  general: { label: "종합병원" },
  rehab: { label: "재활전문병원" },
  hospital: { label: "병원" },
  nursing: { label: "요양병원" },
  clinic: { label: "의원 (정형외과·재활의학과 등)" },
  sports: { label: "스포츠·재활센터" },
  korean: { label: "한방병원" },
};

export type Degree = "none" | "master" | "doctor";

export const DEGREES: Record<Degree, string> = {
  none: "학사·전문학사",
  master: "석사",
  doctor: "박사",
};

export type TierId = "rough" | "pearl" | "opal" | "topaz" | "amethyst" | "emerald" | "sapphire" | "ruby" | "diamond";

export interface Tier {
  id: TierId;
  /** 1(최상위) ~ 8. 원석은 등급 외 */
  grade: number | null;
  name: string;
  /** 등급 조건: 임상 경력(년), 물리치료학회 인정 교육 시간, 석사·박사 학위 필요 여부 */
  minYears: number;
  minHours: number;
  needsDegree: boolean;
  /** 이 등급 이상의 치료사에게 질문할 때 드는 토큰 */
  questionCost: number;
  /** 배지 그라데이션 [시작, 끝] — 보석 색 */
  colors: [string, string];
  /** 밝은 배경 위 글자색 */
  text: string;
  description: string;
}

/** 낮은 등급 → 높은 등급 순. 조건은 경력·교육시간·학위를 모두 충족해야 합니다. */
export const TIERS: Tier[] = [
  {
    id: "rough",
    text: "#475569",
    grade: null,
    name: "원석",
    minYears: 0,
    minHours: 0,
    needsDegree: false,
    questionCost: 10,
    colors: ["#94a3b8", "#64748b"],
    description: "면허 인증 완료, 8등급 조건을 향해 다듬어지는 중",
  },
  {
    id: "pearl",
    text: "#78716c",
    grade: 8,
    name: "진주",
    minYears: 3,
    minHours: 200,
    needsDegree: false,
    questionCost: 20,
    colors: ["#cbd5e1", "#a8a29e"],
    description: "경력 3년 + 학회 인정 교육 200시간",
  },
  {
    id: "opal",
    text: "#0e7490",
    grade: 7,
    name: "오팔",
    minYears: 3,
    minHours: 200,
    needsDegree: true,
    questionCost: 25,
    colors: ["#f9a8d4", "#67e8f9"],
    description: "경력 3년 + 교육 200시간 + 석·박사",
  },
  {
    id: "topaz",
    text: "#c2410c",
    grade: 6,
    name: "토파즈",
    minYears: 5,
    minHours: 300,
    needsDegree: false,
    questionCost: 35,
    colors: ["#fbbf24", "#ea580c"],
    description: "경력 5년 + 교육 300시간",
  },
  {
    id: "amethyst",
    text: "#7e22ce",
    grade: 5,
    name: "자수정",
    minYears: 5,
    minHours: 300,
    needsDegree: true,
    questionCost: 45,
    colors: ["#c084fc", "#7e22ce"],
    description: "경력 5년 + 교육 300시간 + 석·박사",
  },
  {
    id: "emerald",
    text: "#047857",
    grade: 4,
    name: "에메랄드",
    minYears: 10,
    minHours: 400,
    needsDegree: false,
    questionCost: 55,
    colors: ["#34d399", "#047857"],
    description: "경력 10년 + 교육 400시간",
  },
  {
    id: "sapphire",
    text: "#1d4ed8",
    grade: 3,
    name: "사파이어",
    minYears: 10,
    minHours: 400,
    needsDegree: true,
    questionCost: 70,
    colors: ["#60a5fa", "#1d4ed8"],
    description: "경력 10년 + 교육 400시간 + 석·박사",
  },
  {
    id: "ruby",
    text: "#be123c",
    grade: 2,
    name: "루비",
    minYears: 15,
    minHours: 500,
    needsDegree: false,
    questionCost: 85,
    colors: ["#fb7185", "#be123c"],
    description: "경력 15년 + 교육 500시간",
  },
  {
    id: "diamond",
    text: "#4f46e5",
    grade: 1,
    name: "다이아몬드",
    minYears: 15,
    minHours: 500,
    needsDegree: true,
    questionCost: 100,
    colors: ["#a5f3fc", "#6366f1"],
    description: "경력 15년 + 교육 500시간 + 석·박사",
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

/** 만족도 온도 (당근 매너온도 방식): 모든 회원 36.5°C에서 시작, 평가에 따라 오르내립니다. */
export const BASE_TEMPERATURE = 36.5;

export const RATING_SCORES = {
  great: { label: "최고예요", emoji: "😍", delta: 0.5 },
  good: { label: "좋아요", emoji: "🙂", delta: 0.2 },
  bad: { label: "아쉬워요", emoji: "😕", delta: -0.5 },
} as const;

/** 질문자가 답변(치료사)을 평가할 때 고르는 항목 */
export const ANSWER_PRAISE_TAGS = ["설명이 이해하기 쉬워요", "근거가 명확해요", "친절하고 공감해줘요", "빠르게 답해줬어요", "실제로 도움이 됐어요"];
export const ANSWER_COMPLAINT_TAGS = ["답변이 너무 짧아요", "질문과 관련이 적어요", "어려운 용어가 많아요"];

/** 답변자가 질문자를 평가할 때 고르는 항목 */
export const ASKER_PRAISE_TAGS = ["질문이 구체적이에요", "감사 표현을 잘해요", "채택이 빨라요"];
export const ASKER_COMPLAINT_TAGS = ["정보가 부족했어요", "채택이 늦었어요"];
