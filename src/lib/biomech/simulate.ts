// 시뮬레이션 파이프라인: 동작 프레임 생성 → 이동/체공 보정 → 무게중심·지면반력·하중 분포·관절 모멘트
import { buildBody, defaultCapacity, defaultMobility, sanitizeProfile, standardBody, type InputIssue, type Profile } from "./anthropometry";
import { G, systemCom } from "./kit";
import { add, apply, clamp, col, dot, isFiniteV, lerpV, sub, type Vec3 } from "./math";
import { bodyCom, measureAngles, type Pose } from "./pose";
import type { Contact, ContactLoad, Ctx, Metric, Movement, MoveFrame, SimFrame } from "./types";
import { MOVEMENTS } from "./moves";
import { analyze, type Finding } from "./analysis";

export interface SimOptions {
  loadKg?: number;
  frames?: number;
  /** 표준 체형 비교 계산 */
  reference?: boolean;
}

export interface SimResult {
  movement: Movement;
  profile: Profile;
  issues: InputIssue[];
  loadKg: number;
  frames: SimFrame[];
  duration: number;
  metrics: Metric[];
  findings: Finding[];
  ref?: { frames: SimFrame[]; metrics: Metric[] };
  /** 계산 경고 (수치 문제 등) */
  solverWarnings: string[];
}

export function getMovement(id: string): Movement | undefined {
  return MOVEMENTS.find((m) => m.id === id);
}

export function resolveLoad(m: Movement, loadKg?: number) {
  if (!m.load) return 0;
  const v = typeof loadKg === "number" && Number.isFinite(loadKg) ? loadKg : m.load.default;
  return clamp(v, m.load.min, m.load.max);
}

function timeAt(knots: [number, number][], t: number) {
  if (t <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    if (t <= knots[i][0]) {
      const [t0, s0] = knots[i - 1];
      const [t1, s1] = knots[i];
      return s0 + ((s1 - s0) * (t - t0)) / Math.max(1e-9, t1 - t0);
    }
  }
  return knots[knots.length - 1][1];
}

function translatePose(p: Pose, dv: Vec3): Pose {
  const j = { ...p.j };
  for (const k in j) j[k as keyof typeof j] = add(j[k as keyof typeof j], dv);
  return { ...p, j };
}

function translateFrame(f: MoveFrame, dv: Vec3): MoveFrame {
  if (dv[0] === 0 && dv[1] === 0 && dv[2] === 0) return f;
  return {
    ...f,
    pose: translatePose(f.pose, dv),
    load: f.load && f.load.carried ? { ...f.load, center: add(f.load.center, dv) } : f.load,
    contacts: f.contacts.map((c) => ({ ...c, pts: c.pts.map((p) => add(p, dv)), axis: c.axis ? [add(c.axis[0], dv), add(c.axis[1], dv)] : undefined })),
  };
}

function lowestFootY(f: MoveFrame) {
  const j = f.pose.j;
  let m = Infinity;
  for (const k of f.contactFeet ?? []) m = Math.min(m, j[`heel${k}`][1], j[`ball${k}`][1], j[`toe${k}`][1]);
  return m;
}

function anchorOf(f: MoveFrame): Vec3 {
  const j = f.pose.j;
  const ks = f.contactFeet ?? [];
  let x = 0,
    z = 0;
  for (const k of ks) {
    x += j[`ball${k}`][0];
    z += j[`ball${k}`][2];
  }
  return [x / Math.max(1, ks.length), 0, z / Math.max(1, ks.length)];
}

