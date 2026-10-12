import { friendlyError, useStore } from "../lib/store";
import { formatCredits } from "@shared/pricing";
import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Cron } from "croner";
import { toast } from "sonner";
import type { DashboardManifest, Schedule } from "@shared/types";
import {
  DAY_SHORT,
  DEFAULT_SPEC,
  INTERVAL_CHOICES,
  PRESETS,
  TIME_OPTIONS,
  describeSpec,
  FREE_MAX_RUNS_PER_DAY,
  formatTime,
  runsPerActiveDay,
  runsPerMonth,
  shortSpec,
  specToCron,
  type Freq,
  type ScheduleSpec,
} from "@shared/schedule";
import { Button, Select, Toggle } from "./ui";
import { GlyphClose, Pic } from "./icons";

/** Button label for the dashboard header. */
export function scheduleLabel(s: Schedule): string {
  if (s.kind === "off") return "Not scheduled";
  if (s.spec) return shortSpec(s.spec);
  if (s.kind === "interval" && s.everyMinutes) return s.everyMinutes % 60 === 0 ? `Every ${s.everyMinutes / 60 === 1 ? "hour" : `${s.everyMinutes / 60} hours`}` : `Every ${s.everyMinutes} min`;
  return "Custom schedule";
}

/** Best-effort: turn an older schedule into a spec so the dialog can edit it. */
function initialSpec(s: Schedule): ScheduleSpec {
  if (s.spec) return s.spec;
  if (s.kind === "interval" && s.everyMinutes) {
    const hours = s.everyMinutes >= 60;
    return { ...DEFAULT_SPEC, freq: "interval", unit: hours ? "hours" : "minutes", every: hours ? Math.round(s.everyMinutes / 60) : s.everyMinutes, days: [0, 1, 2, 3, 4, 5, 6] };
  }
  return DEFAULT_SPEC;
}

const FREQS: { id: Freq; label: string; hint: string }[] = [
  { id: "time", label: "At a set time", hint: "Daily or on chosen days" },
  { id: "interval", label: "Throughout the day", hint: "Every few minutes or hours" },
  { id: "monthly", label: "Once a month", hint: "For monthly reports" },
];

