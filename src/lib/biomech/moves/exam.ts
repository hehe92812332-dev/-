// 체대입시 실기 종목
import { angleSpec, G, maxPelvisY, sampleKeys, standSpec, systemCom, thoraxPoint, type Key } from "../kit";
import { clamp, lerp, lerpV, Rx, smooth, type Vec3 } from "../math";
import { bodyCom, buildPose, type ArmSpec, type FootPlace } from "../pose";
import type { Contact, Ctx, LoadState, Metric, Movement, SimFrame } from "../types";
import { applyLimits, ballAt, plantFrame, projectileRange, type PlantOpts } from "./dyn";
import { cmjMove, sprintEstimate, standingLongJump } from "./sport";

const maxOf = (frames: SimFrame[], f: (x: SimFrame) => number) => frames.reduce((m, x) => Math.max(m, f(x)), -Infinity);
const minOf = (frames: SimFrame[], f: (x: SimFrame) => number) => frames.reduce((m, x) => Math.min(m, f(x)), Infinity);
const NOTE = "대학별 측정 규정이 달라 실제 기록과 차이가 날 수 있습니다";

function seatContact(y = 0): Contact {
  return {
    id: "seat",
    group: "body",
    pts: [
      [0.15, y, -0.12],
      [-0.15, y, -0.12],
      [-0.15, y, 0.12],
      [0.15, y, 0.12],
    ],
  };
}

/* ───────────── 좌전굴 (앉아 윗몸 앞으로 굽히기) ───────────── */

function sitReachTilt(ctx: Ctx) {
  // 햄스트링(하지직거상) 80° → 골반이 수직에서 10° 앞으로
  return clamp(ctx.body.mobility.hamstring - 70, -40, 50);
}

const sitReach: Movement = {
  id: "sit-and-reach",
  name: "좌전굴",
  en: "Sit and Reach",
  category: "exam",
  group: "체대입시",
  summary: "다리를 펴고 앉아 측정판 위로 손끝을 최대한 밉니다. 햄스트링 유연성이 골반 기울기를, 팔·몸통·다리 길이 비율이 같은 유연성에서의 기록을 바꿉니다.",
  cues: ["무릎을 펴고", "숨을 내쉬며 천천히", "양손 끝을 겹쳐서 2초 유지"],
  load: null,
  kind: "static",
  support: "seat",
  view: { yaw: 90 },
  timeline: () => [
    [0, 0],
    [1, 4],
  ],
  frame: (ctx, t) => {
    const b = ctx.body;
    const H = b.H;
    const d = smooth(clamp((t - 0.05) / 0.55, 0, 1)) * (t > 0.85 ? 1 - smooth((t - 0.85) / 0.15) * 0.6 : 1);
    const tauMax = sitReachTilt(ctx);
    const tau = lerp(-6, tauMax, d);
    const v: Record<string, number> = {
      py: (0.055 * H) / b.legLen,
      tilt: tau,
      lumb: 24 * d,
      thor: 30 * d,
      neck: 20 * d,
      hipL: 90 + tau,
      hipR: 90 + tau,
      kneeL: 0,
      kneeR: 0,
      ankL: 0,
      ankR: 0,
    };
    const spec0 = angleSpec(b, v);
    const p0 = buildPose(b, spec0);
    const soleZ = Math.max(p0.j.ankleL[2], p0.j.ankleR[2]) + b.ankleH[0];
    // 팔은 처음부터 끝까지 같은 방식(역기구학)으로: 어깨 높이 앞쪽 → 발끝 너머 바닥 쪽으로 목표가 연속 이동
    const shY = (p0.j.shL[1] + p0.j.shR[1]) / 2;
    const shZ = (p0.j.shL[2] + p0.j.shR[2]) / 2;
    const reach = b.upperArm + b.forearm + b.hand * 0.45;
    const e = smooth(d);
    const ty = lerp(shY - 0.05, 0.14, e);
    const tz = lerp(shZ + reach * 1.3, soleZ + 1.5, e);
    const arms: [ArmSpec, ArmSpec] = [
      { ik: [0.03 + 0.1 * (1 - e), ty, tz], pole: [0.2, 1, 0] },
      { ik: [-0.03 - 0.1 * (1 - e), ty, tz], pole: [-0.2, 1, 0] },
    ];
    const spec = { ...spec0, arms };
    const pose = buildPose(b, spec);
    return {
      spec,
      pose,
      contacts: [seatContact()],
      meta: { hamstringLimit: Math.max(0, 10 - tauMax) },
      phase: t < 0.05 ? "준비" : t < 0.6 ? "앞으로 굽히기" : t < 0.85 ? "유지" : "복귀",
      surfaces: [{ kind: "box", center: [0, 0.16, soleZ + 0.16], size: [0.32, 0.32, 0.32], label: "측정판" }],
    };
  },
  metrics: (ctx, frames) => {
    const b = ctx.body;
    const best = frames.reduce((a, f) => (Math.max(f.pose.j.fingL[2], f.pose.j.fingR[2]) > Math.max(a.pose.j.fingL[2], a.pose.j.fingR[2]) ? f : a));
    const sole = Math.max(best.pose.j.ankleL[2], best.pose.j.ankleR[2]) + b.ankleH[0];
    const reach = Math.max(best.pose.j.fingL[2], best.pose.j.fingR[2]) - sole;
    return [
      { id: "reach", label: "예상 기록 (발바닥 기준)", value: reach * 100, unit: "cm", digits: 1, better: "high", note: NOTE },
      { id: "tilt", label: "골반 전방 기울기", value: sitReachTilt(ctx), unit: "°", better: "high" },
      { id: "ratio", label: "(팔+몸통) − 다리 길이", value: (b.armLen + b.torso - b.legLen) * 100, unit: "cm", better: "high" },
    ];
  },
};

