// 스포츠 퍼포먼스 훈련 동작 (동적)
import { G, sampleKeys, type Key } from "../kit";
import { clamp, lerp, lerpV, smooth, type Vec3 } from "../math";
import type { FootPlace } from "../pose";
import type { Ctx, LoadState, Metric, Movement, SimFrame } from "../types";
import { ballAt, comRelFeet, dynFrame, flightTime, plantFrame, takeoffSpeed, type DynOpts, type PlantOpts } from "./dyn";

const maxOf = (frames: SimFrame[], f: (x: SimFrame) => number) => frames.reduce((m, x) => Math.max(m, f(x)), -Infinity);
const minOf = (frames: SimFrame[], f: (x: SimFrame) => number) => frames.reduce((m, x) => Math.min(m, f(x)), Infinity);
const bw = (ctx: Ctx) => ctx.body.M * G;

/* ───────────── 달리기 ───────────── */

interface RunCfg {
  legKeys: Key[]; // 왼다리 기준 (phase 0 = 착지)
  armKeys: Key[]; // 반대쪽 다리 phase 기준
  duty: number;
  lean: number;
  trunk: number;
}

const SPRINT: RunCfg = {
  duty: 0.22,
  lean: 4,
  trunk: 4,
  legKeys: [
    { t: 0, hip: 32, knee: 18, ank: -2 },
    { t: 0.1, hip: 12, knee: 40, ank: 16 },
    { t: 0.22, hip: -18, knee: 22, ank: -28 },
    { t: 0.34, hip: -14, knee: 92, ank: -18 },
    { t: 0.48, hip: 30, knee: 126, ank: 2 },
    { t: 0.62, hip: 70, knee: 100, ank: 6 },
    { t: 0.78, hip: 72, knee: 48, ank: 4 },
    { t: 0.9, hip: 50, knee: 22, ank: 0 },
  ],
  armKeys: [
    { t: 0, sh: 15, el: 85 },
    { t: 0.22, sh: -40, el: 100 },
    { t: 0.45, sh: -30, el: 95 },
    { t: 0.7, sh: 62, el: 70 },
    { t: 0.85, sh: 55, el: 75 },
  ],
};

const ACCEL: RunCfg = {
  duty: 0.36,
  lean: 36,
  trunk: 2,
  legKeys: [
    { t: 0, hip: 58, knee: 62, ank: 12 },
    { t: 0.16, hip: 36, knee: 52, ank: 20 },
    { t: 0.36, hip: -2, knee: 12, ank: -28 },
    { t: 0.5, hip: 14, knee: 92, ank: -12 },
    { t: 0.66, hip: 64, knee: 112, ank: 2 },
    { t: 0.82, hip: 80, knee: 96, ank: 8 },
    { t: 0.93, hip: 64, knee: 86, ank: 10 },
  ],
  armKeys: [
    { t: 0, sh: 25, el: 90 },
    { t: 0.3, sh: -45, el: 100 },
    { t: 0.55, sh: -25, el: 95 },
    { t: 0.8, sh: 75, el: 75 },
  ],
};

function sprintEstimate(ctx: Ctx, accel: boolean) {
  const b = ctx.body;
  const p = b.capacity.power / 100;
  const sexF = b.sex === "f" ? 0.9 : 1;
  const bmi = b.M / (b.H * b.H);
  const bmiF = clamp(Math.pow(22.5 / bmi, 0.35), 0.75, 1.05);
  const legF = Math.sqrt(b.legLen / (0.53 * b.H));
  const sf = (3.6 + 0.95 * p) * (accel ? 0.93 : 1) * bmiF * sexF ** 0.5; // 걸음/초
  const sl = b.H * (0.9 + 0.38 * p) * legF * (accel ? 0.55 : 1) * bmiF * sexF;
  return { sf, sl, v: sf * sl };
}

function runMove(id: string, name: string, en: string, cfg: RunCfg, accel: boolean, category: "sport" | "exam", summary: string, cues: string[]): Movement {
  const opts = (ctx: Ctx): DynOpts => ({
    keys: [
      { t: 0, py: 0.95, lean: cfg.lean, lumb: 2, thor: cfg.trunk, neck: -cfg.trunk - cfg.lean * 0.6, tilt: 6 },
      { t: 0.5, py: 0.95, lean: cfg.lean, lumb: 2, thor: cfg.trunk, neck: -cfg.trunk - cfg.lean * 0.6, tilt: 6 },
    ],
    cyclic: true,
    contact: (t) => {
      const tt = ((t % 1) + 1) % 1;
      const r: ("L" | "R")[] = [];
      if (tt < cfg.duty) r.push("L");
      if (tt >= 0.5 && tt < 0.5 + cfg.duty) r.push("R");
      return r;
    },
    phase: (t) => {
      const tt = ((t % 1) + 1) % 1;
      if (tt < cfg.duty) return "왼발 지지";
      if (tt < 0.5) return "체공";
      if (tt < 0.5 + cfg.duty) return "오른발 지지";
      return "체공";
    },
    stanceComp: true,
    landing: () => 0.55,
    tweak: (c, v, t) => {
      const L = sampleKeys(cfg.legKeys, t, true);
      const R = sampleKeys(cfg.legKeys, t + 0.5, true);
      const aL = sampleKeys(cfg.armKeys, t + 0.5, true);
      const aR = sampleKeys(cfg.armKeys, t, true);
      Object.assign(v, {
        hipL: L.hip,
        kneeL: L.knee,
        ankL: L.ank,
        hipR: R.hip,
        kneeR: R.knee,
        ankR: R.ank,
        shL: aL.sh,
        elL: aL.el,
        shR: aR.sh,
        elR: aR.el,
        sabL: 10,
        sabR: 10,
        rot: 8 * Math.sin(2 * Math.PI * t),
        yaw: -6 * Math.sin(2 * Math.PI * t),
      });
      void c;
    },
  });
  return {
    id,
    name,
    en,
    category,
    group: "스피드",
    summary,
    cues,
    load: null,
    kind: "dynamic",
    support: "feet",
    dynamics: { cyclic: true, lockFeet: false, ballistic: true },
    view: { yaw: 90 },
    timeline: (ctx) => {
      const e = sprintEstimate(ctx, accel);
      return [
        [0, 0],
        [1, 2 / e.sf],
      ];
    },
    frame: (ctx, t) => dynFrame(ctx, opts(ctx), t),
    metrics: (ctx, frames) => {
      const e = sprintEstimate(ctx, accel);
      const contact = frames.filter((f) => f.contactFeet?.includes("L"));
      const ct = contact.length ? (contact.length / frames.length) * (2 / e.sf) : 0;
      const out: Metric[] = [
        { id: "speed", label: accel ? "가속 구간 평균 속도" : "최고 속도", value: e.v, unit: "m/s", digits: 2, better: "high" },
        { id: "sl", label: "한 걸음 길이", value: e.sl * 100, unit: "cm", better: "high" },
        { id: "sf", label: "걸음 빈도", value: e.sf, unit: "걸음/초", digits: 2, better: "high" },
        { id: "ct", label: "접지 시간", value: ct * 1000, unit: "ms" },
        { id: "grf", label: "최대 수직 지면반력", value: maxOf(frames, (f) => f.grf) / bw(ctx), unit: "×체중", digits: 2 },
      ];
      if (!accel) {
        const t100 = 100 / (e.v * 0.86) + 0.15;
        out.push({ id: "t100", label: "100m 예상 기록", value: t100, unit: "초", digits: 2, better: "low", note: "출발 가속 포함 근사" });
      }
      return out;
    },
  };
}

