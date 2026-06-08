type ClockLike = { getDelta: () => number };

export function startAnimationFrameLoop(context: {
  clock: ClockLike;
  step: (dt: number, now: number) => void;
  maxDelta?: number;
  render?: () => void;
}): void {
  function animate(): void {
    requestAnimationFrame(animate);
    const dt = Math.min(context.clock.getDelta(), context.maxDelta ?? 0.05);
    const now = performance.now() / 1000;
    context.step(dt, now);
    context.render?.();
  }

  animate();
}

export function bindComposerResize(context: {
  camera: { aspect: number; updateProjectionMatrix: () => void };
  renderer?: { setSize: (width: number, height: number) => void };
  composer?: { setSize: (width: number, height: number) => void };
  onResize?: () => void;
}): void {
  window.addEventListener('resize', () => {
    context.camera.aspect = innerWidth / innerHeight;
    context.camera.updateProjectionMatrix();
    context.renderer?.setSize(innerWidth, innerHeight);
    context.composer?.setSize(innerWidth, innerHeight);
    context.onResize?.();
  });
}

export function startHiddenTabLoop(context: {
  step: (dt: number) => void;
  shouldTick?: () => boolean;
  isHidden?: () => boolean;
  maxDelta?: number;
}): void {
  const channel = new MessageChannel();
  let lastTick = performance.now();

  channel.port1.onmessage = () => {
    if (!(context.isHidden?.() ?? document.visibilityState === 'hidden')) {
      channel.port2.postMessage(0);
      return;
    }

    const now = performance.now();
    const dt = Math.min((now - lastTick) / 1000, context.maxDelta ?? 0.05);
    lastTick = now;
    if (context.shouldTick?.() ?? true) {
      context.step(dt);
    }
    channel.port2.postMessage(0);
  };

  document.addEventListener('visibilitychange', () => {
    if (context.isHidden?.() ?? document.visibilityState === 'hidden') {
      lastTick = performance.now();
      channel.port2.postMessage(0);
    }
  });

  if (context.isHidden?.() ?? document.visibilityState === 'hidden') {
    lastTick = performance.now();
    channel.port2.postMessage(0);
  }
}
