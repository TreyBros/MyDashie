import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { summarize, type UsageEntry, type UsageSummary } from "@shared/pricing";

/**
 * The private metering ledger: one line per build, edit, repair or refresh with its real
 * cost and the credits it was charged. Users see credits; the dollars exist so the credit
 * rates can be tuned against true margins.
 */
export class UsageLedger {
  private listeners = new Set<(e: UsageEntry) => void>();
  constructor(private file: string) {}

  /** Called for every entry written (the cloud sync listens here). */
  onAppend(fn: (e: UsageEntry) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  append(entry: Omit<UsageEntry, "id"> & { id?: string }): UsageEntry {
    const full: UsageEntry = { ...entry, id: entry.id ?? randomBytes(6).toString("hex") };
    appendFileSync(this.file, JSON.stringify(full) + "\n");
    for (const fn of this.listeners) fn(full);
    return full;
  }

  all(): UsageEntry[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as UsageEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is UsageEntry => !!e);
  }

  /** Totals since an ISO timestamp (default: the start of this month, local time). */
  summary(since = startOfMonth()): UsageSummary {
    return summarize(this.all(), since);
  }

  forDashboard(id: string): { credits: number; runs: number } {
    let credits = 0;
    let runs = 0;
    for (const e of this.all()) {
      if (e.dashboardId !== id) continue;
      credits += e.credits;
      runs++;
    }
    return { credits: Math.round(credits * 10) / 10, runs };
  }

  /** The whole ledger as CSV, for the pricing spreadsheet. */
  csv(): string {
    const head = "at,dashboardId,kind,model,input,cached,output,reasoning,toolCalls,durationMs,costUsd,credits,ok";
    const rows = this.all().map((e) =>
      [e.at, e.dashboardId, e.kind, e.model ?? "", e.usage?.input ?? 0, e.usage?.cached ?? 0, e.usage?.output ?? 0, e.usage?.reasoning ?? 0, e.toolCalls, e.durationMs, e.costUsd.toFixed(5), e.credits, e.ok ? 1 : 0].join(",")
    );
    return [head, ...rows].join("\n");
  }
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}
