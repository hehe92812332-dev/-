// 키프레임 기반 동적 동작 공용 도구
import type { Body } from "../anthropometry";
import { angleSpec, feetContacts, G, sampleKeys, type Key } from "../kit";
import { clamp, mul, Rx, Ry, Rz, sub, type Mat3, type Vec3 } from "../math";
import { bodyCom, buildPose, measureAngles, type ArmSpec, type Pose, type PoseSpec } from "../pose";
import type { Contact, Ctx, FrameMeta, LoadState, MoveFrame, Surface } from "../types";

export interface DynOpts {
  keys: Key[];
  cyclic: boolean;
  /** t 에서 접지한 발 */
  contact: (t: number) => ("L" | "R")[];
  /** 접지 높이 */
  groundY?: (t: number) => number;
  phase: (t: number) => string;
  arms?: (ctx: Ctx, v: Record<string, number>, pose: Pose) => [ArmSpec, ArmSpec] | undefined;
  load?: (ctx: Ctx, t: number, pose: Pose, v: Record<string, number>) => LoadState | undefined;
  surfaces?: (ctx: Ctx) => Surface[];
  /** 한 발 지지 시 골반 떨어짐·무릎 외반 보상 적용 */
  stanceComp?: boolean;
  /** 착지 흡수 구간 (외반 보상 강하게) */
  landing?: (t: number) => number;
  /** 키값 체형 보정 */
  tweak?: (ctx: Ctx, v: Record<string, number>, t: number) => void;
}

/** 전신 기울기(lean: 앞으로 +, bank: 왼쪽으로 +, yaw) */
export function baseOf(v: Record<string, number>): Mat3 | undefined {
  const lean = v.lean ?? 0,
    bank = v.bank ?? 0,
    yaw = v.gyaw ?? 0;
  if (!lean && !bank && !yaw) return undefined;
  return mul(mul(Ry(yaw), Rz(-bank)), Rx(lean));
}

/** 가동성·조절 능력에 따른 키값 보정. 기록할 보상 신호를 meta 에 쓴다 */
/** 해부학적 정상 가동범위로 키값을 자른다 (사용자 가동성과 무관한 절대 한계) */
export function anatomicalClamp(v: Record<string, number>) {
  const c = (k: string, lo: number, hi: number) => {
    if (k in v) v[k] = clamp(v[k], lo, hi);
  };
  for (const k of ["L", "R"]) {
    c(`hip${k}`, -28, 138);
    c(`knee${k}`, 0, 150);
    c(`ank${k}`, -55, 52);
    c(`hab${k}`, -28, 48);
    c(`hr${k}`, -45, 42);
    c(`sh${k}`, -55, 186);
    c(`el${k}`, 0, 148);
    c(`sab${k}`, -40, 175);
    c(`sr${k}`, -90, 75);
  }
  c("lumb", -25, 45);
  c("thor", -20, 40);
  c("neck", -55, 45);
  c("side", -35, 35);
  c("rot", -55, 55);
}

export function applyLimits(b: Body, v: Record<string, number>, meta: FrameMeta) {
  anatomicalClamp(v);
  const mob = b.mobility;
  let ham = 0,
    heel = [0, 0] as [number, number],
    sh = 0,
    wink = 0;
  for (const k of ["L", "R"] as const) {
    const hip = v[`hip${k}`] ?? 0;
    const knee = Math.max(0, v[`knee${k}`] ?? 0);
    const allow = mob.hamstring + 0.7 * knee + 8;
    if (hip > allow) {
      ham = Math.max(ham, hip - allow);
      v[`hip${k}`] = allow;
    }
    const hipLim = mob.hipFlex + 3;
    if ((v[`hip${k}`] ?? 0) > hipLim) wink = Math.max(wink, (v[`hip${k}`] ?? 0) - hipLim);
    const ank = v[`ank${k}`] ?? 0;
    if (ank > mob.ankleDF) {
      heel[k === "L" ? 0 : 1] = ank - mob.ankleDF;
      v[`ank${k}`] = mob.ankleDF;
    }
    const s = v[`sh${k}`] ?? 0;
    if (s > mob.shoulderFlex) {
      sh = Math.max(sh, s - mob.shoulderFlex);
      v[`sh${k}`] = mob.shoulderFlex;
    }
  }
  if (wink > 0) {
    // 골반이 뒤로 말리면 넙다리 방향은 그대로, 고관절 굴곡만 줄어든다
    v.tilt = (v.tilt ?? 0) - wink;
    v.hipL = (v.hipL ?? 0) - wink;
    v.hipR = (v.hipR ?? 0) - wink;
    v.lumb = (v.lumb ?? 0) + wink;
  }
  if (ham > 0) v.lumb = (v.lumb ?? 0) + ham * 0.4;
  if (sh > 0) v.lumb = (v.lumb ?? 0) - sh * 0.5;
  if (v.rot !== undefined) {
    const r = clamp(v.rot, -mob.thoracicRot - 15, mob.thoracicRot + 15);
    v.rot = r;
  }
  meta.hamstringLimit = Math.max(meta.hamstringLimit ?? 0, ham);
  meta.heelRise = heel;
  meta.shoulderDeficit = sh;
  meta.lumbarFlex = Math.max(0, wink + ham * 0.4);
  if (sh > 0) meta.lumbarExt = sh * 0.5;
}

