import {
  applyAgentArrival as applyNetworkDefenseAgentArrival,
  applyAttack as applyNetworkDefenseAttack,
  applyDefense as applyNetworkDefenseDefense,
  removePacket as removeNetworkDefensePacket,
  setNodeColor as setNetworkDefenseNodeColor,
  spawnEnemy as spawnNetworkDefenseEnemy,
  spawnNormalTraffic as spawnNetworkDefenseTraffic,
  spawnScanner as spawnNetworkDefenseScanner,
  updateNodes as updateNetworkDefenseNodes,
  updatePackets as updateNetworkDefensePackets,
  updateScanPackets as updateNetworkDefenseScanPackets,
} from './network_defense_combat.js';
import { updateWave as updateNetworkDefenseWave, updateSeniorStrategy as updateNetworkDefenseSeniorStrategy } from './network_defense_wave.js';
import {
  buyAgent as buyNetworkDefenseAgent,
  idleAtSpot as idleAgentAtSpot,
  teleportHome as teleportAgentHome,
  updateAgents as updateNetworkDefenseAgents,
} from './network_defense_agents.js';
import { reportNetworkDefenseTelemetry } from './network_defense_telemetry.js';
import { showNetworkDefenseEndOverlay, updateNetworkDefenseHud } from './network_defense_overlay.js';
import { buildObserverHotspots, buildObserverSummary } from './network_defense_observer_mode.js';

