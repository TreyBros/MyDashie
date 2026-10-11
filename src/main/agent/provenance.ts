/**
 * Provenance tracks how every dataset in a run was produced, so a refresh
 * recipe can be derived automatically from the datasets the agent publishes.
 */

export type Provenance =
  | { kind: "tool"; tool: string; args: unknown; /** Datasets the tool read (e.g. fetch_for_each iterates one). */ inputs?: string[] }
  | { kind: "sql"; sql: string; inputs: string[] }
  | { kind: "inline"; note: string; value?: unknown };

export interface RecipeStep {
  /** Dataset name this step produces. */
  output: string;
  source: Provenance;
}

export interface Recipe {
  version: 1;
  /** Steps in dependency order. */
  steps: RecipeStep[];
  /** Datasets written to data.json (subset of step outputs). */
  publish: string[];
  createdAt: string;
}

/** Datasets a step reads before it can run. */
export function stepInputs(src: Provenance): string[] {
  return src.kind === "sql" ? src.inputs : src.kind === "tool" ? (src.inputs ?? []) : [];
}

/** Walk provenance backwards from the published datasets and return steps in dependency order. */
export function buildRecipe(publish: string[], provenance: Map<string, Provenance>): Recipe {
  const order: RecipeStep[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string) => {
    if (seen.has(name)) return;
    if (visiting.has(name)) throw new Error(`Circular provenance at dataset "${name}"`);
    const src = provenance.get(name);
    if (!src) throw new Error(`No provenance for dataset "${name}"`);
    visiting.add(name);
    for (const input of stepInputs(src)) visit(input);
    visiting.delete(name);
    seen.add(name);
    order.push({ output: name, source: src });
  };

  for (const p of publish) visit(p);
  return { version: 1, steps: order, publish: [...publish], createdAt: new Date().toISOString() };
}

/** Does the recipe depend on anything that cannot be replayed? */
export function recipeIsReplayable(recipe: Recipe): { ok: boolean; frozen: string[] } {
  const frozen = recipe.steps.filter((s) => s.source.kind === "inline").map((s) => s.output);
  return { ok: frozen.length === 0, frozen };
}

/**
 * Date placeholders inside tool arguments, substituted at execution time on
 * every run so recipes stay relative: {{today}}, {{now}}, {{days_ago:30}},
 * {{months_ago:3}}, {{start_of_month}}, {{start_of_year}}, {{yesterday}}.
 */
export function substituteDates<T>(value: T, at: Date = new Date()): T {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const rep = (s: string) =>
    s.replace(/\{\{\s*([a-z_]+)(?::(\d+))?\s*\}\}/g, (_, key: string, n?: string) => {
      const num = n ? Number(n) : 0;
      const d = new Date(at);
      switch (key) {
        case "today":
          return iso(d);
        case "now":
          return d.toISOString();
        case "yesterday":
          d.setUTCDate(d.getUTCDate() - 1);
          return iso(d);
        case "days_ago":
          d.setUTCDate(d.getUTCDate() - num);
          return iso(d);
        case "days_ahead":
          d.setUTCDate(d.getUTCDate() + num);
          return iso(d);
        case "months_ago":
          d.setUTCMonth(d.getUTCMonth() - num);
          return iso(d);
        case "start_of_month":
          d.setUTCDate(1);
          return iso(d);
        case "start_of_year":
          d.setUTCMonth(0, 1);
          return iso(d);
        case "unix_now":
          return String(Math.floor(d.getTime() / 1000));
        default:
          return `{{${key}${n ? ":" + n : ""}}}`;
      }
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return rep(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** How far back or ahead an absolute date may sit and still be treated as "relative to today". */
const RELATIVE_WINDOW_DAYS = 400;

/**
 * The opposite of substituteDates: absolute calendar dates the model typed into tool
 * arguments ("2026-08-12", "2026-08-12T00:00:00Z") become {{days_ago:N}} placeholders
 * anchored to today, so a scheduled refresh keeps the same window instead of a window
 * that grows a day wider every day. Dates outside ±400 days are left alone (they are
 * fixed points like a fiscal year start, not a rolling window). Returns the rewritten
 * value and a list of what changed, for the model to see.
 */
export function relativizeDates<T>(value: T, at: Date = new Date()): { value: T; rewrites: { from: string; to: string }[] } {
  const rewrites: { from: string; to: string }[] = [];
  const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const rep = (s: string) =>
    s.replace(/(?<![\d{])(\d{4})-(\d{2})-(\d{2})(?![\d}])/g, (m, y: string, mo: string, d: string) => {
      const t = Date.UTC(Number(y), Number(mo) - 1, Number(d));
      if (isNaN(t)) return m;
      const days = Math.round((today - t) / 86_400_000);
      if (Math.abs(days) > RELATIVE_WINDOW_DAYS) return m;
      const to = days === 0 ? "{{today}}" : days > 0 ? `{{days_ago:${days}}}` : `{{days_ahead:${-days}}}`;
      rewrites.push({ from: m, to });
      return to;
    });
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return rep(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, rewrites };
}

/** Absolute date literals inside SQL that would freeze a rolling window ('2026-08-12'). */
export function sqlDateLiterals(sql: string, at: Date = new Date()): string[] {
  const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const out: string[] = [];
  for (const m of sql.matchAll(/'(\d{4})-(\d{2})-(\d{2})(?:[T ][^']*)?'/g)) {
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const days = Math.abs(Math.round((today - t) / 86_400_000));
    if (!isNaN(t) && days <= RELATIVE_WINDOW_DAYS) out.push(m[0]);
  }
  return [...new Set(out)];
}