/** 한 발 지지: 반대쪽 골반 떨어짐, 지지다리 무릎 외반 */
export function stanceCompensation(b: Body, v: Record<string, number>, feet: ("L" | "R")[], intensity: number, meta: FrameMeta) {
  const c = (100 - b.capacity.control) / 100;
  const a = b.capacity.asym / 100;
  const valg: [number, number] = [0, 0];
  for (const k of feet) {
    const weak = k === "L" ? 1 - a * 1.6 : 1 + a * 1.6;
    const vg = Math.max(0, (Math.max(0, c - 0.2) * 14 + 1) * intensity * weak);
    valg[k === "L" ? 0 : 1] = vg;
    // 외반 = 고관절 내전 + 내회전
    v[`hab${k}`] = (v[`hab${k}`] ?? 0) - vg * 0.55;
    v[`hr${k}`] = (v[`hr${k}`] ?? 0) + vg * 1.1;
  }
  if (feet.length === 1) {
    const drop = (c * 7 + 0.8) * intensity * (feet[0] === "L" ? 1 - a : 1 + a);
    // 왼발 지지 → 오른쪽 골반이 떨어짐 (obliq + = 왼쪽 올라감)
    v.obliq = (v.obliq ?? 0) + (feet[0] === "L" ? drop : -drop);
    meta.obliq = feet[0] === "L" ? drop : -drop;
  }
  meta.valgus = valg;
}

export function dynFrame(ctx: Ctx, o: DynOpts, t: number): MoveFrame {
  const b = ctx.body;
  const v = sampleKeys(o.keys, t, o.cyclic);
  const meta: FrameMeta = {};
  o.tweak?.(ctx, v, t);
  const feet = o.contact(t);
  if (o.stanceComp && feet.length) stanceCompensation(b, v, feet, (o.landing?.(t) ?? 0.6) * (feet.length === 1 ? 1 : 0.7), meta);
  applyLimits(b, v, meta);
  // 다리 길이 차이 → 양발 지지 시 골반 기울기
  const dL = b.thigh[0] + b.shank[0] - (b.thigh[1] + b.shank[1]);
  if (feet.length === 2 && Math.abs(dL) > 0.001) v.obliq = (v.obliq ?? 0) + (Math.asin(clamp(dL / b.hipW, -0.3, 0.3)) * 180) / Math.PI * 0.6;
  const base = baseOf(v);
  let spec: PoseSpec = angleSpec(b, v, { base });
  let pose = buildPose(b, spec);
  // 흔드는 발이 디딘 발보다 낮으면(바닥 관통) 무릎·고관절을 더 굽혀 들어 올린다
  if (feet.length === 1) {
    const sw = feet[0] === "L" ? "R" : "L";
    for (let it = 0; it < 4; it++) {
      const j = pose.j;
      const st = feet[0];
      const stLow = Math.min(j[`heel${st}`][1], j[`ball${st}`][1], j[`toe${st}`][1]);
      const swLow = Math.min(j[`heel${sw}`][1], j[`ball${sw}`][1], j[`toe${sw}`][1]);
      const need = stLow + 0.012 - swLow;
      if (need <= 0) break;
      const deg = (need / Math.max(0.2, b.shank[sw === "L" ? 0 : 1])) * 57.3 * 1.3;
      v[`knee${sw}`] = (v[`knee${sw}`] ?? 0) + deg;
      v[`hip${sw}`] = (v[`hip${sw}`] ?? 0) + deg * 0.35;
      spec = angleSpec(b, v, { base });
      pose = buildPose(b, spec);
    }
  }
  const arms = o.arms?.(ctx, v, pose);
  if (arms) {
    spec = { ...spec, arms };
    pose = buildPose(b, spec);
  }
  const load = o.load?.(ctx, t, pose, v);
  const contacts: Contact[] = feet.length ? feetContacts(b, pose, feet) : [];
  meta.trunkLean = undefined;
  return {
    spec,
    pose,
    load,
    contacts,
    meta,
    phase: o.phase(t),
    surfaces: o.surfaces?.(ctx),
    contactFeet: feet,
    groundY: o.groundY?.(t) ?? 0,
  };
}

