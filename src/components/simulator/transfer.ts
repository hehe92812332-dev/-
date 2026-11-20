// 워커 ↔ 화면 간 전달용 경량 결과 (함수·PoseSpec 제거)
import type { InputIssue, Profile } from "@/lib/biomech/anthropometry";
import type { Finding } from "@/lib/biomech/analysis";
import type { RegionRisk } from "@/lib/biomech/injury";
import type { Mat3, Vec3 } from "@/lib/biomech/math";
import type { Angles, Joints } from "@/lib/biomech/pose";
import type { SimResult } from "@/lib/biomech/simulate";
import type { ContactLoad, FrameMeta, LoadState, Metric, Surface } from "@/lib/biomech/types";

export interface SimRequest {
  id: number;
  profile: Profile;
  moveId: string;
  loadKg: number;
}

export interface LiteFrame {
  t: number;
  time: number;
  phase: string;
  j: Joints;
  R: { pelvis: Mat3; thorax: Mat3; head: Mat3; footL: Mat3; footR: Mat3; lumbar: Mat3 };
  com: Vec3;
  load?: LoadState;
  contacts: { id: string; group: string; pts: Vec3[] }[];
  surfaces?: Surface[];
  grf: number;
  loads: ContactLoad[];
  angles: Angles;
  moments: { ankle: number; knee: number; hip: number; lumbar: number; shoulder: number };
  meta: FrameMeta;
  kneeMedial: [number, number];
  support: { inside: boolean; margin: number };
}

export interface LiteResult {
  moveId: string;
  profile: Profile;
  issues: InputIssue[];
  loadKg: number;
  duration: number;
  frames: LiteFrame[];
  ref?: LiteFrame[];
  metrics: Metric[];
  findings: Finding[];
  injury: RegionRisk[];
  bodyMass: number;
  ms: number;
  warnings: string[];
}

const lite = (f: SimResult["frames"][number]): LiteFrame => ({
  t: f.t,
  time: f.time,
  phase: f.phase,
  j: f.pose.j,
  R: f.pose.R,
  com: f.com,
  load: f.load,
  contacts: f.contacts.map((c) => ({ id: c.id, group: c.group, pts: c.pts })),
  surfaces: f.surfaces,
  grf: f.grf,
  loads: f.loads,
  angles: f.angles,
  moments: f.moments,
  meta: f.meta,
  kneeMedial: f.kneeMedial,
  support: f.support,
});

export function pack(r: SimResult, ms: number): LiteResult {
  return {
    moveId: r.movement.id,
    profile: r.profile,
    issues: r.issues,
    loadKg: r.loadKg,
    duration: r.duration,
    frames: r.frames.map(lite),
    ref: r.ref?.frames.map(lite),
    metrics: r.metrics,
    findings: r.findings,
    injury: r.injury,
    bodyMass: r.profile.body.weightKg,
    ms,
    warnings: r.solverWarnings,
  };
}
