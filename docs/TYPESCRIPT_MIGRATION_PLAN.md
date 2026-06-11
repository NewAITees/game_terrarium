# TypeScript Migration Plan

## Current Status

As of 2026-06-09, the migration direction in this document is largely realized for the active browser apps.

- `planet_strategy`, `network_defense`, and `colony` are already TypeScript-first in `apps/`
- shared domain contracts already exist in `shared/types/`
- regular verification now includes `npm run typecheck`

Because of that, the remaining value of this document is:

- explain the migration rationale
- record the phased approach that was taken
- clarify what still remains for older pages and future modules

## Goal

This repository is growing into a multi-game sandbox with:

- multiple AI-operated simulations
- several independently evolving frontends
- shared ideas such as telemetry, HUDs, routes, ships, worlds, and AI state
- parallel edits by more than one AI and by a human

Because of that, the long-term direction for this repository is:

**Move the project toward TypeScript as the default language for browser/game code.**

This is not only a tooling choice. It is a quality and collaboration choice.

## Why Migrate

TypeScript is useful in this repository for concrete reasons:

1. It reduces accidental breakage when world/state objects evolve.
2. It makes module boundaries clearer between simulation, render, UI, and telemetry.
3. It helps multiple AIs edit the same project with fewer silent shape mismatches.
4. It makes large files safer to split because imports, exports, and data contracts become explicit.
5. It gives a path to shared game data models across multiple sandbox experiments.

In this repository, the most important value is not “strict typing” by itself.
The real value is:

- safer refactors
- clearer contracts
- earlier detection of state bugs
- lower coordination cost across files and contributors

## Scope

This migration plan targets JavaScript game/runtime code first.

Primary candidates:

- `planet_strategy*`
- `network_defense*`
- `colony*`
- browser-side telemetry helpers
- page-level UI modules
- simulation and AI strategy modules

Lower priority:

- one-off scripts
- temporary experiments
- small glue code that may be removed soon

## Migration Principles

### 1. Do not rewrite the whole repository at once

A full rewrite is high-risk and low-leverage.

Instead:

- keep the project running at all times
- migrate one game area at a time
- preserve working behavior while improving structure

### 2. New work should prefer TypeScript

From the point this plan is adopted:

- new substantial frontend/game modules should prefer `.ts`
- new data-heavy modules should prefer `.ts`
- new shared contracts should be defined in typed modules

Small temporary JS is still acceptable when speed matters, but it should not become the default.

### 3. Migrate split modules before giant files

Files that are already separated by responsibility are the easiest to migrate safely.

Preferred order:

1. render modules
2. UI modules
3. telemetry modules
4. AI strategy modules
5. core simulation entry files

### 4. Define shared types early

The repository should not wait until the end to define core types.

Shared model candidates:

- `Planet`
- `Ship`
- `Empire`
- `Route`
- `World`
- `TelemetrySnapshot`
- `InterventionEvent`

These types should become the backbone of migration.

### 5. Keep migration incremental and verifiable

Each migration step should end in a still-runnable system.

Avoid:

- “convert everything, fix later”
- large mixed commits
- moving many systems at once without checking runtime behavior

## Recommended Repository Direction

## Default Direction

The repository should become:

- **TypeScript-first for browser/game logic**
- still compatible with existing JS during transition

This means a temporary mixed state is acceptable:

- existing `.js`
- migrated `.ts`
- shared type files

That mixed state is expected and normal during migration.

## Build Direction

The repository should eventually have:

- `tsconfig.json`
- a clear output convention for browser-loadable files
- type-checking in regular development flow

The exact bundler choice can be delayed.
The first priority is typed structure, not build sophistication.

## Phased Plan

## Phase 0 — Policy And Preparation

Objective:

- decide that TypeScript is the long-term default
- document the migration rules
- avoid accidental new sprawl in raw JS

Tasks:

- add this migration plan
- define which game areas are active
- agree that new major frontend/game modules should prefer TS

Exit condition:

- the repository has an explicit migration direction

## Phase 1 — Shared Contracts

Status: substantially complete for active sandboxes.

Objective:

- define reusable domain types before broad migration

Tasks:

- create shared type definitions for:
  - planets
  - ships
  - empires
  - routes
  - world snapshots
  - telemetry payloads
- standardize nullable fields and enum-like status values

Why this phase matters:

Many current bugs in this repository come from object shape drift and optional state.
Shared contracts reduce that immediately.

Exit condition:

- core game data models exist in typed form

## Phase 2 — Planet Strategy First

Status: complete for the active `apps/planet-strategy/` modules.

Objective:

- use `planet_strategy` as the first full migration target

Why first:

- it is already split across render/UI/telemetry/AI modules
- it is the most structurally complex active game
- it benefits strongly from state typing
- it is likely to keep growing

Suggested order:

1. `planet_strategy_render.js` -> `.ts`
2. `planet_strategy_ui.js` -> `.ts`
3. `planet_strategy_telemetry.js` -> `.ts`
4. `planet_strategy_ai_*.js` -> `.ts`
5. `planet_strategy.js` -> `.ts`

Key types needed early:

- `PlanetStrategyWorld`
- `PlanetStrategyShip`
- `PlanetStrategyEmpire`
- `PlanetStrategyRoute`
- `PlanetStrategySummary`

Exit condition:

- `planet_strategy` runs with typed modules and typed shared models

## Phase 3 — Observer / Network Defense

Status: complete for the active `apps/network-defense/` modules.

Objective:

- migrate `network_defense` and `network_defense_observer`

Suggested order:

1. observer UI/personality/event modules
2. observer entrypoint
3. classic entrypoint if still important

Why after planet strategy:

- its contracts are simpler
- lessons from planet strategy typing will transfer directly

Exit condition:

- observer-side modules are typed and safer for parallel edits

## Phase 4 — Colony And Other Sandboxes

Status: `colony` is migrated; older standalone pages remain lower priority.

Objective:

- migrate the remaining active sandboxes in order of ongoing use

Suggested prioritization:

1. `colony.js`
2. any page with telemetry + AI state + render state
3. older experiments that are still being touched

Exit condition:

- the actively developed games are TypeScript-first

## Phase 5 — Tooling And Enforcement

Status: partially complete.

Objective:

- make TS the normal path, not just an optional layer

Tasks:

- add type-check command to regular workflow
- update project docs
- prefer TS in new modules by default
- eventually reduce creation of new raw JS gameplay modules

Exit condition:

- TypeScript is the default expectation for new game/runtime code

## Coexistence Rules During Migration

During mixed JS/TS operation:

1. Do not migrate unrelated files just because they are nearby.
2. Keep commits scoped to one migration unit.
3. Prefer typed wrappers over giant rewrites.
4. If a module is split for parallel editing, migrate the split files first.
5. Shared model changes should be reflected in types immediately.

## Suggested Commit Strategy

Use small commits such as:

- `docs: add typescript migration plan`
- `feat: add shared planet strategy types`
- `refactor: migrate planet strategy render to typescript`
- `refactor: migrate planet strategy ui to typescript`
- `refactor: migrate observer modules to typescript`

Avoid commits that mix:

- type migration
- gameplay redesign
- visual redesign

unless there is a direct reason they must move together.

## Quality Rules For TS Migration

Each migration step should aim for:

- explicit object shapes
- explicit status unions where practical
- minimal `any`
- fewer “optional by accident” fields
- preserved runtime behavior

If a migration requires too many unknowns, split it smaller.

## Risks

### Risk 1 — Half-migrated confusion

If the repository mixes styles without rules, confusion increases.

Mitigation:

- document conventions
- migrate by module boundary
- define shared types early

### Risk 2 — Build complexity before design stability

If tooling grows too early, effort is wasted.

Mitigation:

- start with simple type structure
- delay sophisticated bundling choices

### Risk 3 — Big-bang rewrite temptation

A full rewrite would likely stall active development.

Mitigation:

- preserve working games
- migrate active systems incrementally

## Immediate Next Steps

Recommended next actions:

1. Keep new browser/game modules TypeScript-first
2. Continue moving any actively touched legacy `pages/` code to typed modules when it becomes worth it
3. Tighten contracts in `shared/types/` when runtime shapes evolve
4. Reduce accidental `any` usage in hot paths
5. Keep `typecheck` in the normal verification flow

## Final Recommendation

For this repository as a whole:

- **Yes, move toward TypeScript across the project**
- **No, do not do it as a one-shot rewrite**
- **Use the already-migrated active apps as the baseline for future work**

That path gives the quality benefits of TypeScript without freezing the project.