/** 키값으로 만든 자세의 무게중심 (발바닥 기준 높이 / 발볼 기준 앞뒤) */
export function comRelFeet(ctx: Ctx, keys: Key[], t: number, cyclic = false) {
  const b = ctx.body;
  const v = sampleKeys(keys, t, cyclic);
  applyLimits(b, v, {});
  const pose = buildPose(b, angleSpec(b, v, { base: baseOf(v) }));
  const c = bodyCom(b, pose);
  const j = pose.j;
  const low = Math.min(j.heelL[1], j.heelR[1], j.ballL[1], j.ballR[1], j.toeL[1], j.toeR[1]);
  const ballZ = (j.ballL[2] + j.ballR[2]) / 2;
  const heelZ = Math.min(j.heelL[2], j.heelR[2]);
  const toeZ = Math.max(j.toeL[2], j.toeR[2]);
  return { y: c[1] - low, z: c[2] - ballZ, ballZ, heelZ: heelZ - ballZ, toeZ: toeZ - ballZ, pelvisZ: j.pelvis[2] - ballZ, com: c, pose };
}

/** 체형·파워로 이륙 속도 추정: 미는 거리(무게중심 이동) × 순가속도 */
export function takeoffSpeed(b: Body, pushDist: number, k = 1) {
  const bmi = b.M / (b.H * b.H);
  const pf = (0.55 + (0.9 * b.capacity.power) / 100) * (b.sex === "f" ? 0.82 : 1) * clamp(Math.pow(22 / bmi, 0.6), 0.55, 1.12) * k;
  const aNet = G * pf;
  return Math.sqrt(2 * aNet * Math.max(0.05, pushDist));
}

export function flightTime(vy: number, dy: number) {
  // y1 = y0 + vy T - g T²/2, dy = y1 - y0
  const disc = vy * vy - 2 * G * dy;
  return disc <= 0 ? Math.max(0.05, vy / G) : (vy + Math.sqrt(disc)) / G;
}

export function projectileRange(v: number, angDeg: number, h: number) {
  const a = (angDeg * Math.PI) / 180;
  const vx = v * Math.cos(a),
    vy = v * Math.sin(a);
  return (vx / G) * (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, h)));
}

export function ballAt(release: Vec3, vel: Vec3, dt: number, radius: number): Vec3 {
  const y = release[1] + vel[1] * dt - 0.5 * G * dt * dt;
  return [release[0] + vel[0] * dt, Math.max(radius, y), release[2] + vel[2] * dt];
}

export const vsub = sub;

/* ───────────── 발 위치 고정형(역기구학) 동작 ───────────── */

import { maxPelvisY, standSpec } from "../kit";
import type { FootPlace } from "../pose";

export interface PlantOpts {
  keys: Key[];
  cyclic: boolean;
  phase: (t: number) => string;
  /** 발 위치 (m). 접지 여부는 y 로 판정 */
  feet: (ctx: Ctx, v: Record<string, number>, t: number) => [FootPlace, FootPlace];
  arms?: (ctx: Ctx, v: Record<string, number>, pose: Pose) => [ArmSpec, ArmSpec] | undefined;
  load?: (ctx: Ctx, t: number, pose: Pose, v: Record<string, number>) => LoadState | undefined;
  surfaces?: (ctx: Ctx) => Surface[];
  tweak?: (ctx: Ctx, v: Record<string, number>, t: number) => void;
  stanceComp?: number;
}

