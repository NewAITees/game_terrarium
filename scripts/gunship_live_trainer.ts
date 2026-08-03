import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AIRFRAMES, type AirframeId } from '../apps/gunship/gunship_airframes.js';
import { GunshipAgent, type GunshipAgentSave } from '../apps/gunship/gunship_rl.js';
import { runEpisode } from './gunship_headless_sim.js';

type LiveModels = { version: 1; revision: number; publishedAt: string; models: Partial<Record<AirframeId, GunshipAgentSave>> };
const modelPath = join(process.cwd(), 'logs', 'gunship-live-models.json');
const resetPath = join(process.cwd(), 'logs', 'gunship-live-models.reset');
const args = new Map(process.argv.slice(2).map((token) => { const [key, value = ''] = token.replace(/^--/, '').split('='); return [key, value]; }));
const batch = Math.max(1, Number(args.get('batch') ?? 100));
const cap = Math.max(1, Number(args.get('cap') ?? 120));
const density = Math.max(1, Number(args.get('density') ?? 1));
const batches = Math.max(0, Number(args.get('batches') ?? Number.POSITIVE_INFINITY));

async function load(): Promise<LiveModels> { try { const value = JSON.parse(await readFile(modelPath, 'utf8')) as LiveModels; if (value?.version === 1 && value.models) return value; } catch { /* First training run. */ } return { version: 1, revision: 0, publishedAt: new Date(0).toISOString(), models: {} }; }
async function consumeReset(): Promise<boolean> { try { await readFile(resetPath); await unlink(resetPath); return true; } catch { return false; } }
async function publish(value: LiveModels): Promise<void> { await mkdir(join(process.cwd(), 'logs'), { recursive: true }); const next = { ...value, revision: value.revision + 1, publishedAt: new Date().toISOString() }; const temp = `${modelPath}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(next), 'utf8'); await rename(temp, modelPath); Object.assign(value, next); }
async function main(): Promise<void> { const models = await load(); const agents = new Map<AirframeId, GunshipAgent>(); for (const frame of AIRFRAMES) { const agent = new GunshipAgent(); const save = models.models[frame.id]; if (save) agent.restore(save); agents.set(frame.id, agent); } console.log(`gunship trainer: batch=${batch}, cap=${cap}s, models=${models.revision}`); for (let completed = 0; completed < batches; completed += 1) { if (await consumeReset()) { models.models = {}; models.revision = 0; for (const frame of AIRFRAMES) agents.set(frame.id, new GunshipAgent()); console.log('learning reset accepted'); } for (const frame of AIRFRAMES) { const agent = agents.get(frame.id)!; for (let episode = 0; episode < batch; episode += 1) runEpisode(agent, frame.id, cap, density); models.models[frame.id] = agent.serialize(); } await publish(models); console.log(`published model r${models.revision} (${models.publishedAt})`); } }
void main();