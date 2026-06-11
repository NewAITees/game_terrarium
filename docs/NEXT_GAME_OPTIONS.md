# Next Game Options

## Status

This memo is no longer a pure "which path should we choose?" comparison.

As of 2026-06-09:

- `network_defense` has already been upgraded into an observation-oriented variant
- `AIコロニー箱庭` already exists as a runnable sandbox
- the remaining question is where the next major iteration should go

## Already Realized Since The Original Memo

### `network_defense`

- rank personality presets are implemented
- observer HUD and hotspot summaries exist
- random observation events such as `signal_storm` exist
- low-load observation mode exists

### `AIコロニー箱庭`

- colony sandbox app exists under `apps/colony/`
- faction personalities are implemented
- intervention buttons exist: `resource_drop`, `storm`, `invader_wave`, `spawn_neutral`
- telemetry and observation HUD are already wired

Because of that, the old "build colony from scratch vs improve network defense first" framing is outdated.

## Current Comparison

### Option A — Push `network_defense` further

Best when the goal is:

- faster iteration on readable AI behavior
- more event variety per run
- better run-to-run comparison and summaries

Still missing:

- richer meta progression between runs
- better run summary / comparison output
- more environmental variation beyond the current event set

### Option B — Push `AIコロニー箱庭` further

Best when the goal is:

- stronger long-term emergence
- more territorial change and sandbox feeling
- deeper "watch society evolve" behavior

Still missing:

- broader event variety
- stronger end-of-run summary
- more obvious faction differentiation on the map over long sessions

## Working Recommendation

The repository no longer needs to choose only one path.

Recommended order now:

1. Keep `network_defense` for short-cycle observation experiments
2. Use `AIコロニー箱庭` for longer-form sandbox iteration
3. Use `planet_strategy` as the heavier logistics / war sandbox track

## Practical Next Steps

- `network_defense`: add run summary and more cross-run comparison
- `colony`: increase event variety and observation readability
- `planet_strategy`: continue the active TODO in `PLANET_TODO.md`