/* ───────────── 점프 공용 ───────────── */

interface JumpPlan {
  keys: Key[];
  T: number;
  v: number;
  vy: number;
  vx: number;
  push: number;
  apex: number;
  feasible: boolean;
}

const CMJ_KEYS: Key[] = [
  { t: 0, py: 1, tilt: 0, hipL: 0, kneeL: 2, ankL: 2, hipR: 0, kneeR: 2, ankR: 2, shL: 0, shR: 0, elL: 8, elR: 8, neck: 0 },
  { t: 0.14, tilt: 12, hipL: 22, kneeL: 22, ankL: 10, hipR: 22, kneeR: 22, ankR: 10, shL: -40, shR: -40, elL: 10, elR: 10 },
  { t: 0.34, tilt: 38, hipL: 92, kneeL: 88, ankL: 30, hipR: 92, kneeR: 88, ankR: 30, shL: -62, shR: -62, elL: 12, elR: 12, neck: -20 },
  { t: 0.5, tilt: 4, hipL: -4, kneeL: 4, ankL: -36, hipR: -4, kneeR: 4, ankR: -36, shL: 160, shR: 160, elL: 6, elR: 6, neck: 0 },
  { t: 0.54, tilt: 2, hipL: -6, kneeL: 2, ankL: -42, hipR: -6, kneeR: 2, ankR: -42, shL: 165, shR: 165, elL: 4, elR: 4 },
  { t: 0.62, tilt: 4, hipL: 4, kneeL: 10, ankL: -30, hipR: 4, kneeR: 10, ankR: -30, shL: 165, shR: 165, elL: 4, elR: 4 },
  { t: 0.7, tilt: 8, hipL: 20, kneeL: 18, ankL: -18, hipR: 20, kneeR: 18, ankR: -18, shL: 90, shR: 90, elL: 10, elR: 10 },
  { t: 0.82, tilt: 30, hipL: 75, kneeL: 78, ankL: 28, hipR: 75, kneeR: 78, ankR: 28, shL: 55, shR: 55, elL: 20, elR: 20, neck: -10 },
  { t: 1, tilt: 4, hipL: 6, kneeL: 8, ankL: 4, hipR: 6, kneeR: 8, ankR: 4, shL: 10, shR: 10, elL: 10, elR: 10, neck: 0 },
];

function cmjPlan(ctx: Ctx, boxH = 0, forward = 0): JumpPlan {
  const key = `cmj:${boxH}:${forward}`;
  if (ctx.cache[key]) return ctx.cache[key] as JumpPlan;
  const b = ctx.body;
  const keys = CMJ_KEYS.map((k) => ({ ...k }));
  // 착지 흡수 깊이: 조절 능력이 좋을수록 부드럽게(깊게)
  const soft = 0.75 + (b.capacity.control / 100) * 0.4;
  for (const k of keys)
    if (k.t === 0.82)
      for (const f of ["hipL", "hipR", "kneeL", "kneeR"]) k[f] *= soft;
  const bottom = comRelFeet(ctx, keys, 0.34);
  const take = comRelFeet(ctx, keys, 0.5);
  const land = comRelFeet(ctx, keys, 0.7);
  const push = Math.hypot(take.y - bottom.y, take.z - bottom.z);
  const v = takeoffSpeed(b, push, 1);
  const ang = forward > 0 ? 80 : 90;
  const vy = v * Math.sin((ang * Math.PI) / 180);
  const vx = v * Math.cos((ang * Math.PI) / 180);
  const dy = boxH + land.y - take.y;
  const disc = vy * vy - 2 * G * dy;
  const T = flightTime(vy, dy);
  const apex = take.y + (vy * vy) / (2 * G);
  if (forward > 0) {
    const landBallZ = forward;
    for (const k of keys) if (k.t >= 0.7) k.pz = landBallZ - (land.ballZ - 0);
    for (const k of keys) if (k.t < 0.6) k.pz = 0;
  }
  const plan = { keys, T, v, vy, vx, push, apex, feasible: disc > 0 };
  ctx.cache[key] = plan;
  return plan;
}

function jumpTimeline(plan: JumpPlan, extraLand = 0.7): [number, number][] {
  return [
    [0, 0],
    [0.14, 0.25],
    [0.34, 0.62],
    [0.5, 0.86],
    [0.7, 0.86 + plan.T],
    [0.82, 0.86 + plan.T + 0.16],
    [1, 0.86 + plan.T + 0.16 + extraLand],
  ];
}

const jumpPhase = (t: number) => (t < 0.14 ? "준비" : t < 0.34 ? "반동(하강)" : t < 0.5 ? "추진" : t < 0.7 ? "체공" : t < 0.82 ? "착지 흡수" : "회복");

