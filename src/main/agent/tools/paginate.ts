import type { Tool, ToolContext } from "../types";
import { extractTable } from "../datasets";
import { substituteDates } from "../provenance";
import { storeAsDataset } from "./local";

const MAX_ROWS = 5000;
const MAX_PAGES = 50;

export interface PageSpec {
  tool_slug: string;
  arguments: Record<string, unknown>;
  /** How the API pages: page numbers, offsets, or a cursor/token from the previous response. */
  mode: "page" | "offset" | "cursor";
  /** Argument that carries the page number, offset, or cursor (e.g. page, offset, after, pageToken, start_cursor, nextPageToken). */
  page_arg: string;
  /** cursor mode: dot path to the next cursor inside the tool's data (e.g. paging.next.after, nextPageToken, next_cursor). */
  next_path?: string;
  /** Optional dot path to the item list inside the tool's data; otherwise the largest list is used. */
  items_path?: string;
  max_rows?: number;
}

const get = (o: unknown, path?: string) =>
  path ? path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o) : undefined;

/** Unwraps one tool's payload from a COMPOSIO_MULTI_EXECUTE_TOOL response. */
export function unwrapExecute(text: string): { ok: boolean; data: unknown; error?: string } {
  const j = JSON.parse(text) as { data?: { results?: { response?: { successful?: boolean; data?: unknown; error?: unknown } }[] }; error?: unknown };
  const r = j.data?.results?.[0]?.response;
  if (!r) return { ok: false, data: null, error: String(j.error ?? "No result returned") };
  return r.successful === false ? { ok: false, data: r.data, error: String(r.error ?? "The app returned an error") } : { ok: true, data: r.data };
}

/** Calls one app tool repeatedly until the list is exhausted. Shared by builds and scheduled refreshes. */
export async function fetchAllPages(ctx: ToolContext, spec: PageSpec) {
  if (!ctx.callMcp) throw new Error("Connected apps aren't available in this run.");
  const cap = Math.min(spec.max_rows ?? MAX_ROWS, MAX_ROWS);
  const base = substituteDates(spec.arguments ?? {});
  const rows: Record<string, unknown>[] = [];
  let cursor: unknown = spec.mode === "page" ? (base[spec.page_arg] ?? 1) : spec.mode === "offset" ? (base[spec.page_arg] ?? 0) : base[spec.page_arg];
  let pages = 0;
  let firstLen = 0;
  let truncated = false;
  while (pages < MAX_PAGES) {
    const args = { ...base, ...(cursor !== undefined && cursor !== null && cursor !== "" ? { [spec.page_arg]: cursor } : {}) };
    const { text, isError } = await ctx.callMcp("composio", "COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [{ tool_slug: spec.tool_slug, arguments: args }],
      sync_response_to_workbench: false,
      thought: "Fetching all pages for a dashboard dataset",
      current_step: "FETCH_PAGES",
      memory: {},
    });
    if (isError) throw new Error(text.slice(0, 400));
    const res = unwrapExecute(text);
    if (!res.ok) throw new Error(`${spec.tool_slug}: ${res.error}`);
    const items = ((spec.items_path ? get(res.data, spec.items_path) : extractTable(res.data)) as Record<string, unknown>[] | null) ?? [];
    pages++;
    if (pages === 1) firstLen = items.length;
    rows.push(...items);
    if (rows.length >= cap) {
      truncated = rows.length > cap || items.length > 0;
      rows.length = Math.min(rows.length, cap);
      break;
    }
    if (!items.length) break;
    if (spec.mode === "cursor") {
      const next = get(res.data, spec.next_path);
      if (next === undefined || next === null || next === "" || next === cursor) break;
      cursor = next;
    } else {
      if (items.length < firstLen) break; // short page = last page
      cursor = spec.mode === "page" ? Number(cursor) + 1 : Number(cursor) + items.length;
    }
  }
  if (pages >= MAX_PAGES) truncated = true;
  return { rows, pages, truncated };
}

