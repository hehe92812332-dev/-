// 웨이트 트레이닝 동작
import {
  anklePos,
  barbell,
  barLocal,
  feetContacts,
  frame,
  hipFeet,
  maxPelvisY,
  pelvisPoint,
  relIntensity,
  repPhase,
  solveHinge,
  solveSquat,
  squatArms,
  standSpec,
  stdStanding,
  systemCom,
  thoraxPoint,
  valgusFor,
  legDiffComp,
  asymShift,
  type SquatCfg,
  type HingeCfg,
} from "../kit";
import { add, clamp, DEG, lerp, lerpV, Rx, smooth, solveMonotone, sub, type Vec3 } from "../math";
import { buildPose, measureAngles, type ArmSpec, type FootPlace, type Pose, type PoseSpec } from "../pose";
import type { Contact, Ctx, LoadState, Metric, Movement, MoveFrame, SimFrame } from "../types";

const fixed = (sec: number) => () => [
  [0, 0],
  [1, sec],
] as [number, number][];

function labels(phase: string, up: boolean) {
  if (!up) return phase;
  return phase === "내려가기" ? "들어 올리기" : phase === "올라오기" ? "내리기" : phase === "바닥 지점" ? "최고 지점" : phase;
}

const maxOf = (frames: SimFrame[], f: (x: SimFrame) => number) => frames.reduce((m, x) => Math.max(m, f(x)), -Infinity);
const minOf = (frames: SimFrame[], f: (x: SimFrame) => number) => frames.reduce((m, x) => Math.min(m, f(x)), Infinity);

function squatMetrics(_ctx: Ctx, frames: SimFrame[]): Metric[] {
  const bottom = frames.reduce((a, b) => (b.pose.j.pelvis[1] < a.pose.j.pelvis[1] ? b : a));
  const thigh = (f: SimFrame) => {
    const j = f.pose.j;
    const v = sub(j.kneeL, j.hipL);
    return Math.atan2(-v[1], Math.hypot(v[0], v[2])) / DEG; // + = 고관절이 무릎보다 위
  };
  return [
    { id: "trunk", label: "바닥에서 몸통 숙임", value: bottom.angles.trunkLean, unit: "°", better: "low" },
    { id: "knee", label: "최대 무릎 굴곡", value: maxOf(frames, (f) => Math.max(...f.angles.kneeFlex)), unit: "°" },
    { id: "hip", label: "최대 고관절 굴곡", value: maxOf(frames, (f) => Math.max(...f.angles.hipFlex)), unit: "°" },
    { id: "df", label: "최대 발목 배측굴곡", value: maxOf(frames, (f) => Math.max(...f.angles.ankleDF)), unit: "°" },
    { id: "thigh", label: "바닥 대퇴 각 (수평=0, -는 평행 아래)", value: -thigh(bottom), unit: "°", better: "low" },
    { id: "kneeM", label: "무릎 신전 모멘트(최대)", value: maxOf(frames, (f) => f.moments.knee), unit: "N·m" },
    { id: "hipM", label: "고관절 신전 모멘트(최대)", value: maxOf(frames, (f) => f.moments.hip), unit: "N·m" },
  ];
}

function squatMove(
  id: string,
  name: string,
  en: string,
  cfg: SquatCfg,
  load: Movement["load"],
  summary: string,
  cues: string[],
): Movement {
  return {
    id,
    name,
    en,
    category: "gym",
    group: "하체 · 스쿼트",
    summary,
    cues,
    load: load ? { ...load, rmPerBw: cfg.rmPerBw } : null,
    kind: "static",
    support: "feet",
    timeline: fixed(3.4),
    frame: (ctx, t) => {
      const { d, phase } = repPhase(t);
      const s = solveSquat(ctx, cfg, d);
      return frame(ctx, s.spec, s.pose, { phase, meta: s.meta, load: s.load });
    },
    metrics: squatMetrics,
  };
}

function hingeMove(id: string, name: string, en: string, cfg: HingeCfg, load: Movement["load"], summary: string, cues: string[]): Movement {
  return {
    id,
    name,
    en,
    category: "gym",
    group: "하체 · 힙힌지",
    summary,
    cues,
    load: load ? { ...load, rmPerBw: cfg.rmPerBw } : null,
    kind: "static",
    support: "feet",
    timeline: fixed(3.6),
    frame: (ctx, t) => {
      const rp = repPhase(t, 0.4, 0.1, 0.06);
      // 데드리프트: 바닥에서 시작해 들어 올림 / RDL: 서서 시작해 내림
      const d = cfg.variant === "rdl" ? 1 - rp.d : rp.d;
      const s = solveHinge(ctx, cfg, d);
      const phase = cfg.variant === "rdl" ? rp.phase : labels(rp.phase, true);
      return frame(ctx, s.spec, s.pose, { phase, meta: s.meta, load: s.load });
    },
    metrics: (ctx, frames) => {
      const start = cfg.variant === "rdl" ? frames.reduce((a, b) => (b.load!.center[1] < a.load!.center[1] ? b : a)) : frames[0];
      return [
        { id: "trunk", label: cfg.variant === "rdl" ? "최저점 몸통 숙임" : "시작 자세 몸통 숙임", value: start.angles.trunkLean, unit: "°" },
        { id: "hipH", label: "시작 고관절 높이", value: start.pose.j.pelvis[1] * 100, unit: "cm" },
        { id: "barLow", label: "바 최저 높이", value: minOf(frames, (f) => f.load?.center[1] ?? 0) * 100, unit: "cm" },
        { id: "rom", label: "바 이동 거리", value: (maxOf(frames, (f) => f.load?.center[1] ?? 0) - minOf(frames, (f) => f.load?.center[1] ?? 0)) * 100, unit: "cm" },
        { id: "work", label: "1회 수직 일량", value: ctx.loadKg * 9.81 * (maxOf(frames, (f) => f.load?.center[1] ?? 0) - minOf(frames, (f) => f.load?.center[1] ?? 0)), unit: "J" },
        { id: "lumbarM", label: "요추 신전 모멘트(최대)", value: maxOf(frames, (f) => f.moments.lumbar), unit: "N·m", better: "low" },
      ];
    },
  };
}

/* ───────────── 굿모닝 ───────────── */

