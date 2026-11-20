"use client";

import { useEffect, useRef, useState } from "react";
import { defaultProfile, sanitizeProfile, standardBody, type Profile } from "@/lib/biomech/anthropometry";
import type { LiteFrame, LiteResult } from "./transfer";

/* ───────────── 프로필 직렬화 (공유 링크) ───────────── */

const ORDER: [keyof Profile, string][] = [
  ["body", "heightCm"],
  ["body", "weightKg"],
  ["body", "footMm"],
  ["body", "thighCm"],
  ["body", "shankCm"],
  ["body", "upperArmCm"],
  ["body", "forearmCm"],
  ["body", "handCm"],
  ["body", "torsoCm"],
  ["body", "shoulderCm"],
  ["body", "hipCm"],
  ["body", "legDiffCm"],
  ["mobility", "ankleDF"],
  ["mobility", "hipFlex"],
  ["mobility", "hamstring"],
  ["mobility", "shoulderFlex"],
  ["mobility", "thoracicRot"],
  ["capacity", "power"],
  ["capacity", "control"],
  ["capacity", "asym"],
];

export function encodeProfile(p: Profile): string {
  const nums = ORDER.map(([g, k]) => String(Math.round(((p[g] as unknown as Record<string, number>)[k] ?? 0) * 10) / 10));
  return ["2" + p.body.sex, ...nums].join("_");
}

export function decodeProfile(s: string | null | undefined): Profile | null {
  if (!s) return null;
  const parts = s.split("_");
  if (parts.length !== ORDER.length + 1 || !parts[0].startsWith("2")) return null; // 예전 형식 링크는 무시
  const sex = parts[0].endsWith("f") ? "f" : "m";
  const p = defaultProfile();
  p.body.sex = sex;
  ORDER.forEach(([g, k], i) => {
    const v = Number(parts[i + 1]);
    if (Number.isFinite(v)) (p[g] as unknown as Record<string, number>)[k] = v;
  });
  return sanitizeProfile(p).profile;
}

const LS = "pt-motion-sim:v1";

export function loadSaved(): { profile?: Profile; moveId?: string; loads?: Record<string, number> } {
  try {
    const raw = window.localStorage.getItem(LS);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return { profile: v.profile ? sanitizeProfile(v.profile).profile : undefined, moveId: v.moveId, loads: v.loads };
  } catch {
    return {};
  }
}

export function save(v: { profile: Profile; moveId: string; loads: Record<string, number> }) {
  try {
    window.localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* 저장 불가 (사생활 보호 모드 등) — 무시 */
  }
}

/** 키·성별만 바꾸고 분절은 표준 비율로 다시 채우기 */
export function rescaleBody(p: Profile, heightCm: number): Profile {
  const old = p.body;
  const std0 = standardBody(old.heightCm, old.sex);
  const std1 = standardBody(heightCm, old.sex);
  const k = (key: keyof typeof std0) => (old[key] as number) / (std0[key] as number);
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    ...p,
    body: {
      ...old,
      heightCm,
      weightKg: r(old.weightKg * (heightCm / old.heightCm) ** 2),
      footMm: Math.round(((std1.footMm * k("footMm")) / 5)) * 5,
      thighCm: r(std1.thighCm * k("thighCm")),
      shankCm: r(std1.shankCm * k("shankCm")),
      upperArmCm: r(std1.upperArmCm * k("upperArmCm")),
      forearmCm: r(std1.forearmCm * k("forearmCm")),
      handCm: r(std1.handCm * k("handCm")),
      torsoCm: r(std1.torsoCm * k("torsoCm")),
      shoulderCm: r(std1.shoulderCm * k("shoulderCm")),
      hipCm: r(std1.hipCm * k("hipCm")),
    },
  };
}

/* ───────────── 계산 워커 ───────────── */

