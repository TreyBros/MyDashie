import { ipcMain, dialog, shell, app, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { z } from "zod";
import { IPC } from "@shared/ipc";
import type { ActivityStep, AgentAnswers, AgentEvent, ModelInfo, RunRequest } from "@shared/types";
import { stageOf } from "@shared/stages";
import { describeModel, MODEL_FILTER } from "@shared/models";
import { runCost } from "@shared/pricing";
import { modelFor, resolvePower } from "@shared/power";
import { classifyIntent } from "./agent/intent";
import OpenAI from "openai";
import {
  dashboardCreateSchema,
  dashboardIdSchema,
  dashboardUpdateSchema,
  mcpAddSchema,
  mcpServerSchema,
  runRequestSchema,
  secretSetSchema,
  settingsPatchSchema,
} from "@shared/schemas";
import type { AppContext } from "./context";
import { exportStandalone } from "./dashboards/export";
import { testMcpServer } from "./connectors/mcp";
import { nextRun } from "./scheduler";

function handle<T>(channel: string, schema: z.ZodType<T> | null, fn: (arg: T, ev: IpcMainInvokeEvent) => unknown) {
  ipcMain.handle(channel, async (ev, raw) => {
    const arg = schema ? schema.parse(raw) : (raw as T);
    return fn(arg, ev);
  });
}

export function registerIpc(ctx: AppContext) {
  const { repo, settings, secrets, mcpStore, composio, scheduler, harness, usage, cloud } = ctx;
  const activeRuns = new Map<string, AbortController>();
  /** Questions Dashie is waiting on, keyed by request id. */
  const pendingQuestions = new Map<string, { dashboardId: string; resolve: (a: AgentAnswers) => void; reject: (e: Error) => void }>();

  const broadcast = (channel: string, payload: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
  };
  repo.onChange(() => broadcast(IPC.dashboardsChanged, null));

  // ---- dashboards ----
  handle(IPC.dashboardsList, null, () => repo.list());
  handle(IPC.dashboardGet, dashboardIdSchema, (id) => repo.get(id) ?? null);
  handle(IPC.dashboardCreate, dashboardCreateSchema, (input) => repo.create(input));
  handle(IPC.dashboardUpdate, dashboardUpdateSchema, ({ id, patch }) => {
    const before = repo.get(id);
    const m = repo.update(id, patch.name ? { ...patch, name: patch.name.trim(), nameLocked: true, aiName: before?.aiName ?? before?.name } : patch);
    if (patch.schedule) {
      repo.update(id, { schedule: { ...patch.schedule, nextRunAt: nextRun(patch.schedule)?.toISOString(), lastRunAt: m.schedule.lastRunAt } });
    }
    return repo.get(id);
  });
  handle(IPC.dashboardDelete, dashboardIdSchema, (id) => {
    activeRuns.get(id)?.abort();
    repo.delete(id);
  });
  handle(IPC.dashboardChat, dashboardIdSchema, (id) => repo.getChat(id));
  handle(IPC.dashboardData, dashboardIdSchema, (id) => repo.getData(id) ?? null);
  handle(IPC.dashboardHtml, dashboardIdSchema, (id) => repo.getHtml(id) ?? null);
  handle(IPC.dashboardRefreshLog, dashboardIdSchema, (id) => repo.getRefreshLog(id));
  handle(IPC.dashboardRefresh, dashboardIdSchema, async (id) => {
    void scheduler.runNow(id, "manual");
    return true;
  });
  handle(IPC.dashboardExport, dashboardIdSchema, async (id, ev) => {
    const m = repo.get(id);
    if (!m) throw new Error("Not found");
    const win = BrowserWindow.fromWebContents(ev.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      defaultPath: `${m.name.replace(/[\\/:*?"<>|]/g, "-")}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (canceled || !filePath) return null;
    writeFileSync(filePath, exportStandalone(repo, ctx.libsDir, id));
    return filePath;
  });
  handle(IPC.dashboardOpenInBrowser, dashboardIdSchema, async (id) => {
    const m = repo.get(id);
    if (!m) throw new Error("Not found");
    const file = `${app.getPath("temp")}/dash-${id}.html`;
    writeFileSync(file, exportStandalone(repo, ctx.libsDir, id));
    await shell.openPath(file);
    return file;
  });
  handle(IPC.dashboardReveal, dashboardIdSchema, (id) => shell.showItemInFolder(repo.dir(id)));
  handle(IPC.dashboardVersions, dashboardIdSchema, (id) => repo.listVersions(id));
  handle(IPC.dashboardRestore, z.object({ id: dashboardIdSchema, version: z.string().max(60) }), ({ id, version }) => {
    repo.restoreVersion(id, version);
    return repo.get(id);
  });

  // ---- agent ----
  /** A tiny classifier call for messages the wording rules can't settle. */
  const classify = async (prompt: string) => {
    const key = secrets.get("openai");
    if (!key) throw new Error("no key");
    const r = await new OpenAI({ apiKey: key }).responses.create({ model: modelFor("quick").model, input: prompt, max_output_tokens: 16, reasoning: { effort: "low" } });
    return r.output_text ?? "";
  };

  handle(IPC.agentRun, runRequestSchema, async (req: RunRequest, ev) => {
    // Signed-in customers need credits to run the model; refreshes are never gated.
    const blocked = await cloud.gate();
    if (blocked) throw new Error(blocked);
    const m = repo.get(req.dashboardId);
    if (!m) throw new Error("Dashboard not found");
    const s = settings.get();
    // One chat, two paths: a question about an existing dashboard is answered; anything else is a change.
    const intent = req.mode === "edit" && m.hasHtml ? (req.intent ?? (await classifyIntent(req.message, classify)).intent) : "change";
    const mode: "build" | "edit" | "ask" = intent === "ask" ? "ask" : req.mode;
    const level = resolvePower(req.power ?? s.power, mode, req.message);
    const model = s.developer && mode !== "ask" ? s.buildModel : modelFor(level);
    if (req.refundLast) {
      // The previous run went down the wrong path; give those credits back.
      const prev = [...repo.getChat(req.dashboardId)].reverse().find((x) => x.role === "assistant" && x.activity?.credits);
      const credits = prev?.activity?.credits ?? 0;
      if (credits > 0) {
        usage.append({ at: new Date().toISOString(), dashboardId: req.dashboardId, kind: "adjust", toolCalls: 0, durationMs: 0, costUsd: 0, credits: -credits, ok: true });
        repo.addSpend(req.dashboardId, -credits);
      }
    }
    const abort = new AbortController();
    activeRuns.get(req.dashboardId)?.abort();
    activeRuns.set(req.dashboardId, abort);
    const sender = ev.sender;
    const steps: ActivityStep[] = [];
    const startedAt = Date.now();
    let needsConnection = false;
    let plan: { step: string; status: "pending" | "in_progress" | "done" }[] | undefined;
    let suggestions: string[] | undefined;
    const versionBefore = mode === "ask" ? undefined : repo.saveVersion(req.dashboardId, req.message);
    const sel = req.selection;
    const scoped = sel
      ? mode === "ask"
        ? `${req.message}\n\n[The user is asking about the ${sel.kind} "${sel.title}"${sel.id ? ` (element id "${sel.id}")` : ""}${sel.page ? ` on the "${sel.page}" page` : ""}.]`
        : `${req.message}\n\n[The user selected the ${sel.kind} "${sel.title}"${sel.id ? ` (element id "${sel.id}")` : ""}${sel.page ? ` on the "${sel.page}" page` : ""}. Apply this change to that element only and leave everything else exactly as it is.]`
      : req.message;
    const send = (e: AgentEvent) => {
      if (e.type === "connect.link") needsConnection = true;
      if (e.type === "plan") plan = e.steps;
      if (e.type === "question.answered") steps.push({ id: `qa${steps.length}`, kind: "note", label: `You chose: ${e.summary}`, stage: "plan", startedAt: Date.now(), endedAt: Date.now() });
      if (e.type === "suggestions") suggestions = e.suggestions;
      if (e.type === "tool.start") steps.push({ id: e.callId, kind: "tool", tool: e.name, label: e.label, stage: stageOf(e.name), startedAt: Date.now() });
      if (e.type === "tool.end") {
        const st = steps.find((x) => x.id === e.callId);
        if (st) Object.assign(st, { ok: e.ok, summary: e.ok ? e.summary : "Hit a snag, tried another way", endedAt: Date.now() });
      }
      if (e.type === "text.done") {
        const last = steps[steps.length - 1];
        steps.push({ id: `n${steps.length}`, kind: "note", label: e.text, stage: last?.stage ?? "plan", startedAt: Date.now(), endedAt: Date.now() });
      }
      if (!sender.isDestroyed()) sender.send(IPC.agentEvent, { dashboardId: req.dashboardId, event: e });
    };
    repo.appendChat(req.dashboardId, { role: "user", content: req.message, at: new Date().toISOString(), selection: sel, intent: m.hasHtml ? intent : undefined });
    if (mode !== "ask") repo.update(req.dashboardId, { status: m.hasHtml ? m.status : "building" });
    void (async () => {
      try {
        send({ type: "intent", runId: "pending", intent, level });
        const result = await harness.run({
          dashboardId: req.dashboardId,
          mode,
          userMessage: scoped,
          model,
          history: repo.getChat(req.dashboardId).slice(0, -1),
          onEvent: send,
          signal: abort.signal,
          askUser: (dashboardId, runId, q) =>
            new Promise<AgentAnswers>((resolve, reject) => {
              const requestId = "q_" + Math.random().toString(36).slice(2, 10);
              pendingQuestions.set(requestId, { dashboardId, resolve, reject });
              abort.signal.addEventListener("abort", () => {
                pendingQuestions.delete(requestId);
                reject(new Error("Cancelled"));
              });
              send({ type: "question", runId, requestId, intro: q.intro, questions: q.questions });
            }).then((answers) => {
              const summary = q.questions.map((qq) => `${qq.question} ${(answers[qq.id] ?? []).join(", ") || "Your call"}`).join(" · ");
              send({ type: "question.answered", runId, requestId: "", summary });
              return answers;
            }),
        });
        // Meter the run: credits for the user, real cost for the private ledger.
        const cost = runCost({ model: model.model, usage: result.usage, toolCalls: result.toolCalls, previews: result.previews, level });
        usage.append({ at: new Date().toISOString(), dashboardId: req.dashboardId, kind: mode, level, model: model.model, usage: result.usage, toolCalls: result.toolCalls, previews: result.previews, durationMs: Date.now() - startedAt, costUsd: cost.costUsd, credits: cost.credits, ok: result.ok });
        repo.addSpend(req.dashboardId, cost.credits);
        // The final reply is the last note; earlier notes stay inside the activity trace.
        const lastNote = [...steps].reverse().find((x) => x.kind === "note");
        const traceSteps = steps.filter((x) => x !== lastNote);
        repo.appendChat(req.dashboardId, {
          role: "assistant",
          content: result.text || (result.ok ? "" : result.error ?? "Something went wrong."),
          at: new Date().toISOString(),
          activity: { steps: traceSteps.filter((x) => x.tool !== "update_plan"), startedAt, endedAt: Date.now(), ok: result.ok, mode, level, needsConnection, plan, suggestions, versionBefore, credits: cost.credits },
        });
        const after = repo.get(req.dashboardId);
        if (after) {
          if (!after.hasHtml) repo.update(req.dashboardId, { status: result.ok ? "draft" : "error", lastError: result.error });
          else if (after.status === "building") repo.update(req.dashboardId, { status: "ready" });
          if (after.hasHtml && after.schedule.kind !== "off" && !after.schedule.nextRunAt) scheduler.reschedule(req.dashboardId);
        }
        await result.datasets.close();
      } catch (e) {
        send({ type: "run.done", runId: "x", ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        activeRuns.delete(req.dashboardId);
      }
    })();
    return true;
  });
  handle(IPC.agentAnswer, z.object({ requestId: z.string().max(40), answers: z.record(z.string().max(40), z.array(z.string().max(400)).max(8)) }), ({ requestId, answers }) => {
    const p = pendingQuestions.get(requestId);
    if (!p) return false;
    pendingQuestions.delete(requestId);
    p.resolve(answers);
    return true;
  });
  handle(IPC.agentCancel, dashboardIdSchema, (id) => {
    activeRuns.get(id)?.abort();
    return true;
  });

  // ---- settings / secrets / models ----
  handle(IPC.settingsGet, null, () => settings.get());
  handle(IPC.settingsSet, settingsPatchSchema, (patch) => {
    const s = settings.patch(patch);
    if (patch.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
    return s;
  });
  handle(IPC.secretsStatus, null, () => secrets.status());
  handle(IPC.secretsSet, secretSetSchema, async ({ key, value }) => {
    if (key === "openai") {
      const r = await fetch("https://api.openai.com/v1/models?limit=1", { headers: { Authorization: `Bearer ${value.trim()}` } });
      if (!r.ok) throw new Error(r.status === 401 ? "That OpenAI key was rejected." : `OpenAI returned ${r.status}`);
    } else {
      const r = await fetch("https://backend.composio.dev/api/v3/toolkits?limit=1", { headers: { "x-api-key": value.trim() } });
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? "That Composio key was rejected." : `Composio returned ${r.status}`);
      composio.invalidate();
    }
    secrets.set(key, value);
    return secrets.status();
  });
  handle(IPC.secretsClear, z.enum(["openai", "composio"]), (key) => {
    secrets.clear(key);
    if (key === "composio") composio.invalidate();
    return secrets.status();
  });
  handle(IPC.modelsList, null, async (): Promise<ModelInfo[]> => {
    const key = secrets.get("openai");
    if (!key) return [];
    const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`OpenAI returned ${r.status}`);
    const d = (await r.json()) as { data: { id: string }[] };
    const ids = d.data.map((m) => m.id).filter((id) => MODEL_FILTER.test(id) && !/\d{4}-\d{2}-\d{2}$/.test(id) && !/chat-latest|pro$/.test(id));
    const order = { flagship: 0, balanced: 1, efficient: 2, other: 3 };
    return ids.map(describeModel).sort((a, b) => order[a.tier] - order[b.tier] || b.id.localeCompare(a.id));
  });

  // ---- connections ----
  handle(IPC.connectionsList, null, async () => (composio.available() ? composio.listToolkits({ connectedOnly: true }) : []));
  handle(IPC.connectionsSearchToolkits, z.string().max(80), (q) => composio.searchToolkits(q));
  handle(IPC.connectionsConnect, z.string().max(80), async (toolkit) => {
    const { url, wait } = await composio.connectLink(toolkit);
    if (url) await shell.openExternal(url);
    void wait().then(() => broadcast(IPC.dashboardsChanged, null)).catch(() => {});
    return url;
  });
  handle(IPC.connectionsDisconnect, z.string().max(120), (accountId) => composio.disconnect(accountId));

  handle(IPC.mcpList, null, () => mcpStore.all());
  handle(IPC.mcpAdd, mcpAddSchema, (cfg) => mcpStore.add(cfg));
  handle(IPC.mcpUpdate, mcpServerSchema, (cfg) => mcpStore.update(cfg.id, cfg));
  handle(IPC.mcpRemove, z.string().max(40), (id) => mcpStore.remove(id));
  handle(IPC.mcpTest, mcpServerSchema, (cfg) => testMcpServer(cfg));
  handle(IPC.localSources, null, () => ctx.localSources());

  // ---- usage (credits) ----
  handle(IPC.usageSummary, z.object({ since: z.string().max(40).optional() }).nullable(), (arg) => usage.summary(arg?.since ?? undefined));
  handle(IPC.usageExport, null, async (_a, ev) => {
    const win = BrowserWindow.fromWebContents(ev.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win!, { defaultPath: "mydashie-usage.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (canceled || !filePath) return null;
    writeFileSync(filePath, usage.csv());
    return filePath;
  });

  // ---- account (cloud) ----
  handle(IPC.accountStatus, null, () => cloud.status());
  handle(IPC.accountSignIn, null, async () => {
    const url = cloud.beginLogin();
    await shell.openExternal(url);
    return url;
  });
  handle(IPC.accountMagicLink, z.object({ email: z.string().trim().email().max(200) }), async ({ email }) => {
    await cloud.requestMagicLink(email);
    return true;
  });
  handle(IPC.accountVerifyCode, z.object({ email: z.string().trim().email().max(200), code: z.string().max(16) }), ({ email, code }) => cloud.verifyCode(email, code));
  handle(IPC.accountCancelLogin, null, () => {
    cloud.cancelLogin();
  });
  handle(IPC.accountSignOut, null, () => cloud.signOut());
  handle(IPC.accountCheckout, z.object({ kind: z.enum(["plan", "pack"]), id: z.string().max(40) }), async ({ kind, id }) => {
    const url = await cloud.checkoutUrl(kind, id);
    await shell.openExternal(url);
    return url;
  });
  handle(IPC.accountPortal, null, async () => {
    const url = await cloud.portalUrl();
    await shell.openExternal(url);
    return url;
  });

  // ---- app ----
  handle(IPC.appVersion, null, () => app.getVersion());
  handle(IPC.appUpdateStatus, null, () => ctx.updater.get());
  handle(IPC.appUpdateCheck, null, () => ctx.updater.check());
  handle(IPC.appUpdateInstall, null, () => ctx.updater.install());
  handle(IPC.appOpenExternal, z.string().url(), (url) => {
    if (/^https?:/.test(url)) return shell.openExternal(url);
    return undefined;
  });
  handle(IPC.appPickFile, null, async (_a, ev) => {
    const win = BrowserWindow.fromWebContents(ev.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      defaultPath: homedir(),
      properties: ["openFile"],
      filters: [{ name: "Data", extensions: ["csv", "tsv", "json", "xlsx", "xls", "parquet", "db", "sqlite", "sqlite3"] }],
    });
    return canceled ? null : (filePaths[0] ?? null);
  });
}
