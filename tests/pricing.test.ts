import { describe, it, expect } from "vitest";
import { modelCostUsd, runCost, refreshCost, summarize, roundCredits, formatCredits, CREDIT } from "../src/shared/pricing";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageLedger } from "../src/main/store/usage";

describe("pricing", () => {
  it("prices tokens with cached input at the cached rate", () => {
    // 1M input of which 400k cached, 100k output on gpt-6.1-sol ($2 / $0.10 / $10)
    expect(modelCostUsd("gpt-6.1-sol", { input: 1_000_000, cached: 400_000, output: 100_000 })).toBeCloseTo(0.6 * 2 + 0.4 * 0.1 + 0.1 * 10, 6);
    expect(modelCostUsd("unknown-model", { input: 1_000_000, output: 0 })).toBe(2);
  });

  it("charges credits in tenths, never below the minimum, and refreshes are never free", () => {
    expect(roundCredits(0)).toBe(CREDIT.minCredits);
    expect(roundCredits(0.41)).toBe(0.5);
    const build = runCost({ model: "gpt-6.1-sol", usage: { input: 300_000, cached: 200_000, output: 20_000 }, toolCalls: 88, previews: 2 });
    expect(build.credits).toBeGreaterThan(3);
    // Refreshes are priced to the hundredth: $0.004 + 22 x $0.0006 = $0.0172 -> 0.18 credits.
    const refresh = refreshCost({ toolCalls: 22 });
    expect(refresh.credits).toBe(0.18);
    expect(refreshCost({ toolCalls: 0 }).credits).toBe(0.04);
    expect(refreshCost({ toolCalls: 2 }).credits).toBe(0.06);
    expect(formatCredits(0.06)).toBe("0.06");
    expect(formatCredits(0.4)).toBe("0.4");
    const healed = refreshCost({ toolCalls: 22, heal: { model: "gpt-6-luna", usage: { input: 50_000, output: 5_000 }, toolCalls: 6 } });
    expect(healed.credits).toBeGreaterThan(refresh.credits);
  });

  it("summarizes a ledger by kind and derives a price per credit", () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-"));
    const ledger = new UsageLedger(join(dir, "usage.jsonl"));
    ledger.append({ at: "2026-10-02T00:00:00Z", dashboardId: "a", kind: "build", model: "gpt-6.1-sol", usage: { input: 1, output: 1 }, toolCalls: 10, durationMs: 1000, costUsd: 0.5, credits: 5, ok: true });
    ledger.append({ at: "2026-10-03T00:00:00Z", dashboardId: "a", kind: "refresh", toolCalls: 22, durationMs: 1000, costUsd: 0.02, credits: 0.2, ok: true });
    ledger.append({ at: "2026-09-03T00:00:00Z", dashboardId: "b", kind: "refresh", toolCalls: 22, durationMs: 1000, costUsd: 0.02, credits: 0.2, ok: true });
    const s = ledger.summary("2026-10-01T00:00:00Z");
    expect(s.count).toBe(2);
    expect(s.credits).toBe(5.2);
    expect(s.byKind.build.count).toBe(1);
    expect(s.byKind.refresh.credits).toBe(0.2);
    expect(s.costPerCredit).toBeCloseTo(0.52 / 5.2, 6);
    expect(s.suggestedPrice).toBeCloseTo(s.costPerCredit / (1 - CREDIT.targetMargin), 6);
    expect(ledger.forDashboard("a")).toEqual({ credits: 5.2, runs: 2 });
    expect(ledger.csv().split("\n")).toHaveLength(4);
    expect(summarize([], "2026-10-01").credits).toBe(0);
    expect(formatCredits(2.04)).toBe("2.0");
    expect(formatCredits(12.3)).toBe("12.3");
  });
});

