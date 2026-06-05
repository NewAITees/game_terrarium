export function createObservationEvents({ game, topo, rng, logEvent, setMessage, }) {
    const state = {
        active: null,
        remaining: 16 + rng.next() * 10,
        label: 'none',
        summary: 'waiting for the next anomaly',
    };
    function availableNodes() {
        return topo.nodes.filter(node => !node.isServer);
    }
    function pickTargets(count) {
        return availableNodes()
            .slice()
            .sort(() => rng.next() - 0.5)
            .slice(0, count);
    }
    function startSignalStorm(now) {
        const targets = pickTargets(5);
        state.active = {
            key: 'signal_storm',
            label: 'Signal Storm',
            summary: 'packet flow slows while edge clusters become unstable',
            until: now + 12,
            targets,
        };
        game.environmentSpeedMultiplier = 0.72;
        logEvent('Event: Signal Storm slows the frontier and agitates hot nodes.', 'info');
        setMessage('Observation event: Signal Storm rolling across the network.');
    }
    function startMaintenanceWindow(now) {
        const targets = pickTargets(4);
        state.active = {
            key: 'maintenance_window',
            label: 'Maintenance Window',
            summary: 'calm sectors self-heal and earn passive credits',
            until: now + 10,
            targets,
        };
        game.environmentSpeedMultiplier = 1.05;
        logEvent('Event: Maintenance Window stabilizes quiet sectors.', 'info');
        setMessage('Observation event: Maintenance Window reinforcing stable nodes.');
    }
    function startEvent(now) {
        if (rng.next() < 0.5)
            startSignalStorm(now);
        else
            startMaintenanceWindow(now);
        state.label = state.active.label;
        state.summary = state.active.summary;
    }
    function endEvent() {
        if (!state.active)
            return;
        logEvent(`Event ended: ${state.active.label}.`, 'summary');
        state.active = null;
        state.label = 'none';
        state.summary = 'watching for the next anomaly';
        game.environmentSpeedMultiplier = 1;
        state.remaining = 18 + rng.next() * 14;
    }
    function applySignalStorm(active, now, dt) {
        for (const node of active.targets) {
            node.targetedUntil = Math.max(node.targetedUntil || 0, now + 0.35);
            node.infection = Math.min(1, node.infection + dt * 0.032);
        }
    }
    function applyMaintenanceWindow(active, now, dt) {
        game.credits = Math.min(999, game.credits + dt * 2.4);
        for (const node of active.targets) {
            node.hardenUntil = Math.max(node.hardenUntil || 0, now + 0.5);
            node.hp = Math.min(node.maxHp, node.hp + dt * 6);
            node.infection = Math.max(0, node.infection - dt * 0.05);
        }
    }
    function update(dt, now) {
        if (state.active) {
            if (state.active.key === 'signal_storm')
                applySignalStorm(state.active, now, dt);
            if (state.active.key === 'maintenance_window')
                applyMaintenanceWindow(state.active, now, dt);
            state.remaining = Math.max(0, state.active.until - now);
            if (now >= state.active.until)
                endEvent();
            return;
        }
        state.remaining -= dt;
        if (state.remaining <= 0)
            startEvent(now);
    }
    function getHudState() {
        if (state.active) {
            return {
                label: state.label,
                detail: `${state.summary} (${Math.ceil(state.remaining)}s left)`,
            };
        }
        return {
            label: 'Idle Grid',
            detail: `next anomaly in ${Math.ceil(state.remaining)}s`,
        };
    }
    return {
        update,
        getHudState,
    };
}