export function cmjMove(id: string, name: string, en: string, category: "sport" | "exam", sargent: boolean): Movement {
  const opts = (ctx: Ctx): DynOpts => ({
    keys: cmjPlan(ctx).keys,
    cyclic: false,
    contact: (t) => (t < 0.5 || t >= 0.7 ? ["L", "R"] : []),
    phase: jumpPhase,
    stanceComp: true,
    landing: (t) => (t >= 0.7 && t < 0.9 ? 1 : 0.3),
  });
  return {
    id,
    name,
    en,
    category,
    group: "점프",
    summary: sargent
      ? "제자리에서 팔 반동으로 수직으로 뛰어 손끝 도달 높이 차이를 잽니다. 미는 거리(다리 길이)와 파워가 기록을 정합니다."
      : "팔 반동을 쓰는 반동 수직 점프입니다. 반동 깊이, 이륙 속도, 착지 시 지면반력과 무릎 정렬을 봅니다.",
    cues: ["엉덩이를 뒤로 빠르게 내려가기", "팔을 끝까지 위로", "발볼로 조용히 착지"],
    load: null,
    kind: "dynamic",
    support: "feet",
    dynamics: { cyclic: false, lockFeet: true, ballistic: true },
    timeline: (ctx) => jumpTimeline(cmjPlan(ctx)),
    frame: (ctx, t) => dynFrame(ctx, opts(ctx), t),
    metrics: (ctx, frames) => {
      const p = cmjPlan(ctx);
      const h = (p.vy * p.vy) / (2 * G);
      const standReach = frames[0].pose.j.shL[1] + ctx.body.armLen;
      const reach = maxOf(frames, (f) => Math.max(f.pose.j.fingL[1], f.pose.j.fingR[1]));
      const land = frames.filter((f) => f.t >= 0.7);
      const out: Metric[] = [
        { id: "height", label: "체공 높이 (무게중심)", value: h * 100, unit: "cm", better: "high" },
        { id: "v", label: "이륙 속도", value: p.v, unit: "m/s", digits: 2, better: "high" },
        { id: "push", label: "미는 거리", value: p.push * 100, unit: "cm" },
        { id: "grfLand", label: "착지 최대 지면반력", value: maxOf(land, (f) => f.grf) / bw(ctx), unit: "×체중", digits: 2, better: "low" },
        { id: "valgus", label: "착지 무릎 안쪽 이동", value: maxOf(land, (f) => Math.max(...f.kneeMedial)) * 100, unit: "cm", better: "low" },
      ];
      if (sargent) out.unshift({ id: "sargent", label: "서전트 점프 기록", value: (reach - standReach) * 100, unit: "cm", better: "high", note: "손끝 최고 높이 − 선 자세 손끝 높이" });
      return out;
    },
  };
}

/* ───────────── 제자리멀리뛰기 ───────────── */

const SLJ_KEYS: Key[] = [
  { t: 0, py: 1, lean: 0, tilt: 0, hipL: 0, kneeL: 2, ankL: 2, hipR: 0, kneeR: 2, ankR: 2, shL: 0, shR: 0, elL: 8, elR: 8, neck: 0, pz: 0 },
  { t: 0.12, lean: 0, tilt: 10, hipL: 12, kneeL: 12, ankL: 6, hipR: 12, kneeR: 12, ankR: 6, shL: 95, shR: 95, elL: 10, elR: 10 },
  { t: 0.32, lean: 0, tilt: 50, hipL: 108, kneeL: 88, ankL: 32, hipR: 108, kneeR: 88, ankR: 32, shL: -68, shR: -68, elL: 12, elR: 12, neck: -25 },
  { t: 0.47, lean: 44, tilt: 6, hipL: -6, kneeL: 4, ankL: -40, hipR: -6, kneeR: 4, ankR: -40, shL: 150, shR: 150, elL: 6, elR: 6, neck: -5, pz: 0 },
  { t: 0.51, lean: 46, tilt: 4, hipL: -8, kneeL: 2, ankL: -46, hipR: -8, kneeR: 2, ankR: -46, shL: 160, shR: 160, elL: 6, elR: 6 },
  { t: 0.6, lean: 18, tilt: 30, hipL: 105, kneeL: 105, ankL: 0, hipR: 105, kneeR: 105, ankR: 0, shL: 90, shR: 90, elL: 10, elR: 10, neck: -15 },
  { t: 0.72, lean: 0, tilt: 34, hipL: 104, kneeL: 42, ankL: 6, hipR: 104, kneeR: 42, ankR: 6, shL: 60, shR: 60, elL: 10, elR: 10, neck: -10 },
  { t: 0.84, lean: 0, tilt: 44, hipL: 112, kneeL: 112, ankL: 30, hipR: 112, kneeR: 112, ankR: 30, shL: 95, shR: 95, elL: 15, elR: 15, neck: -15 },
  { t: 1, lean: 0, tilt: 16, hipL: 32, kneeL: 30, ankL: 10, hipR: 32, kneeR: 30, ankR: 10, shL: 30, shR: 30, elL: 15, elR: 15, neck: -5 },
];

function sljPlan(ctx: Ctx): JumpPlan & { landBallZ: number } {
  if (ctx.cache.slj) return ctx.cache.slj as JumpPlan & { landBallZ: number };
  const b = ctx.body;
  const keys = SLJ_KEYS.map((k) => ({ ...k }));
  const bottom = comRelFeet(ctx, keys, 0.32);
  const take = comRelFeet(ctx, keys, 0.47);
  const land = comRelFeet(ctx, keys, 0.72);
  const push = Math.hypot(take.y - bottom.y, take.z - bottom.z);
  const v = takeoffSpeed(b, push, 0.69);
  const ang = 38;
  const vy = v * Math.sin((ang * Math.PI) / 180);
  const vx = v * Math.cos((ang * Math.PI) / 180);
  const T = flightTime(vy, land.y - take.y);
  // 이륙 시 발볼 위치(0) 기준 무게중심 → 착지 시 무게중심 → 착지 발볼 위치
  const comTakeZ = take.z;
  const comLandZ = comTakeZ + vx * T;
  const landBallZ = comLandZ - land.z;
  const pzLand = landBallZ - land.ballZ;
  for (const k of keys) if (k.t >= 0.72) k.pz = pzLand;
  for (const k of keys) if (k.t === 0.6) k.pz = pzLand * 0.5;
  for (const k of keys) if (k.t === 0.51) k.pz = 0;
  const plan = { keys, T, v, vy, vx, push, apex: take.y + (vy * vy) / (2 * G), feasible: true, landBallZ };
  ctx.cache.slj = plan;
  return plan;
}

