export function startNetworkDefenseLoop(context: {
  clock: { getDelta: () => number };
  game: any;
  observerMode: boolean;
  rng: { next: () => number };
  spinData: Array<{ mesh: any; s: any }>;
  serverGlow: { intensity: number };
  attackPool: any[];
  normalPool: any[];
  allEdges: any[];
  mats: any;
  controls: { update: () => void };
  composer: { render: () => void };
  edgeTick: (allEdges: any[], mats: any, now: number) => void;
  onReloadRules: () => void;
  onUpdateWave: (dt: number) => void;
  onUpdateSeniorStrategy: (dt: number) => void;
  onObservationUpdate: (dt: number, now: number) => void;
  onSpawnEnemy: () => void;
  onSpawnNormalTraffic: () => void;
  onSpawnScanner: () => void;
  onUpdateEnemyPackets: (dt: number, now: number) => void;
  onUpdateDefensePackets: (dt: number) => void;
  onUpdateNormalPackets: (dt: number) => void;
  onUpdateScanPackets: (dt: number) => void;
  onUpdateAgents: (dt: number, now: number) => void;
  onUpdateFirewalls: (now: number, dt: number) => void;
  onUpdateNodes: (dt: number, now: number) => void;
  onUpdateHud: () => void;
  onReportTelemetry: () => void;
}): void {
  let nextRuleReload = 3;
  let nextNormal = 0.4;
  let nextScan = 2;
  let elapsed = 0;
  let frameCount = 0;

  function tickFlashPool(pool: any[], dt: number, decay: number): void {
    for (const flash of pool) {
      if (flash.t <= 0) continue;
      flash.t = Math.max(0, flash.t - dt * decay);
      if (flash.t === 0) {
        flash.mesh.visible = false;
        continue;
      }
      flash.mesh.material = flash.mats[Math.round(flash.t * (flash.mats.length - 1))];
    }
  }

  function animate(): void {
    requestAnimationFrame(animate);
    const dt = Math.min(context.clock.getDelta(), 0.05);
    const now = performance.now() / 1000;
    elapsed += dt;
    frameCount++;

    nextRuleReload -= dt;
    if (nextRuleReload <= 0) {
      context.onReloadRules();
      nextRuleReload = 5;
    }

    if (!context.game.gameOver) {
      context.game.elapsed += dt;
      context.game.credits = Math.min(999, context.game.credits + dt * 3);
      context.game.nextAttack -= dt;
      context.onUpdateWave(dt);
      context.onUpdateSeniorStrategy(dt);
      if (context.observerMode) context.onObservationUpdate(dt, now);
      if (context.game.nextAttack <= 0 && context.game.waveRemaining > 0) {
        context.onSpawnEnemy();
        context.game.nextAttack = Math.max(0.32, 1.35 - context.game.wave * 0.035) + context.rng.next() * 0.65;
      }
      nextNormal -= dt;
      if (nextNormal <= 0) {
        context.onSpawnNormalTraffic();
        nextNormal = 0.25 + context.rng.next() * 0.55;
      }
      nextScan -= dt;
      if (nextScan <= 0) {
        context.onSpawnScanner();
        nextScan = 1.4 + context.rng.next() * 1.8;
      }
    }

    for (const { mesh, s } of context.spinData) {
      const node = mesh.userData.node;
      if (s.rx) mesh.rotation.x += dt * s.rx;
      if (s.rz) mesh.rotation.z += dt * s.rz;
      if (s.ry) mesh.rotation.y += dt * s.ry;
      if (node?.rebootUntil > now) mesh.rotation.y += dt * 2.2;
    }

    context.serverGlow.intensity = 3 + Math.sin(elapsed * 1.3) * 0.8;
    tickFlashPool(context.attackPool, dt, 4.5);
    tickFlashPool(context.normalPool, dt, 3.5);
    context.onUpdateEnemyPackets(dt, now);
    context.onUpdateDefensePackets(dt);
    context.onUpdateNormalPackets(dt);
    context.onUpdateScanPackets(dt);
    context.onUpdateAgents(dt, now);
    context.onUpdateFirewalls(now, dt);
    context.onUpdateNodes(dt, now);
    context.onUpdateHud();

    if (context.observerMode) {
      context.game.telemetryCooldown -= dt;
      if (context.game.telemetryCooldown <= 0) {
        context.onReportTelemetry();
        context.game.telemetryCooldown = context.game.lowLoadMode ? 1.2 : 0.35;
      }
    } else {
      context.onReportTelemetry();
    }

    context.edgeTick(context.allEdges, context.mats, now);
    const shouldRender = !context.observerMode || !context.game.lowLoadMode || frameCount % 2 === 0;
    if (shouldRender) {
      context.controls.update();
      context.composer.render();
    }
  }

  animate();
}
