# Drone Bastion Double DQN evaluation

## Decision

Keep Tabular Q as the shipped policy. Double DQN is functional, and the Minimal DQN condition was
stable in the final pilot, but neither DQN condition cleared the promotion rule of having its 95%
lower bound exceed the incumbent median. Do not extend DQN to another game yet.

## Comparable conditions

All conditions used the same environment training seeds, hold-out seeds, shaped reward, 120-second
episode cap, 13-action set, decision cadence, and upgrade learner. Evaluation disabled exploration
and learning.

1. Minimal observation + Tabular Q
2. Engineered 96-value observation + Double DQN
3. Minimal 96-slot observation + Double DQN

Command:

```text
npm run eval:drone-dqn -- --train=10 --evaluate=8 --cap=120 --seed=424242 --repeats=4
```

| Condition | Median task return | 95% bootstrap interval | Mean |
| --- | ---: | ---: | ---: |
| Tabular Minimal | 5.000 | 4.000–5.000 | 4.254 |
| DQN Engineered | 4.423 | 3.688–5.000 | 3.982 |
| DQN Minimal | 5.000 | 5.000–5.000 | 4.396 |

The result does not show that DQN is intrinsically worse. Earlier smaller pilots sometimes favored
DQN, but that advantage changed with the learner initialization seed and disappeared with more
repeats. The current evidence says that function approximation does not buy a reliable improvement
for the cost and complexity it adds.

## Follow-up threshold

Reopen the DQN comparison only after TD-target variance and state-aliasing diagnostics identify a
specific Tabular limitation. A new DQN candidate must repeat this fixed-seed evaluation and clear
the same confidence-bound promotion rule before it can become Champion or be extended to another
game.
