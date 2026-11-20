import { describe, expect, it } from "vitest";
import { buildBody, sanitizeProfile, standardBody } from "@/lib/biomech/anthropometry";
import { MOVEMENTS } from "@/lib/biomech/moves";
import { simulate } from "@/lib/biomech/simulate";

const metric = (moveId: string, id: string, p: Parameters<typeof simulate>[0] = {}, loadKg?: number) =>
  simulate(p, moveId, { frames: 24, reference: false, loadKg }).metrics.find((m) => m.id === id)!.value;

describe("체형 입력", () => {
  it("표준 체형은 수정 없이 통과", () => {
    const { issues } = sanitizeProfile({ body: standardBody(168, "f") });
    expect(issues.filter((i) => !i.notice)).toHaveLength(0);
  });
  it("cm 대신 인치로 넣은 키, cm 로 넣은 발 길이를 잡아낸다", () => {
    const { issues } = sanitizeProfile({ body: { ...standardBody(175), heightCm: 69 } });
    expect(issues.length).toBeGreaterThan(0);
    const foot = sanitizeProfile({ body: { ...standardBody(175), footMm: 27 } });
    expect(foot.issues.some((i) => i.field === "footMm")).toBe(true);
  });
  it("NaN·음수 입력도 계산이 깨지지 않는다", () => {
    const r = simulate({ body: { ...standardBody(175), torsoCm: Number.NaN, legDiffCm: -20 } }, "high-bar-squat", { frames: 12, reference: false });
    expect(r.frames.every((f) => Number.isFinite(f.com[1]))).toBe(true);
  });
  it("다리 길이 차이는 넙다리·정강이에 나뉘어 반영된다", () => {
    const b = buildBody(sanitizeProfile({ body: { ...standardBody(175), legDiffCm: 2 } }).profile);
    expect(b.thigh[0] + b.shank[0] - (b.thigh[1] + b.shank[1])).toBeCloseTo(0.02, 4);
  });
});

describe("모든 동작", () => {
  for (const m of MOVEMENTS) {
    it(`${m.name}: 수치가 유한하고 뼈 길이가 유지된다`, () => {
      const r = simulate({}, m.id, { frames: 24, reference: false });
      const b = buildBody(r.profile);
      for (const f of r.frames) {
        for (const v of Object.values(f.pose.j)) expect(v.every(Number.isFinite)).toBe(true);
        const j = f.pose.j;
        const thigh = Math.hypot(j.kneeL[0] - j.hipL[0], j.kneeL[1] - j.hipL[1], j.kneeL[2] - j.hipL[2]);
        expect(Math.abs(thigh - b.thigh[0])).toBeLessThan(0.004);
        const low = Math.min(j.heelL[1], j.heelR[1], j.toeL[1], j.toeR[1]);
        expect(low).toBeGreaterThan(-0.012);
      }
      for (const x of r.metrics) expect(Number.isFinite(x.value)).toBe(true);
      // 하중 분포 합 = 100%
      for (const f of r.frames) if (f.loads.length) expect(f.loads.reduce((a, l) => a + l.share, 0)).toBeCloseTo(1, 2);
    });
  }
});

describe("체형 → 보상 방향", () => {
  it("넙다리가 길면 하이바 스쿼트에서 몸통이 더 숙여진다", () => {
    const std = standardBody(175);
    expect(metric("high-bar-squat", "trunk", { body: { ...std, kneeCm: std.kneeCm * 0.9 } })).toBeGreaterThan(metric("high-bar-squat", "trunk", { body: std }) + 3);
  });
  it("발목이 뻣뻣하면 프론트 스쿼트 몸통이 숙여지고 경고가 나온다", () => {
    const r = simulate({ mobility: { ankleDF: 18 } as never }, "front-squat", { frames: 24, reference: false });
    expect(r.findings.some((f) => ["trunk-extra", "heel-rise", "depth-loss"].includes(f.id))).toBe(true);
  });
  it("팔이 길면 좌전굴 기록이 좋아진다", () => {
    const std = standardBody(175);
    expect(metric("sit-and-reach", "reach", { body: { ...std, armCm: std.armCm + 5 } })).toBeGreaterThan(metric("sit-and-reach", "reach", { body: std }) + 2);
  });
  it("파워가 높으면 제자리멀리뛰기 기록이 늘어난다", () => {
    expect(metric("standing-long-jump", "dist", { capacity: { power: 80, control: 60, asym: 0 } })).toBeGreaterThan(metric("standing-long-jump", "dist"));
  });
  it("평균 남성의 체대입시 기록이 현실 범위에 있다", () => {
    const slj = metric("standing-long-jump", "dist");
    expect(slj).toBeGreaterThan(200);
    expect(slj).toBeLessThan(280);
    const sg = metric("sargent-jump", "sargent");
    expect(sg).toBeGreaterThan(40);
    expect(sg).toBeLessThan(70);
  });
  it("드롭 착지 지면반력이 체중의 2~6배", () => {
    const g = metric("drop-landing", "grf");
    expect(g).toBeGreaterThan(2);
    expect(g).toBeLessThan(6);
  });
  it("표준 체형·기본 가동성에서는 위험 경고가 없다", () => {
    for (const id of ["high-bar-squat", "deadlift", "front-squat", "bench-press", "romanian-deadlift", "reverse-lunge"]) {
      const r = simulate({}, id, { frames: 24, reference: false });
      expect(r.findings.filter((f) => f.level === "risk").map((f) => `${id}: ${f.title}`)).toEqual([]);
    }
  });
  it("다리 길이 차이가 있으면 좌우 하중 차이를 알려 준다", () => {
    const r = simulate({ body: { ...standardBody(175), legDiffCm: 2.5 } }, "high-bar-squat", { frames: 24, reference: false });
    expect(r.findings.some((f) => f.id === "lr-shift" || f.id === "obliq")).toBe(true);
  });
});