export const standingLongJump: Movement = {
  id: "standing-long-jump",
  name: "제자리멀리뛰기",
  en: "Standing Long Jump",
  category: "exam",
  group: "체대입시",
  summary: "구름판 뒤에서 양발로 뛰어 착지한 뒤꿈치까지의 거리를 잽니다. 미는 거리·이륙 각도·착지 때 다리를 얼마나 앞으로 뻗는지가 기록을 바꿉니다.",
  cues: ["팔을 크게 뒤로 → 앞으로", "45° 가까이 몸을 던지기", "착지 때 발을 앞으로 뻗고 엉덩이는 앞으로"],
  load: null,
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: false, lockFeet: true, ballistic: true },
  view: { yaw: 90, followZ: true },
  timeline: (ctx) => {
    const p = sljPlan(ctx);
    return [
      [0, 0],
      [0.12, 0.35],
      [0.32, 0.85],
      [0.47, 1.08],
      [0.72, 1.08 + p.T],
      [0.84, 1.08 + p.T + 0.18],
      [1, 1.08 + p.T + 0.18 + 0.7],
    ];
  },
  frame: (ctx, t) =>
    dynFrame(
      ctx,
      {
        keys: sljPlan(ctx).keys,
        cyclic: false,
        contact: (tt) => (tt < 0.47 || tt >= 0.72 ? ["L", "R"] : []),
        phase: (tt) => (tt < 0.12 ? "준비" : tt < 0.32 ? "반동(하강)" : tt < 0.47 ? "추진" : tt < 0.72 ? "체공" : tt < 0.84 ? "착지" : "회복"),
        stanceComp: true,
        landing: (tt) => (tt >= 0.72 && tt < 0.9 ? 1 : 0.3),
        surfaces: () => [{ kind: "line", center: [0, 0.002, 0.2], size: [1.6, 0.004, 0.05], label: "출발선" }],
      },
      t,
    ),
  metrics: (ctx, frames) => {
    const p = sljPlan(ctx);
    const start = frames[0];
    const startToe = Math.max(start.pose.j.toeL[2], start.pose.j.toeR[2]);
    const landF = frames.find((f) => f.t >= 0.72) ?? frames[frames.length - 1];
    const heel = Math.min(landF.pose.j.heelL[2], landF.pose.j.heelR[2]);
    const dist = heel - startToe;
    const take = frames.filter((f) => f.t < 0.47).pop() ?? start;
    return [
      { id: "dist", label: "예상 기록", value: dist * 100, unit: "cm", better: "high", note: "출발선(발끝) → 착지 뒤꿈치" },
      { id: "v", label: "이륙 속도", value: p.v, unit: "m/s", digits: 2, better: "high" },
      { id: "flight", label: "체공 시간", value: p.T * 1000, unit: "ms" },
      { id: "push", label: "미는 거리", value: p.push * 100, unit: "cm", better: "high" },
      { id: "takeLean", label: "이륙 시 무게중심 전방 (발끝 기준)", value: (take.com[2] - startToe) * 100, unit: "cm" },
      { id: "grfLand", label: "착지 최대 지면반력", value: maxOf(frames.filter((f) => f.t >= 0.72), (f) => f.grf) / bw(ctx), unit: "×체중", digits: 2 },
    ];
  },
};

/* ───────────── 박스 점프 / 드롭 착지 ───────────── */

const boxJump: Movement = {
  id: "box-jump",
  name: "박스 점프",
  en: "Box Jump",
  category: "sport",
  group: "점프",
  summary: "반동 점프로 앞쪽 박스(60cm) 위에 착지합니다. 이륙 속도로 박스 높이를 넘을 여유가 있는지 계산합니다.",
  cues: ["팔 반동", "무릎을 가슴 쪽으로 당기기", "박스 위에서 부드럽게"],
  load: null,
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: false, lockFeet: true, ballistic: true },
  view: { yaw: 90 },
  timeline: (ctx) => jumpTimeline(cmjPlan(ctx, boxHeight(ctx), 0.55)),
  frame: (ctx, t) => {
    const h = boxHeight(ctx);
    const plan = cmjPlan(ctx, h, 0.55);
    const keys = plan.keys.map((k) => (k.t === 0.6 ? { ...k, hipL: 70, hipR: 70, kneeL: 95, kneeR: 95, ankL: -5, ankR: -5 } : k));
    return dynFrame(
      ctx,
      {
        keys,
        cyclic: false,
        contact: (tt) => (tt < 0.5 || tt >= 0.7 ? ["L", "R"] : []),
        groundY: (tt) => (tt >= 0.7 ? h : 0),
        phase: jumpPhase,
        stanceComp: true,
        landing: (tt) => (tt >= 0.7 && tt < 0.9 ? 0.8 : 0.3),
        surfaces: () => [{ kind: "box", center: [0, h / 2, 0.62], size: [0.6, h, 0.5] }],
      },
      t,
    );
  },
  metrics: (ctx, frames) => {
    const h = boxHeight(ctx);
    const p = cmjPlan(ctx, h, 0.55);
    const land = comRelFeet(ctx, p.keys, 0.7);
    const margin = p.apex - (h + land.y);
    return [
      { id: "margin", label: "박스 대비 도약 여유", value: margin * 100, unit: "cm", better: "high", note: margin < 0 ? "이 높이는 넘기 어렵습니다" : undefined },
      { id: "box", label: "박스 높이", value: h * 100, unit: "cm" },
      { id: "v", label: "이륙 속도", value: p.v, unit: "m/s", digits: 2 },
      { id: "grfLand", label: "착지 최대 지면반력", value: maxOf(frames.filter((f) => f.t >= 0.7), (f) => f.grf) / bw(ctx), unit: "×체중", digits: 2 },
    ];
  },
};

function boxHeight(ctx: Ctx) {
  return Math.round(0.6 * (ctx.body.H / 1.75) * 20) / 20;
}

const DROP_KEYS: Key[] = [
  { t: 0, py: 1, tilt: 0, hipL: 0, kneeL: 2, ankL: 2, hipR: 0, kneeR: 2, ankR: 2, shL: 0, shR: 0, elL: 10, elR: 10, pz: 0 },
  { t: 0.15, tilt: 4, hipL: 18, kneeL: 10, ankL: -5, hipR: 4, kneeR: 6, ankR: 0, shL: 25, shR: 25, pz: 0.1 },
  { t: 0.3, tilt: 6, hipL: 22, kneeL: 16, ankL: -22, hipR: 22, kneeR: 16, ankR: -22, shL: 45, shR: 45, pz: 0.36 },
  { t: 0.5, tilt: 34, hipL: 82, kneeL: 92, ankL: 30, hipR: 82, kneeR: 92, ankR: 30, shL: 60, shR: 60, elL: 20, elR: 20, pz: 0.36 },
  { t: 1, tilt: 4, hipL: 4, kneeL: 6, ankL: 4, hipR: 4, kneeR: 6, ankR: 4, shL: 10, shR: 10, elL: 10, elR: 10, pz: 0.36 },
];

