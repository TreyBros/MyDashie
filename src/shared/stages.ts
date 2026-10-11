import type { Stage } from "./types";

export const STAGES: { id: Stage; label: string; verb: string }[] = [
  { id: "plan", label: "Plan", verb: "Planning" },
  { id: "gather", label: "Gather", verb: "Gathering data" },
  { id: "shape", label: "Shape", verb: "Shaping data" },
  { id: "design", label: "Design", verb: "Designing" },
  { id: "check", label: "Check", verb: "Checking the result" },
];

/** Which stage a tool call belongs to. */
export function stageOf(tool?: string): Stage {
  if (!tool) return "plan";
  if (tool === "name_dashboard" || tool === "update_plan" || tool === "load_skill" || tool === "ask_user" || tool === "suggest_next" || tool === "COMPOSIO_SEARCH_TOOLS" || tool === "COMPOSIO_GET_TOOL_SCHEMAS") return "plan";
  if (tool === "run_sql" || tool === "inspect_dataset" || tool === "add_inline_data" || tool === "publish_data") return "shape";
  if (tool === "write_dashboard" || tool === "edit_dashboard" || tool === "get_dashboard_html") return "design";
  if (tool === "preview_dashboard") return "check";
  return "gather";
}
