import { existsSync, readFileSync, statSync, copyFileSync, mkdtempSync } from "node:fs";
import { resolve, extname, basename, join } from "node:path";
import { tmpdir } from "node:os";
import type { Tool, ToolContext, ToolResult } from "../types";
import { sqlDateLiterals, substituteDates, type Provenance } from "../provenance";

const MAX_INLINE = 8000;

/** Shared helper: store a tool result as a dataset and build the model-facing message. */
export async function storeAsDataset(
  ctx: ToolContext,
  baseName: string,
  value: unknown,
  source: Provenance,
  note = ""
): Promise<ToolResult> {
  const name = ctx.datasets.uniqueName(baseName);
  const ds = await ctx.datasets.put(name, value, source);
  const preview = ctx.datasets.preview(name);
  const inline = JSON.stringify(ds.rows ?? ds.value);
  const small = inline.length <= MAX_INLINE;
  const content = small
    ? `${note}Saved as dataset "${name}" (${preview.rowCount ?? "non-tabular"} rows). Full content:\n${inline}`
    : `${note}Saved as dataset "${name}". ${ctx.datasets.describe(name)}\nThe full data is too large to show; query it with run_sql (table name "${name}").`;
  return {
    content,
    preview,
    ok: true,
    summary: preview.rowCount === null ? "Got the data" : `${preview.rowCount.toLocaleString()} row${preview.rowCount === 1 ? "" : "s"}`,
  };
}

export const runSql: Tool = {
  name: "run_sql",
  description:
    "Run DuckDB SQL over the datasets collected so far. Every dataset is a table with the same name. Use it to join, aggregate, pivot, clean, and shape data into exactly what the dashboard needs. Result is saved as a new dataset named save_as. DuckDB supports date_trunc, list/struct functions, PIVOT, QUALIFY, and window functions.",
  producesData: true,
  parameters: {
    type: "object",
    properties: {
      sql: { type: "string", description: "A single SELECT statement." },
      save_as: { type: "string", description: "snake_case name for the resulting dataset, e.g. revenue_by_month" },
    },
    required: ["sql", "save_as"],
    additionalProperties: false,
  },
  label: (a) => `Shaping ${String(a.save_as).replace(/_/g, " ")}`,
  async execute(args, ctx) {
    const sql = String(args.sql);
    const saveAs = String(args.save_as);
    const inputs = ctx.datasets.names().filter((n) => new RegExp(`\\b${n}\\b`).test(sql));
    const res = await ctx.datasets.duck.query(sql);
    const literals = sqlDateLiterals(sql);
    const warn = literals.length
      ? `Note: this SQL hardcodes ${literals.join(", ")}. Scheduled refreshes replay it unchanged, so the window will not move. Use current_date - INTERVAL N DAY (or current_timestamp) instead unless the date is a fixed point like a launch day. `
      : "";
    return storeAsDataset(ctx, saveAs, res.rows, { kind: "sql", sql, inputs }, `Query returned ${res.rows.length} rows. ${warn}`);
  },
};

