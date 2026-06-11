# Repository Guidelines

## Project Structure & Module Organization
This repository is an Electron-based sandbox for watchable AI-driven games and simulations. Main entrypoints are `main.ts`, `server.ts`, and `server_ollama.ts`; browser apps live in `apps/` and compile into `build/`. Active app modules include `apps/colony/`, `apps/network-defense/`, `apps/network-ecosystem/`, `apps/escort-td/`, and `apps/planet-strategy/`. Shared browser utilities and type definitions live in `shared/` and `shared/types/`. Server-side game logic is in `game/`, static assets are in `assets/` and `public/`, and design notes or plans belong in `docs/`.

## Build, Test, and Development Commands
Use `npm run build` to compile browser bundles with Vite and Node/Electron entrypoints with `tsc`. Use `npm run typecheck` to run both TypeScript projects without emitting files. Use `npm start` to rebuild and launch the Electron shell. For targeted manual checks, keep helper scripts in `scripts/`; current examples include `scripts/test_colony_api.ps1` and `scripts/electron_smoke.ts`.

## Coding Style & Naming Conventions
Write new runtime code in TypeScript only; do not add new browser-side `.js` files under `apps/` or `shared/`. Follow the existing style: 2-space indentation in front-end modules, `snake_case` filenames such as `planet_strategy_render.ts`, and descriptive exported symbols grouped by feature. Keep modules narrowly scoped, and split rendering, UI, telemetry, and simulation logic instead of growing one large file.

## Testing Guidelines
This repo currently relies more on type safety and manual smoke checks than on a full automated test suite. At minimum, run `npm run typecheck` before submitting changes. When touching a specific experience, add or update a focused verification script under `scripts/` and describe how to exercise the feature locally. Name ad hoc test helpers after the target area, for example `test_colony_api.ps1`.

## Commit & Pull Request Guidelines
Recent history uses imperative, descriptive subjects such as `Migrate browser game modules to TypeScript` and `Improve planet strategy visuals and fix Electron page loading`. Keep commit titles concise, specific, and scoped to one logical change. Pull requests should explain the affected app or subsystem, summarize visible behavior changes, link related docs or issues, and include screenshots or short recordings for UI-facing updates.

## Architecture Notes
Optimize for watchability: clear state, visible motion, low-friction observation, and occasional human intervention. Prefer changes that improve what a person can understand on screen over purely internal cleanup.
