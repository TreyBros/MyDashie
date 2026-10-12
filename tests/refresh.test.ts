import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Paths } from "../src/main/store/paths";
import { DashboardRepo } from "../src/main/dashboards/repo";
import { DatasetStore } from "../src/main/agent/datasets";
import { publishData } from "../src/main/agent/tools/dashboard";
import type { ToolContext } from "../src/main/agent/types";
import type { Recipe } from "../src/main/agent/provenance";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "refresh-test-"));
  const repo = new DashboardRepo(new Paths(dir));
  const d = repo.create({ name: "T", prompt: "p" });
  const datasets = new DatasetStore(repo.workDir(d.id));
  const ctx: ToolContext = { dashboardId: d.id, datasets, repo, emit: () => {}, runId: "r", signal: new AbortController().signal, homeDir: dir };
  return { repo, d, datasets, ctx };
}

describe("heal guardrails", () => {
  it("refuses to replace a fetched dataset with frozen inline data during a repair", async () => {
    const { repo, d, datasets, ctx } = setup();
    const prev: Recipe = { version: 1, steps: [{ output: "sales", source: { kind: "tool", tool: "http_get", args: { url: "x" } } }], publish: ["sales"], createdAt: "" };
    repo.setRecipe(d.id, prev);
    await datasets.put("sales", [{ a: 1 }], { kind: "inline", note: "retyped" });
    ctx.mode = "heal";
    await expect(publishData.execute({ datasets: ["sales"] }, ctx)).rejects.toThrow(/frozen inline/);
    // The same publish is fine when the data was fetched again.
    await datasets.put("sales", [{ a: 2 }], { kind: "tool", tool: "http_get", args: { url: "y" } });
    const r = await publishData.execute({ datasets: ["sales"] }, ctx);
    expect(r.ok).toBe(true);
    await datasets.close();
  });

  it("bumps htmlVersion only when the page changes", () => {
    const { repo, d } = setup();
    repo.setHtml(d.id, "<html>1</html>");
    expect(repo.get(d.id)!.htmlVersion).toBe(1);
    repo.update(d.id, { name: "Renamed" });
    expect(repo.get(d.id)!.htmlVersion).toBe(1);
    repo.setHtml(d.id, "<html>2</html>");
    expect(repo.get(d.id)!.htmlVersion).toBe(2);
    repo.addSpend(d.id, 1.2);
    repo.addSpend(d.id, 0.3);
    expect(repo.get(d.id)!.spend).toEqual({ credits: 1.5, runs: 2 });
  });
});

describe("parallel dataset registration", () => {
  it("shares one DuckDB instance when several datasets register at once", async () => {
    const { datasets } = setup();
    await Promise.all([
      datasets.put("a", [{ x: 1 }], { kind: "inline", note: "t" }),
      datasets.put("b", [{ y: 2 }], { kind: "inline", note: "t" }),
      datasets.put("c", { nested: { k: 1 } }, { kind: "inline", note: "t" }),
    ]);
    const r = await datasets.duck.query("SELECT (SELECT x FROM a) AS x, (SELECT y FROM b) AS y, (SELECT json FROM c) IS NOT NULL AS c");
    expect(r.rows[0]).toMatchObject({ x: "1", y: "2", c: true });
    await datasets.close();
  });
});