/* ───────────── 윗몸일으키기 ───────────── */

function situpEstimate(ctx: Ctx, frames?: SimFrame[]) {
  const b = ctx.body;
  // 누운 자세에서 상체(머리·흉곽·복부·팔) 무게중심의 고관절 기준 수평 거리 × 무게
  const m = b.mass;
  const upper = m.head + m.thorax + m.abdomen * 0.6 + 2 * (m.upperArm + m.forearm + m.hand);
  const lever = (b.torso * 0.55 + (b.H - b.legLen - b.torso) * 0.2) * 0.85;
  const tReq = upper * G * lever;
  const cap = 1.15 * b.M * b.H * (0.45 + b.capacity.power / 100) * (b.sex === "f" ? 0.75 : 1);
  const ratio = tReq / cap;
  const cycle = 0.72 + 1.6 * ratio * ratio;
  void frames;
  return { tReq, cap, ratio, perMin: clamp(Math.round(60 / cycle), 5, 90), cycle };
}

const situp: Movement = {
  id: "sit-up",
  name: "윗몸일으키기",
  en: "Sit-up (1 min)",
  category: "exam",
  group: "체대입시",
  summary: "무릎을 세우고 누워 양팔을 가슴에 교차한 채 상체를 일으킵니다. 몸통이 길수록 들어 올리는 모멘트가 커져 같은 근력에서 횟수가 줄어듭니다.",
  cues: ["발은 고정", "팔꿈치가 무릎에 닿게", "등이 바닥에 닿아야 1회"],
  load: null,
  kind: "static",
  support: "floor",
  view: { yaw: 90 },
  timeline: (ctx) => [
    [0, 0],
    [1, situpEstimate(ctx).cycle],
  ],
  frame: (ctx, t) => {
    const b = ctx.body;
    const H = b.H;
    const e = 78 * Math.sin(Math.PI * clamp(t, 0, 1)) ** 1.4;
    const pelvisElev = Math.max(0, e - 32) * 0.9;
    const curl = e - pelvisElev;
    const neckPull = ((100 - b.capacity.control) / 100) * 22;
    const legL = b.thigh[0];
    const q = {
      Py: 0.055 * H,
      Pz: 0,
      tau: 0,
      lumbar: curl * 0.45,
      thorax: curl * 0.55,
      neck: 18 + neckPull * Math.sin(Math.PI * t),
      base: Rx(-(90 - pelvisElev)),
      feet: [
        { x: b.hipW / 2 + 0.03, z: legL * 0.72 + 0.12, yaw: 4 },
        { x: -(b.hipW / 2 + 0.03), z: legL * 0.72 + 0.12, yaw: 4 },
      ] as [FootPlace, FootPlace],
    };
    const arms: [ArmSpec, ArmSpec] = [
      { sh: { flex: 95, abd: -38 }, elbow: 135 },
      { sh: { flex: 95, abd: -38 }, elbow: 135 },
    ];
    const spec = standSpec({ ...q, arms });
    const pose = buildPose(b, spec);
    return {
      spec,
      pose,
      contacts: [{ id: "back", group: "body", pts: [] }],
      meta: { neckFlex: neckPull },
      phase: t < 0.5 ? "올라오기" : "내려가기",
    };
  },
  metrics: (ctx) => {
    const s = situpEstimate(ctx);
    return [
      { id: "reps", label: "1분 예상 횟수", value: s.perMin, unit: "회", digits: 0, better: "high", note: NOTE },
      { id: "tReq", label: "시작 순간 필요한 고관절 굴곡 모멘트", value: s.tReq, unit: "N·m", better: "low" },
      { id: "ratio", label: "근력 대비 부담", value: s.ratio * 100, unit: "%", better: "low" },
    ];
  },
};

