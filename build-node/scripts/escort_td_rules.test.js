"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const escort_td_rules_1 = require("../game/escort_td_rules");
(0, node_test_1.default)('normalizes meta progress and derives its starting values', () => {
    const meta = (0, escort_td_rules_1.normalizeEscortMeta)({ startGoldLevel: 1.8, kingHpLevel: 2, unitLimitLevel: 99 });
    strict_1.default.deepEqual(meta, { startGoldLevel: 1, kingHpLevel: 2, unitLimitLevel: 20 });
    strict_1.default.deepEqual((0, escort_td_rules_1.getEscortMetaValues)(meta), { startGold: 130, kingHpMax: 600, unitLimit: 26 });
    strict_1.default.equal((0, escort_td_rules_1.getEscortMetaUpgradeCost)(0), 10);
    strict_1.default.equal((0, escort_td_rules_1.getEscortMetaUpgradeCost)(1), 25);
});
(0, node_test_1.default)('coverage is a percentage of detected forward samples', () => {
    strict_1.default.equal((0, escort_td_rules_1.calculateEscortCoverage)(8, (index) => index <= 5), 63);
    strict_1.default.equal((0, escort_td_rules_1.calculateEscortCoverage)(0, () => false), 100);
});
(0, node_test_1.default)('run result rewards progress, enemy tiers, victory, and minimum chips', () => {
    strict_1.default.deepEqual((0, escort_td_rules_1.calculateEscortResult)('failed', 40, { ground: 5, air: 2, siege: 1 }), { score: 412, chips: 4 });
    strict_1.default.deepEqual((0, escort_td_rules_1.calculateEscortResult)('cleared', 100, { ground: 0, air: 0, siege: 0 }), { score: 1500, chips: 15 });
    strict_1.default.equal((0, escort_td_rules_1.calculateEscortResult)('failed', 0, { ground: 0, air: 0, siege: 0 }).chips, 1);
});
(0, node_test_1.default)('reclaim returns 70 percent rounded down', () => {
    strict_1.default.equal((0, escort_td_rules_1.getEscortReclaimGold)(90), 63);
    strict_1.default.equal((0, escort_td_rules_1.getEscortReclaimGold)(40), 28);
});
