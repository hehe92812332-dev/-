// 동작 정의에 쓰는 공용 도구: 키프레임 보간, 지지면, 서 있는 자세 구성, 스쿼트·힙힌지 풀이기.
import type { Body } from "./anthropometry";
import {
  add,
  apply,
  clamp,
  col,
  DEG,
  lerp,
  Rx,
  Ry,
  scale,
  smooth,
  solveMonotone,
  sub,
  type Mat3,
  type Vec3,
} from "./math";
import { bodyCom, buildPose, measureAngles, type ArmSpec, type FootPlace, type Pose, type PoseSpec } from "./pose";
import type { Contact, Ctx, FrameMeta, LoadState, MoveFrame } from "./types";

export const G = 9.81;

/* ───────────── 키프레임 ───────────── */

export type Key = { t: number } & Record<string, number>;

/** 키프레임 보간 (극값에서 접선 0인 3차 Hermite → 넘침 없음) */
export function sampleKeys(keys: Key[], t: number, cyclic = false): Record<string, number> {
  const out: Record<string, number> = {};
  const fields = new Set<string>();
  for (const k of keys) for (const f in k) if (f !== "t") fields.add(f);
  for (const f of fields) {
    const pts = keys.filter((k) => f in k).map((k) => [k.t, k[f]] as [number, number]);
    out[f] = interp(pts, t, cyclic);
  }
  return out;
}

function interp(pts: [number, number][], t: number, cyclic: boolean): number {
  const n = pts.length;
  if (n === 1) return pts[0][1];
  let tt = t;
  if (cyclic) tt = ((t % 1) + 1) % 1;
  // 구간 찾기 (순환이면 마지막→첫 구간 포함)
  const ext: [number, number][] = cyclic
    ? [[pts[n - 1][0] - 1, pts[n - 1][1]], ...pts, [pts[0][0] + 1, pts[0][1]], [pts[1][0] + 1, pts[1][1]]]
    : pts;
  if (!cyclic) {
    if (tt <= pts[0][0]) return pts[0][1];
    if (tt >= pts[n - 1][0]) return pts[n - 1][1];
  }
  let i = 0;
  while (i < ext.length - 2 && tt > ext[i + 1][0]) i++;
  const [t0, v0] = ext[i];
  const [t1, v1] = ext[i + 1];
  const h = t1 - t0;
  if (h <= 1e-9) return v1;
  const slope = (a: number) => {
    if (a <= 0 || a >= ext.length - 1) return 0;
    const dPrev = (ext[a][1] - ext[a - 1][1]) / Math.max(1e-9, ext[a][0] - ext[a - 1][0]);
    const dNext = (ext[a + 1][1] - ext[a][1]) / Math.max(1e-9, ext[a + 1][0] - ext[a][0]);
    if (dPrev * dNext <= 0) return 0;
    return (2 * dPrev * dNext) / (dPrev + dNext); // 조화평균 (Fritsch-Carlson)
  };
  const m0 = slope(i) * h,
    m1 = slope(i + 1) * h;
  const s = (tt - t0) / h;
  const s2 = s * s,
    s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
}

/** 0→1→0 왕복 진행도 (하강-정지-상승) */
export function repPhase(t: number, down = 0.42, hold = 0.12, startHold = 0.04) {
  if (t < startHold) return { d: 0, phase: "준비" };
  if (t < startHold + down) return { d: smooth((t - startHold) / down), phase: "내려가기" };
  if (t < startHold + down + hold) return { d: 1, phase: "바닥 지점" };
  const up = 1 - startHold - down - hold - 0.04;
  if (t < 1 - 0.04) return { d: 1 - smooth((t - startHold - down - hold) / up), phase: "올라오기" };
  return { d: 0, phase: "마무리" };
}

/* ───────────── 지지면 ───────────── */

export function footContact(body: Body, pose: Pose, side: 0 | 1): Contact {
  const k = side === 0 ? "L" : "R";
  const j = pose.j;
  const Rf = side === 0 ? pose.R.footL : pose.R.footR;
  const lat = col(Rf, 0);
  const w = body.foot.width / 2;
  const heel = j[`heel${k}`],
    ball = j[`ball${k}`],
    toe = j[`toe${k}`];
  const heelUp = heel[1] - Math.min(ball[1], toe[1]) > 0.01;
  const back = heelUp ? ball : heel;
  const g = (p: Vec3, sgn: number, k2 = 1): Vec3 => [p[0] + lat[0] * w * sgn * k2, p[1], p[2] + lat[2] * w * sgn * k2];
  return {
    id: k,
    group: "feet",
    pts: [g(back, 1, 0.75), g(back, -1, 0.75), g(toe, -1, 0.8), g(toe, 1, 0.8)],
    axis: [back, toe],
  };
}

