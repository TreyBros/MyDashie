import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
}

/** One in-memory DuckDB per run. Datasets are registered as views over JSON files on disk. */
export class Duck {
  private instance: DuckDBInstance | null = null;
  private conn: DuckDBConnection | null = null;
  /** Memoized so parallel first registrations share one instance instead of racing to create two. */
  private opening: Promise<DuckDBConnection> | null = null;
  /** Scratch files written for this run; removed on close so raw app data doesn't linger on disk. */
  private files = new Set<string>();

  constructor(private workDir: string) {}

  private connection(): Promise<DuckDBConnection> {
    if (this.conn) return Promise.resolve(this.conn);
    if (!this.opening) {
      this.opening = (async () => {
        this.instance = await DuckDBInstance.create(":memory:");
        this.conn = await this.instance.connect();
        await this.conn.run("SET enable_progress_bar = false");
        return this.conn;
      })();
    }
    return this.opening;
  }

  /** Register rows as a table named `name`. Writes JSON to disk so DuckDB can type-infer and so large data never sits in memory twice. */
  async registerRows(name: string, rows: unknown[]) {
    const file = join(this.workDir, `${name}.json`);
    writeFileSync(file, JSON.stringify(rows));
    this.files.add(file);
    await this.registerFile(name, file);
  }

  /** Non-tabular JSON (objects, nested maps): one row with a JSON column named "json". */
  async registerJson(name: string, value: unknown) {
    const file = join(this.workDir, `${name}.raw.json`);
    writeFileSync(file, JSON.stringify(value));
    this.files.add(file);
    const c = await this.connection();
    const safe = name.replace(/[^a-zA-Z0-9_]/g, "_");
    await c.run(`CREATE OR REPLACE VIEW "${safe}" AS SELECT CAST(content AS JSON) AS json FROM read_text('${file.replace(/'/g, "''")}')`);
  }

  async registerFile(name: string, file: string) {
    const c = await this.connection();
    const safe = name.replace(/[^a-zA-Z0-9_]/g, "_");
    await c.run(`CREATE OR REPLACE VIEW "${safe}" AS SELECT * FROM read_json_auto('${file.replace(/'/g, "''")}', maximum_object_size=268435456, sample_size=-1)`);
  }

  async query(sql: string, limit = 5000): Promise<QueryResult> {
    const c = await this.connection();
    const reader = await c.runAndReadAll(sql);
    const names = reader.columnNames();
    const types = reader.columnTypes().map((t) => String(t));
    const rows = reader.getRowObjectsJson().slice(0, limit) as Record<string, unknown>[];
    return { columns: names.map((n, i) => ({ name: n, type: types[i] ?? "UNKNOWN" })), rows };
  }

  async close() {
    try {
      this.conn?.closeSync();
      this.instance?.closeSync();
    } catch {}
    this.conn = null;
    this.instance = null;
    this.opening = null;
    for (const f of this.files) rmSync(f, { force: true });
    this.files.clear();
  }
}