const goodMorning: Movement = {
  id: "good-morning",
  name: "굿모닝",
  en: "Good Morning",
  category: "gym",
  group: "하체 · 힙힌지",
  summary: "바를 등에 얹고 무릎을 살짝 굽힌 채 엉덩이를 뒤로 빼며 상체를 숙입니다. 햄스트링 유연성이 숙일 수 있는 깊이를 정합니다.",
  cues: ["무릎은 15° 정도만", "엉덩이를 뒤로 밀며 척추 중립", "햄스트링이 당기면 거기까지"],
  load: { kind: "barbell", default: 40, min: 20, max: 140, step: 2.5, label: "바벨", rmPerBw: 1.0 },
  kind: "static",
  support: "feet",
  timeline: fixed(3.4),
  frame: (ctx, t) => {
    const { d, phase } = repPhase(t);
    const b = ctx.body;
    const H = b.H;
    const feet = hipFeet(b, 8, 1.2);
    const ld = legDiffComp(b, d);
    const shiftX = ld.shiftX + asymShift(b, d);
    const knee = 16 * smooth(d);
    const hamAllow = b.mobility.hamstring + 0.7 * knee + 8;
    const want = 82 * smooth(d);
    const lim = Math.min(hamAllow - 6, b.mobility.hipFlex);
    let theta = want,
      lumbarX = 0,
      hamLimit = 0;
    if (want > lim) {
      if (b.capacity.control >= 50) {
        hamLimit = want - lim;
        theta = lim;
      } else {
        theta = Math.min(want, lim + 20);
        lumbarX = Math.max(0, want - lim);
        theta = want;
      }
    }
    const bl = barLocal(b, "high");
    const top = maxPelvisY(b, { Px: shiftX, Pz: 0, feet });
    const Pyt = top - (b.thigh[0] + b.shank[0]) * (1 - Math.cos((knee * DEG) / 2)) * 0.9;
    const build = (Pz: number) => {
      const Py = Math.min(Pyt, maxPelvisY(b, { Px: shiftX, Pz, obliq: ld.obliq, feet }));
      const spec = standSpec({
        Px: shiftX,
        Py,
        Pz,
        tau: theta - lumbarX,
        lumbar: lumbarX * 0.6,
        thorax: lumbarX * 0.4,
        neck: -theta * 0.4,
        obliq: ld.obliq,
        side: ld.obliq * 0.8,
        feet,
        valgus: valgusFor(b, d * 0.5, 0),
        arms: squatArms(b, "high", theta, 0),
      });
      const pose = buildPose(b, spec);
      const load = { ...barbell(ctx.loadKg, thoraxPoint(pose, bl)), onBody: true };
      return { spec, pose, load };
    };
    const r = solveMonotone((z) => {
      const s = build(z);
      return systemCom(b, s.pose, s.load)[2];
    }, -0.8, 0.3, 0.0015, 30);
    const s = build(r.x);
    void H;
    return frame(ctx, s.spec, s.pose, {
      phase,
      load: s.load,
      meta: { lumbarFlex: lumbarX, hamstringLimit: hamLimit, trunkLean: measureAngles(s.pose).trunkLean, obliq: ld.obliq, shiftX },
    });
  },
  metrics: (_c, frames) => [
    { id: "trunk", label: "최대 몸통 숙임", value: maxOf(frames, (f) => f.angles.trunkLean), unit: "°", better: "high" },
    { id: "lumbarM", label: "요추 신전 모멘트(최대)", value: maxOf(frames, (f) => f.moments.lumbar), unit: "N·m", better: "low" },
  ],
};

/* ───────────── 바벨 로우 ───────────── */

const barbellRow: Movement = {
  id: "barbell-row",
  name: "바벨 로우",
  en: "Bent-over Row",
  category: "gym",
  group: "상체 · 당기기",
  summary: "힙힌지 자세를 유지한 채 바를 아랫배 쪽으로 당깁니다. 팔·몸통 길이에 따라 버텨야 하는 허리 모멘트가 달라집니다.",
  cues: ["몸통 45~60° 유지", "팔꿈치를 뒤로", "바는 무릎 아래에서 시작"],
  load: { kind: "barbell", default: 50, min: 20, max: 160, step: 2.5, label: "바벨", rmPerBw: 1.1 },
  kind: "static",
  support: "feet",
  timeline: fixed(2.6),
  frame: (ctx, t) => {
    const b = ctx.body;
    const cfg: HingeCfg = { variant: "rdl", stanceK: 1.3, toeOut: 8, gripOutside: true, rmPerBw: 1.2 };
    const probe = (ctx.cache.rowProbe as ReturnType<typeof solveHinge>) ?? (ctx.cache.rowProbe = solveHinge(ctx, cfg, 0.3));
    const kneeY = b.ankleH[0] + (b.shank[0] + b.shank[1]) / 2;
    const dHold = clamp((kneeY - 0.04 - probe.lowY) / Math.max(0.05, probe.lockY - probe.lowY), 0, 1);
    const key = "rowBase";
    const base = (ctx.cache[key] as ReturnType<typeof solveHinge>) ?? (ctx.cache[key] = solveHinge(ctx, cfg, dHold));
    const { d, phase } = repPhase(t, 0.35, 0.12, 0.05);
    const gh = Math.max(b.hipW / 2 + 0.12, b.shW * 0.65);
    const hang: Vec3 = [0, base.barY, base.barZ];
    const tgt = thoraxPoint(base.pose, [0, -0.75 * b.thorax, 0.115 * b.H]);
    const bar = lerpV(hang, tgt, smooth(d));
    const spec: PoseSpec = {
      ...base.spec,
      arms: [
        { ik: [gh, bar[1], bar[2]], pole: [0.35, 0.4, -1] },
        { ik: [-gh, bar[1], bar[2]], pole: [-0.35, 0.4, -1] },
      ],
    };
    const pose = buildPose(b, spec);
    const load = barbell(ctx.loadKg, bar);
    return frame(ctx, spec, pose, { phase: phase === "내려가기" ? "당기기" : phase === "올라오기" ? "내리기" : phase === "바닥 지점" ? "수축" : phase, load, meta: { ...base.meta, barDrift: 0 } });
  },
  metrics: (ctx, frames) => [
    { id: "trunk", label: "몸통 숙임", value: frames[0].angles.trunkLean, unit: "°" },
    { id: "rom", label: "바 이동 거리", value: (maxOf(frames, (f) => f.load!.center[1]) - minOf(frames, (f) => f.load!.center[1])) * 100, unit: "cm" },
    { id: "lumbarM", label: "요추 신전 모멘트(최대)", value: maxOf(frames, (f) => f.moments.lumbar), unit: "N·m", better: "low" },
    { id: "com", label: "무게중심 전방 이탈(최대)", value: maxOf(frames, (f) => Math.abs(f.com[2])) * 100, unit: "cm", better: "low" },
  ],
};

/* ───────────── 오버헤드 프레스 ───────────── */

