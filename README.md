<p align="center">
  <img src="resources/brand/dashy.png" width="96" alt="Dashie">
</p>
<h1 align="center">MyDashie</h1>
<p align="center">Dashboards that build and refresh themselves. Describe what you want to see, Dashie connects to your apps, builds it, and keeps it fresh on a schedule.</p>
<p align="center">
  <a href="https://mydashie.com">mydashie.com</a> · <a href="https://mydashie.com/download">Download for Mac</a> · <a href="docs/ARCHITECTURE.md">Architecture</a> · <a href="docs/AGENT.md">The agent</a>
</p>
<p align="center">
  <a href="https://github.com/TreyBros/MyDashie/actions/workflows/ci.yml"><img src="https://github.com/TreyBros/MyDashie/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-6e5ce6" alt="AGPL-3.0"></a>
</p>

---

MyDashie is a macOS app. You type a request like *"weekly engineering dashboard: commits and open PRs per repo, plus my open Jira issues, show me where work is stuck"*. Dashie asks one or two questions, pulls the data from your connected apps, local files or public APIs, writes a real HTML dashboard, checks it renders cleanly, and records exactly how the data was fetched so a schedule can refresh it later **without any AI involved**. Edits only change what you asked for. Questions about a dashboard are answered from its own data.

## Two ways to run it

| | **MyDashie Cloud** | **Self-hosted (this repo)** |
|---|---|---|
| Get it | [Download](https://mydashie.com/download), sign in, done | Build from source |
| Keys | Included; delivered per session, never in the app | Your own OpenAI key (and a Composio key for connected apps) |
| Price | Credits per build / edit / refresh, [plans](https://mydashie.com/pricing) | Free; you pay OpenAI and Composio directly |
| Updates | Offered in the app | `git pull`, rebuild |
| Account | Required | None |

Same app, same code. Self-hosted, the only setup is your two keys.

## Build it yourself

Requirements: macOS 13+, Node 20+, Google Chrome (for the dashboard render tests), an [OpenAI API key](https://platform.openai.com/api-keys). A [Composio](https://platform.composio.dev) key adds 1,600+ connected apps; without it you still get local files (CSV, Excel, JSON, Parquet, SQLite), public APIs and any MCP server you add.

```bash
git clone https://github.com/TreyBros/MyDashie.git
cd mydashie
npm install
npm run dev              # the app, with hot reload; enter your keys in Settings → AI
```

To make an installable app:

```bash
npm run package:community   # → release-community/MyDashie-arm64.dmg and MyDashie-x64.dmg
```

The community build has no sign-in and no baked keys; you enter yours in Settings → AI (they're stored encrypted on your Mac). A `.env` with `OPENAI_API_KEY` / `COMPOSIO_API_KEY` is only a convenience for `npm run dev` and the eval scripts (see `.env.example`).

## Useful commands

```
npm run typecheck        # both tsconfigs
npm test                 # vitest (includes real-Chrome render tests of the dashboard kit)
npm run smoke            # one headless agent run against your keys
npm run eval -- --suite hard   # the agent eval suite (costs about $0.50 in API calls)
```

## Project layout

```
src/main        Electron main process: agent, connectors, scheduler, storage, IPC
src/preload     the bridge the UI talks through
src/renderer    the React UI
src/shared      types, IPC schemas and pricing shared by both sides
resources/      app icon, UI artwork (resources/brand) and the bundled chart libraries + dashboard kit (resources/libs)
scripts/        dev helpers: copy chart libs, headless smoke run, replay a refresh
tests/          vitest unit and render tests
evals/          agent eval suite and its fixtures
docs/           architecture and agent design notes
```

## How it works, briefly

- `src/main/agent` is the agent harness: a tool loop on the OpenAI Responses API with planning, human-in-the-loop questions, DuckDB for shaping data, a stop-hook that refuses to finish on unverified work, and provenance tracking that turns every build into a replayable refresh recipe. [docs/AGENT.md](docs/AGENT.md)
- `resources/libs/dashkit.*` is the small dashboard kit every generated page uses (ECharts underneath): KPIs, charts, tables, tabs, light/dark, chart-to-table toggles.
- `src/main/scheduler` replays recipes on a cron schedule, in parallel, with a cheap repair agent only when a step fails.
- `src/main/cloud` is the thin client MyDashie Cloud builds use for accounts and credits; it stays dormant in self-hosted builds.

## Contributing and license

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). The code is licensed under the [AGPL-3.0](LICENSE). The MyDashie name, the Dashie mascot and the artwork are trademarks of RootBros AI and are not covered by that license; see [TRADEMARKS.md](TRADEMARKS.md).

A [RootBros AI](https://rootbrosai.com) company. Made with ❤️
