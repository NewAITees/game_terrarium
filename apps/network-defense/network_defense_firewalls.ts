export function firewallKey(edge: any, edgeKey: (a: any, b: any) => string) {
  return edgeKey(edge.an.id, edge.bn.id);
}

export function deployFirewall(context: {
  edge: any;
  now: number;
  firewalls: Map<any, any>;
  visuals: any;
  edgeKey: (a: any, b: any) => string;
}): void {
  const { edge, now, firewalls, visuals, edgeKey } = context;
  if (!edge) return;
  const key = firewallKey(edge, edgeKey);
  const existing = firewalls.get(key);
  if (existing) {
    existing.until = Math.max(existing.until, now + 18);
    return;
  }

  const group = visuals.createFirewall(edge);
  firewalls.set(key, { edge, visual: group, until: now + 18 });
}

export function updateFirewalls(context: {
  firewalls: Map<any, any>;
  visuals: any;
  now: number;
}): void {
  const { firewalls, visuals, now } = context;
  for (const [key, firewall] of firewalls) {
    visuals.updateFirewall(firewall.visual, now);
    if (firewall.until <= now) {
      visuals.destroyFirewall(firewall.visual);
      firewalls.delete(key);
    }
  }
}