/** 동적 동작: 접지 발 높이 맞춤, 발 미끄럼 고정, 체공 구간 탄도 궤적 */
function applyDynamics(m: Movement, raw: MoveFrame[], times: number[], ctx: Ctx): MoveFrame[] {
  const dyn = m.dynamics!;
  const n = raw.length;
  const contact = raw.map((f) => (f.contactFeet?.length ?? 0) > 0);
  const corr: (Vec3 | null)[] = new Array(n).fill(null);
  let prev: Vec3 = [0, 0, 0];
  let anchor: Vec3 | null = null;
  let prevSet = "";
  for (let i = 0; i < n; i++) {
    const f = raw[i];
    if (!contact[i]) {
      prevSet = "";
      anchor = null;
      continue;
    }
    const gy = f.groundY ?? 0;
    const dy = gy - lowestFootY(f);
    let dx = 0,
      dz = 0;
    if (dyn.lockFeet) {
      const set = (f.contactFeet ?? []).join("");
      const a = anchorOf(f);
      if (set !== prevSet || !anchor) {
        anchor = [a[0] + prev[0], 0, a[2] + prev[2]];
        // 새 접지: 이전 보정을 이어받는다 (체공 직후면 착지 위치 그대로)
        if (prevSet === "") anchor = [a[0] + (corr[i - 1] ? prev[0] : 0), 0, a[2] + (corr[i - 1] ? prev[2] : 0)];
      }
      dx = anchor[0] - a[0];
      dz = anchor[2] - a[2];
      prevSet = set;
    }
    corr[i] = [dx, dy, dz];
    prev = corr[i]!;
  }
  if (corr.every((c) => c === null)) return raw;
  // 체공/비접지 구간 채우기
  const out = raw.slice();
  const comRaw = raw.map((f) => systemCom(ctx.body, f.pose, f.load));
  const idx = [...Array(n).keys()];
  const contactIdx = idx.filter((i) => corr[i]);
  const total = times[n - 1] + (dyn.cyclic ? times[1] - times[0] : 0);
  for (let i = 0; i < n; i++) {
    if (corr[i]) continue;
    // 앞뒤 접지 프레임
    let a = -1,
      b = -1;
    for (let k = i - 1; k >= 0; k--) if (corr[k]) { a = k; break; }
    for (let k = i + 1; k < n; k++) if (corr[k]) { b = k; break; }
    let ta = 0,
      tb = 0;
    if (dyn.cyclic) {
      if (a < 0) { a = contactIdx[contactIdx.length - 1]; ta = times[a] - total; } else ta = times[a];
      if (b < 0) { b = contactIdx[0]; tb = times[b] + total; } else tb = times[b];
    } else {
      if (a < 0 && b < 0) continue;
      if (a < 0) { corr[i] = corr[b]; continue; }
      if (b < 0) { corr[i] = corr[a]; continue; }
      ta = times[a];
      tb = times[b];
    }
    const ca = corr[a]!,
      cb = corr[b]!;
    const ti = times[i];
    const s = (ti - ta) / Math.max(1e-6, tb - ta);
    if (dyn.ballistic) {
      const pa = add(comRaw[a], ca),
        pb = add(comRaw[b], cb);
      const want: Vec3 = [
        pa[0] + (pb[0] - pa[0]) * s,
        pa[1] + (pb[1] - pa[1]) * s + 0.5 * G * (ti - ta) * (tb - ti),
        pa[2] + (pb[2] - pa[2]) * s,
      ];
      corr[i] = sub(want, comRaw[i]);
    } else corr[i] = lerpV(ca, cb, s);
  }
  for (let i = 0; i < n; i++) {
    const c = corr[i] ?? [0, 0, 0];
    let f = translateFrame(raw[i], c);
    // 지면 관통 방지
    const j = f.pose.j;
    const low = Math.min(j.heelL[1], j.heelR[1], j.toeL[1], j.toeR[1], j.ballL[1], j.ballR[1]);
    const gy = raw[i].groundY ?? 0;
    if (!contact[i] && low < gy - 0.002 && gy === 0) f = translateFrame(f, [0, gy - low, 0]);
    if (!contact[i]) f = { ...f, contacts: [] };
    out[i] = f;
  }
  return out;
}

function hull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** 볼록 다각형 내부 여부와 경계까지 거리(+ 안, - 밖) */
export function supportMargin(poly: [number, number][], p: [number, number]) {
  if (poly.length < 3) return { inside: false, margin: -1 };
  let inside = true;
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0],
      ez = b[1] - a[1];
    const L = Math.hypot(ex, ez) || 1e-9;
    const side = (ex * (p[1] - a[1]) - ez * (p[0] - a[0])) / L; // CCW 다각형에서 + = 안쪽
    if (side < 0) inside = false;
    // 선분까지 거리
    const tt = clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (L * L), 0, 1);
    const d = Math.hypot(p[0] - (a[0] + ex * tt), p[1] - (a[1] + ez * tt));
    minD = Math.min(minD, d);
  }
  return { inside, margin: inside ? minD : -minD };
}

