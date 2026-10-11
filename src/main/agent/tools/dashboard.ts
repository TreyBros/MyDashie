import type { Tool } from "../types";
import { TOPICS, asTopic } from "@shared/topics";
import { buildRecipe, recipeIsReplayable } from "../provenance";
import { formatQa } from "../qa";

export const writeDashboard: Tool = {
  name: "write_dashboard",
  description:
    "Write the complete dashboard as one HTML document built with the Dash Kit (dash-libs/dashkit.css, dash-libs/echarts.min.js, dash-libs/dashkit.js, then dash-data.js). Read data with Dash.data(name). No external resources.",
  parameters: {
    type: "object",
    properties: {
      html: { type: "string", description: "Full HTML document starting with <!doctype html>." },
      summary: { type: "string", description: "One sentence describing what the dashboard shows." },
      icon: { type: "string", enum: [...TOPICS], description: "Topic icon for the dashboard." },
      title: { type: "string", description: "Short dashboard title, 2-4 words, Title Case, max 28 characters, e.g. 'Stripe Revenue'." },
      confirm_rebuild: { type: "boolean", description: "Only for edits: true when the user explicitly asked to rebuild or redesign the whole dashboard." },
    },
    required: ["html", "summary"],
    additionalProperties: false,
  },
  label: () => "Writing dashboard",
  async execute(args, ctx) {
    const html = String(args.html);
    if (ctx.mode === "edit" && ctx.repo.getHtml(ctx.dashboardId) && args.confirm_rebuild !== true)
      return {
        content: "This is an edit: change only what the user asked, using edit_dashboard with exact snippets so everything else stays exactly as it is. Only rewrite the whole page if the user explicitly asked for a full redesign (then set confirm_rebuild: true).",
        ok: false,
        summary: "Keeping the rest of the dashboard as is",
      };
    if (!/<html[\s>]/i.test(html)) throw new Error("html must be a full HTML document");
    if (!/dash-data\.js/.test(html)) throw new Error('The document must include <script src="dash-data.js"></script>');
    if (/<script[^>]+src=["']https?:/i.test(html)) throw new Error("External scripts are not allowed. Use dash-libs/ for chart libraries.");
    ctx.repo.setHtml(ctx.dashboardId, html);
    const patch: Record<string, unknown> = { description: String(args.summary).slice(0, 400) };
    if (args.icon) patch.icon = asTopic(args.icon);
    if (args.title) patch.name = cleanTitle(String(args.title));
    ctx.repo.update(ctx.dashboardId, patch);
    ctx.emit({ type: "dashboard.updated", runId: ctx.runId, dashboardId: ctx.dashboardId, what: "html" });
    ctx.htmlChangedSincePreview = true;
    return { content: `Dashboard HTML saved (${html.length} chars). Call preview_dashboard to check it renders.`, ok: true, summary: "Dashboard written" };
  },
};

export const publishData: Tool = {
  name: "publish_data",
  description:
    "Add or update datasets the dashboard reads (window.DASH.data[name]) and derive the refresh recipe. Previously published datasets stay published unless you list them in remove, so for an edit you only pass the new or changed ones. Call it before writing HTML that reads the data.",
  parameters: {
    type: "object",
    properties: {
      datasets: { type: "array", items: { type: "string" }, description: "Dataset names to add or update." },
      remove: { type: "array", items: { type: "string" }, description: "Previously published datasets the dashboard no longer uses." },
    },
    required: ["datasets"],
    additionalProperties: false,
  },
  label: () => "Saving the data for your dashboard",
  async execute(args, ctx) {
    const added = (args.datasets as string[]).map(String);
    const remove = new Set(((args.remove as string[] | undefined) ?? []).map(String));
    const existing = (ctx.repo.get(ctx.dashboardId)?.datasets ?? []).filter((n) => ctx.datasets.has(n));
    const names = [...new Set([...existing, ...added])].filter((n) => !remove.has(n));
    const missing = added.filter((n) => !ctx.datasets.has(n));
    if (missing.length) throw new Error(`Unknown datasets: ${missing.join(", ")}. Known: ${ctx.datasets.names().join(", ")}`);
    const recipe = buildRecipe(names, ctx.datasets.provenance);
    if (ctx.mode === "heal") {
      // A repair may change how data is fetched, never freeze live data into the recipe: that
      // would make the dashboard look healthy while it quietly stops updating.
      const prev = new Map((ctx.repo.getRecipe(ctx.dashboardId)?.steps ?? []).map((s) => [s.output, s.source.kind]));
      const frozen = recipe.steps.filter((s) => s.source.kind === "inline" && prev.get(s.output) && prev.get(s.output) !== "inline").map((s) => s.output);
      if (frozen.length) throw new Error(`Refusing to publish: ${frozen.join(", ")} would become frozen inline data instead of being fetched. Fix the fetch (reconnect, adjust arguments, pick another tool) so the dashboard keeps refreshing, or report that the source is unavailable.`);
    }
    const data = ctx.datasets.materialize(names);
    ctx.repo.setRecipe(ctx.dashboardId, recipe);
    ctx.repo.setData(ctx.dashboardId, { fetchedAt: new Date().toISOString(), datasets: data });
    ctx.emit({ type: "dashboard.updated", runId: ctx.runId, dashboardId: ctx.dashboardId, what: "data" });
    const replay = recipeIsReplayable(recipe);
    const warn = replay.ok ? "" : ` Note: ${replay.frozen.join(", ")} are inline and will not refresh.`;
    return {
      content: `Published ${added.length} dataset(s) (${added.join(", ")}); the dashboard now reads ${names.length}: ${names.join(", ")}. Refresh recipe has ${recipe.steps.length} step(s).${warn}\nwindow.DASH.data keys: ${names.join(", ")}`,
      ok: true,
      summary: `${names.length} data set${names.length === 1 ? "" : "s"} ready`,
    };
  },
};

export const previewDashboard: Tool = {
  name: "preview_dashboard",
  description:
    "Render the saved dashboard with its published data and return a screenshot plus any console errors. Always call this after write_dashboard and fix problems you see (empty charts, overflow, errors, unreadable text).",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  label: () => "Checking the result",
  async execute(_args, ctx) {
    if (!ctx.preview) return { content: "Preview is not available in this environment. Assume the dashboard rendered.", ok: true, summary: "Preview skipped" };
    if (!ctx.repo.getHtml(ctx.dashboardId)) throw new Error("No dashboard HTML yet. Call write_dashboard first.");
    const { png, errors, title, qa, pages } = await ctx.preview.render(ctx.dashboardId);
    ctx.repo.setThumbnail(ctx.dashboardId, png);
    ctx.emit({ type: "dashboard.updated", runId: ctx.runId, dashboardId: ctx.dashboardId, what: "manifest" });
    const empty = { issues: [], stats: { charts: 0, kpis: 0, tables: 0, textLength: 0, usesKit: false } };
    let text: string;
    let issues = 0;
    if (pages && pages.length > 1) {
      const parts = pages.map((p, i) => {
        const r = formatQa(p.qa ?? empty, i === 0 ? errors : []);
        issues += r.issues.length;
        return `PAGE "${p.title}": ${r.text}`;
      });
      text = `${pages.length} pages. Screenshots are attached in page order.\n${parts.join("\n")}`;
    } else {
      const r = formatQa(qa ?? empty, errors);
      issues = r.issues.length;
      text = r.text;
    }
    const ok = issues === 0;
    ctx.lastQa = { ok, issues };
    ctx.htmlChangedSincePreview = false;
    return {
      content: `Rendered "${title}". ${text}\nReview the screenshot(s) as a picky designer: hierarchy, alignment, labels, colors, empty space. Fix anything that looks off.`,
      image: png.toString("base64"),
      images: pages && pages.length > 1 ? pages.slice(1, 6).map((p) => p.png.toString("base64")) : undefined,
      ok,
      summary: ok ? (pages && pages.length > 1 ? `All ${pages.length} pages render cleanly` : "Rendered cleanly") : `Found ${issues} thing${issues === 1 ? "" : "s"} to fix`,
    };
  },
};

export const getDashboardHtml: Tool = {
  name: "get_dashboard_html",
  description: "Return the current dashboard HTML so you can copy exact snippets for edit_dashboard.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  label: () => "Reading current dashboard",
  async execute(_args, ctx) {
    const html = ctx.repo.getHtml(ctx.dashboardId);
    return { content: html ? html : "(no HTML yet)", ok: true, summary: "Read HTML" };
  },
};

export function cleanTitle(t: string) {
  const words = t.replace(/["'`]/g, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 5).join(" ");
  return words.length > 32 ? words.slice(0, 32).replace(/\s+\S*$/, "") : words || "New Dashboard";
}

export const nameDashboard: Tool = {
  name: "name_dashboard",
  description: "Give the dashboard a short title and topic icon. Call this FIRST, before any other tool, in every new build. Also call it (with user_requested: true and the user's exact wording) when the user asks to rename the dashboard; then update the title in the page too.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "2-4 words, Title Case, max 28 characters. Example: 'Meeting Pulse', 'Stripe Revenue'." },
      icon: { type: "string", enum: [...TOPICS] },
      user_requested: { type: "boolean", description: "true only when the user explicitly asked for this name" },
    },
    required: ["title", "icon"],
    additionalProperties: false,
  },
  label: () => "Naming your dashboard",
  async execute(args, ctx) {
    const current = ctx.repo.get(ctx.dashboardId);
    if (args.user_requested === true) {
      const name = String(args.title).trim().slice(0, 80) || current?.name || "Dashboard";
      ctx.repo.update(ctx.dashboardId, { name, nameLocked: true, aiName: current?.aiName ?? current?.name, icon: asTopic(args.icon) });
      ctx.emit({ type: "dashboard.updated", runId: ctx.runId, dashboardId: ctx.dashboardId, what: "manifest" });
      return { content: `Renamed to "${name}".`, ok: true, summary: `"${name}"` };
    }
    if (current?.nameLocked) {
      ctx.repo.update(ctx.dashboardId, { icon: asTopic(args.icon) });
      ctx.emit({ type: "dashboard.updated", runId: ctx.runId, dashboardId: ctx.dashboardId, what: "manifest" });
      return { content: `The user named this dashboard "${current.name}" themselves. Keep that name (and use it as the page title).`, ok: true, summary: `"${current.name}"` };
    }
    const name = cleanTitle(String(args.title));
    ctx.repo.update(ctx.dashboardId, { name, icon: asTopic(args.icon) });
    ctx.emit({ type: "dashboard.updated", runId: ctx.runId, dashboardId: ctx.dashboardId, what: "manifest" });
    return { content: `Named "${name}".`, ok: true, summary: `"${name}"` };
  },
};
