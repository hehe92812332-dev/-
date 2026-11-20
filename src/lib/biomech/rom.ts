// 관절 가동범위(ROM) 측정 — 해부학적 정상 범위를 벗어나는 자세를 찾기 위한 부호 있는 관절각
// 기준: AAOS 정상 가동범위(체중 부하 발목 배측굴곡은 런지 검사 기준)를 바탕으로, 운동 중 허용되는 끝 범위를 조금 넓게 잡았다.
import { angleBetween, col, cross, dot, len, norm, RAD, scale, sub, type Mat3, type Vec3 } from "./math";
import type { Pose } from "./pose";

export interface RomLimit {
  key: string;
  label: string;
  min: number;
  max: number;
}

/** 정상 가동범위 (도). 음수 = 반대 방향 (신전·외전 반대 등) */
export const ROM: Record<string, RomLimit> = {
  hipFlex: { key: "hipFlex", label: "고관절 굴곡/신전", min: -30, max: 140 },
  hipAbd: { key: "hipAbd", label: "고관절 외전/내전", min: -30, max: 50 },
  hipRot: { key: "hipRot", label: "고관절 내회전/외회전", min: -50, max: 45 },
  knee: { key: "knee", label: "무릎 굴곡 (−는 과신전)", min: -5, max: 155 },
  ankle: { key: "ankle", label: "발목 배측/저측굴곡", min: -55, max: 55 },
  shFlex: { key: "shFlex", label: "어깨 굴곡/신전", min: -65, max: 190 },
  shRot: { key: "shRot", label: "어깨 내회전/외회전", min: -110, max: 80 },
  elbow: { key: "elbow", label: "팔꿈치 굴곡 (−는 과신전)", min: -8, max: 152 },
  spineFlex: { key: "spineFlex", label: "척추 굴곡/신전 (요추+흉추)", min: -45, max: 85 },
  spineSide: { key: "spineSide", label: "척추 측굴", min: -40, max: 40 },
  spineRot: { key: "spineRot", label: "척추 회전 (흉요추)", min: -60, max: 60 },
  neckFlex: { key: "neckFlex", label: "목 굴곡/신전", min: -60, max: 50 },
};

const rotT = (R: Mat3, v: Vec3): Vec3 => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

/** 상대 회전 R_a^T R_b 를 굴곡(X), 측굴(Z), 회전(Y) 으로 근사 분해 */
function segAngles(Ra: Mat3, Rb: Mat3) {
  const y = rotT(Ra, col(Rb, 1)); // 아래 분절 좌표에서 본 위 분절의 위쪽 축
  const z = rotT(Ra, col(Rb, 2));
  const flex = Math.atan2(y[2], y[1]) * RAD;
  const side = Math.atan2(-y[0], Math.hypot(y[1], y[2])) * RAD;
  const rot = Math.atan2(z[0], z[2]) * RAD;
  return { flex, side, rot };
}

/** 최소 회전으로 a 를 b 에 맞췄을 때 v 가 가는 곳 (스윙) */
function swing(a: Vec3, b: Vec3, v: Vec3): Vec3 {
  const ax = cross(a, b);
  const s = len(ax),
    c = dot(a, b);
  if (s < 1e-8) return c > 0 ? v : scale(v, -1);
  const k = scale(ax, 1 / s);
  const kv = cross(k, v);
  const kdv = dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kdv * (1 - c), v[1] * c + kv[1] * s + k[1] * kdv * (1 - c), v[2] * c + kv[2] * s + k[2] * kdv * (1 - c)];
}

/** u 축을 중심으로 a0 → a 의 부호 있는 각 */
function twist(u: Vec3, a0: Vec3, a: Vec3) {
  const p0 = norm(sub(a0, scale(u, dot(a0, u))));
  const p1 = norm(sub(a, scale(u, dot(a, u))));
  return Math.atan2(dot(cross(p0, p1), u), dot(p0, p1)) * RAD;
}

export type RomSample = Record<string, number>;

