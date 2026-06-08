import { promises as fs } from 'fs';
import path from 'path';
import type { Request, Response } from 'express';

const OLLAMA_URL = 'http://192.168.10.182:11436/api/generate';
const OLLAMA_MODEL = 'llama3.2';

const VALID_STRATEGIES = ['balanced', 'containment', 'firewall-first', 'patrol'];
const VALID_RANKS = ['senior', 'mid', 'junior'];
const VALID_ACTIONS = [
  'containServerNeighbor', 'interceptEnemy', 'suppressHottest', 'repairWeakest',
  'deployFirewallGuard', 'hardenNode', 'rebootNode', 'patrol', 'idle',
  'recruitMid', 'recruitJunior', 'clearPathTo',
];

export async function handleStrategyRequest(req: Request, res: Response): Promise<void> {
  const snap = req.body || {};
  const prompt =
    `You are a network defense AI. Choose exactly one strategy word from: ${VALID_STRATEGIES.join(', ')}.\n` +
    `Game state: wave=${snap.wave}, serverHp=${snap.serverHp}, enemies=${snap.enemies}, ` +
    `infected=${snap.infected}, critical=${snap.critical}, avgInfection=${snap.avgInfection?.toFixed(3)}.\n` +
    'Reply with only the strategy word, nothing else.';

  try {
    const upstream = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: AbortSignal.timeout(4000),
    });
    if (!upstream.ok) throw new Error(`ollama ${upstream.status}`);
    const data = await upstream.json() as { response?: string };
    const text = (data.response || '').trim().toLowerCase();
    const rule = VALID_STRATEGIES.find((candidate) => text.includes(candidate)) ?? 'balanced';
    res.json({ rule });
  } catch (error: any) {
    res.status(502).json({ error: error.message });
  }
}

export async function handleRuleUpdate(projectRoot: string, req: Request, res: Response): Promise<void> {
  const { rank, snapshot, currentRules } = req.body || {};
  if (!VALID_RANKS.includes(rank)) {
    res.status(400).json({ error: 'invalid rank' });
    return;
  }

  const prompt =
    `You are optimizing AI agent rules for a network defense game.\n` +
    `Agent rank: "${rank}"\n` +
    `Game state: wave=${snapshot.wave}, serverHp=${snapshot.serverHp}, ` +
    `enemies=${snapshot.enemies}, infected=${snapshot.infected}, ` +
    `avgInfection=${snapshot.avgInfection?.toFixed(3)}, credits=${snapshot.credits}, rule=${snapshot.rule}\n\n` +
    `Current rules:\n${JSON.stringify(currentRules, null, 2)}\n\n` +
    `Available actions: ${VALID_ACTIONS.join(', ')}\n` +
    'Condition variables: hottestInfection(0-1), avgInfection(0-1), serverHp(0-120), ' +
    'serverNeighborMaxInfection(0-1), enemyCount, infectedCount, firewallCount, ' +
    'gameRule(string), wave, credits, seniorCount, midCount, juniorCount\n\n' +
    'Output ONLY a JSON array of rules. Each rule: {"id":"...","when":"<JS expr or omit>","action":"<action>"}\n' +
    'Adapt the rules to the current game state. Output nothing but the JSON array.';

  try {
    const upstream = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) throw new Error(`ollama ${upstream.status}`);
    const data = await upstream.json() as { response?: string };
    const text = (data.response || '').trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('no JSON array in response');
    const rules = JSON.parse(match[0]);
    if (!Array.isArray(rules) || !rules.length) throw new Error('empty rules');
    for (const rule of rules) {
      if (!VALID_ACTIONS.includes(rule.action)) throw new Error(`unknown action: ${rule.action}`);
    }

    const filePath = path.join(projectRoot, 'agent_rules', `${rank}.json`);
    const existing = JSON.parse(await fs.readFile(filePath, 'utf8').catch(() => '{}'));
    await fs.writeFile(
      filePath,
      JSON.stringify({ ...existing, rules, updatedAt: new Date().toISOString(), updatedBy: 'ollama' }, null, 2)
    );
    res.json({ ok: true, rank, ruleCount: rules.length });
  } catch (error: any) {
    res.status(502).json({ error: error.message });
  }
}
