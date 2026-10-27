// 건강 소식(오늘의 건강 정보) 글 형식. 모든 글은 원인 → 운동 → 병원에 가야 할 신호 → 생활 수칙 순서로 같은 모양을 가집니다.

export const NEWS_CATEGORIES = ["근골격계", "신경계"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const BODY_PARTS = ["목", "어깨", "팔꿈치·손목·손", "허리", "고관절·골반", "무릎", "발목·발", "턱", "머리·어지럼", "뇌·신경", "전신·균형"] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export interface Exercise {
  name: string;
  /** 따라 하기 단계 */
  how: string[];
  /** 횟수·시간 */
  dose: string;
  caution?: string;
}

export interface ArticleContent {
  slug: string;
  title: string;
  category: NewsCategory;
  bodyPart: BodyPart;
  summary: string;
  causes: string[];
  exercises: Exercise[];
  /** 병원에 가야 하는 신호 */
  redFlags: string[];
  /** 지체 없이 119·응급실이 필요한 신호 (있을 때만) */
  emergency?: string[];
  tips: string[];
}

export type ArticleStatus = "review" | "approved" | "rejected" | "archived";

export interface Article extends ArticleContent {
  id: string;
  status: ArticleStatus;
  /** 게시일 (한국 날짜, YYYY-MM-DD) — 이 날짜가 되면 공개 */
  publishOn: string | null;
  authorId: string | null;
  authorName: string;
  reviewNote?: string;
  views: number;
  createdAt: string;
}

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export const todayKST = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

export const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);
