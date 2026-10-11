// Headless end-to-end run of the agent harness with real keys from .env (no Electron).
// Usage: npm run smoke -- "prompt"   (default prompt uses a public API so no app connections are needed)
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { Paths } from "../src/main/store/paths";
import { SettingsStore } from "../src/main/store/settings";
import { SecretsStore, plainCipher } from "../src/main/store/secrets";
import { DashboardRepo } from "../src/main/dashboards/repo";
import { AgentHarness } from "../src/main/agent/harness";
import { ComposioConnector } from "../src/main/connectors/composio";
import { refreshDashboard } from "../src/main/scheduler/refresh";
import { exportStandalone } from "../src/main/dashboards/export";
import type { McpServerConfig } from "../src/shared/types";

const root = resolve(import.meta.dirname, "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const prompt =
  process.argv[2] ??
  "Build a dashboard of recent earthquakes worldwide from the USGS public feed https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson : count by day, magnitude distribution, and the 10 strongest with location. Keep it to one screen.";

const dir = mkdtempSync(join(tmpdir(), "dash-smoke-"));
const paths = new Paths(dir);
const settings = new SettingsStore(paths);
const secrets = new SecretsStore(paths, plainCipher, { openai: env.OPENAI_API_KEY, composio: env.COMPOSIO_API_KEY });
const repo = new DashboardRepo(paths);
const composio = new ComposioConnector(() => secrets.get("composio"), process.env.SMOKE_INSTALL_ID ?? settings.get().installId);
const useComposio = process.env.SMOKE_COMPOSIO === "1";

const mcpServers = async (): Promise<McpServerConfig[]> => {
  if (!useComposio) return [];
  try {
    return [await composio.asMcpServer()];
  } catch (e) {
    console.log("composio unavailable:", (e as Error).message);
    return [];
  }
};

const harness = new AgentHarness({ repo, openaiKey: () => secrets.get("openai"), mcpServers, homeDir: homedir(), log: (m) => console.log("  [log]", m) });

const d = repo.create({ name: "Smoke test", prompt });
console.log(`dashboard ${d.id} in ${dir}`);
const t0 = Date.now();
const result = await harness.run({
  dashboardId: d.id,
  mode: "build",
  userMessage: prompt,
  model: { model: process.env.SMOKE_MODEL ?? settings.get().buildModel.model, effort: "low" },
  onEvent: (e) => {
    if (e.type === "tool.start") console.log(`→ ${e.label}`);
    else if (e.type === "tool.end") console.log(`  ${e.ok ? "✓" : "✗"} ${e.summary.slice(0, 100)}`);
    else if (e.type === "text.done") console.log(`💬 ${e.text.slice(0, 300)}`);
    else if (e.type === "status") console.log(`· ${e.message}`);
    else if (e.type === "run.done") console.log(`run done ok=${e.ok} ${e.error ?? ""} usage=${JSON.stringify(e.usage)}`);
  },
});
await result.datasets.close();
console.log(`build took ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const m = repo.get(d.id)!;
console.log("manifest:", { status: m.status, hasHtml: m.hasHtml, datasets: m.datasets, name: m.name, emoji: m.emoji });
const recipe = repo.getRecipe(d.id);
console.log("recipe steps:", recipe?.steps.map((s) => `${s.output} <- ${s.source.kind === "tool" ? s.source.tool : s.source.kind}`));

if (!m.hasHtml || !recipe) {
  console.error("SMOKE FAILED: no html or recipe");
  process.exit(1);
}

// Replay the recipe with no model, like the scheduler would.
console.log("\n--- replaying recipe (deterministic refresh) ---");
const before = repo.getData(d.id)!.fetchedAt;
const out = await refreshDashboard({ repo, mcpServers, harness, refreshModel: () => settings.get().refreshModel, homeDir: homedir(), log: console.log }, d.id);
const after = repo.getData(d.id)!.fetchedAt;
console.log("refresh:", out, "data changed:", before !== after);

const html = exportStandalone(repo, join(root, "resources/libs"), d.id);
const outFile = join(root, "assets/generated", "smoke-dashboard.html");
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync(join(root, "assets/generated"), { recursive: true });
writeFileSync(outFile, html);
console.log(`standalone export: ${outFile} (${(html.length / 1024).toFixed(0)} KB), inlined libs: ${!/dash-libs\//.test(html)}, has DASH data: ${/window\.DASH\s*=/.test(html)}`);
console.log(existsSync(outFile) ? "SMOKE OK" : "SMOKE FAILED");
