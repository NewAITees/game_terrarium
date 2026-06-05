# Next Game Options

## Purpose

This memo compares the two most promising directions for the next step of `game_terrarium`.

1. Upgrade `network_defense` into a stronger AI observation game
2. Build a new `AIコロニー箱庭` simulation from scratch

The goal is not to choose the most traditional game. The goal is to choose the direction that best supports:

- idle observation
- visible AI decision-making
- ongoing movement and change
- moderate randomness
- occasional human intervention
- practical long-running operation

## Current Asset Review

`network_defense` already has important foundations:

- AI-driven strategy switching through Ollama
- per-rank agent rules
- event log and HUD
- manual player intervention
- wave progression
- telemetry reporting
- a readable visual network space

Because of this, `network_defense` is already close to the project's target form.

## Option A: Upgrade `network_defense`

### Why It Fits

This option is the shortest path to a real observation game.

The current game already produces:

- visible movement
- rule changes
- local emergencies
- changing pressure around the server

What it lacks is not a base system. What it lacks is stronger long-term variation and clearer "AI personality" that makes watching more interesting over time.

### Recommended Upgrade Areas

#### 1. AI personality and faction flavor

Current agents are rank-based, but they are still mostly functional units.

Add:

- personality tags such as `aggressive`, `frugal`, `repair-first`, `expansionist`
- different preference weights per run
- visible labels in HUD and logs
- different Ollama prompts or rule seeds per personality

Result:

- runs become easier to compare
- the user can watch style differences, not only win/loss

#### 2. Environment changes over time

Current waves escalate, but the environment itself is mostly stable.

Add:

- temporary unstable nodes
- periodic topology rewiring
- sectors with buffs or debuffs
- random blackouts, surges, or signal storms

Result:

- the game becomes less solved
- the viewer gets ongoing surprises without needing manual input

#### 3. Observation-first UI

Current HUD is useful, but still focused on game status.

Add:

- current AI intent per rank
- top 3 danger zones
- personality display
- trend indicators such as infection rising/falling
- event summaries instead of only raw logs

Result:

- the system is easier to read from a distance
- the project gets closer to "watchable toy" rather than "debug scene"

#### 4. Low-attention mode

Current rendering and telemetry are always active.

Add:

- reduced update mode when the user is not interacting
- optional slower simulation speed
- burst logging only for important events
- simplified effects mode

Result:

- better alignment with the idle goal
- lower chance of the PC running hotter than necessary

#### 5. Meta progression between runs

Current runs are isolated.

Add:

- saved agent archetypes
- mutation of rule sets after each run
- run comparison summary
- "best weird run" snapshots

Result:

- the project becomes a machine for discovering combinations, not just replaying one defense scenario

### Smallest Useful Implementation

If this route is chosen, the smallest meaningful milestone is:

1. Add AI personality presets
2. Add a HUD section showing active intent and personality
3. Add 2 to 3 random environment events
4. Add a lower-load observation mode

This is enough to change the game from "defense prototype" into "AI observation prototype."

## Option B: Build `AIコロニー箱庭`

### Why It Fits

This option fits the project goal extremely well in theory.

A colony sandbox naturally supports:

- emergent behavior
- multiple simultaneous actors
- long observation sessions
- visible chain reactions
- human intervention through world events

It is likely a better long-term form for this project than tower defense.

### Core Simulation Idea

A minimal colony sandbox would contain:

- a map with regions or cells
- multiple AI factions
- resources
- expansion and conflict
- simple unit production
- random world events
- visible state changes over time

The human does not micromanage units. The human mainly watches, then occasionally changes the world.

### Recommended Minimal Feature Set

#### 1. Factions with behavioral bias

Each faction should have a simple style:

- hoarder
- raider
- builder
- opportunist

This is more important than deep combat rules at first.

#### 2. Resource pressure

The sandbox needs scarcity, otherwise the world becomes flat.

Use:

- food/energy/material
- local depletion
- territorial competition

#### 3. Legible world map

The first version should optimize readability.

Use:

- colored territories
- moving units or pulses
- highlighted conflict zones
- short event summaries

#### 4. Human world interventions

The viewer should be able to trigger:

- storm
- bonus resource drop
- new neutral camp
- sudden invasion

That is enough for "occasional touch" without turning it into micromanagement.

### Smallest Useful Implementation

If this route is chosen, the smallest meaningful milestone is:

1. Generate a simple map
2. Spawn 3 factions with different behavioral weights
3. Let them gather, expand, and clash
4. Visualize borders, movement, and alerts
5. Add 2 manual world events

This would be enough to test whether colony-style observation is more fun than defense-style observation.

## Direct Comparison

### Project fit

- `network_defense`: strong fit now
- `AIコロニー箱庭`: stronger long-term fit

### Development cost

- `network_defense`: lower
- `AIコロニー箱庭`: higher

### Reuse of current assets

- `network_defense`: very high
- `AIコロニー箱庭`: low to medium

### Chance of fast improvement in watchability

- `network_defense`: high
- `AIコロニー箱庭`: medium

### Chance of long-term emergent variety

- `network_defense`: medium
- `AIコロニー箱庭`: high

## Recommendation

The best sequence is:

1. First, upgrade `network_defense` into a clearer AI observation game
2. Use that work to learn what kinds of AI behavior are fun to watch
3. Then build `AIコロニー箱庭` using those lessons

This order is better than starting from scratch immediately because the current repository already contains the hard part: a working loop with AI, visuals, and intervention.

## Proposed Implementation Order

### Phase 1: `network_defense` observation upgrade

- Add personality presets and visible AI intent
- Add random environment events
- Add low-attention observation mode
- Add run summary/comparison output

### Phase 2: Extract reusable patterns

- identify which telemetry matters
- identify which visual signals are easiest to read
- identify which random events produce interesting outcomes

### Phase 3: Build `AIコロニー箱庭`

- start with a readable territory simulation
- reuse the observation UI ideas from `network_defense`
- reuse the intervention model

## Working Decision

If only one next step is chosen now, choose:

`network_defense` improvement first.

If the project wants the highest long-term ceiling after that, move next to:

`AIコロニー箱庭`.
