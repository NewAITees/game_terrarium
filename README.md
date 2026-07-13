# game_terrarium

## Overview

`game_terrarium` is a project for exploring combinations of AI-driven game behavior that are enjoyable to watch as a mostly idle experience.

The core idea is:

- Let AI design, play, or operate games and simulations
- Let a human mostly observe the outcomes as a "leave it running and watch" experience
- Allow occasional manual intervention when it makes the experience more interesting
- Search for combinations that produce movement, variation, visibility, and surprising behavior

This README is written for AI agents working in this repository so they can align implementation decisions with the project's actual goal.

## Main Goal

The main goal of this project is not only to build a game.

The main goal is to experiment with combinations such as:

- AI model choice
- Game genre
- Rules and objectives
- Simulation structure
- Visualization style
- Human intervention level

and discover which combinations are fun for the project owner to watch, leave running, and occasionally interact with.

## What Should Be Explored

AI agents in this repository should treat the following as valid exploration targets:

- Existing games played by AI
- Small games or simulations created by AI
- Hybrid systems where AI both helps build the game and operates it afterward
- Genres such as RTS, RPG, SLG, TD, and other simulation-friendly forms
- Systems similar in spirit to idle simulations, life-game-like behavior, emergent sandboxes, or auto-battling environments

## Desired Experience

The target experience is a mostly idle, watchable system.

Important qualities:

- It should be visually understandable without relying only on text logs
- It should keep producing movement or change over time
- It should include some randomness or unpredictability
- It should be interesting to observe even when the human is not actively controlling it
- It should allow occasional human input without requiring constant attention
- It should avoid unnecessary constant heavy output that keeps the PC too hot

## Role Of AI

AI in this project may be used in two major ways:

1. As a builder that creates or modifies the game/simulation
2. As a player/operator that makes decisions inside the running system

Both roles are in scope. Agents should not assume that only one of them matters.

## Role Of The Human

The human is primarily an observer who enjoys watching the system run.

The human may also:

- Start or stop experiments
- Change parameters
- Intervene manually from time to time
- Judge whether a result is actually interesting or boring

Final evaluation of "fun" belongs to the human, not the AI.

## Repository Layout

- `main.js`, `server.js`, `package.json`: Electron and Express entry points
- `apps/`: browser-served interactive experiences grouped by feature
- `pages/`: Electron-loaded standalone visualization pages
- `shared/`: shared browser modules such as telemetry and network helpers
- `shared/types/`: TypeScript domain contracts and browser/module shims
- `game/`: server-side game engine code
- `agent_rules/`, `faction_rules/`, `assets/`: runtime data and art assets
- `docs/`: planning notes and design documents
- `scripts/`: helper scripts for manual testing

## Ctrl Number Registry

`shared/page_registry.ts` is the source of truth for which `Ctrl` number opens which game.

- `Ctrl+0` - AI Planet Strategy
- `Ctrl+1` - City Traffic
- `Ctrl+2` - MOSS
- `Ctrl+3` - Escort TD
- `Ctrl+4` - Network Small World
- `Ctrl+5` - Submarine Cables
- `Ctrl+6` - Submarine Network 3D
- `Ctrl+7` - Network Tower Defense
- `Ctrl+8` - Network Ecosystem
- `Ctrl+9` - AI Colony Sandbox

## TypeScript

- **New browser-side files must be `.ts`.** Do not create new `.js` files under `apps/` or `shared/`.
- `npm run build`: compile `.ts` sources into `build/`
- `npm run typecheck`: type-check without emitting
- `npm start` runs `prestart` so JS is rebuilt before Electron launches
- Add new app dirs to `tsconfig.json` include and serve compiled output from `build/` in `server.js`
- Do not keep source-adjacent emitted `.js` files

## Design Implications For Agents

When making changes, prefer directions that support the main goal:

- Improve watchability
- Improve clarity of on-screen state
- Make AI behavior easier to observe
- Preserve or increase meaningful variation
- Support low-attention enjoyment
- Keep the system practical to run for longer sessions

Avoid changes that optimize only for technical neatness while reducing the playful observational value of the project.

## Non-Goals

The project does not need to become:

- A purely text-based AI demo
- A system that requires constant human micromanagement
- A benchmark whose only purpose is efficiency
- A perfectly deterministic simulation with no surprising outcomes

## Working Definition Of Success

An experiment is successful when it creates a system that the project owner actually enjoys watching, leaving on, and occasionally touching because the AI-driven behavior is visible, varied, and interesting.
