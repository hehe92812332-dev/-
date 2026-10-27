"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Flag, MoreHorizontal, X } from "lucide-react";
import { REPORT_REASONS, type ReportReason } from "@/lib/config";
import { useStore } from "@/lib/store";
import type { ReportTarget } from "@/lib/types";

/** ⋯ 메뉴: 신고하기 / 차단하기 */
export function ReportMenu({
  targetType,
  targetId,
  authorId,
  authorName,
  onMessage,
  className = "",
}: {
  targetType: ReportTarget;
  targetId: string;
  authorId: string;
  authorName: string;
  onMessage?: (tone: "success" | "error", text: string) => void;
  className?: string;
}) {
  const { currentUser, report, block, unblock, blocks } = useStore();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!currentUser || currentUser.id === authorId) return null;
  const blocked = blocks.some((b) => b.userId === currentUser.id && b.blockedId === authorId);
  const notify = (ok: boolean, success: string, error?: string) => onMessage?.(ok ? "success" : "error", ok ? success : (error ?? "오류가 발생했어요."));

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button onClick={() => setOpen((v) => !v)} aria-label="더보기" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
          <button
            onClick={() => {
              setOpen(false);
              setDialog(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
          >
            <Flag className="size-4 text-rose-500" /> 신고하기
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              if (blocked) {
                const r = await unblock(authorId);
                notify(r.ok, `${authorName}님 차단을 해제했어요.`, r.ok ? undefined : r.error);
              } else {
                if (!confirm(`${authorName}님을 차단할까요? 이 회원의 답변·메시지가 가려집니다.`)) return;
                const r = await block(authorId);
                notify(r.ok, `${authorName}님을 차단했어요.`, r.ok ? undefined : r.error);
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
          >
            <Ban className="size-4 text-slate-500" /> {blocked ? "차단 해제" : "작성자 차단"}
          </button>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center" onClick={() => setDialog(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-t-3xl bg-white p-6 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold">신고하기</h2>
              <button onClick={() => setDialog(false)} aria-label="닫기" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="size-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">운영팀이 확인 후 조치하며, 신고자 정보는 공개되지 않아요.</p>
            <div className="mt-4 space-y-2">
              {REPORT_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="reason" className="accent-rose-500" checked={reason === r} onChange={() => setReason(r)} />
                  {r}
                </label>
              ))}
            </div>
            <textarea
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="자세한 내용 (선택)"
              className="input mt-3 resize-none"
            />
            <button
              onClick={async () => {
                const r = await report({ targetType, targetId, reason, detail });
                setDialog(false);
                setDetail("");
                notify(r.ok, "신고가 접수되었어요. 운영팀이 확인할게요.", r.ok ? undefined : r.error);
              }}
              className="btn mt-4 w-full bg-rose-600 text-white hover:bg-rose-700"
            >
              신고 접수
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 내가 차단한 회원인지 */
export function useIsBlocked() {
  const { currentUser, blocks } = useStore();
  return (userId: string) => !!currentUser && blocks.some((b) => b.userId === currentUser.id && b.blockedId === userId);
}
