"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const ws_1 = require("ws");
const server_assets_1 = require("./server_assets");
const server_ollama_1 = require("./server_ollama");
const PORT = 3000;
const telemetry = new Map();
const colonyQueue = [];
const progressPages = ['network_defense', 'network_defense_observer', 'colony', 'planet_strategy'];
const SUBMARINE_ENDPOINTS = {
    cables: 'https://www.submarinecablemap.com/api/v3/cable/all.json',
    landings: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
    routes: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
};
async function startServer(getElectronState, electronDispatch) {
    const projectRoot = path_1.default.resolve(__dirname, '..');
    const engineModuleUrl = (0, url_1.pathToFileURL)(path_1.default.join(projectRoot, 'build', 'game', 'engine.js')).href;
    const importEngineModule = new Function('moduleUrl', 'return import(moduleUrl);');
    const { GameEngine } = await importEngineModule(engineModuleUrl);
    const game = new GameEngine();
    const app = (0, express_1.default)();
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        if (req.method === 'OPTIONS')
            return res.sendStatus(204);
        next();
    });
    app.use(express_1.default.json());
    await (0, server_assets_1.mountBrowserAssetRoutes)(app, projectRoot);
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
    app.post('/api/strategy', server_ollama_1.handleStrategyRequest);
    app.post('/api/update-rules', async (req, res) => {
        await (0, server_ollama_1.handleRuleUpdate)(projectRoot, req, res);
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
        const endpoint = SUBMARINE_ENDPOINTS[req.params.kind];
        if (!endpoint)
            return res.status(404).json({ error: 'unknown submarine data endpoint' });
        try {
            const upstream = await fetch(endpoint);
            if (!upstream.ok) {
                return res.status(upstream.status).json({ error: `upstream returned ${upstream.status}` });
            }
            res.setHeader('Cache-Control', 'public, max-age=7200');
            res.json(await upstream.json());
        }
        catch {
            res.status(502).json({ error: 'failed to fetch submarine cable data' });
        }
    });
    const server = http_1.default.createServer(app);
    const wss = new ws_1.WebSocketServer({ server });
    function broadcast() {
        const message = JSON.stringify({ type: 'state', state: game.getFullState() });
        for (const client of wss.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN)
                client.send(message);
        }
    }
    app.get('/state', (_req, res) => {
        res.json(game.getAIState());
    });
    app.post('/action', (req, res) => {
        const { action, ...params } = req.body || {};
        if (!action)
            return res.status(400).json({ ok: false, error: 'action required' });
        const result = game.processAction(action, params);
        broadcast();
        if (result.error)
            return res.status(400).json({ ok: false, error: result.error });
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
        if (!type)
            return res.status(400).json({ ok: false, error: 'type required' });
        const result = electronDispatch(type, payload);
        if (result.error)
            return res.status(400).json({ ok: false, error: result.error });
        res.json({ ok: true, ...result });
    });
    wss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'state', state: game.getFullState() }));
    });
    await new Promise((resolve) => {
        server.listen(PORT, () => {
            console.log(`Game server:  http://localhost:${PORT}`);
            console.log(`Dungeon view: http://localhost:${PORT}/index.html`);
            resolve();
        });
    });
}
