import type { AgentEvent, ModelChoice } from "@shared/types";
import type { TokenUsage } from "@shared/pricing";
import type { Recipe, RecipeStep } from "../agent/provenance";
import { stepInputs, substituteDates } from "../agent/provenance";
import { DatasetStore } from "../agent/datasets";
import { McpConnections, type McpToolInfo } from "../connectors/mcp";
import type { DashboardRepo } from "../dashboards/repo";
import type { AgentHarness } from "../agent/harness";
import { healPrompt } from "../agent/prompts";
import { runSql, readLocalFile, httpGet } from "../agent/tools/local";
import { fetchAllPagesTool, fetchForEachTool } from "../agent/tools/paginate";
import type { ToolContext, Tool } from "../agent/types";
import type { McpServerConfig } from "@shared/types";

export interface RefreshDeps {
  repo: DashboardRepo;
  mcpServers: () => Promise<McpServerConfig[]>;
  harness: AgentHarness;
  refreshModel: () => ModelChoice;
  homeDir: string;
  log?: (m: string) => void;
}

export interface RefreshOutcome {
  ok: boolean;
  healed: boolean;
  error?: string;
  durationMs: number;
  /** App/tool calls made while replaying (one per tool step; paged steps count their pages). */
  toolCalls: number;
  /** Rows per published dataset after the refresh. */
  rows?: Record<string, number>;
  /** What the repair changed, in one sentence, when it healed. */
  healNote?: string;
  /** Model usage of the repair run, if any. */
  heal?: { model: string; usage: TokenUsage; toolCalls: number };
}

const LOCAL: Record<string, Tool> = { run_sql: runSql, read_local_file: readLocalFile, http_get: httpGet, fetch_all_pages: fetchAllPagesTool, fetch_for_each: fetchForEachTool };
/** Independent app calls run side by side; SQL steps share one DuckDB connection and run one at a time. */
const PARALLEL = 4;

/**
 * Replays a dashboard's recipe with no model involvement. If a step fails, hands
 * the situation to the heal agent (cheap model) once.
 */
export async function refreshDashboard(deps: RefreshDeps, dashboardId: string, onEvent?: (e: AgentEvent) => void): Promise<RefreshOutcome> {
  const t0 = Date.now();
  const recipe = deps.repo.getRecipe(dashboardId);
  const m = deps.repo.get(dashboardId);
  if (!m) return { ok: false, healed: false, error: "Dashboard not found", durationMs: 0, toolCalls: 0 };
  if (!recipe || recipe.steps.length === 0) return { ok: false, healed: false, error: "No refresh recipe yet. Build the dashboard first.", durationMs: 0, toolCalls: 0 };

  const datasets = new DatasetStore(deps.repo.workDir(dashboardId));
  const emit = onEvent ?? (() => {});
  const runId = "refresh_" + Date.now().toString(36);
  const ctx: ToolContext = { dashboardId, datasets, repo: deps.repo, emit, runId, signal: new AbortController().signal, homeDir: deps.homeDir };

  const mcp = new McpConnections();
  const mcpTools = new Map<string, McpToolInfo>();
  let failure: { step: RecipeStep; error: string } | null = null;
  const counter = { calls: 0 };

  ctx.callMcp = (serverId, name, args) => {
    counter.calls++;
    return mcp.call(serverId, name, args, ctx.signal);
  };
  try {
    for (const server of await deps.mcpServers()) {
      try {
        for (const t of await mcp.connect(server)) mcpTools.set(`${server.id}:${t.name}`, t);
      } catch (e) {
        deps.log?.(`refresh: MCP ${server.name} unavailable: ${e instanceof Error ? e.message : e}`);
      }
    }

    failure = await replay(recipe, ctx, mcp, mcpTools, counter);

    if (!failure) {
      // Validate shape: every published dataset must exist and keep its columns.
      const prev = deps.repo.getData(dashboardId);
      for (const name of recipe.publish) {
        if (!datasets.has(name)) {
          failure = { step: recipe.steps.find((s) => s.output === name)!, error: `Dataset ${name} was not produced` };
          break;
        }
        const before = prev?.datasets[name];
        const after = datasets.get(name)!;
        if (Array.isArray(before) && before.length && after.rows && after.rows.length) {
          const missing = Object.keys(before[0] as object).filter((k) => !(k in (after.rows![0] as object)));
          if (missing.length) {
            failure = { step: recipe.steps.find((s) => s.output === name)!, error: `Dataset ${name} lost columns: ${missing.join(", ")}` };
            break;
          }
        }
      }
    }

    if (!failure) {
      deps.repo.setData(dashboardId, { fetchedAt: new Date().toISOString(), datasets: datasets.materialize(recipe.publish) });
      const rows = rowCounts(datasets, recipe.publish);
      await datasets.close();
      return { ok: true, healed: false, durationMs: Date.now() - t0, toolCalls: counter.calls, rows };
    }
  } finally {
    await mcp.close();
  }

  // ---- heal ----
  deps.log?.(`refresh ${dashboardId}: step "${failure.step.output}" failed: ${failure.error}; healing`);
  emit({ type: "status", runId, message: `Refresh hit a snag (${failure.error.slice(0, 80)}). Trying to fix it…` });
  const prevManifest = deps.repo.get(dashboardId)!;
  const model = deps.refreshModel();
  const result = await deps.harness.run({
    dashboardId,
    mode: "heal",
    userMessage: healPrompt(JSON.stringify(recipe, null, 2), `${failure.step.output} (${describe(failure.step)})`, failure.error),
    model,
    datasets,
    onEvent: emit,
    maxTurns: 25,
  });
  const after = deps.repo.get(dashboardId)!;
  const published = after.dataFetchedAt !== prevManifest.dataFetchedAt;
  const heal = { model: model.model, usage: result.usage, toolCalls: result.toolCalls };
  const rows = published ? rowCounts(datasets, deps.repo.getRecipe(dashboardId)?.publish ?? recipe.publish) : undefined;
  await datasets.close();
  if (result.ok && published) {
    const healNote = describeHeal(recipe, deps.repo.getRecipe(dashboardId), failure);
    return { ok: true, healed: true, durationMs: Date.now() - t0, toolCalls: counter.calls, rows, healNote, heal };
  }
  return { ok: false, healed: false, error: result.error ?? failure.error, durationMs: Date.now() - t0, toolCalls: counter.calls, heal };
}

