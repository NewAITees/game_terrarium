# AI Planet Strategy — 改善TODO

ソース: `AI_PLANET_8MIN_RULESET.md`  
担当分割: Claude Sonnet (core logic) / Other AI (render / UI / HTML)

---

## Claude Sonnet 担当（`planet_strategy.js` / `planet_strategy_ui.js`）

### P1 — 崩壊条件の修正 `planet_strategy.js`

**現状:** `evaluateEmpireCollapse` が「全惑星喪失」で崩壊判定している  
**正しい条件 (RULESET):**
- 工場惑星（`homeFactoryId`）を失った時点で崩壊
- 稼働中の輸送船が 0
- 支配惑星が 0

```js
// 修正箇所: evaluateEmpireCollapse 内
const hasFactory = getPlanet(empire.homeFactoryId)?.owner === empire.id;
if (!hasFactory) collapseEmpire(empire, 'lost its factory planet');
```

- [ ] `evaluateEmpireCollapse` を工場惑星喪失条件に修正

---

### P2 — 資源総量圧縮 `planet_strategy.js`

**現状:** `initialResources = 220 + floor(rng() * 520)` → 220〜740  
**目標 (RULESET -35%):** 140〜480

```js
// 修正前
const initialResources = 220 + Math.floor(rng() * 520);
// 修正後
const initialResources = 140 + Math.floor(rng() * 340);
```

- [ ] `createWorld` の initialResources を約-35%に圧縮

---

### P3 — shipCap 調整 `planet_strategy.js`

**現状:** industrialist=12, fortifier=8, others=10  
**目標 (RULESET):** 上限 6〜8

```js
// 修正前
shipCap: personality.key === 'industrialist' ? 12 : personality.key === 'fortifier' ? 8 : 10,
// 修正後
shipCap: personality.key === 'industrialist' ? 8 : personality.key === 'fortifier' ? 6 : 7,
```

- [ ] `createWorld` 内の shipCap を 6〜8 に引き下げ

---

### P4 — 終盤圧迫イベント `planet_strategy.js`

**目標 (RULESET):** 5分以降に `ore_falloff` を1回発火  
- 全採掘量が20秒間 50% 低下
- `evaluateMatchState` または `updateWorld` で5分判定後に一度だけ発火

- [ ] `ore_falloff` イベントを実装（world.oreFalloffTriggered フラグで重複防止）
- [ ] `updateWorld` に5分判定 + 発火処理を追加

---

### P5 — planet_strategy_ui.js の #depleted バグ修正

**現状:** `planet_strategy_ui.js` line 8 が `#depleted` を参照しているが、HTMLには `#kills` しか存在しない

- [ ] `el.depleted` 参照を削除または `el.kills` に変更
- [ ] `update()` の `el.depleted.textContent` 行を対応修正

---

## Other AI 担当

### `planet_strategy_render.js` — ビジュアル改善

担当範囲: Three.js シーン・惑星・船・ルートのレンダリング

- [ ] 接戦惑星のフラッシュ/パルス強化
- [ ] 船トレイルエフェクト
- [ ] 枯渇惑星の視覚変化（暗く・縮小）強化
- [ ] stalled工場の視覚警告（赤いパルスなど）

---

### `planet_strategy_ui.js` — 終了サマリ充実

担当範囲: updateHud の view オブジェクト生成 + サマリ文章

**RULESET要求:**
- [ ] 最大配送帝国（`view.topDeliveryEmpire`）
- [ ] 最も混雑した航路（`view.busiestRoute` の充実）
- [ ] 最初に止まった工場（`view.firstStalledFactory`）
- [ ] 枯渇した惑星数（`view.depletedCount`）
- [ ] 一文サマリ生成（勝敗要因を反映した文章）

---

### `planet_strategy.html` — 介入ボタン追加

担当範囲: HTML + CSS

**RULESET要求介入 (1〜2種):**
- [ ] `resource_burst` — 指定惑星のstockを即時増加
- [ ] `panic_repair` — stalled工場を短時間復旧

---

### `planet_strategy_telemetry.js` — テレメトリ充実

担当範囲: world状態のAPI送信

- [ ] match終了時のfinalScores送信
- [ ] 崩壊帝国情報の送信
- [ ] 各帝国のVictoryScore内訳送信

---

## 完了済み

- [x] 8分/10分タイマー実装
- [x] Victory Score計算
- [x] finalizeMatch / evaluateEmpireCollapse 骨格
- [x] 工場維持コスト (FACTORY_MAINTENANCE_COST)
- [x] stalled状態と45秒崩壊タイマー
- [x] HUD: phase-line / winner-line / score-list
- [x] Bloom + 星空 + 曲線ルート + 船の種類別形状
- [x] 惑星周回 + 戦闘システム骨格

---

## ファイル担当マップ

| ファイル | 担当 | 状態 |
|---|---|---|
| `planet_strategy.js` | Claude Sonnet | P1〜P4作業中 |
| `planet_strategy_render.js` | Other AI | 未着手 |
| `planet_strategy_ui.js` | Claude Sonnet (bugfix) / Other AI (summary) | バグ修正待ち |
| `planet_strategy_telemetry.js` | Other AI | 未着手 |
| `planet_strategy.html` | Other AI | 未着手 |