const overheadPress: Movement = {
  id: "overhead-press",
  name: "오버헤드 프레스",
  en: "Overhead Press",
  category: "gym",
  group: "상체 · 밀기",
  summary: "선 자세로 바를 쇄골 앞에서 머리 위로 밀어 올립니다. 어깨 굴곡 가동범위가 부족하면 허리를 젖혀(요추 과신전) 보상합니다.",
  cues: ["둔근·복근 조이기", "바가 지나가면 머리를 앞으로", "락아웃은 발 중앙 위"],
  load: { kind: "barbell", default: 35, min: 20, max: 120, step: 2.5, label: "바벨", rmPerBw: 0.65 },
  kind: "static",
  support: "feet",
  timeline: fixed(3),
  frame: (ctx, t) => {
    const { d, phase } = repPhase(t, 0.38, 0.14, 0.06);
    const b = ctx.body;
    const H = b.H;
    const feet = hipFeet(b, 8, 1.1);
    const ld = legDiffComp(b, 0);
    const need = 180 - (b.mobility.shoulderFlex + 8);
    const reachUp = smooth((d - 0.35) / 0.65);
    const ctrlLean = ((100 - b.capacity.control) / 100) * 6 * smooth(d);
    const ext = Math.max(0, need) * 0.75 * reachUp + ctrlLean;
    const leftover = Math.max(0, need - Math.max(0, need) * 0.75) * reachUp;
    const reach = b.upperArm + b.forearm + b.hand * 0.45;
    const gh = b.shW * 0.62;
    const armVert = Math.sqrt(Math.max(0.04, reach * reach - (gh - b.shW / 2) ** 2)) * 0.993;
    const build = (Pz: number) => {
      const Py = maxPelvisY(b, { Px: ld.shiftX, Pz, obliq: ld.obliq, feet });
      const q = {
        Px: ld.shiftX,
        Py,
        Pz,
        tau: -ext * 0.3,
        lumbar: -ext * 0.7,
        neck: 4 - 14 * Math.sin(Math.PI * clamp(d * 1.6, 0, 1)),
        obliq: ld.obliq,
        side: ld.obliq * 0.8,
        feet,
      };
      const p1 = buildPose(b, standSpec({ ...q, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }));
      const rack = thoraxPoint(p1, [0, -0.025 * H, 0.085 * H]);
      const sm = lerpV(p1.j.shL, p1.j.shR, 0.5);
      const topZ = sm[2] + armVert * Math.sin(leftover * DEG);
      const top: Vec3 = [0, sm[1] + armVert * Math.cos(leftover * DEG), topZ];
      const bar = lerpV(rack, top, smooth(d));
      bar[2] += 0.035 * Math.sin(Math.PI * smooth(d));
      const arms: [ArmSpec, ArmSpec] = [
        { ik: [gh, bar[1], bar[2]], pole: [0.5, -0.6, 0.6] },
        { ik: [-gh, bar[1], bar[2]], pole: [-0.5, -0.6, 0.6] },
      ];
      const spec = standSpec({ ...q, arms });
      const pose = buildPose(b, spec);
      return { spec, pose, load: barbell(ctx.loadKg, bar) };
    };
    const r = solveMonotone((z) => {
      const s = build(z);
      return systemCom(b, s.pose, s.load)[2];
    }, -0.3, 0.2, 0.0015, 30);
    const s = build(r.x);
    return frame(ctx, s.spec, s.pose, {
      phase: labels(phase, true),
      load: s.load,
      meta: { lumbarExt: ext, shoulderDeficit: Math.max(0, need) * reachUp, obliq: ld.obliq, shiftX: ld.shiftX },
    });
  },
  metrics: (_c, frames) => [
    { id: "lean", label: "최대 몸통 뒤로 젖힘", value: -minOf(frames, (f) => f.angles.trunkLean), unit: "°", better: "low" },
    { id: "rom", label: "바 이동 거리", value: (maxOf(frames, (f) => f.load!.center[1]) - minOf(frames, (f) => f.load!.center[1])) * 100, unit: "cm" },
    { id: "barFwd", label: "락아웃 바 전방 위치", value: frames.reduce((a, b) => (b.load!.center[1] > a.load!.center[1] ? b : a)).load!.center[2] * 100, unit: "cm", better: "low" },
    { id: "shM", label: "어깨 굴곡 모멘트(최대)", value: maxOf(frames, (f) => f.moments.shoulder), unit: "N·m", better: "low" },
  ],
};

/* ───────────── 스플릿 계열 ───────────── */

interface SplitCfg {
  bench: boolean;
  stride: number; // × 다리 길이
  frontShare: number;
  trunkPref: number;
}

function solveSplit(ctx: Ctx, cfg: SplitCfg, d: number, rearZ: number, rearAir: number, latShift = 0.6) {
  const b = ctx.body;
  const H = b.H;
  const lim = b.mobility.ankleDF;
  const benchH = 0.42 * Math.sqrt(H / 1.75);
  const rel = relIntensity(b, ctx.loadKg, 0.9);
  const front: FootPlace = { x: b.hipW / 2 + 0.02, z: 0, yaw: 6 };
  const rearHeel = cfg.bench ? 72 : lerp(20, 62, smooth(d)) * (rearAir > 0 ? 0.6 : 1) + (rearAir > 0 ? 20 : 0);
  const rear: FootPlace = {
    x: -(b.hipW / 2 + 0.02),
    z: rearZ,
    y: cfg.bench ? benchH : rearAir,
    yaw: 2,
    heelRise: rearZ === 0 && !cfg.bench && rearAir === 0 ? 0 : rearHeel,
  };
  const feet: [FootPlace, FootPlace] = [front, rear];
  const kneeStand = b.ankleH[0] + b.shank[0];
  const top = maxPelvisY(b, { Pz: rearZ / 2, feet });
  const bottomY = kneeStand * (cfg.bench ? 0.95 : 1.02);
  const frontMid = 0;
  const rearPt = anklePos(b, 1, rear)[2] + b.foot.ball;
  const tz = rearZ === 0 ? frontMid : lerp(rearPt, frontMid, cfg.frontShare);
  const single = rearAir > 0;
  // 발을 옮기는 동안(뒷발 체공)은 동적 전이 구간: 무게중심은 두 발 사이를 따라 이동
  const targetZ = rearZ === 0 ? frontMid : Math.min(tz, frontMid - 0.03);
  void single;
  const valg = valgusFor(b, d, rel, 0);
  const build = (theta: number, heel: number, Pz: number) => {
    const f0 = { ...front, heelRise: heel };
    const ft: [FootPlace, FootPlace] = [f0, rear];
    const yT = lerp(top, bottomY, smooth(d));
    const Py = Math.min(yT, maxPelvisY(b, { Px: front.x * latShift, Pz, feet: ft }));
    const arms: [ArmSpec, ArmSpec] =
      ctx.loadKg > 0
        ? [
            { sh: { flex: theta * 0.9, abd: 8 }, elbow: 4 },
            { sh: { flex: theta * 0.9, abd: 8 }, elbow: 4 },
          ]
        : [
            { sh: { flex: 10, abd: 20 }, elbow: 80 },
            { sh: { flex: 10, abd: 20 }, elbow: 80 },
          ];
    const Px = front.x * latShift;
    const spec = standSpec({ Px, Py, Pz, tau: theta, neck: -theta * 0.4, feet: ft, valgus: [valg[0], 0], arms });
    let pose = buildPose(b, spec);
    // 뒷무릎이 바닥에 닿지 않게
    if (pose.j.kneeR[1] < 0.04 + (cfg.bench ? 0 : 0)) {
      spec.pelvis.pos = [spec.pelvis.pos[0], spec.pelvis.pos[1] + (0.04 - pose.j.kneeR[1]), spec.pelvis.pos[2]];
      pose = buildPose(b, spec);
    }
    const load: LoadState | undefined =
      ctx.loadKg > 0 ? { kind: "dumbbell", mass: ctx.loadKg, center: lerpV(pose.j.gripL, pose.j.gripR, 0.5), carried: true } : undefined;
    return { spec, pose, load };
  };
  const frontBall = anklePos(b, 0, front)[2] + b.foot.ball;
  const solveZ = (theta: number, heel: number) => {
    // 앞발 뒤꿈치가 들리면 앞발 지지는 발볼 쪽으로
    const tgt = heel > 0.5 ? Math.max(targetZ, lerp(targetZ, frontBall, clamp(heel / 3, 0, 1) * (single ? 1 : 0.6))) : targetZ;
    const r = solveMonotone((z) => {
      const s = build(theta, heel, z);
      return systemCom(b, s.pose, s.load)[2] - tgt;
    }, rearZ - 0.2, 0.35, 0.0015, 30);
    const s = build(theta, heel, r.x);
    const a = measureAngles(s.pose);
    return { ...s, df: a.ankleDF[0], a };
  };
  let theta = cfg.trunkPref * smooth(d);
  let heel = 0;
  let sol = solveZ(theta, heel);
  if (sol.df > lim + 0.5) {
    const f = (th: number) => solveZ(th, 0).df - lim;
    if (f(45) <= 0) {
      theta = solveMonotone((th) => -f(th), theta, 45, 0.2, 16).x;
      sol = solveZ(theta, 0);
    } else {
      theta = 45;
      heel = Math.min(20, solveZ(45, 0).df - lim);
      sol = solveZ(theta, heel);
    }
  }
  return {
    ...sol,
    meta: {
      heelRise: [heel, 0] as [number, number],
      valgus: [valg[0], 0] as [number, number],
      trunkLean: sol.a.trunkLean,
      trunkExtra: Math.max(0, theta - cfg.trunkPref * smooth(d)),
      transient: single || (rearZ !== 0 && latShift > 0.65 && !cfg.bench),
    },
    benchH,
  };
}

