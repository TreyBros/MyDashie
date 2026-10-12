// Replays a dashboard's refresh recipe from any data directory and prints the outcome.
// Usage: npx tsx --tsconfig tsconfig.node.json scripts/replay-refresh.ts <userData dir> [dashboard id]
import { homedir } from "node:os";
import { Paths } from "../src/main/store/paths";
import { DashboardRepo } from "../src/main/dashboards/repo";
import { refreshDashboard } from "../src/main/scheduler/refresh";
import type { AgentHarness } from "../src/main/agent/harness";

const [dir, only] = process.argv.slice(2);
if (!dir) throw new Error("userData dir required");
const repo = new DashboardRepo(new Paths(dir));
const harness = { run: async () => ({ ok: false, text: "", error: "heal disabled in replay", usage: { input: 0, output: 0 }, toolCalls: 0, previews: 0, datasets: undefined as never }) } as unknown as AgentHarness;
for (const m of repo.list()) {
  if (only && m.id !== only && m.name !== only) continue;
  const t0 = Date.now();
  const out = await refreshDashboard({ repo, mcpServers: async () => [], harness, refreshModel: () => ({ model: "gpt-6-luna", effort: "low" }), homeDir: homedir(), log: (l) => console.log("   ", l) }, m.id);
  console.log(`${out.ok ? "✓" : "✗"} ${m.name} (${m.id}) ${Date.now() - t0}ms calls=${out.toolCalls} ${out.error ?? ""}`);
}
