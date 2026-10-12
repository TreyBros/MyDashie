import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Paths } from "../src/main/store/paths";
import { DashboardRepo } from "../src/main/dashboards/repo";
import { exportStandalone, dataScript } from "../src/main/dashboards/export";

describe("exportStandalone", () => {
  it("inlines data and libs and escapes closing script tags", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-export-"));
    const libs = join(dir, "libs");
    mkdirSync(libs);
    writeFileSync(join(libs, "echarts.min.js"), "window.echarts={v:1};");
    const repo = new DashboardRepo(new Paths(join(dir, "data")));
    const d = repo.create({ name: "T", prompt: "p" });
    repo.setHtml(d.id, `<!doctype html><html><head><script src="dash-libs/echarts.min.js"></script><script src="dash-data.js"></script></head><body></body></html>`);
    repo.setData(d.id, { fetchedAt: "2026-10-10T00:00:00Z", datasets: { rows: [{ note: "</script><b>" }] } });
    const html = exportStandalone(repo, libs, d.id);
    expect(html).not.toMatch(/dash-libs\//);
    expect(html).not.toMatch(/dash-data\.js/);
    expect(html).toContain("window.echarts={v:1};");
    expect(html).toContain("window.DASH =");
    expect(html).toContain("<\\/script><b>");
    expect(html).toMatch(/<meta charset="utf-8">/);
  });

  it("dataScript carries stale marker and name", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-export-"));
    const repo = new DashboardRepo(new Paths(dir));
    const d = repo.create({ name: "Named", prompt: "p" });
    repo.update(d.id, { staleSince: "2026-01-01T00:00:00Z" });
    const js = dataScript(repo, d.id);
    expect(js).toContain('"name":"Named"');
    expect(js).toContain('"staleSince":"2026-01-01T00:00:00Z"');
  });

  it("keeps history snapshots when data is replaced", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-export-"));
    const repo = new DashboardRepo(new Paths(dir));
    const d = repo.create({ name: "H", prompt: "p" });
    repo.setData(d.id, { fetchedAt: "2026-01-01T00:00:00Z", datasets: { a: [1] } });
    repo.setData(d.id, { fetchedAt: "2026-01-02T00:00:00Z", datasets: { a: [2] } });
    expect(repo.getData(d.id)?.datasets).toEqual({ a: [2] });
    expect(repo.get(d.id)?.dataFetchedAt).toBe("2026-01-02T00:00:00Z");
  });
});

describe("versions", () => {
  it("snapshots html, data and recipe and restores them", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-ver-"));
    const repo = new DashboardRepo(new Paths(dir));
    const d = repo.create({ name: "V", prompt: "p" });
    repo.setHtml(d.id, "<html>v1</html>");
    repo.setData(d.id, { fetchedAt: "2026-01-01T00:00:00Z", datasets: { a: [1] } });
    const v1 = repo.saveVersion(d.id, "make it blue")!;
    repo.setHtml(d.id, "<html>v2</html>");
    repo.setData(d.id, { fetchedAt: "2026-01-02T00:00:00Z", datasets: { b: [2] } });
    expect(repo.listVersions(d.id)[0]?.label).toBe("make it blue");
    repo.restoreVersion(d.id, v1);
    expect(repo.getHtml(d.id)).toBe("<html>v1</html>");
    expect(repo.getData(d.id)?.datasets).toEqual({ a: [1] });
    expect(repo.get(d.id)?.datasets).toEqual(["a"]);
    // restoring saves the state it replaced, so the undo itself can be undone
    expect(repo.listVersions(d.id).length).toBe(2);
  });
});
