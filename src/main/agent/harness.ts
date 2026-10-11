import OpenAI from "openai";
import type { ResponseInputItem, Tool as OpenAITool } from "openai/resources/responses/responses";
import { randomBytes } from "node:crypto";
import type { AgentEvent, ChatMessage, DashboardManifest, ModelChoice } from "@shared/types";
import type { Tool, ToolContext, ToolResult, PreviewRenderer } from "./types";
import { DatasetStore } from "./datasets";
import { buildSystemPrompt } from "./prompts";
import { relativizeDates, substituteDates, type Provenance } from "./provenance";
import { storeAsDataset, runSql, readLocalFile, httpGet, addInlineData } from "./tools/local";
import { writeDashboard, publishData, previewDashboard, getDashboardHtml, nameDashboard } from "./tools/dashboard";
import { updatePlan, loadSkill, editDashboard, inspectDataset, suggestNext, askUser } from "./tools/agentic";
import { McpConnections, type McpToolInfo } from "../connectors/mcp";
import { fetchAllPagesTool, fetchForEachTool } from "./tools/paginate";
import type { DashboardRepo } from "../dashboards/repo";
import type { McpServerConfig } from "@shared/types";

export interface HarnessDeps {
  repo: DashboardRepo;
  openaiKey: () => string | undefined;
  /** MCP servers to attach for this run (Composio session + user servers). */
  mcpServers: () => Promise<McpServerConfig[]>;
  preview?: PreviewRenderer;
  homeDir: string;
  log?: (msg: string) => void;
}

export type AskUserFn = (dashboardId: string, runId: string, q: { intro?: string; questions: import("@shared/types").AgentQuestion[] }) => Promise<import("@shared/types").AgentAnswers>;

export interface RunOptions {
  dashboardId: string;
  mode: "build" | "edit" | "heal" | "ask";
  userMessage: string;
  model: ModelChoice;
  /** Pre-seeded datasets (used by heal runs to hand over what still works). */
  datasets?: DatasetStore;
  history?: ChatMessage[];
  onEvent: (ev: AgentEvent) => void;
  signal?: AbortSignal;
  maxTurns?: number;
  /** Human-in-the-loop channel; omit for headless/scheduled runs. */
  askUser?: AskUserFn;
}

export interface RunResult {
  ok: boolean;
  text: string;
  error?: string;
  usage: { input: number; output: number; cached?: number; reasoning?: number };
  datasets: DatasetStore;
  /** Tool calls executed (app calls, SQL, edits, previews). */
  toolCalls: number;
  /** Offscreen previews rendered. */
  previews: number;
}

const LOCAL_TOOLS: Tool[] = [
  askUser,
  updatePlan,
  loadSkill,
  nameDashboard,
  readLocalFile,
  httpGet,
  inspectDataset,
  runSql,
  addInlineData,
  publishData,
  writeDashboard,
  getDashboardHtml,
  editDashboard,
  previewDashboard,
  suggestNext,
  fetchAllPagesTool,
  fetchForEachTool,
];

/** Answering a question never changes anything: read the page and the data, nothing else. */
const ASK_TOOLS = new Set(["get_dashboard_html", "inspect_dataset", "run_sql", "load_skill"]);

/** Read-only tools that may run concurrently within one turn. */
const PARALLEL_SAFE = new Set(["load_skill", "read_local_file", "http_get", "inspect_dataset", "get_dashboard_html", "fetch_all_pages", "fetch_for_each"]);
const MAX_GATE_BLOCKS = 3;
const RETRYABLE = /\b(429|500|502|503|504)\b|rate limit|overloaded|timeout|ECONNRESET|ETIMEDOUT|EPIPE|fetch failed|socket hang up|terminated|premature close|other side closed|connection error|network/i;

async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, onRetry: (n: number, e: unknown) => void, tries = 4): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      if (signal.aborted || n >= tries - 1 || !RETRYABLE.test(String((e as Error)?.message ?? e))) throw e;
      onRetry(n + 1, e);
      await new Promise((r) => setTimeout(r, 1500 * 2 ** n + Math.random() * 500));
    }
  }
}

