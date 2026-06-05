# AI惑星戦略箱庭 実装プラン

## 目的

この文書は [AI_PLANET_STRATEGY.md](/abs/path/C:/analysis2/game_terrarium/AI_PLANET_STRATEGY.md:1) を、最初のプロトタイプを実装できる粒度まで落としたものである。

初回実装では Phase 1 と Phase 2 を対象にする。

つまり、最初に作るのは:

- 惑星が存在する
- 帝国が存在する
- 資源が採掘される
- 輸送船が物理移動する
- 工場に資源が届く
- 見ていて物流の流れが分かる

ここまでである。

戦闘、占領、砲台、外交、詳細船設計は初回対象外とする。

## 最初の実装目標

最初の成功条件は次の5つ。

1. 3帝国と複数惑星が生成される
2. 資源が採掘惑星から工場惑星へ輸送される
3. 工場が資源を消費して輸送船を追加生産する
4. 画面を見るだけで「どこからどこへ資源が流れているか」が分かる
5. 5分以上放置しても物流が継続し、帝国差が少しずつ見え始める

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
- 観察HUD
- telemetry

### 今回は入れない

- 攻撃船
- 防衛船
- 占領
- 砲台
- Ollama戦略判断
- 人の介入UI

## ファイル構成案

初回は以下の分割を推奨する。

### エントリ

- `planet_strategy.html`
- `planet_strategy.js`

### シミュレーション

- `planet_strategy_state.js`
  - world state の生成と保持
- `planet_strategy_sim.js`
  - 採掘、輸送、工場生産、時間進行
- `planet_strategy_ai.js`
  - 帝国ごとの輸送・生産方針

### 表示

- `planet_strategy_render.js`
  - Three.js の scene / camera / mesh 更新
- `planet_strategy_ui.js`
  - HUD、ログ、集計表示

### 補助

- `planet_strategy_telemetry.js`
  - `/telemetry/planet_strategy` への送信
- `planet_strategy_constants.js`
  - 各種定数

## データモデル案

初回に必要な state はこれで足りる。

### World

```js
{
  time: 0,
  planets: [],
  empires: [],
  ships: [],
  routes: [],
  events: [],
}
```

### Planet

```js
{
  id: "p0",
  x: 0,
  z: 0,
  resources: 480,
  mineRate: 1.2,
  owner: 0,
  type: "mine" | "factory" | "mixed",
  stock: 0,
  structures: {
    mine: 1,
    factory: 0,
  },
  productionQueue: [],
}
```

### Empire

```js
{
  id: 0,
  name: "Empire A",
  color: "#7de8ff",
  personality: "industrialist",
  credits: 0,
  intent: "expand logistics",
  homePlanetId: "p0",
}
```

### Ship

```js
{
  id: "s0",
  kind: "transport",
  owner: 0,
  fromPlanetId: "p0",
  toPlanetId: "p3",
  progress: 0,
  speed: 0.18,
  cargo: 24,
  cargoType: "resource",
  status: "loading" | "travel" | "unloading" | "idle",
}
```

### Route

```js
{
  fromPlanetId: "p0",
  toPlanetId: "p3",
  traffic: 18,
}
```

## 惑星タイプの初期単純化

初回は自由度を下げる。

- 各帝国に `採掘惑星 1`
- 各帝国に `工場惑星 1`
- 中立惑星を数個

こうすると、最初から物流ループが発生しやすい。

後で `mixed` 惑星や複数工場に広げる。

## 初期生成ルール

### 惑星数

- 12 から 18 惑星

### 帝国数

- 3 帝国固定

### 配置

- 全体を円形か楕円形に散らす
- 各帝国の初期2惑星は近め
- 中立惑星は中央や外周に散らす

### 資源量

- 採掘惑星: 高め
- 工場惑星: 中程度
- 中立惑星: ばらつき

## シミュレーションループ案

初回はフレームごとに全部判断しない。

### 毎フレーム