/* ───────────── 메디신볼 던지기 (앉아서) ───────────── */

function medballV(ctx: Ctx) {
  const b = ctx.body;
  const p = b.capacity.power / 100;
  const m = Math.max(1, ctx.loadKg);
  const lever = b.armLen + 0.5 * b.torso;
  const backswing = clamp(b.mobility.shoulderFlex / 170, 0.6, 1.1);
  const bmi = b.M / (b.H * b.H);
  return (
    (6.9 + 4.2 * p) *
    Math.pow(lever / 0.92, 0.5) *
    Math.pow(2 / m, 0.16) *
    Math.pow(backswing, 0.5) *
    (b.sex === "f" ? 0.84 : 1) *
    clamp(Math.pow(bmi / 22, 0.15), 0.9, 1.08)
  );
}

/** 다리를 편 채 앉으면 햄스트링이 골반 앞 기울기를 막는다 → 남는 굴곡은 허리가 맡는다 */
function seatedHamstring(b: Ctx["body"], v: Record<string, number>, meta: SimFrame["meta"]) {
  const maxTilt = b.mobility.hamstring + 8 - 90;
  if (v.tilt > maxTilt) {
    const e = v.tilt - maxTilt;
    v.tilt = maxTilt;
    v.lumb = (v.lumb ?? 0) + e;
    meta.hamstringLimit = Math.max(meta.hamstringLimit ?? 0, e);
  }
  v.hipL = 90 + v.tilt;
  v.hipR = 90 + v.tilt;
}

const MB_REL = 0.52;
const MB_ANGLE = 40;

