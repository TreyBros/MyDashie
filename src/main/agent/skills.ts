/**
 * Dashie's skill library. The catalog (name + one line) is always in the system prompt; the agent
 * loads a skill's full text with load_skill only when it needs it (progressive disclosure).
 */

export interface Skill {
  name: string;
  summary: string;
  body: string;
}

export const SKILLS: Skill[] = [
  {
    name: "pages",
    summary: "Multi-page dashboards (tabs): when to split, page recipes, markup, and keeping each page focused.",
    body: `
MULTI-PAGE DASHBOARDS (tabs, like sheets in a workbook)
When: the request covers several areas or audiences, or one page would need more than ~8 cards. Otherwise keep one page.
Shape: Overview first (3-5 KPIs, the main trend, one breakdown, a takeaway), then 2-5 focused pages, each answering one question in depth. Typical sets:
  Sales: Overview · Pipeline · Customers · Products · Reps
  Support: Overview · Volume · Speed (time to first reply/close) · Quality (CSAT) · Topics
  Product: Overview · Acquisition · Activation · Retention · Feature usage
  Finance: Overview · Revenue · Expenses · Cash · Forecast
  Ops/monitoring: Overview · Timeline · Breakdown · Events (detail table)
Each detail page: a one-line <p class="dk-page-intro"> saying what the page answers, 2-4 KPIs specific to it, then charts and one detailed table (sortable, up to 50 rows, with links if available).
Markup (one header and footer for the whole dashboard):
  <header id="hdr"></header>
  <nav id="tabs"></nav>
  <section class="dk-page" data-page="overview" data-title="Overview"><div class="dk-grid"> …cards… </div></section>
  <section class="dk-page" data-page="customers" data-title="Customers"><p class="dk-page-intro">Who buys, how much, and who's growing.</p><div class="dk-grid"> … </div></section>
  <footer id="ftr"></footer>
Script order: build EVERY card on every page first, then call Dash.pages("#tabs") once at the very end (it hides the other pages and resizes charts when you switch).
Element ids must be unique across all pages (prefix them: ov-k1, cu-c2…).
Keep insights consistent across pages (same cutoff date, same definitions). preview_dashboard checks and screenshots every page.
`,
  },
  {
    name: "layouts",
    summary: "Proven dashboard layouts (executive, sales, support, product, finance, ops, monitoring) as 12-column grid recipes.",
    body: `
LAYOUT RECIPES (12-column .dk-grid; every section is a direct child with a span-N class)
General rule: header -> optional insight (span-12) -> KPI row -> primary trend -> breakdowns -> detail. Max ~8 cards. One idea per card.

EXECUTIVE / OVERVIEW
  insight span-12
  4 KPIs: span-3 x4 (each with previous + spark)
  primary trend span-8 + mix/donut span-4
  breakdown bar span-6 + top list span-6

SALES / REVENUE
  KPIs: revenue, orders, avg order value, conversion or win rate (span-3 x4)
  revenue by week/month line span-8 + revenue by product donut span-4
  revenue by region horizontal bar span-6 + top customers table span-6 (columns: name, revenue with bar:true, orders)

SUPPORT
  KPIs: open tickets (goodWhen down), median time to close (goodWhen down), CSAT, tickets this week
  tickets per week by channel stacked bar span-8 + priority mix donut span-4
  time-to-close by priority bar span-6 + CSAT by agent bar (highlight best) span-6
  topics list span-12 or span-6

PRODUCT / GROWTH
  KPIs: active users, new signups, retention or activation, churn (goodWhen down)
  signups/active line span-8 + funnel span-4 (Dash.echarts funnel, see skill "charts")
  feature usage horizontal bar span-6 + cohort heatmap span-6

FINANCE
  KPIs: revenue, expenses (goodWhen down), net, runway or margin
  revenue vs expenses grouped bar span-12 or line with two series (same unit only!)
  category breakdown bar span-6 + largest transactions table span-6

MONITORING / LIVE OPS (e.g. earthquakes, uptime, weather)
  KPIs with the latest value and change
  timeline line/bar span-8 + distribution span-4
  latest/most significant events table span-12 with links when available

Responsive: the kit collapses spans automatically; don't add custom breakpoints.
`,
  },
  {
    name: "kpis",
    summary: "How to choose and present KPIs: comparisons, goodWhen, targets, sparklines, formatting.",
    body: `
KPI CARDS
- 3 to 5 KPIs. Each answers "how are we doing?" in one glance.
- ALWAYS give context: previous equal period (last 7 vs prior 7 days, this month vs last month, YTD vs last YTD). Compute both in one SQL row:
    SELECT sum(revenue) FILTER (WHERE d >= current_date - 30) AS cur,
           sum(revenue) FILTER (WHERE d >= current_date - 60 AND d < current_date - 30) AS prev
  For static or historical data, compare the LAST period in the data to the one before it (use max(date) as the anchor, not current_date).
- compareLabel names the comparison: "vs prior 30 days", "vs last month".
- goodWhen:"down" for costs, churn, errors, wait/resolve times, open tickets, refunds.
- spark: 8 to 14 recent points of the same metric (daily or weekly), oldest first.
- Formats: "currency" for money, "percent" expects 0.12 for 12%, "compact" for big counts, a number for decimals.
- Rates: show 1 decimal (e.g. 2.4%). Money: no cents above $1,000.
- Compare complete periods with complete periods. If the latest period is partial, compare like-for-like (first 9 days of this month vs first 9 days of last month) and say so.
- Never a KPI for something that can't move (e.g. total rows in a static file) unless it's the headline count.
`,
  },
  {
    name: "charts",
    summary: "Picking the right chart + ready Dash.echarts recipes for funnel, gauge, scatter, treemap, calendar heatmap, stacked/grouped bars, dual-series lines.",
    body: `
CHART SELECTION
- Trend over time -> Dash.line (area for one series). Many categories over time -> stacked bar (stacked:true) or small multiples.
- Compare categories -> Dash.bar; horizontal + sort:"desc" when labels are long or >6 items; limit to top 10, fold the rest.
- Part-to-whole with <=6 parts -> Dash.donut; otherwise bar.
- Two dimensions (hour x weekday, agent x priority) -> Dash.heatmap.
- Ranking with details -> Dash.table (bar:true on the key number) or Dash.list.
- Relationship between two measures -> scatter (recipe below).
- Stages -> funnel. Progress to a goal -> KPI target or gauge.
- Never dual y-axes. Two different units = two charts.

DASH.ECHARTS RECIPES (themed automatically; colors come from Dash.palette())
Funnel:
  Dash.echarts("#f", () => ({ tooltip:{trigger:"item"}, series:[{ type:"funnel", left:"6%", width:"88%", sort:"descending", gap:4, label:{position:"inside", formatter:"{b}\\n{c}"}, itemStyle:{borderRadius:6}, data: rows.map(r=>({name:r.stage, value:r.count})) }] }));
Gauge (percent of goal):
  Dash.echarts("#g", () => ({ series:[{ type:"gauge", startAngle:200, endAngle:-20, min:0, max:100, progress:{show:true, width:14, roundCap:true}, axisLine:{lineStyle:{width:14}}, pointer:{show:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false}, detail:{valueAnimation:true, formatter:"{value}%", fontSize:28, offsetCenter:[0,"10%"]}, data:[{value: pct}] }] }));
Scatter:
  Dash.echarts("#s", () => ({ tooltip:{trigger:"item"}, xAxis:{type:"value", name:"Price"}, yAxis:{type:"value", name:"Units"}, series:[{ type:"scatter", symbolSize:10, data: rows.map(r=>[r.price, r.units, r.name]) }] }));
Treemap:
  Dash.echarts("#t", () => ({ series:[{ type:"treemap", roam:false, nodeClick:false, breadcrumb:{show:false}, itemStyle:{borderColor:Dash.css("--dk-surface"), borderWidth:2, gapWidth:2}, label:{formatter:"{b}"}, data: rows.map(r=>({name:r.category, value:r.amount})) }] }));
Calendar heatmap (daily activity):
  Dash.echarts("#c", () => ({ tooltip:{}, visualMap:{min:0, max:maxV, orient:"horizontal", left:"center", bottom:0, inRange:{color:[Dash.css("--dk-accent-soft"), Dash.css("--dk-accent")]}}, calendar:{range:[first,last], cellSize:["auto",16], itemStyle:{borderWidth:2, borderColor:Dash.css("--dk-surface")}, splitLine:{show:false}}, series:[{ type:"heatmap", coordinateSystem:"calendar", data: rows.map(r=>[r.day, r.count]) }] }));
Grouped bars: Dash.bar with series:["a","b"] (stacked:false). Stacked: stacked:true.
Card shell for an echarts recipe: <section id="f" class="span-4"></section> then
  const host = document.querySelector("#f"); host.classList.add("dk-card"); host.innerHTML = '<div class="dk-card-head"><div><h3 class="dk-card-title">Funnel</h3><div class="dk-card-sub">Last 30 days</div></div></div><div class="dk-chart" id="f-chart"></div>'; then Dash.echarts("#f-chart", ...).
`,
  },
  {
    name: "sql",
    summary: "DuckDB recipes: period-over-period, weekly/monthly buckets, medians/percentiles, top-N + Other, running totals, cohorts, parsing dates and nested JSON.",
    body: `
DUCKDB RECIPES (every dataset is a table; shape data here, not in the HTML)
Dates: CAST(col AS DATE), strptime(col, '%Y-%m-%d %H:%M'), to_timestamp(epoch_seconds), epoch_ms(ms) for millisecond epochs.
Buckets: date_trunc('week', ts) AS week, date_trunc('month', ts), strftime(ts, '%Y-%m') for labels, hour(ts), dayname(ts).
Anchor for static data: WITH a AS (SELECT max(CAST(d AS DATE)) AS last FROM t) ... WHERE d > last - INTERVAL 30 DAY.
Period over period in one row:
  SELECT sum(x) FILTER (WHERE d > a.last - 30) cur, sum(x) FILTER (WHERE d > a.last - 60 AND d <= a.last - 30) prev FROM t, a;
Median / percentiles: median(x), quantile_cont(x, 0.9). Durations: date_diff('minute', opened, closed) / 60.0 AS hours.
Top N + Other:
  WITH r AS (SELECT name, sum(v) v FROM t GROUP BY 1), k AS (SELECT *, row_number() OVER (ORDER BY v DESC) n FROM r)
  SELECT CASE WHEN n <= 8 THEN name ELSE 'Other' END name, sum(v) v FROM k GROUP BY 1 ORDER BY v DESC;
Running total: sum(v) OVER (ORDER BY day). Share: v / sum(v) OVER ().
Pivot long->wide for multi-series charts: PIVOT t ON channel USING count(*) GROUP BY week.
Fill missing days: SELECT d::DATE day FROM range(DATE '2026-01-01', DATE '2026-02-01', INTERVAL 1 DAY) t(d) LEFT JOIN ...
Nested JSON objects (maps keyed by name, e.g. {"targets":{"Europe":{"2026-01":30000}}}) arrive as a table with one column "json". Flatten with json_keys + unnest (keys must be quoted with to_json):
  SELECT r AS region, m AS month, CAST(json_extract(json, '$.targets.' || to_json(r)::VARCHAR || '.' || to_json(m)::VARCHAR) AS DOUBLE) AS target
  FROM t, unnest(json_keys(json, '$.targets')) AS a(r), unnest(json_keys(json, '$.targets.' || to_json(r)::VARCHAR)) AS b(m);
Never retype numbers from a tool result by hand.
Nested JSON from APIs: UNNEST(list_col) for arrays; struct fields with col.field; for GeoJSON features: SELECT f.properties.mag mag, to_timestamp(f.properties.time/1000) ts, f.properties.place place FROM (SELECT UNNEST(features) f FROM src).
Nulls: coalesce(x, 0); filter junk rows early. Round for display only in the kit, not SQL (keep numbers numeric).
Spark series: SELECT list(v ORDER BY day) FROM (... last 12 days ...) gives one array cell you can pass to spark.
If a query errors, read the error: wrong column names are the most common cause; use inspect_dataset to see real columns.
`,
  },
  {
    name: "polish",
    summary: "The final design checklist: titles, units, number formats, insight sentence, empty states, links, spacing.",
    body: `
POLISH CHECKLIST (run before you finish)
- Headline: header title is short and specific; subtitle states scope + window ("All regions · Jan 1 – Oct 9, 2026").
- Insight sentence: one line with real numbers, the key phrase in <strong>.
- Every chart title says what it shows; subtitle gives unit and window.
- Numbers: thousands separators, currency symbols, 1-decimal percentages, no long decimals, no "NaN"/"undefined".
- Colors: let the kit choose; highlight one thing at most.
- Tables: <= 12 rows visible, sorted by the key metric, key number has bar:true.
- Links: real source URLs only (from tool results), in the footer or on rows.
- Footer: Dash.footer("#ftr", "Source: …").
- No horizontal scrolling at 1280px; nothing cut off; legends readable.
- Re-run preview_dashboard after changes and confirm QA passed.
`,
  },
  {
    name: "data-sources",
    summary: "Getting data: connected apps (search -> schema -> execute), pagination, rate limits, local files, public APIs, and what to do when access is missing.",
    body: `
DATA SOURCES
Connected apps: 1) COMPOSIO_SEARCH_TOOLS with a specific use case ("list Stripe charges in a date range"). 2) COMPOSIO_GET_TOOL_SCHEMAS for the chosen tool. 3) COMPOSIO_MULTI_EXECUTE_TOOL with exact arguments. Request only the fields and date range you need. For any list that can run past one page, use fetch_all_pages (one tool slug, its paging argument, and for cursor APIs the path to the next cursor). It loops to the end (cap 5,000 rows) and refreshes repeat the loop, so never pass a cursor copied from an earlier response. Fetch independent things in one COMPOSIO_MULTI_EXECUTE_TOOL call; each tool's result becomes its own dataset. When you need the same tool for every row of a dataset (commits per repo, issues per project, metrics per property), use fetch_for_each with {{row.column}} placeholders: one call does the loop, runs 4 at a time, and the refresh re-derives the list first so new items appear automatically. Several fetch_all_pages / fetch_for_each calls in one turn run in parallel. Say if you truncated.
Not connected: COMPOSIO_MANAGE_CONNECTIONS returns a link; tell the user one short sentence ("Connect Stripe and I'll pick up from there"), then COMPOSIO_WAIT_FOR_CONNECTIONS.
Local files: read_local_file for CSV/Excel/JSON/Parquet/SQLite the user names. For SQLite call it once without table to list tables.
Public APIs: http_get with full URL; prefer JSON endpoints. Use {{days_ago:N}}/{{today}} placeholders in URLs so refreshes stay relative.
Always inspect_dataset after fetching anything non-trivial, before writing SQL.
If a source fails twice, explain plainly and build with what works; never fabricate data.
`,
  },
];

export function skillCatalog() {
  return SKILLS.map((s) => `- ${s.name}: ${s.summary}`).join("\n");
}