const bulgarian: Movement = {
  id: "bulgarian-split-squat",
  name: "불가리안 스플릿 스쿼트",
  en: "Bulgarian Split Squat",
  category: "gym",
  group: "하체 · 한 다리",
  summary: "뒷발을 벤치에 올리고 앞다리로 앉았다 일어납니다. 앞발 위치·발목 가동성에 따라 무릎 전진량과 몸통 숙임이 달라집니다. (왼발 앞)",
  cues: ["앞무릎은 두 번째 발가락 방향", "골반 수평 유지", "체중 80% 이상 앞발"],
  load: { kind: "dumbbell", default: 20, min: 0, max: 80, step: 2, label: "덤벨(합계)", rmPerBw: 0.75 },
  kind: "static",
  support: "feet",
  timeline: fixed(3.2),
  frame: (ctx, t) => {
    const b = ctx.body;
    const { d, phase } = repPhase(t);
    const rearZ = -(0.62 * b.legLen + b.foot.len * 0.3);
    const s = solveSplit(ctx, { bench: true, stride: 0.62, frontShare: 0.9, trunkPref: 32 }, d, rearZ, 0, 0.75);
    const surfaces = [{ kind: "bench" as const, center: [-(b.hipW / 2 + 0.02), s.benchH / 2, rearZ - 0.12] as Vec3, size: [0.32, s.benchH, 0.42] as Vec3 }];
    return frame(ctx, s.spec, s.pose, { phase, meta: s.meta, load: s.load, surfaces });
  },
  metrics: (_c, frames) => [
    { id: "kneeFwd", label: "앞무릎 전진 (발끝 기준)", value: maxOf(frames, (f) => f.pose.j.kneeL[2] - f.pose.j.toeL[2]) * 100, unit: "cm" },
    { id: "trunk", label: "최대 몸통 숙임", value: maxOf(frames, (f) => f.angles.trunkLean), unit: "°" },
    { id: "front", label: "앞발 하중 (최저점)", value: (frames.reduce((a, b) => (b.pose.j.pelvis[1] < a.pose.j.pelvis[1] ? b : a)).loads.find((l) => l.id === "L")?.share ?? 0) * 100, unit: "%" },
    { id: "valgus", label: "앞무릎 안쪽 이동(최대)", value: maxOf(frames, (f) => f.kneeMedial[0]) * 100, unit: "cm", better: "low" },
  ],
};

const reverseLunge: Movement = {
  id: "reverse-lunge",
  name: "리버스 런지",
  en: "Reverse Lunge",
  category: "gym",
  group: "하체 · 한 다리",
  summary: "오른발을 뒤로 딛으며 앉았다가 다시 모읍니다. 보폭은 다리 길이에 비례하고, 한 발로 서는 순간 골반 안정성이 드러납니다.",
  cues: ["뒷무릎은 바닥 바로 위까지", "앞발 뒤꿈치로 밀기", "한 발 지지 때 골반 수평"],
  load: { kind: "dumbbell", default: 0, min: 0, max: 60, step: 2, label: "덤벨(합계)", rmPerBw: 0.9 },
  kind: "static",
  support: "feet",
  timeline: fixed(3.6),
  frame: (ctx, t) => {
    const b = ctx.body;
    const stride = 0.88 * b.legLen;
    let rearZ = 0,
      air = 0,
      d = 0,
      lat = 0.6,
      phase = "준비";
    const shift = (x: number) => lerp(0.6, 1.05, smooth(x));
    if (t < 0.05) {
      lat = shift(t / 0.05);
      phase = "체중 이동";
    } else if (t < 0.19) {
      const u = smooth((t - 0.05) / 0.14);
      rearZ = -stride * u;
      air = 0.06 * Math.sin(Math.PI * u);
      lat = 1.05;
      phase = "뒤로 딛기";
    } else if (t < 0.22) {
      rearZ = -stride;
      lat = shift(1 - (t - 0.19) / 0.03);
      phase = "뒤로 딛기";
    } else if (t < 0.48) {
      rearZ = -stride;
      d = smooth((t - 0.22) / 0.26);
      phase = "내려가기";
    } else if (t < 0.56) {
      rearZ = -stride;
      d = 1;
      phase = "바닥 지점";
    } else if (t < 0.78) {
      rearZ = -stride;
      d = 1 - smooth((t - 0.56) / 0.22);
      phase = "올라오기";
    } else if (t < 0.81) {
      rearZ = -stride;
      lat = shift((t - 0.78) / 0.03);
      phase = "체중 이동";
    } else if (t < 0.95) {
      const u = smooth((t - 0.81) / 0.14);
      rearZ = -stride * (1 - u);
      air = 0.06 * Math.sin(Math.PI * u);
      lat = 1.05;
      phase = "발 모으기";
    } else {
      lat = shift(1 - (t - 0.95) / 0.05);
      phase = "마무리";
    }
    const s = solveSplit(ctx, { bench: false, stride: 0.88, frontShare: 0.62, trunkPref: 10 }, d, rearZ, air, lat);
    const feetOn: ("L" | "R")[] = air > 0.004 ? ["L"] : ["L", "R"];
    return frame(ctx, s.spec, s.pose, { phase, meta: s.meta, load: s.load, contacts: feetContacts(b, s.pose, feetOn) });
  },
  metrics: (_c, frames) => [
    { id: "stride", label: "보폭", value: maxOf(frames, (f) => f.pose.j.ankleL[2] - f.pose.j.ankleR[2]) * 100, unit: "cm" },
    { id: "kneeFwd", label: "앞무릎 전진 (발끝 기준)", value: maxOf(frames, (f) => f.pose.j.kneeL[2] - f.pose.j.toeL[2]) * 100, unit: "cm" },
    { id: "rearKnee", label: "뒷무릎 최저 높이", value: minOf(frames, (f) => f.pose.j.kneeR[1]) * 100, unit: "cm" },
  ],
};

/* ───────────── 누워서 / 매달려서 ───────────── */