const medball: Movement = {
  id: "medicine-ball-throw",
  name: "메디신볼 던지기",
  en: "Seated Med-ball Throw",
  category: "exam",
  group: "체대입시",
  summary: "매트에 다리를 펴고 앉아 머리 뒤에서 양손으로 공을 앞으로 던집니다. 팔·몸통 길이(지레), 어깨 굴곡 가동범위, 파워가 비거리를 정합니다.",
  cues: ["몸통을 뒤로 젖혔다 앞으로", "팔을 끝까지 뻗어 릴리스", "40° 각도로"],
  load: { kind: "medball", default: 2, min: 2, max: 5, step: 1, label: "메디신볼" },
  kind: "dynamic",
  support: "seat",
  view: { yaw: 90, dist: 1.4 },
  timeline: () => [
    [0, 0],
    [MB_REL, 1.1],
    [1, 2.8],
  ],
  frame: (ctx, t) => {
    const b = ctx.body;
    const H = b.H;
    const keys: Key[] = [
      { t: 0, tilt: -4, lumb: 0, thor: 0, shL: 120, shR: 120, elL: 20, elR: 20, neck: 0 },
      { t: 0.3, tilt: -14, lumb: -6, thor: -8, shL: 186, shR: 186, elL: 70, elR: 70, neck: -15 },
      { t: MB_REL, tilt: 6, lumb: 6, thor: 8, shL: 135, shR: 135, elL: 4, elR: 4, neck: 0 },
      { t: 0.7, tilt: 14, lumb: 10, thor: 12, shL: 95, shR: 95, elL: 6, elR: 6, neck: 6 },
      { t: 1, tilt: 4, lumb: 4, thor: 4, shL: 60, shR: 60, elL: 15, elR: 15, neck: 0 },
    ];
    const v = sampleKeys(keys, t);
    const meta = {} as SimFrame["meta"];
    seatedHamstring(b, v, meta);
    applyLimits(b, v, meta);
    v.py = (0.055 * H) / b.legLen;
    v.kneeL = v.kneeR = 0;
    v.ankL = v.ankR = -10;
    v.sabL = v.sabR = 12;
    const spec = angleSpec(b, v);
    const pose = buildPose(b, spec);
    const r = 0.1;
    let load: LoadState;
    const grip = lerpV(pose.j.gripL, pose.j.gripR, 0.5);
    const ball = (p: typeof pose): Vec3 => {
      const g = lerpV(p.j.gripL, p.j.gripR, 0.5);
      const f = lerpV(p.j.wrL, p.j.wrR, 0.5);
      return lerpV(f, g, 1.6);
    };
    if (t <= MB_REL) load = { kind: "medball", mass: ctx.loadKg, center: ball(pose), carried: true };
    else {
      let rel = ctx.cache.mbRel as Vec3 | undefined;
      if (!rel) {
        const vr = sampleKeys(keys, MB_REL);
        seatedHamstring(b, vr, {});
        applyLimits(b, vr, {});
        vr.py = (0.055 * H) / b.legLen;
        vr.sabL = vr.sabR = 12;
        rel = ball(buildPose(b, angleSpec(b, vr)));
        ctx.cache.mbRel = rel;
      }
      const vel = medballV(ctx);
      const a = (MB_ANGLE * Math.PI) / 180;
      const dt = (t - MB_REL) * ((2.8 - 1.1) / (1 - MB_REL));
      load = { kind: "medball", mass: ctx.loadKg, center: ballAt(rel, [0, vel * Math.sin(a), vel * Math.cos(a)], dt, r), carried: false, released: true };
    }
    void grip;
    return {
      spec,
      pose,
      load,
      contacts: [seatContact()],
      meta,
      phase: t < 0.3 ? "뒤로 젖히기" : t < MB_REL ? "던지기" : t < 0.7 ? "릴리스" : "공 비행",
    };
  },
  metrics: (ctx) => {
    const v = medballV(ctx);
    const rel = (ctx.cache.mbRel as Vec3 | undefined) ?? [0, 1.1, 0.3];
    const d = projectileRange(v, MB_ANGLE, rel[1]) + rel[2];
    return [
      { id: "dist", label: "예상 기록", value: d, unit: "m", digits: 2, better: "high", note: NOTE },
      { id: "v", label: "릴리스 속도", value: v, unit: "m/s", digits: 2, better: "high" },
      { id: "h", label: "릴리스 높이", value: rel[1] * 100, unit: "cm", better: "high" },
      { id: "lever", label: "지레 길이 (팔 + 몸통/2)", value: (ctx.body.armLen + 0.5 * ctx.body.torso) * 100, unit: "cm", better: "high" },
    ];
  },
};

/* ───────────── 배근력 ───────────── */

function backStrength(ctx: Ctx) {
  const key = "backStrength";
  if (ctx.cache[key]) return ctx.cache[key] as { kg: number; d: number; tBody: number; cap: number };
  const b = ctx.body;
  const f = backFrame(ctx, 0.5, 0);
  const j = f.pose.j;
  const hands = lerpV(j.gripL, j.gripR, 0.5);
  const d = Math.max(0.12, Math.abs(hands[2] - j.l5[2]));
  const m = b.mass;
  const upperM = m.head + m.thorax + m.abdomen * 0.5 + 2 * (m.upperArm + m.forearm + m.hand);
  const c = bodyCom(b, f.pose);
  const tBody = upperM * G * Math.max(0, lerp(c[2], j.c7[2], 0.4) - j.l5[2]);
  // 근력은 체중의 2/3 제곱에 비례 (상대 근력 감소)
  const cap = 3.3 * Math.pow(b.M, 0.67) * Math.pow(70, 0.33) * b.H * (0.55 + b.capacity.power / 100) * (b.sex === "f" ? 0.62 : 1);
  const kg = Math.max(0, (cap - tBody) / d / G);
  const v = { kg, d, tBody, cap };
  ctx.cache[key] = v;
  return v;
}