export function plantFrame(ctx: Ctx, o: PlantOpts, t: number): MoveFrame {
  const b = ctx.body;
  const v = sampleKeys(o.keys, t, o.cyclic);
  o.tweak?.(ctx, v, t);
  const meta: FrameMeta = {};
  const feet = o.feet(ctx, v, t).map((f) => ({ ...f })) as [FootPlace, FootPlace];
  anatomicalClamp(v);
  // 발끝 방향은 골반 방향 기준 안쪽 25° ~ 바깥 45° 안에서만 (넘으면 앞꿈치를 축으로 발이 따라 돈다)
  const py = v.yaw ?? 0;
  feet.forEach((f, i) => {
    const s = i === 0 ? 1 : -1;
    const toeOut = s * ((s * (f.yaw ?? 0)) - py);
    const lim = clamp(toeOut, -25, 45);
    if (lim !== toeOut) f.yaw = s * (py + s * lim);
  });
  // 발이 몸 반대편으로 너무 넘어가지 않게 (고관절 내전 약 25° 한계)
  {
    const Px0 = v.px ?? 0,
      Pz0 = v.pz ?? 0;
    const yr = (py * Math.PI) / 180;
    const lx = Math.cos(yr),
      lz = -Math.sin(yr); // 골반 왼쪽 축 (수평)
    const minLat = b.hipW / 2 - b.legLen * Math.sin((10 * Math.PI) / 180);
    feet.forEach((f, i) => {
      const s = i === 0 ? 1 : -1;
      const rel = (f.x - Px0) * lx + (f.z - Pz0) * lz;
      const lat = s * rel;
      if (lat < minLat) {
        const push = (minLat - lat) * s;
        f.x += push * lx;
        f.z += push * lz;
      }
    });
  }
  const onGround = (["L", "R"] as const).filter((_, i) => (feet[i].y ?? 0) < 0.004);
  const c = (100 - b.capacity.control) / 100;
  const valg: [number, number] = [0, 0];
  if (o.stanceComp) {
    for (const k of onGround) {
      const a = b.capacity.asym / 100;
      valg[k === "L" ? 0 : 1] = Math.max(0, (Math.max(0, c - 0.2) * 14 + 1) * o.stanceComp * (k === "L" ? 1 - a * 1.6 : 1 + a * 1.6) * (onGround.length === 1 ? 1 : 0.6));
    }
    if (onGround.length === 1) {
      const drop = Math.min(5, (c * 7 + 0.8) * o.stanceComp);
      v.obliq = (v.obliq ?? 0) + (onGround[0] === "L" ? drop : -drop);
      meta.obliq = v.obliq;
    }
  }
  meta.valgus = valg;
  const Px = v.px ?? 0,
    Pz = v.pz ?? 0;
  const yaw = v.yaw ?? 0;
  const yMax = maxPelvisY(b, { Px, Pz, obliq: v.obliq ?? 0, feet, yaw });
  const Py = yMax - (v.drop ?? 0) * b.legLen;
  const q = {
    Px,
    Py,
    Pz,
    tau: v.tilt ?? 0,
    lumbar: v.lumb ?? 0,
    thorax: v.thor ?? 0,
    neck: v.neck ?? 0,
    side: v.side ?? 0,
    rot: clamp(v.rot ?? 0, -b.mobility.thoracicRot - 15, b.mobility.thoracicRot + 15),
    yaw,
    obliq: v.obliq ?? 0,
    base: baseOf({ lean: v.lean ?? 0, bank: v.bank ?? 0 }),
    feet,
    valgus: valg,
  };
  const armsA: [ArmSpec, ArmSpec] = [
    { sh: { flex: v.shL ?? 0, abd: v.sabL ?? 8, rot: v.srL ?? 0 }, elbow: v.elL ?? 10 },
    { sh: { flex: v.shR ?? 0, abd: v.sabR ?? 8, rot: v.srR ?? 0 }, elbow: v.elR ?? 10 },
  ];
  // 어깨 가동 범위
  for (const [i, k] of [[0, "shL"], [1, "shR"]] as const) {
    const a = armsA[i] as { sh: { flex: number } };
    if (a.sh.flex > b.mobility.shoulderFlex) {
      meta.shoulderDeficit = Math.max(meta.shoulderDeficit ?? 0, a.sh.flex - b.mobility.shoulderFlex);
      a.sh.flex = b.mobility.shoulderFlex;
    }
    void k;
  }
  let spec = standSpec({ ...q, arms: armsA });
  let pose = buildPose(b, spec);
  // 디딘 발의 발목이 가동범위를 넘으면 뒤꿈치를 든다
  const dfLim = Math.min(b.mobility.ankleDF, 52);
  for (let it = 0; it < 3; it++) {
    const ang = measureAngles(pose);
    let changed = false;
    onGround.forEach((k) => {
      const i = k === "L" ? 0 : 1;
      const ex = ang.ankleDF[i] - dfLim;
      if (ex > 0.5) {
        feet[i].heelRise = (feet[i].heelRise ?? 0) + ex;
        changed = true;
      }
    });
    if (!changed) break;
    spec = standSpec({ ...q, feet, arms: armsA });
    pose = buildPose(b, spec);
  }
  const arms = o.arms?.(ctx, v, pose);
  if (arms) {
    spec = { ...spec, arms };
    pose = buildPose(b, spec);
  }
  const load = o.load?.(ctx, t, pose, v);
  return {
    spec,
    pose,
    load,
    contacts: onGround.length ? feetContacts(b, pose, onGround) : [],
    meta,
    phase: o.phase(t),
    surfaces: o.surfaces?.(ctx),
    contactFeet: onGround,
  };
}