describe("refresh and build estimates", () => {
  it("prices a refresh from the recipe until real refreshes exist", async () => {
    const { estimateRefresh, recipeCalls } = await import("../src/shared/pricing");
    const recipe = {
      steps: [
        { source: { kind: "tool", tool: "fetch_all_pages", calls: 3 } },
        { source: { kind: "tool", tool: "fetch_for_each", calls: 40 } },
        { source: { kind: "tool", tool: "http_get" } },
        { source: { kind: "tool", tool: "COMPOSIO_MULTI_EXECUTE_TOOL" } },
        { source: { kind: "sql" } },
      ],
    };
    expect(recipeCalls(recipe)).toBe(44);
    const est = estimateRefresh({ recipe, runsPerMonth: 30 })!;
    expect(est.basis).toBe("recipe");
    expect(est.perRun).toBe(0.31); // $0.004 + 44 × $0.0006 = $0.0304 -> 0.31 credits
    expect(est.perMonth).toBe(9.3);
    // Once refreshes have run, their average wins; healed runs don't count.
    const hist = estimateRefresh({ recipe, runsPerMonth: 0, recent: [{ ok: true, toolCalls: 2 }, { ok: true, healed: true, toolCalls: 90 }] })!;
    expect(hist).toEqual({ perRun: 0.06, perMonth: 0, basis: "history" });
    expect(estimateRefresh({ runsPerMonth: 30 })).toBeNull();
    // Older recipes without counts assume a loop of 20 and two pages.
    expect(recipeCalls({ steps: [{ source: { kind: "tool", tool: "fetch_for_each" } }, { source: { kind: "tool", tool: "fetch_all_pages" } }] })).toBe(22);
  });

  it("counts runs per month for each schedule shape", async () => {
    const { runsPerMonth, DEFAULT_SPEC } = await import("../src/shared/schedule");
    expect(runsPerMonth({ kind: "off" })).toBe(0);
    expect(runsPerMonth({ kind: "cron", spec: { ...DEFAULT_SPEC, freq: "time", days: [] }, paused: true })).toBe(0);
    expect(runsPerMonth({ kind: "cron", spec: { ...DEFAULT_SPEC, freq: "time", days: [] } })).toBeCloseTo(30.44, 1);
    expect(runsPerMonth({ kind: "cron", spec: { ...DEFAULT_SPEC, freq: "time", days: [1, 2, 3, 4, 5] } })).toBeCloseTo(21.7, 1);
    expect(runsPerMonth({ kind: "cron", spec: { ...DEFAULT_SPEC, freq: "monthly" } })).toBe(1);
    expect(runsPerMonth({ kind: "cron", spec: { ...DEFAULT_SPEC, freq: "interval", every: 1, unit: "hours", window: null, days: [] } })).toBeCloseTo(24 * 30.44, 0);
    expect(runsPerMonth({ kind: "cron", spec: { ...DEFAULT_SPEC, freq: "interval", every: 30, unit: "minutes", window: { start: "09:00", end: "17:00" }, days: [1, 2, 3, 4, 5] } })).toBeCloseTo(18 * 21.74, 0);
  });

  it("gives a build range per level from past builds at today's multiplier", async () => {
    const { buildEstimate, DEFAULT_BUILD_RANGE } = await import("../src/shared/pricing");
    expect(buildEstimate([], "max")).toEqual({ low: DEFAULT_BUILD_RANGE.max[0], high: DEFAULT_BUILD_RANGE.max[1], basis: "default" });
    const e = (costUsd: number) => ({ id: String(costUsd), at: "2026-10-11", dashboardId: "d", kind: "build" as const, level: "max" as const, toolCalls: 0, durationMs: 0, costUsd, credits: 0, ok: true });
    // The two real Max builds plus one more: $0.53–$0.68 at 1.5× is about 8–11 credits.
    const r = buildEstimate([e(0.53), e(0.6), e(0.675)], "max");
    expect(r.basis).toBe("history");
    expect(r.low).toBeGreaterThanOrEqual(8);
    expect(r.high).toBeLessThanOrEqual(11);
  });
});
