import type {
  AccountStatus,
  UpdateStatus,
  AgentEvent,
  ChatMessage,
  ConnectionInfo,
  DashboardManifest,
  McpServerConfig,
  ModelInfo,
  RefreshLogEntry,
  RunRequest,
  Schedule,
  SecretsStatus,
  Settings,
} from "../shared/types";
import type { UsageSummary } from "../shared/pricing";

export interface DashApi {
  dashboards: {
    list(): Promise<DashboardManifest[]>;
    get(id: string): Promise<DashboardManifest | null>;
    create(input: { name: string; prompt: string }): Promise<DashboardManifest>;
    update(input: { id: string; patch: Partial<Pick<DashboardManifest, "name" | "emoji" | "description">> & { schedule?: Schedule } }): Promise<DashboardManifest>;
    delete(id: string): Promise<void>;
    chat(id: string): Promise<ChatMessage[]>;
    data(id: string): Promise<{ fetchedAt: string; datasets: Record<string, unknown> } | null>;
    html(id: string): Promise<string | null>;
    export(id: string): Promise<string | null>;
    openInBrowser(id: string): Promise<string>;
    refresh(id: string): Promise<boolean>;
    refreshLog(id: string): Promise<RefreshLogEntry[]>;
    reveal(id: string): Promise<void>;
    versions(id: string): Promise<{ id: string; at: string; label: string }[]>;
    restore(input: { id: string; version: string }): Promise<DashboardManifest>;
    onChanged(cb: () => void): () => void;
  };
  agent: {
    run(req: RunRequest): Promise<boolean>;
    cancel(id: string): Promise<boolean>;
    answer(input: { requestId: string; answers: Record<string, string[]> }): Promise<boolean>;
    onEvent(cb: (payload: { dashboardId: string; event: AgentEvent }) => void): () => void;
  };
  settings: { get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Settings> };
  secrets: {
    status(): Promise<SecretsStatus>;
    set(input: { key: "openai" | "composio"; value: string }): Promise<SecretsStatus>;
    clear(key: "openai" | "composio"): Promise<SecretsStatus>;
  };
  models: { list(): Promise<ModelInfo[]> };
  connections: {
    list(): Promise<ConnectionInfo[]>;
    search(q: string): Promise<ConnectionInfo[]>;
    connect(toolkit: string): Promise<string>;
    disconnect(accountId: string): Promise<void>;
  };
  mcp: {
    list(): Promise<McpServerConfig[]>;
    add(cfg: Omit<McpServerConfig, "id">): Promise<McpServerConfig>;
    update(cfg: McpServerConfig): Promise<McpServerConfig | undefined>;
    remove(id: string): Promise<void>;
    test(cfg: McpServerConfig): Promise<{ ok: boolean; tools: string[]; error?: string }>;
  };
  local: { sources(): Promise<{ id: string; name: string; kind: "file" | "app"; path?: string; hint: string; available: boolean }[]> };
  usage: { summary(arg: { since?: string } | null): Promise<UsageSummary>; export(): Promise<string | null> };
  account: {
    status(): Promise<AccountStatus>;
    signIn(): Promise<string>;
    signOut(): Promise<void>;
    magicLink(input: { email: string }): Promise<boolean>;
    verifyCode(input: { email: string; code: string }): Promise<boolean>;
    cancelLogin(): Promise<void>;
    checkout(input: { kind: "plan" | "pack"; id: string }): Promise<string>;
    portal(): Promise<string>;
    onChanged(cb: () => void): () => void;
  };
  app: {
    version(): Promise<string>;
    updateStatus(): Promise<UpdateStatus>;
    checkForUpdates(): Promise<UpdateStatus>;
    installUpdate(): Promise<void>;
    onUpdate(cb: (s: UpdateStatus) => void): () => void;
    openExternal(url: string): Promise<void>;
    pickFile(): Promise<string | null>;
    onNavigate(cb: (payload: { to: string; id?: string }) => void): () => void;
    platform: string;
  };
}

declare global {
  interface Window {
    dash: DashApi;
  }
}
