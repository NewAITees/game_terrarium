import * as THREE from 'three';
import { findShortestPath } from './network-core.js';
import {
  createAgent as createDefenseAgent,
  createPacket as createDefensePacket,
  patrolTarget as selectPatrolTarget,
  safeRoute as findSafeRoute,
  sendAgent as dispatchAgent,
} from './network_defense_agents.js';
import {
  deployFirewall as deployNetworkDefenseFirewall,
  firewallKey as getFirewallKey,
  updateFirewalls as updateNetworkDefenseFirewalls,
} from './network_defense_firewalls.js';
import {
  enemyFrontierTarget as selectEnemyFrontierTarget,
  isFriendlyPassable as canFriendlyPass,
  safeRoute as buildSafeRoute,
} from './network_defense_routing.js';

export function createNetworkDefenseAppHelpers(context: any) {
  function perimeterNode() {
    return context.rng.pick(context.terms.filter((node: any) => !node.isServer));
  }

  function exposedServer() {
    return (context.adj.get(context.topo.server.id) || []).some((node: any) => node.infection > 0.25);
  }

  function enemyFrontierTarget() {
    return selectEnemyFrontierTarget({
      adj: context.adj,
      topo: context.topo,
      perimeterNode,
      exposedServer,
      now: () => performance.now() / 1000,
    });
  }

  function route(from: any, to: any) {
    return findShortestPath(from, to, context.adj);
  }

  function safeRoute(from: any, to: any) {
    return buildSafeRoute({ adj: context.adj, findSafeRoute }, from, to);
  }

  function createPacket(color: any, radius: any) {
    return createDefensePacket({ scene: context.scene }, color, radius);
  }

  function createAgent(rank: string, index = context.agents.length) {
    return createDefenseAgent({ scene: context.scene, topo: context.topo, agents: context.agents }, rank, index);
  }

  function seedAgents() {
    context.agents.push(
      context.observerMode && context.rankPersonalities
        ? context.applyPersonalityToAgent(createAgent('senior', 0), context.rankPersonalities)
        : createAgent('senior', 0)
    );
    context.agents.push(
      context.observerMode && context.rankPersonalities
        ? context.applyPersonalityToAgent(createAgent('mid', 1), context.rankPersonalities)
        : createAgent('mid', 1)
    );
    context.agents.push(
      context.observerMode && context.rankPersonalities
        ? context.applyPersonalityToAgent(createAgent('junior', 2), context.rankPersonalities)
        : createAgent('junior', 2)
    );
  }

  function firewallKey(edge: any) {
    return getFirewallKey(edge, context.edgeKey);
  }

  function deployFirewall(edge: any, now: number) {
    deployNetworkDefenseFirewall({ edge, now, firewalls: context.firewalls, scene: context.scene, edgeKey: context.edgeKey });
  }

  function updateFirewalls(now: number, dt: number) {
    updateNetworkDefenseFirewalls({ firewalls: context.firewalls, scene: context.scene, now });
  }

  function edgeTravelFactor(edge: any) {
    return (edge?.speedFactor ?? 0.72) * context.game.environmentSpeedMultiplier;
  }

  function hottestNode() {
    return context.topo.nodes
      .filter((node: any) => !node.isServer)
      .sort((a: any, b: any) => b.infection - a.infection || a.hp - b.hp)[0] || context.topo.server;
  }

  function weakestDamagedNode() {
    return context.topo.nodes
      .filter((node: any) => !node.isServer && node.hp < node.maxHp * 0.86 && node.infection < 0.35)
      .sort((a: any, b: any) => a.hp - b.hp || b.degree - a.degree)[0] || null;
  }

  function sendAgent(agent: any, target: any, blockedTarget = null) {
    return dispatchAgent({
      topo: context.topo,
      game: context.game,
      adj: context.adj,
      rng: context.rng,
      isFriendlyPassable: (node: any, routeTarget: any) => canFriendlyPass(node, routeTarget, performance.now() / 1000),
    }, agent, target, blockedTarget);
  }

  function patrolTarget() {
    return selectPatrolTarget({
      topo: context.topo,
      rng: context.rng,
      adj: context.adj,
      isFriendlyPassable: (node: any, routeTarget: any) => canFriendlyPass(node, routeTarget, performance.now() / 1000),
    });
  }

  return {
    createPacket,
    deployFirewall,
    edgeTravelFactor,
    enemyFrontierTarget,
    firewallKey,
    hottestNode,
    patrolTarget,
    perimeterNode,
    route,
    safeRoute,
    seedAgents,
    sendAgent,
    updateFirewalls,
    weakestDamagedNode,
  };
}
