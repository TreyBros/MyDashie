/**
 * One chat, two paths. A message about an existing dashboard is either a question (answer it,
 * cheaply, change nothing) or a change (the full edit flow). Rules catch the obvious cases for
 * free; anything ambiguous goes to a tiny model call.
 */
export type Intent = "ask" | "change";

const CHANGE_VERB =
  /\b(add|remove|delete|drop|change|make|rename|replace|hide|use|switch|turn|move|put|set|update|edit|fix|redo|rebuild|redesign|create|build|sort|filter|group|split|merge|include|exclude|convert|color|colou?r|resize|bigger|smaller|larger|instead|should be|want|need|give me|let's|lets)\b/i;
const QUESTION_START = /^(what|what's|whats|why|how|which|who|where|when|is|are|does|do|did|was|were|explain|tell me|describe|summari[sz]e|walk me through|help me understand)\b/i;
const QUESTION_END = /\?\s*$/;
const WH = /^(what|what's|whats|why|how|which|who|where|when|explain|tell me|describe|summari[sz]e|walk me through|help me understand)\b/i;

/** Decides from wording alone, or returns null when a model should decide. */
export function classifyByRules(text: string): Intent | null {
  const t = text.trim();
  if (!t) return "change";
  const question = QUESTION_START.test(t) || QUESTION_END.test(t);
  const change = CHANGE_VERB.test(t);
  if (question && !change) return "ask";
  if (change && !question) return "change";
  // "What does this show?" has a change verb (show) but is plainly a question.
  if (WH.test(t) && !/\b(add|remove|delete|change|make|replace|rename|fix|update|rebuild|redesign|instead)\b/i.test(t)) return "ask";
  return null;
}

/** Full decision: rules first, then the classifier (a cheap model call) for the ambiguous rest. */
export async function classifyIntent(text: string, classify?: (prompt: string) => Promise<string>): Promise<{ intent: Intent; source: "rules" | "model" | "default" }> {
  const byRules = classifyByRules(text);
  if (byRules) return { intent: byRules, source: "rules" };
  if (!classify) return { intent: "change", source: "default" };
  try {
    const out = (await classify(`A user typed this into the chat next to their dashboard:\n"""${text.slice(0, 600)}"""\nIs it a QUESTION about the dashboard or its data (answer: ask), or a request to CHANGE the dashboard (answer: change)? Reply with exactly one word: ask or change.`)).trim().toLowerCase();
    return { intent: /^ask/.test(out) ? "ask" : "change", source: "model" };
  } catch {
    return { intent: "change", source: "default" };
  }
}
