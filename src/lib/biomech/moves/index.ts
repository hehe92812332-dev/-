import type { Movement } from "../types";
import { EXAM } from "./exam";
import { GYM } from "./gym";
import { SPORT } from "./sport";

export const MOVEMENTS: Movement[] = [...GYM, ...SPORT, ...EXAM];

export const CATEGORIES: { id: Movement["category"]; label: string; desc: string }[] = [
  { id: "gym", label: "웨이트 트레이닝", desc: "스쿼트·데드리프트·프레스 등 근력 운동" },
  { id: "sport", label: "스포츠 퍼포먼스", desc: "스프린트·점프·방향 전환·던지기" },
  { id: "exam", label: "체대입시 실기", desc: "제자리멀리뛰기·서전트·좌전굴 등" },
];
