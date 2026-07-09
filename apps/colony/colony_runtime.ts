import { bindComposerResize, startAnimationFrameLoop } from '../../shared/browser-runtime.js';

export function createColonyRuntime(context: any) {
  const randomEvents = [
    {
      label: 'Resource Bloom',
      run() {
        const node = context.rng.pick(context.map.nodes);
        node.food = Math.min(65, node.food + context.rng.range(12, 24));
        node.material = Math.min(42, node.material + context.rng.range(6, 15));
        context.logEvent(`EVENT: Resource bloom at node ${node.id}`, 'event');
      },
    },
    {
      label: 'Local Storm',
      run() {
        const center = context.rng.pick(context.map.nodes);
        const affected = [center, ...center.neighbors].slice(0, context.rng.int(2, 5));
        for (const node of affected) {
          if (!node.isBase) node.strength = Math.max(0, node.strength - context.rng.range(0.12, 0.28));
        }
        context.logEvent(`EVENT: Storm at node ${center.id} — ${affected.length} nodes weakened`, 'event');
      },
    },
    {
      label: 'Neutral Uprising',
      run() {
        const candidates = context.map.nodes.filter((node: any) => node.owner >= 0 && !node.isBase && node.strength < 0.4);
        if (!candidates.length) return;
        const target = context.rng.pick(candidates);
        context.factions[target.owner].nodes = context.factions[target.owner].nodes.filter((node: any) => node.id !== target.id);
        target.owner = -1;
        target.strength = 0;
        context.logEvent(`EVENT: Node ${target.id} reverted to neutral`, 'event');
      },
    },
    {
      label: 'Fertile Ground',
      run() {
        const neutral = context.map.nodes.filter((node: any) => node.owner === -1);
        if (!neutral.length) return;
        const target = context.rng.pick(neutral);
        target.food = Math.min(65, target.food + 18);
        context.logEvent(`EVENT: Fertile ground discovered at node ${target.id}`, 'event');
      },
    },
    {
      label: 'Insurgency',
      run() {
        const alive = context.factions.filter((faction: any) => faction.alive);
        const counts = alive.map((faction: any) => ({
          faction,
          count: context.map.nodes.filter((node: any) => node.owner === faction.id).length,
        }));
        const dominant = counts.reduce((best: any, current: any) => current.count > best.count ? current : best);
        if (dominant.count / context.map.nodes.length < 0.38) return;
        const borders = context.map.nodes.filter((node: any) =>
          node.owner === dominant.faction.id && !node.isBase &&
          node.neighbors.some((neighbor: any) => neighbor.owner !== dominant.faction.id)
        );
        if (!borders.length) return;
        const count = Math.max(1, Math.floor(borders.length * 0.35));
        for (let i = 0; i < count; i++) {
          const target = context.rng.pick(borders);
          target.strength = Math.max(0, target.strength - context.rng.range(0.22, 0.38));
        }
        context.logEvent(`EVENT: Insurgency! ${dominant.faction.name}'s borders weaken (${count} nodes)`, 'event');
      },
    },
    {
      label: 'Resource Drought',
      run() {
        for (const faction of context.factions) {
          if (!faction.alive) continue;
          faction.food = Math.max(8, faction.food * 0.65);
        }
        context.logEvent('EVENT: Resource drought — all factions lost 35% food', 'event');
      },
    },
    {
      label: 'Golden Age',
      run() {
        const alive = context.factions.filter((faction: any) => faction.alive);
        if (alive.length < 2) return;
        const weakest = alive.reduce((worst: any, faction: any) => {
          const count = context.map.nodes.filter((node: any) => node.owner === faction.id).length;
          const worstCount = context.map.nodes.filter((node: any) => node.owner === worst.id).length;
          return count < worstCount ? faction : worst;
        });
        weakest.food = Math.min(80, weakest.food + 30);
        for (const node of context.map.nodes) {
          if (node.owner === weakest.id) node.strength = Math.min(1, node.strength + 0.18);
        }
        context.logEvent(`EVENT: Golden age! ${weakest.name} rallies — territory reinforced`, 'event');
      },
    },
    {
      label: 'Border Flashpoint',
      run() {
        const hotBorders = context.map.nodes.filter((node: any) =>
          node.owner >= 0 && !node.isBase &&
          node.neighbors.some((neighbor: any) => neighbor.owner >= 0 && neighbor.owner !== node.owner)
        );
        if (hotBorders.length < 2) return;
        const center = context.rng.pick(hotBorders);
        const zone = [center, ...center.neighbors.filter((node: any) => node.owner >= 0 && !node.isBase)];
        for (const node of zone) node.strength = Math.max(0, node.strength - context.rng.range(0.2, 0.34));
        context.logEvent(`EVENT: Flashpoint! Fighting flares around node ${center.id} — ${zone.length} nodes destabilized`, 'event');
      },
    },
  ];

  let nextRuleReload = 6;
  let situationReportTimer = 60;
  let lastDominantId: number | null = null;

  function logSituationReport() {
    const total = context.map.nodes.length;
    const parts = context.factions.map((faction: any) => {
      const count = context.map.nodes.filter((node: any) => node.owner === faction.id).length;
      return `${faction.name} ${Math.round((count / total) * 100)}%`;
    });
    const wild = context.map.nodes.filter((node: any) => node.owner === -1).length;
    parts.push(`wild ${Math.round((wild / total) * 100)}%`);
    context.logEvent(`REPORT: ${parts.join(' | ')}`, 'info');
  }

  function checkDominanceMilestone() {
    const total = context.map.nodes.length;
    const dominant = context.factions.find((faction: any) =>
      faction.alive &&
      context.map.nodes.filter((node: any) => node.owner === faction.id).length / total >= 0.5
    ) ?? null;
    if (dominant && dominant.id !== lastDominantId) {
      context.logEvent(`★ ${dominant.name} now controls half the map!`, 'event');
    }
    lastDominantId = dominant?.id ?? null;
  }

  function tick(dt: number, now: number) {
    context.world.elapsed += dt;

    context.world.tickTimer += dt;
    if (context.world.tickTimer >= context.tickSec) {
      context.world.tickTimer = 0;
      context.world.tick++;
      context.tickFactions();
      context.decayStrength(context.tickSec);
      checkDominanceMilestone();
    }

    context.world.eventTimer -= dt;
    if (context.world.eventTimer <= 0) {
      context.rng.pick(randomEvents).run();
      context.world.eventTimer = context.rng.range(20, 42);
    }

    situationReportTimer -= dt;
    if (situationReportTimer <= 0) {
      logSituationReport();
      situationReportTimer = 60;
    }

    nextRuleReload -= dt;
    if (nextRuleReload <= 0) {
      context.loadFactionRules();
      nextRuleReload = 8;
    }

    context.tickPulses(dt);
    context.updateVisuals(now);
    context.updateHUD();
    context.reportTelemetry();
    context.controls.update();
    context.composer.render();
  }

  function initialize() {
    context.loadFactionRules().then(() => {
      context.logEvent(`Colony initialized. seed: ${context.seed}`, 'info');
      context.logEvent(`Map: ${context.nodeCount} territories. 3 factions deployed.`, 'info');
      for (const faction of context.factions) {
        context.logEvent(`${faction.name} [${faction.personality}] base at node ${faction.baseNode.id}`, `f${faction.id}`);
      }
      setInterval(context.pollInterventions, 2000);
      startAnimationFrameLoop({ clock: context.clock, step: tick });
    });

    document.getElementById('btn-resource')?.addEventListener('click', () => context.doIntervention('resource_drop'));
    document.getElementById('btn-storm')?.addEventListener('click', () => context.doIntervention('storm'));
    document.getElementById('btn-invader')?.addEventListener('click', () => context.doIntervention('invader_wave'));
    document.getElementById('btn-neutral')?.addEventListener('click', () => context.doIntervention('spawn_neutral'));

    bindComposerResize({
      camera: context.camera,
      renderer: context.renderer,
      composer: context.composer,
    });
  }

  return {
    initialize,
    randomEvents,
  };
}
