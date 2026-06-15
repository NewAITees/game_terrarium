# TypeScript Migration Plan

## Current Status

As of 2026-06-15, the active browser-game code is already TypeScript-first.

- `planet_strategy`, `network_defense`, and `colony` are in `apps/` as `.ts` modules
- shared domain contracts live in `shared/types/`
- type-checking is part of normal verification

This document now serves mostly as a record of the migration strategy and the remaining cleanup direction.

## Goal

Move browser/game code toward TypeScript as the default language.

## Why Migrate

TypeScript helps here because it reduces silent shape mismatches, clarifies module boundaries, and makes refactors safer across multiple sandbox experiments.

## Scope

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

## Principles

- Do not rewrite the whole repository at once
- New work should prefer TypeScript
- Split modules are easier to migrate than giant files
- Define shared types early
- Keep changes incremental and verifiable

## Phased Plan

### Phase 1 — Shared Contracts

Status: substantially complete for active sandboxes.

### Phase 2 — Planet Strategy First

Status: complete for the active `apps/planet-strategy/` modules.

### Phase 3 — Observer / Network Defense

Status: complete for the active `apps/network-defense/` modules.

### Phase 4 — Colony And Other Sandboxes

Status: `colony` is migrated; older standalone pages remain lower priority.

### Phase 5 — Tooling And Enforcement

Status: partially complete.

## Coexistence Rules

- Keep commits scoped to one migration unit
- Prefer typed wrappers over giant rewrites
- Shared model changes should be reflected in types immediately

## Immediate Next Steps

1. Keep new browser/game modules TypeScript-first
2. Continue moving any actively touched legacy `pages/` code when needed
3. Tighten contracts in `shared/types/` when runtime shapes evolve
4. Reduce accidental `any` usage in hot paths
5. Keep `typecheck` in the normal verification flow