export const fetchAllPagesTool: Tool = {
  name: "fetch_all_pages",
  description:
    "Fetch EVERY page of a list from a connected app (one tool slug) and save the combined rows as one dataset. Use this instead of calling COMPOSIO_MULTI_EXECUTE_TOOL page by page whenever a list can exceed one page. Scheduled refreshes repeat the whole loop from the first page, so never pass a cursor copied from an earlier response. Get the tool's schema first (COMPOSIO_GET_TOOL_SCHEMAS) to learn its paging argument and where the next cursor lives. Caps at 5,000 rows.",
  producesData: true,
  parameters: {
    type: "object",
    properties: {
      tool_slug: { type: "string", description: "e.g. HUBSPOT_LIST_DEALS, GITHUB_LIST_COMMITS, JIRA_SEARCH_ISSUES" },
      arguments: { type: "object", description: "Arguments for the first page (filters, fields, page size at its maximum). Date placeholders like {{days_ago:30}} work." },
      mode: { type: "string", enum: ["page", "offset", "cursor"], description: "page = page numbers (GitHub page), offset = row offset (startAt, offset), cursor = token from the previous response (after, pageToken, nextPageToken, start_cursor)" },
      page_arg: { type: "string", description: "The argument that carries the page number, offset, or cursor" },
      next_path: { type: "string", description: "cursor mode only: dot path to the next cursor in the tool's data, e.g. paging.next.after or nextPageToken" },
      items_path: { type: "string", description: "Optional dot path to the item list in the tool's data, e.g. results or issues" },
      max_rows: { type: "number", description: "Optional lower cap (max 5000)" },
      save_as: { type: "string", description: "snake_case dataset name" },
    },
    required: ["tool_slug", "arguments", "mode", "page_arg", "save_as"],
    additionalProperties: false,
  },
  label: (a) => `Pulling every page from ${String(a.tool_slug ?? "your app").split("_")[0]!.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}`,
  async execute(args, ctx) {
    const spec = args as unknown as PageSpec & { save_as: string };
    const { rows, pages, truncated } = await fetchAllPages(ctx, spec);
    const { save_as, ...recorded } = spec;
    const note = `Fetched ${rows.length.toLocaleString()} rows over ${pages} page${pages === 1 ? "" : "s"}${truncated ? " (stopped at the cap; say the data is truncated)" : ""}. `;
    return storeAsDataset(ctx, save_as || spec.tool_slug.toLowerCase(), rows, { kind: "tool", tool: "fetch_all_pages", args: recorded }, note);
  },
};

const MAX_SOURCE_ROWS = 50;
const FOR_EACH_CONCURRENCY = 4;

/** Replace {{row.col}} placeholders inside a template with values from one source row. */
function fillTemplate<T>(template: T, row: Record<string, unknown>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const whole = v.match(/^\{\{\s*row\.([\w.]+)\s*\}\}$/);
      if (whole) return row[whole[1]!]; // keep numbers as numbers when the whole value is one placeholder
      return v.replace(/\{\{\s*row\.([\w.]+)\s*\}\}/g, (_, k: string) => String(row[k] ?? ""));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(template) as T;
}

function templateColumns(template: unknown): string[] {
  return [...new Set([...JSON.stringify(template).matchAll(/\{\{\s*row\.([\w.]+)\s*\}\}/g)].map((m) => m[1]!))];
}

export interface ForEachSpec extends Omit<PageSpec, "mode" | "page_arg"> {
  dataset: string;
  mode?: PageSpec["mode"];
  page_arg?: string;
}

/**
 * Runs one app tool for every row of a dataset (one call per repo, per project, per account)
 * and concatenates the results. The recipe records the template and the source dataset, so a
 * refresh recomputes the source first and the loop follows whatever rows it has that day.
 */
