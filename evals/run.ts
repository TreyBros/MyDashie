/**
 * Dashie eval suite. Runs real builds headlessly against public/local data, renders each result in
 * Chrome, runs automated QA, replays the refresh recipe, and has a vision model grade the screenshot.
 *
 *   npx tsx --tsconfig tsconfig.node.json evals/run.ts [--label baseline] [--only id,id] [--model gpt-6.1-sol]
 *
 * Writes evals/results/<label>/{report.json, report.md, *.png}.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import OpenAI from "openai";
import { chromium, type Browser } from "playwright-core";
import { Paths } from "../src/main/store/paths";
import { SecretsStore, plainCipher } from "../src/main/store/secrets";
import { DashboardRepo } from "../src/main/dashboards/repo";
import { AgentHarness } from "../src/main/agent/harness";
import { refreshDashboard } from "../src/main/scheduler/refresh";
import { exportStandalone } from "../src/main/dashboards/export";
import { QA_SCRIPT, formatQa, type QaReport } from "../src/main/agent/qa";
import type { PreviewRenderer } from "../src/main/agent/types";
import { CASES, type EvalCase } from "./cases";
import { DuckDBInstance } from "@duckdb/node-api";

/** Every number shown on the page, normalized ("$48.2k" -> 48200, "12.3%" -> 12.3). */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(-?\$?\s?\d[\d,]*\.?\d*)\s?([kKmMbB](?![a-zA-Z]))?/g)) {
    const n = parseFloat(m[1]!.replace(/[$,\s]/g, ""));
    if (isNaN(n)) continue;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase()] ?? 1;
    out.push(n * mult);
  }
  return out;
}

async function truthChecks(c: EvalCase, pageText: string) {
  if (!c.truth?.length) return undefined;
  const db = await (await DuckDBInstance.create(":memory:")).connect();
  await db.run("INSTALL json; LOAD json;").catch(() => {});
  const nums = numbersIn(pageText);
  const results: { label: string; expected: number; found: boolean }[] = [];
  for (const t of c.truth) {
    const r = await db.runAndReadAll(t.sql);
    const v = Number(Object.values(r.getRowObjectsJson()[0] ?? {})[0]);
    const target = t.percent ? v * 100 : v;
    // tolerate display rounding: 1 decimal, or k/M abbreviations (~3%)
    const found = nums.some((n) => Math.abs(n - target) <= Math.max(0.051, Math.abs(target) * 0.012));
    results.push({ label: t.label, expected: Math.round(target * 100) / 100, found });
  }
  return results;
}

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const label = arg("label") ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const only = arg("only")?.split(",");
const model = arg("model") ?? "gpt-6.1-sol";
const effort = (arg("effort") ?? "medium") as "low" | "medium" | "high";
const concurrency = Number(arg("concurrency") ?? 3);

const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const libsDir = join(root, "resources/libs");
const outDir = join(root, "evals/results", label);
mkdirSync(outDir, { recursive: true });

// Price per 1M tokens (USD) for cost reporting.
const PRICE: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-6.1-sol": { in: 2, cached: 0.1, out: 10 },
  "gpt-6-luna": { in: 0.1, cached: 0.01, out: 0.5 },
  "gpt-6-astra": { in: 10, cached: 1, out: 50 },
};
const cost = (u: { input: number; output: number; cached?: number }, m: string) => {
  const p = PRICE[m] ?? PRICE["gpt-6.1-sol"]!;
  const cached = u.cached ?? 0;
  return ((u.input - cached) * p.in + cached * p.cached + u.output * p.out) / 1e6;
};

