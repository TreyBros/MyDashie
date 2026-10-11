import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { DashboardManifest, RefreshLogEntry } from "@shared/types";
import { formatCredits } from "@shared/pricing";
import { GlyphCheck, GlyphClose, Pic } from "./icons";
import { IconButton } from "./ui";
import { relativeTime } from "../lib/store";

function fmt(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const TRIGGER: Record<RefreshLogEntry["trigger"], string> = { schedule: "Scheduled", manual: "You", catchup: "Catch-up" };

/** Every refresh this dashboard has run: when, what triggered it, how long, what it pulled, and what it cost. */
export function RefreshHistory({ d, onClose }: { d: DashboardManifest; onClose: () => void }) {
  const [log, setLog] = useState<RefreshLogEntry[] | null>(null);
  useEffect(() => {
    (window.dash.dashboards.refreshLog(d.id) as Promise<RefreshLogEntry[]>).then((l) => setLog([...l].reverse())).catch(() => setLog([]));
  }, [d.id, d.dataFetchedAt]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = log?.reduce((a, e) => a + (e.credits ?? 0), 0) ?? 0;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-label="Refresh history" className="pop-in fixed left-1/2 top-1/2 z-40 flex max-h-[80vh] w-[min(720px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_30px_80px_-30px_rgba(28,27,40,0.5)]">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lilac-soft/70">
            <Pic name="schedule" size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-tight">Refresh history</h2>
            <p className="text-[12.5px] text-muted">
              {log === null ? "Loading…" : log.length === 0 ? "No refreshes yet. Refreshes replay the saved data steps without AI." : `${log.length} refresh${log.length === 1 ? "" : "es"} · ${formatCredits(total)} credits in total · ${d.spend ? `${formatCredits(d.spend.credits)} credits lifetime for this dashboard` : ""}`}
            </p>
          </div>
          <IconButton label="Close" onClick={onClose}><GlyphClose size={16} /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {log && log.length > 0 && (
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0 bg-surface text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">Trigger</th>
                  <th className="px-2 py-2">Result</th>
                  <th className="px-2 py-2 text-right">Pulled</th>
                  <th className="px-2 py-2 text-right">Took</th>
                  <th className="px-2 py-2 text-right">Credits</th>
                </tr>
              </thead>
              <tbody>
                {log.map((e, i) => {
                  const rows = e.rows ? Object.values(e.rows).reduce((a, b) => a + b, 0) : null;
                  const detail = e.rows ? Object.entries(e.rows).map(([k, v]) => `${k}: ${v.toLocaleString()}`).join("\n") : undefined;
                  return (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="px-2 py-2 whitespace-nowrap text-ink" title={new Date(e.at).toLocaleString()}>{relativeTime(e.at)}</td>
                      <td className="px-2 py-2 text-ink-2">{TRIGGER[e.trigger] ?? e.trigger}</td>
                      <td className="px-2 py-2">
                        <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold", e.ok ? (e.healed ? "bg-peach-soft text-[#8a4a12] dark:text-[#ffc89c]" : "bg-mint-soft text-[#1f8a5b]") : "bg-rose-soft text-danger")}>
                          {e.ok ? <GlyphCheck size={11} /> : <Pic name="alert" size={11} />} {e.ok ? (e.healed ? "Repaired" : "Up to date") : "Failed"}
                        </span>
                        {(e.healNote || (!e.ok && e.error)) && <div className="mt-1 max-w-[280px] text-[11.5px] leading-snug text-muted">{e.healNote ?? e.error}</div>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-2" title={detail}>
                        {rows !== null ? `${rows.toLocaleString()} rows` : "—"}
                        {e.toolCalls !== undefined && <div className="text-[11px] text-muted">{e.toolCalls} app call{e.toolCalls === 1 ? "" : "s"}</div>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-2">{fmt(e.durationMs)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{e.credits !== undefined ? formatCredits(e.credits) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
