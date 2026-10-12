import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { ActivityStep, PlanStep, Stage } from "@shared/types";
import { STAGES } from "@shared/stages";
import { GlyphCheck, GlyphChevron, Pic, Spinner } from "./icons";
import { formatCredits } from "@shared/pricing";

export interface WorkCardProps {
  steps: ActivityStep[];
  startedAt: number;
  endedAt?: number;
  live: boolean;
  ok?: boolean;
  mode?: "build" | "edit" | "heal" | "ask";
  level?: "quick" | "smart" | "max";
  waitingOnUser?: boolean | "question";
  onStop?: () => void;
  defaultOpen?: boolean;
  plan?: PlanStep[];
  /** Credits this run used (shown once it's finished). */
  credits?: number;
}

function fmt(ms: number) {
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * One calm card per request. Collapsed: a live headline, a 5-stage tracker, elapsed time and step count.
 * Expanded: the full timeline grouped by stage. Stays in the chat afterwards as an auditable record.
 */
export function WorkCard({ steps, startedAt, endedAt, live, ok = true, mode = "build", waitingOnUser, onStop, defaultOpen = false, plan, credits, level }: WorkCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const tools = steps.filter((s) => s.kind === "tool");
  const current = [...tools].reverse().find((s) => !s.endedAt) ?? tools[tools.length - 1];
  const narration = [...steps].reverse().find((s) => s.kind === "note");
  const reached = new Set<Stage>(tools.map((s) => s.stage));
  const currentStage: Stage = current?.stage ?? "plan";
  const elapsed = (endedAt ?? now) - startedAt;

  const headline = live
    ? waitingOnUser === "question"
      ? "Waiting for your answers"
      : waitingOnUser
      ? "Waiting for you to connect an app"
      : current
        ? current.label
        : mode === "ask"
          ? "Looking into it"
          : "Getting started"
    : waitingOnUser
      ? "Paused until you connect an app"
      : !ok
        ? "Stopped before finishing"
        : mode === "ask"
          ? "Answered"
          : mode === "edit"
            ? "Updated your dashboard"
            : mode === "heal"
              ? "Repaired the refresh"
              : "Built your dashboard";
  const LEVEL = { quick: "Quick", smart: "Smart", max: "Max" } as const;

  return (
    <div className={clsx("overflow-hidden rounded-2xl border bg-surface transition-colors", live ? "border-lilac/35 shadow-[0_10px_30px_-22px_rgba(124,108,246,0.9)]" : "border-line")}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left" aria-expanded={open}>
        <div className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lilac-soft/70">
          {live ? (
            <img src="dash://brand/dashy.png" width={32} height={32} alt="" draggable={false} />
          ) : ok && !waitingOnUser ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-mint text-white"><GlyphCheck size={14} /></span>
          ) : (
            <Pic name={waitingOnUser ? "apps" : "alert"} size={22} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div key={headline} className={clsx("min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink", live && "caption-in")}>{headline}</div>
            <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
              {fmt(elapsed)} · {tools.length} step{tools.length === 1 ? "" : "s"}
              {!live && credits !== undefined && <span title="Credits used by this request"> · {formatCredits(credits)} cr</span>}
              {level && level !== "smart" && <span title="Power level"> · {LEVEL[level]}</span>}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <StageTrack reached={reached} current={live ? currentStage : null} done={!live && ok && !waitingOnUser} />
            <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-muted">
              {open ? "Hide" : "Details"}
              <GlyphChevron size={12} className={clsx("transition-transform duration-200", open && "rotate-180")} />
            </span>
          </div>
        </div>
      </button>

      {live && narration && !open && (
        <div key={narration.id} className="caption-in border-t border-line px-3 py-2 text-[12.5px] leading-snug text-ink-2">
          {narration.label}
        </div>
      )}

      {plan && plan.length > 0 && (live || open) && <PlanList plan={plan} live={live} />}
      {open && <Timeline steps={steps.filter((s) => s.tool !== "update_plan")} live={live} startedAt={startedAt} />}


    </div>
  );
}

function StageTrack({ reached, current, done }: { reached: Set<Stage>; current: Stage | null; done: boolean }) {
  const lastReached = STAGES.reduce((acc, s, i) => (reached.has(s.id) ? i : acc), -1);
  return (
    <div className="flex min-w-0 items-center gap-1" aria-label="Progress by stage">
      {STAGES.map((s, i) => {
        const isCurrent = current === s.id;
        const isDone = done ? i <= lastReached || reached.has(s.id) : i < STAGES.findIndex((x) => x.id === current) || (reached.has(s.id) && !isCurrent);
        return (
          <div key={s.id} className="flex items-center gap-1" title={s.label}>
            <span
              className={clsx(
                "h-1.5 rounded-full transition-all duration-500",
                isCurrent ? "w-7 bg-lilac pulse-soft" : isDone ? "w-4 bg-lilac" : "w-4 bg-surface-3"
              )}
              style={{ transitionTimingFunction: "var(--ease-out-strong)" }}
            />
            {isCurrent && <span className="caption-in text-[11px] font-medium text-lilac dark:text-[#c9c0ff]">{s.label}</span>}
          </div>
        );
      })}
    </div>
  );
}

interface Row {
  id: string;
  kind: "tool" | "note";
  label: string;
  summary?: string;
  ok?: boolean;
  running: boolean;
  passes: number;
  ms?: number;
}

/** Steps → display rows: time includes Dashie's thinking before each step, and back-to-back repeats merge. */
function toRows(steps: ActivityStep[], live: boolean, startedAt: number): Map<Stage, Row[]> {
  const byStage = new Map<Stage, Row[]>();
  let cursor = startedAt;
  for (const s of steps) {
    const rows = byStage.get(s.stage) ?? [];
    if (s.kind === "note") {
      rows.push({ id: s.id, kind: "note", label: s.label, running: false, passes: 1 });
      byStage.set(s.stage, rows);
      continue;
    }
    const running = live && !s.endedAt;
    const ms = s.endedAt ? s.endedAt - cursor : undefined;
    if (s.endedAt) cursor = s.endedAt;
    const prev = rows[rows.length - 1];
    if (prev && prev.kind === "tool" && prev.label === s.label) {
      prev.passes += 1;
      prev.running = running;
      prev.ok = s.ok ?? prev.ok;
      prev.summary = s.summary ?? prev.summary;
      prev.ms = (prev.ms ?? 0) + (ms ?? 0);
    } else {
      rows.push({ id: s.id, kind: "tool", label: s.label, summary: s.summary, ok: s.ok, running, passes: 1, ms });
    }
    byStage.set(s.stage, rows);
  }
  return byStage;
}

function Timeline({ steps, live, startedAt }: { steps: ActivityStep[]; live: boolean; startedAt: number }) {
  const rows = toRows(steps, live, startedAt);
  const groups = STAGES.map((st) => ({ ...st, items: rows.get(st.id) ?? [] })).filter((g) => g.items.length);
  return (
    <div className="pop-in border-t border-line px-3 pb-3 pt-2">
      {groups.map((g) => (
        <div key={g.id} className="mt-1.5">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{g.verb}</div>
          <ol className="relative ml-[7px] border-l border-line pl-4">
            {g.items.map((r) => (
              <li key={r.id} className="relative py-1">
                <span className="absolute -left-[21px] top-[7px] flex size-2.5 items-center justify-center rounded-full bg-surface">
                  {r.kind === "note" ? (
                    <span className="size-1.5 rounded-full bg-muted/50" />
                  ) : r.running ? (
                    <Spinner size={10} className="text-lilac" />
                  ) : r.ok === false ? (
                    <span className="size-2 rounded-full bg-peach" />
                  ) : (
                    <span className="size-2 rounded-full bg-mint" />
                  )}
                </span>
                {r.kind === "note" ? (
                  <div className="text-[12px] italic leading-snug text-ink-2">{r.label}</div>
                ) : (
                  <div className="flex items-baseline gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium leading-snug text-ink">
                        {r.label}
                        {r.passes > 1 && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-px text-[10.5px] font-medium text-muted">{r.passes} passes</span>}
                      </div>
                      {r.summary && r.summary !== r.label && <div className="truncate text-[11.5px] text-muted">{r.summary}</div>}
                    </div>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted">{r.ms !== undefined ? fmt(r.ms) : r.running ? "…" : ""}</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {!groups.length && <div className="py-1 text-[12px] text-muted">Getting started… ({fmt(Date.now() - startedAt)})</div>}
    </div>
  );
}

/** Dashie's live checklist (from update_plan). */
function PlanList({ plan, live }: { plan: PlanStep[]; live: boolean }) {
  return (
    <ol className="space-y-1.5 border-t border-line px-3.5 py-2.5">
      {plan.map((p, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[12.5px] leading-snug">
          <span className="mt-[1px] flex size-4 shrink-0 items-center justify-center">
            {p.status === "done" ? (
              <span className="flex size-4 items-center justify-center rounded-full bg-mint text-white"><GlyphCheck size={10} /></span>
            ) : p.status === "in_progress" && live ? (
              <Spinner size={14} className="text-lilac" />
            ) : (
              <span className="size-3.5 rounded-full border-2 border-line-strong" />
            )}
          </span>
          <span className={clsx(p.status === "done" ? "text-muted line-through decoration-muted/40" : p.status === "in_progress" ? "font-semibold text-ink" : "text-ink-2")}>{p.step}</span>
        </li>
      ))}
    </ol>
  );
}