const dropLanding: Movement = {
  id: "drop-landing",
  name: "드롭 착지",
  en: "Drop Landing",
  category: "sport",
  group: "점프",
  summary: "30cm 박스에서 내려와 양발로 착지합니다. 전방십자인대 손상 위험 선별에 쓰는 동작으로, 착지 지면반력과 무릎 안쪽 무너짐을 봅니다.",
  cues: ["발볼 → 뒤꿈치 순서로", "무릎은 발끝 방향", "엉덩이와 무릎을 함께 굽혀 흡수"],
  load: null,
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: false, lockFeet: true, ballistic: true },
  view: { yaw: 30 },
  timeline: (ctx) => {
    const T = Math.sqrt((2 * 0.33) / G);
    const absorb = 0.1 + (ctx.body.capacity.control / 100) * 0.14;
    return [
      [0, 0],
      [0.15, 0.45],
      [0.3, 0.45 + T],
      [0.5, 0.45 + T + absorb],
      [1, 0.45 + T + absorb + 0.9],
    ];
  },
  frame: (ctx, t) => {
    const b = ctx.body;
    const soft = 0.7 + (b.capacity.control / 100) * 0.45;
    const keys = DROP_KEYS.map((k) => (k.t === 0.5 ? { ...k, hipL: k.hipL * soft, hipR: k.hipR * soft, kneeL: k.kneeL * soft, kneeR: k.kneeR * soft } : k));
    return dynFrame(
      ctx,
      {
        keys,
        cyclic: false,
        contact: (tt) => (tt < 0.08 || tt >= 0.3 ? ["L", "R"] : tt < 0.15 ? ["R"] : []),
        groundY: (tt) => (tt < 0.15 ? 0.31 : 0),
        phase: (tt) => (tt < 0.15 ? "박스 위" : tt < 0.3 ? "낙하" : tt < 0.5 ? "착지 흡수" : "회복"),
        stanceComp: true,
        landing: (tt) => (tt >= 0.3 && tt < 0.6 ? 1.15 : 0.2),
        surfaces: () => [{ kind: "box", center: [0, 0.155, -0.02], size: [0.6, 0.31, 0.45] }],
      },
      t,
    );
  },
  metrics: (ctx, frames) => {
    const land = frames.filter((f) => f.t >= 0.3);
    const peak = land.reduce((a, b) => (b.grf > a.grf ? b : a), land[0]);
    return [
      { id: "grf", label: "착지 최대 지면반력", value: peak.grf / bw(ctx), unit: "×체중", digits: 2, better: "low" },
      { id: "kneeAtPeak", label: "최대 하중 시 무릎 굴곡", value: (peak.angles.kneeFlex[0] + peak.angles.kneeFlex[1]) / 2, unit: "°", better: "high" },
      { id: "kneeMax", label: "최대 무릎 굴곡", value: maxOf(land, (f) => Math.max(...f.angles.kneeFlex)), unit: "°", better: "high" },
      { id: "valgus", label: "무릎 안쪽 이동(최대)", value: maxOf(land, (f) => Math.max(...f.kneeMedial)) * 100, unit: "cm", better: "low" },
    ];
  },
};

/* ───────────── 스케이터 점프 ───────────── */

function skaterW(ctx: Ctx) {
  const b = ctx.body;
  return b.legLen * (1.05 + 0.6 * (b.capacity.power / 100)) * (b.sex === "f" ? 0.9 : 1);
}

const SKATE_LEG: Key[] = [
  // phase 0 = 이 다리로 착지 (반대 다리는 뒤로 교차)
  { t: 0, hip: 40, knee: 35, ank: 10, hab: 12 },
  { t: 0.12, hip: 75, knee: 72, ank: 26, hab: 4 },
  { t: 0.3, hip: 10, knee: 12, ank: -30, hab: 22 },
  { t: 0.42, hip: 20, knee: 60, ank: -10, hab: 8 },
  { t: 0.6, hip: -12, knee: 70, ank: -15, hab: -16 },
  { t: 0.82, hip: 10, knee: 55, ank: -10, hab: -10 },
];

const skater: Movement = {
  id: "skater-jump",
  name: "스케이터 점프",
  en: "Skater Bound",
  category: "sport",
  group: "점프",
  summary: "한 발로 옆으로 뛰어 반대발로 착지하기를 반복합니다. 한 발 착지 때 골반 떨어짐과 무릎 외반이 잘 드러납니다.",
  cues: ["착지 다리 무릎은 발끝 방향", "골반 수평", "착지 후 1초 버티기"],
  load: null,
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: true, lockFeet: false, ballistic: true },
  view: { yaw: 0 },
  timeline: (ctx) => {
    const W = skaterW(ctx);
    const T = Math.max(0.28, Math.min(0.5, W / 3.2));
    return [
      [0, 0],
      [0.32, 0.42],
      [0.5, 0.42 + T],
      [0.82, 0.84 + T],
      [1, 0.84 + 2 * T],
    ];
  },
  frame: (ctx, t) => {
    const W = skaterW(ctx);
    return dynFrame(
      ctx,
      {
        keys: [
          { t: 0, py: 0.9, px: W / 2, bank: 0, tilt: 30 },
          { t: 0.12, px: W / 2, bank: 4, tilt: 42 },
          { t: 0.32, px: W / 2, bank: -14, tilt: 22 },
          { t: 0.5, px: -W / 2, bank: 0, tilt: 30 },
          { t: 0.62, px: -W / 2, bank: -4, tilt: 42 },
          { t: 0.82, px: -W / 2, bank: 14, tilt: 22 },
        ],
        cyclic: true,
        contact: (tt) => {
          const x = ((tt % 1) + 1) % 1;
          return x < 0.32 ? ["L"] : x >= 0.5 && x < 0.82 ? ["R"] : [];
        },
        phase: (tt) => {
          const x = ((tt % 1) + 1) % 1;
          return x < 0.12 ? "왼발 착지" : x < 0.32 ? "왼발 밀기" : x < 0.5 ? "체공" : x < 0.62 ? "오른발 착지" : x < 0.82 ? "오른발 밀기" : "체공";
        },
        stanceComp: true,
        landing: (tt) => {
          const x = ((tt % 1) + 1) % 1;
          return x < 0.15 || (x >= 0.5 && x < 0.65) ? 1.1 : 0.5;
        },
        tweak: (_c, v, tt) => {
          const L = sampleKeys(SKATE_LEG, tt, true);
          const R = sampleKeys(SKATE_LEG, tt + 0.5, true);
          Object.assign(v, {
            hipL: L.hip + 0,
            kneeL: L.knee,
            ankL: L.ank,
            habL: L.hab,
            hipR: R.hip,
            kneeR: R.knee,
            ankR: R.ank,
            habR: R.hab,
            shL: 20 + 40 * Math.sin(2 * Math.PI * tt),
            shR: 20 - 40 * Math.sin(2 * Math.PI * tt),
            sabL: 25,
            sabR: 25,
            elL: 40,
            elR: 40,
          });
        },
      },
      t,
    );
  },
  metrics: (ctx, frames) => {
    const land = frames.filter((f) => (f.contactFeet?.length ?? 0) === 1);
    return [
      { id: "w", label: "옆으로 뛴 거리", value: skaterW(ctx) * 100, unit: "cm", better: "high" },
      { id: "grf", label: "한 발 착지 최대 지면반력", value: maxOf(land, (f) => f.grf) / bw(ctx), unit: "×체중", digits: 2 },
      { id: "drop", label: "골반 떨어짐(최대)", value: maxOf(frames, (f) => Math.abs(f.meta.obliq ?? 0)), unit: "°", better: "low" },
      { id: "valgus", label: "무릎 안쪽 이동(최대)", value: maxOf(land, (f) => Math.max(...f.kneeMedial)) * 100, unit: "cm", better: "low" },
    ];
  },
};

