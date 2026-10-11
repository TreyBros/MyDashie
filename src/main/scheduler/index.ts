import { Cron } from "croner";
import { shortSpec } from "@shared/schedule";
import { refreshCost } from "@shared/pricing";
import type { AgentEvent, DashboardManifest, Schedule } from "@shared/types";
import type { DashboardRepo } from "../dashboards/repo";
import type { UsageLedger } from "../store/usage";
import { refreshDashboard, type RefreshDeps } from "./refresh";

export interface SchedulerDeps extends RefreshDeps {
  notify: (title: string, body: string, dashboardId: string) => void;
  onEvent?: (dashboardId: string, e: AgentEvent) => void;
  usage?: UsageLedger;
}

/** Computes the next run for a schedule relative to `from`. */
export function nextRun(schedule: Schedule, from: Date = new Date()): Date | undefined {
  if (schedule.kind === "interval" && schedule.everyMinutes) return new Date(from.getTime() + schedule.everyMinutes * 60_000);
  if (schedule.kind === "cron" && schedule.cron) {
    try {
      return new Cron(schedule.cron).nextRun(from) ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * One timer, every 30s, looks for dashboards whose nextRunAt has passed. This
 * naturally catches up after sleep: the first tick after wake runs everything overdue.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();
  paused = false;

  constructor(private deps: SchedulerDeps) {}

  start() {
    this.stop();
    this.timer = setInterval(() => void this.tick("schedule"), 30_000);
    void this.tick("catchup");
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Call when the schedule of a dashboard changes. */
  reschedule(id: string) {
    const m = this.deps.repo.get(id);
    if (!m) return;
    const next = nextRun(m.schedule);
    this.deps.repo.update(id, { schedule: { ...m.schedule, nextRunAt: next?.toISOString() } });
  }

  async tick(trigger: "schedule" | "catchup") {
    if (this.paused) return;
    const now = Date.now();
    for (const m of this.deps.repo.list()) {
      if (m.schedule.kind === "off" || !m.hasHtml) continue;
      if (!m.schedule.nextRunAt) {
        this.reschedule(m.id);
        continue;
      }
      if (Date.parse(m.schedule.nextRunAt) <= now) await this.runNow(m.id, trigger);
    }
  }

  isRunning(id: string) {
    return this.running.has(id);
  }

  async runNow(id: string, trigger: "schedule" | "manual" | "catchup") {
    if (this.running.has(id)) return;
    const m = this.deps.repo.get(id);
    if (!m) return;
    this.running.add(id);
    this.deps.repo.update(id, { status: "refreshing" });
    try {
      const out = await refreshDashboard(this.deps, id, (e) => this.deps.onEvent?.(id, e));
      const after = this.deps.repo.get(id)!;
      const nextAt = nextRun(after.schedule)?.toISOString();
      const schedule: Schedule = { ...after.schedule, lastRunAt: new Date().toISOString(), nextRunAt: nextAt };
      // Every refresh is an action: it costs app calls and compute even without a model.
      const cost = refreshCost({ toolCalls: out.toolCalls, heal: out.heal });
      const at = new Date().toISOString();
      this.deps.usage?.append({ at, dashboardId: id, kind: "refresh", model: out.heal?.model, usage: out.heal?.usage, toolCalls: out.toolCalls + (out.heal?.toolCalls ?? 0), durationMs: out.durationMs, costUsd: cost.costUsd, credits: cost.credits, ok: out.ok });
      this.deps.repo.addSpend(id, cost.credits);
      this.deps.repo.appendRefreshLog(id, { at, ok: out.ok, durationMs: out.durationMs, healed: out.healed, error: out.error, trigger, toolCalls: out.toolCalls, rows: out.rows, credits: cost.credits, healNote: out.healNote });
      if (out.ok) {
        this.deps.repo.update(id, { status: "ready", schedule, staleSince: undefined, lastError: undefined });
        if (out.healed) this.deps.notify("Dashboard repaired", `${m.name}: ${out.healNote ?? "needed a fix during refresh and is up to date."}`.slice(0, 200), id);
      } else {
        this.deps.repo.update(id, { status: "stale", schedule, staleSince: after.staleSince ?? after.dataFetchedAt ?? new Date().toISOString(), lastError: out.error });
        this.deps.notify("Dashboard needs attention", `${m.name} couldn't refresh: ${(out.error ?? "unknown error").slice(0, 120)}`, id);
      }
    } finally {
      this.running.delete(id);
    }
  }
}

export function describeSchedule(s: Schedule): string {
  if (s.kind === "off") return "Not scheduled";
  if (s.spec) return shortSpec(s.spec);
  if (s.kind === "interval" && s.everyMinutes) {
    const m = s.everyMinutes;
    if (m % (60 * 24 * 7) === 0) return `Every ${m / (60 * 24 * 7) === 1 ? "week" : m / (60 * 24 * 7) + " weeks"}`;
    if (m % (60 * 24) === 0) return `Every ${m / (60 * 24) === 1 ? "day" : m / (60 * 24) + " days"}`;
    if (m % 60 === 0) return `Every ${m / 60 === 1 ? "hour" : m / 60 + " hours"}`;
    return `Every ${m} min`;
  }
  return `Cron ${s.cron}`;
}

export type { DashboardManifest };
