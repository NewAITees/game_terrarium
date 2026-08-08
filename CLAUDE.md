# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules for new browser-side code

- All new source files must be TypeScript (`.ts`). Do not create `.js` files under `apps/` or `shared/`.
- Add new app entry points to **both** `vite.config.ts` `rollupOptions.input` (bundling) and `tsconfig.json` `include` (type checking). Missing either one fails silently in a different way.
- Use **named imports** from Three.js (`import { Mesh, Scene } from 'three'`) — never `import * as THREE`. Named imports enable tree-shaking.
- Use `import type` for type-only imports.

The Node.js side (`main.ts`, `server.ts`) is compiled separately from the browser bundles — `tsc -p tsconfig.node.json` into `build-node/`, while Vite builds `apps/` into `build/`.

## Rule: no hand-authored policy. Behaviour is learned.

**Hand-written rules are banned as a substitute for learning.** Every agent's behaviour must come from the reinforcement learner. Do not add, and do not "improve":

- seeded Q values / initial value tables / action priors — the `initialValues` hook was **removed** from `shared/rl/` for this reason; do not reintroduce it
- `if` ladders that pick actions, override the policy, or nudge it "just in the dangerous case"
- scripted fallbacks that take over when the agent performs badly

**Why this is a hard rule, not a preference.** Gunship shipped with a `seedValues` prior of `1.1 / 0.78 / 0.68`. Those numbers sat above any return the environment could actually pay, so the greedy policy stayed frozen on the hand-written rules and the learned Q values could never overtake them. Measured over 4000 episodes the agent did not merely fail to improve — it *degraded* (13.17s → 5.74s median survival), because the prior was better than anything learning could reach past it. Deleting the prior produced a real learning curve immediately (22.68s → 100.12s, falls 95% → 51%). A prior that looks like competence is the thing preventing competence.

The legitimate levers are the environment and the reward: observation design, action set, reward weights, discount, exploration schedule, difficulty. Change those, then measure.

**Always measure before and after.** `npm run sim:gunship --episodes=6000 --repeats=4`. `--repeats` averages independent agents; a single run's curve is noise and must not be used to justify a change. Reward weights are overridable from the CLI (`--survival`, `--ceiling`, `--kill`, `--density`).

**The automated search: `npm run research -- --candidates=N --episodes=N --repeats=N`.** `scripts/rl/auto_research.ts` proposes configurations, runs them one-per-process across cores, and appends every result to `logs/rl-research/<game>.jsonl`. The ledger is append-only and is the only record a champion is recomputed from; a restart resumes from it. Budget is counted in **episodes, never wall time** — a configuration that survives longer takes longer to evaluate (the best gunship variant costs 6× the wall clock of the worst), so time-based halving prunes exactly what it should find. Promotion requires the challenger's bootstrap lower bound to clear the champion's median, so a tie goes to the incumbent.

**The outer loop: `npm run research:advise -- --backend=command --command="codex exec -"`.** `scripts/rl/research_advisor.ts` digests the ledger — champion, per-variant results, the overfitting gap, untried combinations — and asks a model what to try next. Ollama (`--backend=ollama --model=…`) or any coding CLI on stdin. Everything it returns passes `parseProposals` first: a proposal is rebuilt from the champion's spec field by field, so it cannot invent a knob, an encoding, or a larger budget. Proposals **inside** the declared space are queued to `<game>.queue.jsonl` and run unattended by `npm run research`; proposals **outside** it are code changes and are written to `<game>.extensions.md` for review, never applied — an unattended loop that edits its own scoring path has no way left to notice it has broken itself. The proposer generates hypotheses; the hold-out comparison remains the only judge.

**What may be edited to widen the search, and what may not.** `scripts/rl/research_contract.ts` names both surfaces and, more importantly, checks the invariants that make results comparable — it runs before every search and a violation aborts the run rather than writing rows that quietly mean nothing. New hypotheses go in the variant tables (`OBSERVATION_FIELDS`, `ACTION_SETS`), the reward channels, and the search-space declaration. The seed split, the promotion statistics, the ledger and the runner's train-then-evaluate ordering are off-limits: changing any of them makes old rows incomparable with new ones, which is worse than a wrong result because it is invisible.