function backFrame(ctx: Ctx, t: number, pullKg: number) {
  const b = ctx.body;
  const feet: [FootPlace, FootPlace] = [
    { x: b.hipW / 2 + 0.02, z: 0, yaw: 8 },
    { x: -(b.hipW / 2 + 0.02), z: 0, yaw: 8 },
  ];
  const ramp = smooth(clamp(t / 0.3, 0, 1)) * (t > 0.85 ? 1 - smooth((t - 0.85) / 0.15) : 1);
  const tau = 22 - 2 * ramp;
  const build = (Pz: number) => {
    const Py = maxPelvisY(b, { Pz, feet });
    const q = { Py, Pz, tau, lumbar: 6, thorax: 4, neck: -12, feet };
    const p1 = buildPose(b, standSpec({ ...q, arms: [{ sh: {}, elbow: 0 }, { sh: {}, elbow: 0 }] }));
    const reach = (b.upperArm + b.forearm + b.hand * 0.45) * 0.995;
    const sm = lerpV(p1.j.shL, p1.j.shR, 0.5);
    const arms: [ArmSpec, ArmSpec] = [
      { ik: [0.12, sm[1] - reach, sm[2] + 0.01], pole: [0, 0, -1] },
      { ik: [-0.12, sm[1] - reach, sm[2] + 0.01], pole: [0, 0, -1] },
    ];
    const spec = standSpec({ ...q, arms });
    const pose = buildPose(b, spec);
    const load: LoadState | undefined = pullKg > 0 ? { kind: "plate", mass: pullKg * ramp, center: lerpV(pose.j.gripL, pose.j.gripR, 0.5), carried: true } : undefined;
    return { spec, pose, load };
  };
  // 무게중심을 발 중앙 위로
  let lo = -0.3,
    hi = 0.2;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    const s = build(mid);
    if (systemCom(b, s.pose, s.load)[2] > 0) hi = mid;
    else lo = mid;
  }
  const s = build((lo + hi) / 2);
  return { ...s, ramp };
}

const backDyn: Movement = {
  id: "back-strength",
  name: "배근력",
  en: "Back Dynamometer",
  category: "exam",
  group: "체대입시",
  summary: "무릎을 편 채 상체를 30° 정도 숙이고 배근력계 손잡이를 최대로 당깁니다. 손잡이까지의 수평 거리(팔·몸통 길이)가 길수록 같은 허리 근력에서 기록이 낮아집니다.",
  cues: ["무릎은 끝까지 펴고", "등은 곧게, 상체 30°", "2~3초에 걸쳐 최대로"],
  load: null,
  kind: "static",
  support: "feet",
  view: { yaw: 80 },
  timeline: () => [
    [0, 0],
    [1, 4],
  ],
  frame: (ctx, t) => {
    const est = backStrength(ctx);
    const s = backFrame(ctx, t, est.kg);
    const ext = ((100 - ctx.body.capacity.control) / 100) * 8 * s.ramp;
    return {
      spec: s.spec,
      pose: s.pose,
      load: s.load,
      contacts: (["L", "R"] as const).map((k) => ({ id: k, group: "feet" as const, pts: footPts(s.pose, k), axis: [s.pose.j[`heel${k}`], s.pose.j[`toe${k}`]] as [Vec3, Vec3] })),
      meta: { lumbarFlex: ext },
      phase: t < 0.3 ? "힘 올리기" : t < 0.85 ? "최대 당기기" : "풀기",
      surfaces: [{ kind: "platform", center: [0, -0.01, 0.05], size: [0.5, 0.02, 0.45], label: "배근력계" }],
    };
  },
  metrics: (ctx, frames) => {
    const e = backStrength(ctx);
    return [
      { id: "kg", label: "예상 기록", value: e.kg, unit: "kg", digits: 0, better: "high", note: NOTE },
      { id: "perBw", label: "체중 대비", value: e.kg / ctx.body.M, unit: "배", digits: 2, better: "high" },
      { id: "d", label: "요추 ~ 손잡이 수평 거리", value: e.d * 100, unit: "cm", better: "low" },
      { id: "lumbarM", label: "요추 신전 모멘트(최대)", value: maxOf(frames, (f) => f.moments.lumbar), unit: "N·m" },
    ];
  },
};

