# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build TypeScript-generated browser modules into `build/`
npm run build

# Run TypeScript checks without emitting JS
npm run typecheck

# Start the Electron app (also starts the Express server on port 3000)
npm start
```

Browser apps are bundled by **Vite** (`vite.config.ts`) into `build/`. Shared vendor chunks (Three.js etc.) go to `build/_vendor/` and are served by Express under `/_vendor/`. The Node.js side (`main.ts`, `server.ts`) is compiled separately by `tsc -p tsconfig.node.json` into `build-node/`.

**Rules for new browser-side code:**
- All new source files must be TypeScript (`.ts`). Do not create `.js` files under `apps/` or `shared/`.
- Add new app entry points to `vite.config.ts` `rollupOptions.input`.
- Add new app entry points to `tsconfig.json` `include` (for type checking).
- Use **named imports** from Three.js (`import { Mesh, Scene } from 'three'`) — never `import * as THREE`. Named imports enable tree-shaking.
- Use `import type` for type-only imports.

## Rule: no hand-authored policy. Behaviour is learned.

**Hand-written rules are banned as a substitute for learning.** Every agent's behaviour must come from the reinforcement learner. Do not add, and do not "improve":

- seeded Q values / initial value tables / action priors — the `initialValues` hook was **removed** from `shared/rl/` for this reason; do not reintroduce it
- `if` ladders that pick actions, override the policy, or nudge it "just in the dangerous case"
- scripted fallbacks that take over when the agent performs badly

**Why this is a hard rule, not a preference.** Gunship shipped with a `seedValues` prior of `1.1 / 0.78 / 0.68`. Those numbers sat above any return the environment could actually pay, so the greedy policy stayed frozen on the hand-written rules and the learned Q values could never overtake them. Measured over 4000 episodes the agent did not merely fail to improve — it *degraded* (13.17s → 5.74s median survival), because the prior was better than anything learning could reach past it. Deleting the prior produced a real learning curve immediately (22.68s → 100.12s, falls 95% → 51%). A prior that looks like competence is the thing preventing competence.

The legitimate levers are the environment and the reward: observation design, action set, reward weights, discount, exploration schedule, difficulty. Change those, then measure.

**Always measure before and after.** `npm run sim:gunship --episodes=6000 --repeats=4`. `--repeats` averages independent agents; a single run's curve is noise and must not be used to justify a change. Reward weights are overridable from the CLI (`--survival`, `--ceiling`, `--kill`, `--density`).

Pre-existing exceptions, not a precedent: `agent_rules/` (network-defense) and `faction_rules/` (colony) are older JSON rule engines that predate the RL work. Do not extend the pattern to new work.

## Architecture

This is an **Electron desktop app** (`main.js`) that hosts an always-on-top window with switchable visualization pages, plus an Express+WebSocket game server.

### Entry points

| File | Role |
|---|---|
| `main.js` | Electron main process; manages the BrowserWindow and page switching |
| `server.js` | Express server (port 3000) + WebSocket; started by main.js |
| `game/engine.ts` | Roguelike dungeon GameEngine class (server-side, Node.js) |
| `shared/network-core.ts` | Shared ES module for Three.js network topology — imported by network visualization pages |
| `shared/telemetry-client.ts` | Thin client-side shim; sets `window.Telemetry.report()`, POSTs to `/telemetry/<page>` |
| `apps/network-defense/network_defense.js` | Network defense game core logic |
| `apps/network-defense/network_defense_ui.js` | UI rendering helpers |
| `apps/network-defense/network_defense_events.js` | Input/event handling |
| `apps/network-defense/network_defense_personality.js` | Agent personality logic |
| `apps/network-defense/network_defense_observer.js` | Observer-mode page logic |
| `apps/colony/colony.js` | Colony sandbox game logic |
| `apps/planet-strategy/planet_strategy.js` | Planet strategy game core |
| `apps/planet-strategy/planet_strategy_render.js` | 3D render helpers |
| `apps/planet-strategy/planet_strategy_ui.js` | UI helpers |
| `apps/planet-strategy/planet_strategy_telemetry.js` | Telemetry integration |
| `apps/planet-strategy/planet_strategy_ai_*.js` | AI faction strategies (industrialist, raider, expansionist, fortifier) |
| `apps/network-ecosystem/network_ecosystem.ts` | Network ecosystem visualization logic |

### Directory layout

- `apps/` — browser-served experiences grouped by feature (`colony`, `network-defense`, `network-ecosystem`, `planet-strategy`)
- `pages/` — standalone Electron-loaded HTML pages (`city`, `moss`, `network_sw`, submarine views)
- `shared/` — shared browser-side modules
- `game/` — server-side roguelike engine
- `public/` — WebSocket dungeon game client (`index.html`)
- `agent_rules/` — JSON rule files for network-defense agents (`senior.json`, `mid.json`, `junior.json`)
- `faction_rules/` — JSON rule files for colony faction behaviors (`builder.json`, `hoarder.json`, `raider.json`)
- `assets/` — 3D model assets (`ships/`, `structures/`, `kenney_space_kit/`)
- `docs/` — planning and design notes
- `scripts/` — helper scripts for manual testing

### Page switching

`shared/page_registry.ts` is the single source of truth for every page (key, label, accelerator, URL). `main.ts` reads it to build the menus, shortcuts and the switcher. Add new experiences there and every switching route picks them up automatically.

There are four ways to switch:

| Route | How |
|---|---|
| **Command palette** | **Ctrl+K (Cmd+K) from any page.** Type to filter, ↑↓ + Enter, Esc to close |
| Tray menu | Menu-bar icon → pick a page. Works without focusing the window |
| App menu | View menu, radio-checked to the current page |
| Keyboard | Ctrl+0–9 and Ctrl+Shift+0–5 (registered both globally and per-window) |
| HTTP | `POST /electron/action` with `{ type: "switch_page", page: "<key>" }` |

The palette lives in `preload.ts`, injected into every page by the main process — pages carry no navigation code of their own. It talks to main over the `terrarium:pages` / `terrarium:switch-page` IPC channels. Set `ELECTRON_DISABLE_TRAY=1` to skip the tray.

Ctrl+Shift+T toggles always-on-top.

### Game API (roguelike dungeon)

The `GameEngine` exposes two state views:
- `getAIState()` — no map coordinates, intended for AI callers
- `getFullState()` — includes full map grid, entity positions; used by the WebSocket broadcast to `public/index.html`

REST endpoints on `server.js`:

| Endpoint | Description |
|---|---|
| `GET /state` | Returns `getAIState()` |
| `POST /action` | `{ action, ...params }` — processes a game action and broadcasts new state |
| `POST /reset` | Resets the game |

Actions: `move` (dir), `attack` (dir), `pickup`, `use_item` (item), `equip` (item), `descend`. Directions: `north`, `south`, `east`, `west`.

### Network Defense game (`apps/network-defense/`) — Ctrl+7

Served via `http://localhost:3000/` (not file://) because `fetch('./agent_rules/...')` requires HTTP context.

