import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { PlanStep } from "@shared/types";
import type { ActivityItem } from "../lib/store";

/**
 * Floats over the dashboard while Dashie is still working on it, so the page can show its
 * progress in place (cards landing one by one) without the user wondering whether it's done.
 */
export function BuildStrip({ items, plan, mode, startedAt }: { items: ActivityItem[]; plan?: PlanStep[]; mode: "build" | "edit" | "ask"; startedAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const tool = [...items].reverse().find((x) => x.kind === "tool");
  const caption = tool?.running ? tool.label : tool?.label ?? (mode === "edit" ? "Working on your change" : "Getting started");
  const total = plan?.length ?? 0;
  const done = plan?.filter((p) => p.status === "done").length ?? 0;
  const current = plan?.find((p) => p.status === "in_progress")?.step;
  const pct = total ? Math.max(0.08, done / total) : null;
  const s = Math.round((Date.now() - startedAt) / 1000);
  const elapsed = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;

  return (
    <div className="pop-in pointer-events-none absolute right-4 top-3 z-10 w-[min(460px,calc(100%-32px))]">
      <div className="overflow-hidden rounded-2xl border border-lilac/30 bg-surface/95 shadow-[0_18px_40px_-20px_rgba(124,108,246,0.6)] backdrop-blur">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lilac-soft/80">
            <img src="dash://brand/dashy.png" width={26} height={26} alt="" draggable={false} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span key={caption} className="caption-in min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                {mode === "edit" ? "Dashie is updating this dashboard" : "Dashie is still building"} · {caption}…
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">{elapsed}</span>
            </div>
            {total > 0 && (
              <div className="mt-0.5 truncate text-[11.5px] text-muted">
                Step {Math.min(done + 1, total)} of {total}
                {current ? ` · ${current}` : ""}
              </div>
            )}
          </div>
        </div>
        <div className="h-1 w-full bg-surface-2">
          <div
            className={clsx("h-full rounded-r-full bg-lilac transition-[width] duration-700", pct === null && "strip-indeterminate")}
            style={{ width: pct === null ? "35%" : `${Math.round(pct * 100)}%`, transitionTimingFunction: "var(--ease-out-strong)" }}
          />
        </div>
      </div>
    </div>
  );
}