- 船の移動
- 描画更新

### 0.5秒ごと

- 惑星採掘
- 積み込み / 降ろし処理

### 2秒ごと

- 帝国AIの物流判断
- 不足工場への配送先見直し

### 5秒ごと

- 工場の生産判断
- 輸送船追加生成判断
- 帝国意図テキスト更新

これで軽さと見やすさのバランスを取る。

## AI方針の初期単純化

初回の帝国AIは、完全な戦略AIにしない。

### industrialist

- 工場惑星への供給を優先
- 輸送船を増やしやすい

### raider

- 今回は戦闘未実装なので、遠距離中立惑星へ先回り気味に輸送網を広げる性格として表現する

### expansionist

- 資源の多い中立惑星を次の中継候補として狙う
- 工場増設候補を広めに取る

### fortifier

- 近い安全なルートを優先
- 工場供給の偏りを減らす

つまり初回は「戦闘差」ではなく「物流設計差」で性格を見せる。

## 工場生産の初期ルール

初回は船種を `transport` のみに絞ってよい。

工場は:

- 必要資源がたまったら輸送船を1隻生産
- 上限隻数を超えたら停止
- 資源不足なら待機

### 初期定数案

- 輸送船コスト: 20
- 積載量: 50
- 速度: 0.18
- 1帝国あたり初期輸送船: 2
- 輸送船上限: 10

## 観察UIの責務

初回HUDは以下に絞る。

### Empire Summary

- 惑星数
- 総資源 stock
- 輸送船数
- 現在意図

### World Summary

- 総採掘量
- 総輸送量
- 最も混雑している航路
- 資源切れ惑星数

### Event Log

- 新しい輸送船完成
- 工場停止
- 資源枯渇
- 主要航路の混雑

## 可視化責務

### planet_strategy_render.js

- 惑星 mesh 生成
- 惑星サイズと色の更新
- 輸送船 mesh 更新
- 主要航路 line の表示
- 採掘 / 降ろしの軽いフラッシュ

### 初回の見え方ルール

- 惑星サイズ = 残資源量
- 惑星リング = stock
- 航路の明るさ = traffic
- 輸送船の数 = 物流密度

これで「物流が見える」状態を作る。

## API / Telemetry 方針

初回から telemetry を入れる。

送信名:

- `planet_strategy`

送る内容:

```js
{
  elapsed,
  planets,
  ships,
  empires: [
    { id, planets, stock, transports, intent }
  ],
  totalResources,
  totalStock,
  busiestRoute,
  depletedPlanets,
}
```

外部確認APIは既存の形式に合わせて:

- `/api/progress/planet_strategy`

を使えるようにする。

## 実装順序

### Step 1

- `planet_strategy.html`
- `planet_strategy.js`
- Three.js scene だけ表示

### Step 2

- 惑星生成
- 帝国生成
- 色分け

### Step 3

- 採掘ループ
- stock 増加
- HUD表示

### Step 4

- 輸送船生成
- from / to の移動
- 積み込み / 降ろし

### Step 5

- 工場生産ループ
- 航路 traffic 集計
- event log

### Step 6

- telemetry
- `/api/progress` 連携確認

## 実装上の注意

### 1. いきなり自由航行の最適化をやらない

初回は直線移動で十分。

### 2. いきなり戦闘を入れない

物流が成立する前に戦闘を入れると、何が面白いのかが崩れる。

### 3. 工場停止が見えることを優先する

このゲームの最初の面白さは「供給が切れると止まる」ことにある。

### 4. HUDに数字を詰め込みすぎない

最初は流れが読めることを優先する。

## 初回完了の判定

次を満たしたら初回プロトタイプ完了とする。

1. 3帝国の物流差が数分で見え始める
2. 工場惑星の供給不足 / 過剰が見える
3. 航路の混雑が視覚化される
4. telemetry で進捗を外部確認できる
5. 5分放置しても意味のある動きが続く
