"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultProfile, type Profile } from "@/lib/biomech/anthropometry";
import { MOVEMENTS } from "@/lib/biomech/moves";
import { Inputs } from "./Inputs";
import { Library } from "./Library";
import { Btn, Label, Seg, Toggle, fmt } from "./parts";
import { Charts, Findings, Injury, Metrics, Now, Summary } from "./Results";
import { decodeProfile, encodeProfile, loadSaved, save, useSimulation } from "./state";
import type { LiteFrame } from "./transfer";
import { Viewport, type ViewOpts } from "./Viewport";

type Preset = "front" | "side" | "oblique" | "back" | "top";
type MobileTab = "move" | "body" | "diag" | "data";

const DEFAULT_MOVE = "high-bar-squat";

export function Simulator() {
  const [profile, setProfile] = useState<Profile>(() => defaultProfile());
  const [moveId, setMoveId] = useState(DEFAULT_MOVE);
  const [loads, setLoads] = useState<Record<string, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const move = MOVEMENTS.find((m) => m.id === moveId) ?? MOVEMENTS[0];
  const loadKg = move.load ? (loads[move.id] ?? move.load.default) : 0;
  const { result, pending, error } = useSimulation(profile, move.id, loadKg);

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<"0.25" | "0.5" | "1">("1");
  const tRef = useRef(0);
  const [tUi, setTUi] = useState(0);
  const [frame, setFrame] = useState<LiteFrame | null>(null);
  const [opts, setOpts] = useState<ViewOpts>({ risk: true, ghost: false, trails: false, overlays: true, labels: true });
  const [preset, setPreset] = useState<Preset>("oblique");
  const [nonce, setNonce] = useState(0);
  const [leftTab, setLeftTab] = useState<"move" | "body">("move");
  const [rightTab, setRightTab] = useState<"diag" | "data">("diag");
  const [mobileTab, setMobileTab] = useState<MobileTab>("diag");
  const [copied, setCopied] = useState(false);

  // 공유 링크 / 저장값 불러오기
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const fromUrl = decodeProfile(sp.get("p"));
    const saved = loadSaved();
    const m = sp.get("m") ?? saved.moveId;
    if (fromUrl) setProfile(fromUrl);
    else if (saved.profile) setProfile(saved.profile);
    if (m && MOVEMENTS.some((x) => x.id === m)) setMoveId(m);
    const w = Number(sp.get("w"));
    const l = { ...(saved.loads ?? {}) };
    if (m && Number.isFinite(w) && sp.get("w") !== null) l[m] = w;
    setLoads(l);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) save({ profile, moveId, loads });
  }, [profile, moveId, loads, hydrated]);

  // 동작 바뀌면 기본 시점·속도
  useEffect(() => {
    const v = move.view?.yaw;
    setPreset(v === undefined ? "oblique" : v >= 60 ? "side" : v <= 15 ? "front" : "oblique");
    setNonce((n) => n + 1);
    tRef.current = 0;
    setSpeed(move.kind === "dynamic" && move.id.startsWith("sprint") ? "0.25" : move.kind === "dynamic" ? "0.5" : "1");
  }, [move.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 재생
  const duration = result?.duration ?? 3;
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (playing) tRef.current = (tRef.current + (dt * Number(speed)) / Math.max(0.2, duration)) % 1;
      if (now - lastUi > 66) {
        lastUi = now;
        setTUi(tRef.current);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  const seek = useCallback((t: number) => {
    tRef.current = Math.min(0.999, Math.max(0, t));
    setTUi(tRef.current);
    setPlaying(false);
  }, []);

  const patch = useCallback((fn: (p: Profile) => Profile) => setProfile((p) => fn(p)), []);
  const onFrame = useCallback((f: LiteFrame) => setFrame(f), []);

  const share = async () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("m", move.id);
    url.searchParams.set("p", encodeProfile(profile));
    if (move.load) url.searchParams.set("w", String(loadKg));
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("아래 주소를 복사하세요", url.toString());
    }
  };

  const findingsCount = result?.findings.filter((f) => f.cause !== "입력").length ?? 0;

  const left = (
    <>
      <div className="sticky top-0 z-10 -mx-4 border-b border-[#e3dfd6] bg-[#f7f5f0] px-4 pb-2.5 pt-3">
        <Seg value={leftTab} onChange={setLeftTab} ariaLabel="왼쪽 패널" options={[{ value: "move", label: "동작" }, { value: "body", label: "체형 · 가동성" }]} />
      </div>
      <div className="pt-3">{leftTab === "move" ? <Library moveId={move.id} onPick={setMoveId} /> : <Inputs profile={profile} patch={patch} />}</div>
    </>
  );

  const diag = result && (
    <div className="space-y-5">
      <div>
        <Label n="A" right={<span className="text-[11px] text-[#9a958c]">0~100 · 높을수록 위험</span>}>
          부위별 부상 위험도
        </Label>
        <div className="mt-2.5">
          <Injury list={result.injury} onSeek={seek} />
        </div>
      </div>
      <div>
        <Label n="B" right={<Summary res={result} />}>
          보상 패턴 진단
        </Label>
        <div className="mt-2.5">
          <Findings findings={result.findings} onSeek={seek} />
        </div>
      </div>
      <div>
        <Label n="C">핵심 수치 · 같은 키 표준 체형 비교</Label>
        <div className="mt-2">
          <Metrics metrics={result.metrics} />
        </div>
      </div>
    </div>
  );

  const data = result && (
    <div className="space-y-5">
      <div>
        <Label n="D">현재 프레임</Label>
        <div className="mt-2.5">
          <Now f={frame} bodyMass={result.bodyMass} />
        </div>
      </div>
      <div>
        <Label n="E" right={<span className="text-[11px] text-[#9a958c]">파랑 좌 · 주황 우</span>}>
          한 주기 그래프
        </Label>
        <div className="mt-2.5">
          <Charts res={result} t={tUi} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-[#f2f0eb] text-[#161616]">
      <div className="lg:grid lg:h-[calc(100dvh-64px)] lg:grid-cols-[264px_minmax(0,1fr)_372px]">
        {/* 왼쪽 */}
        <aside className="hidden overflow-y-auto border-r border-[#e3dfd6] bg-[#f7f5f0] px-4 pb-10 lg:block">{left}</aside>

        {/* 가운데 */}
        <main className="flex min-w-0 flex-col">
          <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[#e3dfd6] bg-[#fbfaf7] px-4 py-2.5">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9a958c]">
                {move.category === "gym" ? "웨이트 트레이닝" : move.category === "sport" ? "스포츠 퍼포먼스" : "체대입시 실기"} · {move.group}
              </div>
              <h1 className="truncate text-[20px] font-extrabold tracking-tight">
                {move.name} <span className="text-[13px] font-semibold text-[#9a958c]">{move.en}</span>
              </h1>
            </div>
            {move.load && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-[#6e6a63]">{move.load.label}</span>
                <button aria-label="무게 줄이기" onClick={() => setLoads((l) => ({ ...l, [move.id]: Math.max(move.load!.min, loadKg - move.load!.step) }))} className="size-7 rounded-[5px] border border-[#d9d4c9] bg-white text-[15px] font-bold leading-none">
                  −
                </button>
                <input
                  type="range"
                  aria-label={`${move.load.label} 무게`}
                  min={move.load.min}
                  max={move.load.max}
                  step={move.load.step}
                  value={loadKg}
                  onChange={(e) => setLoads((l) => ({ ...l, [move.id]: Number(e.target.value) }))}
                  className="sim-range w-28 sm:w-40"
                />
                <button aria-label="무게 늘리기" onClick={() => setLoads((l) => ({ ...l, [move.id]: Math.min(move.load!.max, loadKg + move.load!.step) }))} className="size-7 rounded-[5px] border border-[#d9d4c9] bg-white text-[15px] font-bold leading-none">
                  +
                </button>
                <span className="w-16 text-right text-[15px] font-extrabold tabular-nums">
                  {fmt(loadKg, move.load.step < 1 ? 1 : 0)}
                  <span className="ml-0.5 text-[11px] text-[#9a958c]">kg</span>
                </span>
              </div>
            )}
          </header>

          <div className="relative h-[58vh] min-h-[360px] bg-[#f6f4ef] lg:h-auto lg:flex-1">
            <Viewport result={result} tRef={tRef} opts={opts} onFrame={onFrame} preset={preset} presetNonce={nonce} />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
              <span className="pointer-events-auto w-fit rounded-[4px] bg-[#161616] px-2 py-[3px] text-[12px] font-bold text-white">{frame?.phase ?? "계산 중"}</span>
              {pending && <span className="w-fit rounded-[4px] bg-white/90 px-2 py-[2px] text-[11px] font-semibold text-[#6e6a63] ring-1 ring-[#e3dfd6]">다시 계산하는 중…</span>}
              {error && <span className="w-fit rounded-[4px] bg-white px-2 py-[2px] text-[11px] font-semibold text-[#c8402a] ring-1 ring-[#c8402a]/30">계산 오류: {error}</span>}
            </div>
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
              <Seg
                size="sm"
                value={preset}
                onChange={(v) => {
                  setPreset(v);
                  setNonce((n) => n + 1);
                }}
                ariaLabel="시점"
                options={[
                  { value: "front", label: "정면" },
                  { value: "side", label: "측면" },
                  { value: "oblique", label: "사선" },
                  { value: "back", label: "후면" },
                  { value: "top", label: "위" },
                ]}
              />
              <div className="flex flex-wrap justify-end gap-1">
                <Toggle on={opts.risk} onChange={(v) => setOpts((o) => ({ ...o, risk: v }))}>
                  부상 위험
                </Toggle>
                <Toggle on={opts.ghost} onChange={(v) => setOpts((o) => ({ ...o, ghost: v }))}>
                  <span className="hidden sm:inline">표준 체형 겹치기</span>
                  <span className="sm:hidden">표준 겹치기</span>
                </Toggle>
                <Toggle on={opts.trails} onChange={(v) => setOpts((o) => ({ ...o, trails: v }))}>
                  궤적
                </Toggle>
                <Toggle on={opts.overlays} onChange={(v) => setOpts((o) => ({ ...o, overlays: v }))}>
                  분석선
                </Toggle>
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-2 left-3 hidden text-[11px] leading-4 text-[#8a857c] sm:block">
              <span className="font-semibold text-[#0f8b6c]">●</span> 무게중심 · <span className="font-semibold text-[#7a5cd6]">―</span> 발끝 방향 · <span className="font-semibold text-[#d9433b]">―</span> 무릎 방향 · <span className="font-semibold text-[#d9432b]">●</span> 부상 위험 부위 · 드래그로 회전, 휠로 확대
            </div>
          </div>

          {/* 타임라인 */}
          <div className="sim-track flex items-center gap-3 border-y border-[#e3dfd6] bg-[#fbfaf7] px-4 py-2 lg:border-b-0">
            <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "일시정지" : "재생"} className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-[#161616] text-white">
              {playing ? (
                <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
                  <rect x="2" y="1.5" width="3" height="9" />
                  <rect x="7" y="1.5" width="3" height="9" />
                </svg>
              ) : (
                <svg viewBox="0 0 12 12" className="size-3" fill="currentColor">
                  <path d="M3 1.5 L10.5 6 L3 10.5 Z" />
                </svg>
              )}
            </button>
            <input type="range" aria-label="동작 진행" min={0} max={999} value={Math.round(tUi * 999)} onChange={(e) => seek(Number(e.target.value) / 999)} className="sim-range min-w-0 flex-1" />
            <span className="w-[86px] shrink-0 text-right text-[12px] tabular-nums text-[#6e6a63]">
              {(tUi * duration).toFixed(2)} / {duration.toFixed(2)}초
            </span>
            <Seg size="sm" value={speed} onChange={setSpeed} ariaLabel="재생 속도" options={[{ value: "0.25", label: "¼×" }, { value: "0.5", label: "½×" }, { value: "1", label: "1×" }]} />
          </div>

          {/* 모바일 탭 */}
          <div className="lg:hidden">
            <div className="sticky top-16 z-20 border-b border-[#e3dfd6] bg-[#f7f5f0] px-4 py-2">
              <Seg
                value={mobileTab}
                onChange={setMobileTab}
                ariaLabel="패널"
                options={[
                  { value: "move", label: "동작" },
                  { value: "body", label: "체형" },
                  { value: "diag", label: `진단${findingsCount ? ` ${findingsCount}` : ""}` },
                  { value: "data", label: "수치" },
                ]}
              />
            </div>
            <div className="px-4 pb-28 pt-4">
              {mobileTab === "move" && <Library moveId={move.id} onPick={(id) => { setMoveId(id); setMobileTab("diag"); }} />}
              {mobileTab === "body" && <Inputs profile={profile} patch={patch} />}
              {mobileTab === "diag" && (diag ?? <p className="text-[13px] text-[#6e6a63]">계산 중…</p>)}
              {mobileTab === "data" && (data ?? <p className="text-[13px] text-[#6e6a63]">계산 중…</p>)}
            </div>
          </div>
        </main>

        {/* 오른쪽 */}
        <aside className="hidden overflow-y-auto border-l border-[#e3dfd6] bg-[#f7f5f0] px-4 pb-10 lg:block">
          <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-[#e3dfd6] bg-[#f7f5f0] px-4 pb-2.5 pt-3">
            <Seg
              value={rightTab}
              onChange={setRightTab}
              ariaLabel="오른쪽 패널"
              options={[
                { value: "diag", label: `진단${findingsCount ? ` ${findingsCount}` : ""}` },
                { value: "data", label: "수치 · 그래프" },
              ]}
            />
            <Btn onClick={share} title="현재 체형과 동작을 링크로 복사">
              {copied ? "복사됨" : "링크 복사"}
            </Btn>
          </div>
          <div className="pt-4">{rightTab === "diag" ? diag : data}</div>
          <p className="mt-8 border-t border-[#e3dfd6] pt-3 text-[11px] leading-relaxed text-[#9a958c]">
            인체 분절 비율(Winter·Dempster)과 정역학·탄도 계산으로 추정한 결과입니다. 실제 동작은 근력·기술·통증에 따라 달라지며, 의학적 진단을 대신하지 않습니다.
            {result && <span className="block">계산 {Math.round(result.ms)}ms · 프레임 {result.frames.length}개</span>}
          </p>
        </aside>
      </div>
    </div>
  );
}

export default Simulator;
