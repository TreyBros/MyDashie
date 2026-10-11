import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig, McpTransport } from "@shared/types";

export interface McpToolInfo {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const WRITE_WORDS = new Set("create update delete remove send insert upsert patch put write edit modify rename move copy upload archive trash merge close reopen cancel approve reject assign unassign invite share publish reply forward add set enable disable start stop restart kill drop truncate post comment schedule book transfer pay refund charge submit mark star label".split(" "));

const READ_WORDS = new Set("get list search fetch read find query describe show view count lookup retrieve browse inspect check".split(" "));

/** A tool is allowed when it says it is read-only, blocked when it says it writes, and otherwise judged by its name. */
export function isReadOnlyTool(t: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }): boolean {
  const a = t.annotations;
  if (a?.readOnlyHint === true) return true;
  if (a?.readOnlyHint === false || a?.destructiveHint === true) return false;
  const words = t.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (READ_WORDS.has(words[0] ?? "")) return true; // getPost, list_shared, search_and_add_filters…
  return !words.some((w) => WRITE_WORDS.has(w));
}

/** Holds live MCP client connections for one agent run. */
export class McpConnections {
  private clients = new Map<string, Client>();
  private tools: McpToolInfo[] = [];

  async connect(server: McpServerConfig, timeoutMs = 20000): Promise<McpToolInfo[]> {
    const client = new Client({ name: "mydashie", version: "0.1.0" });
    const transport = makeTransport(server.transport);
    await withTimeout(client.connect(transport), timeoutMs, `MCP server "${server.name}" did not respond`);
    this.clients.set(server.id, client);
    const { tools } = await withTimeout(client.listTools(), timeoutMs, `MCP server "${server.name}" tool list timed out`);
    // Dashboards only read: user servers keep only tools that are (or look) read-only.
    const visible = server.id === "composio" ? tools : tools.filter((t) => isReadOnlyTool(t));
    const infos = visible.map((t) => ({
      serverId: server.id,
      serverName: server.name,
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));
    this.tools.push(...infos);
    return infos;
  }

  allTools() {
    return this.tools;
  }

  async call(serverId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP server ${serverId} is not connected`);
    const res = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120000 });
    const content = (res.content as { type: string; text?: string }[] | undefined) ?? [];
    const text = content.map((c) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`)).join("\n");
    const structured = (res as { structuredContent?: unknown }).structuredContent;
    return { text: text || (structured ? JSON.stringify(structured) : ""), isError: !!res.isError };
  }

  async close() {
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
    this.tools = [];
  }
}

function makeTransport(t: McpTransport) {
  if (t.type === "http") {
    return new StreamableHTTPClientTransport(new URL(t.url), { requestInit: { headers: t.headers ?? {} } });
  }
  return new StdioClientTransport({
    command: t.command,
    args: t.args,
    env: { ...filteredEnv(), ...(t.env ?? {}) },
    stderr: "ignore",
  });
}

function filteredEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "USER", "SHELL", "LANG", "TMPDIR"]) if (process.env[k]) out[k] = process.env[k]!;
  // Give stdio servers the usual tool paths even when launched from a GUI app.
  out.PATH = [out.PATH, "/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME}/.local/bin`].filter(Boolean).join(":");
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(msg)), ms);
    p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e)));
  });
}

/** Quick connectivity check used by Settings. */
export async function testMcpServer(server: McpServerConfig): Promise<{ ok: boolean; tools: string[]; error?: string }> {
  const conns = new McpConnections();
  try {
    const tools = await conns.connect(server, 15000);
    return { ok: true, tools: tools.map((t) => t.name) };
  } catch (e) {
    return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    await conns.close();
  }
}