/** Headless preview: export the dashboard as one HTML file and render it in Chrome. */
class ChromePreview implements PreviewRenderer {
  constructor(private browser: Browser, private repo: DashboardRepo) {}
  async render(id: string) {
    const page = await this.browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    try {
      const file = join(mkdtempSync(join(tmpdir(), "dash-eval-")), "index.html");
      writeFileSync(file, exportStandalone(this.repo, libsDir, id));
      await page.goto(`file://${file}?theme=light`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1800);
      const shoot = async () => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(250);
        const qa = (await page.evaluate(QA_SCRIPT).catch(() => undefined)) as QaReport | undefined;
        const h = Math.min(2600, qa?.stats.pageHeight ?? 800);
        if (h > 800) {
          await page.setViewportSize({ width: 1280, height: h });
          await page.waitForTimeout(400);
        }
        return { png: Buffer.from(await page.screenshot({ fullPage: false })), qa };
      };
      const ids = ((await page.evaluate("window.Dash && Dash.pageIds ? Dash.pageIds() : []").catch(() => [])) as string[]) ?? [];
      if (ids.length < 2) {
        const one = await shoot();
        return { png: one.png, errors, title: await page.title(), qa: one.qa };
      }
      const pages = [];
      for (const id of ids.slice(0, 6)) {
        await page.evaluate(`Dash.showPage(${JSON.stringify(id)})`);
        await page.waitForTimeout(700);
        pages.push({ id, title: (await page.evaluate(`Dash.pageTitle(${JSON.stringify(id)})`)) as string, ...(await shoot()) });
      }
      return { png: pages[0]!.png, errors, title: await page.title(), qa: pages[0]!.qa, pages };
    } finally {
      await page.close();
    }
  }
}

async function judge(png: Buffer, prompt: string, expect: string[], extra: Buffer[] = []) {
  const r = await openai.responses.create({
    model: "gpt-6.1-sol",
    reasoning: { effort: "low" },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `You are a strict senior BI designer grading an auto-generated dashboard. The first screenshot is the FULL page (it may be taller than one screen). If more screenshots follow, they are the other tabs of a multi-page dashboard; grade the dashboard as a whole; judge content below the first 800px too, but penalize clarity if the key KPIs and main chart are not near the top.
Request: "${prompt}"
Must-haves: ${expect.map((e, i) => `(${i + 1}) ${e}`).join("; ")}.
Score 1-10 each: coverage (must-haves present), clarity (instantly readable: hierarchy, labels, formatting), design (polish, alignment, spacing, color restraint), trust (numbers look plausible and consistent, no junk values).
Return only JSON: {"coverage":n,"clarity":n,"design":n,"trust":n,"missing":["..."],"top_issue":"one sentence"}`,
          },
          ...[png, ...extra].map((b) => ({ type: "input_image" as const, image_url: `data:image/png;base64,${b.toString("base64")}`, detail: "high" as const })),
        ],
      },
    ],
  });
  const m = r.output_text.match(/\{[\s\S]*\}/);
  return m ? (JSON.parse(m[0]) as { coverage: number; clarity: number; design: number; trust: number; missing: string[]; top_issue: string }) : null;
}

interface Result {
  id: string;
  ok: boolean;
  error?: string;
  seconds: number;
  turns: number;
  tools: number;
  toolErrors: number;
  usd: number;
  qaIssues: number;
  qaDetail: string[];
  refreshOk: boolean;
  /** Why the refresh didn't count: the error, or what the heal changed. */
  refreshNote?: string;
  editOk?: boolean;
  truth?: { label: string; expected: number; found: boolean }[];
  fabricated?: boolean;
  asked?: number;
  questions?: string[];
  pages?: number;
  preserved?: number;
  editRefetches?: number;
  loopFails?: string[];
  /** Ask-mode check: the answer, and whether the page stayed untouched. */
  askAnswer?: string;
  askTools?: number;
  score?: number;
  judge?: Awaited<ReturnType<typeof judge>>;
}