function translateSpec(spec: PoseSpec, dv: Vec3): PoseSpec {
  return { ...spec, pelvis: { ...spec.pelvis, pos: add(spec.pelvis.pos, dv) } };
}

const benchPress: Movement = {
  id: "bench-press",
  name: "벤치프레스",
  en: "Bench Press",
  category: "gym",
  group: "상체 · 밀기",
  summary: "벤치에 누워 바를 가슴까지 내렸다 밀어 올립니다. 팔이 길수록 바의 이동 거리와 1회 일량이 커집니다.",
  cues: ["견갑 모으고 내리기", "바는 명치~가슴 아래로", "발은 바닥에 단단히"],
  load: { kind: "barbell", default: 60, min: 20, max: 200, step: 2.5, label: "바벨", rmPerBw: 1.1 },
  kind: "static",
  support: "bench",
  timeline: fixed(3),
  view: { yaw: 35 },
  frame: (ctx, t) => {
    const { d, phase } = repPhase(t, 0.4, 0.1, 0.06);
    const b = ctx.body;
    const H = b.H;
    const benchH = 0.43;
    const arch = 6 + (b.capacity.control / 100) * 8;
    const Py = benchH + 0.055 * H;
    const legLen = b.thigh[0] + b.shank[0];
    const feet: [FootPlace, FootPlace] = [
      { x: b.hipW / 2 + 0.16, z: 0.55 * legLen, yaw: 18 },
      { x: -(b.hipW / 2 + 0.16), z: 0.55 * legLen, yaw: 18 },
    ];
    const q = {
      Py,
      Pz: 0,
      tau: 0,
      lumbar: -arch,
      thorax: arch * 0.6,
      neck: 0,
      base: Rx(-90),
      feet,
    };
    const p1 = buildPose(b, standSpec({ ...q, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }));
    // 등이 벤치 위에 놓이도록 높이 보정
    const backPt = thoraxPoint(p1, [0, -0.45 * b.thorax, -0.055 * H]);
    const dy = benchH + 0.005 - backPt[1];
    // 다리가 짧아 바닥에 닿지 않으면 발판을 둔다
    const hipY = p1.j.hipL[1] + dy;
    const reachL = Math.min(b.thigh[0] + b.shank[0], b.thigh[1] + b.shank[1]) * 0.97;
    const ankZ = feet[0].z - (b.foot.toe - b.foot.heel) / 2 - p1.j.hipL[2];
    const lat = feet[0].x - b.hipW / 2;
    const vert = Math.sqrt(Math.max(0, reachL * reachL - ankZ * ankZ - lat * lat));
    const stepH = Math.max(0, hipY - vert - b.ankleH[0]);
    if (stepH > 0.005) for (const f of feet) f.y = Math.ceil(stepH * 50) / 50;
    const reach = b.upperArm + b.forearm + b.hand * 0.45;
    const gh = b.shW * 1.15;
    const armVert = Math.sqrt(Math.max(0.04, reach * reach - (gh - b.shW / 2) ** 2)) * 0.993;
    const p2 = buildPose(b, translateSpec(standSpec({ ...q, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }), [0, dy, 0]));
    const sm = lerpV(p2.j.shL, p2.j.shR, 0.5);
    const lock: Vec3 = [0, sm[1] + armVert, sm[2]];
    const touch = thoraxPoint(p2, [0, -0.55 * b.thorax, 0.125 * H]);
    touch[1] += 0.015;
    const bar = lerpV(lock, touch, smooth(d));
    const spec = translateSpec(
      standSpec({
        ...q,
        arms: [
          { ik: [gh, bar[1], bar[2]], pole: [0.9, -1, 0.35] },
          { ik: [-gh, bar[1], bar[2]], pole: [-0.9, -1, 0.35] },
        ],
      }),
      [0, dy, 0],
    );
    const pose = buildPose(b, spec);
    const load = barbell(ctx.loadKg, bar);
    const contacts: Contact[] = [...feetContacts(b, pose), { id: "back", group: "body", pts: benchPts(benchH, -0.35) }];
    return frame(ctx, spec, pose, {
      phase,
      load,
      contacts,
      meta: { lumbarExt: arch },
      surfaces: [
        { kind: "bench", center: [0, benchH / 2, -0.35], size: [0.3, benchH, 1.2] },
        ...((feet[0].y ?? 0) > 0 ? [{ kind: "box" as const, center: [0, (feet[0].y ?? 0) / 2, feet[0].z] as Vec3, size: [0.9, feet[0].y ?? 0, 0.4] as Vec3, label: "발판" }] : []),
      ],
    });
  },
  metrics: (ctx, frames) => {
    const rom = maxOf(frames, (f) => f.load!.center[1]) - minOf(frames, (f) => f.load!.center[1]);
    return [
      { id: "rom", label: "바 이동 거리", value: rom * 100, unit: "cm" },
      { id: "work", label: "1회 일량", value: ctx.loadKg * 9.81 * rom, unit: "J" },
      { id: "elbow", label: "최저점 팔꿈치 굴곡", value: maxOf(frames, (f) => Math.max(...f.angles.elbowFlex)), unit: "°" },
      { id: "shM", label: "어깨 수평 모멘트(최대)", value: maxOf(frames, (f) => f.moments.shoulder), unit: "N·m" },
    ];
  },
};

function benchPts(h: number, cz: number): Vec3[] {
  return [
    [0.15, h, cz - 0.6],
    [-0.15, h, cz - 0.6],
    [-0.15, h, cz + 0.6],
    [0.15, h, cz + 0.6],
  ];
}

function handContacts(pose: Pose): Contact[] {
  return (["L", "R"] as const).map((k) => {
    const w = pose.j[`wr${k}`];
    const f = pose.j[`fing${k}`];
    return {
      id: k === "L" ? "handL" : "handR",
      group: "hands",
      pts: [
        [w[0] + 0.04, 0, w[2] - 0.02],
        [w[0] - 0.04, 0, w[2] - 0.02],
        [f[0] - 0.04, 0, f[2] + 0.02],
        [f[0] + 0.04, 0, f[2] + 0.02],
      ],
      axis: [
        [w[0], 0, w[2]],
        [f[0], 0, f[2]],
      ],
    } as Contact;
  });
}

