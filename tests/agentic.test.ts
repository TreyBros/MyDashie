import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Paths } from "../src/main/store/paths";
import { DashboardRepo } from "../src/main/dashboards/repo";
import { DatasetStore } from "../src/main/agent/datasets";
import { editDashboard, loadSkill, updatePlan } from "../src/main/agent/tools/agentic";
import { SKILLS, skillCatalog } from "../src/main/agent/skills";
import type { ToolContext } from "../src/main/agent/types";

function ctx(html?: string): ToolContext & { events: unknown[] } {
  const dir = mkdtempSync(join(tmpdir(), "dash-agentic-"));
  const repo = new DashboardRepo(new Paths(dir));
  const d = repo.create({ name: "T", prompt: "p" });
  if (html) repo.setHtml(d.id, html);
  const events: unknown[] = [];
  return { dashboardId: d.id, datasets: new DatasetStore(repo.workDir(d.id)), repo, emit: (e) => events.push(e), runId: "r", signal: new AbortController().signal, homeDir: dir, events };
}

describe("edit_dashboard", () => {
  const html = `<html><body><h1>Sales</h1><p class="a">One</p><p class="a">One</p></body></html>`;

  it("replaces a unique snippet and marks the page as needing a preview", async () => {
    const c = ctx(html);
    const r = await editDashboard.execute({ old_string: "<h1>Sales</h1>", new_string: "<h1>Revenue</h1>" }, c);
    expect(r.ok).toBe(true);
    expect(c.repo.getHtml(c.dashboardId)).toContain("<h1>Revenue</h1>");
    expect(c.htmlChangedSincePreview).toBe(true);
  });

  it("refuses ambiguous snippets unless replace_all", async () => {
    const c = ctx(html);
    const r = await editDashboard.execute({ old_string: '<p class="a">One</p>', new_string: "<p>Two</p>" }, c);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/appears 2 times/);
    const r2 = await editDashboard.execute({ old_string: '<p class="a">One</p>', new_string: "<p>Two</p>", replace_all: true }, c);
    expect(r2.ok).toBe(true);
    expect(c.repo.getHtml(c.dashboardId)!.match(/<p>Two<\/p>/g)).toHaveLength(2);
  });

  it("explains a miss and points at the closest match", async () => {
    const c = ctx(html);
    const r = await editDashboard.execute({ old_string: "<h1>Sales </h1>", new_string: "x" }, c);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/not found/);
  });

  it("does not treat $ patterns in new_string as regex replacements", async () => {
    const c = ctx(html);
    await editDashboard.execute({ old_string: "<h1>Sales</h1>", new_string: "<h1>$& $1 cost</h1>" }, c);
    expect(c.repo.getHtml(c.dashboardId)).toContain("<h1>$& $1 cost</h1>");
  });
});

describe("skills and plan", () => {
  it("every skill is listed in the catalog and loadable", async () => {
    const c = ctx();
    for (const s of SKILLS) {
      expect(skillCatalog()).toContain(s.name);
      const r = await loadSkill.execute({ name: s.name }, c);
      expect(r.ok).toBe(true);
      expect(r.content.length).toBeGreaterThan(200);
    }
  });

  it("update_plan stores the plan and emits it", async () => {
    const c = ctx();
    await updatePlan.execute({ steps: [{ step: "Pull data", status: "done" }, { step: "Design", status: "in_progress" }] }, c);
    expect(c.plan).toHaveLength(2);
    expect(c.events).toContainEqual(expect.objectContaining({ type: "plan" }));
  });
});
