# Dashie's agent harness

Dashie runs a tool loop on the OpenAI Responses API (`src/main/agent/harness.ts`). The design follows Claude Code and Anthropic's/OpenAI's published agent guidance: plan, act with small precise tools, verify against ground truth, and don't stop until the work passes checks.

## The loop

1. **Ask.** For new or vague builds, `ask_user` puts 1–4 multiple-choice questions in a card (options drawn from the real data). Max two rounds; answers are saved to the dashboard's brief. Headless runs fall back to best judgment.
2. **Plan.** `update_plan` keeps a 3–7 step checklist. The app shows it live in the work card.
3. **Skills on demand.** The system prompt lists a skill catalog; `load_skill` pulls the full playbook only when needed (`src/main/agent/skills.ts`: pages, layouts, kpis, charts, sql, polish, data-sources).
4. **Gather.** Connected apps (Composio over MCP), user MCP servers, `read_local_file`, `http_get`, `fetch_all_pages` (every page of a list), `fetch_for_each` (one call per row of a dataset, e.g. commits for every active repo; the refresh re-derives the list first). Consecutive read-only calls run in parallel. Absolute dates the model types into data-tool arguments are rewritten to `{{days_ago:N}}` placeholders by the harness (`relativizeDates`) so a refresh keeps the same window; SQL date literals only get a warning.
5. **Look before leaping.** `inspect_dataset` profiles columns (types, nulls, distinct, min/max) before SQL. Nested JSON objects become a one-column `json` table that SQL can flatten.
6. **Shape.** `run_sql` in DuckDB. Every dataset records its provenance so `publish_data` can derive the refresh recipe.
7. **Build.** `write_dashboard` for the first version; `edit_dashboard` (exact, unique string replacement) for every change after that. Broad asks become multi-page workbooks with `Dash.pages` tabs.
8. **Verify.** `preview_dashboard` renders the full page (and every tab of a multi-page dashboard), runs automated QA (`src/main/agent/qa.ts`: console errors, junk values, overflow, empty charts, clipped or tiny text, below-the-fold notes) and returns the screenshot.
9. **Stop hook.** When the model tries to finish, the harness checks: is there HTML, published data, a preview after the last change, a clean QA result, and a finished plan? If not, it sends the model back with the exact gap (max 3 times). It never forces a build when the user still has to connect an app.
10. **Suggest.** `suggest_next` offers three follow-ups as chips.

## One chat, two paths

A message about an existing dashboard is routed before it runs (`src/main/agent/intent.ts`): wording rules decide the obvious cases ("what is this" → question, "make it blue" → change) and a tiny Quick-model call settles the rest. Questions run in **ask mode**: read-only tools (page, data, SQL), no snapshot, no plan, no gate, no preview, Quick level, minimum credits; the answer is a few plain sentences and may end with "Want me to change it?", which the chat turns into a one-tap change. The user bubble shows the picked card and the route as chips; "change it instead" / "just answer" re-runs the message the other way and refunds the misrouted run.

## Power levels

Users pick Auto, Quick, Smart or Max (`src/shared/power.ts`), never a model. Questions and repairs always run Quick; Auto runs builds and edits on Smart, or Max when the ask is clearly big. The level only scales credits (0.4× / 1× / 3×); the model mapping behind each level can change freely. Developer mode exposes the raw model picker.

## Edits stay small

An edit run starts from the dashboard's existing data and recipe, so nothing is re-fetched. `publish_data` is additive in edit mode, and `write_dashboard` refuses to replace an existing page unless the user asked for a rebuild. In the app, "Pick a card to change" lets the user click a card; the request is then scoped to that element. Every run snapshots a version first, so "Undo this change" is one click.

Also: retries with backoff on 429/5xx/network errors, repeated-identical-call detection, 24k-character tool output cap, a version snapshot before every run (one-click undo), and inline data frozen into the recipe so refreshes never depend on a model.

## Refresh and heal

`scheduler/refresh.ts` replays the recipe with no model: independent app steps run four at a time, SQL steps in order. The log (`refresh-log.json`, shown under More → Refresh history) records trigger, duration, app calls, rows per published dataset and credits. If a step fails, the cheap model gets one heal run; in heal mode `publish_data` refuses to replace a fetched dataset with frozen inline data, and the log keeps a one-sentence `healNote` of what changed.

## Metering

Users see credits, never dollars (`shared/pricing.ts`). Each build, edit, heal and refresh is priced from token usage (per-model list prices), app calls and previews, rounded up to a tenth of a credit with a 0.1 minimum; one credit is anchored to $0.10 of underlying cost. Every action is appended to `usage.jsonl` with its real cost; Settings → General shows this month's credits, and tapping the version line five times opens the pricing lab (true cost, cost per credit, CSV export). Credits also appear on finished work cards and in the refresh history.

## Live viewer

`DashFrame` double-buffers the dashboard iframe: a new version loads hidden with `?staged=1` (dashkit suppresses animations), posts `dash-ready`, receives `dash-reveal` with the live frame's page, scroll and card ids, animates only new cards, then fades in. Frames swap on `htmlVersion` and `dataFetchedAt`, never on renames. `BuildStrip` floats over the page while a run is active.

## Evals

```
npm run eval -- --label <name> [--suite core|hard|loop] [--only id,id] [--model gpt-6.1-sol] [--effort medium]
```

Each case does a real build headlessly, renders it in Chrome, runs QA, replays the refresh with no model, and has a separate vision model grade the full-page screenshot (coverage, clarity, design, trust). Hard cases also check exact numbers against ground truth computed from the fixtures, and that Dashie refuses to invent data it can't access. Results go to `evals/results/<label>/` (report.md, report.json, screenshots).

- **core:** sales CSV (+ edit), support SQLite, earthquakes, weather, GitHub, World Bank.
- **loop:** a one-line rename must keep 97%+ of the page and fetch nothing; a four-page workbook plus a page-scoped edit; a vague request must trigger questions (a simulated user picks the first options, or the case's `prefer` pattern); a question about a card must be answered in ≤4 tools without touching the page.
- **hard:** exact Q3 figures, messy expenses CSV, revenue-vs-target join across CSV + nested JSON, heavy multi-part edit, no-access (must not fabricate).

Rule of thumb: run `--suite hard` after any prompt or tool change, and the full suite before a release. Judge scores move ±0.5 between runs; exact values, refresh, QA and fabrication are the hard signals.