function footPts(pose: ReturnType<typeof buildPose>, k: "L" | "R"): Vec3[] {
  const j = pose.j;
  return [
    [j[`heel${k}`][0] + 0.04, 0, j[`heel${k}`][2]],
    [j[`heel${k}`][0] - 0.04, 0, j[`heel${k}`][2]],
    [j[`toe${k}`][0] - 0.045, 0, j[`toe${k}`][2]],
    [j[`toe${k}`][0] + 0.045, 0, j[`toe${k}`][2]],
  ];
}

/* ───────────── 10m 왕복달리기 ───────────── */

interface StepKey {
  t: number;
  x: number;
  z: number;
  lift: number;
  yaw: number;
}
function track(keys: StepKey[], t: number): FootPlace {
  const v = sampleKeys(keys as unknown as Key[], t, false);
  return { x: v.x, z: v.z, y: Math.max(0, v.lift), yaw: v.yaw, heelRise: v.lift > 0.004 ? 25 : 0 };
}

function shuttleEstimate(ctx: Ctx) {
  const b = ctx.body;
  const p = b.capacity.power / 100;
  const bmi = b.M / (b.H * b.H);
  const a = (5 + 4 * p) * (b.sex === "f" ? 0.88 : 1) * clamp(Math.pow(22.5 / bmi, 0.5), 0.7, 1.05);
  const vmax = sprintEstimate(ctx, false).v;
  const seg = 10 >= (vmax * vmax) / a ? 10 / vmax + vmax / a : 2 * Math.sqrt(10 / a);
  const comH = 0.55 * b.H;
  const turn = 0.22 + 0.12 * (comH / 0.96) + ((100 - b.capacity.control) / 100) * 0.18;
  return { total: 4 * seg + 3 * turn, seg, turn, a };
}

