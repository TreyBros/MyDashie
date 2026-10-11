# Contributing

Thanks for helping make MyDashie better.

- **Setup:** `npm install`, then `npm run dev`. Add `OPENAI_API_KEY` (and optionally `COMPOSIO_API_KEY`) to a `.env` for development, or enter them in Settings → AI.
- **Checks before a PR:** `npm run typecheck` and `npm test`. If you touched the agent (`src/main/agent`), run `npm run eval -- --suite hard` and mention the result.
- **Read first:** `docs/ARCHITECTURE.md` (how dashboards, data and refresh recipes fit together) and `docs/AGENT.md` (the agent loop and evals).
- **Style:** match the surrounding code; small focused PRs; one concern per PR. UI should stay soft and playful (see `CLAUDE.md`).
- **Scope:** `src/main/cloud` is the client for MyDashie Cloud accounts; changes there need a discussion issue first.

By contributing you agree your contribution is licensed under the AGPL-3.0, like the rest of the project.
