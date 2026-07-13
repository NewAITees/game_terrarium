"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const fs_1 = require("fs");
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const ws_1 = require("ws");
const server_assets_1 = require("./server_assets");
const server_ollama_1 = require("./server_ollama");
const network_smallworld_runtime_1 = require("./game/network_smallworld_runtime");
const city_traffic_runtime_1 = require("./game/city_traffic_runtime");
const moss_runtime_1 = require("./game/moss_runtime");
const submarine_cables_runtime_1 = require("./game/submarine_cables_runtime");
const submarine_network_3d_runtime_1 = require("./game/submarine_network_3d_runtime");
const escort_td_runtime_1 = require("./game/escort_td_runtime");
const PORT = Number.parseInt(process.env.GAME_TERRARIUM_PORT || process.env.PORT || '3000', 10) || 3000;
const telemetry = new Map();
const colonyQueue = [];
const progressPages = ['network_defense', 'network_defense_observer', 'colony', 'planet_strategy', 'network_smallworld', 'city_traffic', 'moss', 'escort_td'];
const SUBMARINE_ENDPOINTS = {
    cables: 'https://www.submarinecablemap.com/api/v3/cable/all.json',
    landings: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
    routes: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
};
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function average(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function buildCityTrafficAnalysis(snapshot) {
    const cars = Array.isArray(snapshot.cars) ? snapshot.cars : [];
    const intersections = Array.isArray(snapshot.intersections) ? snapshot.intersections : [];
    const config = snapshot.config || {};
    const stoppedCars = cars.filter((car) => car.speedNow <= 0.1).length;
    const slowCars = cars.filter((car) => car.speedNow > 0.1 && car.speedNow < car.baseSpeed * 0.5).length;
    const movingCars = cars.length - stoppedCars;
    const avgSpeed = average(cars.map((car) => car.speedNow || 0));
    const avgBaseSpeed = average(cars.map((car) => car.baseSpeed || 0));
    const ewGreen = intersections.filter((inter) => inter.state === 2 || inter.state === 3).length;
    const nsGreen = intersections.filter((inter) => inter.state === 0 || inter.state === 1).length;
    const signalSkew = intersections.length ? Math.abs(ewGreen - nsGreen) / intersections.length : 0;
    const pressureRows = intersections
        .map((inter) => {
        const queue = cars.filter((car) => {
            const isEW = car.heading === 'E' || car.heading === 'W';
            if (isEW && car.roadIndex !== inter.zi)
                return false;
            if (!isEW && car.roadIndex !== inter.xi)
                return false;
            const axis = isEW ? inter.x : inter.z;
            return Math.abs(car.pos - axis) <= (config.roadW || 0) + (config.carLen || 0) * 1.5;
        });
        const blocked = queue.filter((car) => car.speedNow <= 0.1).length;
        return {
            id: inter.id,
            queue: queue.length,
            blocked,
            state: inter.state,
            timer: Number((inter.timer || 0).toFixed(2)),
        };
    })
        .sort((a, b) => b.queue - a.queue || b.blocked - a.blocked)
        .slice(0, 5);
    const queuePressure = pressureRows.length ? pressureRows[0].queue / Math.max(1, cars.length) : 0;
    const congestion = clamp01((stoppedCars / Math.max(1, cars.length)) * 0.78 + (slowCars / Math.max(1, cars.length)) * 0.18 + queuePressure * 0.45);
    const health = clamp01(1 - congestion);
    const stability = clamp01(1 - signalSkew * 0.85);
    const momentum = clamp01(avgBaseSpeed ? avgSpeed / avgBaseSpeed : 0);
    const activity = clamp01(movingCars / Math.max(1, cars.length));
    const pressure = clamp01(queuePressure * 1.3 + congestion * 0.35);
    const risk = clamp01(congestion * 0.82 + signalSkew * 0.22);
    const fun = clamp01(0.2 + activity * 0.45 + (1 - signalSkew) * 0.2 + Math.min(1, intersections.length / 40) * 0.15);
    return {
        phase: 'traffic_flow',
        progress: clamp01((snapshot.elapsed || 0) / 180),
        health,
        stability,
        pressure,
        momentum,
        activity,
        risk,
        fun,
        summary: `${cars.length} cars across ${intersections.length} intersections; ${stoppedCars} stopped, ${slowCars} slow`,
        signals: [
            { key: 'stoppedCars', value: stoppedCars, target: 0, weight: 1.1 },
            { key: 'slowCars', value: slowCars, target: 0, weight: 0.8 },
            { key: 'avgSpeedRatio', value: avgBaseSpeed ? avgSpeed / avgBaseSpeed : 0, target: 1, weight: 1 },
            { key: 'ewGreen', value: ewGreen, weight: 0.5 },
            { key: 'nsGreen', value: nsGreen, weight: 0.5 },
        ],
        highlights: pressureRows.map((row) => `${row.id}:${row.queue} queue/${row.blocked} blocked`),
        details: {
            carCount: cars.length,
            intersectionCount: intersections.length,
            stoppedCars,
            slowCars,
            movingCars,
            avgSpeed: Number(avgSpeed.toFixed(3)),
            avgBaseSpeed: Number(avgBaseSpeed.toFixed(3)),
            queuePressure: Number(queuePressure.toFixed(3)),
            signalSkew: Number(signalSkew.toFixed(3)),
        },
    };
}
function buildMossAnalysis(snapshot) {
    const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];
    const packets = Array.isArray(snapshot.packets) ? snapshot.packets : [];
    const activeEdgeKeys = Array.isArray(snapshot.activeEdgeKeys) ? snapshot.activeEdgeKeys : [];
    const degreeMap = new Map();
    for (const edge of edges) {
        degreeMap.set(edge.a, (degreeMap.get(edge.a) || 0) + 1);
        degreeMap.set(edge.b, (degreeMap.get(edge.b) || 0) + 1);
    }
    const degrees = [...degreeMap.values()];
    const leafNodes = degrees.filter((degree) => degree === 1).length;
    const hubNodes = degrees.filter((degree) => degree >= 4).length;
    const avgPacketPhase = average(packets.map((packet) => packet.t || 0));
    const activeEdgeRatio = activeEdgeKeys.length / Math.max(1, edges.length);
    const leafRatio = leafNodes / Math.max(1, nodes.length);
    const hubRatio = hubNodes / Math.max(1, nodes.length);
    const density = edges.length / Math.max(1, nodes.length);
    const stability = clamp01(1 - Math.abs((snapshot.avgDegree || 0) - 3) / 3 - Math.max(0, leafRatio - 0.22) * 0.4);
    const pressure = clamp01(activeEdgeRatio * 1.15 + avgPacketPhase * 0.12);
    const momentum = clamp01((packets.length / Math.max(1, nodes.length * 1.5)) * 0.7 + activeEdgeRatio * 0.3);
    const activity = clamp01(packets.length / Math.max(1, nodes.length * 1.2));
    const health = clamp01((stability + momentum) / 2);
    const risk = clamp01(1 - stability + leafRatio * 0.2 + Math.max(0, hubRatio - 0.25) * 0.15);
    const fun = clamp01(0.2 + activeEdgeRatio * 0.45 + hubRatio * 0.2 + activity * 0.25);
    return {
        phase: 'packet_flow',
        progress: clamp01((snapshot.elapsed || 0) / 120),
        health,
        stability,
        pressure,
        momentum,
        activity,
        risk,
        fun,
        summary: `${nodes.length} nodes, ${edges.length} edges, ${packets.length} packets`,
        signals: [
            { key: 'activeEdgeRatio', value: activeEdgeRatio, target: 0.2, weight: 1 },
            { key: 'avgDegree', value: snapshot.avgDegree || 0, target: 3, weight: 0.8 },
            { key: 'leafRatio', value: leafRatio, target: 0.2, weight: 0.7 },
            { key: 'hubRatio', value: hubRatio, target: 0.2, weight: 0.7 },
        ],
        highlights: [
            `${activeEdgeKeys.length} active edges`,
            `${leafNodes} leaves / ${hubNodes} hubs`,
            `packet phase avg ${avgPacketPhase.toFixed(2)}`,
        ],
        details: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            activeEdgeCount: activeEdgeKeys.length,
            leafNodes,
            hubNodes,
            avgPacketPhase: Number(avgPacketPhase.toFixed(3)),
            density: Number(density.toFixed(3)),
            avgDegree: Number((snapshot.avgDegree || 0).toFixed(2)),
        },
    };
}
function buildSmallWorldAnalysis(snapshot) {
    const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    const edges = Array.isArray(snapshot.edges) ? snapshot.edges : [];
    const packets = Array.isArray(snapshot.packets) ? snapshot.packets : [];
    const activeEdgeKeys = Array.isArray(snapshot.activeEdgeKeys) ? snapshot.activeEdgeKeys : [];
    const glowNodes = Array.isArray(snapshot.glowNodes) ? snapshot.glowNodes : [];
    const totalEdges = Math.max(1, edges.length);
    const shortcutRatio = (snapshot.shortcutEdgeCount || 0) / totalEdges;
    const activeEdgeRatio = activeEdgeKeys.length / totalEdges;
    const glowCoverage = glowNodes.length / Math.max(1, nodes.length);
    const serverPacketShare = packets.length ? packets.filter((packet) => packet.toId === snapshot.serverNodeId).length / packets.length : 0;
    const idealShortcut = Math.max(0.08, (snapshot.rewirePct || 0) / 100 || 0.28);
    const balance = clamp01(1 - Math.abs(shortcutRatio - idealShortcut) / Math.max(0.08, idealShortcut));
    const pressure = clamp01(activeEdgeRatio * 0.55 + serverPacketShare * 0.45);
    const stability = clamp01(balance * 0.62 + glowCoverage * 0.38);
    const momentum = clamp01((packets.length / Math.max(1, snapshot.total || nodes.length)) * 0.7 + activeEdgeRatio * 0.3);
    const activity = clamp01((packets.length / Math.max(1, nodes.length)) * 0.8 + glowCoverage * 0.2);
    const health = clamp01((stability + momentum) / 2);
    const risk = clamp01(1 - stability + serverPacketShare * 0.15);
    const fun = clamp01(0.2 + glowCoverage * 0.35 + activeEdgeRatio * 0.25 + balance * 0.2 + activity * 0.2);
    return {
        phase: 'network_flow',
        progress: clamp01((snapshot.elapsed || 0) / 120),
        health,
        stability,
        pressure,
        momentum,
        activity,
        risk,
        fun,
        summary: `${nodes.length} nodes, ${edges.length} links, ${packets.length} packets`,
        signals: [
            { key: 'shortcutRatio', value: shortcutRatio, target: idealShortcut, weight: 1 },
            { key: 'activeEdgeRatio', value: activeEdgeRatio, target: 0.2, weight: 0.9 },
            { key: 'glowCoverage', value: glowCoverage, target: 0.2, weight: 0.8 },
            { key: 'serverPacketShare', value: serverPacketShare, target: 0.5, weight: 0.8 },
        ],
        highlights: [
            `server packet share ${(serverPacketShare * 100).toFixed(0)}%`,
            `${glowNodes.length} glowing nodes`,
            `shortcut ratio ${(shortcutRatio * 100).toFixed(1)}%`,
        ],
        details: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            shortcutEdgeCount: snapshot.shortcutEdgeCount || 0,
            treeEdgeCount: snapshot.treeEdgeCount || 0,
            activeEdgeCount: activeEdgeKeys.length,
            glowNodeCount: glowNodes.length,
            serverPacketShare: Number(serverPacketShare.toFixed(3)),
            shortcutRatio: Number(shortcutRatio.toFixed(3)),
            activeEdgeRatio: Number(activeEdgeRatio.toFixed(3)),
            glowCoverage: Number(glowCoverage.toFixed(3)),
        },
    };
}
function buildEscortAnalysis(snapshot) {
    const units = Array.isArray(snapshot.units) ? snapshot.units : [];
    const enemies = Array.isArray(snapshot.enemies) ? snapshot.enemies : [];
    const king = snapshot.king || { x: 0, z: 0, hp: 0, hpMax: 1 };
    const counts = snapshot.counts || {};
    const enemyCounts = {
        ground: counts.ground || 0,
        air: counts.air || 0,
        siege: counts.siege || 0,
    };
    const enemyPressure = enemies.reduce((sum, enemy) => {
        const dist = Math.hypot((enemy.x || 0) - (king.x || 0), (enemy.z || 0) - (king.z || 0));
        const kindWeight = enemy.kind === 'siege' ? 1.35 : enemy.kind === 'air' ? 1.1 : 1;
        return sum + kindWeight * (1 / Math.max(4, dist / 12));
    }, 0);
    const nearKingEnemies = enemies.filter((enemy) => Math.hypot((enemy.x || 0) - (king.x || 0), (enemy.z || 0) - (king.z || 0)) < 18).length;
    const readyUnits = units.filter((unit) => (unit.windupTimer || 0) <= 0 && (unit.fireTimer || 0) <= 0.2).length;
    const kingRatio = king.hpMax ? king.hp / king.hpMax : 0;
    const deployable = snapshot.gold >= 40;
    const pressure = clamp01(enemyPressure / 4.5);
    const stability = clamp01(kingRatio * 0.68 + Math.min(1, units.length / Math.max(1, enemies.length + 1)) * 0.32);
    const momentum = clamp01(Math.min(1, (snapshot.wave || 0) / 12) * 0.72 + Math.min(1, (snapshot.gold || 0) / 180) * 0.28);
    const activity = clamp01((units.length + enemies.length) / 40);
    const health = clamp01((stability + kingRatio) / 2);
    const risk = clamp01(pressure * 0.7 + (1 - kingRatio) * 0.55 + (nearKingEnemies > 0 ? 0.1 : 0));
    const fun = clamp01(0.2 + (1 - Math.abs(stability - pressure)) * 0.55 + activity * 0.25);
    return {
        phase: snapshot.over ? 'failed' : snapshot.won ? 'victory' : 'escort',
        progress: clamp01((snapshot.wave || 0) / 12),
        health,
        stability,
        pressure,
        momentum,
        activity,
        risk,
        fun,
        summary: `wave ${snapshot.wave || 0}, ${units.length} units, ${enemies.length} enemies, king hp ${king.hp || 0}`,
        signals: [
            { key: 'kingRatio', value: kingRatio, target: 1, weight: 1.2 },
            { key: 'enemyPressure', value: enemyPressure, target: 1, weight: 1 },
            { key: 'readyUnits', value: readyUnits, target: units.length, weight: 0.7 },
            { key: 'deployable', value: deployable ? 1 : 0, target: 1, weight: 0.4 },
        ],
        highlights: [
            `king ${Math.round(kingRatio * 100)}%`,
            `${enemyCounts.ground} ground / ${enemyCounts.air} air / ${enemyCounts.siege} siege`,
            `${readyUnits}/${units.length} units ready`,
        ],
        details: {
            wave: snapshot.wave || 0,
            gold: snapshot.gold || 0,
            kingHp: king.hp || 0,
            kingHpMax: king.hpMax || 0,
            enemyPressure: Number(enemyPressure.toFixed(3)),
            nearKingEnemies,
            readyUnits,
            unitCount: units.length,
            enemyCount: enemies.length,
            commandMode: snapshot.commandMode || 'balanced',
            over: Boolean(snapshot.over),
            won: Boolean(snapshot.won),
        },
    };
}
async function startServer(getElectronState, electronDispatch) {
    const projectRoot = path_1.default.resolve(__dirname, '..');
    const shipJumpLogPath = path_1.default.join(projectRoot, 'logs', 'planet_strategy_ship_jumps.log');
    const engineModuleUrl = (0, url_1.pathToFileURL)(path_1.default.join(projectRoot, 'build-node', 'game', 'engine.js')).href;
    const importEngineModule = new Function('moduleUrl', 'return import(moduleUrl);');
    const { GameEngine } = await importEngineModule(engineModuleUrl);
    const game = new GameEngine();
    const networkSmallWorld = new network_smallworld_runtime_1.NetworkSmallWorldRuntime();
    const cityTraffic = new city_traffic_runtime_1.CityTrafficRuntime();
    const moss = new moss_runtime_1.MossRuntime();
    const submarineCables = new submarine_cables_runtime_1.SubmarineCablesRuntime();
    const submarineNetwork3D = new submarine_network_3d_runtime_1.SubmarineNetwork3DRuntime();
    const escortTd = new escort_td_runtime_1.EscortTdRuntime();
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
    app.get('/api/network-smallworld/state', (_req, res) => {
        const snapshot = networkSmallWorld.getSnapshot();
        res.json({ ...snapshot, analysis: buildSmallWorldAnalysis(snapshot) });
    });
    app.get('/api/city-traffic/state', (_req, res) => {
        const snapshot = cityTraffic.getSnapshot();
        res.json({ ...snapshot, analysis: buildCityTrafficAnalysis(snapshot) });
    });
    app.get('/api/moss/state', (_req, res) => {
        const snapshot = moss.getSnapshot();
        res.json({ ...snapshot, analysis: buildMossAnalysis(snapshot) });
    });
    app.get('/api/submarine-cables/state', async (_req, res) => {
        try {
            res.json(await submarineCables.getSnapshot());
        }
        catch (error) {
            res.status(502).json({ error: `failed to build submarine cables state: ${String(error)}` });
        }
    });
    app.get('/api/submarine-network-3d/state', async (_req, res) => {
        try {
            res.json(await submarineNetwork3D.getSnapshot());
        }
        catch (error) {
            res.status(502).json({ error: `failed to build submarine network 3d state: ${String(error)}` });
        }
    });
    app.get('/api/escort-td/state', (_req, res) => {
        const snapshot = escortTd.getSnapshot();
        res.json({ ...snapshot, analysis: buildEscortAnalysis(snapshot) });
    });
    app.post('/api/escort-td/action', (req, res) => {
        const result = escortTd.processAction(req.body || {});
        if (!result.ok)
            return res.status(400).json(result);
        res.json({ ok: true, state: escortTd.getSnapshot() });
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
    app.post('/api/ship-jumps', async (req, res) => {
        const { line } = req.body || {};
        if (typeof line !== 'string' || !line.trim()) {
            return res.status(400).json({ error: 'line required' });
        }
        try {
            await fs_1.promises.mkdir(path_1.default.dirname(shipJumpLogPath), { recursive: true });
            await fs_1.promises.appendFile(shipJumpLogPath, `${line}\n`, 'utf8');
            res.json({ ok: true });
        }
        catch (error) {
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
