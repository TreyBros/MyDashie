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
    const refresh = refreshCost({ toolCalls: 22 });
    expect(refresh.credits).toBe(0.2);
    expect(refreshCost({ toolCalls: 0 }).credits).toBe(0.1);
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
