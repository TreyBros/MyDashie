import type { Tool } from "../types";
import { SKILLS } from "../skills";

export interface PlanItem {
  step: string;
  status: "pending" | "in_progress" | "done";
}

/** Structured plan, like Claude Code's task list. The harness keeps the latest copy and shows it to the user. */
export const updatePlan: Tool = {
  name: "update_plan",
  description:
    "Create or update your plan as a short checklist (3-7 steps, user-facing language, e.g. 'Pull orders from the CSV', 'Compare last 30 days'). Call it at the start, then again whenever a step finishes or the plan changes. Exactly one step should be in_progress while you work.",
  parameters: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: { step: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "done"] } },
          required: ["step", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps"],
    additionalProperties: false,
  },
  label: () => "Planning",
  async execute(args, ctx) {
    const steps = (args.steps as PlanItem[]).slice(0, 9).map((s) => ({ step: String(s.step).slice(0, 90), status: s.status }));
    ctx.plan = steps;
    ctx.emit({ type: "plan", runId: ctx.runId, steps });
    const done = steps.filter((s) => s.status === "done").length;
    return { content: `Plan saved (${done}/${steps.length} done).`, ok: true, summary: steps.find((s) => s.status === "in_progress")?.step ?? `${done} of ${steps.length} done` };
  },
};

export const loadSkill: Tool = {
  name: "load_skill",
  description: "Load a skill from your library by name to get detailed guidance and ready-made recipes. Load what the task needs; don't load everything.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", enum: SKILLS.map((s) => s.name) } },
    required: ["name"],
    additionalProperties: false,
  },
  label: (a) => `Reading the ${String(a.name)} playbook`,
  async execute(args) {
    const s = SKILLS.find((x) => x.name === args.name);
    if (!s) return { content: `No skill named "${args.name}". Available: ${SKILLS.map((x) => x.name).join(", ")}`, ok: false };
    return { content: s.body.trim(), ok: true, summary: s.summary.split(":")[0] };
  },
};

/** Exact-string edit, like Claude Code's Edit tool. Small, safe changes instead of rewriting the whole page. */
export const editDashboard: Tool = {
  name: "edit_dashboard",
  description:
    "Change the dashboard HTML by replacing an exact snippet. old_string must match the current HTML exactly (copy it from get_dashboard_html, including whitespace) and appear exactly once, unless replace_all is true. Prefer this over write_dashboard for any change to an existing dashboard. Make several small edits rather than one huge one.",
  parameters: {
    type: "object",
    properties: {
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["old_string", "new_string"],
    additionalProperties: false,
  },
  label: () => "Editing the dashboard",
  async execute(args, ctx) {
    const html = ctx.repo.getHtml(ctx.dashboardId);
    if (!html) return { content: "There is no dashboard yet. Use write_dashboard to create it first.", ok: false };
    const oldS = String(args.old_string);
    const newS = String(args.new_string);
    if (!oldS) return { content: "old_string is empty. Copy the exact snippet you want to change from get_dashboard_html.", ok: false };
    if (oldS === newS) return { content: "old_string and new_string are identical; nothing to change.", ok: false };
    const count = html.split(oldS).length - 1;
    if (count === 0) {
      // help the model recover: show the closest line
      const firstLine = oldS.split("\n").find((l) => l.trim().length > 8)?.trim() ?? oldS.slice(0, 60);
      const idx = html.indexOf(firstLine.slice(0, 40));
      const hint = idx >= 0 ? `\nThe closest match in the current HTML is:\n${html.slice(Math.max(0, idx - 120), idx + 360)}` : " Call get_dashboard_html to see the current code.";
      return { content: `old_string was not found in the dashboard HTML (it must match exactly, including whitespace).${hint}`, ok: false, summary: "Snippet not found, retrying" };
    }
    if (count > 1 && !args.replace_all)
      return { content: `old_string appears ${count} times. Include more surrounding code so it is unique, or set replace_all: true if every occurrence should change.`, ok: false, summary: "Snippet not unique, retrying" };
    const next = args.replace_all ? html.split(oldS).join(newS) : html.replace(oldS, () => newS);
    ctx.repo.setHtml(ctx.dashboardId, next);
    ctx.emit({ type: "dashboard.updated", runId: ctx.runId, dashboardId: ctx.dashboardId, what: "html" });
    ctx.htmlChangedSincePreview = true;
    return { content: `Edited ${args.replace_all ? count + " occurrence(s)" : "1 occurrence"}. Call preview_dashboard when your edits are done.`, ok: true, summary: "Edited the dashboard" };
  },
};

export const inspectDataset: Tool = {
  name: "inspect_dataset",
  description: "Profile a dataset before writing SQL: every column with its type, null count, distinct count, min/max, and a few sample values. Use it whenever you get new data.",
  parameters: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  label: (a) => `Looking closely at ${String(a.name).replace(/_/g, " ")}`,
  async execute(args, ctx) {
    const name = String(args.name);
    const ds = ctx.datasets.get(name);
    if (!ds) return { content: `Unknown dataset "${name}". Known: ${ctx.datasets.names().join(", ") || "(none)"}`, ok: false };
    if (!ds.rows) return { content: `"${name}" is not tabular. Value preview: ${JSON.stringify(ds.value).slice(0, 3000)}\nUse run_sql with UNNEST or struct access to turn the part you need into rows.`, ok: true, summary: "Not a table yet" };
    try {
      const res = await ctx.datasets.duck.query(`SUMMARIZE SELECT * FROM "${name}"`);
      const lines = res.rows.map((r) => {
        const o = r as Record<string, unknown>;
        return `- ${o.column_name} (${o.column_type}): nulls ${o.null_percentage}, distinct ~${o.approx_unique}, min ${String(o.min).slice(0, 40)}, max ${String(o.max).slice(0, 40)}`;
      });
      const sample = JSON.stringify(ds.rows.slice(0, 3)).slice(0, 1500);
      return { content: `${name}: ${ds.rows.length} rows\n${lines.join("\n")}\nSample: ${sample}`, ok: true, summary: `${ds.rows.length.toLocaleString()} rows, ${lines.length} columns` };
    } catch (e) {
      return { content: `Could not profile: ${e instanceof Error ? e.message : e}. Sample: ${JSON.stringify(ds.rows.slice(0, 3)).slice(0, 1500)}`, ok: true };
    }
  },
};

export const suggestNext: Tool = {
  name: "suggest_next",
  description: "At the very end, offer 3 short follow-up ideas the user could tap (max 8 words each), specific to this dashboard and its data, e.g. 'Break revenue down by plan', 'Add a weekly view'. Call once, right before your final message.",
  parameters: {
    type: "object",
    properties: { suggestions: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 } },
    required: ["suggestions"],
    additionalProperties: false,
  },
  label: () => "Thinking of next ideas",
  async execute(args, ctx) {
    const list = (args.suggestions as string[]).map((x) => String(x).slice(0, 60)).slice(0, 3);
    ctx.emit({ type: "suggestions", runId: ctx.runId, suggestions: list });
    return { content: "Suggestions shown to the user.", ok: true, summary: list.join(" · ") };
  },
};

