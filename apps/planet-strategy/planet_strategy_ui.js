export function createPlanetStrategyUi() {
    const el = {
        elapsed: document.getElementById('elapsed'),
        planets: document.getElementById('planets'),
        ships: document.getElementById('ships'),
        mined: document.getElementById('mined'),
        moved: document.getElementById('moved'),
        kills: document.getElementById('kills'),
        summaryText: document.getElementById('summary-text'),
        summaryDetail: document.getElementById('summary-detail'),
        busiestRoute: document.getElementById('busiest-route'),
        phaseLine: document.getElementById('phase-line'),
        winnerLine: document.getElementById('winner-line'),
        statusDetail: document.getElementById('status-detail'),
        scoreList: document.getElementById('score-list'),
        finalHeadline: document.getElementById('final-headline'),
        finalDetail: document.getElementById('final-detail'),
        finalMeta: document.getElementById('final-meta'),
        empireList: document.getElementById('empire-list'),
        logEntries: document.getElementById('log-entries'),
        resourceBurstBtn: document.getElementById('resource-burst-btn'),
        panicRepairBtn: document.getElementById('panic-repair-btn'),
    };
    const uiState = {
        firstStalledFactory: null,
    };
    el.resourceBurstBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('planet-strategy-intervention', { detail: { type: 'resource_burst' } }));
    });
    el.panicRepairBtn?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('planet-strategy-intervention', { detail: { type: 'panic_repair' } }));
    });
    function update(view) {
        if (el.elapsed)
            el.elapsed.textContent = String(view.elapsed ?? '');
        if (el.planets)
            el.planets.textContent = String(view.planets ?? '');
        if (el.ships)
            el.ships.textContent = String(view.ships ?? '');
        if (el.mined)
            el.mined.textContent = String(view.mined ?? '');
        if (el.moved)
            el.moved.textContent = String(view.moved ?? '');
        if (el.kills)
            el.kills.textContent = String(view.kills ?? '');
        if (el.summaryText)
            el.summaryText.textContent = view.summaryText ?? '';
        if (el.summaryDetail)
            el.summaryDetail.textContent = view.summaryDetail ?? '';
        if (el.busiestRoute)
            el.busiestRoute.textContent = view.busiestRoute ?? '';
        if (el.phaseLine)
            el.phaseLine.textContent = view.phaseLine ?? '';
        if (el.winnerLine)
            el.winnerLine.textContent = view.winnerLine ?? '';
        if (el.statusDetail)
            el.statusDetail.textContent = view.statusDetail ?? '';
        if (el.finalHeadline)
            el.finalHeadline.textContent = buildHeadline(view);
        if (el.finalDetail)
            el.finalDetail.textContent = buildDetail(view);
        if (el.finalMeta)
            el.finalMeta.textContent = buildMeta(view);
        if (el.scoreList) {
            el.scoreList.innerHTML = (view.scoreRows ?? []).map((score) => [
                '<div class="score-row">',
                `<div class="score-name">${score.name}${score.collapsed ? ' [collapsed]' : ''}</div>`,
                `<div class="score-value">${score.value}</div>`,
                '</div>',
            ].join('')).join('');
        }
        if (el.empireList) {
            el.empireList.innerHTML = (view.empireRows ?? []).map((empire) => [
                '<div class="empire-row">',
                `<div class="empire-dot" style="background:${empire.color}"></div>`,
                `<div class="empire-meta"><div class="empire-name">${empire.name}</div><div class="empire-intent">${empire.intent}</div></div>`,
                `<div class="empire-numbers">${empire.numbers}</div>`,
                '</div>',
            ].join('')).join('');
        }
    }
    function log(text, type) {
        if (!el.logEntries)
            return;
        if (!uiState.firstStalledFactory && /factory stalling for ore/i.test(text)) {
            const match = text.match(/\]\s(.+?) factory stalling for ore/i);
            uiState.firstStalledFactory = match?.[1] ?? 'Unknown factory';
        }
        const div = document.createElement('div');
        div.className = `le le-${type}`;
        div.textContent = text;
        el.logEntries.appendChild(div);
        while (el.logEntries.children.length > 220)
            el.logEntries.removeChild(el.logEntries.firstChild);
        el.logEntries.scrollTop = el.logEntries.scrollHeight;
    }
    function buildHeadline(view) {
        if (view.gameOver && view.winnerName) {
            return `${view.winnerName} closed the match by outlasting the other sectors.`;
        }
        if (view.topDeliveryEmpire) {
            return `${view.topDeliveryEmpire} is moving the most ore through the sector.`;
        }
        return 'Watching early logistics spread across the sector.';
    }
    function buildDetail(view) {
        if (view.gameOver && view.summaryDetail)
            return view.summaryDetail;
        if (uiState.firstStalledFactory) {
            return `${uiState.firstStalledFactory} was the first factory to stall under pressure.`;
        }
        return 'No final result yet.';
    }
    function buildMeta(view) {
        const parts = [];
        if (view.busiestRouteLabel)
            parts.push(`Busiest: ${view.busiestRouteLabel}`);
        if (typeof view.depletedCount === 'number')
            parts.push(`Depleted: ${view.depletedCount}`);
        if (view.topDeliveryEmpire)
            parts.push(`Top delivery: ${view.topDeliveryEmpire}`);
        return parts.join(' / ') || 'Waiting for more movement.';
    }
    return { update, log };
}
