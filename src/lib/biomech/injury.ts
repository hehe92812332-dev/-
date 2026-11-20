// 보상 패턴·관절 부하 → 부위별 부상 위험도 (0~100)
// 점수는 연구에서 부상과 연관된 요인(부하 상태의 요추 굴곡, 착지 시 무릎 외반·높은 지면반력,
// 가동범위 끝에서의 반복 부하, 좌우 비대칭 등)을 가중합한 상대 지표이며 진단이 아니다.
import type { Profile } from "./anthropometry";
import { G } from "./kit";
import type { Ctx, Movement, SimFrame } from "./types";

export type Region = "lumbar" | "knee" | "ankle" | "hip" | "hamstring" | "shoulder" | "elbowWrist";
export type RiskLevel = "low" | "moderate" | "high";

export interface RiskFactor {
  label: string;
  points: number;
}

export interface RegionRisk {
  region: Region;
  name: string;
  score: number;
  level: RiskLevel;
  /** 더 위험한 쪽 (좌우가 있는 부위) */
  side?: "L" | "R" | "both";
  factors: RiskFactor[];
  /** 위험이 가장 큰 시점 */
  t?: number;
  advice: string;
}

export const REGION_NAMES: Record<Region, string> = {
  lumbar: "허리 (요추)",
  knee: "무릎",
  ankle: "발목·아킬레스건",
  hip: "고관절·골반",
  hamstring: "허벅지 뒤 (햄스트링)",
  shoulder: "어깨",
  elbowWrist: "팔꿈치·손목",
};