async function runCase(c: (typeof CASES)[number], browser: Browser): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), `dash-eval-${c.id}-`));
  const paths = new Paths(dir);
  const secrets = new SecretsStore(paths, plainCipher, { openai: env.OPENAI_API_KEY });
  const repo = new DashboardRepo(paths);
  const preview = new ChromePreview(browser, repo);
  const harness = new AgentHarness({ repo, openaiKey: () => secrets.get("openai"), mcpServers: async () => [], preview, homeDir: homedir(), log: process.env.EVAL_TRACE ? (m) => console.log("   [agent]", m) : undefined });
  const d = repo.create({ name: "New Dashboard", prompt: c.prompt });
  let tools = 0,
    toolErrors = 0,
    turns = 0;
  const onEvent = (e: { type: string; ok?: boolean }) => {
    if (e.type === "tool.end") {
      tools++;
      if (!e.ok) toolErrors++;
    }
    if (e.type === "status" && /Thinking|Working/.test((e as { message?: string }).message ?? "")) turns++;
  };
  const t0 = Date.now();
  const usage = { input: 0, output: 0, cached: 0 };
  const add = (u: { input: number; output: number; cached?: number }) => {
    usage.input += u.input;
    usage.output += u.output;
    usage.cached += u.cached ?? 0;
  };
  const asked: string[] = [];
  const answered: string[] = [];
  const simulatedUser = async (_id: string, _run: string, q: { intro?: string; questions: { id: string; question: string; options: string[] }[] }) => {
    asked.push(...q.questions.map((x) => `${x.question} [${x.options.join(" | ")}]`));
    return Object.fromEntries(
      q.questions.map((x) => {
        const pick = (c.prefer && x.options.find((o) => c.prefer!.test(o))) || x.options[0]!;
        answered.push(`${x.question} -> ${pick}`);
        return [x.id, [pick]];
      })
    );
  };
  let phase: "build" | "edit" = "build";
  const fetchTools = /^(http_get|read_local_file|COMPOSIO_MULTI_EXECUTE_TOOL)$/;
  let editRefetches = 0;
  const onEvent2 = (e: { type: string; ok?: boolean; name?: string }) => {
    onEvent(e);
    if (phase === "edit" && e.type === "tool.start" && fetchTools.test(e.name ?? "")) editRefetches++;
  };
  const build = await harness.run({ dashboardId: d.id, mode: "build", userMessage: c.prompt, model: { model, effort }, onEvent: onEvent2 as never, maxTurns: 45, askUser: simulatedUser });
  add(build.usage);
  await build.datasets.close();
  let editOk: boolean | undefined;
  if (c.edit && build.ok && repo.getHtml(d.id)) {
    const before = repo.getHtml(d.id);
    phase = "edit";
    const ed = await harness.run({ dashboardId: d.id, mode: "edit", userMessage: c.edit, model: { model, effort }, onEvent: onEvent2 as never, askUser: simulatedUser, history: [{ role: "user", content: c.prompt, at: "" }, { role: "assistant", content: build.text, at: "" }], maxTurns: 30 });
    add(ed.usage);
    await ed.datasets.close();
    editOk = ed.ok && repo.getHtml(d.id) !== before;
    // How surgical was the edit? Share of the original tokens that survived (token-level, since
    // generated pages often put a whole chart config on one long line).
    const tokens = (h: string) => h.split(/[\s<>{}()[\],;:'"`=]+/).filter(Boolean);
    const beforeLines = tokens(before ?? "");
    const after = new Map<string, number>();
    for (const l of tokens(repo.getHtml(d.id) ?? "")) after.set(l, (after.get(l) ?? 0) + 1);
    let kept = 0;
    for (const l of beforeLines) {
      const n = after.get(l) ?? 0;
      if (n > 0) {
        kept++;
        after.set(l, n - 1);
      }
    }
    (globalThis as { __preserved?: number }).__preserved = beforeLines.length ? kept / beforeLines.length : 1;
  }
  let askAnswer: string | undefined;
  let askTools: number | undefined;
  let askChanged = false;
  if (c.ask && build.ok && repo.getHtml(d.id)) {
    // A question about the first card, the way the app sends it: structured selection, ask mode, Quick level.
    const before = repo.getHtml(d.id);
    const title = (before?.match(/title:\s*"([^"]{4,80})"/) ?? [])[1] ?? "the first card";
    const qa = await harness.run({ dashboardId: d.id, mode: "ask", userMessage: `${c.ask}\n\n[The user is asking about the card "${title}".]`, model: { model: "gpt-6-luna", effort: "low" }, onEvent: onEvent2 as never, maxTurns: 10 });
    add(qa.usage);
    await qa.datasets.close();
    askAnswer = qa.text;
    askTools = qa.toolCalls;
    askChanged = repo.getHtml(d.id) !== before;
  }
  const seconds = (Date.now() - t0) / 1000;
  const hasHtml = !!repo.getHtml(d.id);
  const preserved = c.edit ? (globalThis as { __preserved?: number }).__preserved : undefined;
  const result: Result = { asked: asked.length, questions: asked, preserved, editRefetches: c.edit ? editRefetches : undefined, id: c.id, ok: build.ok && hasHtml, error: build.error ?? (hasHtml ? undefined : "no dashboard written"), seconds, turns, tools, toolErrors, usd: cost(usage, model), qaIssues: 0, qaDetail: [], refreshOk: false, editOk, askAnswer, askTools };
  if (c.mustNotFabricate) {
    const recipe = repo.getRecipe(d.id);
    const published = repo.get(d.id)?.datasets.length ?? 0;
    result.fabricated = published > 0 || !!recipe?.steps.some((st) => st.source.kind === "inline");
    result.ok = !result.fabricated;
    result.error = result.fabricated ? "made up data instead of saying it was unavailable" : undefined;
    result.score = result.fabricated ? 0 : 10;
    return result;
  }
  if (!hasHtml) return result;

  const shot = await preview.render(d.id);
  result.pages = shot.pages?.length ?? 1;
  if (shot.pages) shot.pages.forEach((p, i) => i > 0 && writeFileSync(join(outDir, `${c.id}-page${i + 1}.png`), p.png));
  const fails: string[] = [];
  if (c.minPages && (result.pages ?? 1) < c.minPages) fails.push(`only ${result.pages} page(s), expected ${c.minPages}+`);
  if (c.minPreserved != null && (preserved ?? 0) < c.minPreserved) fails.push(`edit kept ${Math.round((preserved ?? 0) * 100)}% of the page, expected ${Math.round(c.minPreserved * 100)}%+`);
  if (c.expectQuestions && !asked.length) fails.push("didn't ask any questions on a vague request");
  if (c.ask) {
    if (askChanged) fails.push("a question changed the page");
    if ((askTools ?? 0) > 4) fails.push(`a question used ${askTools} tools`);
    if (!askAnswer || askAnswer.length < 40) fails.push("a question got no real answer");
    if (/\b(sql|duckdb|composio|mcp|tool)\b/i.test(askAnswer ?? "")) fails.push("the answer mentioned internals");
  }
  if (c.edit && (result.editRefetches ?? 0) > 0 && c.minPreserved != null && c.minPreserved >= 0.95) fails.push(`edit re-fetched data ${result.editRefetches}x for a cosmetic change`);
  result.loopFails = fails;
  {
    const page = await browser.newPage();
    const file = join(mkdtempSync(join(tmpdir(), "dash-text-")), "index.html");
    writeFileSync(file, exportStandalone(repo, libsDir, d.id));
    await page.goto(`file://${file}`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    result.truth = await truthChecks(c, (await page.evaluate("document.body.innerText")) as string);
    await page.close();
  }
  writeFileSync(join(outDir, `${c.id}.png`), shot.png);
  const qa = formatQa(shot.qa ?? { issues: [], stats: { charts: 0, kpis: 0, tables: 0, textLength: 0, usesKit: false } }, shot.errors);
  result.qaIssues = qa.issues.length;
  result.qaDetail = qa.issues.map((i) => `[${i.kind}] ${i.detail}`);
  const refresh = await refreshDashboard({ repo, mcpServers: async () => [], harness, refreshModel: () => ({ model: "gpt-6-luna", effort: "low" }), homeDir: homedir(), log: (l) => console.log("   [refresh]", l) }, d.id);
  result.refreshOk = refresh.ok && !refresh.healed;
  if (!result.refreshOk) result.refreshNote = refresh.healed ? `healed: ${refresh.healNote ?? ""}` : refresh.error;
  result.judge = await judge(shot.png, c.prompt + (answered.length ? ` (When asked, the user answered: ${answered.join("; ")}.)` : "") + (c.edit ? ` Then: ${c.edit}` : ""), c.expect, (shot.pages ?? []).slice(1).map((p) => p.png)).catch(() => null);
  if (result.judge) result.score = Math.round(((result.judge.coverage + result.judge.clarity + result.judge.design + result.judge.trust) / 4) * 10) / 10;
  return result;
}

const browser = await chromium.launch({ channel: "chrome" });
const suite = arg("suite");
const cases = CASES.filter((c) => (!only || only.includes(c.id)) && (!suite || (c.suite ?? "core") === suite));
const results: Result[] = [];
const queue = [...cases];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      process.stdout.write(`▶ ${c.id}\n`);
      try {
        const r = await runCase(c, browser);
        results.push(r);
        process.stdout.write(`✓ ${c.id} ok=${r.ok} score=${r.score ?? "-"} qa=${r.qaIssues} refresh=${r.refreshOk}${r.refreshNote ? ` (${r.refreshNote.slice(0, 120)})` : ""} edit=${r.editOk ?? "-"} ${r.seconds.toFixed(0)}s $${r.usd.toFixed(3)}\n`);
      } catch (e) {
        results.push({ id: c.id, ok: false, error: String(e), seconds: 0, turns: 0, tools: 0, toolErrors: 0, usd: 0, qaIssues: 0, qaDetail: [], refreshOk: false });
        process.stdout.write(`✗ ${c.id} ${String(e).slice(0, 200)}\n`);
      }
    }
  })
);
await browser.close();

