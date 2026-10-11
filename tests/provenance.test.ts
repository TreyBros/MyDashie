import { describe, it, expect } from "vitest";
import { buildRecipe, substituteDates, recipeIsReplayable, relativizeDates, sqlDateLiterals, type Provenance } from "../src/main/agent/provenance";
import { extractTable, inferColumns } from "../src/main/agent/datasets";
import { nextRun, describeSchedule } from "../src/main/scheduler";

describe("buildRecipe", () => {
  it("orders steps by dependency and only includes what the published datasets need", () => {
    const prov = new Map<string, Provenance>([
      ["raw_a", { kind: "tool", tool: "http_get", args: { url: "a" } }],
      ["raw_b", { kind: "tool", tool: "http_get", args: { url: "b" } }],
      ["unused", { kind: "tool", tool: "http_get", args: { url: "c" } }],
      ["joined", { kind: "sql", sql: "select * from raw_a join raw_b", inputs: ["raw_a", "raw_b"] }],
      ["summary", { kind: "sql", sql: "select count(*) from joined", inputs: ["joined"] }],
    ]);
    const r = buildRecipe(["summary", "raw_a"], prov);
    const names = r.steps.map((s) => s.output);
    expect(names).toEqual(["raw_a", "raw_b", "joined", "summary"]);
    expect(names).not.toContain("unused");
    expect(r.publish).toEqual(["summary", "raw_a"]);
  });

  it("throws on missing provenance and detects cycles", () => {
    expect(() => buildRecipe(["x"], new Map())).toThrow(/No provenance/);
    const prov = new Map<string, Provenance>([
      ["a", { kind: "sql", sql: "", inputs: ["b"] }],
      ["b", { kind: "sql", sql: "", inputs: ["a"] }],
    ]);
    expect(() => buildRecipe(["a"], prov)).toThrow(/Circular/);
  });

  it("flags inline datasets as not replayable", () => {
    const prov = new Map<string, Provenance>([["pasted", { kind: "inline", note: "" }]]);
    expect(recipeIsReplayable(buildRecipe(["pasted"], prov))).toEqual({ ok: false, frozen: ["pasted"] });
  });
});

describe("substituteDates", () => {
  const at = new Date("2026-10-10T15:00:00Z");
  it("replaces placeholders in nested args", () => {
    const out = substituteDates({ since: "{{days_ago:30}}", nested: { until: "{{today}}", list: ["{{start_of_month}}", "{{start_of_year}}"] }, n: 3 }, at);
    expect(out).toEqual({ since: "2026-09-10", nested: { until: "2026-10-10", list: ["2026-10-01", "2026-01-01"] }, n: 3 });
  });
  it("leaves unknown placeholders alone", () => {
    expect(substituteDates("{{nope}}", at)).toBe("{{nope}}");
  });
});

describe("extractTable", () => {
  it("finds the largest array of objects in an API response", () => {
    const v = { meta: { count: 2 }, data: { items: [{ a: 1 }, { a: 2 }], other: [{ b: 1 }] } };
    expect(extractTable(v)).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it("wraps scalar arrays", () => {
    expect(extractTable([1, 2])).toEqual([{ index: 0, value: 1 }, { index: 1, value: 2 }]);
  });
  it("returns null for non-tabular values", () => {
    expect(extractTable({ a: 1 })).toBeNull();
  });
  it("infers columns", () => {
    expect(inferColumns([{ a: 1, b: null }, { a: 2, b: "x" }])).toEqual([{ name: "a", type: "number" }, { name: "b", type: "string" }]);
  });
});

describe("scheduler", () => {
  it("computes next run for intervals and cron", () => {
    const from = new Date("2026-10-10T10:00:00");
    expect(nextRun({ kind: "interval", everyMinutes: 60 }, from)?.toISOString()).toBe(new Date("2026-10-10T11:00:00").toISOString());
    const c = nextRun({ kind: "cron", cron: "0 7 * * *" }, from)!;
    expect(c.getHours()).toBe(7);
    expect(c > from).toBe(true);
    expect(nextRun({ kind: "off" }, from)).toBeUndefined();
    expect(nextRun({ kind: "cron", cron: "not a cron" }, from)).toBeUndefined();
  });
  it("describes schedules", () => {
    expect(describeSchedule({ kind: "interval", everyMinutes: 360 })).toBe("Every 6 hours");
    expect(describeSchedule({ kind: "interval", everyMinutes: 1440 })).toBe("Every day");
    expect(describeSchedule({ kind: "off" })).toBe("Not scheduled");
  });
});

describe("relativizeDates", () => {
  const at = new Date("2026-10-11T15:00:00Z");

  it("turns recent absolute dates into placeholders that resolve back to the same date", () => {
    const { value, rewrites } = relativizeDates({ since: "2026-08-12", until: "2026-10-11T23:59:59Z", nested: { from: "2026-10-12" } }, at);
    expect(value).toEqual({ since: "{{days_ago:60}}", until: "{{today}}T23:59:59Z", nested: { from: "{{days_ahead:1}}" } });
    expect(rewrites.map((r) => r.from)).toEqual(["2026-08-12", "2026-10-11", "2026-10-12"]);
    expect(substituteDates(value, at)).toEqual({ since: "2026-08-12", until: "2026-10-11T23:59:59Z", nested: { from: "2026-10-12" } });
  });

  it("leaves far-away dates, existing placeholders and non-date numbers alone", () => {
    const input = { fiscal: "2020-01-01", q: "{{days_ago:7}}", id: "123456789", page: 2, iso: "2026-09-01" };
    const { value, rewrites } = relativizeDates(input, at);
    expect(value).toEqual({ ...input, iso: "{{days_ago:40}}" });
    expect(rewrites).toHaveLength(1);
  });

  it("spots hardcoded date literals in SQL", () => {
    expect(sqlDateLiterals("SELECT * FROM t WHERE d >= '2026-09-11' AND d < '2026-10-11 13:50'", at)).toEqual(["'2026-09-11'", "'2026-10-11 13:50'"]);
    expect(sqlDateLiterals("SELECT * FROM t WHERE d >= current_date - INTERVAL 30 DAY", at)).toEqual([]);
    expect(sqlDateLiterals("WHERE launch = '2019-05-01'", at)).toEqual([]);
  });
});

describe("recipe inputs", () => {
  it("orders a for-each step after the dataset it iterates", () => {
    const prov = new Map<string, Provenance>([
      ["repos", { kind: "tool", tool: "fetch_all_pages", args: {} }],
      ["active", { kind: "sql", sql: "select * from repos", inputs: ["repos"] }],
      ["commits", { kind: "tool", tool: "fetch_for_each", args: { dataset: "active" }, inputs: ["active"] }],
    ]);
    expect(buildRecipe(["commits"], prov).steps.map((s) => s.output)).toEqual(["repos", "active", "commits"]);
  });
});