const centroid = (c: Contact): Vec3 => {
  const s = c.pts.reduce((a, p) => add(a, p), [0, 0, 0] as Vec3);
  return [s[0] / c.pts.length, s[1] / c.pts.length, s[2] / c.pts.length];
};

function lever(a: Vec3, b: Vec3, p: Vec3) {
  // p 를 a-b 선분에 투영 → a 의 몫
  const ab: Vec3 = [b[0] - a[0], 0, b[2] - a[2]];
  const L2 = ab[0] * ab[0] + ab[2] * ab[2];
  if (L2 < 1e-8) return 0.5;
  const s = ((p[0] - a[0]) * ab[0] + (p[2] - a[2]) * ab[2]) / L2;
  return clamp(1 - s, 0, 1);
}

function distribute(contacts: Contact[], com: Vec3, grf: number): ContactLoad[] {
  const ground = contacts.filter((c) => c.group !== "body");
  if (contacts.some((c) => c.group === "body") || ground.length === 0) return [];
  const shares = new Map<Contact, number>();
  const groups = [...new Set(ground.map((c) => c.group))];
  const splitPair = (cs: Contact[], total: number) => {
    if (cs.length === 1) shares.set(cs[0], total);
    else if (cs.length >= 2) {
      const s = lever(centroid(cs[0]), centroid(cs[1]), com);
      shares.set(cs[0], total * s);
      shares.set(cs[1], total * (1 - s));
      for (const c of cs.slice(2)) shares.set(c, 0);
    }
  };
  if (groups.length === 1) splitPair(ground, 1);
  else {
    const gA = ground.filter((c) => c.group === groups[0]);
    const gB = ground.filter((c) => c.group === groups[1]);
    const cen = (cs: Contact[]) => cs.map(centroid).reduce((a, p) => add(a, [p[0] / cs.length, p[1] / cs.length, p[2] / cs.length]), [0, 0, 0] as Vec3);
    const sA = lever(cen(gA), cen(gB), com);
    splitPair(gA, sA);
    splitPair(gB, 1 - sA);
  }
  return ground.map((c) => {
    const share = shares.get(c) ?? 0;
    let fore = 0.5;
    let cop = centroid(c);
    if (c.axis) {
      const [h, t] = c.axis;
      const v: Vec3 = [t[0] - h[0], 0, t[2] - h[2]];
      const L2 = v[0] * v[0] + v[2] * v[2];
      if (L2 > 1e-8) {
        fore = clamp(((com[0] - h[0]) * v[0] + (com[2] - h[2]) * v[2]) / L2, 0, 1);
        cop = lerpV(h, t, fore);
      }
    }
    return { id: c.id, share, kg: (share * grf) / G, fore, cop };
  });
}

function kneeMedial(pose: Pose, stance: ("L" | "R")[] | undefined): [number, number] {
  const j = pose.j;
  return (["L", "R"] as const).map((k, i) => {
    if (stance && !stance.includes(k)) return 0;
    const s = i === 0 ? 1 : -1;
    // 엉덩이-발목 선과 발끝 방향이 이루는 평면에서 무릎이 안쪽으로 벗어난 거리
    const hip = j[`hip${k}`],
      knee = j[`knee${k}`],
      ank = j[`ankle${k}`];
    const f = col(i === 0 ? pose.R.footL : pose.R.footR, 2);
    const a = sub(ank, hip);
    const nx = a[1] * f[2] - a[2] * f[1],
      ny = a[2] * f[0] - a[0] * f[2],
      nz = a[0] * f[1] - a[1] * f[0];
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 0.05 * Math.hypot(a[0], a[1], a[2])) return 0;
    const kh = sub(knee, hip);
    return (s * (kh[0] * nx + kh[1] * ny + kh[2] * nz)) / nl;
  }) as [number, number];
}

/** 접지면에서 2cm 이상 뜬 접촉점은 제외 */
function liveContacts(cs: Contact[]): Contact[] {
  const feet = cs.filter((c) => c.group !== "body" && c.pts.length);
  if (feet.length < 2) return cs;
  const lows = feet.map((c) => Math.min(...c.pts.map((p) => p[1])));
  const base = Math.min(...lows);
  return cs.filter((c) => c.group === "body" || !c.pts.length || Math.min(...c.pts.map((p) => p[1])) - base < 0.02 || c.group === "hands");
}