const pushUp: Movement = {
  id: "push-up",
  name: "푸시업",
  en: "Push-up",
  category: "gym",
  group: "상체 · 밀기",
  summary: "발끝과 손으로 몸을 지지하고 가슴을 바닥 가까이 내렸다 밀어 올립니다. 손과 발이 나눠 받는 체중 비율을 볼 수 있습니다.",
  cues: ["머리-골반-발목 일직선", "팔꿈치 45°", "가슴이 바닥 주먹 하나 위까지"],
  load: null,
  kind: "static",
  support: "hands-feet",
  timeline: fixed(2.6),
  view: { yaw: 80 },
  frame: (ctx, t) => {
    const { d, phase } = repPhase(t, 0.4, 0.1, 0.06);
    const b = ctx.body;
    const H = b.H;
    const reach = b.upperArm + b.forearm + b.hand * 0.45;
    const sag = ((100 - b.capacity.control) / 100) * 16 * (0.4 + 0.6 * smooth(d));
    // 손은 어깨보다 7cm 바깥, 3cm 앞 → 팔이 닿는 최대 높이
    const hTop = Math.sqrt(Math.max(0.05, reach * reach - 0.07 * 0.07 - 0.03 * 0.03)) * 0.985 + 0.025;
    const hBot = 0.09 * H;
    const hTarget = lerp(hTop, hBot, smooth(d));
    const build = (alpha: number) => {
      const feet: [FootPlace, FootPlace] = [
        { x: b.hipW / 2, z: 0, yaw: 0, heelRise: 82 - alpha },
        { x: -b.hipW / 2, z: 0, yaw: 0, heelRise: 82 - alpha },
      ];
      const aL = anklePos(b, 0, feet[0]);
      const u: Vec3 = [0, Math.sin(alpha * DEG), Math.cos(alpha * DEG)];
      const L = Math.min(b.thigh[0] + b.shank[0], b.thigh[1] + b.shank[1]) * 0.999;
      const P: Vec3 = [0, aL[1] + u[1] * L, aL[2] + u[2] * L];
      const q = { Py: P[1] - sag * 0.004, Pz: P[2], tau: 0, lumbar: -sag, thorax: sag * 0.3, neck: -8, base: Rx(90 - alpha), feet };
      const p1 = buildPose(b, standSpec({ ...q, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }));
      const arms: [ArmSpec, ArmSpec] = [
        { ik: [p1.j.shL[0] + 0.07, 0.025, p1.j.shL[2] + 0.03], pole: [0.8, 0.3, -1] },
        { ik: [p1.j.shR[0] - 0.07, 0.025, p1.j.shR[2] + 0.03], pole: [-0.8, 0.3, -1] },
      ];
      const spec = standSpec({ ...q, arms });
      return { spec, pose: buildPose(b, spec) };
    };
    const r = solveMonotone((a) => (build(a).pose.j.shL[1] + build(a).pose.j.shR[1]) / 2 - hTarget, 0, 40, 0.001, 30);
    const s = build(r.x);
    const contacts: Contact[] = [...handContacts(s.pose), ...feetContacts(b, s.pose)];
    return frame(ctx, s.spec, s.pose, { phase, contacts, meta: { lumbarExt: sag } });
  },
  metrics: (_c, frames) => {
    const hands = (f: SimFrame) => f.loads.filter((l) => l.id === "handL" || l.id === "handR").reduce((a, l) => a + l.share, 0);
    return [
      { id: "handsTop", label: "손 하중 (위)", value: hands(frames[0]) * 100, unit: "%" },
      { id: "handsBot", label: "손 하중 (아래)", value: hands(frames.reduce((a, b) => (b.pose.j.shL[1] < a.pose.j.shL[1] ? b : a))) * 100, unit: "%" },
      { id: "rom", label: "어깨 이동 거리", value: (maxOf(frames, (f) => f.pose.j.shL[1]) - minOf(frames, (f) => f.pose.j.shL[1])) * 100, unit: "cm" },
    ];
  },
};

const hipThrust: Movement = {
  id: "hip-thrust",
  name: "힙 쓰러스트",
  en: "Hip Thrust",
  category: "gym",
  group: "하체 · 둔근",
  summary: "등 윗부분을 벤치에 기대고 골반 위 바를 밀어 올립니다. 최고점에서 정강이가 수직, 몸통이 수평이 되는지 봅니다.",
  cues: ["턱 당기고 갈비뼈 내리기", "최고점 정강이 수직", "허리가 아닌 엉덩이로 밀기"],
  load: { kind: "barbell", default: 60, min: 20, max: 250, step: 2.5, label: "바벨", rmPerBw: 2.2 },
  kind: "static",
  support: "bench",
  timeline: fixed(2.8),
  view: { yaw: 85 },
  frame: (ctx, t) => {
    const rp = repPhase(t, 0.38, 0.14, 0.06);
    const d = 1 - rp.d; // 1 = 최고, 0 = 최저
    const b = ctx.body;
    const H = b.H;
    const benchH = 0.42;
    const ext = ((100 - b.capacity.control) / 100) * 14 * smooth(d);
    // 몸통 기울기(수평 기준 위로 +). 최고점은 넙다리가 수평이 되는 각도
    const plan = htPlan(ctx, benchH);
    const elev = lerp(36, plan.elevTop, smooth(d));
    const place = htPlace(ctx, benchH, elev, ext, d, plan.feet);
    const bar = pelvisPoint(place.pose, [0, 0.02 * H, 0.11 * H]);
    bar[1] = Math.max(bar[1], 0.225);
    const spec = standSpec({
      ...place.q,
      arms: [
        { ik: [b.hipW / 2 + 0.2, bar[1], bar[2]], pole: [1, 0.5, 0] },
        { ik: [-(b.hipW / 2 + 0.2), bar[1], bar[2]], pole: [-1, 0.5, 0] },
      ],
    });
    const pose = buildPose(b, spec);
    const contacts: Contact[] = [...feetContacts(b, pose), { id: "back", group: "body", pts: benchPts(benchH, -0.3) }];
    return frame(ctx, spec, pose, {
      phase: rp.phase === "내려가기" ? "내리기" : rp.phase === "바닥 지점" ? "최저 지점" : rp.phase === "올라오기" ? "밀어 올리기" : rp.phase === "준비" ? "최고 지점" : rp.phase,
      load: { ...barbell(ctx.loadKg, bar), onBody: true },
      contacts,
      meta: { lumbarExt: ext },
      surfaces: [{ kind: "bench", center: [0, benchH / 2, -0.3], size: [1.1, benchH, 0.42] }],
    });
  },
  metrics: (_c, frames) => {
    const top = frames.reduce((a, b) => (b.pose.j.pelvis[1] > a.pose.j.pelvis[1] ? b : a));
    return [
      { id: "kneeTop", label: "최고점 무릎 굴곡 (이상 ≈ 90°)", value: (top.angles.kneeFlex[0] + top.angles.kneeFlex[1]) / 2, unit: "°" },
      { id: "hipTop", label: "최고점 고관절 각 (0 = 완전 신전)", value: (top.angles.hipFlex[0] + top.angles.hipFlex[1]) / 2, unit: "°", better: "low" },
      { id: "rise", label: "골반 상승 거리", value: (maxOf(frames, (f) => f.pose.j.pelvis[1]) - minOf(frames, (f) => f.pose.j.pelvis[1])) * 100, unit: "cm" },
    ];
  },
};

function htPlace(ctx: Ctx, benchH: number, elev: number, ext: number, d: number, feet: [FootPlace, FootPlace]) {
  const b = ctx.body;
  const H = b.H;
  const q = { Py: 0.5, Pz: 0, tau: 0, lumbar: -ext, thorax: ext * 0.3, neck: 20 * (1 - d) + 15 * d, base: Rx(-(90 - elev)), feet };
  const p1 = buildPose(b, standSpec({ ...q, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }));
  const backPt = thoraxPoint(p1, [0, -0.35 * b.thorax, -0.055 * H]);
  // 등의 접촉점을 벤치 모서리(z = -0.05, y = benchH)에 둔다
  const q2 = { ...q, Py: q.Py + benchH + 0.02 - backPt[1], Pz: q.Pz - 0.05 - backPt[2] };
  const pose = buildPose(b, standSpec({ ...q2, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }));
  return { q: q2, pose };
}

