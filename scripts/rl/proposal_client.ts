import { spawn } from 'node:child_process';

/**
 * How the outer loop reaches a model.
 *
 * Two backends, because the two useful proposers work differently: a local Ollama model answers
 * over HTTP and is cheap enough to run every cycle, while a coding CLI (`codex`, `claude`) can read
 * the repository and is the only one that can propose a change *outside* the declared search space.
 * Neither is trusted — everything either returns goes through `parseProposals` before it can run.
 */

export type ProposalBackend =
  | { kind: 'ollama'; url: string; model: string }
  | { kind: 'command'; command: string; args: readonly string[] };

export type BackendOptions = {
  backend?: string;
  url?: string;
  model?: string;
  command?: string;
  timeoutMs?: number;
};

export function resolveBackend(options: BackendOptions): ProposalBackend {
  const kind = options.backend || 'ollama';
  if (kind === 'ollama') {
    return {
      kind: 'ollama',
      url: options.url || process.env.RL_ADVISOR_URL || 'http://127.0.0.1:11434/api/generate',
      model: options.model || process.env.RL_ADVISOR_MODEL || 'mistral',
    };
  }
  if (kind === 'command') {
    const command = options.command || process.env.RL_ADVISOR_COMMAND;
    if (!command) throw new Error('--backend=command needs --command="<cli> <args>" or RL_ADVISOR_COMMAND');
    const [head, ...rest] = command.split(' ').filter(Boolean);
    return { kind: 'command', command: head, args: rest };
  }
  throw new Error(`unknown proposal backend '${kind}' (have: ollama, command)`);
}

export async function askForProposals(backend: ProposalBackend, prompt: string, timeoutMs = 120_000): Promise<string> {
  return backend.kind === 'ollama' ? askOllama(backend, prompt, timeoutMs) : askCommand(backend, prompt, timeoutMs);
}

async function askOllama(backend: Extract<ProposalBackend, { kind: 'ollama' }>, prompt: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(backend.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: backend.model, prompt, stream: false, options: { temperature: .8 } }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ollama responded ${response.status}`);
    const body = await response.json() as { response?: string };
    return body.response ?? '';
  } finally {
    clearTimeout(timer);
  }
}

function askCommand(backend: Extract<ProposalBackend, { kind: 'command' }>, prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((settle, reject) => {
    const child = spawn(backend.command, [...backend.args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${backend.command} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.stderr.on('data', (chunk) => { err += String(chunk); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(`${backend.command} exited ${code}: ${err.trim().slice(0, 400)}`));
      else settle(out);
    });
    child.stdin.end(prompt);
  });
}
