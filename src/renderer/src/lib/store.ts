import { create } from "zustand";
import type { AccountStatus, AgentEvent, DashboardManifest, SecretsStatus, Settings } from "@shared/types";

export type Route = { name: "home" } | { name: "new" } | { name: "dashboard"; id: string; openChat?: boolean } | { name: "settings"; tab?: SettingsTab };
export type SettingsTab = "account" | "ai" | "apps" | "mcp" | "general";

export interface ActivityItem {
  id: string;
  kind: "text" | "tool" | "status" | "link" | "done";
  text: string;
  label?: string;
  ok?: boolean;
  running?: boolean;
  url?: string;
  tool?: string;
  startedAt?: number;
  screenshot?: string;
  preview?: AgentEvent extends { preview?: infer P } ? P : never;
  at: number;
}

interface RunState {
  running: boolean;
  startedAt: number;
  items: ActivityItem[];
  streaming: string;
  error?: string;
  plan?: { step: string; status: "pending" | "in_progress" | "done" }[];
  /** How Dashie routed the message (question vs change) and the power level it chose. */
  intent?: "ask" | "change";
  level?: "quick" | "smart" | "max";
  question?: { requestId: string; intro?: string; questions: { id: string; question: string; options: string[]; multi?: boolean }[] };
}

interface State {
  route: Route;
  dashboards: DashboardManifest[];
  settings: Settings | null;
  secrets: SecretsStatus;
  /** Cloud account (null until loaded). */
  account: AccountStatus | null;
  runs: Record<string, RunState>;
  theme: "light" | "dark";
  aboutOpen: boolean;
  setAbout(open: boolean): void;
  navigate(r: Route): void;
  refreshDashboards(): Promise<void>;
  loadSettings(): Promise<void>;
  loadAccount(): Promise<void>;
  applyEvent(dashboardId: string, e: AgentEvent): void;
  startRun(dashboardId: string): void;
  clearRun(dashboardId: string): void;
}

const emptyRun = (): RunState => ({ running: false, startedAt: Date.now(), items: [], streaming: "" });

let seq = 0;
const nid = () => `${Date.now().toString(36)}_${++seq}`;

export const useStore = create<State>((set, get) => ({
  route: { name: "home" },
  dashboards: [],
  settings: null,
  secrets: { openai: false, composio: false },
  account: null,
  runs: {},
  theme: "light",
  aboutOpen: false,
  setAbout: (aboutOpen) => set({ aboutOpen }),
  navigate: (route) => set({ route }),
  refreshDashboards: async () => set({ dashboards: await window.dash.dashboards.list() }),
  loadSettings: async () => {
    const [settings, secrets] = await Promise.all([window.dash.settings.get(), window.dash.secrets.status()]);
    set({ settings, secrets });
  },
  loadAccount: async () => {
    try {
      set({ account: await window.dash.account.status() });
    } catch {
      set({ account: { configured: false, signedIn: false, pending: 0, webUrl: "" } });
    }
  },
  startRun: (id) => set((s) => ({ runs: { ...s.runs, [id]: { ...emptyRun(), running: true } } })),
  clearRun: (id) => set((s) => ({ runs: { ...s.runs, [id]: emptyRun() } })),
  applyEvent: (id, e) => {
    const runs = { ...get().runs };
    const r: RunState = { ...(runs[id] ?? emptyRun()) };
    r.items = [...r.items];
    switch (e.type) {
      case "status":
        r.running = true;
        r.items.push({ id: nid(), kind: "status", text: e.message, at: Date.now() });
        break;
      case "text.delta":
        r.streaming += e.delta;
        break;
      case "text.reset":
        r.streaming = "";
        break;
      case "text.done":
        r.streaming = "";
        r.items.push({ id: nid(), kind: "text", text: e.text, at: Date.now() });
        break;
      case "tool.start":
        r.items.push({ id: e.callId, kind: "tool", tool: e.name, text: "", label: e.label, running: true, startedAt: Date.now(), at: Date.now() });
        break;
      case "tool.end": {
        const i = r.items.findIndex((x) => x.id === e.callId);
        const item: ActivityItem = { id: e.callId, kind: "tool", tool: e.name, startedAt: r.items[i]?.startedAt, text: e.summary, label: r.items[i]?.label ?? e.name, ok: e.ok, running: false, screenshot: e.screenshot, preview: e.preview as never, at: Date.now() };
        if (i >= 0) r.items[i] = item;
        else r.items.push(item);
        break;
      }
      case "connect.link":
        // One card per app per run.
        if (r.items.some((x) => x.kind === "link" && (x.url === e.url || x.text === (e.toolkit ? `Connect ${e.toolkit}` : "Connect your account")))) break;
        r.items.push({ id: nid(), kind: "link", text: e.toolkit ? `Connect ${e.toolkit}` : "Connect your account", url: e.url, at: Date.now() });
        break;
      case "run.done":
        r.running = false;
        r.streaming = "";
        r.error = e.error;
        r.items.push({ id: nid(), kind: "done", text: e.ok ? "Done" : e.error ?? "Something went wrong", ok: e.ok, at: Date.now() });
        break;
      case "plan":
        r.plan = e.steps;
        break;
      case "intent":
        r.intent = e.intent;
        r.level = e.level;
        break;
      case "question":
        r.question = { requestId: e.requestId, intro: e.intro, questions: e.questions };
        break;
      case "question.answered":
        r.question = undefined;
        r.items.push({ id: nid(), kind: "text", text: `You chose: ${e.summary}`, at: Date.now() });
        break;
      case "dashboard.updated":
        break;
    }
    // Collapse consecutive status lines so the feed stays short.
    r.items = r.items.filter((it, idx, arr) => !(it.kind === "status" && arr[idx + 1]?.kind === "status"));
    runs[id] = r;
    set({ runs });
  },
}));

export function relativeTime(iso?: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** IPC errors arrive as "Error invoking remote method 'x': Error: message"; users should only see the message. */
export function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']*':\s*/i, "").replace(/^Error:\s*/i, "");
}
