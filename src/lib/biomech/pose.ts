// 관절 각도/역기구학 사양 → 3D 관절 위치, 무게중심.
import type { Body } from "./anthropometry";
import { hipRotation, shoulderRotation, thighFront } from "./rom";
import {
  len,
  add,
  addScaled,
  angleBetween,
  apply,
  col,
  dot,
  ik2,
  lerpV,
  mul,
  norm,
  RAD,
  Rx,
  Ry,
  Rz,
  scale,
  sub,
  type Mat3,
  type Vec3,
} from "./math";

export interface JointRot {
  flex?: number;
  abd?: number;
  rot?: number;
}

export interface FootPlace {
  /** 발 중앙(뒤꿈치~발끝 중간) 위치 */
  x: number;
  z: number;
  /** 지면 높이 (박스·벤치 위) */
  y?: number;
  /** 발끝 바깥 회전 (도) */
  yaw?: number;
  /** 뒤꿈치 들림 (도, 발볼 기준) */
  heelRise?: number;
  /** 발끝 들림 (도, 뒤꿈치 기준) */
  toeRise?: number;
}

export type LegSpec =
  | { ik: FootPlace; valgus?: number }
  | { hip: JointRot; knee: number; ankle: number };

export type ArmSpec =
  | { ik: Vec3; pole?: Vec3 }
  /** 흉곽 좌표계(C7 기준) 목표점 — 등에 얹은 바 등 */
  | { ikLocal: Vec3; pole?: Vec3; poleLocal?: Vec3 }
  | { sh: JointRot; elbow: number };

export interface PoseSpec {
  pelvis: { pos: Vec3; tilt?: number; obliq?: number; yaw?: number; base?: Mat3 };
  lumbar?: JointRot;
  thorax?: JointRot;
  neck?: JointRot;
  legs: [LegSpec, LegSpec];
  arms: [ArmSpec, ArmSpec];
}

export type JointName =
  | "pelvis"
  | "l5"
  | "t12"
  | "c7"
  | "headTop"
  | "head"
  | "hipL"
  | "hipR"
  | "kneeL"
  | "kneeR"
  | "ankleL"
  | "ankleR"
  | "heelL"
  | "heelR"
  | "ballL"
  | "ballR"
  | "toeL"
  | "toeR"
  | "shL"
  | "shR"
  | "elL"
  | "elR"
  | "wrL"
  | "wrR"
  | "fingL"
  | "fingR"
  | "gripL"
  | "gripR";

export type Joints = Record<JointName, Vec3>;

export interface Pose {
  j: Joints;
  R: { pelvis: Mat3; lumbar: Mat3; thorax: Mat3; head: Mat3; footL: Mat3; footR: Mat3 };
  overreach: { legL: number; legR: number; armL: number; armR: number };
}

const SIDE = [1, -1] as const; // L = +X, R = -X

function jr(r?: JointRot) {
  return { flex: r?.flex ?? 0, abd: r?.abd ?? 0, rot: r?.rot ?? 0 };
}

/** 척추 분절 회전: 굴곡(+앞), 측굴(+왼쪽), 회전(+왼쪽) */
function spineRot(r?: JointRot): Mat3 {
  const { flex, abd, rot } = jr(r);
  return mul(mul(Rz(-abd), Rx(flex)), Ry(rot));
}

export function footFrame(side: 0 | 1, f: FootPlace): Mat3 {
  const s = SIDE[side];
  return mul(mul(Ry(s * (f.yaw ?? 0)), Rx(f.heelRise ?? 0)), Rx(-(f.toeRise ?? 0)));
}

