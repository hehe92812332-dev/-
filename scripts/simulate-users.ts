/**
 * 동작 보상 시뮬레이터 — 가상 사용자 100만 명 사용 시뮬레이션
 *
 *   npx tsx scripts/simulate-users.ts [사용자 수=1000000] [워커 수=CPU]
 *
 * 체대입시 수험생·일반 헬스인·선수·재활/초보 4개 집단의 체형·가동성·근력 분포로
 * 가상 사용자를 만들고, 각자가 고르는 동작과 무게로 시뮬레이터를 돌려
 *  1) 오류: 예외, NaN, 관절 길이 변형, 발이 바닥을 뚫음/뜸, 다리가 닿지 않음, 프레임 튐
 *  2) 불만: 표준 체형인데 위험 경고, 정상 입력이 자동 수정됨, 비현실적 기록,
 *           체형을 바꿨는데 결과가 반대로 움직임, 계산이 느림
 * 을 집계한다. 결과는 docs/simulator-report.json 에 쓴다.
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Persona = "exam" | "gym" | "athlete" | "rehab";

/* ───────────── 난수 ───────────── */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
function normal(r: () => number, mu: number, sd: number) {
  const u = Math.max(1e-12, r()),
    v = r();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const pick = <T,>(r: () => number, xs: T[], w?: number[]) => {
  if (!w) return xs[Math.floor(r() * xs.length)];
  const s = w.reduce((a, b) => a + b, 0);
  let x = r() * s;
  for (let i = 0; i < xs.length; i++) if ((x -= w[i]) <= 0) return xs[i];
  return xs[xs.length - 1];
};

/* ───────────── 워커 ───────────── */
async function workerMain() {
  const { from, to, seed } = workerData as { from: number; to: number; seed: number };
  const { simulate } = await import("../src/lib/biomech/simulate");
  const { measureRom, romViolations } = await import("../src/lib/biomech/rom");
  const { MOVEMENTS } = await import("../src/lib/biomech/moves");
  const { standardBody, defaultMobility, defaultCapacity, LIMITS } = await import("../src/lib/biomech/anthropometry");
  const ids = { gym: MOVEMENTS.filter((m) => m.category === "gym"), sport: MOVEMENTS.filter((m) => m.category === "sport"), exam: MOVEMENTS.filter((m) => m.category === "exam") };

  const stats: Record<string, number> = {};
  const byMove: Record<string, Record<string, number>> = {};
  const examples: Record<string, unknown[]> = {};
  const metricDist: Record<string, number[]> = {};
  const timing: number[] = [];
  const bump = (k: string, moveId: string, ex?: unknown) => {
    stats[k] = (stats[k] ?? 0) + 1;
    byMove[moveId] ??= {};
    byMove[moveId][k] = (byMove[moveId][k] ?? 0) + 1;
    if (ex !== undefined) {
      examples[k] ??= [];
      if (examples[k].length < 4) examples[k].push(ex);
    }
  };

  const PLAUSIBLE: Record<string, [number, number]> = {
    "standing-long-jump:dist": [90, 360],
    "sargent-jump:sargent": [12, 105],
    "cmj:height": [8, 85],
    "medicine-ball-throw:dist": [3, 19],
    "sit-and-reach:reach": [-35, 42],
    "sit-up:reps": [5, 85],
    "shuttle-run-10m:time": [7.5, 16],
    "side-step:count": [20, 75],
    "back-strength:kg": [25, 320],
    "sprint-max:speed": [3, 11.8],
    "sprint-max:t100": [9.6, 40],
    "rotational-throw:dist": [2, 22],
    "pull-up:reps": [0, 40],
    "drop-landing:grf": [1.5, 9],
  };

  for (let u = from; u < to; u++) {
    const r = rng(seed + u * 7919);
    const persona: Persona = pick(r, ["exam", "gym", "athlete", "rehab"] as Persona[], [30, 45, 15, 10]);
    const sex = r() < (persona === "gym" ? 0.58 : persona === "exam" ? 0.62 : 0.6) ? "m" : "f";
    const H = normal(r, sex === "m" ? 173.5 : 161, sex === "m" ? 6 : 5.5);
    // 생리적으로 가능한 범위 안에서 생성 (BMI 15~45)
    const bmi = Math.min(45, Math.max(15, normal(r, sex === "m" ? (persona === "athlete" ? 23.5 : 24) : 21.5, persona === "rehab" ? 3.8 : 2.8)));
    const std = standardBody(Math.round(H * 2) / 2, sex);
    const k = (sd: number) => 1 + normal(r, 0, sd);
    const body: Record<string, number | string> = {
      sex,
      heightCm: Math.round(H * 2) / 2,
      weightKg: Math.round(bmi * (H / 100) ** 2 * 2) / 2,
      footMm: Math.round((std.footMm * k(0.04)) / 5) * 5,
      thighCm: Math.round(std.thighCm * k(0.04) * 2) / 2,
      shankCm: Math.round(std.shankCm * k(0.04) * 2) / 2,
      upperArmCm: Math.round(std.upperArmCm * k(0.04) * 2) / 2,
      forearmCm: Math.round(std.forearmCm * k(0.04) * 2) / 2,
      handCm: Math.round(std.handCm * k(0.04) * 2) / 2,
      torsoCm: Math.round(std.torsoCm * k(0.04) * 2) / 2,
      shoulderCm: Math.round(std.shoulderCm * k(0.05) * 2) / 2,
      hipCm: Math.round(std.hipCm * k(0.06) * 2) / 2,
      legDiffCm: r() < 0.25 ? Math.round(normal(r, 0, 0.7) * 10) / 10 : 0,
    };
    // 측정·입력 실수 2.5%
    let mistake = "";
    if (r() < 0.025) {
      mistake = pick(r, ["inch", "footCm", "span", "lbs", "swapKnee", "nan", "negative", "zero", "inseam"]);
      if (mistake === "inch") body.heightCm = Math.round((body.heightCm as number) / 2.54);
      if (mistake === "footCm") body.footMm = Math.round((body.footMm as number) / 10);
      if (mistake === "span") body.upperArmCm = Math.round((body.heightCm as number) * 0.45); // 팔 전체를 위팔 칸에
      if (mistake === "lbs") body.weightKg = Math.round((body.weightKg as number) * 2.2);
      if (mistake === "swapKnee") body.thighCm = Math.round((body.heightCm as number) * 0.53); // 넙다리 칸에 다리 전체
      if (mistake === "nan") body.torsoCm = Number.NaN;
      if (mistake === "negative") body.legDiffCm = -12;
      if (mistake === "zero") body.footMm = 0;
      if (mistake === "inseam") body.forearmCm = (body.forearmCm as number) + (body.handCm as number); // 아래팔에 손까지 포함
    }
    const dm = defaultMobility();
    const mobSd = persona === "rehab" ? 1.4 : persona === "athlete" ? 0.8 : 1;
    const mobShift = persona === "rehab" ? -8 : persona === "athlete" ? 4 : persona === "exam" ? 3 : 0;
    // 측정 가능한 생리적 범위로 자른다 (발목 5~55, 고관절 80~145, 하지직거상 30~125, 어깨 100~190, 흉추 10~75)
    const cl = (x: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, x)));
    const mobility = {
      ankleDF: cl(normal(r, dm.ankleDF + mobShift, 7 * mobSd), 5, 55),
      hipFlex: cl(normal(r, dm.hipFlex + mobShift * 0.6, 8 * mobSd), 80, 145),
      hamstring: cl(normal(r, dm.hamstring + mobShift * 1.5, 11 * mobSd), 30, 125),
      shoulderFlex: cl(normal(r, dm.shoulderFlex + mobShift * 0.6, 10 * mobSd), 100, 190),
      thoracicRot: cl(normal(r, dm.thoracicRot, 8 * mobSd), 10, 75),
    };
    const pw = { exam: [66, 14], gym: [45, 18], athlete: [76, 12], rehab: [24, 12] }[persona];
    const ct = { exam: [60, 15], gym: [56, 17], athlete: [70, 12], rehab: [40, 15] }[persona];
    const capacity = {
      power: Math.round(Math.min(100, Math.max(0, normal(r, pw[0], pw[1])))),
      control: Math.round(Math.min(100, Math.max(0, normal(r, ct[0], ct[1])))),
      asym: Math.round(normal(r, 0, persona === "rehab" ? 10 : 6)),
    };
    const pool =
      persona === "exam"
        ? pick(r, [ids.exam, ids.gym, ids.sport], [70, 20, 10])
        : persona === "gym"
          ? pick(r, [ids.gym, ids.sport, ids.exam], [82, 13, 5])
          : persona === "athlete"
            ? pick(r, [ids.sport, ids.gym, ids.exam], [55, 35, 10])
            : pick(r, [ids.gym, ids.sport], [85, 15]);
    const m = pick(r, pool);
    let loadKg: number | undefined;
    if (m.load) {
      const style = r();
      const bw = Number(body.weightKg) || 70;
      if (style < 0.05) loadKg = m.load.max;
      else if (style < 0.1) loadKg = m.load.min;
      else if (m.load.kind === "barbell") loadKg = Math.round((bw * (0.3 + r() * 1.2) * (0.5 + capacity.power / 100)) / 2.5) * 2.5;
      else loadKg = m.load.default * (0.5 + r());
    }
    const profile = { body, mobility, capacity } as never;
    const isStd = !mistake && (["thighCm", "shankCm", "upperArmCm", "forearmCm", "torsoCm"] as const).every((k) => Math.abs((body[k] as number) / std[k] - 1) < 0.02);
    const withRef = u % 20 === 0;
    let res;
    const t0 = performance.now();
    try {
      res = simulate(profile, m.id, { loadKg, frames: 12, reference: withRef });
    } catch (e) {
      bump("오류:예외", m.id, { msg: (e as Error).message, stack: (e as Error).stack?.split("\n").slice(0, 3).join(" | "), body, mobility, capacity, loadKg });
      continue;
    }
    const ms = performance.now() - t0;
    if (u % 50 === 0) timing.push(ms * (withRef ? 0.5 : 1) * (72 / 12));
    stats["실행"] = (stats["실행"] ?? 0) + 1;
    byMove[m.id] ??= {};
    byMove[m.id]["실행"] = (byMove[m.id]["실행"] ?? 0) + 1;
    const ex = { persona, body, mobility, capacity, loadKg: res.loadKg, mistake };

    // ── 오류 검사 ──
    const b = res.frames;
    let nan = false,
      pen = 0,
      floatF = 0,
      over = 0,
      lenErr = 0,
      jump = 0;
    const bodyM = await bodyOf(res.profile);
    for (let i = 0; i < b.length; i++) {
      const f = b[i];
      for (const v of Object.values(f.pose.j)) if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) nan = true;
      if (!Number.isFinite(f.com[1]) || !Number.isFinite(f.grf)) nan = true;
      const j = f.pose.j;
      const gy = f.groundY ?? 0;
      const lows = (["L", "R"] as const).map((s) => Math.min(j[`heel${s}`][1], j[`ball${s}`][1], j[`toe${s}`][1]));
      const surfaceBelow = (f.surfaces ?? []).some((s) => s.kind === "bench" || s.kind === "box" || s.kind === "platform");
      const raised = surfaceBelow || gy > 0;
      if (!surfaceBelow) pen = Math.max(pen, -Math.min(...lows));
      if (!raised) for (const c of f.contacts) if ((c.id === "L" || c.id === "R") && m.support === "feet") floatF = Math.max(floatF, lows[c.id === "L" ? 0 : 1] - Math.max(gy, Math.min(...lows)));
      if (m.id !== "sit-and-reach") over = Math.max(over, f.pose.overreach.legL, f.pose.overreach.legR, m.support === "hang" || m.id === "bench-press" || m.id === "push-up" ? f.pose.overreach.armL : 0);
      for (const [s, si] of [["L", 0], ["R", 1]] as const) {
        const lt = dist(j[`hip${s}`], j[`knee${s}`]);
        const ls = dist(j[`knee${s}`], j[`ankle${s}`]);
        lenErr = Math.max(lenErr, Math.abs(lt - bodyM.thigh[si]) * (f.pose.overreach[`leg${s}`] > 0 ? 0 : 1), Math.abs(ls - bodyM.shank[si]));
      }
      if (i > 0) {
        const dt = Math.max(1e-3, f.time - b[i - 1].time);
        const dp = dist(f.pose.j.pelvis, b[i - 1].pose.j.pelvis);
        const lim = m.kind === "static" ? 2.5 : 14;
        if (dp / dt > lim && dp > 0.12) jump = Math.max(jump, dp);
      }
    }
    for (const mt of res.metrics) if (!Number.isFinite(mt.value)) nan = true;
    for (const x of res.injury) if (!Number.isFinite(x.score) || x.score < 0 || x.score > 100) nan = true;
    if (nan) bump("오류:NaN", m.id, ex);
    if (pen > 0.012) bump("오류:발이 바닥 관통", m.id, { ...ex, pen });
    if (floatF > 0.025) bump("오류:접지 발이 뜸", m.id, { ...ex, floatF });
    if (over > 0.01) bump("오류:팔다리가 닿지 않음", m.id, { ...ex, over });
    if (lenErr > 0.003) bump("오류:뼈 길이 변형", m.id, { ...ex, lenErr });
    if (jump > 0) bump("오류:프레임 튐", m.id, { ...ex, jump });
    if (res.solverWarnings.length) bump("오류:계산 경고", m.id, { ...ex, w: res.solverWarnings[0] });
    // 해부학적 정상 가동범위를 벗어난 관절 (1° 허용 오차)
    for (const f of b) {
      const vs = romViolations(measureRom(f.pose), 1);
      if (vs.length) {
        bump("오류:관절 가동범위 초과", m.id, { ...ex, rom: vs.map((x) => `${x.label}${x.side ?? ""} ${x.value.toFixed(0)}/${x.limit}`), t: f.t });
        break;
      }
    }
    // 정적 동작에서 무게중심이 지지면 밖인데 경고가 없음
    if (m.kind === "static" && m.support === "feet") {
      const outF = b.filter((f) => !f.support.inside && !f.meta.transient && f.support.margin < -0.01);
      if (outF.length && !res.findings.some((x) => x.id === "balance")) bump("오류:균형 이탈 미표시", m.id, ex);
    }
    // 하중 분포 합
    for (const f of b) {
      if (!f.loads.length) continue;
      const s = f.loads.reduce((a, l) => a + l.share, 0);
      if (Math.abs(s - 1) > 0.01) {
        bump("오류:하중 합 ≠ 100%", m.id, { ...ex, s });
        break;
      }
    }

    // ── 불만 검사 ──
    const risk = res.findings.filter((x) => x.level === "risk");
    const over1rm = res.findings.some((x) => x.id === "overload");
    if (!over1rm && isStd && mobility.ankleDF >= 32 && mobility.hamstring >= 70 && mobility.shoulderFlex >= 160 && mobility.hipFlex >= 115 && capacity.control >= 50 && risk.length)
      bump("불만:평범한 체형인데 위험 경고", m.id, { ...ex, risk: risk.map((x) => x.title) });
    const highInj = res.injury.filter((x) => x.level === "high");
    if (!over1rm && isStd && mobility.ankleDF >= 32 && mobility.hamstring >= 70 && mobility.shoulderFlex >= 160 && mobility.hipFlex >= 115 && capacity.control >= 50 && Math.abs(capacity.asym) < 10 && highInj.length)
      bump("불만:평범한 체형인데 부상 위험 '높음'", m.id, { ...ex, inj: highInj.map((x) => `${x.region}:${x.score} ${x.factors.map((f) => f.label).join("/")}`) });
    stats["부상위험:높음 부위가 있는 실행"] = (stats["부상위험:높음 부위가 있는 실행"] ?? 0) + (highInj.length ? 1 : 0);
    const adjusted = res.issues.filter((i) => !i.notice);
    if (!mistake && adjusted.length) bump("불만:정상 입력이 자동 수정됨", m.id, { ...ex, issues: adjusted.map((i) => i.message) });
    if (mistake && !res.issues.length && mistake !== "inseam") bump("불만:잘못된 입력을 못 잡음", m.id, ex);
    for (const mt of res.metrics) {
      const key = `${m.id}:${mt.id}`;
      const pr = PLAUSIBLE[key];
      if (!mistake) {
        metricDist[key] ??= [];
        if (metricDist[key].length < 4000) metricDist[key].push(mt.value);
      }
      if (pr && !mistake && (mt.value < pr[0] || mt.value > pr[1])) bump("불만:비현실적 기록", m.id, { ...ex, metric: mt.label, value: mt.value, persona });
    }
    const peakGrf = Math.max(...b.map((f) => f.grf)) / ((Number(res.profile.body.weightKg) || 70) * 9.81);
    if (m.kind === "dynamic" && peakGrf > 9) bump("불만:비현실적 지면반력", m.id, { ...ex, peakGrf });
    if (ms > 400) bump("불만:계산이 느림(>400ms/12프레임)", m.id, { ...ex, ms });

    // ── 민감도 (체형을 바꾸면 결과가 맞는 방향으로 움직이는가) ── 사용자 2%
    if (u % 50 === 7 && !mistake) {
      const pw = res.profile.capacity.power <= 85;
      const tests: [string, string, (p: Record<string, Record<string, number>>) => void, number][] = [
        ["high-bar-squat", "comp", (p) => ((p.body.thighCm *= 1.06), (p.body.shankCm *= 0.94)), +1],
        ["deadlift", "hipH", (p) => ((p.body.upperArmCm *= 1.07), (p.body.forearmCm *= 1.07)), +1],
        ["sit-and-reach", "reach", (p) => ((p.body.upperArmCm *= 1.06), (p.body.forearmCm *= 1.06)), +1],
        ["sit-and-reach", "reach", (p) => (p.mobility.hamstring -= 15), -1],
        ["standing-long-jump", "dist", (p) => (p.capacity.power += 15), +1],
        ["sargent-jump", "sargent", (p) => (p.body.weightKg *= 1.15), -1],
        ["medicine-ball-throw", "dist", (p) => (p.capacity.power += 15), +1],
        ["shuttle-run-10m", "time", (p) => (p.capacity.power += 15), -1],
        ["sit-up", "tReq", (p) => (p.body.torsoCm *= 1.06), +1],
        ["back-strength", "kg", (p) => (p.capacity.power += 15), +1],
        // 발목 가동성은 '자원': 줄이면 몸통·뒤꿈치·깊이 보상이 늘어야 한다 (발목을 다 안 쓰던 사람은 변화 없음이 정상)
        ["front-squat", "compNoDF", (p) => (p.mobility.ankleDF = Math.max(5, p.mobility.ankleDF - 12)), +1],
        ["pull-up", "reps", (p) => (p.body.weightKg *= 1.15), -1],
      ];
      const usable = tests.filter((x) => pw || !/power/.test(x[2].toString()));
      const [mid, metric, mod, sign] = usable[Math.floor(r() * usable.length)];
      // comp = 보상 지수: 최대 몸통 숙임 + 깊이 손실(%) + 뒤꿈치 들림 + 허리 말림 + 발목 배측굴곡
      const val = (x: ReturnType<typeof simulate>) =>
        metric === "comp" || metric === "compNoDF"
          ? Math.max(...x.frames.map((f) => f.angles.trunkLean)) +
            Math.max(...x.frames.map((f) => (f.meta.depthLoss ?? 0) * 100)) +
            Math.max(...x.frames.map((f) => Math.max(...(f.meta.heelRise ?? [0, 0])))) +
            Math.max(...x.frames.map((f) => f.meta.lumbarFlex ?? 0)) +
            (metric === "comp" ? Math.max(...x.frames.map((f) => Math.max(...f.angles.ankleDF))) : 0)
          : x.metrics.find((q) => q.id === metric)!.value;
      const base = JSON.parse(JSON.stringify(res.profile));
      const pert = JSON.parse(JSON.stringify(res.profile));
      mod(pert);
      try {
        const a = val(simulate(base, mid, { frames: 24, reference: false }));
        const c = val(simulate(pert, mid, { frames: 24, reference: false }));
        stats["민감도 검사"] = (stats["민감도 검사"] ?? 0) + 1;
        if ((c - a) * sign < -1e-6) bump("불만:체형을 바꾸니 결과가 반대로 움직임", mid, { mid, metric, a, c, body: base.body, mobility: base.mobility, capacity: base.capacity });
        const ankleSlack = mid === "front-squat" && base.mobility.ankleDF - 12 >= 36;
        if (Math.abs(c - a) < 1e-6 && (ankleSlack || (metric === "reps" && (a <= 3 || a >= 40)))) stats["민감도:변화 없음이 정상"] = (stats["민감도:변화 없음이 정상"] ?? 0) + 1;
        else if (Math.abs(c - a) < 1e-6) bump("불만:체형을 바꿔도 결과가 그대로", mid, { mid, metric, a, c, body: base.body, mobility: base.mobility, capacity: base.capacity });
      } catch (e) {
        bump("오류:예외", mid, { msg: (e as Error).message });
      }
    }
    if ((u - from) % 20000 === 0 && u > from) parentPort!.postMessage({ progress: u - from });
  }
  parentPort!.postMessage({ done: true, stats, byMove, examples, metricDist, timing });
}

