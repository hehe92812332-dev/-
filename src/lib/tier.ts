import { HOSPITAL_TYPES, SCORE_RULES, TIERS, type HospitalType, type Tier, type TierId } from "./config";

export interface ScoreInput {
  experienceYears: number;
  educationHours: number;
  hospitalType: HospitalType;
}

export interface ScoreBreakdown {
  experience: number;
  education: number;
  hospital: number;
  total: number;
}

export function calcScore({ experienceYears, educationHours, hospitalType }: ScoreInput): ScoreBreakdown {
  const experience = Math.min(
    Math.max(0, experienceYears) * SCORE_RULES.experiencePerYear,
    SCORE_RULES.experienceMax,
  );
  const education = Math.min(
    Math.floor(Math.max(0, educationHours) / SCORE_RULES.educationHoursPerPoint),
    SCORE_RULES.educationMax,
  );
  const hospital = HOSPITAL_TYPES[hospitalType]?.points ?? 0;
  return { experience, education, hospital, total: experience + education + hospital };
}

export function tierForScore(score: number): Tier {
  let result = TIERS[0];
  for (const t of TIERS) if (score >= t.minScore) result = t;
  return result;
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
