// Headless connector probe: one read-only call per connected app through the same session the agent uses.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Paths } from "../src/main/store/paths";
import { SettingsStore } from "../src/main/store/settings";
import { SecretsStore, plainCipher } from "../src/main/store/secrets";
import { ComposioConnector } from "../src/main/connectors/composio";
import { McpConnections } from "../src/main/connectors/mcp";

const root = resolve(import.meta.dirname, "..");
const env = Object.fromEntries(readFileSync(join(root, ".env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const userData = process.env.PROBE_USER_DATA ?? join(process.env.HOME!, "Library/Application Support/MyDashie");
const paths = new Paths(userData);
const settings = new SettingsStore(paths);
const secrets = new SecretsStore(paths, plainCipher, { composio: env.COMPOSIO_API_KEY });
const composio = new ComposioConnector(() => secrets.get("composio"), settings.get().installId);

const PROBES: Record<string, { slug: string; args: Record<string, unknown> }> = {
  gmail: { slug: "GMAIL_FETCH_EMAILS", args: { max_results: 3, query: "newer_than:7d" } },
  github: { slug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER", args: { per_page: 3 } },
  googledrive: { slug: "GOOGLEDRIVE_LIST_FILES", args: { page_size: 3 } },
  jira: { slug: "JIRA_SEARCH_FOR_ISSUES_USING_JQL_GET", args: { jql: "updated >= -30d order by updated desc", max_results: 3 } },
  linkedin: { slug: "LINKEDIN_GET_MY_INFO", args: {} },
  google_analytics: { slug: "GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES", args: {} },
};

const mcp = new McpConnections();
const t0 = Date.now();
const server = await composio.asMcpServer();
const tools = await mcp.connect(server);
console.log(`session up in ${Date.now() - t0}ms; ${tools.length} meta tools: ${tools.map((t) => t.name).join(", ")}`);
const conns = await mcp.call("composio", "COMPOSIO_MANAGE_CONNECTIONS", { toolkits: Object.keys(PROBES) });
const cj = JSON.parse(conns.text) as { data?: { results?: Record<string, { status: string; has_active_connection: boolean; instruction?: string }> } };
for (const [k, v] of Object.entries(cj.data?.results ?? {})) console.log(`  ${k.padEnd(16)} ${v.status} active=${v.has_active_connection} ${(v.instruction ?? "").slice(0, 120)}`);
for (const [tk, p] of Object.entries(PROBES)) {
  const t1 = Date.now();
  try {
    const r = await mcp.call("composio", "COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: p.slug, arguments: p.args }], sync_response_to_workbench: false });
    const txt = r.text;
    let ok = !r.isError && /"successful"\s*:\s*true/.test(txt);
    const err = txt.match(/"error"\s*:\s*"([^"]{0,160})/)?.[1];
    console.log(`${ok ? "✓" : "✗"} ${tk.padEnd(16)} ${p.slug} ${Date.now() - t1}ms ${ok ? "" : "error: " + (err ?? txt.slice(0, 200).replace(/\s+/g, " "))}`);
    if (!ok && /not found/i.test(err ?? "")) {
      const s = await mcp.call("composio", "COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: "list accounts or properties", toolkits: [tk] }] });
      const slugs = [...new Set([...s.text.matchAll(/"tool_slug"\s*:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1] ?? ""))].filter(Boolean);
      console.log("   search found:", slugs.slice(0, 8).join(", "));
      const pick = slugs.find((x) => /ACCOUNT|PROPERT|LIST/.test(x)) ?? slugs[0] ?? "";
      if (pick) {
        const r2 = await mcp.call("composio", "COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: pick, arguments: {} }], sync_response_to_workbench: false });
        console.log(`   ${pick} -> ${/"successful"\s*:\s*true/.test(r2.text) ? "✓ ok" : r2.text.slice(0, 300).replace(/\s+/g, " ")}`);
      }
    }
  } catch (e) {
    console.log(`✗ ${tk} threw: ${(e as Error).message.slice(0, 200)}`);
  }
}
await mcp.close();