export function createNetworkDefenseRuntime(context: any) {
  function spawnEnemy(): void {
    spawnNetworkDefenseEnemy({
      game: context.game,
      topo: context.topo,
      rng: context.rng,
      enemyFrontierTarget: context.enemyFrontierTarget,
      enemyPackets: context.enemyPackets,
      route: context.route,
      createPacket: context.createPacket,
      adj: context.adj,
      perimeterNode: context.perimeterNode,
    });
  }

  function removePacket(list: any[], index: number): void {
    removeNetworkDefensePacket({ scene: context.scene }, list, index);
  }

  function spawnNormalTraffic(): void {
    spawnNetworkDefenseTraffic({
      topo: context.topo,
      rng: context.rng,
      normalPackets: context.normalPackets,
      route: context.route,
      createPacket: context.createPacket,
    });
  }

  function spawnScanner(): void {
    spawnNetworkDefenseScanner({
      game: context.game,
      scanPackets: context.scanPackets,
      topo: context.topo,
      rng: context.rng,
      safeRoute: context.safeRoute,
      createPacket: context.createPacket,
    });
  }

  function updateScanPackets(dt: number): void {
    updateNetworkDefenseScanPackets({
      scanPackets: context.scanPackets,
      enemyPackets: context.enemyPackets,
      game: context.game,
      edgeMap: context.edgeMap,
      edgeKey: context.edgeKey,
      edgeTravelFactor: context.edgeTravelFactor,
      triggerFlash: context.triggerFlash,
      normalPool: context.normalPool,
      removePacket,
    }, dt);
  }

  function applyAttack(node: any, damage: number, now: number): void {
    applyNetworkDefenseAttack({
      game: context.game,
      triggerFlash: context.triggerFlash,
      attackPool: context.attackPool,
      showEndOverlay,
      logEvent: context.logEvent,
      setMessage: context.setMessage,
    }, node, damage, now);
  }

  function applyDefense(node: any, repair: number): void {
    applyNetworkDefenseDefense({ game: context.game }, node, repair);
  }

  function updatePackets(list: any[], dt: number, onArrive: any): void {
    updateNetworkDefensePackets({
      edgeMap: context.edgeMap,
      edgeKey: context.edgeKey,
      edgeTravelFactor: context.edgeTravelFactor,
      game: context.game,
      firewalls: context.firewalls,
      firewallKey: context.firewallKey,
      triggerFlash: context.triggerFlash,
      normalPool: context.normalPool,
      enemyPackets: context.enemyPackets,
      removePacket,
    }, list, dt, onArrive);
  }

  function setNodeColor(node: any, now: number): void {
    setNetworkDefenseNodeColor(node, now);
  }

  function updateNodes(dt: number, now: number): void {
    updateNetworkDefenseNodes({ topo: context.topo, adj: context.adj, setNodeColor }, dt, now);
  }

  function applyAgentArrival(agent: any, lastEdge: any, now: number): void {
    applyNetworkDefenseAgentArrival({
      game: context.game,
      edgeMap: context.edgeMap,
      edgeKey: context.edgeKey,
      deployFirewall: context.deployFirewall,
      defensePackets: context.defensePackets,
      createPacket: context.createPacket,
    }, agent, lastEdge, now);
  }

  function idleAtSpot(agent: any): void {
    idleAgentAtSpot({ rng: context.rng }, agent);
  }

  function teleportHome(agent: any): void {
    teleportAgentHome({ rng: context.rng, topo: context.topo }, agent);
  }

  function updateAgents(dt: number, now: number): void {
    updateNetworkDefenseAgents({
      agents: context.agents,
      edgeMap: context.edgeMap,
      game: context.game,
      topo: context.topo,
      rng: context.rng,
      edgeKey: context.edgeKey,
      edgeTravelFactor: context.edgeTravelFactor,
      assignAgent: context.assignAgent,
      applyAgentArrival,
      idleAtSpot,
      teleportHome,
    }, dt, now);
  }

  function updateHud(): void {
    updateNetworkDefenseHud(context.game, context.topo);
    if (context.observerMode && context.rankPersonalities) {
      const summary = buildObserverSummary(context.topo, context.enemyPackets, context.defensePackets);
      context.observationUi.update({
        lowLoadMode: context.game.lowLoadMode,
        eventState: context.observationEvents.getHudState(),
        rankSnapshots: context.buildObserverSnapshot(context.agents, context.rankPersonalities, context.game.rankIntents),
        summary,
        hotspots: buildObserverHotspots(context.topo),
      });
    }
  }

  function updateWave(dt: number): void {
    updateNetworkDefenseWave({
      dt,
      game: context.game,
      topo: context.topo,
      enemyPackets: context.enemyPackets,
      winWave: context.winWave,
      showEndOverlay,
      logEvent: context.logEvent,
      setMessage: context.setMessage,
      triggerRuleUpdate: context.triggerRuleUpdate,
    });
  }

  function updateSeniorStrategy(dt: number): void {
    context.game.nextScan -= dt;
    if (context.game.nextScan > 0) return;
    context.game.nextScan = 6;
    updateNetworkDefenseSeniorStrategy({
      agents: context.agents,
      game: context.game,
      topo: context.topo,
      firewalls: context.firewalls,
      enemyPackets: context.enemyPackets,
      observerMode: context.observerMode,
      setMessage: context.setMessage,
    });
  }

  function showEndOverlay(isVictory: boolean): void {
    showNetworkDefenseEndOverlay(context.game, context.topo, context.agents, context.firewalls, isVictory);
  }

  function buyAgent(rank: any): void {
    buyNetworkDefenseAgent({
      game: context.game,
      agents: context.agents,
      scene: context.scene,
      topo: context.topo,
      observerMode: context.observerMode,
      rankPersonalities: context.rankPersonalities,
      applyPersonalityToAgent: context.applyPersonalityToAgent,
      setMessage: context.setMessage,
      logEvent: context.logEvent,
    }, rank);
  }

  function reportTelemetry(): void {
    reportNetworkDefenseTelemetry({
      topo: context.topo,
      game: context.game,
      enemyPackets: context.enemyPackets,
      defensePackets: context.defensePackets,
      normalPackets: context.normalPackets,
      agents: context.agents,
      firewalls: context.firewalls,
      observerMode: context.observerMode,
      observationEvents: context.observationEvents,
      rankPersonalities: context.rankPersonalities,
    });
  }

  return {
    applyAttack,
    applyDefense,
    buyAgent,
    reportTelemetry,
    showEndOverlay,
    spawnEnemy,
    spawnNormalTraffic,
    spawnScanner,
    updateAgents,
    updateHud,
    updateNodes,
    updatePackets,
    updateScanPackets,
    updateSeniorStrategy,
    updateWave,
  };
}
