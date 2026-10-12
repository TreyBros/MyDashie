/**
 * Metering. Users never see dollars: every build, edit, repair and refresh is priced in
 * credits, the way Lovable charges per message by complexity. Underneath, each run's true
 * cost is computed from token prices and tool calls and kept in a private ledger, so the
 * credit rates here can be tuned against real margins (Settings → General → Pricing lab).
 *
 * No runtime imports: shared between main and renderer.
 */

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
  reasoning?: number;
}

/** USD per 1M tokens. Cached input is billed at the cached rate; reasoning tokens are output tokens. */
export interface ModelPrice {
  input: number;
  cached: number;
  output: number;
}

/** List prices as of Oct 2026. Unknown models fall back to DEFAULT_PRICE (a balanced-tier assumption). */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-6-astra": { input: 5, cached: 0.5, output: 25 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
  "gpt-6-sol": { input: 2, cached: 0.2, output: 10 },
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-5.6-sol": { input: 2, cached: 0.2, output: 10 },
  "gpt-5.6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-5.5": { input: 2, cached: 0.2, output: 10 },
  "gpt-5.4": { input: 2, cached: 0.2, output: 10 },
  "gpt-5.4-mini": { input: 0.3, cached: 0.03, output: 1.5 },
  "gpt-5.3-codex": { input: 2, cached: 0.2, output: 10 },
  "gpt-5.2-codex": { input: 2, cached: 0.2, output: 10 },
};
export const DEFAULT_PRICE: ModelPrice = { input: 2, cached: 0.2, output: 10 };

/**
 * The credit model. One credit is anchored to USD_PER_CREDIT of underlying cost, so a
 * $0.50 build is 5 credits. Everything is rounded up to a tenth of a credit; nothing is free
 * (a refresh that pulls 22 pages still costs API calls, bandwidth and compute).
 */
export const CREDIT = {
  /** Underlying cost one credit represents. Retail price per credit = this / (1 - margin). */
  usdPerCredit: 0.1,
  /** Smallest charge for a model run (build, edit, ask, heal); those round up to tenths. */
  minCredits: 0.1,
  /** Smallest charge for a refresh; refreshes round up to hundredths, so a daily one is ~0.06, not 0.1. */
  refreshMinCredits: 0.01,
  /** Cost we attribute to one app tool call (connector platform overage + proxy + bandwidth). */
  toolCallUsd: 0.0006,
  /** Fixed cost of a refresh run (scheduler, DuckDB, disk) before any tool calls. */
  refreshBaseUsd: 0.004,
  /** Cost of one offscreen preview render during a build or edit. */
  previewUsd: 0.002,
  /** Target gross margin used for the suggested retail price. */
  targetMargin: 0.65,
} as const;

export function modelCostUsd(model: string, usage: TokenUsage): number {
  const p = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  const cached = Math.min(usage.cached ?? 0, usage.input);
  return ((usage.input - cached) * p.input + cached * p.cached + usage.output * p.output) / 1_000_000;
}

export function roundCredits(c: number): number {
  return Math.max(CREDIT.minCredits, Math.ceil(c * 10 - 1e-9) / 10);
}

/** Credits for a model-driven run (build, edit, ask, heal); the level's multiplier scales credits, not cost. */
export function runCost(opts: { model: string; usage: TokenUsage; toolCalls: number; previews?: number; level?: PowerLevel }): { costUsd: number; credits: number } {
  const costUsd = modelCostUsd(opts.model, opts.usage) + opts.toolCalls * CREDIT.toolCallUsd + (opts.previews ?? 0) * CREDIT.previewUsd;
  const mult = opts.level ? LEVEL_MULTIPLIER[opts.level] : 1;
  return { costUsd, credits: roundCredits((costUsd / CREDIT.usdPerCredit) * mult) };
}

/** Credits for a scheduled or manual refresh (no model unless it healed). */
export function refreshCost(opts: { toolCalls: number; heal?: { model: string; usage: TokenUsage; toolCalls: number } }): { costUsd: number; credits: number } {
  let costUsd = CREDIT.refreshBaseUsd + opts.toolCalls * CREDIT.toolCallUsd;
  if (opts.heal) costUsd += modelCostUsd(opts.heal.model, opts.heal.usage) + opts.heal.toolCalls * CREDIT.toolCallUsd;
  return { costUsd, credits: Math.max(CREDIT.refreshMinCredits, Math.ceil((costUsd / CREDIT.usdPerCredit) * 100 - 1e-9) / 100) };
}

/** The parts of a refresh recipe that decide its price (structural, so main's Recipe fits). */
export interface RecipeLike {
  steps: { source: { kind: string; tool?: string; calls?: number } }[];
}

/** Steps that read local files or public URLs make no app calls. */
const NO_APP_CALL = new Set(["read_local_file", "http_get", "read_granola", "run_sql"]);

/** Recipes built before call counts were recorded: cautious guesses until a real refresh replaces them. */
const LEGACY_CALLS: Record<string, number> = { fetch_for_each: 20, fetch_all_pages: 2 };

/** App calls one replay of the recipe makes, from what each step took when it was built. */
export function recipeCalls(recipe: RecipeLike): number {
  let n = 0;
  for (const s of recipe.steps) if (s.source.kind === "tool" && !NO_APP_CALL.has(s.source.tool ?? "")) n += s.source.calls ?? LEGACY_CALLS[s.source.tool ?? ""] ?? 1;
  return n;
}

