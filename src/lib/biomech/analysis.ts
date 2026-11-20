// 프레임 결과 → 보상 패턴 진단 (원인·설명·교정 제안)
import type { InputIssue, Profile } from "./anthropometry";
import { G } from "./kit";
import type { Ctx, Movement, SimFrame } from "./types";

export type Level = "info" | "warn" | "risk";
export type Cause = "체형" | "가동성" | "조절" | "부하" | "비대칭" | "입력";

export interface Finding {
  id: string;
  level: Level;
  cause: Cause;
  title: string;
  detail: string;
  tip?: string;
  /** 가장 두드러진 시점 (0~1) */
  t?: number;
  value?: number;
  unit?: string;
}

const peak = (frames: SimFrame[], f: (x: SimFrame) => number) => {
  let best = frames[0],
    v = -Infinity;
  for (const x of frames) {
    const y = f(x);
    if (Number.isFinite(y) && y > v) {
      v = y;
      best = x;
    }
  }
  return { frame: best, v };
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);

export function analyze(m: Movement, p: Profile, ctx: Ctx, frames: SimFrame[], ref: SimFrame[] | undefined, issues: InputIssue[]): Finding[] {
  const out: Finding[] = [];
  const b = ctx.body;
  const H = b.H;
  const bwN = b.M * G;
  const standing = m.support === "feet";

  // 입력 경고
  for (const i of issues) out.push({ id: `input-${i.field}`, level: "info", cause: "입력", title: i.notice ? "입력값을 확인해 주세요" : "입력값을 조정했습니다", detail: i.message });

  // 0) 부하가 추정 최대 근력을 넘음
  if (m.load && ctx.loadKg > 0 && m.load.rmPerBw) {
    const rmPerBw = m.load.rmPerBw;
    const pf = 0.55 + (p.capacity.power / 100) * 1.1;
    const rm = b.M * rmPerBw * pf * (b.sex === "f" ? 0.72 : 1);
    if (ctx.loadKg > rm * 0.97) {
      out.push({
        id: "overload",
        level: ctx.loadKg > rm * 1.15 ? "risk" : "warn",
        cause: "부하",
        title: `${Math.round(ctx.loadKg)}kg은 추정 최대 근력(약 ${Math.round(rm)}kg)${ctx.loadKg > rm ? "을 넘습니다" : "에 가깝습니다"}`,
        detail: `체중 ${Math.round(b.M)}kg과 파워 ${Math.round(p.capacity.power)}점으로 추정한 1회 최대 무게입니다. 이 무게에서는 아래 보상 패턴이 더 커지고 자세가 무너질 수 있습니다.`,
        tip: "실제 1RM을 알고 있다면 파워 값을 조정해 맞추세요. 기술 연습은 1RM의 60~80%에서 하세요.",
      });
    }
  }

  // 1) 발목 가동성 → 몸통 숙임 증가
  const te = peak(frames, (f) => f.meta.trunkExtra ?? 0);
  if (te.v >= 4) {
    out.push({
      id: "trunk-extra",
      level: te.v >= 14 ? "warn" : "info",
      cause: "가동성",
      title: "발목 대신 몸통을 더 숙여 균형을 잡습니다",
      detail: `무릎이 더 나가려면 발목이 ${r0(p.mobility.ankleDF)}°보다 더 굽혀져야 합니다. 무게중심을 발 중앙에 두려고 몸통이 원래 자세보다 ${r0(te.v)}° 더 숙여집니다.`,
      tip: "발목 가동성 운동(벽 무릎 대기·카프 스트레칭)을 하거나 굽이 있는 역도화·뒤꿈치 받침을 써 보세요.",
      t: te.frame.t,
      value: te.v,
      unit: "°",
    });
  }

  // 2) 체형 효과: 표준 체형 대비 몸통 숙임
  if (ref && standing && m.kind === "static") {
    const mine = peak(frames, (f) => f.angles.trunkLean);
    const theirs = peak(ref, (f) => f.angles.trunkLean);
    const diff = mine.v - theirs.v;
    if (Math.abs(diff) >= 4) {
      const thighR = b.thigh[0] / (b.thigh[0] + b.shank[0]);
      const tt = b.thigh[0] / b.torso;
      const reasons: string[] = [];
      if (thighR > 0.51) reasons.push(`넙다리가 정강이보다 길고(대퇴 비율 ${Math.round(thighR * 100)}%)`);
      if (thighR < 0.49) reasons.push(`정강이가 상대적으로 길고(대퇴 비율 ${Math.round(thighR * 100)}%)`);
      if (tt > 0.88) reasons.push(`몸통에 비해 넙다리가 길어(넙다리/몸통 ${tt.toFixed(2)})`);
      if (tt < 0.78) reasons.push(`넙다리에 비해 몸통이 길어(넙다리/몸통 ${tt.toFixed(2)})`);
      const armR = b.armLen / H;
      if (/deadlift|row/.test(m.id) && armR > 0.45) reasons.push(`팔이 길어(키의 ${Math.round(armR * 100)}%)`);
      if (/deadlift|row/.test(m.id) && armR < 0.43) reasons.push(`팔이 짧아(키의 ${Math.round(armR * 100)}%)`);
      if (Math.abs(p.mobility.ankleDF - 38) >= 6 && !/deadlift/.test(m.id)) reasons.push(`발목 가동성이 ${p.mobility.ankleDF > 38 ? "좋아" : "부족해"}`);
      out.push({
        id: "trunk-vs-ref",
        level: "info",
        cause: "체형",
        title: diff > 0 ? `같은 키 표준 체형보다 몸통이 ${r0(diff)}° 더 숙여집니다` : `같은 키 표준 체형보다 몸통이 ${r0(-diff)}° 더 섭니다`,
        detail: `${reasons.length ? reasons.join(", ") + " " : ""}가장 깊은 지점에서 몸통 기울기가 ${r0(mine.v)}°입니다 (표준 ${r0(theirs.v)}°). 이 차이는 잘못된 자세가 아니라 분절 길이에서 생기는 정상적인 결과입니다.`,
        tip: diff > 0 ? "허리 부담이 커지므로 스탠스를 조금 넓히고 발끝을 더 벌리거나, 프론트·고블릿 같은 앞쪽 부하 변형이 몸통을 세우는 데 도움이 됩니다." : undefined,
        t: mine.frame.t,
        value: diff,
        unit: "°",
      });
    }
  }

  // 3) 뒤꿈치 들림
  const heel = peak(frames, (f) => Math.max(f.meta.heelRise?.[0] ?? 0, f.meta.heelRise?.[1] ?? 0));
  if (heel.v >= 2 && m.kind === "static") {
    out.push({
      id: "heel-rise",
      level: heel.v >= 8 ? "risk" : "warn",
      cause: "가동성",
      title: `뒤꿈치가 ${r0(heel.v)}° 들립니다`,
      detail: `몸통을 최대로 숙여도 발목 가동성(${r0(p.mobility.ankleDF)}°)이 모자라 뒤꿈치가 떠 체중이 발 앞쪽으로 쏠립니다. 무릎 앞쪽 부담이 커지고 균형을 잃기 쉽습니다.`,
      tip: "발목 가동성을 늘리거나 2~2.5cm 뒤꿈치 받침을 써서 깊이를 조절하세요.",
      t: heel.frame.t,
      value: heel.v,
      unit: "°",
    });
  }

  // 4) 깊이 손실
  const dl = peak(frames, (f) => f.meta.depthLoss ?? 0);
  if (dl.v >= 0.04) {
    out.push({
      id: "depth-loss",
      level: dl.v >= 0.2 ? "warn" : "info",
      cause: "가동성",
      title: `목표 깊이의 ${r0((1 - dl.v) * 100)}%까지만 내려갑니다`,
      detail: "발목·고관절 가동 범위 안에서 균형을 유지할 수 있는 지점까지만 앉도록 계산했습니다. 그보다 깊이 앉으면 허리가 말리거나 뒤로 넘어지는 보상이 생깁니다.",
      tip: "지금은 이 깊이까지 연습하고, 가동성이 늘면 깊이를 늘리세요.",
      t: dl.frame.t,
      value: (1 - dl.v) * 100,
      unit: "%",
    });
  }

  // 5) 요추 굴곡 (버트윙크·등 말림)
  const lf = peak(frames, (f) => f.meta.lumbarFlex ?? 0);
  if (lf.v >= 5) {
    const loaded = ctx.loadKg > 0.3 * b.M;
    const hingeLike = /deadlift|good-morning|row|swing|reach/.test(m.id);
    out.push({
      id: "lumbar-flex",
      level: lf.v >= 15 && loaded ? "risk" : lf.v >= 10 ? "warn" : "info",
      cause: "가동성",
      title: hingeLike ? `허리가 ${r0(lf.v)}° 둥글게 말립니다` : `최저점에서 골반이 ${r0(lf.v)}° 뒤로 말립니다 (버트윙크)`,
      detail: hingeLike
        ? `햄스트링 유연성(하지직거상 ${r0(p.mobility.hamstring)}°)과 고관절 굴곡 범위가 허용하는 것보다 더 숙여야 해서 남는 각도를 허리가 굽혀 메웁니다.${loaded ? ` ${r0(ctx.loadKg)}kg 부하에서는 디스크 압박이 커집니다.` : ""}`
        : `고관절 굴곡 범위(${r0(p.mobility.hipFlex)}°)를 넘는 깊이에서 골반이 뒤로 기울며 허리가 굽습니다.`,
      tip: hingeLike ? "바 시작 높이를 블록으로 올리거나(랙 풀), 무릎을 조금 더 굽혀 햄스트링 긴장을 줄이세요." : "말리기 직전 깊이까지만 앉고, 고관절 굴곡·내회전 가동성 운동을 함께 하세요.",
      t: lf.frame.t,
      value: lf.v,
      unit: "°",
    });
  }

  // 6) 요추 과신전
  const le = peak(frames, (f) => f.meta.lumbarExt ?? 0);
  if (le.v >= 8 && !/bench/.test(m.id)) {
    const sd = peak(frames, (f) => f.meta.shoulderDeficit ?? 0);
    out.push({
      id: "lumbar-ext",
      level: le.v >= 16 && ctx.loadKg > 0 ? "risk" : "warn",
      cause: sd.v > 3 ? "가동성" : "조절",
      title: `허리가 ${r0(le.v)}° 과하게 젖혀집니다`,
      detail:
        sd.v > 3
          ? `어깨 굴곡 가동범위(${r0(p.mobility.shoulderFlex)}°)가 부족해 팔을 머리 위로 올릴 때 모자란 ${r0(sd.v)}°를 허리를 젖혀 보충합니다.`
          : `몸통 조절 능력(${r0(p.capacity.control)}점)이 부족해 골반과 갈비뼈 사이가 벌어집니다.`,
      tip: sd.v > 3 ? "광배근·흉추 신전 가동성 운동을 하고, 그동안은 랜드마인 프레스처럼 각도가 낮은 변형을 쓰세요." : "갈비뼈를 내리고 둔근을 조이는 연습(데드버그·플랭크)을 먼저 하세요.",
      t: le.frame.t,
      value: le.v,
      unit: "°",
    });
  }

  // 7) 어깨 가동 부족
  const sd = peak(frames, (f) => f.meta.shoulderDeficit ?? 0);
  if (sd.v >= 5 && le.v < 8) {
    out.push({
      id: "shoulder",
      level: "warn",
      cause: "가동성",
      title: `어깨 굴곡이 ${r0(sd.v)}° 모자랍니다`,
      detail: `동작에 필요한 팔 올림 각도가 현재 어깨 가동범위(${r0(p.mobility.shoulderFlex)}°)를 넘습니다. 팔이 앞으로 빠지거나 몸통이 보상합니다.`,
      tip: "흉추 신전·광배근 스트레칭을 하고, 가동범위 안에서 부하를 쓰세요.",
      t: sd.frame.t,
      value: sd.v,
      unit: "°",
    });
  }

  // 8) 무릎 안쪽 무너짐
  const kv = peak(frames, (f) => Math.max(f.kneeMedial[0], f.kneeMedial[1]) * 100);
  if (kv.v >= (m.kind === "dynamic" ? 2 : 2.5)) {
    const km = kv.frame.kneeMedial;
    const side = Math.abs(km[0] - km[1]) < 0.003 ? "양쪽" : km[0] > km[1] ? "왼쪽" : "오른쪽";
    const landing = m.kind === "dynamic";
    out.push({
      id: "valgus",
      level: kv.v >= (landing ? 3.5 : 5) ? "risk" : "warn",
      cause: Math.abs(p.capacity.asym) >= 10 ? "비대칭" : "조절",
      title: `${side} 무릎이 ${r1(kv.v)}cm 안쪽으로 무너집니다`,
      detail: `엉덩이-발목을 잇는 선보다 무릎이 안쪽으로 들어갑니다. 조절 능력 ${r0(p.capacity.control)}점${Math.abs(p.capacity.asym) >= 10 ? `, 좌우 근력 차이 ${r0(Math.abs(p.capacity.asym))}%` : ""}${landing ? "에서 착지·방향 전환 때 전방십자인대 부담이 커지는 패턴입니다." : "에서 부하가 커질수록 심해집니다."}`,
      tip: "밴드 스쿼트·사이드 플랭크·한 발 데드리프트로 고관절 외전·외회전근을 먼저 강화하세요.",
      t: kv.frame.t,
      value: kv.v,
      unit: "cm",
    });
  }

  // 9) 좌우 하중 차이 (양발 지지 프레임, 정적 동작)
  if (standing && m.kind === "static" && !m.group.includes("한 다리")) {
    const lr = peak(frames, (f) => {
      const L = f.loads.find((l) => l.id === "L");
      const R = f.loads.find((l) => l.id === "R");
      if (!L || !R || L.share + R.share < 0.9) return 0;
      // 앞뒤로 벌어진 스탠스(런지 등)는 좌우 비교 제외
      if (Math.abs(f.pose.j.ankleL[2] - f.pose.j.ankleR[2]) > 0.25) return 0;
      return Math.abs(L.share - R.share) * 100;
    });
    if (lr.v >= 6) {
      const L = lr.frame.loads.find((l) => l.id === "L")!;
      const heavy = L.share > 0.5 ? "왼쪽" : "오른쪽";
      const dL = p.body.legDiffCm;
      out.push({
        id: "lr-shift",
        level: lr.v >= 14 ? "warn" : "info",
        cause: Math.abs(dL) >= 0.5 ? "체형" : "비대칭",
        title: `체중이 ${heavy}으로 ${r0(lr.v / 2)}%p 쏠립니다`,
        detail:
          Math.abs(dL) >= 0.5
            ? `다리 길이 차이(${dL > 0 ? "왼쪽" : "오른쪽"}이 ${Math.abs(dL)}cm 김) 때문에 골반이 기울고 몸이 짧은 다리 쪽으로 옮겨 갑니다.`
            : `좌우 근력 차이(${p.capacity.asym > 0 ? "왼쪽" : "오른쪽"}이 ${Math.abs(p.capacity.asym)}% 강함)로 강한 쪽에 더 기댑니다.`,
        tip: "거울 앞에서 바의 수평을 확인하고, 약한 쪽 한 다리 운동(스플릿 스쿼트·스텝업)을 추가하세요.",
        t: lr.frame.t,
        value: lr.v,
        unit: "%p",
      });
    }
  }

  // 10) 골반 기울기
  const ob = peak(frames, (f) => Math.abs(f.meta.obliq ?? 0));
  if (ob.v >= 2.5) {
    const single = m.kind === "dynamic";
    out.push({
      id: "obliq",
      level: ob.v >= 6 ? "warn" : "info",
      cause: single ? "조절" : "체형",
      title: single ? `한 발 지지 때 골반이 ${r1(ob.v)}° 떨어집니다` : `골반이 좌우로 ${r1(ob.v)}° 기웁니다`,
      detail: single
        ? "지지하는 다리의 중둔근이 골반을 수평으로 붙잡지 못해 반대쪽 골반이 내려갑니다 (트렌델렌버그 패턴)."
        : "다리 길이 차이를 골반 기울기와 허리 측굴로 보상합니다.",
      tip: single ? "한 발 서기, 사이드 플랭크, 밴드 사이드 워크로 중둔근을 강화하세요." : "차이가 1cm 이상이면 전문가 평가 후 깔창 보정을 고려하세요.",
      t: ob.frame.t,
      value: ob.v,
      unit: "°",
    });
  }

  // 11) 지지면 이탈 / 발 앞쪽 쏠림 (정적)
  if (standing && m.kind === "static") {
    const out1 = peak(frames, (f) => (f.meta.transient ? -1 : -f.support.margin));
    if (out1.v > 0.005 && !out1.frame.support.inside) {
      out.push({
        id: "balance",
        level: "risk",
        cause: "체형",
        title: "무게중심이 발 밖으로 벗어납니다",
        detail: `가장 불리한 순간 무게중심이 지지면 밖 ${r1(out1.v * 100)}cm에 있어 실제로는 균형을 잃습니다.`,
        tip: "부하를 줄이거나 스탠스를 바꿔 보세요.",
        t: out1.frame.t,
      });
    }
    const fore = peak(frames, (f) => {
      const ft = f.loads.filter((l) => l.id === "L" || l.id === "R");
      if (!ft.length) return 0;
      return (ft.reduce((a, l) => a + l.fore * l.share, 0) / Math.max(1e-6, ft.reduce((a, l) => a + l.share, 0))) * 100;
    });
    if (fore.v >= 80 && heel.v < 2) {
      out.push({
        id: "forefoot",
        level: "info",
        cause: "체형",
        title: `압력 중심이 발 앞쪽 ${r0(fore.v)}% 지점까지 이동합니다`,
        detail: "체중이 발볼 쪽으로 몰려 무릎 앞쪽 부담이 커집니다.",
        tip: "발 전체, 특히 뒤꿈치와 엄지발가락 아래로 바닥을 누르는 느낌을 유지하세요.",
        t: fore.frame.t,
        value: fore.v,
        unit: "%",
      });
    }
  }

  // 12) 햄스트링 한계 → 가동범위 감소
  const hl = peak(frames, (f) => f.meta.hamstringLimit ?? 0);
  if (hl.v >= 3 && lf.v < 5) {
    out.push({
      id: "hamstring",
      level: "info",
      cause: "가동성",
      title: "햄스트링 유연성이 가동범위를 제한합니다",
      detail: `하지직거상 ${r0(p.mobility.hamstring)}° 기준으로 허리를 굽히지 않고 갈 수 있는 지점에서 멈추도록 계산했습니다 (제한량 ${r0(hl.v)}${/deadlift|good/.test(m.id) ? "" : "°"}).`,
      tip: "동적 햄스트링 스트레칭과 노르딕 컬로 길이와 근력을 함께 늘리세요.",
      t: hl.frame.t,
    });
  }

  // 13) 착지·동적 하중
  if (m.kind === "dynamic") {
    const g = peak(frames, (f) => f.grf / bwN);
    if (g.v >= 4.5) {
      out.push({
        id: "grf",
        level: g.v >= 7 ? "risk" : "warn",
        cause: "조절",
        title: `순간 지면반력이 체중의 ${r1(g.v)}배까지 올라갑니다`,
        detail: "짧은 시간에 감속하면서 관절이 큰 충격을 받습니다. 무릎·고관절을 함께 굽혀 흡수 시간을 늘리면 최대 하중이 줄어듭니다.",
        tip: "착지를 조용하게, 무릎과 엉덩이를 동시에 굽혀 흡수하는 연습을 하세요.",
        t: g.frame.t,
        value: g.v,
        unit: "×BW",
      });
    }
  }

  // 14) 요추 모멘트 (정적, 부하)
  if (standing && m.kind === "static") {
    const lm = peak(frames, (f) => f.moments.lumbar);
    const norm = lm.v / (b.M * G * H);
    if (norm > 0.32) {
      out.push({
        id: "lumbar-moment",
        level: norm > 0.5 ? "warn" : "info",
        cause: "부하",
        title: `허리 신전 모멘트가 ${r0(lm.v)} N·m 입니다`,
        detail: `체중×키 대비 ${r1(norm * 100)}% 수준입니다. 몸통이 많이 숙여질수록, 부하가 몸에서 멀수록 커집니다.`,
        tip: "몸통 각도가 큰 체형이라면 볼륨을 나누거나 허리 부담이 적은 변형을 섞으세요.",
        t: lm.frame.t,
        value: lm.v,
        unit: "N·m",
      });
    }
  }

  const order: Record<Level, number> = { risk: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.cause === "입력" ? 1 : 0) - (b.cause === "입력" ? 1 : 0));
}