/* ───────────── 방향 전환 (발 위치 고정형) ───────────── */

interface StepKey {
  t: number;
  x: number;
  z: number;
  lift: number;
  yaw: number;
}

function footTrack(keys: StepKey[], t: number): FootPlace & { lift: number } {
  const v = sampleKeys(keys as unknown as Key[], t, false);
  return { x: v.x, z: v.z, y: Math.max(0, v.lift), yaw: v.yaw, lift: v.lift, heelRise: v.lift > 0.004 ? 25 : 0 };
}

export function cutMove(): Movement {
  const scale = (ctx: Ctx) => ctx.body.legLen / 0.93;
  const opts = (ctx: Ctx): PlantOpts => {
    const s = scale(ctx);
    const W = ctx.body.hipW / 2;
    // 왼발로 딛고 오른쪽 45° 로 방향 전환
    const Lk: StepKey[] = [
      { t: 0, x: W, z: 0.1 * s, lift: 0.12, yaw: 4 },
      { t: 0.2, x: W + 0.3 * s, z: 1.25 * s, lift: 0.06, yaw: 4 },
      { t: 0.24, x: W + 0.32 * s, z: 1.35 * s, lift: 0, yaw: 0 },
      { t: 0.52, x: W + 0.32 * s, z: 1.35 * s, lift: 0, yaw: -30 },
      { t: 0.6, x: W + 0.2 * s, z: 1.45 * s, lift: 0.1, yaw: -45 },
      { t: 0.84, x: -0.75 * s, z: 2.35 * s, lift: 0.04, yaw: -45 },
      { t: 0.88, x: -0.8 * s, z: 2.4 * s, lift: 0, yaw: -45 },
      { t: 1, x: -0.8 * s, z: 2.4 * s, lift: 0, yaw: -45 },
    ];
    const Rk: StepKey[] = [
      { t: 0, x: -W, z: 0.55 * s, lift: 0, yaw: 0 },
      { t: 0.14, x: -W, z: 0.55 * s, lift: 0, yaw: 0 },
      { t: 0.24, x: -W, z: 0.95 * s, lift: 0.14, yaw: 0 },
      { t: 0.46, x: 0, z: 1.6 * s, lift: 0.12, yaw: -30 },
      { t: 0.6, x: -0.25 * s, z: 1.85 * s, lift: 0.03, yaw: -45 },
      { t: 0.64, x: -0.28 * s, z: 1.88 * s, lift: 0, yaw: -45 },
      { t: 0.78, x: -0.28 * s, z: 1.88 * s, lift: 0, yaw: -45 },
      { t: 1, x: -1.1 * s, z: 2.7 * s, lift: 0.12, yaw: -45 },
    ];
    return {
      keys: [
        { t: 0, px: 0, pz: 0.45 * s, drop: 0.04, yaw: 0, tilt: 10, lean: 6, bank: 0, shL: 30, shR: -30, elL: 80, elR: 80 },
        { t: 0.24, px: 0.08 * s, pz: 1.1 * s, drop: 0.06, yaw: 0, tilt: 8, lean: -8, bank: -6, shL: -20, shR: 40 },
        { t: 0.38, px: 0.02 * s, pz: 1.25 * s, drop: 0.13, yaw: -18, tilt: 22, lean: -2, bank: -16, shL: 20, shR: 10 },
        { t: 0.52, px: -0.12 * s, pz: 1.45 * s, drop: 0.07, yaw: -38, tilt: 14, lean: 10, bank: -12, shL: 50, shR: -30 },
        { t: 0.7, px: -0.35 * s, pz: 1.82 * s, drop: 0.05, yaw: -45, tilt: 10, lean: 8, bank: -3, shL: -30, shR: 40 },
        { t: 1, px: -0.85 * s, pz: 2.35 * s, drop: 0.05, yaw: -45, tilt: 10, lean: 8, bank: 0, shL: 30, shR: -30 },
      ],
      cyclic: false,
      phase: (t) => (t < 0.24 ? "접근" : t < 0.38 ? "감속·플랜트" : t < 0.52 ? "방향 전환" : t < 0.7 ? "재가속" : "가속"),
      feet: (_c, _v, t) => [footTrack(Lk, t), footTrack(Rk, t)],
      stanceComp: 1.1,
    };
  };
  return {
    id: "side-cut",
    name: "45° 사이드 컷",
    en: "45° Side Cut",
    category: "sport",
    group: "방향 전환",
    summary: "달리다가 왼발을 딛고 오른쪽 45°로 방향을 바꿉니다. 플랜트 순간 무릎 외반·몸통 측굴·지면반력을 봅니다.",
    cues: ["플랜트 발은 몸 바깥에", "무릎은 발끝 방향", "몸통은 새 방향으로 먼저"],
    load: null,
    kind: "dynamic",
    support: "feet",
    dynamics: { cyclic: false, lockFeet: false, ballistic: true },
    view: { yaw: 20, followZ: true },
    timeline: () => [
      [0, 0],
      [0.24, 0.24],
      [0.52, 0.52],
      [1, 0.95],
    ],
    frame: (ctx, t) => plantFrame(ctx, opts(ctx), t),
    metrics: (ctx, frames) => {
      const plant = frames.filter((f) => f.t >= 0.24 && f.t < 0.52);
      return [
        { id: "grf", label: "플랜트 최대 지면반력", value: maxOf(plant, (f) => f.grf) / bw(ctx), unit: "×체중", digits: 2 },
        { id: "valgus", label: "플랜트 무릎 안쪽 이동", value: maxOf(plant, (f) => f.kneeMedial[0]) * 100, unit: "cm", better: "low" },
        { id: "kneeFlex", label: "플랜트 최대 무릎 굴곡", value: maxOf(plant, (f) => f.angles.kneeFlex[0]), unit: "°" },
        { id: "comLow", label: "최저 무게중심 높이", value: minOf(frames, (f) => f.com[1]) * 100, unit: "cm" },
      ];
    },
  };
}