const ADVICE: Record<Region, string> = {
  lumbar: "허리가 굽거나 젖혀지기 전 범위까지만 부하를 쓰고, 브레이싱(복압) 연습과 고관절 가동성 운동을 함께 하세요.",
  knee: "무릎이 발끝 방향을 따라가게 하고, 착지는 엉덩이와 무릎을 함께 굽혀 흡수하세요. 둔근·고관절 외회전근 강화가 우선입니다.",
  ankle: "발목 배측굴곡 가동성(벽 무릎 대기)과 종아리 편심 운동으로 아킬레스건 부하 내성을 키우세요.",
  hip: "가동범위 끝에서 반복하지 말고, 중둔근(사이드 플랭크·밴드 워크)과 골반 수평 유지 연습을 하세요.",
  hamstring: "노르딕 컬·RDL로 햄스트링 편심 근력을 키우고, 스프린트 전 동적 스트레칭으로 충분히 데우세요.",
  shoulder: "광배근·흉추 가동성을 먼저 확보하고, 가동범위 안에서만 머리 위 부하를 쓰세요.",
  elbowWrist: "손목을 중립으로 두고(주먹 푸시업·손목 랩), 체중 부하 볼륨을 천천히 늘리세요.",
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function injuryRisk(m: Movement, p: Profile, ctx: Ctx, frames: SimFrame[], overload: boolean): RegionRisk[] {
  const b = ctx.body;
  const bwN = b.M * G;
  const H = b.H;
  const rel = clamp(ctx.loadKg / b.M, 0, 3); // 체중 대비 부하
  const dynamic = m.kind === "dynamic";
  const out: RegionRisk[] = [];
  // 달리기·점프는 정상 수행에서도 관절 모멘트가 크다 → 동적 동작은 기준선을 높인다
  const mk = dynamic ? 2.1 : 1;
  const mw = dynamic ? 0.6 : 1;
  const peak = (f: (x: SimFrame) => number) => {
    let v = -Infinity,
      t = 0;
    for (const x of frames) {
      const y = f(x);
      if (Number.isFinite(y) && y > v) {
        v = y;
        t = x.t;
      }
    }
    return { v: Number.isFinite(v) ? v : 0, t };
  };
  const add = (region: Region, factors: RiskFactor[], t: number | undefined, side?: RegionRisk["side"]) => {
    const fs = factors.filter((f) => f.points >= 1).map((f) => ({ ...f, points: Math.round(f.points) }));
    const score = clamp(Math.round(fs.reduce((a, f) => a + f.points, 0)), 0, 100);
    out.push({
      region,
      name: REGION_NAMES[region],
      score,
      level: score >= 60 ? "high" : score >= 30 ? "moderate" : "low",
      side,
      factors: fs.sort((a, c) => c.points - a.points),
      t,
      advice: ADVICE[region],
    });
  };
  const sideOf = (l: number, r: number): RegionRisk["side"] => (Math.abs(l - r) < 0.15 * Math.max(l, r, 1e-6) ? "both" : l > r ? "L" : "R");
  const r0 = (x: number) => Math.round(x);
  const r1 = (x: number) => Math.round(x * 10) / 10;

  /* 허리 */
  {
    const lf = peak((f) => f.meta.lumbarFlex ?? 0);
    const le = peak((f) => (/bench/.test(m.id) ? 0 : f.meta.lumbarExt ?? 0));
    const lm = peak((f) => f.moments.lumbar / (bwN * H));
    const fs: RiskFactor[] = [];
    if (lf.v > 2) fs.push({ label: `허리 굽힘 ${r0(lf.v)}°${ctx.loadKg > 0 ? ` (부하 ${r0(ctx.loadKg)}kg)` : ""}`, points: lf.v * (0.9 + 1.8 * rel) });
    if (le.v > 3) fs.push({ label: `허리 과신전 ${r0(le.v)}°`, points: le.v * (0.8 + 1.2 * rel) });
    if (lm.v > 0.12 * mk) fs.push({ label: `허리 신전 모멘트 체중×키의 ${r0(lm.v * 100)}%`, points: (lm.v - 0.12 * mk) * 110 * mw });
    if (dynamic) {
      const g = peak((f) => (f.grf / bwN) * Math.sin((Math.max(0, f.angles.trunkLean) * Math.PI) / 180));
      if (g.v > 1) fs.push({ label: "몸통을 숙인 채 큰 충격 흡수", points: (g.v - 1) * 8 });
    }
    if (overload && ctx.loadKg > 0) fs.push({ label: "추정 최대 근력에 가까운 부하", points: 15 });
    add("lumbar", fs, Math.max(lf.v, le.v) > 3 ? (lf.v >= le.v ? lf.t : le.t) : lm.t);
  }

  /* 무릎 */
  {
    const kmL = peak((f) => f.kneeMedial[0] * 100 * (dynamic ? Math.max(1, f.grf / bwN / 1.5) : 1));
    const kmR = peak((f) => f.kneeMedial[1] * 100 * (dynamic ? Math.max(1, f.grf / bwN / 1.5) : 1));
    const raw = peak((f) => Math.max(...f.kneeMedial) * 100);
    const km = peak((f) => f.moments.knee / (bwN * H));
    const heel = peak((f) => Math.max(...(f.meta.heelRise ?? [0, 0])));
    const fs: RiskFactor[] = [];
    const kv = Math.max(kmL.v, kmR.v);
    if (raw.v > 0.8) fs.push({ label: `무릎 안쪽 무너짐 ${r1(raw.v)}cm${dynamic ? " (충격 하중 중)" : ""}`, points: kv * (dynamic ? 9 : 6) });
    if (km.v > 0.1 * mk) fs.push({ label: `무릎 신전 모멘트 체중×키의 ${r0(km.v * 100)}%`, points: (km.v - 0.1 * mk) * 160 * mw });
    if (heel.v > 1.5) fs.push({ label: `뒤꿈치 들림 ${r0(heel.v)}° → 무릎 앞쪽(슬개건) 부하`, points: heel.v * 1.4 });
    if (dynamic) {
      const land = peak((f) => (f.contacts.length ? f.grf / bwN : 0));
      const stiff = frames.reduce((a, f) => (f.grf > a.grf ? f : a), frames[0]);
      if (land.v > 2.5) fs.push({ label: `순간 지면반력 체중의 ${r1(land.v)}배`, points: (land.v - 2.5) * 9 });
      const kf = Math.max(...stiff.angles.kneeFlex);
      if (land.v > 2.5 && kf < 45) fs.push({ label: `최대 충격 때 무릎 굴곡 ${r0(kf)}° (뻣뻣한 착지)`, points: (45 - kf) * 0.8 });
    }
    const deep = peak((f) => Math.max(...f.angles.kneeFlex));
    if (deep.v > 125 && rel > 0.8) fs.push({ label: `깊은 굴곡(${r0(deep.v)}°)에서 무거운 부하`, points: (rel - 0.8) * 15 });
    if (Math.abs(p.capacity.asym) >= 10) fs.push({ label: `좌우 근력 차이 ${r0(Math.abs(p.capacity.asym))}%`, points: Math.abs(p.capacity.asym) * 0.4 });
    if (overload && ctx.loadKg > 0 && /squat|lunge|split/.test(m.id)) fs.push({ label: "추정 최대 근력에 가까운 부하", points: 12 });
    add("knee", fs, raw.v > 0.8 ? raw.t : km.t, sideOf(kmL.v, kmR.v));
  }

  /* 발목·아킬레스 */
  {
    const df = peak((f) => Math.max(...f.angles.ankleDF));
    const heel = peak((f) => Math.max(...(f.meta.heelRise ?? [0, 0])));
    const am = peak((f) => f.moments.ankle / (bwN * H));
    const fs: RiskFactor[] = [];
    const gap = p.mobility.ankleDF - df.v;
    if (gap < 3 && df.v > 15) fs.push({ label: `발목을 가동범위 끝(${r0(p.mobility.ankleDF)}°)까지 사용`, points: 10 + Math.min(10, (3 - gap) * 2) });
    if (heel.v > 1.5) fs.push({ label: `뒤꿈치 들림 ${r0(heel.v)}°`, points: heel.v * 1.2 });
    if (am.v > 0.06 * mk * 1.6) fs.push({ label: `발목 저측굴곡 모멘트 체중×키의 ${r0(am.v * 100)}%`, points: (am.v - 0.06 * mk * 1.6) * 200 * mw });
    if (dynamic) {
      const single = peak((f) => ((f.contactFeet?.length ?? 0) === 1 ? f.grf / bwN : 0));
      if (single.v > 2) fs.push({ label: `한 발로 체중의 ${r1(single.v)}배 지지`, points: (single.v - 2) * 10 });
      if (p.mobility.ankleDF < 30) fs.push({ label: `발목 배측굴곡 ${r0(p.mobility.ankleDF)}°로 충격 흡수 범위가 좁음`, points: (30 - p.mobility.ankleDF) * 1.2 });
    }
    add("ankle", fs, heel.v > 1.5 ? heel.t : df.t);
  }

  /* 고관절·골반 */
  {
    const hf = peak((f) => Math.max(...f.angles.hipFlex));
    const ob = peak((f) => Math.abs(f.meta.obliq ?? 0));
    const hm = peak((f) => f.moments.hip / (bwN * H));
    const fs: RiskFactor[] = [];
    const gap = p.mobility.hipFlex - hf.v;
    if (gap < 4 && hf.v > 90) fs.push({ label: `고관절 굴곡 가동범위 끝(${r0(p.mobility.hipFlex)}°)에서 반복 → 앞쪽 끼임`, points: (4 - gap) * 2 + 12 * (0.6 + rel) });
    if (ob.v > 1.5) fs.push({ label: `골반 좌우 기울기 ${r1(ob.v)}°`, points: ob.v * (dynamic ? 4 : 3) });
    if (hm.v > 0.1 * mk) fs.push({ label: `고관절 신전 모멘트 체중×키의 ${r0(hm.v * 100)}%`, points: (hm.v - 0.1 * mk) * 90 * mw });
    if (Math.abs(p.body.legDiffCm) >= 0.5) fs.push({ label: `다리 길이 차이 ${Math.abs(p.body.legDiffCm)}cm`, points: Math.abs(p.body.legDiffCm) * 8 });
    add("hip", fs, gap < 4 ? hf.t : ob.v > 1.5 ? ob.t : hm.t, p.body.legDiffCm > 0.5 ? "L" : p.body.legDiffCm < -0.5 ? "R" : undefined);
  }

  /* 햄스트링 */
  {
    const hl = peak((f) => f.meta.hamstringLimit ?? 0);
    const fs: RiskFactor[] = [];
    const isSprint = /sprint|cut|shuttle|bound|skater/.test(m.id);
    // 무릎이 펴진 채 고관절이 굽은 정도 = 햄스트링 늘어남
    const stretch = peak((f) => Math.max(f.angles.hipFlex[0] - 0.7 * f.angles.kneeFlex[0], f.angles.hipFlex[1] - 0.7 * f.angles.kneeFlex[1]));
    const allow = p.mobility.hamstring + 8;
    if (stretch.v > allow - 10) fs.push({ label: `햄스트링이 유연성 한계(하지직거상 ${r0(p.mobility.hamstring)}°) 근처까지 늘어남`, points: (stretch.v - (allow - 10)) * 1.1 * (1 + rel) });
    if (hl.v > 1) fs.push({ label: "유연성 한계로 동작 범위가 줄어듦", points: Math.min(20, hl.v * 1.5) });
    if (isSprint) {
      fs.push({ label: "고속 달리기의 편심 부하", points: 12 + (p.capacity.power / 100) * 8 });
      if (p.mobility.hamstring < 75) fs.push({ label: `하지직거상 ${r0(p.mobility.hamstring)}°로 짧은 햄스트링`, points: (75 - p.mobility.hamstring) * 1.2 });
    }
    if (Math.abs(p.capacity.asym) >= 10 && (isSprint || /deadlift|good|swing|jump/.test(m.id))) fs.push({ label: `좌우 근력 차이 ${r0(Math.abs(p.capacity.asym))}%`, points: Math.abs(p.capacity.asym) * 0.5 });
    add("hamstring", fs, stretch.t);
  }

  /* 어깨 */
  {
    const sd = peak((f) => f.meta.shoulderDeficit ?? 0);
    const sm = peak((f) => f.moments.shoulder / (bwN * b.armLen));
    const flex = peak((f) => Math.max(...f.angles.shoulderFlex));
    const fs: RiskFactor[] = [];
    if (sd.v > 2) fs.push({ label: `어깨 굴곡 ${r0(sd.v)}° 부족`, points: sd.v * (1.6 + rel) });
    if (sm.v > 0.08) fs.push({ label: `어깨 모멘트 체중×팔길이의 ${r0(sm.v * 100)}%`, points: (sm.v - 0.08) * 160 });
    if (flex.v > p.mobility.shoulderFlex - 5 && flex.v > 140) fs.push({ label: "어깨를 가동범위 끝까지 올림", points: 8 + rel * 10 });
    if (m.support === "hang") fs.push({ label: "매달린 자세에서 체중 지지", points: 10 + (b.M + ctx.loadKg) / b.M * 4 });
    if (/bench|push-up/.test(m.id)) {
      const el = peak((f) => Math.max(...f.angles.elbowFlex));
      if (el.v > 100) fs.push({ label: `바닥 지점 팔꿈치 ${r0(el.v)}°로 어깨 앞쪽 신장`, points: (el.v - 100) * 0.5 * (1 + rel) });
    }
    add("shoulder", fs, sd.v > 2 ? sd.t : sm.t);
  }

  /* 팔꿈치·손목 */
  {
    const hands = peak((f) => f.loads.filter((l) => l.id === "handL" || l.id === "handR").reduce((a, l) => a + l.kg, 0) / b.M);
    const fs: RiskFactor[] = [];
    if (hands.v > 0.2) fs.push({ label: `손으로 체중의 ${r0(hands.v * 100)}% 지지 (손목 신전 상태)`, points: hands.v * 30 });
    if (m.id === "front-squat" && p.mobility.shoulderFlex < 165) fs.push({ label: "프론트 랙에서 어깨가 부족해 손목이 꺾임", points: (165 - p.mobility.shoulderFlex) * 1.2 + 8 });
    if (m.support === "hang") fs.push({ label: "매달려 당기는 팔꿈치 굴곡 부하", points: 8 });
    if (/throw|medicine/.test(m.id)) fs.push({ label: "릴리스 순간 팔꿈치 신전 속도", points: 6 + (p.capacity.power / 100) * 8 });
    add("elbowWrist", fs, hands.t);
  }

  return out.sort((a, c) => c.score - a.score);
}