export function ScheduleDialog({ d, onClose }: { d: DashboardManifest; onClose: () => void }) {
  // Opening the dialog means "I want a schedule", so start enabled unless it was explicitly turned off before.
  const [enabled, setEnabled] = useState(d.schedule.kind !== "off" || !d.schedule.spec);
  const [spec, setSpec] = useState<ScheduleSpec>(() => initialSpec(d.schedule));
  const [advanced, setAdvanced] = useState(false);
  const [cron, setCron] = useState(d.schedule.kind === "cron" && !d.schedule.spec ? d.schedule.cron ?? "" : "");
  const [saving, setSaving] = useState(false);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (p: Partial<ScheduleSpec>) => {
    setEnabled(true);
    setSpec((s) => ({ ...s, ...p }));
  };
  const compiled = advanced && cron.trim() ? cron.trim() : specToCron(spec);
  const next = useMemo(() => {
    try {
      return new Cron(compiled).nextRuns(3);
    } catch {
      return null;
    }
  }, [compiled]);
  const needsDays = spec.freq !== "monthly" && spec.days.length === 0;
  // The free plan refreshes up to 12 times a day; the app enforces it too, this just says so up front.
  const account = useStore((s) => s.account);
  const custom = advanced && cron.trim();
  const busiest = useMemo(() => {
    if (!custom) return runsPerActiveDay(spec);
    try {
      const runs = new Cron(compiled).nextRuns(7 * 24 * 4);
      const per = new Map<string, number>();
      for (const r of runs) if (r.getTime() - Date.now() < 7 * 864e5) per.set(r.toDateString(), (per.get(r.toDateString()) ?? 0) + 1);
      return Math.max(0, ...per.values());
    } catch {
      return 0;
    }
  }, [custom, compiled, spec]);
  const overFree = !!account?.signedIn && (account.plan ?? "free") === "free" && enabled && busiest > FREE_MAX_RUNS_PER_DAY;
  const monthRuns = custom ? busiest * 30.44 : (runsPerMonth({ kind: "cron", spec }) ?? 0);
  const perRun = d.refreshEstimate?.perRun;
  const complete = !!next && next.length > 0 && !needsDays;
  const valid = complete && !overFree;

  async function save() {
    setSaving(true);
    try {
      const schedule: Schedule = enabled
        ? { kind: "cron", cron: compiled, spec: advanced && cron.trim() ? undefined : spec }
        : { kind: "off", spec };
      await window.dash.dashboards.update({ id: d.id, patch: { schedule } });
      toast.success(enabled ? `Refreshing ${advanced && cron.trim() ? "on your custom schedule" : describeSpec(spec).charAt(0).toLowerCase() + describeSpec(spec).slice(1)}` : "Automatic refresh turned off");
      onClose();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,18,32,0.32)] p-6 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal aria-label="Refresh schedule" className="pop-in flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-[24px] border border-line bg-surface shadow-[0_30px_80px_-30px_rgba(28,27,40,0.55)]" onMouseDown={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-lilac-soft">
            <Pic name="schedule" size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-tight">Keep this dashboard fresh</h2>
            <p className="text-[12.5px] text-muted">{enabled ? "Dashie refreshes the data in the background, even when the window is closed." : "Automatic refresh is off. Pick a schedule below to turn it on."}</p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} label="Automatic refresh" />
          <button aria-label="Close" onClick={onClose} className="-mr-2 ml-1 flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <GlyphClose size={16} />
          </button>
        </div>

        <div className={clsx("min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-2 transition-opacity", !enabled && "opacity-45")}>
          {/* presets */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = !advanced && specToCron(p.spec) === specToCron(spec);
              return (
                <button
                  key={p.label}
                  onClick={() => {
                    setAdvanced(false);
                    setEnabled(true);
                    setSpec(p.spec);
                  }}
                  className={clsx("pressable rounded-full border px-3 py-1.5 text-[12.5px] font-medium", active ? "border-lilac bg-lilac text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong")}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {!advanced && (
            <>
              {/* how often */}
              <div>
                <Label>How often</Label>
                <div className="grid grid-cols-3 gap-2">
                  {FREQS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => set({ freq: f.id, days: f.id === "interval" && spec.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : spec.days })}
                      className={clsx(
                        "pressable rounded-2xl border px-3 py-2.5 text-left",
                        spec.freq === f.id ? "border-lilac bg-lilac-soft/60 ring-2 ring-lilac/20" : "border-line hover:border-line-strong"
                      )}
                    >
                      <div className={clsx("text-[13px] font-semibold", spec.freq === f.id ? "text-lilac dark:text-[#c9c0ff]" : "text-ink")}>{f.label}</div>
                      <div className="text-[11px] text-muted">{f.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* details per frequency */}
              {spec.freq === "interval" && (
                <div className="space-y-3">
                  <Row label="Refresh every">
                    <Select
                      value={`${spec.every}:${spec.unit}`}
                      onChange={(e) => {
                        const [ev, un] = e.target.value.split(":");
                        set({ every: Number(ev), unit: un as "minutes" | "hours" });
                      }}
                      className="w-44"
                    >
                      {INTERVAL_CHOICES.map((c) => (
                        <option key={`${c.every}:${c.unit}`} value={`${c.every}:${c.unit}`}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Row>
                  <Row label="During">
                    <Select value={spec.window ? "window" : "all"} onChange={(e) => set({ window: e.target.value === "all" ? null : { start: "08:00", end: "18:00" } })} className="w-44">
                      <option value="all">All day and night</option>
                      <option value="window">Set hours only</option>
                    </Select>
                  </Row>
                  {spec.window && (
                    <Row label="From">
                      <div className="flex items-center gap-2">
                        <TimeSelect value={spec.window.start} onChange={(v) => set({ window: { ...spec.window!, start: v } })} hourly />
                        <span className="text-[12px] text-muted">to</span>
                        <TimeSelect value={spec.window.end} onChange={(v) => set({ window: { ...spec.window!, end: v } })} hourly />
                      </div>
                    </Row>
                  )}
                </div>
              )}

              {spec.freq === "time" && (
                <Row label="At">
                  <TimeSelect value={spec.time} onChange={(v) => set({ time: v })} />
                </Row>
              )}

              {spec.freq === "monthly" && (
                <div className="space-y-3">
                  <Row label="On the">
                    <Select value={String(spec.dayOfMonth)} onChange={(e) => set({ dayOfMonth: e.target.value === "last" ? "last" : Number(e.target.value) })} className="w-44">
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {ordinal(n)} of the month
                        </option>
                      ))}
                      <option value="last">Last day of the month</option>
                    </Select>
                  </Row>
                  <Row label="At">
                    <TimeSelect value={spec.time} onChange={(v) => set({ time: v })} />
                  </Row>
                </div>
              )}

              {spec.freq !== "monthly" && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Label className="mb-0">On these days</Label>
                    <div className="flex gap-1 text-[11.5px]">
                      <QuickDays label="Every day" onClick={() => set({ days: [0, 1, 2, 3, 4, 5, 6] })} />
                      <QuickDays label="Weekdays" onClick={() => set({ days: [1, 2, 3, 4, 5] })} />
                      <QuickDays label="Weekends" onClick={() => set({ days: [0, 6] })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                      const on = spec.days.includes(day);
                      return (
                        <button
                          key={day}
                          aria-pressed={on}
                          onClick={() => set({ days: on ? spec.days.filter((x) => x !== day) : [...spec.days, day] })}
                          className={clsx(
                            "pressable h-10 rounded-xl text-[12.5px] font-semibold",
                            on ? "bg-lilac text-white shadow-[0_6px_14px_-8px_rgba(124,108,246,0.9)]" : "bg-surface-2 text-ink-2 hover:bg-surface-3"
                          )}
                        >
                          {DAY_SHORT[day]}
                        </button>
                      );
                    })}
                  </div>
                  {needsDays && <div className="mt-1.5 text-[12px] text-danger">Pick at least one day.</div>}
                </div>
              )}
            </>
          )}

          {advanced && (
            <div>
              <Label>Custom schedule (cron, local time)</Label>
              <input
                autoFocus
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 7 * * 1-5"
                className="h-10 w-full rounded-2xl border border-line bg-surface px-3.5 font-mono text-[13px] outline-none focus:border-lilac focus:ring-4 focus:ring-lilac/15 selectable"
              />
              {cron.trim() && !next && <div className="mt-1.5 text-[12px] text-danger">That isn't a valid schedule.</div>}
            </div>
          )}

          {overFree && (
            <div className="rounded-2xl bg-peach-soft px-4 py-3 text-[12.5px] text-ink">
              The free plan refreshes up to {FREE_MAX_RUNS_PER_DAY} times a day (every 2 hours). Pick a slower schedule, or upgrade in Settings → Account for refreshes as often as every 15 minutes.
            </div>
          )}

          {/* summary */}
          <div className="rounded-2xl bg-surface-2 px-4 py-3">
            {complete ? (
              <>
                <div className="text-[14px] font-semibold text-ink">{advanced && cron.trim() ? "Custom schedule" : describeSpec(spec)}</div>
                <div className="mt-1 text-[12px] text-muted">
                  Next: {next!.map((n) => n.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })).join("  ·  ")}
                </div>
                {perRun != null && (
                  <div className="mt-1 text-[12px] tabular-nums text-ink-2">
                    About {formatCredits(Math.round(perRun * monthRuns * 10) / 10)} credits a month ({formatCredits(perRun)} per refresh)
                  </div>
                )}
              </>
            ) : (
              <div className="text-[13px] text-muted">Finish the choices above to see when it will run.</div>
            )}
            <div className="mt-1 text-[11px] text-muted">Times are in your timezone ({tz}).</div>
          </div>
        </div>

        {/* footer */}
        <div className="mt-3 flex items-center justify-between border-t border-line px-6 py-3.5">
          <button onClick={() => setAdvanced((v) => !v)} className={clsx("text-[12px] font-medium text-muted hover:text-ink", !enabled && "invisible")}>
            {advanced ? "Back to simple options" : "Advanced"}
          </button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving} disabled={enabled && !valid}>
              Save schedule
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("mb-2 text-[12px] font-semibold text-ink-2", className)}>{children}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-[13px] text-ink-2">{label}</div>
      {children}
    </div>
  );
}

function QuickDays({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full px-2 py-0.5 font-medium text-lilac hover:bg-lilac-soft dark:text-[#c9c0ff]">
      {label}
    </button>
  );
}

function TimeSelect({ value, onChange, hourly }: { value: string; onChange: (v: string) => void; hourly?: boolean }) {
  const opts = hourly ? TIME_OPTIONS.filter((t) => t.endsWith(":00")) : TIME_OPTIONS;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-32">
      {opts.map((t) => (
        <option key={t} value={t}>
          {formatTime(t)}
        </option>
      ))}
    </Select>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
