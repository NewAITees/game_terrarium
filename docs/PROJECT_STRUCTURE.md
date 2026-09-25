# Project Structure

`game_terrarium` の構造マップ。3段階（全体ツリー → 領域地図 → 実装対応）で整理する。
プロジェクトの目的・思想は [README.md](../README.md) を参照。RLリサーチパイプラインの詳細は [CLAUDE.md](../CLAUDE.md) を参照。

## 1. Project Tree

```
game_terrarium/
├── main.ts, preload.ts          # Electronメインプロセス / プリロード（IPC、コマンドパレット）
├── server.ts, server_assets.ts, server_ollama.ts
│                                 # Express + WebSocketゲームサーバー（port 3000）
├── vite.config.ts                # ブラウザ側ビルド（apps/ → build/）
├── tsconfig.json                 # ブラウザ側 型チェック対象
├── tsconfig.node.json            # Node側ビルド（main.ts/server.ts/game/** → build-node/）
│
├── apps/                         # ブラウザ側の各ゲーム/可視化（.html + .ts、Viteでバンドル）
├── game/                         # サーバー側ゲームロジック・ランタイム
├── shared/                       # ブラウザ・サーバー共有モジュール
│   ├── types/                    # ドメイン型定義（アプリごと）
│   └── rl/                       # 強化学習フレームワーク共通部品
├── scripts/                      # ヘッドレスsim・学習・テスト・RLリサーチCLI
├── docs/                         # 設計書・調査ノート
├── agent_rules/, faction_rules/  # 旧世代のJSONルールエンジン（RL以前の例外、新規拡張禁止）
├── pages/                        # Electron直読み込みの静的HTML（ナビ非経由）
├── public/                       # 静的配信ファイル（draco decoder等）
├── assets/                       # 3Dモデル・スプライト等アート素材
├── launchers/                    # macOS用 .command 個別起動ボタン
├── logs/                         # RLリサーチのledger等（gitignore対象）
└── tasks/                        # 作業中タスク・振り返りメモ（gitignore対象、マシンローカル）
```

## 2. 領域地図（ドメインマップ）

### 2.1 実行基盤

| 領域 | 役割 |
|---|---|
| Electron (`main.ts`) | 常時最前面ウィンドウ、ページ切り替え、トレイ/メニュー |
| Express + WS (`server.ts`) | ゲーム状態配信、`/electron/action`、`/submarine-data/:kind` プロキシ |
| ページレジストリ (`shared/page_registry.ts`) | 全ページの唯一の情報源（key/label/accelerator/URL）。コマンドパレット・トレイ・メニュー・ショートカット・`POST /electron/action` が全てここから引く |

### 2.2 ゲーム/可視化アプリ（`apps/` 配下、`shared/page_registry.ts` 登録順）

| Ctrl番号 | key | 表示名 | ジャンル/性質 |
|---|---|---|---|
| 0 | `planet_strategy` | AI Planet Strategy | 4X戦略、AIパーソナリティ実装（expansionist/fortifier/industrialist/raider）、最もアクティブな観察対象 |
| 1 | `city` | City Traffic | 交通シミュレーション可視化（信号・車の学習ではなくルールベース挙動、昼夜サイクル） |
| 2 | `moss` | MOSS | セルオートマトン的成長シミュレーション |
| 3 | `escort_td` | Escort TD | タワーディフェンス（V2でKING拠点防衛×放置メタ×迷路構築へピボット中、`docs/GAME_DESIGN_ESCORT_TD_V2.md`） |
| 4 | `net_sw` | Network Small World | ネットワークトポロジー可視化 |
| 5 | `submarine` | Submarine Cables | 海底ケーブル地図（`submarinecablemap.com` プロキシ） |
| 6 | `submarine_3d` | Submarine Network 3D | 同上の3D版 |
| 7 | `net_defense` | Network Tower Defense | JSONルールエンジン（`agent_rules/`）+ RL実験対象。旧世代ルールベースの例外枠 |
| 8 | `net_ecosystem` | Network Ecosystem | ネットワーク生態系シミュレーション |
| 9 | `colony` | AI Colony Sandbox | JSONルールエンジン（`faction_rules/`）による陣営行動。旧世代ルールベースの例外枠 |
| 10 | `arena_shooter` | RL Arena Shooter | **RL学習対象**（`shared/rl/experiment_spec.ts` 準拠） |
| 11 | `drone_bastion` | Drone Bastion TD | **RL学習対象**（Double DQN比較あり） |
| 12 | `ai_restoration` | AI Restoration Alpha | 画像/描画系の実験ページ |
| 13 | `zombie_survivor` | Zombie Survivor | サバイバー系、エージェント制御（camp/combat agent） |
| 14 | `one_line_rpg` | One-Line RPG | 「なんとなく勝てない」フェーズ制コンバット、`docs/GAME_DESIGN_ONE_LINE_RPG.md` |
| 15 | `gunship` | Gravity Gunship | **RL学習対象**（自動リサーチ済み、`docs/IMPLEMENTATION_GUNSHIP.md`） |
| 16 | `sorting_warehouse` | Sorting Terrarium | 倉庫ソートシミュレーション |

