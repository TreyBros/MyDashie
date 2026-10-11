# MyDashie architecture

MyDashie (Self Service Reporting) is a macOS-first Electron app with one job: turn a prompt into an HTML dashboard, keep that dashboard in one place, and keep its data fresh on a schedule.

## The core idea: code and data are separate

A dashboard is a folder in the app's user-data directory:

```
dashboards/<id>/
  dashboard.json   manifest: name, prompt, schedule, model settings, status, timestamps
  index.html       the dashboard code. Loads chart libs from ./dash-libs/ and data from ./dash-data.js
  data.json        the latest data snapshot { fetchedAt, datasets: { name: rows[] } }
  recipe.json      how to rebuild data.json: ordered tool calls + SQL transforms with provenance
  chat.json        the build/edit conversation so "Edit with AI" has context
  thumbnail.png    screenshot for the home grid
  history/         previous data snapshots (last 20)
```

The **build agent** (expensive coding model) runs once to write `index.html` and produce the first `data.json`. While it works, the harness records **provenance**: which tool call produced which dataset, and which SQL derived which dataset from which inputs. When the agent publishes datasets, the harness walks that provenance graph backwards and writes `recipe.json` automatically. The agent never has to hand-author a refresh plan.

A **scheduled refresh** replays `recipe.json` deterministically with no model call: re-run each recorded tool call with the same arguments (independent app calls four at a time), re-run each SQL transform in DuckDB, write a new `data.json`. The HTML is untouched. Recorded arguments keep dates as `{{days_ago:N}}` placeholders (the harness rewrites absolute dates), and `fetch_for_each` steps re-derive their source list first, so the window and the set of things fetched stay current. Only when a step fails does the **heal agent** (cheap model) get invoked with the recipe, the error, and the tools, so it can re-map a changed field, request a new Connect Link, or rewrite a query. If it still fails, the dashboard shows last-good data with a "stale since" marker and the user gets a notification.

"Edit with AI" runs the build agent again against the existing HTML and datasets with the user's change request.

## Processes

```
src/main/        Electron main (Node 24, ESM). Owns everything stateful.
  index.ts       lifecycle, window, tray, dash:// protocol, power events
  ipc.ts         validated ipcMain handlers (zod) — the only renderer entry point
  store/         settings.json, secrets via safeStorage, dashboard repository (files)
  agent/         harness: loop over OpenAI Responses API, tool registry, prompts, provenance
  agent/tools/   local tools: run_sql (DuckDB), read_local_file, http_get, granola,
                 write_dashboard, preview_dashboard, publish_data
  connectors/    Composio session (MCP), user MCP servers, local source discovery
  scheduler/     croner-based scheduler, refresh runner, heal flow, notifications
  dashboards/    manifest model, serving, standalone HTML exporter
src/preload/     contextBridge with a typed, whitelisted API
src/renderer/    React 19 + Tailwind 4 + motion. Home grid, dashboard view (sandboxed iframe), builder chat, settings
src/shared/      types, zod schemas, IPC channel names, model catalog
resources/libs/  echarts, chart.js, d3 copied from node_modules at build time; served at dash://libs/
```

The agent core in `src/main/agent` does not import Electron. Preview rendering and secret storage are injected, so the harness can be smoke-tested from Node with `npm run smoke`.

## Tools available to the agent

| Tool | What it does | Produces dataset |
|---|---|---|
| Composio meta tools (via session MCP) | search, connect, and run any of 1,600+ app toolkits | yes |
| User MCP servers | any stdio or HTTP MCP server the user adds in Settings | yes |
| `run_sql` | DuckDB SQL over any dataset (datasets are tables) | yes |
| `read_local_file` | CSV, JSON, Excel, Parquet, SQLite from the user's disk | yes |
| `read_granola` | meetings and notes from the local Granola cache | yes |
| `http_get` | public JSON/CSV endpoints | yes |
| `write_dashboard` | write index.html | no |
| `preview_dashboard` | render with current data, return screenshot + console errors | no |
| `publish_data` | choose the datasets the dashboard reads; writes data.json + recipe.json | no |

Large tool results never go into the model context. The harness stores them as datasets and returns a preview: row count, inferred columns, first rows.

## Models

Settings keep a build model (default `gpt-6.1-sol`), a refresh/heal model (default `gpt-6-luna`), and reasoning effort for each. The picker lists every model the key can see, with the recommended ones pinned.

## Security

- Renderer: `contextIsolation`, `sandbox`, no node integration, strict CSP, navigation blocked.
- Dashboards render in an `<iframe sandbox="allow-scripts">` at `dash://dashboards/<id>/index.html`; scripts only from `dash:`, no network except images and fonts over https. The viewer (`DashFrame`) is double-buffered: a new version loads hidden (`?staged=1`) and is revealed in place once it reports ready, so edits and builds never flash.
- Every build, edit, repair and refresh is metered in credits (`shared/pricing.ts`) and logged locally (`usage.jsonl`); MyDashie Cloud builds report it to the account.
- End-user API keys are encrypted with Electron `safeStorage` (Keychain on macOS).
- Local file reads are limited to the user's home directory and every call is shown in the activity feed.
- No shell tool.