export function feetContacts(body: Body, pose: Pose, which: ("L" | "R")[] = ["L", "R"]): Contact[] {
  return which.map((k) => footContact(body, pose, k === "L" ? 0 : 1));
}

/* ───────────── 부하 ───────────── */

export function systemCom(body: Body, pose: Pose, load?: LoadState): Vec3 {
  const c = bodyCom(body, pose);
  if (!load || !load.carried || load.mass <= 0) return c;
  const M = body.M,
    m = load.mass;
  return [(c[0] * M + load.center[0] * m) / (M + m), (c[1] * M + load.center[1] * m) / (M + m), (c[2] * M + load.center[2] * m) / (M + m)];
}

export const thoraxPoint = (pose: Pose, local: Vec3): Vec3 => add(pose.j.c7, apply(pose.R.thorax, local));
export const pelvisPoint = (pose: Pose, local: Vec3): Vec3 => add(pose.j.pelvis, apply(pose.R.pelvis, local));

export function barbell(mass: number, center: Vec3, carried = true): LoadState {
  return { kind: "barbell", mass, center, axis: [1, 0, 0], carried };
}

/* ───────────── 서 있는 자세 ───────────── */

export interface StandQ {
  Px?: number;
  Py: number;
  Pz: number;
  tau: number; // 골반 전방 경사
  lumbar?: number;
  thorax?: number;
  neck?: number;
  side?: number;
  rot?: number;
  yaw?: number;
  obliq?: number;
  base?: Mat3;
  feet: [FootPlace, FootPlace];
  valgus?: [number, number];
  arms: [ArmSpec, ArmSpec];
}

export function standSpec(q: StandQ): PoseSpec {
  return {
    pelvis: { pos: [q.Px ?? 0, q.Py, q.Pz], tilt: q.tau, obliq: q.obliq ?? 0, yaw: q.yaw ?? 0, base: q.base },
    lumbar: { flex: q.lumbar ?? 0, abd: q.side ?? 0, rot: (q.rot ?? 0) * 0.4 },
    thorax: { flex: q.thorax ?? 0, rot: (q.rot ?? 0) * 0.6 },
    neck: { flex: q.neck ?? 0 },
    legs: [
      { ik: q.feet[0], valgus: q.valgus?.[0] ?? 0 },
      { ik: q.feet[1], valgus: q.valgus?.[1] ?? 0 },
    ],
    arms: q.arms,
  };
}

/** 발 위치에서 발목 관절 위치 (FootPlace 와 같은 규칙) */
export function anklePos(body: Body, side: 0 | 1, f: FootPlace): Vec3 {
  const pose = { j: {}, R: {} } as Pose;
  void pose;
  const s = side === 0 ? 1 : -1;
  const ah = body.ankleH[side],
    ft = body.foot;
  const yaw = Ry(s * (f.yaw ?? 0));
  const Rf = footFrameLocal(side, f);
  const midLocal: Vec3 = [0, -ah, (ft.toe - ft.heel) / 2];
  const mid: Vec3 = [f.x, f.y ?? 0, f.z];
  if ((f.toeRise ?? 0) > 0) {
    const heelLocal: Vec3 = [0, -ah, -ft.heel];
    return sub(add(mid, apply(yaw, sub(heelLocal, midLocal))), apply(Rf, heelLocal));
  }
  const ballLocal: Vec3 = [0, -ah, ft.ball];
  return sub(add(mid, apply(yaw, sub(ballLocal, midLocal))), apply(Rf, ballLocal));
}