補足:
- `network-defense` と `colony` の `agent_rules/` / `faction_rules/` は **RL以前の例外であり、新規拡張の前例にしない**（`CLAUDE.md` 明記）。
- `game/engine.ts` のローグライク・ダンジョンエンジンは `apps/` 経由ではなく `public/index.html` へ直接WS配信（`getAIState()` / `getFullState()` の視界分離が肝）。専用の `apps/` ページは持たない。

### 2.3 強化学習リサーチパイプライン（`gunship` / `drone-bastion` / `arena-shooter` 対象）

```
shared/rl/experiment_spec.ts   … ExperimentSpec / RlGameAdapter 定義（観測・行動・報酬の宣言）
scripts/rl/*_experiment.ts     … ゲームごとのアダプタ実装
scripts/rl/auto_research.ts    … npm run research（候補生成→並列評価→ledger追記）
scripts/rl/research_advisor.ts … npm run research:advise（外部モデルへ次の一手を相談、宣言外は提案止まり）
scripts/rl/protected_surface.ts… シード分割・昇格統計・ledger・train→evaluate順序をハッシュで封印
scripts/rl/publish_champion.ts … npm run research:publish（チャンピオンモデルを実プレイヤーへ反映）
logs/rl-research/<game>.jsonl  … 追記専用ledger（gitignore対象、正本）
logs/rl-research/models/<id>.json … チャンピオンの学習済みモデル
```

挙動は全て学習で決まる。**手書きプライア/ifラダー/スクリプトフォールバックは禁止**（`shared/rl/` に `initialValues` を再導入しない）。詳細は `CLAUDE.md` の「Rule: no hand-authored policy」節。

### 2.4 共有基盤（`shared/`）

| モジュール | 役割 |
|---|---|
| `browser-runtime.ts` | requestAnimationFrameループ、コンポーザーリサイズ等の共通ブラウザ配線 |
| `page_registry.ts` | 2.1参照 |
| `telemetry-client.ts` | `window.Telemetry.report(...)` の共通実装 |
| `network-core*.ts`, `network-core-wasm/` | ネットワーク系アプリ共通のトポロジー/パケット/WASM連携 |
| `planet_strategy_fleet.ts`, `planet_strategy_watchability.ts` | Planet Strategy専用の共有ロジック |
| `types/` | アプリごとのスナップショット型（`CityTrafficStateSnapshot` 等）。サーバーとクライアントの契約 |
| `rl/` | 2.3のRL共通部品（agent実装、シード分割、モデル永続化） |
| `vfx-elemental/` | 汎用エフェクトアセット |

## 3. 実装対応（ビルド・型チェックの配線）

新しいブラウザ側エントリポイントを追加する際、**両方**に登録しないと片方だけ静かに壊れる：

1. `vite.config.ts` の `rollupOptions.input`（バンドル対象）
2. `tsconfig.json` の `include`（型チェック対象）

サーバー/Node側（`main.ts`, `server.ts`, `game/**`, `scripts/**`, 一部の `apps/**` RLコアロジック）は別系統で `tsconfig.node.json` により `tsc` が直接 `build-node/` へコンパイルする（Viteは関与しない）。

```
apps/**/*.ts (named import from 'three', import type 分離)
        │  vite build
        ▼
build/                          ← ブラウザへ配信（Express静的配信 + /_vendor/ にThree.js等の共有チャンク）

main.ts, server.ts, game/**/*.ts, scripts/**/*.ts
        │  tsc -p tsconfig.node.json
        ▼
build-node/                     ← Electron/Node側で実行
```

- 新規ブラウザ側ソースは必ず `.ts`（`apps/` / `shared/` 配下に `.js` を作らない）
- Three.jsは named import のみ（`import * as THREE` 禁止、tree-shaking目的）
- 型のみのimportは `import type`
- 新しいページを追加したら `shared/page_registry.ts` に1件足すだけで、コマンドパレット・トレイ・メニュー・ショートカット・`/electron/action` が自動追従する

## 関連ドキュメント

- 動作原則・RLリサーチ運用の全詳細: [CLAUDE.md](../CLAUDE.md)
- プロジェクトの目的・観察体験としての狙い: [README.md](../README.md)
- 各ゲームの設計書: `docs/GAME_DESIGN_*.md`