export function useSimulation(profile: Profile, moveId: string, loadKg: number) {
  const [result, setResult] = useState<LiteResult | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const latest = useRef(0);
  const fallback = useRef(false);

  useEffect(() => {
    try {
      // 독립 실행 번들(정적 호스팅)에서는 전역으로 워커 파일 경로를 넘긴다
      const standalone = (globalThis as { __SIM_WORKER_URL?: string }).__SIM_WORKER_URL;
      worker.current = standalone ? new Worker(standalone) : new Worker(new URL("./sim.worker.ts", import.meta.url));
      worker.current.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: LiteResult; error?: string }>) => {
        if (e.data.id !== latest.current) return;
        setPending(false);
        if (e.data.ok && e.data.result) {
          setResult(e.data.result);
          setError(null);
        } else setError(e.data.error ?? "계산 중 오류가 발생했습니다");
      };
      worker.current.onerror = () => {
        fallback.current = true;
      };
    } catch {
      fallback.current = true;
    }
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    setPending(true);
    const id = ++seq.current;
    latest.current = id;
    const h = window.setTimeout(async () => {
      if (worker.current && !fallback.current) {
        worker.current.postMessage({ id, profile, moveId, loadKg });
      } else {
        // 워커를 못 쓰는 환경: 메인 스레드에서 계산
        const [{ simulate }, { pack }] = await Promise.all([import("@/lib/biomech/simulate"), import("./transfer")]);
        try {
          const t0 = performance.now();
          const r = pack(simulate(profile, moveId, { loadKg, frames: 120 }), performance.now() - t0);
          if (latest.current === id) {
            setResult(r);
            setPending(false);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setPending(false);
        }
      }
    }, 80);
    return () => window.clearTimeout(h);
  }, [profile, moveId, loadKg]);

  return { result, pending, error };
}

/* ───────────── 프레임 보간 ───────────── */

export function frameAt(frames: LiteFrame[], t: number, cyclic: boolean): LiteFrame {
  const n = frames.length;
  if (!n) throw new Error("no frames");
  const x = cyclic ? (((t % 1) + 1) % 1) * n : Math.min(1, Math.max(0, t)) * (n - 1);
  const i0 = Math.floor(x) % n;
  const i1 = cyclic ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
  const u = x - Math.floor(x);
  const a = frames[i0],
    b = frames[i1];
  if (u < 1e-3 || i0 === i1) return a;
  // 앞뒤 프레임까지 쓰는 3차(Catmull-Rom) 보간 → 속도가 끊기지 않는다
  const iPrev = cyclic ? (i0 - 1 + n) % n : Math.max(0, i0 - 1);
  const iNext = cyclic ? (i1 + 1) % n : Math.min(n - 1, i1 + 1);
  const pa = frames[iPrev],
    pb = frames[iNext];
  const u2 = u * u,
    u3 = u2 * u;
  const cr = (p0: number, p1: number, p2: number, p3: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  const far = (x: number[], y: number[]) => Math.hypot(x[0] - y[0], x[2] - y[2]) > 0.6;
  const lv = (p: number[], q: number[], p0?: number[], p3?: number[]) => {
    if (!p0 || !p3 || far(p0, p) || far(q, p3)) return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u] as [number, number, number];
    return [cr(p0[0], p[0], q[0], p3[0]), cr(p0[1], p[1], q[1], p3[1]), cr(p0[2], p[2], q[2], p3[2])] as [number, number, number];
  };
  // 순간이동(동작 경계) 은 보간하지 않는다
  const jump = Math.hypot(a.com[0] - b.com[0], a.com[2] - b.com[2]) > 0.6;
  if (jump) return u < 0.5 ? a : b;
  const j = {} as LiteFrame["j"];
  for (const k in a.j) {
    const kk = k as keyof LiteFrame["j"];
    (j as Record<string, number[]>)[k] = lv(a.j[kk], b.j[kk], pa.j[kk], pb.j[kk]);
  }
  const lm = (p: number[], q: number[]) => p.map((v, i) => v + (q[i] - v) * u) as unknown as LiteFrame["R"]["pelvis"];
  const R = {} as LiteFrame["R"];
  for (const k in a.R) (R as Record<string, unknown>)[k] = lm(a.R[k as keyof LiteFrame["R"]], b.R[k as keyof LiteFrame["R"]]);
  const near = u < 0.5 ? a : b;
  return {
    ...near,
    j,
    R,
    com: lv(a.com, b.com, pa.com, pb.com),
    load: a.load && b.load && a.load.kind === b.load.kind ? { ...near.load!, center: lv(a.load.center, b.load.center) } : near.load,
  };
}
