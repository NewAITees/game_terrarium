# AI惑星戦略箱庭 実装プラン

## 目的

この文書は、`apps/planet-strategy/` の初期実装方針をまとめた参照用ノートである。
現行の本体はすでに TypeScript ベースで動作しているため、JS 時代のファイル構成ではなく、現在のモジュール構成を前提に読む。

## 現在の状態

- `planet_strategy` は `apps/planet-strategy/*.ts` に分割済み
- `planet_strategy_render.ts`, `planet_strategy_ui.ts`, `planet_strategy_telemetry.ts`, `planet_strategy_ai_*.ts` がある
- 旧 JS 構成は `docs/old/AI_PLANET_IMPLEMENTATION_PLAN_legacy_js.md` に退避済み

## 当初の目標

初回実装では以下を作ることを目標にしていた。

- 惑星が存在する
- 帝国が存在する
- 資源が採掘される
- 輸送船が物理移動する
- 工場に資源が届く
- 物流の流れが見て分かる

戦闘、占領、砲台、外交、詳細船設計は初回対象外だった。

## 実装スコープ

### Phase 1

- 惑星生成
- 帝国生成
- 初期拠点配置
- 資源採掘
- 惑星表示

### Phase 2

- 輸送船生成
- 積み込み / 降ろし
- 物流先選択
- 工場の生産サイクル
- 輸送航路の可視化
- 観察 HUD
- telemetry

## 旧ファイル名

以下は当時の JS 前提の構成案で、今は使っていない。

- `planet_strategy.html`
- `planet_strategy.js`
- `planet_strategy_state.js`
- `planet_strategy_sim.js`
- `planet_strategy_ai.js`
- `planet_strategy_render.js`
- `planet_strategy_ui.js`
- `planet_strategy_telemetry.js`
- `planet_strategy_constants.js`

## 現行の対応先

- `planet_strategy.html`
- `planet_strategy.ts`
- `planet_strategy_state.ts`
- `planet_strategy_sim.ts`
- `planet_strategy_ai_*.ts`
- `planet_strategy_render.ts`
- `planet_strategy_ui.ts`
- `planet_strategy_telemetry.ts`
- `planet_strategy_constants.ts`

## メモ

この文書は「最初にどう切り分けたか」の記録として残しておく。
新しい作業では、今ある TS モジュールを基準に読むこと。