/* ───────────── 회전 메디신볼 던지기 ───────────── */

function rotThrowVel(ctx: Ctx) {
  const b = ctx.body;
  const p = b.capacity.power / 100;
  const m = Math.max(1, ctx.loadKg);
  const rom = b.mobility.thoracicRot;
  const v = (6.2 + 6.5 * p) * Math.pow(b.armLen / 0.77, 0.5) * Math.pow(rom / 45, 0.3) * Math.pow(3 / m, 0.18) * (b.sex === "f" ? 0.85 : 1);
  return v;
}

const rotThrow: Movement = {
  id: "rotational-throw",
  name: "회전 메디신볼 던지기",
  en: "Rotational Med-ball Throw",
  category: "sport",
  group: "던지기",
  summary: "옆으로 선 채 몸통을 감았다 풀며 공을 던집니다. 흉추 회전 가동성이 감는 범위를, 팔 길이가 공의 속도를 바꿉니다.",
  cues: ["뒷다리에서 앞다리로 체중 이동", "골반이 먼저, 몸통이 나중", "팔은 길게"],
  load: { kind: "medball", default: 3, min: 2, max: 10, step: 1, label: "메디신볼", rmPerBw: 0.25 },
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: false, lockFeet: false, ballistic: false },
  view: { yaw: 10 },
  timeline: () => [
    [0, 0],
    [1, 2.4],
  ],
  frame: (ctx, t) => {
    const b = ctx.body;
    const st = b.hipW * 1.9;
    const tRel = 0.55;
    const opts: PlantOpts = {
      keys: [
        { t: 0, yaw: -90, rot: 0, drop: 0.06, px: 0, pz: 0, tilt: 15, shL: 70, shR: 70, sabL: 0, sabR: 0, elL: 10, elR: 10, side: 0 },
        { t: 0.3, yaw: -110, rot: -48, drop: 0.09, px: 0.1, tilt: 18, shL: 70, shR: 70, elL: 15, elR: 15 },
        { t: 0.45, yaw: -70, rot: -30, drop: 0.07, px: -0.02, tilt: 14, shL: 75, shR: 75 },
        { t: 0.55, yaw: -35, rot: 10, drop: 0.05, px: -0.1, tilt: 10, shL: 80, shR: 80, elL: 5, elR: 5 },
        { t: 0.7, yaw: -10, rot: 25, drop: 0.04, px: -0.12, tilt: 8, shL: 70, shR: 60 },
        { t: 1, yaw: -15, rot: 10, drop: 0.03, px: -0.1, tilt: 4, shL: 20, shR: 20 },
      ],
      cyclic: false,
      phase: (tt) => (tt < 0.3 ? "감기" : tt < tRel ? "풀기·가속" : tt < 0.7 ? "릴리스" : "팔로스루"),
      feet: () => [
        { x: 0, z: st / 2, yaw: -80 },
        { x: 0, z: -st / 2, yaw: -80, heelRise: 0 },
      ],
      tweak: (c, v) => {
        // 흉추 회전이 부족하면 감기 범위가 줄어든다
        const lim = c.body.mobility.thoracicRot;
        if (v.rot < -lim) v.rot = -lim;
      },
      arms: (c, v, pose) => {
        const sm = lerpV(pose.j.shL, pose.j.shR, 0.5);
        const fwd: Vec3 = [Math.sin(((v.yaw + v.rot) * Math.PI) / 180), 0, Math.cos(((v.yaw + v.rot) * Math.PI) / 180)];
        const reach = (c.body.upperArm + c.body.forearm) * 0.95;
        const target: Vec3 = [sm[0] + fwd[0] * reach, sm[1] - 0.18, sm[2] + fwd[2] * reach];
        return [
          { ik: [target[0], target[1], target[2] + 0.0], pole: [0, -1, 0] },
          { ik: [target[0], target[1] - 0.02, target[2] - 0.0], pole: [0, -1, 0] },
        ];
      },
      load: (c, tt, pose) => {
        const grip = lerpV(pose.j.gripL, pose.j.gripR, 0.5);
        const r = 0.11;
        if (tt <= tRel) return { kind: "medball", mass: c.loadKg, center: grip, carried: true } as LoadState;
        const key = "rotRelease";
        let rel = c.cache[key] as { p: Vec3; tRel: number } | undefined;
        if (!rel) {
          const pr = plantFrame(c, { ...opts, load: undefined }, tRel).pose;
          rel = { p: lerpV(pr.j.gripL, pr.j.gripR, 0.5), tRel: tRel * 2.4 };
          c.cache[key] = rel;
        }
        const v = rotThrowVel(c);
        const a = (25 * Math.PI) / 180;
        return { kind: "medball", mass: c.loadKg, center: ballAt(rel.p, [0, v * Math.sin(a), v * Math.cos(a)], tt * 2.4 - rel.tRel, r), carried: false, released: true } as LoadState;
      },
      stanceComp: 0.5,
    };
    return plantFrame(ctx, opts, t);
  },
  metrics: (ctx, frames) => {
    const v = rotThrowVel(ctx);
    const rel = frames.find((f) => f.t >= 0.55) ?? frames[0];
    const h = rel.pose.j.gripL[1];
    const d = (v * Math.cos(0.436) / G) * (v * Math.sin(0.436) + Math.sqrt((v * Math.sin(0.436)) ** 2 + 2 * G * h));
    return [
      { id: "v", label: "릴리스 속도", value: v, unit: "m/s", digits: 2, better: "high" },
      { id: "dist", label: "예상 비거리", value: d, unit: "m", digits: 2, better: "high" },
      { id: "rot", label: "몸통 감기 범위", value: Math.min(48, ctx.body.mobility.thoracicRot), unit: "°", better: "high" },
    ];
  },
};

