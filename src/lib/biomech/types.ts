import type { Body, Profile } from "./anthropometry";
import type { Vec3 } from "./math";
import type { Pose, PoseSpec } from "./pose";

export type Category = "gym" | "sport" | "exam";

export type LoadKind = "barbell" | "dumbbell" | "kettlebell" | "medball" | "handball" | "plate" | "none";

export interface LoadState {
  kind: LoadKind;
  mass: number;
  center: Vec3;
  /** 바벨 축 방향 (좌우) */
  axis?: Vec3;
  /** 손을 떠난 상태 (던지기) */
  released?: boolean;
  /** 몸 무게중심 계산에 넣을지 (손을 떠난 공·벤치에 놓인 바 등은 제외) */
  carried: boolean;
  /** 몸에 얹힌 부하 (등·쇄골·골반) — 어깨 모멘트에서 제외 */
  onBody?: boolean;
}

export interface Contact {
  id: "L" | "R" | "handL" | "handR" | "seat" | "back";
  group: "feet" | "hands" | "body";
  /** 지지 영역 꼭짓점 (지면 위) */
  pts: Vec3[];
  /** 앞-뒤 하중 분포를 볼 축: [뒤꿈치, 발끝] */
  axis?: [Vec3, Vec3];
}

export interface Surface {
  kind: "bench" | "box" | "bar" | "wall" | "mat" | "line" | "platform";
  /** 중심, 크기 (x: 좌우, y: 높이, z: 앞뒤) */
  center: Vec3;
  size: Vec3;
  label?: string;
}

/** 프레임별 보상 신호 (0 = 없음) */
export interface FrameMeta {
  heelRise?: [number, number];
  /** 요추 굴곡 보상 (버트윙크·등 굽음), 도 */
  lumbarFlex?: number;
  /** 요추 과신전 보상, 도 */
  lumbarExt?: number;
  /** 무릎 외반 (안쪽 무너짐), 도 */
  valgus?: [number, number];
  /** 기준 체형 대비 깊이 손실 (0~1) */
  depthLoss?: number;
  /** 몸통 숙임 (도) */
  trunkLean?: number;
  /** 몸통 숙임 중 발목 제한으로 추가된 각도 */
  trunkExtra?: number;
  /** 골반 측방 기울기 (도) */
  obliq?: number;
  /** 골반 측방 이동 (m) */
  shiftX?: number;
  /** 어깨 가동 부족분 (도) */
  shoulderDeficit?: number;
  /** 햄스트링 한계에 걸린 정도 (도) */
  hamstringLimit?: number;
  /** 바가 정강이와 부딪힘 등 경로 이탈 (m) */
  barDrift?: number;
  /** 머리 전방 (도) */
  neckFlex?: number;
  /** 동적 전이 구간 (정적 균형 판정 제외) */
  transient?: boolean;
  /** 착지·커팅 시 무릎 외반 하중 지표 */
  kneeLoad?: number;
}

export interface MoveFrame {
  spec: PoseSpec;
  pose: Pose;
  load?: LoadState;
  contacts: Contact[];
  surfaces?: Surface[];
  meta: FrameMeta;
  phase: string;
  /** 지지 기반 (dynamic 이동 보정 시 사용) */
  contactFeet?: ("L" | "R")[];
  /** 접지 높이 (박스 위 등) */
  groundY?: number;
}

export interface Ctx {
  body: Body;
  profile: Profile;
  loadKg: number;
  /** 표준 체형 계산인지 (설명 문구 비교용) */
  isRef?: boolean;
  cache: Record<string, unknown>;
}

export interface Metric {
  id: string;
  label: string;
  value: number;
  unit: string;
  /** 표준 체형 값 (같은 키·체중, 기본 가동성) */
  ref?: number;
  digits?: number;
  note?: string;
  /** 높을수록 좋은지 */
  better?: "high" | "low";
}

export interface Movement {
  id: string;
  name: string;
  en: string;
  category: Category;
  group: string;
  summary: string;
  cues: string[];
  load: { kind: LoadKind; default: number; min: number; max: number; step: number; label: string; rmPerBw?: number } | null;
  /** 정적(근력) 동작은 준정적 분석, 동적 동작은 무게중심 가속도로 지면반력 계산 */
  kind: "static" | "dynamic";
  /** 지지 방식 */
  support: "feet" | "bench" | "floor" | "hang" | "hands-feet" | "seat";
  /** 반복 주기, 시간 매핑 [t, 초] */
  timeline: (ctx: Ctx) => [number, number][];
  frame: (ctx: Ctx, t: number) => MoveFrame;
  /** dynamic 동작: 접지 발 고정·체공 탄도 보정 */
  dynamics?: { cyclic: boolean; lockFeet: boolean; ballistic: boolean };
  metrics?: (ctx: Ctx, frames: SimFrame[]) => Metric[];
  /** 카메라 힌트 */
  view?: { yaw?: number; dist?: number; followZ?: boolean };
}

export interface ContactLoad {
  id: Contact["id"];
  share: number;
  kg: number;
  /** 0 = 뒤꿈치, 1 = 앞꿈치 */
  fore: number;
  cop: Vec3;
}

export interface SimFrame extends MoveFrame {
  t: number;
  time: number;
  com: Vec3;
  bodyCom: Vec3;
  /** 수직 지면반력 합 (N) */
  grf: number;
  loads: ContactLoad[];
  angles: import("./pose").Angles;
  /** 관절 모멘트 요구량 (N·m, 다리는 좌우 평균) */
  moments: { ankle: number; knee: number; hip: number; lumbar: number; shoulder: number };
  /** 무게중심이 지지면 안에 있는지, 경계까지 거리(m, 음수 = 밖) */
  support: { inside: boolean; margin: number };
  /** 무릎 안쪽 이동 (m, + = 안쪽) */
  kneeMedial: [number, number];
}
