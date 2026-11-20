"use client";

import { defaultCapacity, defaultMobility, LIMITS, standardBody, type Profile } from "@/lib/biomech/anthropometry";
import { Field, Label, Seg, fmt } from "./parts";
import { rescaleBody } from "./state";

type Patch = (fn: (p: Profile) => Profile) => void;

const BODY_PRESETS: { id: string; label: string; apply: (p: Profile) => Profile }[] = [
  { id: "std", label: "표준 비율", apply: (p) => ({ ...p, body: { ...standardBody(p.body.heightCm, p.body.sex, p.body.weightKg), legDiffCm: 0 } }) },
  {
    id: "femur",
    label: "긴 넙다리",
    apply: (p) => {
      const s = standardBody(p.body.heightCm, p.body.sex, p.body.weightKg);
      return { ...p, body: { ...p.body, ...s, kneeCm: r1(s.kneeCm * 0.9), legDiffCm: p.body.legDiffCm } };
    },
  },
  {
    id: "arm",
    label: "긴 팔",
    apply: (p) => {
      const s = standardBody(p.body.heightCm, p.body.sex, p.body.weightKg);
      return { ...p, body: { ...p.body, ...s, armCm: r1(s.armCm * 1.07), legDiffCm: p.body.legDiffCm } };
    },
  },
  {
    id: "torso",
    label: "긴 몸통·짧은 다리",
    apply: (p) => {
      const s = standardBody(p.body.heightCm, p.body.sex, p.body.weightKg);
      return { ...p, body: { ...p.body, ...s, torsoCm: r1(s.torsoCm * 1.07), legCm: r1(s.legCm * 0.96), kneeCm: r1(s.kneeCm * 0.96), legDiffCm: p.body.legDiffCm } };
    },
  },
  {
    id: "legs",
    label: "짧은 몸통·긴 다리",
    apply: (p) => {
      const s = standardBody(p.body.heightCm, p.body.sex, p.body.weightKg);
      return { ...p, body: { ...p.body, ...s, torsoCm: r1(s.torsoCm * 0.93), legCm: r1(s.legCm * 1.04), kneeCm: r1(s.kneeCm * 1.04), legDiffCm: p.body.legDiffCm } };
    },
  },
];

const MOB_PRESETS: { id: string; label: string; m: Partial<Profile["mobility"]> }[] = [
  { id: "base", label: "보통", m: defaultMobility() },
  { id: "ankle", label: "발목이 뻣뻣함", m: { ankleDF: 22 } },
  { id: "ham", label: "햄스트링 짧음", m: { hamstring: 58, hipFlex: 112 } },
  { id: "shoulder", label: "어깨 제한", m: { shoulderFlex: 145, thoracicRot: 30 } },
  { id: "flex", label: "유연함", m: { ankleDF: 48, hipFlex: 135, hamstring: 100, shoulderFlex: 182, thoracicRot: 58 } },
];

function r1(x: number) {
  return Math.round(x * 10) / 10;
}