**Three games are wired in: gunship, drone-bastion, arena-shooter.** Adding another is one adapter in `scripts/rl/` plus one line in `research_adapters.ts`; the searcher never changes. What the game itself must supply is a named observation variant set, a named action set, a reward *weight struct* rather than literals scattered through its step function, a task return no weight can reach, and a seed that genuinely varies the world.

**Each game's task return is chosen for its own regime, and that is deliberate.** Gunship agents die early, so seconds survived discriminates. Arena agents also die early but clear waves, so it scores waves plus the remaining hull fraction. Nothing kills the drone-bastion tower inside the cap, so time saturates there and it scores waves plus the tower's remaining condition. Using one score everywhere would rank most configurations equal in at least one game — the first drone-bastion sweep did exactly that, returning 120.0s for all eight candidates.

**The search space is declared by the game, not by the searcher.** `shared/rl/experiment_spec.ts` defines `ExperimentSpec` / `RlGameAdapter`; `scripts/rl/gunship_experiment.ts` is the first implementation. A game declares which observation encodings, action sets, reward weights and difficulty knobs may be varied, and nothing outside that declaration can be proposed. `specHash` deliberately excludes the budget — the same spec trained longer is the same spec with more evidence, which is exactly the case that must not be mistaken for a new one. Varying the observation or action set changes the Q-table's key shape or width, so `GunshipAgentSave` v9 records both and refuses to restore a table built under a different spec. From the CLI: `--observation=full|no-xp|minimal`, `--actions=full|coarse|climb-only`.

**Scoring is separated from the reward on purpose.** `shared/rl/seed_plan.ts` splits training seeds from hold-out seeds (hold-out starts at 1,000,000, and the ranges cannot overlap by construction); `--evaluate` only ever runs hold-out seeds. `stepGunshipCore` returns a `RewardBreakdown` whose `task` channel is the objective and whose other channels are shaping. A change is judged on the hold-out task outcome — never on the shaped return, because every weight in it is a knob the change itself may have turned. The sim prints a `shaping share` for that reason: a rising share means the agent is being paid more for proxies than for the task.

Pre-existing exceptions, not a precedent: `agent_rules/` (network-defense) and `faction_rules/` (colony) are older JSON rule engines that predate the RL work. Do not extend the pattern to new work.

## Architecture

An **Electron desktop app** (`main.ts`) hosting an always-on-top window with switchable visualization pages, plus an Express + WebSocket game server (`server.ts`, port 3000).

Browser apps are bundled by Vite into `build/`. Shared vendor chunks (Three.js etc.) go to `build/_vendor/` and are served by Express under `/_vendor/`.

### Page switching

`shared/page_registry.ts` is the single source of truth for every page (key, label, accelerator, URL). Add new experiences there and every switching route — command palette, tray menu, app menu, keyboard shortcuts, and `POST /electron/action` — picks them up automatically.

The Ctrl+K command palette lives in `preload.ts` and is injected into every page by the main process, so **pages carry no navigation code of their own**. It talks to main over the `terrarium:pages` / `terrarium:switch-page` IPC channels.

Set `ELECTRON_DISABLE_TRAY=1` to skip the tray. Ctrl+Shift+T toggles always-on-top.

### Rule-driven subsystems

- `agent_rules/` — JSON rules for network-defense agents, hot-reloaded at runtime. See `apps/network-defense/CLAUDE.md`.
- `faction_rules/` — JSON rules for colony faction behaviour, served as static files under `/faction_rules/`.

### Roguelike dungeon engine

`game/engine.ts` exposes two deliberately different state views: `getAIState()` omits map coordinates and is what AI callers get, while `getFullState()` includes the map grid and entity positions and is what the WebSocket broadcast sends to `public/index.html`. Keep that split — it is the only thing preventing an AI caller from seeing through walls.

### Submarine cable data

`server.ts` proxies `submarinecablemap.com` under `/submarine-data/:kind` with a 2-hour cache header. The upstream API is rate-limited, so do not bypass the cache.
