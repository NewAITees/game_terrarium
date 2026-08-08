# Network Defense

Served over `http://localhost:3000/` — **not** `file://`. The game fetches `./agent_rules/...` at runtime, which requires an HTTP context.

## Agent rule engine

Behaviour is driven by the JSON files in `agent_rules/`, hot-reloaded every 5 seconds by `loadAgentRules()`. Rules are evaluated in order and the first match wins. Each file's `_when_format` block documents the available variables and the two accepted `when` shapes (string JS expression, or the legacy object dict).

Rank does **not** gate actions — any rank can execute any action. Rank only scales speed/cost/effect through `RANK_PROFILE`.

## LLM strategy call

`callLLM()` posts to `/api/strategy` on the Express server, which proxies to Ollama (`OLLAMA_URL` / `OLLAMA_MODEL` at the top of `server.ts`). On timeout or error it falls back to a local heuristic, so the game never blocks on the model being reachable. The response sets `game.rule`, which `evalCondition` exposes to rules as `gameRule`.

`agent_rules/` predates the RL work and is an explicit, grandfathered exception to the repo-wide "no hand-authored policy" rule in the root `CLAUDE.md`. Do not extend the pattern to new work.