export function Inputs({ profile, patch }: { profile: Profile; patch: Patch }) {
  const b = profile.body;
  const std = standardBody(b.heightCm, b.sex, b.weightKg);
  const setB = (k: keyof Profile["body"], v: number) => patch((p) => ({ ...p, body: { ...p.body, [k]: v } }));
  const setM = (k: keyof Profile["mobility"], v: number) => patch((p) => ({ ...p, mobility: { ...p.mobility, [k]: v } }));
  const setC = (k: keyof Profile["capacity"], v: number) => patch((p) => ({ ...p, capacity: { ...p.capacity, [k]: v } }));
  const L = LIMITS;
  const thigh = b.legCm - b.kneeCm;
  const shank = b.kneeCm - 0.039 * b.heightCm;
  const ratios = [
    { label: "넙다리 : 정강이", v: thigh / shank, s: (std.legCm - std.kneeCm) / (std.kneeCm - 0.039 * std.heightCm), d: 2 },
    { label: "넙다리 / 몸통", v: thigh / b.torsoCm, s: (std.legCm - std.kneeCm) / std.torsoCm, d: 2 },
    { label: "팔 / 키", v: b.armCm / b.heightCm, s: std.armCm / std.heightCm, d: 3 },
    { label: "다리 / 키", v: b.legCm / b.heightCm, s: std.legCm / std.heightCm, d: 3 },
  ];
  return (
    <div className="space-y-6">
      <section>
        <Label n="01" right={<Seg size="sm" value={b.sex} onChange={(v) => patch((p) => ({ ...p, body: { ...p.body, sex: v } }))} options={[{ value: "m", label: "남" }, { value: "f", label: "여" }]} ariaLabel="성별" />}>
          기본 신체
        </Label>
        <Field label="키" value={b.heightCm} min={L.heightCm[0]} max={L.heightCm[1]} step={0.5} digits={1} unit="cm" onChange={(v) => patch((p) => rescaleBody(p, v))} hint="키를 바꾸면 분절 길이가 지금 비율대로 함께 바뀝니다." />
        <Field label="체중" value={b.weightKg} min={L.weightKg[0]} max={L.weightKg[1]} step={0.5} digits={1} unit="kg" onChange={(v) => setB("weightKg", v)} />
        <Field label="발 길이" value={b.footMm} min={L.footMm[0]} max={L.footMm[1]} step={5} unit="mm" std={std.footMm} onChange={(v) => setB("footMm", v)} hint="신발 사이즈(mm)" />
      </section>

      <section>
        <Label n="02" right={<span className="text-[11px] text-[#9a958c]">초록 눈금 = 같은 키 표준</span>}>
          분절 길이
        </Label>
        <div className="mt-2 flex flex-wrap gap-1">
          {BODY_PRESETS.map((x) => (
            <button key={x.id} onClick={() => patch(x.apply)} className="rounded-[4px] border border-[#d9d4c9] bg-white px-2 py-[3px] text-[12px] font-semibold text-[#4a4741] hover:border-[#161616]">
              {x.label}
            </button>
          ))}
        </div>
        <Field label="팔 길이" value={b.armCm} min={L.armCm[0]} max={L.armCm[1]} step={0.5} digits={1} unit="cm" std={std.armCm} onChange={(v) => setB("armCm", v)} hint="어깨 끝 뼈(견봉) → 가운뎃손가락 끝" />
        <Field label="다리 길이" value={b.legCm} min={L.legCm[0]} max={L.legCm[1]} step={0.5} digits={1} unit="cm" std={std.legCm} onChange={(v) => setB("legCm", v)} hint="바닥 → 골반 옆 튀어나온 뼈(대전자)" />
        <Field label="무릎 높이" value={b.kneeCm} min={L.kneeCm[0]} max={L.kneeCm[1]} step={0.5} digits={1} unit="cm" std={std.kneeCm} onChange={(v) => setB("kneeCm", v)} hint="바닥 → 무릎 관절 틈. 다리 길이와의 차이가 넙다리 길이입니다." />
        <Field label="몸통 길이" value={b.torsoCm} min={L.torsoCm[0]} max={L.torsoCm[1]} step={0.5} digits={1} unit="cm" std={std.torsoCm} onChange={(v) => setB("torsoCm", v)} hint="대전자 → 어깨 끝 높이 차이" />
        <Field label="어깨너비" value={b.shoulderCm} min={L.shoulderCm[0]} max={L.shoulderCm[1]} step={0.5} digits={1} unit="cm" std={std.shoulderCm} onChange={(v) => setB("shoulderCm", v)} />
        <Field label="골반너비" value={b.hipCm} min={L.hipCm[0]} max={L.hipCm[1]} step={0.5} digits={1} unit="cm" std={std.hipCm} onChange={(v) => setB("hipCm", v)} />
        <Field label="다리 길이 차이" value={b.legDiffCm} min={L.legDiffCm[0]} max={L.legDiffCm[1]} step={0.1} digits={1} unit="cm" std={0} onChange={(v) => setB("legDiffCm", v)} hint="왼쪽 − 오른쪽. 왼다리가 길면 +" />
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-[6px] border border-[#e3dfd6] bg-white p-2.5">
          {ratios.map((r) => {
            const dev = (r.v - r.s) / r.s;
            return (
              <div key={r.label}>
                <dt className="text-[11px] text-[#8a857c]">{r.label}</dt>
                <dd className="text-[13px] font-semibold tabular-nums">
                  {fmt(r.v, r.d)}
                  <span className={`ml-1 text-[11px] ${Math.abs(dev) > 0.04 ? "text-[#b07a0c]" : "text-[#9a958c]"}`}>
                    {dev >= 0 ? "+" : "−"}
                    {Math.abs(dev * 100).toFixed(0)}%
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section>
        <Label n="03">가동성</Label>
        <div className="mt-2 flex flex-wrap gap-1">
          {MOB_PRESETS.map((x) => (
            <button
              key={x.id}
              onClick={() => patch((p) => ({ ...p, mobility: { ...(x.id === "base" ? defaultMobility() : p.mobility), ...x.m } }))}
              className="rounded-[4px] border border-[#d9d4c9] bg-white px-2 py-[3px] text-[12px] font-semibold text-[#4a4741] hover:border-[#161616]"
            >
              {x.label}
            </button>
          ))}
        </div>
        <Field label="발목 배측굴곡" value={profile.mobility.ankleDF} min={L.ankleDF[0]} max={L.ankleDF[1]} unit="°" std={38} onChange={(v) => setM("ankleDF", v)} hint="벽에 무릎 대기: 엄지발가락이 벽에서 10cm 떨어져도 무릎이 닿으면 약 38°" />
        <Field label="고관절 굴곡" value={profile.mobility.hipFlex} min={L.hipFlex[0]} max={L.hipFlex[1]} unit="°" std={125} onChange={(v) => setM("hipFlex", v)} hint="누워서 무릎을 가슴 쪽으로 당겼을 때 허리가 뜨기 전 각도" />
        <Field label="햄스트링 (하지직거상)" value={profile.mobility.hamstring} min={L.hamstring[0]} max={L.hamstring[1]} unit="°" std={80} onChange={(v) => setM("hamstring", v)} hint="누워서 무릎을 편 채 다리를 든 각도" />
        <Field label="어깨 굴곡" value={profile.mobility.shoulderFlex} min={L.shoulderFlex[0]} max={L.shoulderFlex[1]} unit="°" std={170} onChange={(v) => setM("shoulderFlex", v)} hint="벽에 등을 대고 팔을 앞으로 들어 머리 위로 올린 각도" />
        <Field label="흉추 회전" value={profile.mobility.thoracicRot} min={L.thoracicRot[0]} max={L.thoracicRot[1]} unit="°" std={45} onChange={(v) => setM("thoracicRot", v)} hint="네발 자세에서 한 손을 머리 뒤에 두고 몸통을 돌린 각도" />
      </section>

      <section>
        <Label n="04">근력·조절</Label>
        <Field label="하체 파워" value={profile.capacity.power} min={0} max={100} unit="점" std={50} onChange={(v) => setC("power", v)} hint="0 운동 안 함 · 50 꾸준한 운동인 · 80 입시·선수 준비 · 100 엘리트" />
        <Field label="움직임 조절" value={profile.capacity.control} min={0} max={100} unit="점" std={60} onChange={(v) => setC("control", v)} hint="무릎·골반·몸통을 정렬된 채로 유지하는 능력. 낮을수록 무릎 안쪽 무너짐·골반 떨어짐이 커집니다." />
        <Field label="좌우 근력 차이" value={profile.capacity.asym} min={L.asym[0]} max={L.asym[1]} unit="%" std={0} onChange={(v) => setC("asym", v)} hint="+ 면 왼쪽이 강함" />
        <button
          onClick={() => patch((p) => ({ ...p, mobility: defaultMobility(), capacity: defaultCapacity() }))}
          className="mt-1 text-[12px] font-semibold text-[#6e6a63] underline decoration-[#c9c3b7] underline-offset-2 hover:text-[#161616]"
        >
          가동성·근력 기본값으로
        </button>
      </section>
    </div>
  );
}
