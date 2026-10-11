import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Paths } from "../src/main/store/paths";
import { DashboardRepo } from "../src/main/dashboards/repo";
import { DatasetStore } from "../src/main/agent/datasets";
import { fetchAllPages, fetchAllPagesTool, fetchForEach } from "../src/main/agent/tools/paginate";
import type { ToolContext } from "../src/main/agent/types";

/** A fake connected app that serves `total` items `size` at a time, in the given paging style. */
function fakeApp(total: number, size: number, style: "cursor" | "page" | "offset") {
  const calls: Record<string, unknown>[] = [];
  const items = Array.from({ length: total }, (_, i) => ({ id: i + 1, amount: (i + 1) * 10 }));
  const callMcp = async (_s: string, _n: string, a: Record<string, unknown>) => {
    const args = (a.tools as { arguments: Record<string, unknown> }[])[0]!.arguments;
    calls.push(args);
    const start = style === "cursor" ? Number(args.after ?? 0) : style === "page" ? (Number(args.page ?? 1) - 1) * size : Number(args.offset ?? 0);
    const slice = items.slice(start, start + size);
    const next = start + size < total ? String(start + size) : undefined;
    const data = style === "cursor" ? { results: slice, paging: next ? { next: { after: next } } : {} } : { results: slice };
    return { text: JSON.stringify({ successful: true, data: { results: [{ index: 1, response: { successful: true, data } }] } }), isError: false };
  };
  return { calls, callMcp };
}

function ctx(callMcp: ToolContext["callMcp"]): ToolContext {
  const dir = mkdtempSync(join(tmpdir(), "page-test-"));
  const repo = new DashboardRepo(new Paths(dir));
  const d = repo.create({ name: "T", prompt: "p" });
  return { dashboardId: d.id, datasets: new DatasetStore(repo.workDir(d.id)), repo, emit: () => {}, runId: "r", signal: new AbortController().signal, homeDir: dir, callMcp };
}

describe("fetch_all_pages", () => {
  it("follows cursors to the end", async () => {
    const app = fakeApp(23, 10, "cursor");
    const r = await fetchAllPages(ctx(app.callMcp), { tool_slug: "HUBSPOT_LIST_DEALS", arguments: { limit: 10 }, mode: "cursor", page_arg: "after", next_path: "paging.next.after" });
    expect(r.rows).toHaveLength(23);
    expect(r.pages).toBe(3);
    expect(app.calls[0]).not.toHaveProperty("after");
    expect(app.calls[2]).toMatchObject({ after: "20" });
  });

  it("counts pages and offsets, stopping on a short page", async () => {
    const pages = fakeApp(25, 10, "page");
    expect((await fetchAllPages(ctx(pages.callMcp), { tool_slug: "GITHUB_LIST_COMMITS", arguments: { per_page: 10 }, mode: "page", page_arg: "page" })).rows).toHaveLength(25);
    const offs = fakeApp(30, 10, "offset");
    const r = await fetchAllPages(ctx(offs.callMcp), { tool_slug: "JIRA_SEARCH", arguments: {}, mode: "offset", page_arg: "offset" });
    expect(r.rows).toHaveLength(30);
    expect(offs.calls.map((c) => c.offset ?? 0)).toEqual([0, 10, 20, 30]);
  });

  it("caps rows and reports truncation", async () => {
    const app = fakeApp(80, 10, "cursor");
    const r = await fetchAllPages(ctx(app.callMcp), { tool_slug: "X", arguments: {}, mode: "cursor", page_arg: "after", next_path: "paging.next.after", max_rows: 35 });
    expect(r.rows).toHaveLength(35);
    expect(r.truncated).toBe(true);
  });

  it("records a replayable step that starts from the first page", async () => {
    const app = fakeApp(15, 10, "cursor");
    const c = ctx(app.callMcp);
    await fetchAllPagesTool.execute({ tool_slug: "HUBSPOT_LIST_DEALS", arguments: { limit: 10 }, mode: "cursor", page_arg: "after", next_path: "paging.next.after", save_as: "deals" }, c);
    const src = c.datasets.provenance.get("deals")!;
    expect(src).toMatchObject({ kind: "tool", tool: "fetch_all_pages" });
    expect((src as { args: Record<string, unknown> }).args).not.toHaveProperty("save_as");
    // Replay (what a scheduled refresh does) gets every row again, from page one.
    const again = await fetchAllPagesTool.execute((src as { args: Record<string, unknown> }).args, c);
    expect(again.preview?.rowCount).toBe(15);
    expect(c.datasets.get("deals")!.rows).toHaveLength(15);
  });
});

describe("fetch_for_each", () => {

  function perRepoApp() {
    const calls: Record<string, unknown>[] = [];
    const callMcp = async (_s: string, _n: string, a: Record<string, unknown>) => {
      const args = (a.tools as { arguments: Record<string, unknown> }[])[0]!.arguments;
      calls.push(args);
      if (args.repo === "broken") return { text: JSON.stringify({ successful: true, data: { results: [{ index: 1, response: { successful: false, error: "404" } }] } }), isError: false };
      const n = args.repo === "big" ? 3 : 1;
      const data = { commits: Array.from({ length: n }, (_, i) => ({ sha: `${args.repo}-${i}`, since: args.since })) };
      return { text: JSON.stringify({ successful: true, data: { results: [{ index: 1, response: { successful: true, data } }] } }), isError: false };
    };
    return { calls, callMcp };
  }

  it("runs the tool once per distinct source row, tags results, and keeps dates relative", async () => {
    const app = perRepoApp();
    const c = ctx(app.callMcp);
    await c.datasets.put("active", [{ owner: "a", repo: "big" }, { owner: "a", repo: "small" }, { owner: "a", repo: "big" }, { owner: "a", repo: "broken" }], { kind: "inline", note: "t" });
    const r = await fetchForEach(c, { dataset: "active", tool_slug: "GITHUB_LIST_COMMITS", arguments: { owner: "{{row.owner}}", repo: "{{row.repo}}", since: "{{days_ago:30}}" }, items_path: "commits" });
    expect(r.sources).toBe(3);
    expect(r.calls).toBe(3);
    expect(r.rows).toHaveLength(4);
    expect(r.rows.map((x) => x.repo).sort()).toEqual(["big", "big", "big", "small"]);
    expect(r.failures).toHaveLength(1);
    expect(app.calls.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(String(a.since)))).toBe(true);
  });

  it("refuses a template that doesn't reference the row", async () => {
    const app = perRepoApp();
    const c = ctx(app.callMcp);
    await c.datasets.put("active", [{ repo: "x" }], { kind: "inline", note: "t" });
    await expect(fetchForEach(c, { dataset: "active", tool_slug: "T", arguments: { repo: "x" } })).rejects.toThrow(/row\.column/);
  });
});