export const readLocalFile: Tool = {
  name: "read_local_file",
  description:
    "Read a data file from this computer: CSV, TSV, JSON, NDJSON, Parquet, Excel (.xlsx), or SQLite (.db/.sqlite; pass table). Paths may use ~ for the home directory. Returns a dataset.",
  producesData: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      table: { type: "string", description: "For SQLite files: the table to read. Omit to list tables." },
      sheet: { type: "string", description: "For Excel files: sheet name. Optional." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  label: (a) => `Reading ${basename(String(a.path))}`,
  async execute(args, ctx) {
    const raw = String(args.path).replace(/^~(?=$|\/)/, ctx.homeDir);
    const path = resolve(raw);
    if (!path.startsWith(ctx.homeDir)) throw new Error("Only files inside your home folder can be read.");
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);
    if (statSync(path).size > 512 * 1024 * 1024) throw new Error("File is larger than 512 MB.");
    const ext = extname(path).toLowerCase();
    const q = path.replace(/'/g, "''");
    const duck = ctx.datasets.duck;
    const base = basename(path, ext);
    const source: Provenance = { kind: "tool", tool: "read_local_file", args };
    let rows: unknown[];
    if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
      rows = (await duck.query(`SELECT * FROM read_csv_auto('${q}', header=true)`, 200000)).rows;
    } else if (ext === ".json" || ext === ".ndjson" || ext === ".jsonl") {
      const text = readFileSync(path, "utf8");
      if (ext === ".json") return storeAsDataset(ctx, base, JSON.parse(text), source);
      rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } else if (ext === ".parquet") {
      rows = (await duck.query(`SELECT * FROM read_parquet('${q}')`, 200000)).rows;
    } else if (ext === ".xlsx" || ext === ".xls") {
      await duck.query("INSTALL excel; LOAD excel;").catch(() => {});
      const sheet = args.sheet ? `, sheet='${String(args.sheet).replace(/'/g, "''")}'` : "";
      rows = (await duck.query(`SELECT * FROM read_xlsx('${q}'${sheet})`, 200000)).rows;
    } else if (ext === ".db" || ext === ".sqlite" || ext === ".sqlite3") {
      // Copy first: never touch another app's live database or its WAL.
      const tmp = mkdtempSync(join(tmpdir(), "dash-sqlite-"));
      const copy = join(tmp, "db.sqlite");
      copyFileSync(path, copy);
      for (const suffix of ["-wal", "-shm"]) if (existsSync(path + suffix)) copyFileSync(path + suffix, copy + suffix);
      await duck.query("INSTALL sqlite; LOAD sqlite;").catch(() => {});
      await duck.query(`ATTACH '${copy.replace(/'/g, "''")}' AS src (TYPE sqlite, READ_ONLY)`);
      if (!args.table) {
        const tables = (await duck.query(`SELECT name FROM sqlite_master WHERE type='table'`)).rows.map((r) => r.name);
        return { content: `SQLite tables: ${tables.join(", ")}. Call again with table set.`, ok: true, summary: `Listed ${tables.length} tables` };
      }
      const t = String(args.table).replace(/"/g, "");
      rows = (await duck.query(`SELECT * FROM src."${t}"`, 200000)).rows;
    } else {
      throw new Error(`Unsupported file type ${ext}`);
    }
    return storeAsDataset(ctx, base, rows, source);
  },
};

export const httpGet: Tool = {
  name: "http_get",
  description:
    "Fetch JSON or CSV from a public HTTP(S) URL (no auth). For apps that need sign-in, use the Composio tools instead. Date placeholders like {{today}} or {{days_ago:30}} are substituted at run time so refreshes stay relative.",
  producesData: true,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      headers: { type: "object", description: "Optional extra request headers.", additionalProperties: { type: "string" } },
    },
    required: ["url"],
    additionalProperties: false,
  },
  label: (a) => {
    try {
      return `Fetching data from ${new URL(String(a.url)).hostname.replace(/^www\./, "")}`;
    } catch {
      return "Fetching data";
    }
  },
  async execute(args, ctx) {
    // Placeholders resolve here, at call time, so the recorded arguments keep them for refreshes.
    const live = substituteDates(args);
    const url = new URL(String(live.url));
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) URLs are allowed");
    const r = await fetch(url, { headers: (live.headers as Record<string, string>) ?? {}, signal: ctx.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const ct = r.headers.get("content-type") ?? "";
    const text = await r.text();
    let value: unknown;
    if (ct.includes("json") || /^[\[{]/.test(text.trim())) value = JSON.parse(text);
    else if (ct.includes("csv") || url.pathname.endsWith(".csv")) {
      const tmp = join(mkdtempSync(join(tmpdir(), "dash-csv-")), "data.csv");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(tmp, text);
      value = (await ctx.datasets.duck.query(`SELECT * FROM read_csv_auto('${tmp}')`, 200000)).rows;
    } else value = { text: text.slice(0, 20000) };
    return storeAsDataset(ctx, url.hostname.replace(/\W+/g, "_"), value, { kind: "tool", tool: "http_get", args });
  },
};

export const addInlineData: Tool = {
  name: "add_inline_data",
  description:
    "Store a small dataset the USER typed or pasted into the chat. Never use it to retype data that came from a tool, file or API: reshape that with run_sql instead (retyping causes mistakes and breaks refreshes). Inline data never refreshes.",
  producesData: true,
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      rows: { type: "array", items: { type: "object" } },
    },
    required: ["name", "rows"],
    additionalProperties: false,
  },
  label: (a) => `Adding ${a.name}`,
  async execute(args, ctx) {
    // The value is frozen into the refresh recipe so scheduled refreshes can always replay it.
    return storeAsDataset(ctx, String(args.name), args.rows, { kind: "inline", note: "provided by agent", value: args.rows });
  },
};
