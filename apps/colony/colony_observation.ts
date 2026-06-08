import * as THREE from 'three';
import { appendLogPanelEntry } from '../../shared/log-panel.js';
import type { ColonyInterventionItem, ColonyInterventionType, ColonyNode } from '../../shared/types/colony.js';

export function createColonyObservation(context: any) {
  function updateVisuals(now: number) {
    for (const node of context.map.nodes) {
      const mat = node.mesh.material;
      const halo = node.halo.material;
      const flashing = node.flashUntil > now;
      const flashT = flashing ? Math.min(1, (node.flashUntil - now) / 0.35) : 0;

      if (node.owner === -1) {
        node.mesh.scale.y = 0.45;
        if (flashing) {
          mat.color.set(0x888888);
          mat.emissive.set(1.8, 1.8, 1.8);
          mat.emissiveIntensity = flashT * 2.2;
          halo.opacity = flashT * 0.18;
        } else {
          mat.color.copy(context.neutralColor);
          mat.emissive.set(0, 0, 0);
          mat.emissiveIntensity = 0;
          halo.opacity = 0;
        }
      } else {
        const factionColor = context.factionColors[node.owner];
        const emissiveColor = context.factionEmissiveColors[node.owner];
        const strength = node.strength;
        node.mesh.scale.y = 0.45 + strength * 1.3;
        if (flashing) {
          mat.color.lerpColors(context.neutralColor, factionColor, strength);
          mat.emissive.set(2.0, 2.0, 2.0);
          mat.emissiveIntensity = flashT * 3.0;
        } else {
          const contested = node.neighbors.some((neighbor: ColonyNode) => neighbor.owner >= 0 && neighbor.owner !== node.owner);
          if (contested && strength < 0.6) {
            mat.color.lerpColors(context.neutralColor, factionColor, strength);
            mat.emissive.copy(context.contestedColor);
            mat.emissiveIntensity = 0.9 + Math.sin(now * 6.0 + node.id) * 0.6;
          } else {
            mat.color.lerpColors(context.neutralColor, factionColor, strength);
            mat.emissive.copy(emissiveColor);
            mat.emissiveIntensity = 0.3 + strength * 0.9;
          }
        }
        halo.color.copy(factionColor);
        halo.opacity = 0.035 + strength * 0.09;
      }

      if (node.resourceRing) {
        const speed = node.owner >= 0 ? 1.4 : 0.4;
        node.resourceRing.rotation.z = now * speed;
        node.resourceRing.material.opacity = 0.35 + Math.sin(now * 1.8 + node.id * 0.7) * 0.18;
      }
    }

    for (const edge of context.map.edges) {
      edge.line.material =
        edge.a.owner >= 0 && edge.a.owner === edge.b.owner
          ? context.edgeMatFaction[edge.a.owner]
          : context.edgeMatNeutral;
    }
  }

  function updateHUD() {
    const total = context.map.nodes.length;
    for (const faction of context.factions) {
      const count = context.map.nodes.filter((node: ColonyNode) => node.owner === faction.id).length;
      const getEl = (id: string) => document.getElementById(`f${faction.id}-${id}`);
      if (!getEl('territory')) continue;
      const avgStr = count > 0
        ? Math.round(context.map.nodes.filter((node: ColonyNode) => node.owner === faction.id).reduce((sum: number, node: ColonyNode) => sum + node.strength, 0) / count * 100)
        : 0;
      getEl('territory')!.textContent = String(count);
      getEl('food')!.textContent = String(Math.floor(faction.food));
      getEl('material')!.textContent = `${avgStr}%`;
      getEl('intent')!.textContent = faction.alive ? faction.intent : '☠ eliminated';
      const pct = total > 0 ? Math.round(count / total * 100) : 0;
      const bar = document.getElementById(`f${faction.id}-bar`);
      if (bar) bar.style.width = `${pct}%`;
      const panel = document.getElementById(`f${faction.id}-panel`);
      if (panel && !faction.alive) panel.style.opacity = '0.38';
    }
    const time = Math.floor(context.world.elapsed);
    const mm = String(Math.floor(time / 60)).padStart(2, '0');
    const ss = String(time % 60).padStart(2, '0');
    const worldTime = document.getElementById('world-time');
    if (worldTime) worldTime.textContent = `${mm}:${ss}  tick: ${context.world.tick}`;
  }

  function reportTelemetry() {
    if (!window.Telemetry) return;
    const counts = context.factions.map((faction: any) => context.map.nodes.filter((node: ColonyNode) => node.owner === faction.id).length);
    const dominant = context.factions.reduce((best: any, faction: any, index: number) => counts[index] > counts[best.id] ? faction : best, context.factions[0]);
    window.Telemetry.report('colony', {
      elapsed: Math.round(context.world.elapsed),
      tick: context.world.tick,
      dominantFaction: dominant.name,
      factions: context.factions.map((faction: any, index: number) => ({
        id: faction.id,
        name: faction.name,
        personality: faction.personality,
        alive: faction.alive,
        territory: counts[index],
        food: Math.floor(faction.food),
        material: Math.floor(faction.material),
        intent: faction.intent,
      })),
      nodes: context.map.nodes.length,
      neutralNodes: context.map.nodes.filter((node: ColonyNode) => node.owner === -1).length,
    }, 1500);
  }

  async function pollInterventions() {
    try {
      const res = await fetch('/colony/intervention/pending');
      if (!res.ok) return;
      const items = await res.json() as ColonyInterventionItem[];
      for (const item of items) context.doIntervention(item.type);
    } catch {}
  }

  function logEvent(text: string, type = 'info') {
    appendLogPanelEntry({
      elapsedSeconds: context.world.elapsed,
      text,
      type,
    });
  }

  function doIntervention(type: ColonyInterventionType) {
    switch (type) {
      case 'resource_drop': {
        const node = context.rng.pick(context.map.nodes);
        node.food += 28;
        node.material += 14;
        logEvent(`INTERVENTION: Resource drop at node ${node.id}`, 'intervention');
        break;
      }
      case 'storm': {
        const center = context.rng.pick(context.map.nodes);
        const affected = [center, ...center.neighbors];
        for (const node of affected) if (!node.isBase) node.strength = Math.max(0, node.strength - 0.32);
        logEvent(`INTERVENTION: Storm hit node ${center.id} cluster`, 'intervention');
        break;
      }
      case 'invader_wave': {
        const owned = context.map.nodes.filter((node: ColonyNode) => node.owner >= 0 && !node.isBase);
        for (let i = 0; i < Math.min(4, owned.length); i++) {
          const target = context.rng.pick(owned);
          target.strength = Math.max(0, target.strength - 0.35);
          logEvent(`INTERVENTION: Invader strikes node ${target.id}`, 'intervention');
        }
        break;
      }
      case 'spawn_neutral': {
        const owned = context.map.nodes.filter((node: ColonyNode) => node.owner >= 0 && !node.isBase && node.strength < 0.5);
        if (!owned.length) return;
        const target = context.rng.pick(owned);
        context.factions[target.owner].nodes = context.factions[target.owner].nodes.filter((node: ColonyNode) => node.id !== target.id);
        target.owner = -1;
        target.strength = 0;
        target.food = context.rng.range(18, 35);
        logEvent(`INTERVENTION: Node ${target.id} returned to wild`, 'intervention');
        break;
      }
    }
  }

  return {
    doIntervention,
    logEvent,
    pollInterventions,
    reportTelemetry,
    updateHUD,
    updateVisuals,
  };
}