function htPlan(ctx: Ctx, benchH: number) {
  if (ctx.cache.htPlan) return ctx.cache.htPlan as { elevTop: number; feet: [FootPlace, FootPlace] };
  const b = ctx.body;
  const dummy = hipFeet(b);
  const ext = ((100 - b.capacity.control) / 100) * 14;
  const kneeH = b.ankleH[0] + b.shank[0];
  // 최고점: 고관절 높이 = 무릎 높이 + 2cm (넙다리 거의 수평)
  const r = solveMonotone((e) => -(htPlace(ctx, benchH, e, ext, 1, dummy).pose.j.pelvis[1] - (kneeH + 0.02)), -15, 30, 0.001, 30);
  const top = htPlace(ctx, benchH, r.x, ext, 1, dummy).pose;
  const dy = top.j.pelvis[1] - kneeH;
  const ankleZ = top.j.pelvis[2] + Math.sqrt(Math.max(0.01, b.thigh[0] ** 2 - dy * dy));
  const mid = ankleZ + (b.foot.toe - b.foot.heel) / 2;
  const feet: [FootPlace, FootPlace] = [
    { x: b.hipW / 2 + 0.1, z: mid, yaw: 12 },
    { x: -(b.hipW / 2 + 0.1), z: mid, yaw: 12 },
  ];
  const plan = { elevTop: r.x, feet };
  ctx.cache.htPlan = plan;
  return plan;
}

const pullUp: Movement = {
  id: "pull-up",
  name: "풀업",
  en: "Pull-up",
  category: "gym",
  group: "상체 · 당기기",
  summary: "철봉에 매달려 턱이 바 위로 올라갈 때까지 당깁니다. 팔이 길고 체중이 무거울수록 1회 일량이 커집니다.",
  cues: ["어깨를 귀에서 멀리", "가슴을 바로", "반동 없이"],
  load: { kind: "plate", default: 0, min: 0, max: 50, step: 2.5, label: "추가 중량", rmPerBw: 0.6 },
  kind: "static",
  support: "hang",
  timeline: fixed(2.8),
  frame: (ctx, t) => {
    const rp = repPhase(t, 0.38, 0.12, 0.08);
    const d = rp.d;
    const b = ctx.body;
    const H = b.H;
    const st = stdStanding(ctx);
    const reach = b.upperArm + b.forearm + b.hand * 0.45;
    const gh = b.shW * 0.8;
    const armVert = Math.sqrt(Math.max(0.04, reach * reach - (gh - b.shW / 2) ** 2));
    const barY = st.shoulderY + reach + 0.12;
    const yHang = barY - armVert * 0.985;
    const yTop = barY - 0.05 * H;
    const ys = lerp(yHang, yTop, smooth(d));
    const deficit = Math.max(0, 172 - b.mobility.shoulderFlex);
    const ext = deficit * 0.6 * (1 - smooth(d)) + 6 * smooth(d);
    const q = {
      Py: 1,
      Pz: 0,
      tau: -ext * 0.3 - 4 * smooth(d),
      lumbar: -ext * 0.7,
      neck: -6,
      feet: hipFeet(b, 4),
    };
    const legs: PoseSpec["legs"] = [
      { hip: { flex: 12 }, knee: 35, ankle: -25 },
      { hip: { flex: 18 }, knee: 45, ankle: -25 },
    ];
    const mk = (Py: number, Pz: number, arms: [ArmSpec, ArmSpec]): PoseSpec => ({ ...standSpec({ ...q, Py, Pz, arms }), legs });
    const p0 = buildPose(b, mk(1, 0, [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }]));
    const sm = lerpV(p0.j.shL, p0.j.shR, 0.5);
    const Py = 1 + (ys - sm[1]);
    const Pz = -sm[2] - 0.03 * smooth(d);
    const spec = mk(Py, Pz, [
      { ik: [gh, barY, 0], pole: [1, -0.2, 0.3] },
      { ik: [-gh, barY, 0], pole: [-1, -0.2, 0.3] },
    ]);
    const pose = buildPose(b, spec);
    const load: LoadState | undefined = ctx.loadKg > 0 ? { kind: "plate", mass: ctx.loadKg, center: pelvisPoint(pose, [0, -0.12, 0.08]), carried: true } : undefined;
    const contacts: Contact[] = [
      { id: "handL", group: "hands", pts: [[gh + 0.04, barY, 0.02], [gh - 0.04, barY, 0.02], [gh - 0.04, barY, -0.02], [gh + 0.04, barY, -0.02]] },
      { id: "handR", group: "hands", pts: [[-gh + 0.04, barY, 0.02], [-gh - 0.04, barY, 0.02], [-gh - 0.04, barY, -0.02], [-gh + 0.04, barY, -0.02]] },
    ];
    return frame(ctx, spec, pose, {
      phase: rp.phase === "내려가기" ? "당기기" : rp.phase === "바닥 지점" ? "턱 위로" : rp.phase === "올라오기" ? "내려오기" : rp.phase === "준비" ? "매달리기" : rp.phase,
      load,
      contacts,
      meta: { lumbarExt: ext, shoulderDeficit: deficit * (1 - smooth(d)) },
      surfaces: [{ kind: "bar", center: [0, barY, 0], size: [1.4, 0.032, 0.032] }],
    });
  },
  metrics: (ctx, frames) => {
    const rise = maxOf(frames, (f) => f.pose.j.shL[1]) - minOf(frames, (f) => f.pose.j.shL[1]);
    const work = (ctx.body.M + ctx.loadKg) * 9.81 * rise;
    const b = ctx.body;
    const strength = (0.2 + b.capacity.power / 100) * (b.sex === "f" ? 0.5 : 1);
    const reps = clamp(Math.round(13 * strength * Math.pow(0.6 / Math.max(0.3, rise), 1.2) * Math.pow(70 / (b.M + ctx.loadKg), 1.4)), 0, 40);
    return [
      { id: "rise", label: "몸 상승 거리", value: rise * 100, unit: "cm" },
      { id: "work", label: "1회 일량", value: work, unit: "J" },
      { id: "reps", label: "예상 최대 반복", value: reps, unit: "회", digits: 0, better: "high", note: "파워·체중·팔 길이로 추정" },
    ];
  },
};

