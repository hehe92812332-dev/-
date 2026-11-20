/// <reference lib="webworker" />
import { simulate } from "@/lib/biomech/simulate";
import type { Profile } from "@/lib/biomech/anthropometry";
import { pack, type SimRequest } from "./transfer";

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, profile, moveId, loadKg } = e.data;
  try {
    const t0 = performance.now();
    const r = simulate(profile as Partial<Profile>, moveId, { loadKg, frames: 72, reference: true });
    const out = pack(r, performance.now() - t0);
    (self as unknown as Worker).postMessage({ id, ok: true, result: out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