/* ───────────── 케틀벨 스윙 ───────────── */

const kbSwing: Movement = {
  id: "kettlebell-swing",
  name: "케틀벨 스윙",
  en: "Kettlebell Swing",
  category: "sport",
  group: "파워",
  summary: "힙힌지로 케틀벨을 다리 사이로 보냈다가 엉덩이를 튕겨 가슴 높이까지 띄웁니다. 햄스트링 유연성이 힌지 깊이를, 조절 능력이 허리 말림을 정합니다.",
  cues: ["무릎보다 엉덩이로", "팔은 줄처럼", "최고점에서 둔근 조이기"],
  load: { kind: "kettlebell", default: 16, min: 4, max: 48, step: 2, label: "케틀벨", rmPerBw: 0.45 },
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: true, lockFeet: false, ballistic: false },
  view: { yaw: 80 },
  timeline: () => [
    [0, 0],
    [1, 1.5],
  ],
  frame: (ctx, t) => {
    const b = ctx.body;
    const hamAllow = b.mobility.hamstring + 0.7 * 20 + 8;
    const tiltMax = Math.min(72, hamAllow - 18);
    const roundBack = ((100 - b.capacity.control) / 100) * 14;
    const opts: PlantOpts = {
      keys: [
        { t: 0, tilt: tiltMax, lumb: roundBack, pz: -0.16, drop: 0.07, shL: -15, shR: -15, elL: 5, elR: 5, neck: -30 },
        { t: 0.28, tilt: 25, lumb: 0, pz: -0.06, drop: 0.06, shL: 20, shR: 20, neck: -10 },
        { t: 0.45, tilt: -2, lumb: 0, pz: 0.03, drop: 0.0, shL: 88, shR: 88, neck: 0 },
        { t: 0.58, tilt: -2, lumb: 0, pz: 0.03, drop: 0.0, shL: 85, shR: 85, neck: 0 },
        { t: 0.78, tilt: 30, lumb: roundBack * 0.4, pz: -0.08, drop: 0.05, shL: 15, shR: 15, neck: -15 },
      ],
      cyclic: true,
      phase: (tt) => (tt < 0.1 ? "백스윙" : tt < 0.45 ? "힙 스냅" : tt < 0.6 ? "플로트" : "하강"),
      feet: () => [
        { x: b.hipW * 0.75 + 0.02, z: 0, yaw: 14 },
        { x: -(b.hipW * 0.75 + 0.02), z: 0, yaw: 14 },
      ],
      arms: (_c, v, pose) => {
        const sm = lerpV(pose.j.shL, pose.j.shR, 0.5);
        const a = ((v.shL + 0) * Math.PI) / 180;
        // 몸통 기준이 아닌 세계 기준 팔 각도: 수직 아래 0, 앞 90
        const trunk = (v.tilt * Math.PI) / 180;
        const ang = a - trunk * 0.0;
        const reach = (b.upperArm + b.forearm + b.hand * 0.45) * 0.995;
        const tgt: Vec3 = [sm[0], sm[1] - reach * Math.cos(ang), sm[2] + reach * Math.sin(ang)];
        return [
          { ik: [tgt[0] + 0.03, tgt[1], tgt[2]], pole: [0, 0, -1] },
          { ik: [tgt[0] - 0.03, tgt[1], tgt[2]], pole: [0, 0, -1] },
        ];
      },
      load: (c, _t, pose) => {
        const g = lerpV(pose.j.gripL, pose.j.gripR, 0.5);
        const d = lerpV(lerpV(pose.j.elL, pose.j.elR, 0.5), g, 1.25);
        return { kind: "kettlebell", mass: c.loadKg, center: d, carried: true };
      },
      tweak: (_c, v) => {
        // 힌지: 고관절 굴곡은 골반 기울기를 따라간다 (다리는 IK)
        void v;
      },
    };
    const f = plantFrame(ctx, opts, t);
    f.meta.lumbarFlex = Math.max(f.meta.lumbarFlex ?? 0, sampleKeys(opts.keys, t, true).lumb ?? 0);
    f.meta.hamstringLimit = Math.max(0, 72 - tiltMax);
    return f;
  },
  metrics: (ctx, frames) => [
    { id: "bell", label: "케틀벨 최고 높이", value: maxOf(frames, (f) => f.load!.center[1]) * 100, unit: "cm" },
    { id: "hinge", label: "최대 힌지 (몸통 숙임)", value: maxOf(frames, (f) => f.angles.trunkLean), unit: "°" },
    { id: "grf", label: "최대 수직 지면반력", value: maxOf(frames, (f) => f.grf) / bw(ctx), unit: "×체중", digits: 2 },
    { id: "lumbarM", label: "요추 신전 모멘트(최대)", value: maxOf(frames, (f) => f.moments.lumbar), unit: "N·m", better: "low" },
  ],
};

export const SPORT: Movement[] = [
  runMove("sprint-accel", "가속 스프린트", "Acceleration Sprint", ACCEL, true, "sport", "출발 후 첫 몇 걸음. 몸을 45° 가까이 기울이고 지면을 뒤로 밀어냅니다. 접지 시간이 길고 무릎 드라이브가 큽니다.", ["몸 전체를 일직선으로 기울이기", "발은 엉덩이 아래로", "팔은 크게"]),
  runMove("sprint-max", "최고속도 스프린트", "Max-velocity Sprint", SPRINT, false, "sport", "최고 속도 구간의 달리기 주기. 걸음 길이·빈도는 다리 길이와 파워로 정해지고, 한 발 지지 때 골반·무릎 정렬을 봅니다.", ["몸통은 세우고", "발은 몸 바로 앞에 딛기", "무릎을 높이 회수"]),
  cmjMove("cmj", "반동 수직 점프 (CMJ)", "Countermovement Jump", "sport", false),
  boxJump,
  dropLanding,
  skater,
  cutMove(),
  rotThrow,
  kbSwing,
];

export { sprintEstimate };
export const _lerp = lerp;
export const _smooth = smooth;
