const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs').promises;
const { GameEngine } = require('./game/engine');

const PORT = 3000;
const game = new GameEngine();
const telemetry = new Map();
const colonyQueue = [];
const progressPages = ['network_defense', 'network_defense_observer', 'colony', 'planet_strategy'];

const OLLAMA_URL   = 'http://192.168.10.182:11436/api/generate';
const OLLAMA_MODEL = 'llama3.2';

const SUBMARINE_ENDPOINTS = {
  cables: 'https://www.submarinecablemap.com/api/v3/cable/all.json',
  landings: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
  routes: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
};

function startServer(getElectronState, electronDispatch) {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/agent_rules',    express.static(path.join(__dirname, 'agent_rules')));
  app.use('/faction_rules',  express.static(path.join(__dirname, 'faction_rules')));

  app.get('/colony.html', (req, res) => res.sendFile(path.join(__dirname, 'colony.html')));
  app.get('/colony.js',   (req, res) => res.sendFile(path.join(__dirname, 'colony.js')));
  app.get('/planet_strategy.html', (req, res) => res.sendFile(path.join(__dirname, 'planet_strategy.html')));
  app.get('/planet_strategy.js',   (req, res) => res.sendFile(path.join(__dirname, 'planet_strategy.js')));
  app.get('/planet_strategy_render.js', (req, res) => res.sendFile(path.join(__dirname, 'planet_strategy_render.js')));
  app.get('/planet_strategy_ui.js', (req, res) => res.sendFile(path.join(__dirname, 'planet_strategy_ui.js')));
  app.get('/planet_strategy_telemetry.js', (req, res) => res.sendFile(path.join(__dirname, 'planet_strategy_telemetry.js')));

  app.get('/colony/state', (req, res) => {
    res.json(telemetry.get('colony') || null);
  });

  const VALID_INTERVENTIONS = ['resource_drop', 'storm', 'invader_wave', 'spawn_neutral'];
  app.post('/colony/intervention', (req, res) => {
    const { type } = req.body || {};
    if (!VALID_INTERVENTIONS.includes(type))
      return res.status(400).json({ error: `unknown type. valid: ${VALID_INTERVENTIONS.join(', ')}` });
    colonyQueue.push({ type, queuedAt: new Date().toISOString() });
    res.json({ ok: true, queued: colonyQueue.length });
  });

  app.get('/colony/intervention/pending', (req, res) => {
    res.json(colonyQueue.splice(0));
  });

  app.get('/submarine_cables.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'submarine_cables.html'));
  });

  app.get('/submarine_network_3d.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'submarine_network_3d.html'));
  });

  app.get('/network_defense.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_defense.html'));
  });

  app.get('/network_defense.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_defense.js'));
  });

  app.get('/network_defense_observer.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_defense_observer.html'));
  });

  app.get('/network_defense_observer.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_defense_observer.js'));
  });

  app.get('/network_defense_ui.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_defense_ui.js'));
  });

  app.get('/network_defense_personality.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_defense_personality.js'));
  });

  app.get('/network_defense_events.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_defense_events.js'));
  });

  app.get('/network_ecosystem.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_ecosystem.html'));
  });

  app.get('/network_ecosystem.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'network_ecosystem.js'));
  });

  app.get('/network-core.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'network-core.js'));
  });

  app.get('/telemetry-client.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'telemetry-client.js'));
  });

  app.post('/api/strategy', async (req, res) => {
    const snap = req.body || {};
    const prompt =
      `You are a network defense AI. Choose exactly one strategy word from: balanced, containment, firewall-first, patrol.\n` +
      `Game state: wave=${snap.wave}, serverHp=${snap.serverHp}, enemies=${snap.enemies}, ` +
      `infected=${snap.infected}, critical=${snap.critical}, avgInfection=${snap.avgInfection?.toFixed(3)}.\n` +
      `Reply with only the strategy word, nothing else.`;

    try {
      const upstream = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
        signal: AbortSignal.timeout(4000),
      });
      if (!upstream.ok) throw new Error(`ollama ${upstream.status}`);
      const data = await upstream.json();
      const text = (data.response || '').trim().toLowerCase();
      const VALID = ['balanced', 'containment', 'firewall-first', 'patrol'];
      const rule = VALID.find(r => text.includes(r)) ?? 'balanced';
      res.json({ rule });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  const VALID_RANKS   = ['senior', 'mid', 'junior'];
  const VALID_ACTIONS = [
    'containServerNeighbor', 'interceptEnemy', 'suppressHottest', 'repairWeakest',
    'deployFirewallGuard', 'hardenNode', 'rebootNode', 'patrol', 'idle',
    'recruitMid', 'recruitJunior', 'clearPathTo',
  ];

  app.post('/api/update-rules', async (req, res) => {
    const { rank, snapshot, currentRules } = req.body || {};
    if (!VALID_RANKS.includes(rank)) return res.status(400).json({ error: 'invalid rank' });

    const prompt =
      `You are optimizing AI agent rules for a network defense game.\n` +
      `Agent rank: "${rank}"\n` +
      `Game state: wave=${snapshot.wave}, serverHp=${snapshot.serverHp}, ` +
      `enemies=${snapshot.enemies}, infected=${snapshot.infected}, ` +
      `avgInfection=${snapshot.avgInfection?.toFixed(3)}, credits=${snapshot.credits}, rule=${snapshot.rule}\n\n` +
      `Current rules:\n${JSON.stringify(currentRules, null, 2)}\n\n` +
      `Available actions: ${VALID_ACTIONS.join(', ')}\n` +
      `Condition variables: hottestInfection(0-1), avgInfection(0-1), serverHp(0-120), ` +
      `serverNeighborMaxInfection(0-1), enemyCount, infectedCount, firewallCount, ` +
      `gameRule(string), wave, credits, seniorCount, midCount, juniorCount\n\n` +
      `Output ONLY a JSON array of rules. Each rule: {"id":"...","when":"<JS expr or omit>","action":"<action>"}\n` +
      `Adapt the rules to the current game state. Output nothing but the JSON array.`;

    try {
      const upstream = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
        signal: AbortSignal.timeout(20000),
      });
      if (!upstream.ok) throw new Error(`ollama ${upstream.status}`);
      const data = await upstream.json();
      const text = (data.response || '').trim();

      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('no JSON array in response');
      const rules = JSON.parse(match[0]);
      if (!Array.isArray(rules) || !rules.length) throw new Error('empty rules');
      for (const r of rules) {
        if (!VALID_ACTIONS.includes(r.action)) throw new Error(`unknown action: ${r.action}`);
      }

      const filePath = path.join(__dirname, 'agent_rules', `${rank}.json`);
      const existing = JSON.parse(await fs.readFile(filePath, 'utf8').catch(() => '{}'));
      await fs.writeFile(filePath, JSON.stringify(
        { ...existing, rules, updatedAt: new Date().toISOString(), updatedBy: 'ollama' },
        null, 2
      ));
      res.json({ ok: true, rank, ruleCount: rules.length });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
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

  app.get('/api/progress', (req, res) => {
    const items = progressPages.map((page) => {
      const snapshot = telemetry.get(page) || null;
      return {
        page,
        hasData: Boolean(snapshot),
        updatedAt: snapshot?.updatedAt ?? null,
        data: snapshot?.data ?? null,
      };
    });
    res.json({ items });
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
    res.json({
      page,
      hasData: true,
      updatedAt: snapshot.updatedAt,
      data: snapshot.data,
    });
  });

  app.get('/telemetry', (req, res) => {
    res.json(Object.fromEntries(telemetry));
  });

  app.get('/telemetry/:page', (req, res) => {
    res.json(telemetry.get(req.params.page) || null);
  });

  app.get('/submarine-data/:kind', async (req, res) => {
    const endpoint = SUBMARINE_ENDPOINTS[req.params.kind];
    if (!endpoint) return res.status(404).json({ error: 'unknown submarine data endpoint' });

    try {
      const upstream = await fetch(endpoint);
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: `upstream returned ${upstream.status}` });
      }
      res.setHeader('Cache-Control', 'public, max-age=7200');
      res.json(await upstream.json());
    } catch (error) {
      res.status(502).json({ error: 'failed to fetch submarine cable data' });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  function broadcast() {
    const msg = JSON.stringify({ type: 'state', state: game.getFullState() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }

  // Game API (what AI calls)
  app.get('/state', (req, res) => {
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

  app.post('/reset', (req, res) => {
    game.reset();
    broadcast();
    res.json({ ok: true, state: game.getAIState() });
  });

  // Electron page switching (kept from before)
  app.get('/electron/state', (req, res) => res.json(getElectronState()));
  app.post('/electron/action', (req, res) => {
    const { type, ...payload } = req.body || {};
    if (!type) return res.status(400).json({ ok: false, error: 'type required' });
    const result = electronDispatch(type, payload);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  });

  // Send full state on WebSocket connect
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'state', state: game.getFullState() }));
  });

  server.listen(PORT, () => {
    console.log(`Game server:  http://localhost:${PORT}`);
    console.log(`Dungeon view: http://localhost:${PORT}/index.html`);
  });
}

module.exports = { startServer };
