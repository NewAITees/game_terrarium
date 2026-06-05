# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build TypeScript-generated browser modules
npm run build

# Run TypeScript checks without emitting JS
npm run typecheck

# Start the Electron app (also starts the Express server on port 3000)
npm start
```

Browser code is still loaded as ES modules in HTML, but `planet_strategy_render`, `planet_strategy_ui`, and `planet_strategy_telemetry` now compile from `.ts` sources to adjacent `.js` files.

## Architecture

This is an **Electron desktop app** (`main.js`) that hosts an always-on-top window with switchable visualization pages, plus an Express+WebSocket game server.

### Entry points

| File | Role |
|---|---|
| `main.js` | Electron main process; manages the BrowserWindow and page switching |
| `server.js` | Express server (port 3000) + WebSocket; started by main.js |
| `game/engine.js` | Roguelike dungeon GameEngine class (server-side, Node.js) |
| `shared/network-core.js` | Shared ES module for Three.js network topology — imported by network visualization pages |
| `shared/telemetry-client.js` | Thin client-side shim; sets `window.Telemetry.report()`, POSTs to `/telemetry/<page>` |
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
| `apps/network-ecosystem/network_ecosystem.js` | Network ecosystem visualization logic |

### Directory layout

- `apps/` — browser-served experiences grouped by feature (`colony`, `network-defense`, `network-ecosystem`, `planet-strategy`)
- `pages/` — standalone Electron-loaded HTML pages (`city`, `moss`, `network_tree`, `network_sw`, submarine views)
- `shared/` — shared browser-side modules
- `game/` — server-side roguelike engine
- `public/` — WebSocket dungeon game client (`index.html`)
- `agent_rules/` — JSON rule files for network-defense agents (`senior.json`, `mid.json`, `junior.json`)
- `faction_rules/` — JSON rule files for colony faction behaviors (`builder.json`, `hoarder.json`, `raider.json`)
- `assets/` — 3D model assets (`ships/`, `structures/`, `kenney_space_kit/`)
- `docs/` — planning and design notes
- `scripts/` — helper scripts for manual testing

### Page switching

`main.js` defines 10 named pages (`city`, `moss`, `net_tree`, `net_sw`, `submarine`, `submarine_3d`, `net_defense`, `net_ecosystem`, `colony`, `planet_strategy`). Standalone pages under `pages/` are loaded as local files via Electron; app pages are served over `http://localhost:3000/`. The server also exposes `POST /electron/action` with `{ type: "switch_page", page: "<key>" }` to switch from the browser side. Keyboard shortcuts Ctrl+1–9, Ctrl+0 and Ctrl+Shift+T (toggle always-on-top) are registered as global shortcuts.

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

### Shared network topology (`shared/network-core.js`)

ES module (loaded via CDN Three.js import). Key exports:
- `buildTopology(total, seed, mode, rewirePct)` — generates layered tree with optional small-world shortcuts
- `buildScene` / `buildEdges` / `tickEdges` / `buildPackets` / `tickPackets` — Three.js scene helpers
- `findShortestPath` / `findTreePath` — BFS pathfinding with tree fallback

### Submarine cable data

`server.js` proxies `submarinecablemap.com` API under `/submarine-data/:kind` (`cables`, `landings`, `routes`) with a 2-hour cache header.