/** Human in the loop: ask focused questions with tappable options and wait for the answers. */
export const askUser: Tool = {
  name: "ask_user",
  description:
    "Ask the user 1-4 focused questions and wait for their answers. Each question offers 2-5 concrete options built from what you learned about their data (e.g. real column values, real date ranges), and the user can also type their own answer. Use it before building a new dashboard when choices materially change the result (which metric definition, time window, breakdowns, audience, extra pages), and during edits only if the request is ambiguous. Put a one-sentence proposed outline in intro when useful. Never ask about things you can sensibly decide yourself. At most 2 rounds per run.",
  parameters: {
    type: "object",
    properties: {
      intro: { type: "string", description: "One short sentence of context, e.g. your proposed outline." },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            question: { type: "string" },
            options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
            multi: { type: "boolean", description: "true if several options can be chosen" },
          },
          required: ["id", "question", "options"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  label: () => "Checking a few details with you",
  async execute(args, ctx) {
    ctx.questionRounds = (ctx.questionRounds ?? 0) + 1;
    if (ctx.questionRounds > 2) return { content: "You've already asked twice. Proceed with your best judgment and state your assumptions at the end.", ok: false };
    const questions = (args.questions as { id: string; question: string; options: string[]; multi?: boolean }[]).slice(0, 4).map((q, i) => ({
      id: String(q.id || `q${i + 1}`),
      question: String(q.question).slice(0, 200),
      options: q.options.map((o) => String(o).slice(0, 80)).slice(0, 5),
      multi: !!q.multi,
    }));
    if (!ctx.askUser) {
      return { content: "The user isn't available to answer right now. Use your best judgment (pick the most sensible option for each question) and mention the assumptions in your final message.", ok: true, summary: "Using best judgment" };
    }
    const answers = await ctx.askUser({ intro: args.intro ? String(args.intro).slice(0, 300) : undefined, questions });
    const lines = questions.map((q) => `- ${q.question} -> ${(answers[q.id] ?? []).join(", ") || "(no preference, use your judgment)"}`);
    // remember the decisions for future edits
    const m = ctx.repo.get(ctx.dashboardId);
    ctx.repo.update(ctx.dashboardId, { brief: [...(m?.brief ?? []), ...lines.map((l) => l.slice(2))].slice(-20) });
    return { content: `The user answered:\n${lines.join("\n")}\nFollow these choices exactly.`, ok: true, summary: "Got your answers" };
  },
};