const shuttle: Movement = {
  id: "shuttle-run-10m",
  name: "10m 왕복달리기",
  en: "10 m Shuttle Run",
  category: "exam",
  group: "체대입시",
  summary: "10m 거리를 왕복하며 방향을 바꿉니다. 화면은 반환점에서의 감속·플랜트·180° 회전을 보여 주고, 기록은 가속도·최고속도·회전 손실로 추정합니다.",
  cues: ["반환 2~3걸음 전부터 감속", "무게중심을 낮추고 바깥발로 플랜트", "몸통이 먼저 돌아서기"],
  load: null,
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: false, lockFeet: false, ballistic: true },
  view: { yaw: 70, followZ: true },
  timeline: () => [
    [0, 0],
    [1, 1.25],
  ],
  frame: (ctx, t) => {
    const b = ctx.body;
    const s = b.legLen / 0.93;
    const W = b.hipW / 2;
    const L: StepKey[] = [
      { t: 0, x: W, z: 0.2 * s, lift: 0.1, yaw: 0 },
      { t: 0.18, x: W, z: 1.2 * s, lift: 0.03, yaw: 0 },
      { t: 0.22, x: W, z: 1.25 * s, lift: 0, yaw: 0 },
      { t: 0.38, x: W, z: 1.25 * s, lift: 0, yaw: 20 },
      { t: 0.46, x: 0.2 * s, z: 1.55 * s, lift: 0.08, yaw: 90 },
      { t: 0.5, x: 0.18 * s, z: 1.6 * s, lift: 0, yaw: 90 },
      { t: 0.7, x: 0.18 * s, z: 1.6 * s, lift: 0, yaw: 120 },
      { t: 0.82, x: 0.05 * s, z: 1.2 * s, lift: 0.12, yaw: 180 },
      { t: 0.88, x: 0.05 * s, z: 1.05 * s, lift: 0, yaw: 180 },
      { t: 1, x: 0.05 * s, z: 1.05 * s, lift: 0, yaw: 180 },
    ];
    const R: StepKey[] = [
      { t: 0, x: -W, z: 0.6 * s, lift: 0, yaw: 0 },
      { t: 0.08, x: -W, z: 0.6 * s, lift: 0, yaw: 0 },
      { t: 0.28, x: -W - 0.05, z: 1.6 * s, lift: 0.14, yaw: 40 },
      { t: 0.4, x: -0.15 * s, z: 2.02 * s, lift: 0.03, yaw: 90 },
      { t: 0.43, x: -0.16 * s, z: 2.05 * s, lift: 0, yaw: 90 },
      { t: 0.66, x: -0.16 * s, z: 2.05 * s, lift: 0, yaw: 110 },
      { t: 0.74, x: -0.12 * s, z: 1.85 * s, lift: 0.1, yaw: 180 },
      { t: 1, x: -0.1 * s, z: 0.55 * s, lift: 0.12, yaw: 180 },
    ];
    const opts: PlantOpts = {
      keys: [
        { t: 0, px: 0, pz: 0.45 * s, drop: 0.04, yaw: 0, tilt: 12, lean: 6, shL: 30, shR: -30, elL: 85, elR: 85 },
        { t: 0.22, px: 0, pz: 1.05 * s, drop: 0.07, yaw: 0, tilt: 14, lean: -12, shL: -25, shR: 35 },
        { t: 0.43, px: 0, pz: 1.62 * s, drop: 0.18, yaw: 80, tilt: 34, lean: -6, shL: 20, shR: 60 },
        { t: 0.58, px: 0, pz: 1.72 * s, drop: 0.16, yaw: 130, tilt: 32, lean: 6, shL: 50, shR: 0 },
        { t: 0.72, px: 0, pz: 1.55 * s, drop: 0.08, yaw: 175, tilt: 18, lean: -24, shL: -30, shR: 40 },
        { t: 1, px: 0, pz: 0.85 * s, drop: 0.05, yaw: 180, tilt: 12, lean: -18, shL: 35, shR: -30 },
      ],
      cyclic: false,
      phase: (tt) => (tt < 0.22 ? "접근" : tt < 0.43 ? "감속" : tt < 0.66 ? "플랜트·회전" : "재가속"),
      feet: () => [track(L, t), track(R, t)],
      stanceComp: 0.9,
      surfaces: () => [{ kind: "line", center: [0, 0.002, 2.05 * s + 0.15], size: [2.2, 0.004, 0.05], label: "반환선" }],
    };
    return plantFrame(ctx, opts, t);
  },
  metrics: (ctx, frames) => {
    const e = shuttleEstimate(ctx);
    return [
      { id: "time", label: "예상 기록 (10m × 4)", value: e.total, unit: "초", digits: 2, better: "low", note: NOTE },
      { id: "turn", label: "회전 1회 손실", value: e.turn, unit: "초", digits: 2, better: "low" },
      { id: "comLow", label: "회전 시 최저 무게중심", value: minOf(frames, (f) => f.com[1]) * 100, unit: "cm", better: "low" },
      { id: "grf", label: "플랜트 최대 지면반력", value: maxOf(frames, (f) => f.grf) / (ctx.body.M * G), unit: "×체중", digits: 2 },
    ];
  },
};

/* ───────────── 사이드스텝 (반복옆뛰기) ───────────── */

function sideStepCfg(ctx: Ctx) {
  const b = ctx.body;
  const w = 0.72 * b.legLen;
  const A = Math.max(0.2, 1.0 - w / 2);
  const p = b.capacity.power / 100;
  const comH = 0.55 * b.H;
  const half = (0.95 - 0.3 * p) * Math.pow(comH / 0.96, 0.4) * (b.sex === "f" ? 1.08 : 1) * (1 + ((100 - b.capacity.control) / 100) * 0.12);
  return { w, A, half };
}

