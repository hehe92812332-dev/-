"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { HeartPulse, Stethoscope } from "lucide-react";
import { Notice, TierBadge } from "@/components/ui";
import { CATEGORIES, DEGREES, HOSPITAL_TYPES, type Category, type Degree, type HospitalType } from "@/lib/config";
import { useStore } from "@/lib/store";
import { missingFor, nextTier, tierFor } from "@/lib/tier";
import type { Role } from "@/lib/types";

const COLORS = ["#f472b6", "#fb923c", "#38bdf8", "#a78bfa", "#34d399", "#f87171"];

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signup } = useStore();
  const [role, setRole] = useState<Role>(params.get("role") === "therapist" ? "therapist" : "patient");
  const [name, setName] = useState("");
  const [license, setLicense] = useState("");
  const [years, setYears] = useState(0);
  const [hours, setHours] = useState(0);
  const [degree, setDegree] = useState<Degree>("none");
  const [hospitalType, setHospitalType] = useState<HospitalType>("hospital");
  const [hospitalName, setHospitalName] = useState("");
  const [specialties, setSpecialties] = useState<Category[]>([]);
  const [bio, setBio] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tierInput = { experienceYears: years, educationHours: hours, degree };
  const tier = tierFor(tierInput);
  const next = nextTier(tier.id);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError("이름(닉네임)을 2자 이상 입력해 주세요.");
    if (role === "therapist" && !/^\d{4,}$/.test(license)) return setError("물리치료사 면허번호를 숫자로 입력해 주세요.");
    if (role === "therapist" && specialties.length === 0) return setError("전문 분야를 1개 이상 선택해 주세요.");
    if (!agree) return setError("이용약관 및 개인정보 처리방침에 동의해 주세요.");
    signup({
      name: name.trim(),
      role,
      avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
      therapist:
        role === "therapist"
          ? {
              // 실서비스에서는 면허 진위 확인(보건의료인 국가시험원 면허 조회 등) 후 true로 전환
              licenseVerified: true,
              experienceYears: years,
              educationHours: hours,
              degree,
              hospitalType,
              hospitalName: hospitalName.trim() || HOSPITAL_TYPES[hospitalType].label,
              specialties,
              bio: bio.trim(),
            }
          : undefined,
    });
    router.push(role === "therapist" ? "/clinical" : "/qa");
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl px-4 py-8 md:py-12">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">회원가입</h1>
      <p className="mt-2 text-slate-500">어떤 회원으로 가입하시나요?</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {(
          [
            ["patient", HeartPulse, "환자·보호자", "질문하고 답변 받기"],
            ["therapist", Stethoscope, "물리치료사", "임상 토론 · 답변 · 환전"],
          ] as const
        ).map(([r, Icon, title, desc]) => (
          <button
            type="button"
            key={r}
            onClick={() => setRole(r)}
            className={`rounded-2xl border-2 p-5 text-left transition ${role === r ? "border-brand-500 bg-brand-50/50" : "border-slate-200 bg-white"}`}
          >
            <Icon className={`size-7 ${role === r ? "text-brand-600" : "text-slate-400"}`} />
            <div className="mt-3 font-bold">{title}</div>
            <div className="text-xs text-slate-500">{desc}</div>
          </button>
        ))}
      </div>

      <div className="card mt-6 space-y-5 p-5 md:p-6">
        <div>
          <label className="label">이름 또는 닉네임</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={role === "therapist" ? "실명 권장 (답변에 표시됩니다)" : "닉네임"} />
        </div>

        {role === "therapist" && (
          <>
            <div>
              <label className="label">물리치료사 면허번호</label>
              <input className="input" inputMode="numeric" value={license} onChange={(e) => setLicense(e.target.value.replace(/\D/g, ""))} placeholder="숫자만 입력" />
              <p className="mt-1.5 text-xs text-slate-400">면허 정보는 인증 용도로만 사용되며 공개되지 않습니다.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">임상 경력 (년)</label>
                <input type="number" min={0} className="input" value={years} onChange={(e) => setYears(Math.max(0, +e.target.value))} />
              </div>
              <div>
                <label className="label">물리치료학회 인정 교육 (시간)</label>
                <input type="number" min={0} className="input" value={hours} onChange={(e) => setHours(Math.max(0, +e.target.value))} />
              </div>
            </div>
            <div>
              <label className="label">최종 학위</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(DEGREES) as Degree[]).map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setDegree(d)}
                    className={`rounded-xl py-2.5 text-sm font-semibold ${degree === d ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {DEGREES[d]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">근무 기관 종류</label>
                <select className="input" value={hospitalType} onChange={(e) => setHospitalType(e.target.value as HospitalType)}>
                  {Object.entries(HOSPITAL_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">근무 기관명</label>
                <input className="input" value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} placeholder="예) ○○병원 재활치료실" />
              </div>
            </div>
            <div>
              <label className="label">전문 분야 (복수 선택)</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => {
                  const on = specialties.includes(c);
                  return (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setSpecialties(on ? specialties.filter((x) => x !== c) : [...specialties, c])}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="label">한 줄 소개</label>
              <input className="input" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="예) 어깨·무릎 수술 후 재활 10년차" />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
              <div className="text-sm">
                <div className="text-slate-500">예상 등급</div>
                {next && (
                  <div className="mt-1 text-xs text-slate-400">
                    {next.name}까지 {missingFor(next, tierInput).join(" · ")} 필요
                  </div>
                )}
              </div>
              <TierBadge tier={tier.id} size="md" />
            </div>
            <p className="text-xs text-slate-400">경력·교육·학위는 증빙 서류(경력증명서, 학회 교육 이수증, 학위증명서) 심사 후 최종 등급에 반영됩니다.</p>
          </>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            이용약관, 개인정보 처리방침에 동의합니다.
            {role === "patient" && " 답변은 건강 정보 제공 목적이며 진단·처방을 대신하지 않음을 이해합니다."}
          </span>
        </label>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <button type="submit" className="btn-primary mt-6 w-full !py-3.5 text-base">
        가입하기
      </button>
    </form>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
