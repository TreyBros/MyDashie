import type { ModelInfo, ReasoningEffort } from "./types";

export const DEFAULT_BUILD_MODEL = "gpt-6.1-sol";
export const DEFAULT_REFRESH_MODEL = "gpt-6-luna";

/** Curated metadata for models we know. Anything else the key can see is listed as "other". */
export const KNOWN_MODELS: Record<string, Omit<ModelInfo, "id">> = {
  "gpt-6-astra": { label: "GPT-6 Astra", tier: "flagship" },
  "gpt-6.1-sol": { label: "GPT-6.1 Sol", tier: "balanced", recommendedFor: "build" },
  "gpt-6-sol": { label: "GPT-6 Sol", tier: "balanced" },
  "gpt-6-luna": { label: "GPT-6 Luna", tier: "efficient", recommendedFor: "refresh" },
  "gpt-5.6-sol": { label: "GPT-5.6 Sol", tier: "balanced" },
  "gpt-5.6-luna": { label: "GPT-5.6 Luna", tier: "efficient" },
  "gpt-5.5": { label: "GPT-5.5", tier: "balanced" },
  "gpt-5.3-codex": { label: "GPT-5.3 Codex", tier: "balanced" },
  "gpt-5.2-codex": { label: "GPT-5.2 Codex", tier: "balanced" },
  "gpt-5.4": { label: "GPT-5.4", tier: "balanced" },
  "gpt-5.4-mini": { label: "GPT-5.4 Mini", tier: "efficient" },
};

export const MODEL_FILTER = /^(gpt-6|gpt-5\.[2-9]|gpt-5-codex)/;

export const EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

export function describeModel(id: string): ModelInfo {
  const known = KNOWN_MODELS[id];
  if (known) return { id, ...known };
  return { id, label: id, tier: "other" };
}

/** Models that reject effort "none" (gpt-6.1-sol per docs). */
export function effortsFor(model: string): ReasoningEffort[] {
  if (/^gpt-6(\.\d)?-(sol|astra)/.test(model)) return ["low", "medium", "high", "xhigh", "max"];
  return EFFORTS;
}
