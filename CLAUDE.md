# MyDashie

Electron + React + TypeScript desktop app. One job: build HTML dashboards from a prompt and keep them fresh on a schedule. Read `docs/ARCHITECTURE.md` before changing anything structural, and `docs/AGENT.md` before touching the agent; rerun the evals after agent changes.

## Commands

```
npm run dev          # electron-vite dev with HMR
npm run typecheck    # both tsconfigs
npm test             # vitest
npm run libs         # copy echarts/chart.js/d3 into resources/libs
npm run smoke        # run the agent harness headless against real keys in .env
npm run eval -- --suite hard   # agent eval suite (see docs/AGENT.md); costs ~$0.50
npm run package      # DMG (arm64)
```

## Rules

- Dashboard code and dashboard data stay separate. Never make a scheduled refresh call the coding model; refreshes replay `recipe.json`.
- The agent core (`src/main/agent`) must not import `electron`. Inject Electron-dependent capabilities.
- All IPC goes through `src/shared/ipc.ts` channel names and zod schemas. Validate every renderer input in main.
- Keys live in `.env` for development (gitignored) and in `safeStorage` for end users. Never log or print keys.
- For end-to-end UI checks, drive the built app (`npm run build`, then launch `out/main/index.js` with Electron or Playwright's `_electron`). Maintainers with `.claude/skills/electron-drive-skill` installed can use `node .claude/skills/electron-drive-skill/scripts/drive.mjs start --build`. If you have design/engineering skills installed (`frontend-design`, `impeccable`, `animate`, `electron-development`, `composio`, `kpi-dashboard-design`, `dataviz`), use them for the matching work.
- Soft and playful visual language: rounded corners, pastel-tinted surfaces, springy but sparse motion. Light and dark.