const sideStep: Movement = {
  id: "side-step",
  name: "사이드스텝 (반복옆뛰기)",
  en: "Side Step Test",
  category: "exam",
  group: "체대입시",
  summary: "중앙선을 기준으로 좌우 1m 선을 옆걸음으로 넘나듭니다. 낮은 자세 유지, 바깥발 밀기, 골반 높이 변화를 봅니다.",
  cues: ["무게중심을 낮게 유지", "다리를 교차하지 않기", "바깥발로 바닥 밀기"],
  load: null,
  kind: "dynamic",
  support: "feet",
  dynamics: { cyclic: true, lockFeet: false, ballistic: true },
  view: { yaw: 0 },
  timeline: (ctx) => [
    [0, 0],
    [1, 2 * sideStepCfg(ctx).half],
  ],
  frame: (ctx, t) => {
    const { w, A } = sideStepCfg(ctx);
    const tt = ((t % 1) + 1) % 1;
    // 반 주기: 오른쪽(-X)으로 두 번 셔플 / 나머지 반: 왼쪽으로
    const half = tt < 0.5 ? 0 : 1;
    const u = (tt % 0.5) / 0.5;
    const dir = half === 0 ? -1 : 1;
    const start = -dir * A;
    const step = (2 * A) / 2;
    const lead = half === 0 ? "R" : "L";
    const pos = (k: number) => start + dir * step * k;
    // 리드발: 0.05~0.2 / 0.45~0.6, 따라오는 발: 0.2~0.33 / 0.6~0.73
    const seg = (a: number, b2: number) => smooth(clamp((u - a) / (b2 - a), 0, 1));
    const leadK = seg(0.04, 0.2) + seg(0.42, 0.58);
    const trailK = seg(0.2, 0.34) + seg(0.58, 0.72);
    const lift = (a: number, b2: number) => (u > a && u < b2 ? 0.05 * Math.sin((Math.PI * (u - a)) / (b2 - a)) : 0);
    const leadLift = lift(0.04, 0.2) + lift(0.42, 0.58);
    const trailLift = lift(0.2, 0.34) + lift(0.58, 0.72);
    const leadX = pos(leadK) + dir * w / 2;
    const trailX = pos(trailK) - dir * w / 2;
    const feetX = lead === "L" ? [leadX, trailX] : [trailX, leadX];
    const feetY = lead === "L" ? [leadLift, trailLift] : [trailLift, leadLift];
    const px = (leadX + trailX) / 2;
    const opts: PlantOpts = {
      keys: [{ t: 0, drop: 0.13, tilt: 26, lumb: 0, neck: -18, shL: 25, shR: 25, sabL: 25, sabR: 25, elL: 80, elR: 80 }],
      cyclic: true,
      phase: () => (u < 0.2 || (u > 0.42 && u < 0.58) ? (dir < 0 ? "오른발 내딛기" : "왼발 내딛기") : u < 0.34 || (u > 0.58 && u < 0.72) ? "따라 붙기" : "선 밟기"),
      feet: () => [
        { x: feetX[0], z: 0, y: feetY[0], yaw: 6 },
        { x: feetX[1], z: 0, y: feetY[1], yaw: 6 },
      ],
      tweak: (_c, v) => {
        v.px = px;
        v.pz = -0.04;
      },
      stanceComp: 0.8,
      surfaces: () => [
        { kind: "line", center: [1.0, 0.002, 0], size: [0.05, 0.004, 1.2] },
        { kind: "line", center: [0, 0.002, 0], size: [0.05, 0.004, 1.2] },
        { kind: "line", center: [-1.0, 0.002, 0], size: [0.05, 0.004, 1.2] },
      ],
    };
    return plantFrame(ctx, opts, t);
  },
  metrics: (ctx, frames) => {
    const c = sideStepCfg(ctx);
    const count = Math.round((20 / c.half) * 2);
    return [
      { id: "count", label: "20초 예상 횟수", value: count, unit: "회", digits: 0, better: "high", note: NOTE },
      { id: "half", label: "한쪽 이동 시간", value: c.half, unit: "초", digits: 2, better: "low" },
      { id: "comVar", label: "무게중심 높이 변화", value: (maxOf(frames, (f) => f.com[1]) - minOf(frames, (f) => f.com[1])) * 100, unit: "cm", better: "low" },
      { id: "stance", label: "스탠스 너비", value: c.w * 100, unit: "cm" },
    ];
  },
};

export const EXAM: Movement[] = [
  standingLongJump,
  cmjMove("sargent-jump", "서전트 점프", "Sargent Jump", "exam", true),
  medball,
  sitReach,
  situp,
  shuttle,
  sideStep,
  backDyn,
];

export type { Metric };