/** Prefix MCP tool names so they fit OpenAI's 64-char tool-name limit and stay unique. */
function mcpToolName(serverId: string, name: string) {
  const prefix = serverId === "composio" ? "" : `${serverId.replace(/^mcp_/, "s")}__`;
  return (prefix + name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export class AgentHarness {
  constructor(private deps: HarnessDeps) {}

  async run(opts: RunOptions): Promise<RunResult> {
    const key = this.deps.openaiKey();
    if (!key) throw new Error("Add your OpenAI API key in Settings first.");
    const openai = new OpenAI({ apiKey: key });
    const runId = "run_" + randomBytes(5).toString("hex");
    const manifest = this.deps.repo.get(opts.dashboardId);
    if (!manifest) throw new Error("Dashboard not found");
    const abort = new AbortController();
    opts.signal?.addEventListener("abort", () => abort.abort());
    let datasets = opts.datasets;
    if (!datasets) {
      datasets = new DatasetStore(this.deps.repo.workDir(opts.dashboardId));
      // Edits start from the dashboard's existing data, so small changes never require re-fetching.
      const snap = this.deps.repo.getData(opts.dashboardId);
      if (snap && opts.mode !== "build") await datasets.hydrate(snap.datasets, this.deps.repo.getRecipe(opts.dashboardId));
    }
    const emit = opts.onEvent;
    const usage: { input: number; output: number; cached?: number; reasoning?: number } = { input: 0, output: 0 };
    const counts = { toolCalls: 0, previews: 0 };

    const ctx: ToolContext = {
      dashboardId: opts.dashboardId,
      mode: opts.mode,
      askUser: opts.askUser ? (q) => opts.askUser!(opts.dashboardId, runId, q) : undefined,
      datasets,
      repo: this.deps.repo,
      emit,
      runId,
      signal: abort.signal,
      preview: this.deps.preview,
      homeDir: this.deps.homeDir,
    };

    // ---- connect MCP servers (Composio + user) ----
    emit({ type: "status", runId, message: "Connecting to your apps…" });
    const mcp = new McpConnections();
    const mcpTools = new Map<string, McpToolInfo>();
    for (const server of await this.deps.mcpServers()) {
      try {
        for (const t of await mcp.connect(server)) mcpTools.set(mcpToolName(server.id, t.name), t);
      } catch (e) {
        this.deps.log?.(`MCP ${server.name}: ${e instanceof Error ? e.message : e}`);
        emit({ type: "status", runId, message: `Couldn't reach ${server.name}; continuing without it.` });
      }
    }

    ctx.callMcp = (serverId, name, args) => mcp.call(serverId, name, args, abort.signal);

    const ask = opts.mode === "ask";
    if (ask) mcpTools.clear();
    const toolDefs: OpenAITool[] = [
      ...LOCAL_TOOLS.filter((t) => (ask ? ASK_TOOLS.has(t.name) : (t.name !== "fetch_all_pages" && t.name !== "fetch_for_each") || mcpTools.has("COMPOSIO_MULTI_EXECUTE_TOOL"))).map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters as unknown as Record<string, unknown>, strict: false })),
      ...[...mcpTools.entries()].map(([name, t]) => ({
        type: "function" as const,
        name,
        description: `[${t.serverId === "composio" ? "Connected apps" : t.serverName}] ${t.description}`.slice(0, 1024),
        parameters: normalizeSchema(t.inputSchema),
        strict: false,
      })),
    ];

    const instructions = buildSystemPrompt(manifest, {
      hasHtml: !!this.deps.repo.getHtml(opts.dashboardId),
      datasetSummary: datasets.describeAll(),
      mode: opts.mode,
    });

    const input: ResponseInputItem[] = [
      ...(opts.history ?? []).slice(-12).map((m) => ({ role: m.role, content: m.content }) as ResponseInputItem),
      { role: "user", content: opts.userMessage },
    ];

    let previousResponseId: string | undefined;
    let finalText = "";
    let error: string | undefined;
    let gateBlocks = 0;
    let connectRequested = false;
    const seen = new Map<string, number>();
    const maxTurns = opts.maxTurns ?? (ask ? 10 : 45);
    const canPreview = !!this.deps.preview;

    /** The stop hook: decide whether the agent may finish, or what it still has to do. */
    const verificationGap = (): string | null => {
      if (opts.mode === "heal" || opts.mode === "ask") return null;
      if (connectRequested && !this.deps.repo.getHtml(opts.dashboardId)) return null; // waiting on the user to connect an app
      const m = this.deps.repo.get(opts.dashboardId);
      const html = this.deps.repo.getHtml(opts.dashboardId);
      if (!html) return "You haven't built the dashboard yet. Finish the job: get the data, publish_data, write_dashboard, then preview_dashboard. Only stop early if the data is truly unavailable, and then say exactly what is missing.";
      if (!m?.datasets.length) return "The dashboard has no published data. Call publish_data with the datasets the HTML reads.";
      if (canPreview && (ctx.htmlChangedSincePreview || !ctx.lastQa)) return "You changed the dashboard but haven't checked it. Call preview_dashboard and review the screenshot and QA results.";
      if (canPreview && ctx.lastQa && !ctx.lastQa.ok) return `The last preview still has ${ctx.lastQa.issues} QA problem(s). Fix them with edit_dashboard (or fix the data), then preview again. If something truly can't be fixed, say why in your final message.`;
      if (ctx.plan?.some((p) => p.status !== "done")) return "Your plan still has unfinished steps. Finish them, or call update_plan to mark what's done or drop what no longer applies.";
      return null;
    };

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        if (abort.signal.aborted) throw new Error("Cancelled");
        emit({ type: "status", runId, message: turn === 0 ? "Thinking…" : "Working…" });

        const turnInput = input.splice(0);
        // Open AND read the stream inside the retry: a connection that drops mid-response
        // ("terminated", reset sockets) replays the same turn instead of failing the build.
        const { calls, turnText, responseId } = await withRetry(
          async () => {
            const stream = await openai.responses.create(
              {
                model: opts.model.model,
                instructions,
                input: turnInput,
                previous_response_id: previousResponseId,
                tools: toolDefs,
                reasoning: opts.model.effort === "none" ? undefined : { effort: opts.model.effort },
                stream: true,
                store: true,
                parallel_tool_calls: true,
              },
              { signal: abort.signal }
            );
            const calls: { call_id: string; name: string; arguments: string }[] = [];
            let turnText = "";
            let responseId: string | undefined;
            let streamed = false;
            try {
              for await (const ev of stream) {
                if (ev.type === "response.output_text.delta") {
                  turnText += ev.delta;
                  streamed = true;
                  emit({ type: "text.delta", runId, delta: ev.delta });
                } else if (ev.type === "response.output_item.done" && ev.item.type === "function_call") {
                  calls.push({ call_id: ev.item.call_id, name: ev.item.name, arguments: ev.item.arguments });
                } else if (ev.type === "response.completed") {
                  responseId = ev.response.id;
                  usage.input += ev.response.usage?.input_tokens ?? 0;
                  usage.output += ev.response.usage?.output_tokens ?? 0;
                  usage.cached = (usage.cached ?? 0) + ((ev.response.usage as { input_tokens_details?: { cached_tokens?: number } } | undefined)?.input_tokens_details?.cached_tokens ?? 0);
                  usage.reasoning = (usage.reasoning ?? 0) + ((ev.response.usage as { output_tokens_details?: { reasoning_tokens?: number } } | undefined)?.output_tokens_details?.reasoning_tokens ?? 0);
                } else if (ev.type === "response.failed") {
                  throw new Error(ev.response.error?.message ?? "Model request failed");
                } else if (ev.type === "error") {
                  throw new Error((ev as { message?: string }).message ?? "Stream error");
                }
              }
              if (!responseId) throw new Error("terminated: stream ended before the response completed");
            } catch (e) {
              if (streamed) emit({ type: "text.reset", runId });
              throw e;
            }
            return { calls, turnText, responseId };
          },
          abort.signal,
          (n) => emit({ type: "status", runId, message: `Connection hiccup, retrying (${n})…` })
        );
        previousResponseId = responseId;
        if (turnText) {
          finalText = turnText;
          emit({ type: "text.done", runId, text: turnText });
        }

        if (calls.length === 0) {
          // Stop hook: don't let the agent finish on unverified or broken work.
          const gap = gateBlocks < MAX_GATE_BLOCKS ? verificationGap() : null;
          if (!gap) break;
          gateBlocks++;
          this.deps.log?.(`gate ${gateBlocks}: ${gap}`);
          emit({ type: "status", runId, message: "Double-checking the work…" });
          input.push({ role: "user", content: `[Automatic check, not from the user] ${gap}` });
          continue;
        }

        // Execute: consecutive read-only calls run in parallel; everything else in order.
        const outputs = new Map<string, ToolResult>();
        let i = 0;
        while (i < calls.length) {
          if (PARALLEL_SAFE.has(calls[i]!.name) || mcpTools.has(calls[i]!.name)) {
            let j = i;
            while (j < calls.length && (PARALLEL_SAFE.has(calls[j]!.name) || mcpTools.has(calls[j]!.name))) j++;
            const batch = calls.slice(i, j);
            const res = await Promise.all(batch.map((c) => this.executeCall(c, ctx, mcp, mcpTools, counts)));
            batch.forEach((c, k) => outputs.set(c.call_id, res[k]!));
            i = j;
          } else {
            outputs.set(calls[i]!.call_id, await this.executeCall(calls[i]!, ctx, mcp, mcpTools, counts));
            i++;
          }
        }

        for (const call of calls) {
          const out = outputs.get(call.call_id)!;
          if (/COMPOSIO_MANAGE_CONNECTIONS/.test(call.name) && /https:\/\/\S*connect/i.test(out.content)) connectRequested = true;
          // Loop detection: the same call with the same arguments, again and again.
          const sig = `${call.name}:${call.arguments}`;
          const times = (seen.get(sig) ?? 0) + 1;
          seen.set(sig, times);
          let content = out.content.length > 24000 ? out.content.slice(0, 24000) + "\n…(truncated; query the dataset with run_sql instead of reading it all)" : out.content;
          if (times >= 3) content += `\n\n[Note] You've made this exact call ${times} times with the same arguments. Change your approach instead of repeating it.`;
          const imgs = [out.image, ...(out.images ?? [])].filter((x): x is string => !!x);
          const outputItem: ResponseInputItem = imgs.length
            ? {
                type: "function_call_output",
                call_id: call.call_id,
                output: [
                  { type: "input_text", text: content },
                  ...imgs.map((im) => ({ type: "input_image" as const, image_url: `data:image/png;base64,${im}`, detail: "auto" as const })),
                ],
              }
            : { type: "function_call_output", call_id: call.call_id, output: content };
          input.push(outputItem);
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.deps.log?.(`run ${runId} failed: ${error}`);
    } finally {
      await mcp.close();
    }

    emit({ type: "run.done", runId, ok: !error, error, usage });
    return { ok: !error, text: finalText, error, usage, datasets, toolCalls: counts.toolCalls, previews: counts.previews };
  }

  private async executeCall(
    call: { call_id: string; name: string; arguments: string },
    ctx: ToolContext,
    mcp: McpConnections,
    mcpTools: Map<string, McpToolInfo>,
    counts: { toolCalls: number; previews: number }
  ): Promise<ToolResult> {
    let args: Record<string, unknown> = {};
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      return { content: "Error: arguments were not valid JSON", ok: false };
    }
    const local = LOCAL_TOOLS.find((t) => t.name === call.name);
    const remote = mcpTools.get(call.name);
    counts.toolCalls++;
    if (call.name === "preview_dashboard") counts.previews++;
    // Data calls are recorded for the refresh recipe, so absolute dates the model typed become
    // placeholders anchored to today; the tools resolve them when they run. Prompting alone
    // doesn't hold (the model hardcoded "since: 2026-08-12" nine times in one build).
    let rewrites: { from: string; to: string }[] = [];
    if (local?.producesData || remote) ({ value: args, rewrites } = relativizeDates(args));
    const label = local?.label?.(args) ?? (remote ? friendlyLabel(remote, args) : call.name);
    ctx.emit({ type: "tool.start", runId: ctx.runId, callId: call.call_id, name: call.name, args, label });

    let result: ToolResult;
    try {
      if (local) {
        result = await local.execute(local.producesData ? args : substituteDates(args), ctx);
      } else if (remote) {
        result = await this.executeMcp(remote, args, ctx, mcp);
      } else {
        result = { content: `Unknown tool ${call.name}`, ok: false };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result = { content: `Error: ${msg}`, ok: false, summary: msg.slice(0, 120) };
    }
    if (rewrites.length && result.ok !== false) {
      const list = [...new Map(rewrites.map((r) => [r.from, r.to])).entries()].slice(0, 6).map(([f, t]) => `${f} → ${t}`).join(", ");
      result = { ...result, content: `${result.content}\n[Dates in your arguments were recorded as relative placeholders so scheduled refreshes keep the same window: ${list}.]` };
    }
    ctx.emit({
      type: "tool.end",
      runId: ctx.runId,
      callId: call.call_id,
      name: call.name,
      ok: result.ok !== false,
      summary: result.summary ?? result.content.slice(0, 140),
      preview: result.preview,
      screenshot: result.image,
    });
    return result;
  }

  private async executeMcp(t: McpToolInfo, args: Record<string, unknown>, ctx: ToolContext, mcp: McpConnections): Promise<ToolResult> {
    const { text, isError } = await mcp.call(t.serverId, t.name, substituteDates(args), ctx.signal);
    const connectLinks = [...text.matchAll(/https:\/\/[^\s"')\]]*connect[^\s"')\]]*/gi)].map((m) => m[0]);
    const kits = toolkitNames(args);
    for (const url of connectLinks) ctx.emit({ type: "connect.link", runId: ctx.runId, toolkit: kits, url });

    if (isError) return { content: `Error from ${t.name}: ${text.slice(0, 4000)}`, ok: false, summary: text.slice(0, 120) };

    // Meta/management tools return instructions, not data. Keep those inline.
    const isData = !/^(COMPOSIO_SEARCH_TOOLS|COMPOSIO_GET_TOOL_SCHEMAS|COMPOSIO_MANAGE_CONNECTIONS|COMPOSIO_WAIT_FOR_CONNECTIONS)$/.test(t.name);
    let parsed: unknown = null;
    if (isData) {
      try {
        parsed = JSON.parse(text);
      } catch {}
    }
    // One call can run several app tools; give each its own dataset (and its own replayable recipe step)
    // so nothing but the largest list gets lost.
    const batch = args.tools as { tool_slug?: string }[] | undefined;
    const results = (parsed as { data?: { results?: { index?: number; tool_slug?: string; response?: { successful?: boolean; error?: unknown } }[] } } | null)?.data?.results;
    if (t.name === "COMPOSIO_MULTI_EXECUTE_TOOL" && Array.isArray(batch) && batch.length > 1 && Array.isArray(results) && results.length > 1) {
      const parts: string[] = [];
      let okCount = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        const tool = batch[(r.index ?? i + 1) - 1] ?? batch[i];
        const slug = r.tool_slug ?? tool?.tool_slug ?? `tool_${i + 1}`;
        if (r.response?.successful === false) {
          parts.push(`${slug}: error ${String(r.response.error ?? "").slice(0, 300)}`);
          continue;
        }
        const one: Provenance = { kind: "tool", tool: `mcp:${t.serverId}:${t.name}`, args: { ...args, tools: [tool] } };
        const res = await storeAsDataset(ctx, slug.toLowerCase(), { successful: true, data: { results: [r] } }, one);
        okCount++;
        parts.push(`${slug}: ${res.content}`);
      }
      const content = parts.join("\n\n");
      return { content: content.length > 20000 ? content.slice(0, 20000) + "\n…(truncated; query the datasets with run_sql)" : content, ok: okCount > 0, summary: `${okCount} data set${okCount === 1 ? "" : "s"} ready` };
    }
    if (parsed && typeof parsed === "object") {
      const source: Provenance = { kind: "tool", tool: `mcp:${t.serverId}:${t.name}`, args };
      const base = guessDatasetName(t.name, args);
      return storeAsDataset(ctx, base, parsed, source);
    }
    const clipped = text.length > 12000 ? text.slice(0, 12000) + "\n…(truncated)" : text;
    return { content: clipped || "(empty result)", ok: true, summary: META_SUMMARY[t.name] ?? (/^\s*[\[{]/.test(clipped) ? "Done" : clipped.slice(0, 120).replace(/\s+/g, " ")) };
  }
}

function guessDatasetName(toolName: string, args: Record<string, unknown>) {
  if (toolName === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = args.tools as { tool_slug?: string }[] | undefined;
    const slug = tools?.[0]?.tool_slug;
    if (slug) return slug.toLowerCase();
  }
  return toolName.toLowerCase();
}

const META_LABEL: Record<string, string> = {
  COMPOSIO_SEARCH_TOOLS: "Finding the right app tools",
  COMPOSIO_GET_TOOL_SCHEMAS: "Reading app tool details",
  COMPOSIO_MANAGE_CONNECTIONS: "Checking your app connections",
  COMPOSIO_WAIT_FOR_CONNECTIONS: "Waiting for you to connect",
  COMPOSIO_MULTI_EXECUTE_TOOL: "Pulling data from your apps",
  COMPOSIO_REMOTE_WORKBENCH: "Crunching data",
  COMPOSIO_REMOTE_BASH_TOOL: "Crunching data",
};
const META_SUMMARY: Record<string, string> = {
  COMPOSIO_SEARCH_TOOLS: "Found matching tools",
  COMPOSIO_GET_TOOL_SCHEMAS: "Got tool details",
  COMPOSIO_MANAGE_CONNECTIONS: "Checked connections",
  COMPOSIO_WAIT_FOR_CONNECTIONS: "Connection status updated",
};

/** Turns a slug like granola_mcp or GOOGLESHEETS into a readable app name. */
export function prettyApp(slug: string) {
  const s = slug.replace(/[_-]?mcp$/i, "").replace(/_/g, " ").trim();
  const special: Record<string, string> = { googlesheets: "Google Sheets", googledrive: "Google Drive", gmail: "Gmail", hubspot: "HubSpot", github: "GitHub", googlecalendar: "Google Calendar", googleanalytics: "Google Analytics" };
  return special[s.toLowerCase().replace(/\s/g, "")] ?? s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function toolkitNames(args: Record<string, unknown>): string {
  const raw = args.toolkit ?? args.toolkits ?? args.toolkit_slug ?? args.app;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((t) => (typeof t === "string" ? t : String((t as Record<string, unknown>)?.name ?? (t as Record<string, unknown>)?.toolkit ?? (t as Record<string, unknown>)?.slug ?? ""))).filter(Boolean);
  return list.map(prettyApp).join(", ");
}

function friendlyLabel(t: McpToolInfo, args: Record<string, unknown>) {
  if (t.serverId === "composio") {
    if (t.name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
      const slug = (args.tools as { tool_slug?: string }[] | undefined)?.[0]?.tool_slug;
      if (slug) return `Pulling data from ${prettyApp(slug.split("_")[0] ?? slug)}`;
    }
    return META_LABEL[t.name] ?? `Using ${prettyApp(t.name.split("_")[0] ?? "your apps")}`;
  }
  return `${t.serverName}: ${t.name.replace(/_/g, " ").toLowerCase()}`;
}

/** OpenAI requires parameters to be an object schema. */
function normalizeSchema(s: Record<string, unknown>): Record<string, unknown> {
  const out = { ...s };
  if (out.type !== "object") out.type = "object";
  if (!out.properties) out.properties = {};
  delete out.$schema;
  return out;
}