/** 시간축 가우시안 평활 (프레임 단위 σ) */
function smoothArr(a: number[], sigma: number, cyclic: boolean, mask?: boolean[]) {
  const n = a.length;
  const r = Math.ceil(sigma * 2.5);
  const out = a.slice();
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    let sw = 0,
      sv = 0;
    for (let k = -r; k <= r; k++) {
      let jx = i + k;
      if (cyclic) jx = ((jx % n) + n) % n;
      else if (jx < 0 || jx >= n) continue;
      if (mask && !mask[jx]) continue;
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      sw += w;
      sv += a[jx] * w;
    }
    out[i] = sv / sw;
  }
  return out;
}

/**
 * 동적 동작의 수직 가속도: 키프레임 운동학 가속도(평활) + 접지 경계의 속도 불일치를
 * 착지/이륙 충격량 혹(half-sine)으로 분배 → 체공 탄도와 운동량이 맞는 지면반력
 */
function dynamicAccel(m: Movement, coms: Vec3[], times: number[], contact: boolean[], duration: number, control: number) {
  const n = coms.length;
  const cyclic = !!m.dynamics?.cyclic;
  const y = coms.map((c) => c[1]);
  const T = (i: number, wrap = 0) => times[i] + wrap * duration;
  const kin = y.map((_, i) => {
    const i0 = i - 1,
      i1 = i + 1;
    if (!cyclic && (i0 < 0 || i1 >= n)) return 0;
    const a0 = (i0 + n) % n,
      a1 = i1 % n;
    if (!contact[a0] || !contact[a1]) return 0;
    const t0 = T(a0, i0 < 0 ? -1 : 0),
      t1 = T(a1, i1 >= n ? 1 : 0),
      ti = times[i];
    const v0 = (y[i] - y[a0]) / Math.max(1e-6, ti - t0);
    const v1 = (y[a1] - y[i]) / Math.max(1e-6, t1 - ti);
    return (2 * (v1 - v0)) / Math.max(1e-6, t1 - t0);
  });
  const acc = smoothArr(kin, 1.4, cyclic, contact);
  if (contact.every((c) => c) || contact.every((c) => !c)) return acc;
  // 접지 구간 찾기
  const segs: [number, number][] = [];
  const start = cyclic ? contact.findIndex((c, i) => c && !contact[(i - 1 + n) % n]) : 0;
  for (let k = 0, i = start; k < n; ) {
    if (!contact[i]) {
      i = (i + 1) % n;
      k++;
      if (!cyclic && i === 0) break;
      continue;
    }
    const s0 = i;
    let len = 0;
    while (contact[i] && len < n) {
      len++;
      k++;
      const nx = i + 1;
      if (!cyclic && nx >= n) {
        i = nx;
        break;
      }
      i = nx % n;
    }
    segs.push([s0, len]);
    if (!cyclic && i >= n) break;
  }
  const g = 9.81;
  const tAt = (i: number) => times[((i % n) + n) % n] + Math.floor(i / n) * duration;
  for (const [s0, len] of segs) {
    const e0 = s0 + len - 1;
    const prev = s0 - 1,
      next = e0 + 1;
    const hasPrev = cyclic || prev >= 0;
    const hasNext = cyclic || next < n;
    const landing = hasPrev && !contact[((prev % n) + n) % n];
    const takeoff = hasNext && !contact[next % n];
    const yAt = (i: number) => y[((i % n) + n) % n];
    // 앞 체공: 이전 접지 끝 a → s0
    let vIn = 0,
      vOut = 0;
    if (landing) {
      let a = prev;
      while (!contact[((a % n) + n) % n] && a > s0 - n) a--;
      const Tf = tAt(s0) - tAt(a);
      vIn = (yAt(s0) - yAt(a)) / Tf - (g * Tf) / 2;
    }
    if (takeoff) {
      let bIdx = next;
      while (!contact[bIdx % n] && bIdx < e0 + n) bIdx++;
      if (!cyclic && bIdx >= n) bIdx = -1;
      if (bIdx >= 0) {
        const Tf = tAt(bIdx) - tAt(e0);
        vOut = (yAt(bIdx) - yAt(e0)) / Tf + (g * Tf) / 2;
      } else vOut = 0;
    }
    const dtS = len > 1 ? tAt(s0 + 1) - tAt(s0) : 0.02;
    const vkStart = len > 1 ? (yAt(s0 + 1) - yAt(s0)) / dtS : 0;
    const vkEnd = len > 1 ? (yAt(e0) - yAt(e0 - 1)) / Math.max(1e-6, tAt(e0) - tAt(e0 - 1)) : 0;
    const segDur = Math.max(dtS, tAt(e0) - tAt(s0) + dtS);
    const hump = (t0: number, tau: number, area: number) => {
      for (let i = s0; i <= e0; i++) {
        const tt = tAt(i) - t0;
        if (tt < 0 || tt > tau) continue;
        acc[((i % n) + n) % n] += area * (Math.PI / (2 * tau)) * Math.sin((Math.PI * tt) / tau);
      }
    };
    const t0 = tAt(s0) - dtS / 2;
    if (landing && takeoff && segDur < 0.3) {
      // 짧은 접지(달리기·바운딩): 스프링-질량 모델처럼 한 번의 혹으로
      for (let i = s0; i <= e0; i++) acc[((i % n) + n) % n] = 0;
      hump(t0, segDur, vOut - vIn);
    }
    else {
      if (landing) hump(t0, Math.min(segDur * 0.7, 0.05 + (0.09 * control) / 100), vkStart - vIn);
      if (takeoff) {
        const tau = Math.min(segDur * 0.6, 0.22);
        hump(tAt(e0) + dtS / 2 - tau, tau, vOut - vkEnd);
      }
    }
  }
  return acc;
}