const calfRaise: Movement = {
  id: "calf-raise",
  name: "카프 레이즈",
  en: "Calf Raise",
  category: "gym",
  group: "하체 · 종아리",
  summary: "발볼로 서서 뒤꿈치를 들어 올립니다. 무게중심이 발볼 위로 옮겨 가는 과정을 볼 수 있습니다.",
  cues: ["엄지발가락 쪽으로 누르기", "최고점 1초 정지", "천천히 내리기"],
  load: { kind: "dumbbell", default: 0, min: 0, max: 80, step: 2, label: "덤벨(합계)", rmPerBw: 1.6 },
  kind: "static",
  support: "feet",
  timeline: fixed(2.4),
  frame: (ctx, t) => {
    const rp = repPhase(t, 0.35, 0.15, 0.08);
    const d = rp.d;
    const b = ctx.body;
    const heel = 38 * smooth((d - 0.15) / 0.85);
    const feet: [FootPlace, FootPlace] = hipFeet(b, 6).map((f) => ({ ...f, heelRise: heel })) as [FootPlace, FootPlace];
    const ballZ = anklePos(b, 0, { x: 0, z: 0, yaw: 0 })[2] + b.foot.ball;
    const target = lerp(0, ballZ + 0.018, smooth(d / 0.15));
    const build = (Pz: number) => {
      const Py = maxPelvisY(b, { Pz, feet });
      const spec = standSpec({ Py, Pz, tau: 0, feet, arms: [{ sh: { abd: 6 }, elbow: 4 }, { sh: { abd: 6 }, elbow: 4 }] });
      const pose = buildPose(b, spec);
      const load: LoadState | undefined = ctx.loadKg > 0 ? { kind: "dumbbell", mass: ctx.loadKg, center: lerpV(pose.j.gripL, pose.j.gripR, 0.5), carried: true } : undefined;
      return { spec, pose, load };
    };
    const r = solveMonotone((z) => {
      const s = build(z);
      return systemCom(b, s.pose, s.load)[2] - target;
    }, -0.3, 0.3, 0.001, 30);
    const s = build(r.x);
    return frame(ctx, s.spec, s.pose, { phase: labels(rp.phase, true), load: s.load, meta: {} });
  },
  metrics: (_c, frames) => [
    { id: "rise", label: "뒤꿈치 상승", value: (maxOf(frames, (f) => f.pose.j.heelL[1]) - minOf(frames, (f) => f.pose.j.heelL[1])) * 100, unit: "cm" },
    { id: "ankleM", label: "발목 저측굴곡 모멘트(최대)", value: maxOf(frames, (f) => f.moments.ankle), unit: "N·m" },
  ],
};

const bar = (def: number, max = 250): Movement["load"] => ({ kind: "barbell", default: def, min: 20, max, step: 2.5, label: "바벨" });

export const GYM: Movement[] = [
  squatMove(
    "high-bar-squat",
    "하이바 백스쿼트",
    "High-bar Back Squat",
    { bar: "high", stanceK: 1.15, toeOut: 15, depth: 0.85, trunkPref: 33, trunkMax: 58, rmPerBw: 1.5 },
    bar(60),
    "바를 승모근 위에 얹고 평행보다 깊게 앉습니다. 대퇴·정강이·몸통 비율과 발목 가동성에 따라 몸통 숙임이 정해집니다.",
    ["무게중심은 발 중앙", "무릎은 발끝 방향", "가슴을 세우고 내려가기"],
  ),
  squatMove(
    "low-bar-squat",
    "로우바 백스쿼트",
    "Low-bar Back Squat",
    { bar: "low", stanceK: 1.35, toeOut: 20, depth: 0.95, trunkPref: 42, trunkMax: 62, rmPerBw: 1.7 },
    bar(70),
    "바를 후면 삼각근 위에 낮게 얹어 엉덩이를 더 뒤로 보냅니다. 몸통이 더 숙여지고 고관절 비중이 커집니다.",
    ["엉덩이를 뒤로", "정강이는 비교적 세우기", "평행까지"],
  ),
  squatMove(
    "front-squat",
    "프론트 스쿼트",
    "Front Squat",
    { bar: "front", stanceK: 1.1, toeOut: 12, depth: 0.82, trunkPref: 18, trunkMax: 40, rmPerBw: 1.25 },
    bar(50, 200),
    "바를 쇄골 앞에 얹어 몸통을 세운 채 앉습니다. 몸통을 숙일 여유가 적어 발목 가동성이 부족하면 깊이를 잃습니다.",
    ["팔꿈치를 높이", "몸통을 세우고", "무릎을 앞으로 충분히"],
  ),
  squatMove(
    "goblet-squat",
    "고블릿 스쿼트",
    "Goblet Squat",
    { bar: "goblet", stanceK: 1.2, toeOut: 18, depth: 0.8, trunkPref: 26, trunkMax: 45, rmPerBw: 0.6 },
    { kind: "kettlebell", default: 16, min: 4, max: 48, step: 2, label: "케틀벨" },
    "케틀벨을 가슴 앞에 들고 앉습니다. 앞쪽 부하가 균형추가 되어 몸통을 세우기 쉽습니다.",
    ["팔꿈치가 무릎 안쪽으로", "가슴 세우기", "발 전체로 밀기"],
  ),
  squatMove(
    "overhead-squat",
    "오버헤드 스쿼트",
    "Overhead Squat",
    { bar: "overhead", stanceK: 1.25, toeOut: 15, depth: 0.88, trunkPref: 10, trunkMax: 50, rmPerBw: 0.9 },
    bar(30, 140),
    "바를 머리 위로 든 채 앉습니다. 어깨 굴곡이 부족하면 몸통을 세울 수 없어 발목·고관절 보상이 한꺼번에 드러납니다.",
    ["바는 발 중앙 위", "겨드랑이를 앞으로", "몸통 최대한 세우기"],
  ),
  squatMove(
    "air-squat",
    "맨몸 스쿼트",
    "Bodyweight Squat",
    { bar: "none", stanceK: 1.1, toeOut: 12, depth: 0.85, trunkPref: 28, trunkMax: 60, rmPerBw: 1 },
    null,
    "기구 없이 팔을 앞으로 뻗고 앉습니다. 기본 움직임 선별검사로 많이 씁니다.",
    ["팔은 균형추", "뒤꿈치 붙이기", "무릎 안쪽 무너짐 주의"],
  ),
  hingeMove(
    "deadlift",
    "컨벤셔널 데드리프트",
    "Conventional Deadlift",
    { variant: "conv", stanceK: 1.25, toeOut: 8, gripOutside: true, rmPerBw: 1.9 },
    bar(80, 300),
    "바닥의 바를 다리 바깥 그립으로 들어 올립니다. 팔이 길수록 몸통이 서고, 몸통이 길수록 숙여집니다.",
    ["바는 발 중앙 위", "정강이에 바 붙이기", "견갑은 바 위"],
  ),
  hingeMove(
    "sumo-deadlift",
    "스모 데드리프트",
    "Sumo Deadlift",
    { variant: "sumo", stanceK: 3.6, toeOut: 38, gripOutside: false, rmPerBw: 1.9 },
    bar(80, 300),
    "넓은 스탠스와 다리 안쪽 그립으로 몸통을 세워 듭니다. 고관절 외전·외회전 가동성이 필요합니다.",
    ["무릎을 발끝 방향으로 밀기", "가슴을 세우고", "바닥을 양옆으로 벌리듯"],
  ),
  hingeMove(
    "romanian-deadlift",
    "루마니안 데드리프트",
    "Romanian Deadlift",
    { variant: "rdl", stanceK: 1.1, toeOut: 6, gripOutside: true, rmPerBw: 1.4 },
    bar(60, 220),
    "선 자세에서 무릎을 살짝 굽힌 채 엉덩이를 뒤로 빼며 바를 내립니다. 햄스트링 유연성이 내려갈 수 있는 깊이를 정합니다.",
    ["바를 허벅지에 붙여서", "엉덩이를 뒤로", "등은 중립"],
  ),
  goodMorning,
  barbellRow,
  overheadPress,
  benchPress,
  pushUp,
  pullUp,
  hipThrust,
  bulgarian,
  reverseLunge,
  calfRaise,
];

export type { MoveFrame };
