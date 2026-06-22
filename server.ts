import express from 'express';
import { promises as fs } from 'fs';
import http from 'http';
import path from 'path';
import { pathToFileURL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { mountBrowserAssetRoutes } from './server_assets';
import { handleRuleUpdate, handleStrategyRequest } from './server_ollama';

const PORT = Number.parseInt(process.env.GAME_TERRARIUM_PORT || process.env.PORT || '3000', 10) || 3000;
const telemetry = new Map<string, any>();
const colonyQueue: Array<{ type: string; queuedAt: string }> = [];
const progressPages = ['network_defense', 'network_defense_observer', 'colony', 'planet_strategy'];

const SUBMARINE_ENDPOINTS = {
  cables: 'https://www.submarinecablemap.com/api/v3/cable/all.json',
  landings: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
  routes: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
} as const;

type ElectronDispatch = (type: string, payload: any) => any;

export async function startServer(getElectronState: () => any, electronDispatch: ElectronDispatch): Promise<void> {
  const projectRoot = path.resolve(__dirname, '..');
  const shipJumpLogPath = path.join(projectRoot, 'logs', 'planet_strategy_ship_jumps.log');
  const engineModuleUrl = pathToFileURL(path.join(projectRoot, 'build-node', 'game', 'engine.js')).href;
  const importEngineModule = new Function('moduleUrl', 'return import(moduleUrl);') as (moduleUrl: string) => Promise<any>;
  const { GameEngine } = await importEngineModule(engineModuleUrl);
  const game = new GameEngine();
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json());
  await mountBrowserAssetRoutes(app, projectRoot);

  app.get('/colony/state', (_req, res) => {
    res.json(telemetry.get('colony') || null);
  });

  const validInterventions = ['resource_drop', 'storm', 'invader_wave', 'spawn_neutral'];
  app.post('/colony/intervention', (req, res) => {
    const { type } = req.body || {};
    if (!validInterventions.includes(type)) {
      return res.status(400).json({ error: `unknown type. valid: ${validInterventions.join(', ')}` });
    }
    colonyQueue.push({ type, queuedAt: new Date().toISOString() });
    res.json({ ok: true, queued: colonyQueue.length });
  });

  app.get('/colony/intervention/pending', (_req, res) => {
    res.json(colonyQueue.splice(0));
  });

  app.post('/api/strategy', handleStrategyRequest);
  app.post('/api/update-rules', async (req, res) => {
    await handleRuleUpdate(projectRoot, req, res);
  });

  app.post('/telemetry/:page', (req, res) => {
    const page = req.params.page;
    const snapshot = {
      page,
      updatedAt: new Date().toISOString(),
      data: req.body || {},
    };
    telemetry.set(page, snapshot);
    res.json({ ok: true });
  });

  app.post('/api/ship-jumps', async (req, res) => {
    const { line } = req.body || {};
    if (typeof line !== 'string' || !line.trim()) {
      return res.status(400).json({ error: 'line required' });
    }
    try {
      await fs.mkdir(path.dirname(shipJumpLogPath), { recursive: true });
      await fs.appendFile(shipJumpLogPath, `${line}\n`, 'utf8');
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: `failed to append ship jump log: ${String(error)}` });
    }
  });

  app.get('/api/progress', (_req, res) => {
    res.json({
      items: progressPages.map((page) => {
        const snapshot = telemetry.get(page) || null;
        return {
          page,
          hasData: Boolean(snapshot),
          updatedAt: snapshot?.updatedAt ?? null,
          data: snapshot?.data ?? null,
        };
      }),
    });
  });

  app.get('/api/progress/:page', (req, res) => {
    const page = req.params.page;
    if (!progressPages.includes(page)) {
      return res.status(404).json({ error: `unknown page: ${page}` });
    }
    const snapshot = telemetry.get(page);
    if (!snapshot) {
      return res.json({ page, hasData: false, updatedAt: null, data: null });
    }
    res.json({ page, hasData: true, updatedAt: snapshot.updatedAt, data: snapshot.data });
  });

  app.get('/telemetry', (_req, res) => {
    res.json(Object.fromEntries(telemetry));
  });

  app.get('/telemetry/:page', (req, res) => {
    res.json(telemetry.get(req.params.page) || null);
  });

  app.get('/submarine-data/:kind', async (req, res) => {
    const endpoint = SUBMARINE_ENDPOINTS[req.params.kind as keyof typeof SUBMARINE_ENDPOINTS];
    if (!endpoint) return res.status(404).json({ error: 'unknown submarine data endpoint' });

    try {
      const upstream = await fetch(endpoint);
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: `upstream returned ${upstream.status}` });
      }
      res.setHeader('Cache-Control', 'public, max-age=7200');
      res.json(await upstream.json());
    } catch {
      res.status(502).json({ error: 'failed to fetch submarine cable data' });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  function broadcast(): void {
    const message = JSON.stringify({ type: 'state', state: game.getFullState() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  }

  app.get('/state', (_req, res) => {
    res.json(game.getAIState());
  });

  app.post('/action', (req, res) => {
    const { action, ...params } = req.body || {};
    if (!action) return res.status(400).json({ ok: false, error: 'action required' });
    const result = game.processAction(action, params);
    broadcast();
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, result, state: game.getAIState() });
  });

  app.post('/reset', (_req, res) => {
    game.reset();
    broadcast();
    res.json({ ok: true, state: game.getAIState() });
  });

  app.get('/electron/state', (_req, res) => {
    res.json(getElectronState());
  });

  app.post('/electron/action', (req, res) => {
    const { type, ...payload } = req.body || {};
    if (!type) return res.status(400).json({ ok: false, error: 'type required' });
    const result = electronDispatch(type, payload);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', state: game.getFullState() }));
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      console.log(`Game server:  http://localhost:${PORT}`);
      console.log(`Dungeon view: http://localhost:${PORT}/index.html`);
      resolve();
    });
  });
}
