(function () {
  const endpointBase = location.protocol === 'http:' || location.protocol === 'https:'
    ? `${location.origin}/telemetry`
    : 'http://localhost:3000/telemetry';
  const lastSent = new Map<string, number>();

  function report(page: string, payload: unknown, minIntervalMs = 1000): void {
    const now = performance.now();
    if (now - (lastSent.get(page) || 0) < minIntervalMs) return;
    lastSent.set(page, now);

    fetch(`${endpointBase}/${encodeURIComponent(page)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  window.Telemetry = { report };
}());
