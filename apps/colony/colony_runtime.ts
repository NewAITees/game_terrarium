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
  ];

  let nextRuleReload = 6;

  function tick(dt: number, now: number) {
    context.world.elapsed += dt;

    context.world.tickTimer += dt;
    if (context.world.tickTimer >= context.tickSec) {
      context.world.tickTimer = 0;
      context.world.tick++;
      context.tickFactions();
      context.decayStrength(context.tickSec);
    }

    context.world.eventTimer -= dt;
    if (context.world.eventTimer <= 0) {
      context.rng.pick(randomEvents).run();
      context.world.eventTimer = context.rng.range(20, 42);
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
