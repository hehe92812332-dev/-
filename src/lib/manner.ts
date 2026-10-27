import { BASE_TEMPERATURE, RATING_SCORES } from "./config";
import type { Rating } from "./types";

/** 받은 평가로 계산한 만족도 온도 (0~99°C) */
export function temperatureOf(ratings: Rating[], userId: string) {
  const sum = ratings.filter((r) => r.toId === userId).reduce((t, r) => t + RATING_SCORES[r.score].delta, 0);
  return Math.round(Math.min(99, Math.max(0, BASE_TEMPERATURE + sum)) * 10) / 10;
}

/** 받은 칭찬·아쉬운 점 태그를 많이 받은 순으로 */
export function tagCounts(ratings: Rating[], userId: string) {
  const counts = new Map<string, number>();
  for (const r of ratings) if (r.toId === userId) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function satisfactionRate(ratings: Rating[], userId: string) {
  const mine = ratings.filter((r) => r.toId === userId);
  if (mine.length === 0) return undefined;
  return Math.round((mine.filter((r) => r.score !== "bad").length / mine.length) * 100);
}

/** 온도 구간별 색과 표정 */
export function temperatureStyle(temp: number) {
  if (temp < 30) return { color: "#1d4ed8", face: "😟" };
  if (temp < BASE_TEMPERATURE) return { color: "#0ea5e9", face: "🙂" };
  if (temp < 40) return { color: "#10b981", face: "😊" };
  if (temp < 50) return { color: "#f59e0b", face: "😄" };
  return { color: "#ef4444", face: "🥰" };
}
