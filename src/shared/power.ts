import type { ModelChoice } from "./types";
import { LEVEL_MULTIPLIER, type PowerLevel } from "./pricing";

/**
 * Power levels: what users pick instead of models. The mapping to real models lives only here,
 * so the models behind each level can change without anyone noticing anything but the results.
 */
export type PowerChoice = "auto" | PowerLevel;

export const POWER: Record<PowerLevel, { label: string; blurb: string; model: ModelChoice; multiplier: number }> = {
  quick: { label: "Quick", blurb: "Fast and light. Questions, small edits, simple dashboards.", model: { model: "gpt-6-luna", effort: "low" }, multiplier: LEVEL_MULTIPLIER.quick },
  smart: { label: "Smart", blurb: "Dashie's everyday brain. The right choice for most dashboards.", model: { model: "gpt-6.1-sol", effort: "medium" }, multiplier: LEVEL_MULTIPLIER.smart },
  max: { label: "Max", blurb: "Thinks hard and takes its time. Complex, multi-page or high-stakes work.", model: { model: "gpt-6.1-sol", effort: "high" }, multiplier: LEVEL_MULTIPLIER.max },
};

export const POWER_LEVELS: PowerLevel[] = ["quick", "smart", "max"];

const BIG = /\b(every|everything|all of|several pages|multi-?page|workbook|complete|comprehensive|perfect|flawless|board|investor|executive)\b/i;

/** Auto picks the level per task: questions and repairs are always Quick; builds and edits are Smart unless the ask is clearly big. */
export function resolvePower(choice: PowerChoice | undefined, kind: "build" | "edit" | "ask" | "heal", message = ""): PowerLevel {
  if (kind === "ask" || kind === "heal") return "quick";
  if (choice && choice !== "auto") return choice;
  if (kind === "build" && BIG.test(message)) return "max";
  return "smart";
}

export function modelFor(level: PowerLevel): ModelChoice {
  return { ...POWER[level].model };
}
