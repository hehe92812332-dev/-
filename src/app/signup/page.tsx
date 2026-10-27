"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { HeartPulse, Stethoscope } from "lucide-react";
import { Notice, TierBadge } from "@/components/ui";
import { CATEGORIES, DEGREES, HOSPITAL_TYPES, type Category, type Degree, type HospitalType } from "@/lib/config";
import { useStore } from "@/lib/store";
import { missingFor, nextTier, tierFor } from "@/lib/tier";
import type { Role } from "@/lib/types";

type DocKind = "license" | "career" | "education" | "degree";

const DOC_FIELDS: { kind: DocKind; label: string; hint: string }[] = [
  { kind: "license", label: "물리치료사 면허증 사본", hint: "필수" },
  { kind: "career", label: "경력증명서", hint: "경력 3년 이상이면 필수" },
  { kind: "education", label: "학회 인정 교육 이수증", hint: "교육 시간 인정에 필요 (여러 장 가능)" },
  { kind: "degree", label: "학위증명서", hint: "석·박사 선택 시 필요" },
];

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signup, me, serverMode } = useStore();
  const [docs, setDocs] = useState<Partial<Record<DocKind, File[]>>>({});
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>(params.get("role") === "therapist" ? "therapist" : "patient");
  const [name, setName] = useState(me?.name ?? "");
  const [license, setLicense] = useState("");
  const [years, setYears] = useState(0);
  const [hours, setHours] = useState(0);
  const [degree, setDegree] = useState<Degree>("none");
  const [hospitalType, setHospitalType] = useState<HospitalType>("hospital");
  const [hospitalName, setHospitalName] = useState("");
  const [specialties, setSpecialties] = useState<Category[]>([]);
  const [bio, setBio] = useState("");
  const [agree, setAgree] = useState(false);
  const [adult, setAdult] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tierInput = { experienceYears: years, educationHours: hours, degree };

  if (serverMode && !me)
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold">회원가입</h1>
        <p className="mt-2 text-sm text-slate-500">카카오·네이버 계정으로 간편하게 시작하세요.</p>
        <a href={`/login?next=${encodeURIComponent(`/signup${role === "therapist" ? "?role=therapist" : ""}`)}`} className="btn-primary mt-6 w-full !py-3.5">
          로그인하고 계속하기
        </a>
      </div>
    );
  const tier = tierFor(tierInput);
  const next = nextTier(tier.id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError("이름(닉네임)을 2자 이상 입력해 주세요.");
    if (role === "therapist" && !/^\d{4,}$/.test(license)) return setError("물리치료사 면허번호를 숫자로 입력해 주세요.");
    if (role === "therapist" && specialties.length === 0) return setError("전문 분야를 1개 이상 선택해 주세요.");
    if (!adult) return setError("만 14세 이상만 가입할 수 있어요.");
    if (!agree) return setError("이용약관 및 개인정보 처리방침에 동의해 주세요.");
    if (!sensitive) return setError("건강 관련 정보(민감정보) 처리에 동의해 주세요. 질문·답변에 건강 정보가 포함되기 때문이에요.");
    if (serverMode && role === "therapist") {
      if (!docs.license?.length) return setError("면허증 사본을 첨부해 주세요.");
      if (years >= 3 && !docs.career?.length) return setError("경력 3년 이상이면 경력증명서를 첨부해 주세요.");
      if (degree !== "none" && !docs.degree?.length) return setError("학위증명서를 첨부해 주세요.");
    }
    setBusy(true);
    const r = await signup({
      name: name.trim(),
      role,
      therapist:
        role === "therapist"
          ? {
              license,
              experienceYears: years,
              educationHours: hours,
              degree,
              hospitalType,
              hospitalName: hospitalName.trim() || HOSPITAL_TYPES[hospitalType].label,
              specialties,
              bio: bio.trim(),
            }
          : undefined,
      documents: docs,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (serverMode && role === "therapist") return router.push("/signup/pending");
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
            {serverMode ? (
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="text-sm font-bold">증빙 서류 (PDF·JPG·PNG, 파일당 5MB 이하)</div>
                {DOC_FIELDS.map((f) => (
                  <label key={f.kind} className="block text-sm">
                    <span className="font-semibold">{f.label}</span> <span className="text-xs text-slate-400">{f.hint}</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      multiple={f.kind === "education"}
                      onChange={(e) => setDocs((d) => ({ ...d, [f.kind]: Array.from(e.target.files ?? []) }))}
                      className="mt-1 block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-semibold"
                    />
                  </label>
                ))}
                <p className="text-xs text-slate-400">운영팀이 서류를 확인한 뒤(영업일 1~2일) 등급이 확정되고 답변·라운지를 이용할 수 있어요.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">경력·교육·학위는 증빙 서류(경력증명서, 학회 교육 이수증, 학위증명서) 심사 후 최종 등급에 반영됩니다.</p>
            )}
          </>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>(필수) 만 14세 이상입니다.</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
          <span>
            (필수) 질문·답변에 포함되는 <b>건강 관련 정보(민감정보)</b>를 서비스 제공 목적으로 처리하는 데 동의합니다.{" "}
            <a href="/privacy#sensitive" target="_blank" className="underline">
              자세히
            </a>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            <a href="/terms" target="_blank" className="underline">이용약관</a>,{" "}
            <a href="/privacy" target="_blank" className="underline">개인정보 처리방침</a>에 동의합니다. (필수)
            {role === "patient" && " 답변은 건강 정보 제공 목적이며 진단·처방을 대신하지 않음을 이해합니다."}
          </span>
        </label>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <button type="submit" disabled={busy} className="btn-primary mt-6 w-full !py-3.5 text-base">
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
