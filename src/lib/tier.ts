import { TIERS, type Degree, type Tier, type TierId } from "./config";

export interface TierInput {
  experienceYears: number;
  /** 물리치료학회 인정 교육 이수 시간 */
  educationHours: number;
  degree: Degree;
}

export function meetsTier(t: Tier, { experienceYears, educationHours, degree }: TierInput) {
  return experienceYears >= t.minYears && educationHours >= t.minHours && (!t.needsDegree || degree !== "none");
}

/** 조건을 모두 충족하는 가장 높은 등급 */
export function tierFor(input: TierInput): Tier {
  for (let i = TIERS.length - 1; i >= 0; i--) if (meetsTier(TIERS[i], input)) return TIERS[i];
  return TIERS[0];
}

export function getTier(id: TierId): Tier {
  return TIERS.find((t) => t.id === id) ?? TIERS[0];
}

export function tierRank(id: TierId): number {
  return TIERS.findIndex((t) => t.id === id);
}

export function nextTier(id: TierId): Tier | undefined {
  return TIERS[tierRank(id) + 1];
}

export function gradeLabel(t: Tier) {
  return t.grade ? `${t.grade}등급` : "등급 외";
}

/** 다음 등급까지 부족한 조건 */
export function missingFor(t: Tier, input: TierInput) {
  const out: string[] = [];
  if (input.experienceYears < t.minYears) out.push(`경력 ${t.minYears - input.experienceYears}년`);
  if (input.educationHours < t.minHours) out.push(`교육 ${t.minHours - input.educationHours}시간`);
  if (t.needsDegree && input.degree === "none") out.push("석·박사 학위");
  return out;
}
