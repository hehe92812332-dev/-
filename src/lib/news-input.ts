// 건강 소식 원고 입력 형식 (zod). 원고 작성 화면과 서버에서만 불러옵니다.

import { z } from "zod";
import { BODY_PARTS, NEWS_CATEGORIES, type ArticleContent } from "./news-types";

const line = (min: number, max: number) => z.string().trim().min(min, `${min}자 이상 입력해 주세요.`).max(max, `${max}자 이내로 입력해 주세요.`);

/** 치료사 원고 제출 형식 */
export const articleInput = z.object({
  title: line(5, 60),
  category: z.enum(NEWS_CATEGORIES),
  bodyPart: z.enum(BODY_PARTS),
  summary: line(10, 200),
  causes: z.array(line(2, 200)).min(1, "원인을 1개 이상 적어 주세요.").max(6),
  exercises: z
    .array(
      z.object({
        name: line(2, 40),
        how: z.array(line(2, 200)).min(1, "운동 방법을 1단계 이상 적어 주세요.").max(6),
        dose: line(2, 60),
        caution: z.string().trim().max(200).optional().transform((v) => v || undefined),
      }),
    )
    .min(1, "운동을 1개 이상 적어 주세요.")
    .max(5),
  redFlags: z.array(line(2, 200)).min(1, "병원에 가야 하는 신호를 1개 이상 적어 주세요.").max(8),
  emergency: z.array(line(2, 200)).max(6).optional().transform((v) => (v?.length ? v : undefined)),
  tips: z.array(line(2, 200)).max(6).default([]),
});
/** 화면에서 보내는 값 */
export type ArticleInput = z.input<typeof articleInput>;
/** 검증·정리를 거친 값 */
export type ArticleData = z.output<typeof articleInput>;

/** 원고 전체 글자 (개인정보 검사용) */
export const articleText = (a: Omit<ArticleContent, "slug">) =>
  [a.title, a.summary, ...a.causes, ...a.exercises.flatMap((e) => [e.name, ...e.how, e.dose, e.caution ?? ""]), ...a.redFlags, ...(a.emergency ?? []), ...a.tips].join("\n");

