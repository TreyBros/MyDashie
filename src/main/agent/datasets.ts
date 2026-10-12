import type { DatasetPreview } from "@shared/types";
import { Duck } from "./duck";
import type { Provenance } from "./provenance";

export interface Dataset {
  name: string;
  /** Row-oriented data when the source looked tabular, otherwise null. */
  rows: Record<string, unknown>[] | null;
  /** The raw value when not tabular (objects, scalars). */
  value: unknown;
  source: Provenance;
}

const PREVIEW_ROWS = 5;

/** Finds the largest array of objects inside a JSON value, up to 4 levels deep. Used to turn API responses into tables. */
export function extractTable(value: unknown, depth = 0): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((r) => r && typeof r === "object" && !Array.isArray(r))) return value as Record<string, unknown>[];
    if (value.length > 0 && value.every((r) => typeof r !== "object")) return value.map((v, i) => ({ index: i, value: v }));
    return null;
  }
  if (value && typeof value === "object" && depth < 4) {
    let best: Record<string, unknown>[] | null = null;
    for (const v of Object.values(value as Record<string, unknown>)) {
      const t = extractTable(v, depth + 1);
      if (t && (!best || t.length > best.length)) best = t;
    }
    return best;
  }
  return null;
}

export function inferColumns(rows: Record<string, unknown>[]): { name: string; type: string }[] {
  const cols = new Map<string, string>();
  for (const r of rows.slice(0, 50)) {
    for (const [k, v] of Object.entries(r)) {
      const t = v === null || v === undefined ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v;
      if (!cols.has(k) || cols.get(k) === "null") cols.set(k, t);
    }
  }
  return [...cols].map(([name, type]) => ({ name, type }));
}

export class DatasetStore {
  private sets = new Map<string, Dataset>();
  readonly provenance = new Map<string, Provenance>();
  readonly duck: Duck;
  private counter = 0;

  constructor(workDir: string) {
    this.duck = new Duck(workDir);
  }

  names() {
    return [...this.sets.keys()];
  }
  get(name: string) {
    return this.sets.get(name);
  }
  has(name: string) {
    return this.sets.has(name);
  }

  uniqueName(base: string) {
    const safe = base.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "data";
    if (!this.sets.has(safe)) return safe;
    return `${safe}_${++this.counter}`;
  }

  async put(name: string, value: unknown, source: Provenance): Promise<Dataset> {
    const rows = extractTable(value);
    const ds: Dataset = { name, rows, value, source };
    this.sets.set(name, ds);
    this.provenance.set(name, source);
    if (rows) await this.duck.registerRows(name, rows);
    else if (value && typeof value === "object") await this.duck.registerJson(name, value);
    return ds;
  }

  preview(name: string): DatasetPreview {
    const ds = this.sets.get(name);
    if (!ds) throw new Error(`Unknown dataset ${name}`);
    const rows = ds.rows;
    return {
      name,
      rowCount: rows ? rows.length : null,
      columns: rows ? inferColumns(rows) : [],
      sample: rows ? rows.slice(0, PREVIEW_ROWS) : [truncate(ds.value)],
      source: describeSource(ds.source),
    };
  }

  /** Text summary of a dataset for the model's context. */
  describe(name: string): string {
    const p = this.preview(name);
    const cols = p.columns.map((c) => `${c.name}:${c.type}`).join(", ");
    const sample = JSON.stringify(p.sample).slice(0, 1500);
    return p.rowCount === null
      ? `dataset "${name}" (nested JSON; query it with run_sql as table "${name}" with one column "json", see skill sql for flattening) sample=${sample}`
      : `dataset "${name}" rows=${p.rowCount} columns=[${cols}] sample=${sample}`;
  }

  describeAll(): string {
    return this.names().length ? this.names().map((n) => this.describe(n)).join("\n") : "(no datasets yet)";
  }

  /** The values that get written to data.json. */
  materialize(names: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const n of names) {
      const ds = this.sets.get(n);
      if (!ds) throw new Error(`Cannot publish unknown dataset "${n}"`);
      out[n] = ds.rows ?? ds.value;
    }
    return out;
  }

  /**
   * Load an existing dashboard's published data and recipe so an edit starts from what's already
   * there: published datasets are queryable, and every recipe step keeps its provenance so
   * publish_data can still derive a complete refresh recipe without re-fetching anything.
   */
  async hydrate(published: Record<string, unknown>, recipe?: { steps: { output: string; source: Provenance }[] }) {
    for (const st of recipe?.steps ?? []) this.provenance.set(st.output, st.source);
    for (const [name, value] of Object.entries(published)) {
      const source = this.provenance.get(name) ?? ({ kind: "inline", note: "carried over from the previous version", value } as Provenance);
      await this.put(name, value, source);
    }
  }

  async close() {
    await this.duck.close();
  }
}

function describeSource(p: Provenance) {
  if (p.kind === "tool") return `tool ${p.tool}`;
  if (p.kind === "sql") return `sql over ${p.inputs.join(", ")}`;
  return "inline";
}

function truncate(v: unknown) {
  const s = JSON.stringify(v);
  if (!s) return v;
  return s.length > 800 ? s.slice(0, 800) + "…" : v;
}
