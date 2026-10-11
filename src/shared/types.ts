// Shared types between main and renderer. No runtime imports from either side.

export type ScheduleKind = "off" | "interval" | "cron";

import type { ScheduleSpec } from "./schedule";

export interface Schedule {
  kind: ScheduleKind;
  /** The friendly settings the user picked (compiled into `cron`). */
  spec?: ScheduleSpec;
  /** For kind=interval: minutes between runs. */
  everyMinutes?: number;
  /** For kind=cron: 5-field cron expression in local time. */
  cron?: string;
  /** ISO timestamp of the next planned run, computed by the scheduler. */
  nextRunAt?: string;
  lastRunAt?: string;
  /** Keep the settings but stop running. */
  paused?: boolean;
}

export type DashboardStatus =
  | "draft" // created, no HTML yet
  | "building" // build agent running
  | "ready" // has HTML and data
  | "refreshing" // scheduled refresh in progress
  | "stale" // refresh failed, showing last-good data
  | "error"; // never got a working build

export interface DashboardManifest {
  id: string;
  name: string;
  /** True once the user has named the dashboard themselves; the agent then keeps that name. */
  nameLocked?: boolean;
  /** The name the agent gave it, kept so the page title can follow the user's rename. */
  aiName?: string;
  /** Topic icon key (see shared/topics). Legacy dashboards may only have emoji. */
  icon?: string;
  emoji: string;
  description: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: DashboardStatus;
  schedule: Schedule;
  /** When the current data snapshot was produced. */
  dataFetchedAt?: string;
  /** Set when a refresh failed; data shown is from dataFetchedAt. */
  staleSince?: string;
  lastError?: string;
  /** Names of datasets the HTML reads from window.DASH.data */
  datasets: string[];
  hasHtml: boolean;
  /** Bumped every time index.html changes; the viewer swaps frames on this, not on updatedAt. */
  htmlVersion?: number;
  thumbnailVersion?: number;
  /** Decisions the user made when Dashie asked (kept for future edits). */
  brief?: string[];
  /** Credits this dashboard has used across builds, edits and refreshes. */
  spend?: { credits: number; runs: number };
}

export interface DashboardSummary extends DashboardManifest {}

export interface DatasetPreview {
  name: string;
  rowCount: number | null;
  columns: { name: string; type: string }[];
  sample: unknown[];
  source: string;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelChoice {
  model: string;
  effort: ReasoningEffort;
}

export interface Settings {
  buildModel: ModelChoice;
  refreshModel: ModelChoice;
  theme: "system" | "light" | "dark";
  launchAtLogin: boolean;
  notifications: boolean;
  /** Power level users pick instead of a model (auto | quick | smart | max). */
  power?: "auto" | "quick" | "smart" | "max";
  /** Stable id used as the Composio user id for this install. */
  installId: string;
  onboarded: boolean;
  /** Shows the pricing lab (real costs behind credits). Toggled by clicking the version line five times. */
  developer?: boolean;
}

export interface SecretsStatus {
  openai: boolean;
  composio: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  recommendedFor?: "build" | "refresh";
  tier: "flagship" | "balanced" | "efficient" | "other";
}

export type McpTransport =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
}

export interface ConnectionInfo {
  toolkit: string;
  name: string;
  logo?: string;
  connected: boolean;
  connectedAccountId?: string;
}