export function makeCtx(profile: Profile, loadKg: number, isRef = false): Ctx {
  return { body: buildBody(profile), profile, loadKg, isRef, cache: {} };
}

export function runFrames(m: Movement, ctx: Ctx, N: number): { frames: SimFrame[]; duration: number; warnings: string[] } {
  const warnings: string[] = [];
  const knots = m.timeline(ctx);
  const duration = knots[knots.length - 1][1];
  const cyclic = !!m.dynamics?.cyclic;
  const ts = [...Array(N).keys()].map((i) => (cyclic ? i / N : i / (N - 1)));
  const times = ts.map((t) => timeAt(knots, t));
  let raw = ts.map((t) => m.frame(ctx, t));
  if (m.dynamics) raw = applyDynamics(m, raw, times, ctx);
  const b = ctx.body;
  const coms = raw.map((f) => systemCom(b, f.pose, f.load));
  const massTot = (f: MoveFrame) => b.M + (f.load && f.load.carried ? f.load.mass : 0);
  if (m.kind === "dynamic") raw = raw.map((f) => ({ ...f, contacts: liveContacts(f.contacts) }));
  const contactArr = raw.map((f) => f.contacts.length > 0);
  const accY = m.kind === "static" ? coms.map(() => 0) : dynamicAccel(m, coms, times, contactArr, duration, b.capacity.control);
  const frames: SimFrame[] = raw.map((f, i) => {
    const com = coms[i];
    const onGround = f.contacts.length > 0;
    const grf = onGround ? Math.max(0, massTot(f) * (G + accY[i])) : 0;
    const loads = distribute(f.contacts, com, grf);
    const angles = measureAngles(f.pose);
    const j = f.pose.j;
    // 관절 모멘트 (지면반력 벡터법, 시상면)
    let ankle = 0,
      knee = 0,
      hip = 0;
    const fwd = col(f.pose.R.pelvis, 2);
    const F: Vec3 = [fwd[0], 0, fwd[2]];
    const FL = Math.hypot(F[0], F[2]) || 1;
    const fz = (p: Vec3) => (p[0] * F[0] + p[2] * F[2]) / FL;
    if (m.support === "feet") {
      for (const l of loads) {
        if (l.id !== "L" && l.id !== "R") continue;
        const N2 = l.kg * G;
        ankle = Math.max(ankle, N2 * (fz(l.cop) - fz(j[`ankle${l.id}`])));
        knee = Math.max(knee, N2 * (fz(j[`knee${l.id}`]) - fz(l.cop)));
        hip = Math.max(hip, N2 * (fz(l.cop) - fz(j[`hip${l.id}`])));
      }
    }
    let lumbar = 0;
    if (m.support === "feet") {
      const mm = b.mass;
      const pts: [Vec3, number][] = [
        [j.head, mm.head],
        [lerpV(j.t12, j.c7, 0.5), mm.thorax],
        [lerpV(j.l5, j.t12, 0.5), mm.abdomen * 0.5],
        [lerpV(j.shL, j.wrL, 0.4), mm.upperArm + mm.forearm + mm.hand],
        [lerpV(j.shR, j.wrR, 0.4), mm.upperArm + mm.forearm + mm.hand],
      ];
      if (f.load && f.load.carried) pts.push([f.load.center, f.load.mass]);
      let sm = 0,
        sz = 0;
      for (const [p, w] of pts) {
        sm += w;
        sz += fz(p) * w;
      }
      const dyn = m.kind === "dynamic" && onGround ? grf / (massTot(f) * G) : 1;
      lumbar = sm * G * dyn * (sz / sm - fz(j.l5));
    }
    let shoulder = 0;
    if (f.load && f.load.carried && !f.load.onBody) {
      for (const k of ["L", "R"] as const) {
        const sh = j[`sh${k}`],
          gp = j[`grip${k}`];
        const h = Math.hypot(gp[0] - sh[0], gp[2] - sh[2]);
        shoulder = Math.max(shoulder, ((f.load.mass * G) / 2) * h);
      }
    }
    let supp = { inside: true, margin: 0.1 };
    if (m.support === "feet" && onGround) {
      const poly = hull(f.contacts.flatMap((c) => c.pts.map((p) => [p[0], p[2]] as [number, number])));
      supp = supportMargin(poly, [com[0], com[2]]);
    }
    return {
      ...f,
      t: ts[i],
      time: times[i],
      com,
      bodyCom: bodyCom(b, f.pose),
      grf,
      loads,
      angles,
      moments: { ankle, knee, hip, lumbar, shoulder },
      support: supp,
      kneeMedial: kneeMedial(f.pose, f.contactFeet ?? (f.contacts.some((c) => c.group === "feet") ? (f.contacts.filter((c) => c.group === "feet").map((c) => c.id) as ("L" | "R")[]) : [])),
    };
  });
  for (const f of frames) {
    for (const k in f.pose.j) {
      if (!isFiniteV(f.pose.j[k as keyof typeof f.pose.j])) {
        warnings.push(`${m.id}: t=${f.t.toFixed(2)} 관절 ${k} 계산 실패`);
        break;
      }
    }
  }
  void apply;
  return { frames, duration, warnings };
}