Files: `network_defense.html` (main), `network_defense_observer.html` (spectator view), plus modules `network_defense.js`, `network_defense_ui.js`, `network_defense_events.js`, `network_defense_personality.js`, `network_defense_observer.js`.

A wave-based Three.js network defense game where AI agents patrol and defend a hierarchical network topology (layers: `core → dist → acc → term`, with one terminal node designated as the server).

**Agent rule engine** — behavior is driven by JSON files in `agent_rules/` (`senior.json`, `mid.json`, `junior.json`), hot-reloaded every 5 seconds via `loadAgentRules()`. Each rule has an optional `when` condition (string JS expression or object dict) and an `action`. Rules are evaluated in order; first match wins. The `_when_format` block in each JSON documents available variables and examples.

`when` can be a **string expression** evaluated with `new Function(...)`:
```json
"when": "hottestInfection > 0.3 || serverNeighborMaxInfection > 0.2"
```
or an **object dict** (legacy format):
```json
"when": { "serverNeighborInfection": 0.5, "enemyCount": 1 }
```

Available actions (any rank can execute any action — rank only affects speed/cost/effect multipliers via `RANK_PROFILE`):
`containServerNeighbor`, `interceptEnemy`, `suppressHottest`, `repairWeakest`, `deployFirewallGuard`, `hardenNode`, `rebootNode`, `patrol`, `idle`, `recruitMid`, `recruitJunior`, `clearPathTo`

`callLLM()` in `network_defense.js` calls `POST /api/strategy` on the Express server, which proxies to Ollama (`http://192.168.10.182:11436/api/generate`). The Ollama URL and model are defined as `OLLAMA_URL` / `OLLAMA_MODEL` constants at the top of `server.js`. On timeout or error it falls back to a local heuristic. The response sets `game.rule` (`balanced` / `containment` / `firewall-first` / `patrol`) which `evalCondition` exposes to rules as `gameRule`.

### Colony Sandbox (`apps/colony/`) — Ctrl+9

Served via `http://localhost:3000/colony.html`. Files: `colony.html`, `colony.js`.

Faction behavior is driven by JSON files in `faction_rules/` (`builder.json`, `hoarder.json`, `raider.json`), served as static files under `/faction_rules/`.

REST endpoints:
- `GET /colony/state` — current colony telemetry snapshot
- `POST /colony/intervention` — trigger an event (`resource_drop`, `storm`, `invader_wave`, `spawn_neutral`)

### Planet Strategy (`apps/planet-strategy/`) — Ctrl+0

Served via `http://localhost:3000/planet_strategy.html`. Core: `planet_strategy.js`. Supporting modules: `planet_strategy_render.js` (Three.js scene), `planet_strategy_ui.js` (HUD), `planet_strategy_telemetry.js`. AI factions each have their own file: `planet_strategy_ai_industrialist.js`, `planet_strategy_ai_raider.js`, `planet_strategy_ai_expansionist.js`, `planet_strategy_ai_fortifier.js`.

3D assets served from `assets/ships/` (attacker, defender, miner, transport GLBs) and `assets/structures/` (station, factory, turret, mine_dish, asteroid, crystals GLBs).

### Shared network topology (`shared/network-core.ts`)

ES module (loaded via CDN Three.js import). Key exports:
- `buildTopology(total, seed, mode, rewirePct)` — generates layered tree with optional small-world shortcuts
- `buildScene` / `buildEdges` / `tickEdges` / `buildPackets` / `tickPackets` — Three.js scene helpers
- `findShortestPath` / `findTreePath` — BFS pathfinding with tree fallback

### Submarine cable data

`server.js` proxies `submarinecablemap.com` API under `/submarine-data/:kind` (`cables`, `landings`, `routes`) with a 2-hour cache header.
