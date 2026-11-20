"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { MOVEMENTS } from "@/lib/biomech/moves";
import type { Vec3 } from "@/lib/biomech/math";
import { frameAt } from "./state";
import type { LiteFrame, LiteResult } from "./transfer";
import type { Rig } from "./rig";

export interface ViewOpts {
  risk: boolean;
  dark: boolean;
  skin: boolean;
  ghost: boolean;
  trails: boolean;
  overlays: boolean;
  labels: boolean;
}

type Preset = "front" | "side" | "oblique" | "back" | "top";

interface Props {
  result: LiteResult | null;
  tRef: MutableRefObject<number>;
  opts: ViewOpts;
  onFrame?: (f: LiteFrame) => void;
  preset: Preset;
  presetNonce: number;
}

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export function Viewport({ result, tRef, opts, onFrame, preset, presetNonce }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const labels = useRef<Record<string, HTMLDivElement | null>>({});
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const resRef = useRef(result);
  resRef.current = result;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const lastEmit = useRef(0);

  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    (async () => {
      try {
        const { Rig } = await import("./rig");
        if (!alive || !host.current) return;
        const r = new Rig(host.current);
        rig.current = r;
        ro = new ResizeObserver(() => r.resize());
        ro.observe(host.current);
        setReady(true);
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      rig.current?.dispose();
      rig.current = null;
    };
  }, []);

  // 카메라 프리셋
  useEffect(() => {
    const r = rig.current;
    if (!r || !result) return;
    const f = result.frames[0];
    r.view(preset, result.profile.body.heightCm / 100, f.com);
  }, [preset, presetNonce, ready, result?.moveId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const r = rig.current;
    if (!r || !result) return;
    const hm = result.profile.body.heightCm / 100;
    r.setBody(hm, result.profile.body.weightKg / (hm * hm));
    r.setRisk(result.injury);
    const m = MOVEMENTS.find((x) => x.id === result.moveId);
    r.setFollow(!!m?.view?.followZ);
  }, [ready, result]);

  // 그리기 루프
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = rig.current,
        res = resRef.current;
      if (!r || !res || !res.frames.length) return;
      const m = MOVEMENTS.find((x) => x.id === res.moveId);
      const cyclic = !!m?.dynamics?.cyclic;
      const t = tRef.current;
      const f = frameAt(res.frames, t, cyclic);
      const g = res.ref ? frameAt(res.ref, t, cyclic) : undefined;
      const trails = {
        com: res.frames.map((x) => x.com),
        bar: res.frames[0].load?.kind === "barbell" ? res.frames.map((x) => x.load!.center as Vec3) : undefined,
      };
      r.setFrame(f, g, optsRef.current, trails);
      placeLabels(r, f, res);
      const now = performance.now();
      if (onFrame && now - lastEmit.current > 90) {
        lastEmit.current = now;
        onFrame(f);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, onFrame, tRef]);

  function placeLabels(r: Rig, f: LiteFrame, res: LiteResult) {
    const show = optsRef.current.labels && optsRef.current.overlays;
    const set = (key: string, p: Vec3 | null, text: string, dx = 0, dy = 0) => {
      const el = labels.current[key];
      if (!el) return;
      if (!show || !p) {
        el.style.opacity = "0";
        return;
      }
      if (el.textContent !== text) el.textContent = text;
      const s = r.project(p);
      el.style.opacity = s.visible ? "1" : "0";
      const ax = key === "footR" || key === "kneeR" ? -el.offsetWidth : 0;
      el.style.transform = `translate(${Math.round(s.x + dx + ax)}px, ${Math.round(s.y + dy - 9)}px)`;
    };
    const bw = res.bodyMass;
    for (const k of ["L", "R"] as const) {
      const ld = f.loads.find((l) => l.id === k);
      if (ld && ld.share > 0.001) {
        const p: Vec3 = [ld.cop[0] + (k === "L" ? 0.06 : -0.06), ld.cop[1], ld.cop[2]];
        set(`foot${k}`, p, `${k === "L" ? "좌" : "우"} ${Math.round(ld.share * 100)}% | ${Math.round(ld.kg)} kg`, k === "L" ? 6 : -6, 12);
      } else set(`foot${k}`, null, "");
      const km = f.kneeMedial[k === "L" ? 0 : 1] * 100;
      const kneeTxt = Math.abs(km) >= 1 ? `${k === "L" ? "좌" : "우"}무릎 ${km > 0 ? "안쪽" : "바깥"} ${r1(Math.abs(km))}cm` : `${k === "L" ? "좌" : "우"}무릎`;
      set(`knee${k}`, f.j[`knee${k}`], kneeTxt, k === "L" ? 12 : -12, -4);
    }
    const hands = f.loads.filter((l) => l.id === "handL" || l.id === "handR");
    if (hands.length) {
      const sh = hands.reduce((a, l) => a + l.share, 0);
      set("hands", f.j.wrL, `손 ${Math.round(sh * 100)}% | ${Math.round(hands.reduce((a, l) => a + l.kg, 0))} kg`, 10, 10);
    } else set("hands", null, "");
    const mid: Vec3 = [f.com[0], f.com[1] * 0.35, f.com[2]];
    const fwd = f.support.margin;
    const m = MOVEMENTS.find((x) => x.id === res.moveId);
    const msg =
      f.contacts.length === 0
        ? `체공 · 높이 ${Math.round(f.com[1] * 100)}cm`
        : m?.kind === "dynamic" || m?.support !== "feet"
          ? `높이 ${Math.round(f.com[1] * 100)}cm`
          : f.support.inside
            ? `지지면 안 ${r1(fwd * 100)}cm`
            : `지지면 밖 ${r1(-fwd * 100)}cm`;
    set("com", mid, `무게중심 · ${msg}`, 8, 0);
    void bw;
  }

  return (
    <div className="relative h-full w-full select-none overflow-hidden" aria-label="3D 동작 화면">
      <div ref={host} className="absolute inset-0" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[#6e6a63]">
          이 브라우저에서는 3D 화면(WebGL)을 쓸 수 없습니다. 오른쪽 분석 결과는 그대로 볼 수 있습니다.
        </div>
      )}
      <div className="pointer-events-none absolute inset-0">
        {["footL", "footR", "kneeL", "kneeR", "com", "hands"].map((k) => (
          <div
            key={k}
            ref={(el) => {
              labels.current[k] = el;
            }}
            className={`absolute left-0 top-0 whitespace-nowrap rounded-[3px] px-1.5 py-[1px] text-[11px] font-semibold tabular-nums leading-4 opacity-0 transition-opacity ${
              k === "footL"
                ? "bg-white/90 text-[#2f6fde] ring-1 ring-[#2f6fde]/30"
                : k === "footR"
                  ? "bg-white/90 text-[#c4521f] ring-1 ring-[#e0662f]/30"
                  : k === "com"
                    ? "bg-white/90 text-[#0f8b6c] ring-1 ring-[#0f8b6c]/30"
                    : "bg-white/80 text-[#3c3a36]"
            }`}
            style={{ willChange: "transform" }}
          />
        ))}
      </div>
    </div>
  );
}