export function referenceProfile(p: Profile): Profile {
  return {
    body: standardBody(p.body.heightCm, p.body.sex, p.body.weightKg),
    mobility: defaultMobility(),
    capacity: defaultCapacity(),
  };
}

export function simulate(input: Partial<Profile> | undefined, moveId: string, opts: SimOptions = {}): SimResult {
  const { profile, issues } = sanitizeProfile(input);
  const m = getMovement(moveId) ?? MOVEMENTS[0];
  const loadKg = resolveLoad(m, opts.loadKg);
  const N = clamp(Math.round(opts.frames ?? 72), 8, 240);
  const ctx = makeCtx(profile, loadKg);
  const { frames, duration, warnings } = runFrames(m, ctx, N);
  const metrics = m.metrics ? m.metrics(ctx, frames) : [];
  let ref: SimResult["ref"];
  if (opts.reference !== false) {
    const rctx = makeCtx(referenceProfile(profile), loadKg, true);
    const r = runFrames(m, rctx, N);
    const rm = m.metrics ? m.metrics(rctx, r.frames) : [];
    for (const mt of metrics) {
      const x = rm.find((q) => q.id === mt.id);
      if (x) mt.ref = x.value;
    }
    ref = { frames: r.frames, metrics: rm };
  }
  const findings = analyze(m, profile, ctx, frames, ref?.frames, issues);
  return { movement: m, profile, issues, loadKg, frames, duration, metrics, findings, ref, solverWarnings: warnings };
}
