import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { specHash, type ExperimentSpec } from '../../shared/rl/experiment_spec.js';
import { digestLedger, type LedgerDigest } from './ledger_digest.js';
import { askForProposals, resolveBackend } from './proposal_client.js';
import { parseProposals, type Proposal } from './proposal_schema.js';
import { resolveAdapter } from './research_adapters.js';
import { ResearchLedger } from './research_ledger.js';
import { verifyContract } from './research_contract.js';

/**
 * The outer loop: hand a model what the search has learned so far and let it say what to try next.
 *
 * The inner loop (`auto_research.ts`) samples around the champion and cannot invent a hypothesis —
 * it can only reach combinations the game already declares. This is where new ideas come from, and
 * where they stop: proposals inside the declared space are queued for unattended execution;
 * proposals outside it are written up for a person or a coding agent, never applied here.
 */

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const gameId = args.get('game') || 'gunship';
const ledgerPath = resolve(args.get('ledger') || `logs/rl-research/${gameId}.jsonl`);
const queuePath = resolve(args.get('queue') || `logs/rl-research/${gameId}.queue.jsonl`);
const proposalsPath = resolve(args.get('proposals') || `logs/rl-research/${gameId}.extensions.md`);
const dryRun = args.has('dry-run');

async function main(): Promise<void> {
  const adapter = resolveAdapter(gameId);
  const violations = verifyContract(adapter);
  if (violations.length) {
    console.error('refusing to advise on a search whose contract is broken:');
    for (const violation of violations) console.error(`  [${violation.check}] ${violation.detail}`);
    process.exitCode = 1;
    return;
  }

  const ledger = await ResearchLedger.open(ledgerPath);
  const champion = ledger.champion(gameId, adapter.defaultSpec());
  const baseline = champion?.spec ?? adapter.defaultSpec();
  const digest = digestLedger(gameId, ledger.completed(gameId), adapter.searchSpace, champion);
  const prompt = buildPrompt(digest);

  if (dryRun) {
    console.log(prompt);
    return;
  }

  const backend = resolveBackend({
    backend: args.get('backend'),
    url: args.get('url'),
    model: args.get('model'),
    command: args.get('command'),
  });
  console.log(`asking ${backend.kind === 'ollama' ? `${backend.model} at ${backend.url}` : backend.command} for proposals (${digest.runs} runs on record)`);

  const reply = await askForProposals(backend, prompt, Number(args.get('timeout') ?? 180_000));
  const { accepted, rejected } = parseProposals(reply, adapter.searchSpace, baseline);

  for (const failure of rejected) console.log(`  rejected: ${failure.reason}`);
  if (!accepted.length) {
    console.log('no usable proposals came back');
    return;
  }

  const specs = accepted.filter((proposal): proposal is Extract<Proposal, { kind: 'spec' }> => proposal.kind === 'spec');
  const extensions = accepted.filter((proposal): proposal is Extract<Proposal, { kind: 'extension' }> => proposal.kind === 'extension');

  const queued: ExperimentSpec[] = [];
  for (const proposal of specs) {
    if (ledger.has(proposal.spec)) {
      console.log(`  skipped ${specHash(proposal.spec)}: already measured`);
      continue;
    }
    queued.push(proposal.spec);
    console.log(`  queued ${specHash(proposal.spec)} obs=${proposal.spec.observation} act=${proposal.spec.actions} — ${proposal.rationale.slice(0, 120)}`);
  }
  if (queued.length) {
    await mkdir(dirname(queuePath), { recursive: true });
    await appendFile(queuePath, `${queued.map((spec) => JSON.stringify(spec)).join('\n')}\n`, 'utf8');
    console.log(`${queued.length} spec(s) queued in ${queuePath} — run: npm run research -- --game=${gameId}`);
  }

  if (extensions.length) {
    const written = extensions.map((proposal) => (
      `## ${proposal.target}\n\n${proposal.description}\n\n**Why:** ${proposal.rationale}\n`
    )).join('\n');
    await mkdir(dirname(proposalsPath), { recursive: true });
    const existing = await readFile(proposalsPath, 'utf8').catch(() => '');
    await writeFile(proposalsPath, `${existing}\n# ${new Date().toISOString()}\n\n${written}`, 'utf8');
    console.log(`${extensions.length} extension proposal(s) written to ${proposalsPath} (not applied — these are code changes)`);
  }
}

function buildPrompt(digest: LedgerDigest): string {
  const space = digest.searchSpace;
  return [
    'You propose the next reinforcement-learning experiments for a small game. Reply with JSON objects only, no prose.',
    '',
    'Two proposal kinds are allowed:',
    '  {"kind":"spec","spec":{"observation":"...","actions":"...","reward":{"weights":{...}},"learner":{...}},"rationale":"..."}',
    '     — a configuration inside the declared search space. It will be run automatically.',
    '  {"kind":"extension","target":"<file or concept>","description":"<what to add>","rationale":"..."}',
    '     — something the search space does not yet contain, e.g. a new observation encoding or a new',
    '       action. This is a code change and will be reviewed, not run.',
    '',
    'Rules you must respect:',
    '  - Configurations are scored ONLY on survival time on held-out seeds. Raising a reward weight',
    '    does not raise the score; it only changes what the agent learns to do.',
    '  - You may not set the budget, the seeds, or anything about scoring.',
    '  - Removing a reward weight (setting it to 0) is a legitimate and often good proposal.',
    '  - Behaviour must be learned. Never propose hand-written rules, action priors or seeded values.',
    '',
    `Declared observations: ${space.observations.join(', ')}`,
    `Declared action sets: ${space.actions.join(', ')}`,
    `Tunable reward weights: ${space.rewardWeights.join(', ')}`,
    `Tunable difficulty: ${Object.keys(space.environment).join(', ')} (changing these makes runs incomparable — avoid unless diagnosing)`,
    '',
    `Evidence so far (${digest.runs} completed runs):`,
    JSON.stringify({
      champion: digest.champion,
      observations: digest.observations,
      actions: digest.actions,
      untriedCombinations: digest.untried,
      topRuns: digest.top,
    }, null, 2),
    '',
    'Propose 3 to 6 experiments. Prefer hypotheses the evidence above does not already answer.',
  ].join('\n');
}

void main();
