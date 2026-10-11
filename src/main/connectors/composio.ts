import { Composio } from "@composio/core";
import type { ConnectionInfo, McpServerConfig } from "@shared/types";

/**
 * Composio Platform integration. One session per install (the installId is the
 * Composio user id). The session's MCP endpoint is what the agent talks to.
 */
export class ComposioConnector {
  private client: Composio | null = null;
  private sessionId: string | null = null;

  constructor(private getApiKey: () => string | undefined, private userId: string) {}

  available() {
    return !!this.getApiKey();
  }

  private composio() {
    const key = this.getApiKey();
    if (!key) throw new Error("App connections aren't available right now.");
    if (!this.client) this.client = new Composio({ apiKey: key });
    return this.client;
  }

  invalidate() {
    this.client = null;
    this.sessionId = null;
  }

  /** Creates (once) and returns the session, with MCP credentials attached. */
  async session() {
    const c = this.composio();
    if (this.sessionId) {
      try {
        return await c.sessions.use(this.sessionId, { mcp: true });
      } catch {
        this.sessionId = null;
      }
    }
    const s = await c.sessions.create(
      this.userId,
      {
        mcp: true,
        manageConnections: { enable: true },
        sandbox: { enable: false },
        // Dashboards only read. The session refuses to run any tool not tagged read-only
        // (creating, sending, updating and deleting are all blocked server side).
        tags: { enable: ["readOnlyHint"] },
      } as Parameters<typeof c.sessions.create>[1] & { mcp: true }
    );
    this.sessionId = s.sessionId;
    return s;
  }

  /** The session as an MCP server config the agent's MCP layer can connect to. */
  async asMcpServer(): Promise<McpServerConfig> {
    const s = await this.session();
    return {
      id: "composio",
      name: "Connected apps",
      enabled: true,
      transport: { type: "http", url: s.mcp.url, headers: s.mcp.headers as Record<string, string> },
    };
  }

  async listToolkits(opts: { connectedOnly?: boolean; search?: string } = {}): Promise<ConnectionInfo[]> {
    const s = await this.session();
    const page = await s.toolkits({ isConnected: opts.connectedOnly ? true : undefined, limit: 50 } as never);
    const items = (page as { items?: ToolkitState[] }).items ?? (page as unknown as ToolkitState[]);
    const list = (Array.isArray(items) ? items : []).map(toConnectionInfo);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      return list.filter((t) => t.name.toLowerCase().includes(q) || t.toolkit.includes(q));
    }
    return list;
  }

  /** Search the global toolkit catalog (not just enabled ones). */
  async searchToolkits(query: string): Promise<ConnectionInfo[]> {
    const key = this.getApiKey();
    if (!key) return [];
    const r = await fetch(`https://backend.composio.dev/api/v3/toolkits?search=${encodeURIComponent(query)}&limit=24`, { headers: { "x-api-key": key } });
    if (!r.ok) throw new Error(`App search failed (${r.status})`);
    const d = (await r.json()) as { items?: { slug: string; name: string; meta?: { logo?: string } }[] };
    const connected = new Set((await this.listToolkits({ connectedOnly: true }).catch(() => [])).map((c) => c.toolkit));
    return (d.items ?? []).map((t) => ({ toolkit: t.slug, name: t.name, logo: t.meta?.logo, connected: connected.has(t.slug) }));
  }

  /** Returns a Connect Link the user opens in their browser. */
  async connectLink(toolkit: string): Promise<{ url: string; wait: () => Promise<void> }> {
    const s = await this.session();
    const req = await s.authorize(toolkit);
    return {
      url: req.redirectUrl ?? "",
      wait: async () => {
        await req.waitForConnection();
      },
    };
  }

  async disconnect(connectedAccountId: string) {
    const c = this.composio();
    await c.connectedAccounts.delete(connectedAccountId);
  }
}

interface ToolkitState {
  slug: string;
  name: string;
  logo?: string;
  connection?: { isActive: boolean; connectedAccount?: { id: string; status: string } };
}

function toConnectionInfo(t: ToolkitState): ConnectionInfo {
  return {
    toolkit: t.slug,
    name: t.name,
    logo: t.logo,
    connected: !!t.connection?.isActive,
    connectedAccountId: t.connection?.connectedAccount?.id,
  };
}