/** 한 자세의 부호 있는 관절각. 좌우는 키 뒤에 L/R */
export function measureRom(pose: Pose): RomSample {
  const j = pose.j;
  const out: RomSample = {};
  const Rp = pose.R.pelvis,
    Rt = pose.R.thorax,
    Rl = pose.R.lumbar,
    Rh = pose.R.head;
  for (const [k, sgn] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    const hip = j[`hip${k}`],
      knee = j[`knee${k}`],
      ank = j[`ankle${k}`];
    const th = norm(sub(knee, hip));
    const shk = norm(sub(ank, knee));
    const tl = rotT(Rp, th); // 골반 좌표
    out[`hipFlex${k}`] = Math.atan2(tl[2], -tl[1]) * RAD;
    out[`hipAbd${k}`] = Math.atan2(sgn * tl[0], Math.hypot(tl[1], tl[2])) * RAD;
    // 무릎: 굴곡 크기 + 방향(무릎이 접히는 쪽이 넙다리 기준 뒤쪽이어야 정상)
    const flexMag = angleBetween(th, shk);
    // 넙다리의 '앞' (골반 앞쪽을 넙다리로 스윙)
    const thFront = swing([0, -1, 0], tl, [0, 0, 1]);
    const thFrontW: Vec3 = [Rp[0] * thFront[0] + Rp[1] * thFront[1] + Rp[2] * thFront[2], Rp[3] * thFront[0] + Rp[4] * thFront[1] + Rp[5] * thFront[2], Rp[6] * thFront[0] + Rp[7] * thFront[1] + Rp[8] * thFront[2]];
    const back = -dot(sub(shk, scale(th, dot(shk, th))), thFrontW); // 정강이가 뒤로 접히면 +
    const kneeSigned = flexMag < 4 ? flexMag : back >= -0.02 ? flexMag : -flexMag;
    out[`knee${k}`] = kneeSigned;
    // 고관절 회전: 무릎이 접히는 면(정강이가 향하는 쪽의 반대 = 무릎 앞)이 넙다리 기준 앞에서 얼마나 돌았나
    if (flexMag > 20) {
      const kneeFront = scale(sub(shk, scale(th, dot(shk, th))), -1); // 무릎이 향하는 방향
      out[`hipRot${k}`] = sgn * twist(th, thFrontW, kneeFront); // + 내회전
    }
    const Rf = k === "L" ? pose.R.footL : pose.R.footR;
    const up = scale(shk, -1);
    out[`ankle${k}`] = Math.atan2(dot(up, col(Rf, 2)), dot(up, col(Rf, 1))) * RAD;
    // 어깨·팔꿈치
    const sh = j[`sh${k}`],
      el = j[`el${k}`],
      wr = j[`wr${k}`];
    const ua = norm(sub(el, sh));
    const fa = norm(sub(wr, el));
    const ul = rotT(Rt, ua);
    // 머리 위로 넘어간 팔(굴곡 180° 이상)은 −180° 근처로 감기지 않게 펼친다
    let shf = Math.atan2(ul[2], -ul[1]) * RAD;
    if (shf < -100 && ul[1] > -0.2) shf += 360;
    out[`shFlex${k}`] = shf;
    const eMag = angleBetween(ua, fa);
    // 위팔의 '앞'(흉곽 앞쪽을 위팔로 스윙). 팔꿈치는 앞쪽으로 접혀야 한다
    const uaFront = swing([0, -1, 0], ul, [0, 0, 1]);
    const uaFrontW: Vec3 = [Rt[0] * uaFront[0] + Rt[1] * uaFront[1] + Rt[2] * uaFront[2], Rt[3] * uaFront[0] + Rt[4] * uaFront[1] + Rt[5] * uaFront[2], Rt[6] * uaFront[0] + Rt[7] * uaFront[1] + Rt[8] * uaFront[2]];
    // 팔이 거의 수직 위(굴곡 150° 이상)면 회전 기준이 정의되지 않아 재지 않는다
    if (eMag > 20 && ul[1] < 0.75) {
      const fold = sub(fa, scale(ua, dot(fa, ua)));
      out[`shRot${k}`] = sgn * twist(ua, uaFrontW, fold); // + 내회전(아래팔이 몸 안쪽으로)
      out[`elbow${k}`] = eMag;
    } else out[`elbow${k}`] = eMag;
  }
  const lum = segAngles(Rp, Rl);
  const tho = segAngles(Rl, Rt);
  out.spineFlex = lum.flex + tho.flex;
  out.spineSide = lum.side + tho.side;
  out.spineRot = lum.rot + tho.rot;
  out.neckFlex = segAngles(Rt, Rh).flex;
  return out;
}

export interface RomViolation {
  key: string;
  side?: "L" | "R";
  label: string;
  value: number;
  limit: number;
}

export function romViolations(s: RomSample, tol = 0): RomViolation[] {
  const out: RomViolation[] = [];
  for (const [k, v] of Object.entries(s)) {
    const side = k.endsWith("L") ? "L" : k.endsWith("R") ? "R" : undefined;
    const base = side ? k.slice(0, -1) : k;
    const lim = ROM[base];
    if (!lim || !Number.isFinite(v)) continue;
    if (v > lim.max + tol) out.push({ key: base, side, label: lim.label, value: v, limit: lim.max });
    if (v < lim.min - tol) out.push({ key: base, side, label: lim.label, value: v, limit: lim.min });
  }
  return out;
}

/** 넙다리의 '앞' (골반 앞쪽을 넙다리 방향으로 최소 회전) — 월드 좌표 */
export function thighFront(Rp: Mat3, thighDir: Vec3): Vec3 {
  const tl = rotT(Rp, thighDir);
  const f = swing([0, -1, 0], tl, [0, 0, 1]);
  return [Rp[0] * f[0] + Rp[1] * f[1] + Rp[2] * f[2], Rp[3] * f[0] + Rp[4] * f[1] + Rp[5] * f[2], Rp[6] * f[0] + Rp[7] * f[1] + Rp[8] * f[2]];
}

/** 고관절 회전 (+ 내회전). sgn: 왼쪽 1, 오른쪽 −1 */
export function hipRotation(Rp: Mat3, hip: Vec3, knee: Vec3, ankle: Vec3, sgn: number) {
  const th = norm(sub(knee, hip));
  const shk = norm(sub(ankle, knee));
  if (angleBetween(th, shk) < 15) return 0;
  const kneeFront = scale(sub(shk, scale(th, dot(shk, th))), -1);
  return sgn * twist(th, thighFront(Rp, th), kneeFront);
}

/** 어깨 회전 (+ 내회전) */
export function shoulderRotation(Rt: Mat3, sh: Vec3, el: Vec3, wr: Vec3, sgn: number) {
  const ua = norm(sub(el, sh));
  const fa = norm(sub(wr, el));
  if (angleBetween(ua, fa) < 15) return 0;
  const fold = sub(fa, scale(ua, dot(fa, ua)));
  return sgn * twist(ua, thighFront(Rt, ua), fold);
}