/**
 * Runs the recipe respecting dependencies: app calls that don't feed each other go out side by
 * side (up to PARALLEL), SQL and inline steps run in order. Stops at the first failure.
 */
async function replay(recipe: Recipe, ctx: ToolContext, mcp: McpConnections, mcpTools: Map<string, McpToolInfo>, counter: { calls: number }): Promise<{ step: RecipeStep; error: string } | null> {
  const done = new Set<string>();
  const pending = [...recipe.steps];
  while (pending.length) {
    const ready = pending.filter((s) => stepInputs(s.source).every((i) => done.has(i)));
    if (!ready.length) return { step: pending[0]!, error: `Recipe step "${pending[0]!.output}" depends on a dataset that was never produced` };
    const tools = ready.filter((s) => s.source.kind === "tool").slice(0, PARALLEL);
    const batch = tools.length ? tools : [ready[0]!];
    const results = await Promise.allSettled(batch.map((step) => runStep(step, ctx, mcp, mcpTools, counter)));
    for (let i = 0; i < batch.length; i++) {
      const r = results[i]!;
      if (r.status === "rejected") return { step: batch[i]!, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
      done.add(batch[i]!.output);
      pending.splice(pending.indexOf(batch[i]!), 1);
    }
  }
  return null;
}

function rowCounts(datasets: DatasetStore, names: string[]) {
  const out: Record<string, number> = {};
  for (const n of names) {
    const ds = datasets.get(n);
    if (ds) out[n] = ds.rows ? ds.rows.length : 1;
  }
  return out;
}

/** One plain sentence about what the repair changed, for the refresh log and the notification. */
function describeHeal(before: Recipe, after: Recipe | undefined, failure: { step: RecipeStep; error: string }): string {
  if (!after) return `Recovered from "${failure.error.slice(0, 80)}".`;
  const prev = new Map(before.steps.map((s) => [s.output, JSON.stringify(s.source)]));
  const changed = after.steps.filter((s) => prev.get(s.output) !== JSON.stringify(s.source)).map((s) => s.output);
  const added = after.steps.filter((s) => !prev.has(s.output)).map((s) => s.output);
  const parts = [];
  if (changed.length) parts.push(`changed how ${changed.slice(0, 4).join(", ")} ${changed.length === 1 ? "is" : "are"} fetched`);
  if (added.length) parts.push(`added ${added.slice(0, 4).join(", ")}`);
  return `Refresh failed at "${failure.step.output}" (${failure.error.slice(0, 80)}); Dashie ${parts.join(" and ") || "re-fetched the data"}.`;
}

function describe(step: RecipeStep) {
  const s = step.source;
  return s.kind === "tool" ? s.tool : s.kind === "sql" ? "sql" : "inline";
}

async function runStep(step: RecipeStep, ctx: ToolContext, mcp: McpConnections, mcpTools: Map<string, McpToolInfo>, counter: { calls: number }) {
  const src = step.source;
  if (src.kind === "inline") {
    // Frozen data: replay the value stored in the recipe, or carry it forward from the last snapshot.
    const prev = src.value !== undefined ? src.value : ctx.repo.getData(ctx.dashboardId)?.datasets[step.output];
    if (prev === undefined) throw new Error(`Inline dataset ${step.output} missing from last snapshot`);
    await ctx.datasets.put(step.output, prev, src);
    return;
  }
  if (src.kind === "sql") {
    const res = await ctx.datasets.duck.query(src.sql);
    await ctx.datasets.put(step.output, res.rows, src);
    return;
  }
  const args = substituteDates((src.args as Record<string, unknown>) ?? {});
  if (src.tool.startsWith("mcp:")) {
    const [, serverId, ...rest] = src.tool.split(":");
    const toolName = rest.join(":");
    const info = mcpTools.get(`${serverId}:${toolName}`);
    if (!info) throw new Error(`Tool ${toolName} is not available (server ${serverId} offline?)`);
    counter.calls++;
    const { text, isError } = await mcp.call(serverId!, toolName, args);
    if (isError) throw new Error(text.slice(0, 500));
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Tool ${toolName} returned non-JSON output`);
    }
    if (/connect|authoriz|not connected|expired/i.test(text) && /https?:\/\//.test(text) && !Array.isArray(parsed)) {
      throw new Error(`App needs reconnecting: ${text.slice(0, 300)}`);
    }
    await ctx.datasets.put(step.output, parsed, src);
    return;
  }
  const local = LOCAL[src.tool];
  if (!local) throw new Error(`Unknown tool ${src.tool}`);
  if (src.tool === "http_get" || src.tool === "read_local_file") counter.calls++;
  // Local tools name their own dataset; force the recorded name.
  const r = await local.execute(args, ctx);
  const produced = r.preview?.name;
  if (produced && produced !== step.output) {
    const ds = ctx.datasets.get(produced)!;
    await ctx.datasets.put(step.output, ds.rows ?? ds.value, src);
  }
}
