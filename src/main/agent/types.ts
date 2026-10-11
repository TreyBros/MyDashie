import type { AgentEvent, DatasetPreview } from "@shared/types";
import type { DatasetStore } from "./datasets";
import type { DashboardRepo } from "../dashboards/repo";

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  /** What the model sees. Keep it short; big data goes into datasets. */
  content: string;
  /** Optional image the model should see (PNG base64, no data: prefix). */
  image?: string;
  /** Extra images (e.g. one per dashboard page). */
  images?: string[];
  preview?: DatasetPreview;
  /** Human-friendly one-liner for the activity feed. */
  summary?: string;
  ok?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Results of data tools are stored as datasets and recorded for refresh recipes. */
  producesData?: boolean;
  /** Short label for the activity feed, e.g. "Querying data". */
  label?: (args: Record<string, unknown>) => string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  dashboardId: string;
  mode?: "build" | "edit" | "heal" | "ask";
  datasets: DatasetStore;
  repo: DashboardRepo;
  emit(ev: AgentEvent): void;
  runId: string;
  signal: AbortSignal;
  /** Injected Electron capability. Absent in headless smoke runs. */
  preview?: PreviewRenderer;
  homeDir: string;
  /** Result of the most recent preview in this run (used by the verification gate). */
  lastQa?: { ok: boolean; issues: number };
  /** True when HTML changed after the last preview. */
  htmlChangedSincePreview?: boolean;
  /** Ask the user and wait for answers. Absent in headless runs (the tool then proceeds on judgment). */
  askUser?: (q: { intro?: string; questions: import("@shared/types").AgentQuestion[] }) => Promise<import("@shared/types").AgentAnswers>;
  /** Number of question rounds asked in this run. */
  questionRounds?: number;
  /** Call a tool on a connected MCP server (Composio is "composio"). Absent when no servers are connected. */
  callMcp?: (serverId: string, name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
  /** Latest plan from update_plan. */
  plan?: { step: string; status: "pending" | "in_progress" | "done" }[];
}

export interface PreviewRenderer {
  render(dashboardId: string): Promise<{ png: Buffer; errors: string[]; title: string; qa?: import("./qa").QaReport; pages?: { id: string; title: string; png: Buffer; qa?: import("./qa").QaReport }[] }>;
}