/** Streamed from the agent harness to the renderer. */
export type AgentEvent =
  | { type: "status"; runId: string; message: string }
  | { type: "text.delta"; runId: string; delta: string }
  | { type: "text.reset"; runId: string }
  | { type: "text.done"; runId: string; text: string }
  | { type: "tool.start"; runId: string; callId: string; name: string; args: unknown; label: string }
  | { type: "tool.end"; runId: string; callId: string; name: string; ok: boolean; summary: string; preview?: DatasetPreview; screenshot?: string }
  | { type: "connect.link"; runId: string; toolkit: string; url: string }
  | { type: "plan"; runId: string; steps: { step: string; status: "pending" | "in_progress" | "done" }[] }
  | { type: "suggestions"; runId: string; suggestions: string[] }
  | { type: "question"; runId: string; requestId: string; intro?: string; questions: AgentQuestion[] }
  | { type: "question.answered"; runId: string; requestId: string; summary: string }
  | { type: "dashboard.updated"; runId: string; dashboardId: string; what: "html" | "data" | "manifest" }
  | { type: "intent"; runId: string; intent: "ask" | "change"; level: "quick" | "smart" | "max" }
  | { type: "run.done"; runId: string; ok: boolean; error?: string; usage?: { input: number; output: number; cached?: number; reasoning?: number } };

export type Stage = "plan" | "gather" | "shape" | "design" | "check";

export interface ActivityStep {
  id: string;
  kind: "tool" | "note";
  tool?: string;
  label: string;
  summary?: string;
  ok?: boolean;
  stage: Stage;
  startedAt: number;
  endedAt?: number;
}

export interface RunActivity {
  steps: ActivityStep[];
  startedAt: number;
  endedAt: number;
  ok: boolean;
  mode: "build" | "edit" | "heal" | "ask";
  /** Power level the run used. */
  level?: "quick" | "smart" | "max";
  /** Set when the run paused for the user to connect an app. */
  needsConnection?: boolean;
  /** Dashie's final plan for this run. */
  plan?: PlanStep[];
  /** Follow-up ideas offered at the end of the run. */
  suggestions?: string[];
  /** Version saved before this run changed anything (for undo). */
  versionBefore?: string;
  /** Credits this run used. */
  credits?: number;
}

export interface PlanStep {
  step: string;
  status: "pending" | "in_progress" | "done";
}

export interface AgentQuestion {
  id: string;
  question: string;
  options: string[];
  multi?: boolean;
}

/** id -> chosen option(s) or free text */
export type AgentAnswers = Record<string, string[]>;

/** A card the user picked on the dashboard before typing. */
export interface CardSelection {
  id: string;
  title: string;
  kind: string;
  page?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  /** The card this message was about (shown as a chip, never as text). */
  selection?: CardSelection;
  /** How the message was routed: a question or a change. */
  intent?: "ask" | "change";
  /** The work Dashie did for this reply (collapsed in the UI). */
  activity?: RunActivity;
}

export interface RunRequest {
  dashboardId: string;
  message: string;
  mode: "build" | "edit";
  selection?: CardSelection;
  /** Force the route instead of letting Dashie decide. */
  intent?: "ask" | "change";
  power?: "auto" | "quick" | "smart" | "max";
  /** Re-running a misrouted message: refund the previous run's credits. */
  refundLast?: boolean;
}

/** What the app knows about the signed-in customer. Credits only, never dollars. */
export interface AccountStatus {
  /** False in builds without cloud keys (local dev): no sign-in, no gating. */
  configured: boolean;
  signedIn: boolean;
  email?: string;
  plan?: string;
  planName?: string;
  balance?: number;
  allowance?: number;
  periodEnd?: string;
  /** Actions waiting to sync. */
  pending: number;
  webUrl: string;
  /** A browser or email sign-in is in progress; the app is waiting for the website to finish it. */
  loginPending?: boolean;
}

/** App update state, from the updater in the main process. */
export interface UpdateStatus {
  state: "idle" | "checking" | "none" | "available" | "ready" | "error";
  current: string;
  version?: string;
  notes?: string;
  url?: string;
  error?: string;
  checkedAt?: string;
}

export interface RefreshLogEntry {
  at: string;
  ok: boolean;
  durationMs: number;
  healed?: boolean;
  error?: string;
  trigger: "schedule" | "manual" | "catchup";
  /** App calls made while replaying. */
  toolCalls?: number;
  /** Rows per published dataset after the refresh. */
  rows?: Record<string, number>;
  credits?: number;
  /** What the repair changed, when it healed. */
  healNote?: string;
}
