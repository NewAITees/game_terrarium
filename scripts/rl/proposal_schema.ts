import { validateSpec, type ExperimentSpec, type RlSearchSpace } from '../../shared/rl/experiment_spec.js';

/**
 * The gate every model-written proposal passes through.
 *
 * A proposer is a generator, never a judge. It may say what to try next; it may not say what won,
 * and it may not reach anything the score depends on. Two kinds come back:
 *
 *  - `spec` — inside the declared search space. Fully machine-checkable, so it can be queued and run
 *    unattended: an invented knob or an out-of-range value is rejected here rather than producing a
 *    row that looks like evidence.
 *  - `extension` — outside it: a new observation encoding, a new action, a new reward channel. That
 *    is a code change, so it is recorded as a written proposal for a human or a coding agent to act
 *    on. It is deliberately *not* applied automatically — an unattended loop that edits its own
 *    scoring path has no way left to notice it has broken itself.
 */

export type SpecProposal = { kind: 'spec'; spec: ExperimentSpec; rationale: string };
export type ExtensionProposal = { kind: 'extension'; target: string; description: string; rationale: string };
export type Proposal = SpecProposal | ExtensionProposal;

export type ParseResult = {
  accepted: Proposal[];
  rejected: { reason: string; raw: string }[];
};

export function parseProposals(text: string, space: RlSearchSpace, baseline: ExperimentSpec): ParseResult {
  const accepted: Proposal[] = [];
  const rejected: { reason: string; raw: string }[] = [];
  for (const candidate of extractObjects(text)) {
    const raw = JSON.stringify(candidate).slice(0, 300);
    try {
      accepted.push(coerce(candidate, space, baseline));
    } catch (error) {
      rejected.push({ reason: error instanceof Error ? error.message : String(error), raw });
    }
  }
  return { accepted, rejected };
}

function coerce(value: Record<string, unknown>, space: RlSearchSpace, baseline: ExperimentSpec): Proposal {
  const rationale = typeof value.rationale === 'string' ? value.rationale.slice(0, 500) : '';
  if (value.kind === 'extension') {
    const target = String(value.target ?? '').slice(0, 200);
    const description = String(value.description ?? '').slice(0, 1000);
    if (!target || !description) throw new Error('extension needs target and description');
    return { kind: 'extension', target, description, rationale };
  }
  if (value.kind !== 'spec') throw new Error(`unknown proposal kind '${String(value.kind)}'`);

  // Built from the baseline rather than from the model's object, so a proposal cannot introduce a
  // field the schema does not know about — including anything touching budget or scoring.
  const proposed = (value.spec ?? {}) as Partial<ExperimentSpec>;
  const weights: Record<string, number> = { ...baseline.reward.weights };
  for (const [key, weight] of Object.entries((proposed.reward?.weights ?? {}) as Record<string, unknown>)) {
    if (!space.rewardWeights.includes(key)) throw new Error(`unknown reward weight '${key}'`);
    if (typeof weight !== 'number' || !Number.isFinite(weight)) throw new Error(`reward weight '${key}' is not a finite number`);
    weights[key] = weight;
  }
  const environment: Record<string, number> = { ...baseline.environment };
  for (const [key, level] of Object.entries((proposed.environment ?? {}) as Record<string, unknown>)) {
    if (typeof level !== 'number' || !Number.isFinite(level)) throw new Error(`environment knob '${key}' is not a finite number`);
    environment[key] = level;
  }
  const learner: Record<string, number> = { ...(baseline.learner as Record<string, number>) };
  for (const [key, level] of Object.entries((proposed.learner ?? {}) as Record<string, unknown>)) {
    if (!(key in (baseline.learner as object)) && !LEARNER_KEYS.includes(key)) throw new Error(`unknown learner setting '${key}'`);
    if (typeof level !== 'number' || !Number.isFinite(level)) throw new Error(`learner setting '${key}' is not a finite number`);
    learner[key] = level;
  }
  const proposedMode = proposed.reward?.mode;
  if (proposedMode !== undefined && !space.rewardModes.includes(proposedMode)) {
    throw new Error(`unknown reward mode '${proposedMode}'`);
  }

  const spec: ExperimentSpec = {
    ...baseline,
    observation: typeof proposed.observation === 'string' ? proposed.observation : baseline.observation,
    actions: typeof proposed.actions === 'string' ? proposed.actions : baseline.actions,
    reward: {
      mode: proposedMode
        ? proposedMode
        : baseline.reward.mode,
      weights,
    },
    environment,
    learner,
    // The budget is the searcher's to decide, never the proposer's — otherwise "give my idea ten
    // times the episodes" becomes the easiest way to win.
    budget: baseline.budget,
    diagnostic: value.diagnostic === true ? true : undefined,
  };
  validateSpec(spec, space);
  return { kind: 'spec', spec, rationale };
}

const LEARNER_KEYS = [
  'learningRate', 'discount', 'initialEpsilon', 'minimumEpsilon', 'maximumEpsilon',
  'epsilonDecay', 'episodeEpsilonBoost', 'episodeMaximumEpsilon', 'terminalBlame', 'maximumStates',
];

/** Models wrap JSON in prose and fences, so scan for balanced objects instead of parsing the whole reply. */
function extractObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>;
            if (parsed && typeof parsed === 'object' && 'kind' in parsed) found.push(parsed);
          } catch {
            // Not valid JSON after all; keep scanning from the next brace.
          }
          start = index;
          break;
        }
      }
    }
  }
  return found;
}