results.sort((a, b) => CASES.findIndex((c) => c.id === a.id) - CASES.findIndex((c) => c.id === b.id));
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const scored = results.filter((r) => r.score != null);
const summary = {
  label,
  model,
  effort,
  cases: results.length,
  success: results.filter((r) => r.ok).length,
  avgScore: Math.round(avg(scored.map((r) => r.score!)) * 10) / 10,
  cleanQa: results.filter((r) => r.ok && r.qaIssues === 0).length,
  refreshOk: results.filter((r) => r.refreshOk).length,
  avgSeconds: Math.round(avg(results.map((r) => r.seconds))),
  totalUsd: Math.round(results.reduce((s, r) => s + r.usd, 0) * 1000) / 1000,
  toolErrors: results.reduce((s, r) => s + r.toolErrors, 0),
  loopChecks: `${results.filter((r) => r.loopFails && !r.loopFails.length).length}/${results.filter((r) => r.loopFails).length} passed`,
  exactValues: `${results.flatMap((r) => r.truth ?? []).filter((t) => t.found).length}/${results.flatMap((r) => r.truth ?? []).length}`,
};
writeFileSync(join(outDir, "report.json"), JSON.stringify({ summary, results }, null, 2));
const md = [
  `# Dashie eval: ${label}`,
  "",
  `Exact values found: ${summary.exactValues}. Model ${model} (${effort}). ${summary.success}/${summary.cases} built, ${summary.cleanQa} passed QA, ${summary.refreshOk} refreshed without AI. Avg judge score ${summary.avgScore}/10. Avg ${summary.avgSeconds}s. Total $${summary.totalUsd}.`,
  "",
  `Loop checks (questions, pages, surgical edits): ${summary.loopChecks}.`,
  "",
  "| Case | Built | Score | Cov | Clar | Design | Trust | QA issues | Refresh | Edit | Kept | Refetch | Pages | Asked | Time | Cost | Tool errors |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.id} | ${r.ok ? "yes" : "NO"} | ${r.score ?? "-"} | ${r.judge?.coverage ?? "-"} | ${r.judge?.clarity ?? "-"} | ${r.judge?.design ?? "-"} | ${r.judge?.trust ?? "-"} | ${r.qaIssues} | ${r.refreshOk ? "yes" : "no"} | ${r.editOk == null ? "-" : r.editOk ? "yes" : "no"} | ${r.preserved == null ? "-" : Math.round(r.preserved * 100) + "%"} | ${r.editRefetches ?? "-"} | ${r.pages ?? "-"} | ${r.asked ?? 0} | ${r.seconds.toFixed(0)}s | $${r.usd.toFixed(3)} | ${r.toolErrors} |`
  ),
  "",
  ...results.flatMap((r) => [`### ${r.id}`, r.error ? `Error: ${r.error}` : "", ...(r.loopFails ?? []).map((f) => `- LOOP FAIL: ${f}`), r.askAnswer ? `- answer (${r.askTools} tools): ${r.askAnswer.slice(0, 300)}` : "", ...(r.questions ?? []).map((q) => `- asked: ${q}`), ...(r.truth ?? []).map((t) => `- truth ${t.found ? "✓" : "✗"} ${t.label}: expected ${t.expected}`), r.judge ? `Judge: ${r.judge.top_issue} Missing: ${r.judge.missing.join(", ") || "none"}` : "", ...r.qaDetail.map((q) => `- ${q}`), ""]),
].join("\n");
writeFileSync(join(outDir, "report.md"), md);
console.log("\n" + md.split("\n").slice(0, 12).join("\n"));