export function buildPose(body: Body, spec: PoseSpec): Pose {
  const H = body.H;
  const p = spec.pelvis;
  const base = p.base ?? ([1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3);
  const Rp = mul(base, mul(mul(Ry(p.yaw ?? 0), Rz(p.obliq ?? 0)), Rx(p.tilt ?? 0)));
  const P = p.pos;
  const l5 = add(P, apply(Rp, body.l5));
  const Rl = mul(Rp, spineRot(spec.lumbar));
  const t12 = add(l5, scale(col(Rl, 1), body.lumbar));
  const Rt = mul(Rl, spineRot(spec.thorax));
  const c7 = add(t12, scale(col(Rt, 1), body.thorax));
  const Rh = mul(Rt, spineRot(spec.neck));
  const neckTop = add(c7, scale(col(Rh, 1), body.neck));
  const head = add(add(neckTop, scale(col(Rh, 1), body.skull * 0.5)), scale(col(Rh, 2), 0.012 * H));
  const headTop = add(neckTop, scale(col(Rh, 1), body.skull));

  const j = { pelvis: P, l5, t12, c7, head, headTop } as Joints;
  const R = { pelvis: Rp, lumbar: Rl, thorax: Rt, head: Rh } as Pose["R"];
  const over = { legL: 0, legR: 0, armL: 0, armR: 0 };

  // 다리
  for (const side of [0, 1] as const) {
    const s = SIDE[side];
    const k = side === 0 ? "L" : "R";
    const hip = add(P, apply(Rp, [(s * body.hipW) / 2, 0, 0]));
    const Lt = body.thigh[side],
      Ls = body.shank[side],
      ah = body.ankleH[side];
    const leg = spec.legs[side];
    const ft = body.foot;
    let knee: Vec3, ankle: Vec3, Rf: Mat3;
    if ("ik" in leg) {
      const f = leg.ik;
      const gy = f.y ?? 0;
      Rf = footFrame(side, f);
      const yawM = Ry(s * (f.yaw ?? 0));
      const midLocal: Vec3 = [0, -ah, (ft.toe - ft.heel) / 2];
      const mid: Vec3 = [f.x, gy, f.z];
      if ((f.toeRise ?? 0) > 0) {
        // 뒤꿈치 기준 회전
        const heelLocal: Vec3 = [0, -ah, -ft.heel];
        const heelW = add(mid, apply(yawM, sub(heelLocal, midLocal)));
        ankle = sub(heelW, apply(Rf, heelLocal));
      } else {
        const ballLocal: Vec3 = [0, -ah, ft.ball];
        const ballW = add(mid, apply(yawM, sub(ballLocal, midLocal)));
        ankle = sub(ballW, apply(Rf, ballLocal));
      }
      let footPole = apply(Ry(s * ((f.yaw ?? 0) - (leg.valgus ?? 0))), [0, 0, 1]);
      // 뒤꿈치가 크게 들린 발(런지 뒷발·벤치 위 발)은 무릎이 바닥 쪽을 향한다
      const hr = f.heelRise ?? 0;
      if (hr > 30) footPole = norm(add(footPole, [0, -Math.min(2, (hr - 30) / 25), 0]));
      // 무릎 방향: 발끝 방향(footPole)을 기본으로, 고관절 회전이 정상 범위(내회전 43°, 외회전 48°)를
      // 넘거나 무릎이 넙다리 앞쪽이 아닌 쪽으로 접히면(과신전) 넙다리 앞쪽 방향으로 되돌린다
      const tf = thighFront(Rp, norm(sub(ankle, hip)));
      const solve = (w: number) => ik2(hip, ankle, Lt, Ls, w > 0 ? norm(add(scale(footPole, 1 - w), scale(tf, w))) : footPole);
      const legOk = (x: ReturnType<typeof solve>) => {
        const hr = hipRotation(Rp, hip, x.mid, x.end, s);
        // 무릎이 엉덩이-발목 선보다 넙다리 앞쪽에 있어야 정상 굴곡
        const line = sub(x.end, hip);
        const u = dot(sub(x.mid, hip), line) / Math.max(1e-9, dot(line, line));
        const off = sub(x.mid, add(hip, scale(line, u)));
        const bendsRight = len(off) < 0.005 || dot(off, tf) > -0.002;
        return hr <= 43 && hr >= -48 && bendsRight;
      };
      let r = solve(0);
      if (!legOk(r)) {
        for (let w = 0.1; w <= 1.0001; w += 0.1) {
          const c = solve(w);
          r = c;
          if (legOk(c)) break;
        }
      }
      knee = r.mid;
      over[side === 0 ? "legL" : "legR"] = r.overreach;
      ankle = r.end;
    } else {
      const h = jr(leg.hip);
      const Rth = mul(Rp, mul(mul(Rz(s * h.abd), Rx(-h.flex)), Ry(-s * h.rot)));
      knee = add(hip, scale(col(Rth, 1), -Lt));
      const Rsh = mul(Rth, Rx(leg.knee));
      ankle = add(knee, scale(col(Rsh, 1), -Ls));
      Rf = mul(Rsh, Rx(-leg.ankle));
    }
    const heel = add(ankle, apply(Rf, [0, -ah, -ft.heel]));
    const ball = add(ankle, apply(Rf, [0, -ah, ft.ball]));
    let toe: Vec3;
    if ("ik" in leg && (leg.ik.heelRise ?? 0) > 0) {
      // 발가락은 지면에 남는다 (MTP 신전)
      const yawM = Ry(s * (leg.ik.yaw ?? 0));
      toe = add(ball, apply(yawM, [0, 0, ft.toe - ft.ball]));
    } else toe = add(ankle, apply(Rf, [0, -ah, ft.toe]));
    j[`hip${k}`] = hip;
    j[`knee${k}`] = knee;
    j[`ankle${k}`] = ankle;
    j[`heel${k}`] = heel;
    j[`ball${k}`] = ball;
    j[`toe${k}`] = toe;
    R[side === 0 ? "footL" : "footR"] = Rf;
  }

  // 팔
  for (const side of [0, 1] as const) {
    const s = SIDE[side];
    const k = side === 0 ? "L" : "R";
    const sh = add(c7, apply(Rt, [(s * body.shW) / 2, body.shoulderOff[0], body.shoulderOff[1]]));
    const arm = spec.arms[side];
    const Lu = body.upperArm,
      Lf = body.forearm,
      Lh = body.hand;
    let el: Vec3, wr: Vec3, fing: Vec3, grip: Vec3;
    if ("ik" in arm || "ikLocal" in arm) {
      const lg = Lf + Lh * 0.45;
      const target = "ik" in arm ? arm.ik : add(c7, apply(Rt, arm.ikLocal));
      const pl = "poleLocal" in arm && arm.poleLocal ? apply(Rt, [arm.poleLocal[0] * s, arm.poleLocal[1], arm.poleLocal[2]]) : undefined;
      const pole0 = pl ?? arm.pole ?? add(scale(col(Rt, 2), -1), scale(col(Rt, 0), s * 0.6));
      // 팔꿈치는 150° 이상 접히지 않는다 (위팔·아래팔 사이 30°)
      const minD = Math.sqrt(Lu * Lu + lg * lg - 2 * Lu * lg * Math.cos((30 * Math.PI) / 180));
      // 어깨 회전 정상 범위(외회전 108°, 내회전 78°)를 넘으면 팔꿈치가 뒤를 향하도록 되돌린다
      const solveA = (w: number) => {
        let pole = pole0;
        if (w > 0) {
          const r0 = ik2(sh, target, Lu, lg, pole0, minD);
          const back = scale(thighFront(Rt, norm(sub(r0.mid, sh))), -1);
          pole = norm(add(scale(norm(pole0), 1 - w), scale(back, w)));
        }
        return ik2(sh, target, Lu, lg, pole, minD);
      };
      const armOk = (x: ReturnType<typeof solveA>) => {
        const d = norm(sub(x.end, x.mid));
        const sr = shoulderRotation(Rt, sh, x.mid, add(x.mid, d), s);
        return sr <= 78 && sr >= -108;
      };
      let r = solveA(0);
      if (!armOk(r)) {
        let lo = 0,
          hi = 1;
        for (let it = 0; it < 9; it++) {
          const mid = (lo + hi) / 2;
          if (armOk(solveA(mid))) hi = mid;
          else lo = mid;
        }
        r = solveA(hi);
      }
      el = r.mid;
      grip = r.end;
      const d = norm(sub(grip, el));
      wr = addScaled(el, d, Lf);
      fing = addScaled(el, d, Lf + Lh);
      over[side === 0 ? "armL" : "armR"] = r.overreach;
    } else {
      const a = jr(arm.sh);
      const Ru = mul(Rt, mul(mul(Rz(s * a.abd), Rx(-a.flex)), Ry(-s * a.rot)));
      el = add(sh, scale(col(Ru, 1), -Lu));
      const Rf = mul(Ru, Rx(-arm.elbow));
      const d = scale(col(Rf, 1), -1);
      wr = addScaled(el, d, Lf);
      fing = addScaled(el, d, Lf + Lh);
      grip = addScaled(el, d, Lf + Lh * 0.45);
    }
    j[`sh${k}`] = sh;
    j[`el${k}`] = el;
    j[`wr${k}`] = wr;
    j[`fing${k}`] = fing;
    j[`grip${k}`] = grip;
  }
  return { j, R, overreach: over };
}

/** 신체 무게중심 (외부 부하 제외) */
export function bodyCom(body: Body, pose: Pose): Vec3 {
  const m = body.mass;
  const j = pose.j;
  const H = body.H;
  let sx = 0,
    sy = 0,
    sz = 0,
    sm = 0;
  const acc = (pt: Vec3, mass: number) => {
    sx += pt[0] * mass;
    sy += pt[1] * mass;
    sz += pt[2] * mass;
    sm += mass;
  };
  acc(j.head, m.head);
  acc(add(lerpV(j.t12, j.c7, 0.5), scale(col(pose.R.thorax, 2), 0.05 * H)), m.thorax);
  acc(add(lerpV(j.l5, j.t12, 0.5), scale(col(pose.R.lumbar, 2), 0.045 * H)), m.abdomen);
  acc(add(lerpV(j.pelvis, j.l5, 0.5), scale(col(pose.R.pelvis, 2), 0.02 * H)), m.pelvis);
  for (const k of ["L", "R"] as const) {
    acc(lerpV(j[`hip${k}`], j[`knee${k}`], 0.433), m.thigh);
    acc(lerpV(j[`knee${k}`], j[`ankle${k}`], 0.433), m.shank);
    acc(lerpV(j[`ankle${k}`], lerpV(j[`heel${k}`], j[`ball${k}`], 0.5), 0.5), m.foot);
    acc(lerpV(j[`sh${k}`], j[`el${k}`], 0.436), m.upperArm);
    acc(lerpV(j[`el${k}`], j[`wr${k}`], 0.43), m.forearm);
    acc(lerpV(j[`wr${k}`], j[`fing${k}`], 0.5), m.hand);
  }
  return [sx / sm, sy / sm, sz / sm];
}

export interface Angles {
  kneeFlex: [number, number];
  hipFlex: [number, number];
  hipAbd: [number, number];
  ankleDF: [number, number];
  shoulderFlex: [number, number];
  elbowFlex: [number, number];
  /** 몸통(고관절중심→C7) 수직 대비 전방 기울기 */
  trunkLean: number;
  /** 정강이 수직 대비 전방 기울기 */
  shinLean: [number, number];
  /** 무릎 전두면 투영각 (FPPA, + = 외반/안쪽 무너짐) */
  kneeFPPA: [number, number];
  pelvisTilt: number;
  pelvisObliq: number;
}

/** 관절 각도 측정 (분석·검증용) */
export function measureAngles(pose: Pose): Angles {
  const j = pose.j;
  const Rp = pose.R.pelvis;
  const px = col(Rp, 0),
    py = col(Rp, 1),
    pz = col(Rp, 2);
  const tx = col(pose.R.thorax, 0),
    ty = col(pose.R.thorax, 1),
    tz = col(pose.R.thorax, 2);
  const out = {
    kneeFlex: [0, 0],
    hipFlex: [0, 0],
    hipAbd: [0, 0],
    ankleDF: [0, 0],
    shoulderFlex: [0, 0],
    elbowFlex: [0, 0],
    shinLean: [0, 0],
    kneeFPPA: [0, 0],
  } as unknown as Angles;
  (["L", "R"] as const).forEach((k, i) => {
    const s = i === 0 ? 1 : -1;
    const thigh = sub(j[`knee${k}`], j[`hip${k}`]);
    const shank = sub(j[`ankle${k}`], j[`knee${k}`]);
    out.kneeFlex[i] = angleBetween(thigh, shank);
    out.hipFlex[i] = Math.atan2(dot(thigh, pz), -dot(thigh, py)) * RAD;
    out.hipAbd[i] = Math.atan2(s * dot(thigh, px), -dot(thigh, py)) * RAD;
    const Rf = i === 0 ? pose.R.footL : pose.R.footR;
    const up = scale(shank, -1);
    out.ankleDF[i] = Math.atan2(dot(up, col(Rf, 2)), dot(up, col(Rf, 1))) * RAD;
    out.shinLean[i] = Math.atan2(-shank[2], -shank[1]) * RAD;
    // FPPA: 엉덩이-무릎-발목의 전두면(X-Y) 투영 각
    const a: Vec3 = [thigh[0], thigh[1], 0];
    const b: Vec3 = [shank[0], shank[1], 0];
    const ang = angleBetween(a, b);
    const crossZ = a[0] * b[1] - a[1] * b[0];
    // 왼쪽 다리에서 무릎이 안쪽(-X)으로 꺾이면 외반
    out.kneeFPPA[i] = (Math.abs(thigh[1]) > 0.02 ? ang : 0) * (crossZ * s > 0 ? 1 : -1);
    const arm = sub(j[`el${k}`], j[`sh${k}`]);
    out.shoulderFlex[i] = Math.atan2(dot(arm, tz), -dot(arm, ty)) * RAD;
    void tx;
    out.elbowFlex[i] = angleBetween(arm, sub(j[`wr${k}`], j[`el${k}`]));
  });
  const shMid: Vec3 = [(j.shL[0] + j.shR[0]) / 2, (j.shL[1] + j.shR[1]) / 2, (j.shL[2] + j.shR[2]) / 2];
  const trunk = sub(shMid, j.pelvis);
  out.trunkLean = Math.atan2(trunk[2], trunk[1]) * RAD;
  out.pelvisTilt = Math.atan2(py[2], py[1]) * RAD;
  out.pelvisObliq = Math.asin(Math.max(-1, Math.min(1, px[1]))) * RAD;
  return out;
}
