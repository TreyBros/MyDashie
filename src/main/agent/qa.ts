/**
 * Automated dashboard QA. QA_SCRIPT runs inside the rendered dashboard page (Electron or Playwright)
 * and returns a list of concrete problems the agent must fix. Keep checks objective.
 */

export interface QaIssue {
  kind: "error" | "bad-text" | "overflow" | "empty-chart" | "blank" | "tiny-text" | "clipped";
  detail: string;
}

export interface QaReport {
  issues: QaIssue[];
  stats: { charts: number; kpis: number; tables: number; textLength: number; usesKit: boolean; pageHeight?: number; clickable?: number; look?: string };
}

/** Evaluated in the page; must be a self-contained expression returning QaReport (minus console errors). */
export const QA_SCRIPT = `(() => {
  const issues = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const text = document.body ? document.body.innerText : "";
  // 1) junk values leaking into the UI
  const junk = text.match(/\\b(NaN|undefined|null|Infinity|\\[object Object\\])\\b/g);
  if (junk) issues.push({ kind: "bad-text", detail: "Visible text contains " + [...new Set(junk)].join(", ") + " (" + junk.length + "x). Format or guard missing values." });
  if (/\\$-?\\d+\\.\\d{4,}|\\d+\\.\\d{5,}/.test(text)) issues.push({ kind: "bad-text", detail: "Unformatted long decimals are visible. Round numbers for display." });
  // 2) page-level overflow
  if (document.documentElement.scrollWidth > window.innerWidth + 2) issues.push({ kind: "overflow", detail: "Page scrolls horizontally (" + document.documentElement.scrollWidth + "px wide in a " + window.innerWidth + "px window)." });
  // 3) charts that rendered nothing
  let charts = 0;
  const chartHosts = [...document.querySelectorAll("[_echarts_instance_], canvas, svg")].filter((el) => vis(el) && el.getBoundingClientRect().width > 120 && el.getBoundingClientRect().height > 80);
  for (const el of chartHosts) {
    if (el.closest("[_echarts_instance_]") && el.tagName !== "DIV") continue; // count the echarts host once
    charts++;
    const shapes = el.tagName === "CANVAS" ? 1 : el.querySelectorAll("path,rect,circle,line,polyline,polygon").length;
    if (el.tagName !== "CANVAS" && shapes < 3) issues.push({ kind: "empty-chart", detail: "A chart area (" + Math.round(el.getBoundingClientRect().width) + "x" + Math.round(el.getBoundingClientRect().height) + ") rendered almost nothing. Check its data and field names." });
  }
  // 4) text clipped inside cards (scrollWidth > clientWidth on non-scrolling text)
  let clipped = 0;
  for (const el of document.querySelectorAll("h1,h2,h3,p,span,div,td,th")) {
    if (!vis(el) || el.children.length > 0) continue;
    const s = getComputedStyle(el);
    if ((s.overflow === "hidden" || s.textOverflow === "ellipsis") ) continue;
    if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0 && s.whiteSpace === "nowrap") clipped++;
  }
  if (clipped > 2) issues.push({ kind: "clipped", detail: clipped + " text elements overflow their boxes. Allow wrapping or widen them." });
  // 5) tiny text
  const tiny = [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && el.textContent.trim() && vis(el) && parseFloat(getComputedStyle(el).fontSize) < 9.5).length;
  if (tiny > 3) issues.push({ kind: "tiny-text", detail: tiny + " text elements are smaller than 10px." });
  // 6) mostly blank page
  if (text.trim().length < 40) issues.push({ kind: "blank", detail: "The page shows almost no content." });
  const kpis = document.querySelectorAll(".dk-kpi").length;
  const tables = document.querySelectorAll("table").length;
  const clickable = document.querySelectorAll(".dk-drillable, .dk-clickable").length;
  const look = (document.documentElement.getAttribute("data-look") || "") + "/" + (document.documentElement.getAttribute("data-accent") || "");
  return { issues, stats: { charts, kpis, tables, textLength: text.length, usesKit: !!window.Dash, pageHeight: document.documentElement.scrollHeight, clickable, look } };
})()`;

export function formatQa(r: QaReport, consoleErrors: string[]): { ok: boolean; text: string; issues: QaIssue[] } {
  const issues: QaIssue[] = [...consoleErrors.slice(0, 8).map((e) => ({ kind: "error" as const, detail: `Console error: ${e.slice(0, 240)}` })), ...r.issues];
  const s = r.stats;
  const fold = s.pageHeight && s.pageHeight > 900 ? ` The page is ${s.pageHeight}px tall in an 800px window, so ${s.pageHeight - 800}px is below the fold (the screenshot shows the full page). Keep the key KPIs and the main chart above 800px; trim long tables to the rows that matter.` : "";
  const drill = s.clickable === 0 && s.charts + s.tables > 0 ? " Nothing opens details yet: add drill to the cards that list things so people can click in." : s.clickable ? ` ${s.clickable} cards or rows open details on click.` : "";
  const look = s.look === "/" ? " No Dash.theme call: pick a look and accent." : "";
  const head = `Rendered: ${s.kpis} KPI cards, ${s.charts} charts, ${s.tables} tables${s.usesKit ? ", Dash Kit loaded" : ", Dash Kit NOT loaded"}.${fold}${drill}${look}`;
  if (!issues.length) return { ok: true, text: `${head} Automated QA passed: no errors, no overflow, no empty charts, no junk values.`, issues };
  return { ok: false, text: `${head} Automated QA found ${issues.length} problem(s) you must fix:\n${issues.map((i, n) => `${n + 1}. [${i.kind}] ${i.detail}`).join("\n")}`, issues };
}