export interface RefreshEstimate {
  /** Credits one refresh costs. */
  perRun: number;
  /** Credits a month on the current schedule (0 when it isn't scheduled). */
  perMonth: number;
  /** "history" once real refreshes have run, else priced from the recipe. */
  basis: "history" | "recipe";
}

/**
 * Predicts what a dashboard's refreshes cost. Refreshes never call the coding model, so the price is
 * app calls: the average of recent clean refreshes when there are any, otherwise the recipe's own count.
 * Repairs (heals) are rare and not included.
 */
export function estimateRefresh(opts: { recipe?: RecipeLike; recent?: { ok: boolean; healed?: boolean; toolCalls?: number }[]; runsPerMonth: number }): RefreshEstimate | null {
  const clean = (opts.recent ?? []).filter((r) => r.ok && !r.healed && r.toolCalls != null).slice(-5);
  let calls: number;
  let basis: RefreshEstimate["basis"];
  if (clean.length) {
    calls = clean.reduce((s, r) => s + (r.toolCalls ?? 0), 0) / clean.length;
    basis = "history";
  } else if (opts.recipe?.steps.length) {
    calls = recipeCalls(opts.recipe);
    basis = "recipe";
  } else return null;
  const perRun = refreshCost({ toolCalls: Math.round(calls) }).credits;
  return { perRun, perMonth: Math.round(perRun * opts.runsPerMonth * 10) / 10, basis };
}

/**
 * Credit range for a build at a level, from this install's past builds (middle half of their real cost,
 * re-priced at today's multiplier) or a default until there are at least three.
 */
export const DEFAULT_BUILD_RANGE: Record<PowerLevel, [number, number]> = { quick: [0.3, 1], smart: [2, 6], max: [5, 11] };
export function buildEstimate(entries: UsageEntry[], level: PowerLevel): { low: number; high: number; basis: "history" | "default" } {
  const costs = entries.filter((e) => e.kind === "build" && e.ok && (e.level ?? "smart") === level && e.costUsd > 0).map((e) => e.costUsd).sort((a, b) => a - b);
  if (costs.length < 3) return { low: DEFAULT_BUILD_RANGE[level][0], high: DEFAULT_BUILD_RANGE[level][1], basis: "default" };
  const q = (p: number) => costs[Math.min(costs.length - 1, Math.max(0, Math.round(p * (costs.length - 1))))]!;
  const credits = (usd: number) => roundCredits((usd / CREDIT.usdPerCredit) * LEVEL_MULTIPLIER[level]);
  return { low: credits(q(0.25)), high: Math.max(credits(q(0.25)), credits(q(0.75))), basis: "history" };
}

/** What to charge per credit to hit a gross margin, given the real average cost per credit. */
export function suggestedPricePerCredit(avgCostPerCredit: number, margin = CREDIT.targetMargin): number {
  return avgCostPerCredit / (1 - margin);
}

export type UsageKind = "build" | "edit" | "ask" | "heal" | "refresh" | "adjust";

/** Credit multiplier per power level: the only thing a level changes about the price. */
export const LEVEL_MULTIPLIER: Record<PowerLevel, number> = { quick: 0.4, smart: 1, max: 1.5 };

export type PowerLevel = "quick" | "smart" | "max";

export interface UsageEntry {
  /** Unique per entry; with the install id it makes server-side recording idempotent. */
  id: string;
  at: string;
  dashboardId: string;
  kind: UsageKind;
  level?: PowerLevel;
  model?: string;
  usage?: TokenUsage;
  toolCalls: number;
  previews?: number;
  durationMs: number;
  costUsd: number;
  credits: number;
  ok: boolean;
}

export interface UsageSummary {
  since: string;
  credits: number;
  costUsd: number;
  count: number;
  byKind: Record<UsageKind, { credits: number; costUsd: number; count: number }>;
  /** Real cost behind one credit, averaged over the period. */
  costPerCredit: number;
  suggestedPrice: number;
}

export function summarize(entries: UsageEntry[], since: string): UsageSummary {
  const byKind: UsageSummary["byKind"] = { build: z(), edit: z(), ask: z(), heal: z(), refresh: z(), adjust: z() };
  let credits = 0;
  let costUsd = 0;
  let count = 0;
  for (const e of entries) {
    if (e.at < since) continue;
    const k = byKind[e.kind] ?? (byKind[e.kind] = z());
    k.credits += e.credits;
    k.costUsd += e.costUsd;
    k.count += 1;
    credits += e.credits;
    costUsd += e.costUsd;
    count += 1;
  }
  const costPerCredit = credits > 0 ? costUsd / credits : CREDIT.usdPerCredit;
  return { since, credits: Math.round(credits * 100) / 100, costUsd, count, byKind, costPerCredit, suggestedPrice: suggestedPricePerCredit(costPerCredit) };
}

function z() {
  return { credits: 0, costUsd: 0, count: 0 };
}

export function formatCredits(c: number): string {
  if (c >= 100) return String(Math.round(c));
  if (c >= 10) return c.toFixed(1).replace(/\.0$/, "");
  // Refreshes are priced in hundredths; show them instead of rounding 0.06 up to "0.1".
  if (c > 0 && c < 1 && Math.abs(c * 10 - Math.round(c * 10)) > 1e-6) return c.toFixed(2);
  return c.toFixed(1);
}
