import type { DashboardRepo } from "./dashboards/repo";
import type { SettingsStore } from "./store/settings";
import type { SecretsStore } from "./store/secrets";
import type { McpServerStore } from "./store/mcpServers";
import type { ComposioConnector } from "./connectors/composio";
import type { Scheduler } from "./scheduler";
import type { AgentHarness } from "./agent/harness";
import type { UsageLedger } from "./store/usage";
import type { CloudClient } from "./cloud/client";
import type { Updater } from "./updater";

export interface LocalSource {
  id: string;
  name: string;
  kind: "file" | "app";
  path?: string;
  hint: string;
  available: boolean;
}

export interface AppContext {
  repo: DashboardRepo;
  settings: SettingsStore;
  secrets: SecretsStore;
  mcpStore: McpServerStore;
  composio: ComposioConnector;
  scheduler: Scheduler;
  harness: AgentHarness;
  usage: UsageLedger;
  cloud: CloudClient;
  updater: Updater;
  libsDir: string;
  brandDir: string;
  localSources: () => LocalSource[];
}