const bodyCache = new Map<string, { thigh: number[]; shank: number[] }>();
async function bodyOf(p: unknown) {
  const key = JSON.stringify(p);
  const c = bodyCache.get(key);
  if (c) return c;
  const { buildBody } = await import("../src/lib/biomech/anthropometry");
  const b = buildBody(p as never);
  const v = { thigh: b.thigh, shank: b.shank };
  if (bodyCache.size > 1000) bodyCache.clear();
  bodyCache.set(key, v);
  return v;
}
function dist(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* ───────────── 메인 ───────────── */
async function main() {
  const N = Number(process.argv[2] ?? 1_000_000);
  const W = Number(process.argv[3] ?? os.cpus().length);
  const seed = Number(process.env.SEED ?? 20261120);
  const file = fileURLToPath(import.meta.url);
  const t0 = Date.now();
  const per = Math.ceil(N / W);
  let progress = 0;
  const results = await Promise.all(
    [...Array(W).keys()].map(
      (w) =>
        new Promise<{ stats: Record<string, number>; byMove: Record<string, Record<string, number>>; examples: Record<string, unknown[]>; metricDist: Record<string, number[]>; timing: number[] }>((resolve, reject) => {
          const wk = new Worker(file, { workerData: { from: w * per, to: Math.min(N, (w + 1) * per), seed }, execArgv: ["--import", "tsx"] });
          wk.on("message", (msg) => {
            if (msg.progress) {
              progress += 20000;
              process.stdout.write(`\r진행 ${Math.min(N, progress).toLocaleString()} / ${N.toLocaleString()}  (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
            }
            if (msg.done) resolve(msg);
          });
          wk.on("error", reject);
        }),
    ),
  );
  const stats: Record<string, number> = {};
  const byMove: Record<string, Record<string, number>> = {};
  const examples: Record<string, unknown[]> = {};
  const metricDist: Record<string, number[]> = {};
  const timing: number[] = [];
  for (const r of results) {
    for (const [k, v] of Object.entries(r.stats)) stats[k] = (stats[k] ?? 0) + v;
    for (const [m, o] of Object.entries(r.byMove)) {
      byMove[m] ??= {};
      for (const [k, v] of Object.entries(o)) byMove[m][k] = (byMove[m][k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(r.examples)) examples[k] = [...(examples[k] ?? []), ...v].slice(0, 6);
    for (const [k, v] of Object.entries(r.metricDist)) metricDist[k] = [...(metricDist[k] ?? []), ...v];
    timing.push(...r.timing);
  }
  const q = (xs: number[], p: number) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const metricSummary = Object.fromEntries(
    Object.entries(metricDist)
      .filter(([k]) => /standing-long-jump:dist|sargent-jump:sargent|medicine-ball-throw:dist|sit-and-reach:reach|sit-up:reps|shuttle-run-10m:time|side-step:count|back-strength:kg|sprint-max:speed|high-bar-squat:trunk|deadlift:trunk|drop-landing:grf|cmj:height|pull-up:reps/.test(k))
      .map(([k, v]) => [k, { n: v.length, p5: q(v, 0.05), p50: q(v, 0.5), p95: q(v, 0.95) }]),
  );
  const out = {
    users: N,
    seconds: (Date.now() - t0) / 1000,
    stats,
    byMove,
    examples,
    metricSummary,
    timingMsPer72Frames: { p50: q(timing, 0.5), p95: q(timing, 0.95), p99: q(timing, 0.99) },
  };
  const dir = path.join(path.dirname(file), "..", "docs");
  const name = process.env.OUT ?? "simulator-report.json";
  fs.writeFileSync(path.join(dir, name), JSON.stringify(out, null, 2));
  console.log(`\n완료: ${N.toLocaleString()}명, ${out.seconds.toFixed(0)}초`);
  const total = stats["실행"] ?? 0;
  for (const [k, v] of Object.entries(stats).sort()) console.log(`${k.padEnd(34)} ${String(v).padStart(8)}  ${((v / Math.max(1, total)) * 100).toFixed(3)}%`);
  console.log("계산 시간(72프레임 환산) ms", out.timingMsPer72Frames);
}

if (isMainThread) main();
else workerMain();