export async function fetchForEach(ctx: ToolContext, spec: ForEachSpec) {
  if (!ctx.callMcp) throw new Error("Connected apps aren't available in this run.");
  const src = ctx.datasets.get(spec.dataset);
  if (!src?.rows) throw new Error(`Dataset "${spec.dataset}" is not a table. Known: ${ctx.datasets.names().join(", ")}`);
  const cols = templateColumns(spec.arguments);
  if (!cols.length) throw new Error("arguments must reference the source row with {{row.column}} placeholders (e.g. {{row.name}}).");
  const missing = cols.filter((c) => !(c in (src.rows![0] ?? {})));
  if (missing.length) throw new Error(`Columns not in "${spec.dataset}": ${missing.join(", ")}. Available: ${Object.keys(src.rows[0] ?? {}).join(", ")}`);
  // One call per distinct combination of the referenced columns.
  const seen = new Set<string>();
  const sources = src.rows.filter((r) => {
    const key = JSON.stringify(cols.map((c) => r[c]));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const truncatedSource = sources.length > MAX_SOURCE_ROWS;
  const batch = sources.slice(0, MAX_SOURCE_ROWS);
  const cap = Math.min(spec.max_rows ?? MAX_ROWS, MAX_ROWS);
  const out: Record<string, unknown>[] = [];
  const failures: string[] = [];
  let calls = 0;
  let truncated = truncatedSource;
  let i = 0;
  const worker = async () => {
    while (i < batch.length && out.length < cap) {
      const row = batch[i++]!;
      const args = fillTemplate(spec.arguments, row);
      const tag = cols.map((c) => `${c}=${String(row[c])}`).join(" ");
      try {
        let items: Record<string, unknown>[];
        if (spec.mode && spec.page_arg) {
          const r = await fetchAllPages(ctx, { ...spec, mode: spec.mode, page_arg: spec.page_arg, arguments: args, max_rows: cap - out.length });
          calls += r.pages;
          if (r.truncated) truncated = true;
          items = r.rows;
        } else {
          calls++;
          const { text, isError } = await ctx.callMcp!("composio", "COMPOSIO_MULTI_EXECUTE_TOOL", {
            tools: [{ tool_slug: spec.tool_slug, arguments: substituteDates(args) }],
            sync_response_to_workbench: false,
            thought: "Fetching one row's data for a dashboard dataset",
            current_step: "FETCH_FOR_EACH",
            memory: {},
          });
          if (isError) throw new Error(text.slice(0, 300));
          const res = unwrapExecute(text);
          if (!res.ok) throw new Error(res.error);
          items = ((spec.items_path ? get(res.data, spec.items_path) : extractTable(res.data)) as Record<string, unknown>[] | null) ?? [];
        }
        // Tag each result with the source row it came from (a repo name, a project key), under
        // the template's column names unless the item already has them.
        for (const it of items) {
          const tagged: Record<string, unknown> = { ...it };
          for (const c of cols) tagged[c in it ? `source_${c}` : c] = row[c];
          out.push(tagged);
          if (out.length >= cap) {
            truncated = true;
            break;
          }
        }
      } catch (e) {
        failures.push(`${tag}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FOR_EACH_CONCURRENCY, batch.length) }, worker));
  if (failures.length && failures.length === batch.length) throw new Error(`Every call failed. First: ${failures[0]}`);
  return { rows: out, calls, sources: batch.length, truncated, failures };
}

export const fetchForEachTool: Tool = {
  name: "fetch_for_each",
  description:
    "Run one app tool once per row of a dataset you already have (commits for every repo in active_repos, issues for every project, metrics for every account) and save all results as one dataset. Reference the row in arguments with {{row.column}}. Pass mode/page_arg to page through each call like fetch_all_pages. Scheduled refreshes recompute the source dataset first, then repeat the loop, so new rows (a new repo, a new project) show up by themselves. Up to 50 source rows and 5,000 result rows.",
  producesData: true,
  parameters: {
    type: "object",
    properties: {
      dataset: { type: "string", description: "Source dataset to iterate (a table)." },
      tool_slug: { type: "string", description: "e.g. GITHUB_LIST_COMMITS" },
      arguments: { type: "object", description: "Arguments template; use {{row.column}} for values from the source row, e.g. { owner: \"{{row.owner_login}}\", repo: \"{{row.name}}\", since: \"{{days_ago:30}}\" }" },
      mode: { type: "string", enum: ["page", "offset", "cursor"], description: "Optional paging, as in fetch_all_pages" },
      page_arg: { type: "string" },
      next_path: { type: "string" },
      items_path: { type: "string", description: "Optional dot path to the item list in each response" },
      max_rows: { type: "number" },
      save_as: { type: "string", description: "snake_case dataset name" },
    },
    required: ["dataset", "tool_slug", "arguments", "save_as"],
    additionalProperties: false,
  },
  label: (a) => `Pulling ${String(a.tool_slug ?? "data").split("_").slice(1).join(" ").toLowerCase() || "data"} for each row of ${String(a.dataset ?? "the list").replace(/_/g, " ")}`,
  async execute(args, ctx) {
    const spec = args as unknown as ForEachSpec & { save_as: string };
    const r = await fetchForEach(ctx, spec);
    const { save_as, ...recorded } = spec;
    const note =
      `Fetched ${r.rows.length.toLocaleString()} rows from ${r.sources} source row${r.sources === 1 ? "" : "s"} in ${r.calls} call${r.calls === 1 ? "" : "s"}` +
      (r.truncated ? " (stopped at a cap; say the data is truncated)" : "") +
      (r.failures.length ? `. ${r.failures.length} source row(s) failed: ${r.failures.slice(0, 3).join("; ")}` : "") +
      ". ";
    return storeAsDataset(ctx, save_as || spec.tool_slug.toLowerCase(), r.rows, { kind: "tool", tool: "fetch_for_each", args: recorded, inputs: [spec.dataset] }, note);
  },
};