function footFrameLocal(side: 0 | 1, f: FootPlace): Mat3 {
  const s = side === 0 ? 1 : -1;
  const a = Ry(s * (f.yaw ?? 0));
  const b = Rx(f.heelRise ?? 0);
  const c = Rx(-(f.toeRise ?? 0));
  return mulM(mulM(a, b), c);
}
function mulM(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as unknown as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

/** 두 다리가 모두 닿는 최대 골반 높이 */
export function maxPelvisY(body: Body, q: Pick<StandQ, "Px" | "Pz" | "obliq" | "feet" | "yaw">, slack = 0.9993) {
  let best = Infinity;
  const psi = (q.obliq ?? 0) * DEG;
  for (const side of [0, 1] as const) {
    const s = side === 0 ? 1 : -1;
    const a = anklePos(body, side, q.feet[side]);
    const L = (body.thigh[side] + body.shank[side]) * slack;
    const yawR = Ry(q.yaw ?? 0);
    const off = apply(yawR, [((s * body.hipW) / 2) * Math.cos(psi), ((s * body.hipW) / 2) * Math.sin(psi), 0]);
    const hx = (q.Px ?? 0) + off[0];
    const hz = q.Pz + off[2];
    const dx = hx - a[0],
      dz = hz - a[2];
    const h2 = L * L - dx * dx - dz * dz;
    const yMax = a[1] + Math.sqrt(Math.max(0, h2)) - off[1];
    best = Math.min(best, yMax);
  }
  return best;
}

export function stdStanding(ctx: Ctx) {
  const key = "stdStanding";
  if (ctx.cache[key]) return ctx.cache[key] as { pose: Pose; Py: number; shoulderY: number; gripY: number };
  const b = ctx.body;
  const feet = hipFeet(b, 0);
  const Py = maxPelvisY(b, { Pz: anklePos(b, 0, feet[0])[2] + 0.01, feet });
  const pose = buildPose(
    b,
    standSpec({ Py, Pz: anklePos(b, 0, feet[0])[2] + 0.01, tau: 0, feet, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }),
  );
  const shoulderY = (pose.j.shL[1] + pose.j.shR[1]) / 2;
  const v = { pose, Py, shoulderY, gripY: (pose.j.gripL[1] + pose.j.gripR[1]) / 2 };
  ctx.cache[key] = v;
  return v;
}

/** 골반 너비 스탠스 */
export function hipFeet(b: Body, toeOut = 7, widthK = 1): [FootPlace, FootPlace] {
  const w = Math.max(b.hipW, b.hipW * widthK) / 2 + 0.01;
  return [
    { x: w, z: 0, yaw: toeOut },
    { x: -w, z: 0, yaw: toeOut },
  ];
}

/* ───────────── 공통 보상 계산 ───────────── */

/** 다리 길이 차이 → 골반 기울기(도), 측방 이동(m) */
export function legDiffComp(b: Body, d: number) {
  const dL = b.thigh[0] + b.shank[0] - (b.thigh[1] + b.shank[1]);
  const psi0 = Math.asin(clamp(dL / b.hipW, -0.35, 0.35)) / DEG;
  return { obliq: psi0 * (1 - 0.45 * d), shiftX: -0.45 * dL };
}

/** 좌우 근력 차이 → 강한 쪽으로 이동 (m) */
export function asymShift(b: Body, d: number, scaleM = 0.11) {
  return (b.capacity.asym / 100) * scaleM * (0.35 + 0.65 * d);
}

/** 조절 능력·피로·부하 → 무릎 외반 (도) */
export function valgusFor(b: Body, d: number, relLoad: number, extra = 0): [number, number] {
  const c = (100 - b.capacity.control) / 100;
  const base = (Math.max(0, c - 0.25) * 14 + relLoad * relLoad * 3) * Math.pow(clamp(d, 0, 1), 1.2) + extra;
  const a = b.capacity.asym / 100;
  // 약한 쪽이 더 무너진다
  return [Math.max(0, base * (1 - a * 1.5)), Math.max(0, base * (1 + a * 1.5))];
}

/** 상대 강도 (부하 / 추정 1RM) */
export function relIntensity(b: Body, loadKg: number, rmPerBw: number) {
  const pf = 0.55 + (b.capacity.power / 100) * 1.1;
  const rm = b.M * rmPerBw * pf * (b.sex === "f" ? 0.72 : 1);
  return clamp(loadKg / Math.max(1, rm), 0, 1.5);
}

/* ───────────── 스쿼트 풀이기 ───────────── */

export type BarPos = "high" | "low" | "front" | "goblet" | "overhead" | "none";

export interface SquatCfg {
  bar: BarPos;
  stanceK: number; // 발 중심 간 거리 / 어깨관절 간 거리
  toeOut: number;
  depth: number; // 바닥 고관절 높이 / 서 있을 때 무릎 높이
  trunkPref: number;
  trunkMax: number;
  heelWedge?: number;
  rmPerBw: number;
}

interface SquatSol {
  spec: PoseSpec;
  pose: Pose;
  load?: LoadState;
  meta: FrameMeta;
  df: number;
}

export function barLocal(b: Body, bar: BarPos): Vec3 {
  const H = b.H;
  switch (bar) {
    case "high":
      return [0, -0.03 * H, -0.05 * H];
    case "low":
      return [0, -0.075 * H, -0.055 * H];
    case "front":
      return [0, -0.025 * H, 0.08 * H];
    case "goblet":
      return [0, -0.15 * H, 0.13 * H];
    default:
      return [0, 0, 0];
  }
}

export function squatArms(b: Body, bar: BarPos, theta: number, overheadRel: number): [ArmSpec, ArmSpec] {
  const H = b.H;
  if (bar === "high" || bar === "low") {
    const bl = barLocal(b, bar);
    const gw = b.shW * (bar === "low" ? 1.3 : 1.15) + 0.05;
    return [
      { ikLocal: [gw, bl[1] + 0.005, bl[2] + 0.01], poleLocal: [0.5, -1, -0.6] },
      { ikLocal: [-gw, bl[1] + 0.005, bl[2] + 0.01], poleLocal: [0.5, -1, -0.6] },
    ];
  }
  if (bar === "front") {
    const bl = barLocal(b, bar);
    const gw = b.shW * 0.62;
    return [
      { ikLocal: [gw, bl[1] - 0.01, bl[2] - 0.01], poleLocal: [0.3, 0.1, 1] },
      { ikLocal: [-gw, bl[1] - 0.01, bl[2] - 0.01], poleLocal: [0.3, 0.1, 1] },
    ];
  }
  if (bar === "goblet") {
    const bl = barLocal(b, bar);
    return [
      { ikLocal: [0.06, bl[1], bl[2] - 0.02], poleLocal: [0.6, -1, 0.2] },
      { ikLocal: [-0.06, bl[1], bl[2] - 0.02], poleLocal: [0.6, -1, 0.2] },
    ];
  }
  if (bar === "overhead") {
    const reach = b.upperArm + b.forearm + b.hand * 0.45;
    const gw = b.shW * 1.7;
    const lat = (gw - b.shW) / 2;
    const r = Math.sqrt(Math.max(0.01, reach * reach - lat * lat)) * 0.995;
    const a = overheadRel * DEG;
    const yv = b.shoulderOff[0] - r * Math.cos(a);
    const zv = b.shoulderOff[1] + r * Math.sin(a);
    return [
      { ikLocal: [gw / 2, yv, zv], poleLocal: [1, 0, -0.2] },
      { ikLocal: [-gw / 2, yv, zv], poleLocal: [1, 0, -0.2] },
    ];
  }
  // 맨몸: 팔을 앞으로
  const fl = clamp(90 + theta * 0.7, 0, b.mobility.shoulderFlex);
  void H;
  return [
    { sh: { flex: fl, abd: 6 }, elbow: 5 },
    { sh: { flex: fl, abd: 6 }, elbow: 5 },
  ];
}

/** 스쿼트 계열 한 프레임 풀기. d = 깊이 진행도 0~1 */
export function solveSquat(ctx: Ctx, cfg: SquatCfg, d: number): SquatSol {
  const b = ctx.body;
  const mob = b.mobility;
  const loadKg = cfg.bar === "none" ? 0 : ctx.loadKg;
  const rel = relIntensity(b, loadKg, cfg.rmPerBw);
  const stance = cfg.stanceK * b.shW;
  const lim = mob.ankleDF;
  const ld = legDiffComp(b, d);
  const shiftX = ld.shiftX + asymShift(b, d);
  const feetBase = (heel: number): [FootPlace, FootPlace] => [
    { x: stance / 2, z: 0, yaw: cfg.toeOut, heelRise: heel },
    { x: -stance / 2, z: 0, yaw: cfg.toeOut, heelRise: heel },
  ];
  const standTop = maxPelvisY(b, { Px: shiftX, Pz: anklePos(b, 0, feetBase(0)[0])[2], obliq: ld.obliq, feet: feetBase(0) });
  const kneeStand = b.ankleH[0] + (b.shank[0] + b.shank[1]) / 2;
  const bottomY = cfg.depth * kneeStand;
  // 오버헤드: 팔이 수직이려면 어깨굴곡 180+θ 필요 → 가능한 범위까지만
  const ohAvail = Math.min(mob.shoulderFlex + 12, 186);
  const trunkMax = cfg.bar === "overhead" ? clamp(ohAvail - 180 + 18, 4, cfg.trunkMax) : cfg.trunkMax;
  const neckFor = (th: number) => -th * 0.45;

  const build = (dd: number, theta: number, heel: number, Pz: number, lumbarX: number) => {
    const feet = feetBase(heel);
    const ease = smooth(dd);
    const yTarget = lerp(standTop, bottomY, ease);
    const yMax = maxPelvisY(b, { Px: shiftX, Pz, obliq: ld.obliq, feet });
    const Py = Math.min(yTarget, yMax);
    const tau = theta - lumbarX;
    const ohRel = Math.min(ohAvail, 180 + theta);
    const valg = valgusFor(b, dd, rel, heel * 0.35);
    const spec = standSpec({
      Px: shiftX,
      Py,
      Pz,
      tau,
      lumbar: lumbarX,
      neck: neckFor(theta),
      obliq: ld.obliq,
      side: ld.obliq * 0.8,
      feet,
      valgus: valg,
      arms: squatArms(b, cfg.bar, theta, ohRel),
    });
    const pose = buildPose(b, spec);
    let load: LoadState | undefined;
    if (cfg.bar === "high" || cfg.bar === "low" || cfg.bar === "front") load = { ...barbell(loadKg, thoraxPoint(pose, barLocal(b, cfg.bar))), onBody: true };
    else if (cfg.bar === "goblet") load = { kind: "kettlebell", mass: loadKg, center: thoraxPoint(pose, barLocal(b, "goblet")), carried: true };
    else if (cfg.bar === "overhead") {
      const c: Vec3 = [(pose.j.gripL[0] + pose.j.gripR[0]) / 2, (pose.j.gripL[1] + pose.j.gripR[1]) / 2, (pose.j.gripL[2] + pose.j.gripR[2]) / 2];
      load = barbell(loadKg, c);
    }
    return { spec, pose, load, Py, yTarget, valg, ohRel };
  };

  // 균형 목표: 발 중앙. 뒤꿈치가 들리면 지지면이 발볼~발끝으로 줄어 목표도 발볼 앞으로 옮긴다
  const ballZ = anklePos(b, 0, feetBase(0)[0])[2] + b.foot.ball * Math.cos((cfg.toeOut * Math.PI) / 180);
  const targetFor = (heel: number) => lerp(0, ballZ + 0.02, clamp((heel - (cfg.heelWedge ?? 0)) / 1.5, 0, 1));
  const zLo = anklePos(b, 0, feetBase(0)[0])[2] - (b.thigh[0] + b.shank[0]) * 0.75;
  const zHi = anklePos(b, 0, feetBase(0)[0])[2] + b.shank[0] * 0.9;

  const solveZ = (dd: number, theta: number, heel: number, lumbarX: number) => {
    const r = solveMonotone(
      (z) => {
        const s = build(dd, theta, heel, z, lumbarX);
        return systemCom(b, s.pose, s.load)[2] - targetFor(heel);
      },
      zLo,
      zHi,
      0.0015,
      30,
    );
    const out = build(dd, theta, heel, r.x, lumbarX);
    const ang = measureAngles(out.pose);
    return { ...out, Pz: r.x, ok: r.ok, df: Math.max(ang.ankleDF[0], ang.ankleDF[1]), ang };
  };

  // 1) 선호 몸통각에서 균형 → 2) 발목 부족 시 몸통 숙임 → 3) 그래도 부족하면 뒤꿈치 들림
  //   → 4) 고관절 굴곡 한계는 골반 후방경사(버트윙크) → 5) 한계를 넘으면 깊이를 잃는다
  const dEase = smooth(d);
  const wedge = cfg.heelWedge ?? 0;
  const lumbarMax = 6 + ((100 - b.capacity.control) / 100) * 22;
  const heelMax = 6 + ((100 - b.capacity.control) / 100) * 14;
  const evalAt = (dd: number) => {
    const thetaPref = cfg.trunkPref * smooth(dd);
    const trunkHeel = (lumbarX: number) => {
      let theta = Math.min(thetaPref, trunkMax);
      let heel = wedge;
      let sol = solveZ(dd, theta, heel, lumbarX);
      if (sol.df > lim + 0.3) {
        const fTheta = (th: number) => solveZ(dd, th, heel, lumbarX).df - lim;
        if (fTheta(trunkMax) <= 0) {
          theta = solveMonotone((th) => -fTheta(th), theta, trunkMax, 0.2, 18).x;
          sol = solveZ(dd, theta, heel, lumbarX);
        } else {
          theta = trunkMax;
          for (let i = 0; i < 5; i++) {
            sol = solveZ(dd, theta, heel, lumbarX);
            const need = sol.df - lim;
            if (need <= 0.3 || heel >= wedge + heelMax) break;
            heel = Math.min(wedge + heelMax, heel + need);
          }
          sol = solveZ(dd, theta, heel, lumbarX);
        }
      }
      return { sol, theta, heel };
    };
    let r = trunkHeel(0);
    let lumbarX = 0;
    // 고관절 굴곡 한계: 사용자 가동성과 해부학적 상한(135°) 중 작은 값
    const hipLim = Math.min(mob.hipFlex, 135);
    const hipF = Math.max(r.sol.ang.hipFlex[0], r.sol.ang.hipFlex[1]);
    if (hipF > hipLim) {
      lumbarX = Math.min(lumbarMax, hipF - hipLim);
      r = trunkHeel(lumbarX);
    }
    const hipF2 = Math.max(r.sol.ang.hipFlex[0], r.sol.ang.hipFlex[1]);
    const viol = Math.max(r.sol.df - lim - 1, hipF2 - Math.min(mob.hipFlex, 135) - 2);
    return { ...r, lumbarX, thetaPref, viol };
  };
  let dd = d;
  let ev = evalAt(dd);
  if (ev.viol > 0 && d > 0.02) {
    const rr = solveMonotone((x) => -evalAt(x).viol, 0, d, 0.003, 16);
    dd = Math.min(d, rr.x);
    ev = evalAt(dd);
  }
  const { sol, theta, heel, lumbarX, thetaPref } = ev;
  const heelR = Math.max(0, heel - wedge);
  void dEase;
  const meta: FrameMeta = {
    heelRise: [heelR, heelR],
    lumbarFlex: lumbarX,
    valgus: sol.valg,
    depthLoss: d > 0 ? (d - dd) / Math.max(d, 1e-6) : 0,
    trunkLean: sol.ang.trunkLean,
    trunkExtra: Math.max(0, theta - thetaPref),
    obliq: ld.obliq,
    shiftX,
    shoulderDeficit: cfg.bar === "overhead" ? Math.max(0, 180 + theta - ohAvail) : 0,
  };
  return { spec: sol.spec, pose: sol.pose, load: sol.load, meta, df: sol.df };
}

/* ───────────── 힙힌지(데드리프트 계열) 풀이기 ───────────── */

export interface HingeCfg {
  variant: "conv" | "sumo" | "rdl";
  stanceK: number;
  toeOut: number;
  gripOutside: boolean;
  rmPerBw: number;
}

/** 바 높이 진행도 d(0 = 바닥/최저점, 1 = 락아웃)에서 자세 풀이 */
export function solveHinge(ctx: Ctx, cfg: HingeCfg, d: number) {
  const b = ctx.body;
  const H = b.H;
  const mob = b.mobility;
  const loadKg = ctx.loadKg;
  const rel = relIntensity(b, loadKg, cfg.rmPerBw);
  const stance = cfg.stanceK * b.hipW;
  const feet: [FootPlace, FootPlace] = [
    { x: stance / 2, z: 0, yaw: cfg.toeOut },
    { x: -stance / 2, z: 0, yaw: cfg.toeOut },
  ];
  const ld = legDiffComp(b, 1 - d);
  const shiftX = ld.shiftX + asymShift(b, 1 - d);
  const Lt = (b.thigh[0] + b.thigh[1]) / 2;
  const Ls = (b.shank[0] + b.shank[1]) / 2;
  const dx = Math.max(0, stance / 2 - b.hipW / 2);
  const cosA = Math.sqrt(Math.max(0.3, 1 - (dx / (Lt + Ls)) ** 2));
  // 토아웃이 크면 무릎이 옆으로 나가 시상면 투영이 짧아진다
  const sagK = cfg.variant === "sumo" ? Math.cos(cfg.toeOut * DEG * 0.75) : 1;
  const LtE = Lt * cosA,
    LsE = Ls * cosA;
  const ah = b.ankleH[0];
  const a = anklePos(b, 0, feet[0]);
  const aZ = a[2];
  const reach = b.upperArm + b.forearm + b.hand * 0.45;
  const st = stdStanding(ctx);
  const gripHalf = cfg.gripOutside ? Math.max(stance / 2 + 0.07, b.shW / 2 + 0.03) : Math.max(b.hipW / 2 + 0.02, b.shW * 0.36);
  const armVert = Math.sqrt(Math.max(0.05, reach * reach - (gripHalf - b.shW / 2) ** 2));
  // 몸통 벡터 (고관절중심 → 어깨관절 높이)
  const trunkVec = { y: b.l5[1] + b.lumbar + b.thorax + b.shoulderOff[0], z: b.l5[2] + b.shoulderOff[1] };
  const T = Math.hypot(trunkVec.y, trunkVec.z);
  const trunkOff = Math.atan2(trunkVec.z, trunkVec.y) / DEG;

  const plateR = 0.225;
  const lockY = st.shoulderY - armVert;
  const rdlBottom = Math.max(plateR + 0.04, ah + Ls * 0.45);
  const lowY = cfg.variant === "rdl" ? rdlBottom : plateR;
  const kneeY = ah + Ls;

  const geo = (barY: number, barZ: number, hamLimitDeg: number | null) => {
    // 정강이 각: 바닥에서는 정강이가 바에 닿고, 락아웃에서는 수직
    let phiS: number;
    if (cfg.variant === "rdl") phiS = 6 * (1 - smooth((barY - lowY) / Math.max(0.05, lockY - lowY)) * 0.3);
    else {
      const contact = Math.atan2(Math.max(0.005, barZ - 0.045 - aZ), Math.max(0.05, barY - ah)) / DEG;
      const prog = clamp((barY - lowY) / Math.max(0.05, lockY - lowY), 0, 1);
      phiS = (barY < kneeY ? contact : contact * (1 - smooth((barY - kneeY) / Math.max(0.05, lockY - kneeY)))) * (1 - prog * prog * 0.2);
      phiS *= sagK;
    }
    const K = { y: ah + LsE * Math.cos(phiS * DEG), z: aZ + LsE * Math.sin(phiS * DEG) };
    const lead = (cfg.variant === "conv" ? 0.035 : cfg.variant === "sumo" ? 0.015 : 0.03) * (1 - d) - 0.03 * Math.pow(d, 3);
    const S = { y: barY + armVert, z: barZ + lead };
    const dKS = Math.hypot(S.y - K.y, S.z - K.z);
    let Hp: { y: number; z: number };
    if (dKS >= LtE + T - 1e-4) {
      const u = { y: (S.y - K.y) / dKS, z: (S.z - K.z) / dKS };
      Hp = { y: K.y + u.y * LtE, z: K.z + u.z * LtE };
    } else {
      const aa = (LtE * LtE - T * T + dKS * dKS) / (2 * dKS);
      const hh = Math.sqrt(Math.max(0, LtE * LtE - aa * aa));
      const u = { y: (S.y - K.y) / dKS, z: (S.z - K.z) / dKS };
      // 엉덩이는 뒤쪽 해
      const c1 = { y: K.y + u.y * aa - u.z * hh, z: K.z + u.z * aa + u.y * hh };
      const c2 = { y: K.y + u.y * aa + u.z * hh, z: K.z + u.z * aa - u.y * hh };
      Hp = c1.z < c2.z ? c1 : c2;
    }
    let theta = Math.atan2(S.z - Hp.z, S.y - Hp.y) / DEG - trunkOff;
    const phiT = Math.atan2(K.z - Hp.z, Hp.y - K.y) / DEG;
    // 햄스트링: 무릎이 굽을수록 여유 (이관절근)
    const kneeFlex = phiS + phiT;
    const hamAllow = mob.hamstring + 0.7 * Math.max(0, kneeFlex) + 8;
    const hipFlexNeed = phiT + theta;
    let lumbarX = 0;
    const lim = Math.min(hamAllow, mob.hipFlex);
    if (hamLimitDeg === null && hipFlexNeed > lim) lumbarX = Math.min(40, hipFlexNeed - lim);
    return { Hp, theta, phiT, phiS, lumbarX, hipFlexNeed, lim, kneeFlex };
  };

  const build = (barY: number, barZ: number) => {
    const g = geo(barY, barZ, null);
    const tau = g.theta - g.lumbarX;
    const valg = valgusFor(b, 1 - d, rel);
    const spec = standSpec({
      Px: shiftX,
      Py: g.Hp.y,
      Pz: g.Hp.z,
      tau,
      lumbar: g.lumbarX * 0.6,
      thorax: g.lumbarX * 0.4,
      neck: -g.theta * 0.35,
      obliq: ld.obliq,
      side: ld.obliq * 0.8,
      feet,
      valgus: valg,
      arms: [
        { ik: [gripHalf, barY, barZ], pole: [0.3, 0, -1] },
        { ik: [-gripHalf, barY, barZ], pole: [-0.3, 0, -1] },
      ],
    });
    // 골반 높이가 다리 길이를 넘지 않게
    const yMax = maxPelvisY(b, { Px: shiftX, Pz: g.Hp.z, obliq: ld.obliq, feet });
    if (spec.pelvis.pos[1] > yMax) spec.pelvis.pos = [spec.pelvis.pos[0], yMax, spec.pelvis.pos[2]];
    const pose = buildPose(b, spec);
    const load = barbell(loadKg, [0, barY, barZ]);
    return { spec, pose, load, g, valg };
  };

  // RDL: 햄스트링 한계 → 조절이 좋으면 가동범위 감소, 나쁘면 허리 말림
  let barY = lerp(lowY, lockY, d);
  let hamLimit = 0;
  if (cfg.variant === "rdl" && b.capacity.control >= 50) {
    const over = (y: number) => {
      const g = geo(y, 0, 0);
      return g.hipFlexNeed - g.lim;
    };
    if (over(barY) > 0) {
      const r = solveMonotone((y) => -over(y), barY, lockY, 0.002, 30);
      hamLimit = r.x - barY;
      barY = r.x;
    }
  }
  // 바의 앞뒤 위치: 시스템 무게중심이 발 중앙에 오도록
  const r = solveMonotone((z) => {
    const s = build(barY, z);
    return systemCom(b, s.pose, s.load)[2];
  }, -0.06, 0.16, 0.001, 30);
  const sol = build(barY, r.x);
  const ang = measureAngles(sol.pose);
  // 정강이-바 충돌 검사
  const kneeZ = Math.max(sol.pose.j.kneeL[2], sol.pose.j.kneeR[2]);
  const meta: FrameMeta = {
    lumbarFlex: sol.g.lumbarX,
    valgus: sol.valg,
    trunkLean: ang.trunkLean,
    obliq: ld.obliq,
    shiftX,
    hamstringLimit: hamLimit > 0 ? hamLimit * 100 : 0,
    barDrift: r.x,
  };
  void H;
  return { spec: sol.spec, pose: sol.pose, load: sol.load, meta, barY, barZ: r.x, kneeZ, lowY, lockY, angles: ang };
}

/* ───────────── 유틸 ───────────── */

export function frame(
  ctx: Ctx,
  spec: PoseSpec,
  pose: Pose,
  extra: Partial<MoveFrame> & { phase: string; meta?: FrameMeta },
): MoveFrame {
  return {
    spec,
    pose,
    contacts: extra.contacts ?? feetContacts(ctx.body, pose),
    meta: extra.meta ?? {},
    phase: extra.phase,
    load: extra.load,
    surfaces: extra.surfaces,
    contactFeet: extra.contactFeet,
  };
}

/** 각도 키값 → PoseSpec (각도 모드) */
export function angleSpec(b: Body, v: Record<string, number>, extra?: { base?: Mat3; arms?: [ArmSpec, ArmSpec] }): PoseSpec {
  const g = (k: string, d = 0) => (k in v ? v[k] : d);
  return {
    pelvis: {
      pos: [g("px"), g("py", 1) * b.legLen, g("pz")],
      tilt: g("tilt"),
      obliq: g("obliq"),
      yaw: g("yaw"),
      base: extra?.base,
    },
    lumbar: { flex: g("lumb"), abd: g("side") * 0.5, rot: g("rot") * 0.4 },
    thorax: { flex: g("thor"), abd: g("side") * 0.5, rot: g("rot") * 0.6 },
    neck: { flex: g("neck"), rot: -g("rot") * 0.3 },
    legs: [
      { hip: { flex: g("hipL"), abd: g("habL"), rot: g("hrL") }, knee: g("kneeL"), ankle: g("ankL") },
      { hip: { flex: g("hipR"), abd: g("habR"), rot: g("hrR") }, knee: g("kneeR"), ankle: g("ankR") },
    ],
    arms: extra?.arms ?? [
      { sh: { flex: g("shL"), abd: g("sabL", 8), rot: g("srL") }, elbow: g("elL", 10) },
      { sh: { flex: g("shR"), abd: g("sabR", 8), rot: g("srR") }, elbow: g("elR", 10) },
    ],
  };
}

/** 왼쪽 키프레임을 반 주기 이동해 오른쪽 생성 (달리기 등) */
export function mirrorHalf(keys: Key[], fields: [string, string][]): Key[] {
  // 각 필드의 오른쪽 값 = 왼쪽 값을 t+0.5 에서 샘플
  return keys.map((k) => {
    const nk: Key = { ...k };
    for (const [l, r] of fields) {
      const v = sampleKeys(keys.filter((x) => l in x), (k.t + 0.5) % 1, true)[l];
      nk[r] = v;
    }
    return nk;
  });
}

export const vadd = add;
export const vscale = scale;
