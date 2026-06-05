const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { GameEngine } = require('./game/engine');

const PORT = 3000;
const game = new GameEngine();
const telemetry = new Map();

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
  app.use('/agent_rules', express.static(path.join(__dirname, 'agent_rules')));

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
