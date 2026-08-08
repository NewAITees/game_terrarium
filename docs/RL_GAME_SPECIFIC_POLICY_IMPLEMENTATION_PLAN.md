# ゲーム特性別RL方策・実装計画

## 1. 目的

本リポジトリでは、すべてのゲームへ同じ強化学習手法を適用しない。ゲームごとに、状態空間、行動空間、時間依存、オブジェクト数、信用割当、必要な学習量が異なるためである。

本計画では、現在の `TabularQAgent` を軽量な基準系として維持しながら、必要なゲームだけを DQN、PPO、階層方策、マルチエージェント方策へ段階的に移行する。採用判断は「新しい手法の方が高度だから」ではなく、固定条件の評価で現行手法の限界が確認されたかどうかで行う。

原則は次の通りとする。

1. ゲームの目的、終了条件、構造化された完全状態を先に確定する。
2. Raw、Engineered、Minimal の観測を環境本体から分離する。
3. Sparse なタスク報酬を固定し、補助報酬を別成分として追加する。
4. 最小の手法を基準にし、性能上の理由がある場合だけ複雑な手法へ進む。
5. 学習時の合成報酬ではなく、勝率、生存時間、到達 wave などのゲーム固有指標で比較する。
6. headless学習と表示プレイは並列実行し、同じ環境coreを利用する。
7. headlessだけが学習済みモデルを書き、表示プレイは公開済みsnapshotで推論する。

## 2. 手法の選択基準

| ゲーム特性 | 第一候補 | 採用理由 |
|---|---|---|
| 少数の離散状態、離散行動、短い遅延 | Tabular Q | 軽量で説明しやすく、ブラウザ内の継続学習と保存が容易 |
| 固定長の連続ベクトル、離散行動 | Double DQN | 近い状態間で経験を共有し、粗い離散化による情報欠落を減らせる |
| 連続移動、連続旋回、連続出力 | PPO | 離散的な複合操作を列挙せず、連続方策として扱える |
| 長い遅延、高レベル判断と低レベル操作の混在 | 階層方策 | 目標選択と瞬間操作を分け、行動空間と信用割当を単純化できる |
| 同時に複数ユニットが行動 | 役割別方策またはマルチエージェントRL | 共有報酬だけでは各ユニットの寄与を判断しにくい |
| 可変個数のノード、敵、ユニット | 集約ベクトルから開始し、必要なら Attention / GNN | 固定長化による空間情報の欠落を段階的に解消する |
| 現在観測だけでは速度やフェーズが分からない | 速度・タイマー追加、frame stack、必要ならRNN | アルゴリズム変更より先に非マルコフ性を解消する |

画像入力は独立したセンサーモダリティ実験とし、通常の方策改善には含めない。ゲーム内部の構造化状態を利用できる限り、ベクトル観測を標準とする。

## 3. ゲーム別の推奨方策

### 3.1 現行RLゲーム

| ゲーム | 現状 | 当面の標準方策 | 次段階 | 移行条件 |
|---|---|---|---|---|
| One Line RPG | フェーズと距離帯を使うTabular Q。戦闘と強化を分離 | Tabular Qを維持 | frame stack付きDQNまたは小型RNN | 同じ状態キーでTD targetの分散が高く、敵フェーズ追加でも解消しない場合 |
| Zombie Survivor Camp | 少数資源帯と6行動のTabular Q | Tabular Qを維持 | contextual banditまたは小型DQN | 状態数増加ではなく、準備選択の長期信用割当が主要な失敗原因になった場合 |
| Zombie Survivor Combat | 離散戦闘状態のTabular Q | Tabular Qを基準に再評価 | DQN | 敵数や位置関係を追加すると訪問状態が急増し、Minimal観測では戦闘性能が頭打ちになる場合 |
| Network Defense | 役職別Tabular Q、集約観測、共有成果報酬 | 役職別Tabular Qを基準として維持 | 固定長DQN、その後に共有encoder＋役職別head | 感染分布の集約によるaliasing、または複数役職の信用割当が評価上の主要因になった場合 |
| Drone Bastion | 360程度のMinimalキーと96値dense観測 | Tabular Qを基準として固定 | 96値入力のDouble DQN | Minimalで落としている壁、自機HP、脅威方向が最適行動を変え、DQNが複数seedで改善した場合 |
| Arena Shooter | 方向センサーと離散複合行動のTabular Q | Tabular QをStage Aとして維持 | Double DQN、将来はPPO | DQNは連続観測の一般化が必要な場合。PPOは旋回・推力を連続化する場合 |
| Gunship | Tabular Qと独立した強化選択方策 | Tabular Qを基準として維持 | Double DQN、次に階層方策 | 武器・敵・機体差による状態爆発、または目標選択と操縦の信用割当が干渉する場合 |

### 3.2 戦略・管理ゲーム

| ゲーム | 推奨アプローチ | 理由 |
|---|---|---|
| Planet Strategy | まず scripted baseline とログ評価。RL化するなら高レベルの離散方策 | 1行動の効果が長期間残り、低頻度の戦略判断が中心。フレーム単位DQN/PPOには向かない |
| Colony | 階層方策または役割別方策。最初はルールとの比較 | 個体単位操作より、仕事配分・優先順位・介入タイミングの方が学習単位として自然 |
| Escort TD | 配置・強化は離散高レベル方策、ユニット移動が必要なら別の制御方策 | 戦略判断とリアルタイム制御の時間スケールが異なる |
| City Traffic | 信号制御単位のDQNから開始。連続周期を学ぶならPPO | 交差点状態は固定長化しやすいが、複数交差点では協調と遅延報酬が問題になる |

### 3.3 ネットワーク・生態系シミュレーション

| ゲーム | 推奨アプローチ | 理由 |
|---|---|---|
| Network Ecosystem | グローバルな介入は小さな離散方策。局所行動はルールを維持 | 学習対象を明確な介入へ限定しないと、観察用シミュレーションの因果が読みにくくなる |
| MOSS | ルーティング候補が固定ならDQN、可変グラフなら将来GNN | ノードIDそのものではなく、混雑・距離・障害などの関係表現が必要 |
| Network Smallworld | RL環境化より先に介入可能な行動と成功条件を定義 | 現状は観測対象であり、最適化目的が曖昧なままアルゴリズムを選べない |
| Submarine Cables / 3D | 修復・増強の離散計画方策。可変グラフ対応は後段 | 長期的な信頼性とコストの多目的報酬設計が中心になる |
| AI Restoration | タスクと介入単位を確定後に分類 | ゲーム目的とエピソード境界が手法選択の前提になる |

RLを導入していない作品には、見栄えのためだけにRLを追加しない。観察性の高いルールベース挙動が目的に合う場合は、それを正式な方策として残す。

## 4. 共通アーキテクチャ

ゲーム固有ロジックと学習方式の交換を可能にするため、次の境界を共通化する。

```text
Game Environment
  reset(seed)
  observe(mode)
  validActions()
  step(action)
      ↓ Transition
Reward Breakdown
  task / progress / safety / behavior / total
      ↓
Policy Adapter
  Tabular Q / DQN / PPO / Scripted
      ↓
Model Storage + Evaluation Harness + Learning HUD
```

### 4.1 実行モデル

標準起動では、TrainerプロセスとElectron表示プロセスを同時に起動する。

```text
Launcher / Supervisor
  ├─ Headless Trainer
  │    ├─ 同一Game Coreを高速step
  │    ├─ 学習モデルを更新
  │    ├─ 固定seedで候補を評価
  │    └─ 合格snapshotを原子的にpublish
  │
  └─ Electron Player
       ├─ 同一Game Coreを実時間step
       ├─ publish済みsnapshotを推論専用で使用
       ├─ Renderer / HUD / 人間介入
       └─ episode境界で新revisionへ安全に交換
```

ここで「同じシステム」とは、headlessが表示画面を遠隔操作することではない。ゲームの状態生成、遷移、衝突、報酬、終了判定、観測生成を一つの純粋なGame Coreへ集約し、TrainerとPlayerが同じ関数を異なる速度で呼ぶことを意味する。

Playerの状態を毎フレームheadlessへ送って学習させる方式は標準にしない。通信切断やフレーム落ちが学習環境へ混ざり、並列高速化もできないためである。人間のプレイ軌跡を利用する場合は、共通の `RlTransition` 形式で明示的に記録し、demonstration用データとしてTrainerへ渡す。

Trainerは唯一のmodel writerとする。Player側の `localStorage` は公開snapshotのキャッシュ、UI設定、人間のメタ進行だけに使い、推論中のモデルを更新しない。これにより、二つのプロセスが同じQ表やニューラルネットを同時更新する競合を防ぐ。

モデル公開には次の情報を含める。

- `gameId`
- `algorithm`
- `modelVersion`
- `observationSchemaVersion`
- `rewardSchemaVersion`
- `revision`
- `trainingSteps`
- `evaluationMetrics`
- `publishedAt`
- checksum

Trainerは一時ファイルへ保存後にrenameして、完全なsnapshotだけを公開する。Playerは新revisionを読み込んでも即座に現在episodeへ差し込まず、原則としてepisode開始時または明示した安全なdecision境界で交換する。不正schema、破損snapshot、評価未通過revisionは拒否し、直前の正常モデルで推論を継続する。

### 4.2 共通型

`shared/rl/` に以下を追加する。

- `RlEnvironment<Observation, Action>`: `reset`、`step`、終了状態、seedを統一する。
- `RlTransition`: `state`、`action`、報酬成分、`nextState`、`terminated`、`truncated`、action maskを保持する。
- `RlPolicy`: `decide`、`observe`、`finishEpisode`、`setEvaluationMode`、`serialize`を共通化する。
- `ObservationMode`: `raw`、`engineered`、`minimal`を切り替える。
- `RewardMode`: `sparse`、`shaped`を切り替える。
- `EpisodeMetrics`: ゲーム固有の未加工指標と共通指標を保存する。
- `ModelManifest`: アルゴリズム、schema、revision、評価結果をモデル本体と結び付ける。
- `ModelPublisher` / `ModelSubscriber`: Trainerの公開とPlayerの購読をストレージ方式から分離する。

既存の `TabularQAgent` は `RlPolicy` の最初のadapterとして扱い、挙動と保存形式を壊さない。

### 4.3 Game CoreとDriverの分離

各ゲームは次の3層へ分ける。

1. `*_core.ts`: 状態、`create/reset/observe/step`、報酬、終了判定。DOM、Canvas、Three.js、`performance.now()`、`localStorage`を参照しない。
2. `*_driver.ts`: policyとの接続、decision cadence、episode管理、model snapshot交換を担当する。PlayerとTrainerから共用する。
3. `*.ts` / `*_scene.ts`: requestAnimationFrame、描画、HUD、入力だけを担当する。

Player driverは実時間の`dt`を固定step accumulatorへ変換する。Trainer driverは同じ固定`dt`を描画待ちなしで繰り返す。両者が同じseedとaction列を与えられた場合、同じ状態、報酬、終了理由を返すことを契約テストで保証する。

表示用の待機時間、wave banner、死亡演出、アップグレード選択UIのカウントダウンはGame Coreへ入れない。Trainerは同じ決定イベントを即時処理でき、Playerだけが演出時間を挟む。

### 4.4 報酬の分離

各ゲームの単一 `reward` 加算を、次の成分へ段階的に置き換える。

```ts
type RewardBreakdown = {
  task: number;
  progress: number;
  safety: number;
  behavior: number;
  total: number;
};
```

`task` は勝利、敗北、タスク達成などの真の目的に限定する。`progress` 以下は学習補助とし、Sparse評価では合成しない。HUDにはtotalを表示できるが、評価ログでは全成分を保持する。

### 4.5 DQN基盤

最初のDQNは固定長ベクトルと離散行動に限定する。

- Double DQN
- Experience Replay
- Target Network
- Huber loss
- gradient clipping
- action maskを探索とtarget計算の双方へ適用
- replay warm-up
- 学習用networkと評価用snapshotの分離
- model versionと観測schema versionの保存

学習はheadless側を標準とする。Electron画面では推論、学習状況の表示、低頻度のオンライン更新を担当し、大量学習によって描画を停止させない。ライブラリはDQNの小規模プロトタイプで、自前実装と既存ランタイムの保存サイズ、速度、Electron互換性を比較してから決定する。

### 4.6 PPO基盤

PPOは共通基盤の初期必須項目にしない。Arena ShooterまたはGunshipで連続操作を正式採用するときに追加する。

- 推力、旋回、照準などを正規化された連続値として定義
- 離散操作との混合actionを明示
- trajectory buffer、GAE、advantage normalizationを実装または外部trainerへ委譲
- 学習済みモデルをElectron推論形式へexport

PPO導入時にも、離散操作のTabular/DQN版を比較基準として残す。

## 5. 現行コードの再利用性監査

| 対象 | 現在再利用できるもの | 現在の問題 | 修正方針 |
|---|---|---|---|
| Gunship | `GunshipAgent`、物理、敵、進行、live trainer、原子的model publish、API、並列launcher | `gunship.ts`と`gunship_headless_sim.ts`に弾移動、命中、報酬、wave、終了処理が重複。変更時に手動同期が必要 | `GunshipCore`と`GunshipEpisodeDriver`へ統合し、既存trainerとPlayerの双方から呼ぶ。現在のlive model APIとlauncherは共通基盤の原型として再利用 |
| Drone Bastion | `createDroneBastionState`、`observeDroneBastion`、`stepDroneBastion`、resetが純粋coreにまとまっている | headlessとPlayerにepisode/upgradeループが別々にあり、Player自身も学習・保存する。live trainerなし | 共通driverを追加し、Gunship型publisher/subscriberを接続。Player agentは常にevaluation mode |
| Arena Shooter | `arena_shooter_core.ts`にcreate/observe/step/resetが存在 | Player固有のepisode管理と保存、headlessの実行制御が別。並列モデル配信なし | Drone Bastionと同じ共通driver方式へ移行し、2番目の汎用化検証対象にする |
| Network Defense | `createNetworkDefenseRuntime`、rule runtime、RL controllerをheadlessでも再利用 | headlessがapp配線を再構築し、DOM shim、Three.js Scene、flash pool複製を必要とする | シミュレーション状態と描画オブジェクトを分離し、`NetworkDefenseCoreFactory`からPlayer/Trainer用adapterを生成する |
| One Line RPG | agentと観測型は分離済み | ゲーム状態、step、描画、DOM、学習が大きなブラウザモジュールに同居。headless環境なし | 状態と戦闘遷移を`one_line_rpg_core.ts`へ抽出してからtrainerを追加。先にheadless側で再実装しない |
| Zombie Survivor | camp/combat agentは分離済み | メインゲームから完全な環境stepを呼べず、意思決定単位も複数ある | 戦闘とcampを別サブ環境として抽出し、階層driverが両方を接続する |

Gunshipの仕組みは並列起動とsnapshot配信の先行実装として価値があるが、シミュレーション二重実装は共通方式にしない。Drone BastionとArena Shooterのcore分離は、同一システムをPlayerとTrainerで使う構造の先行実装として採用する。この二つを組み合わせて共通基盤を作る。

## 6. 評価と昇格条件

新方策は、同じ観測情報、報酬、行動周期、seed集合で比較する。一度にアルゴリズムと報酬を同時変更しない。

最低限、次を記録する。

- 10、30、100エピソード後のゲーム固有成果
- 10万、50万、100万decision step時点の成果
- 学習に使っていない固定seedでの中央値とIQM
- 成功率、失敗率、時間切れ率
- 一意状態数、行動頻度、探索率
- task報酬とshaping報酬の内訳
- 学習時間、推論時間、モデルサイズ
- scripted、random、現行Tabularとの比較

DQNまたはPPOへの昇格は、次をすべて満たした場合に行う。

1. 5以上の評価seedで主要タスク指標を改善する。
2. 学習時のtotal rewardだけでなく、未加工のゲーム成果が改善する。
3. 推論負荷が描画と操作のwatchabilityを損なわない。
4. 保存、復元、評価モード、モデルversion移行が動作する。
5. 改善理由を観測の一般化、連続制御、信用割当などゲーム特性から説明できる。

改善が確認できない場合はTabularまたはscripted方策へ戻し、複雑な方式を標準化しない。

## 7. 実装フェーズ

進捗（2026-08-06）:

- Phase 0/1開始: 共通RL型、報酬内訳、model manifestと互換性検証を追加済み。
- Phase A基盤完了: ゲーム非依存の`TrainingSupervisor`と`ModelFileStore`、汎用`/api/rl/models/:gameId` APIを追加。Gunshipの並列launcher、原子的publish、reset通知、Playerの推論専用読込を共通基盤へ移行済み。HUDのtrainer接続詳細は未完了。
- Phase B完了: Gunshipの物理後処理、射撃、命中、報酬、wave、終了判定を`gunship_core.ts`へ統合し、Player/headlessの二重実装を解消済み。
- Phase C完了（Gunship）: PlayerのQ表書込を停止し、評価モードでは飛行・強化・終端を通してもtraining step、epsilon、episode数を変更しない。`localStorage`への書込はメタ進行だけに限定済み。
- Phase D一部完了（Drone Bastion）: 共通coreを使うlive trainerとlauncherを追加し、Playerを推論専用化。共通model API、manifest検証、episode境界のrevision交換、reset通知へ対応済み。
- Phase D完了（Arena Shooter）: coreと進行反映を共用するlive trainer/episode driverを追加し、Playerを推論専用化。upgrade banditも評価中は更新しない。episode境界で公開revisionを交換する。
- 未完了: 汎用HUDへのtrainer接続詳細表示、分離不足ゲームのcore化。

### Phase A — 並列実行基盤の標準化

- Gunshipのlauncher、live trainer、HTTP API、原子的renameを参考に、ゲーム非依存の `TrainingSupervisor`、`ModelPublisher`、`ModelSubscriber` を設計する。
- 一つのコマンドでTrainerとElectron Playerを起動し、Player終了時に子Trainerを安全に停止する。
- Trainer異常終了時はPlayerを継続し、最後の正常snapshotで推論する。
- Player HUDにtrainer接続状態、model revision、公開時刻、学習step、評価結果を表示する。
- resetは対象ゲームとmodel versionを明示し、Playerの表示設定やメタ進行を巻き込まない。

完了条件: Gunshipで現在と同等の並列動作を共通supervisor経由で再現できる。

### Phase B — 同一環境coreへの統合

- Gunshipのブラウザ更新処理とheadless `runEpisode`の重複部分を `GunshipCore`へ移す。
- `GunshipEpisodeDriver`をPlayerとTrainerの双方から使用する。
- 固定seed、固定action列でPlayer driverとTrainer driverの遷移一致テストを追加する。
- 描画を無効にした同じdriverが実時間より十分高速に動くことを計測する。

完了条件: Gunshipのheadlessファイルにゲームルール、報酬値、当たり判定の複製が残らない。

### Phase C — 学習と推論の完全分離

- Trainerだけが `observe`、optimizer update、epsilon decay、`finishEpisode`による学習更新を行う。
- Playerはpolicyをevaluation modeで生成し、`decide`だけを利用する。
- Playerのepisode終了時に新しい合格revisionを取得し、次episodeへ反映する。
- Playerの手動介入は標準では学習へ混ぜず、任意のtrajectory記録として分離する。
- ローカル保存から「学習モデル」と「表示・メタ進行」を別schemaへ移行する。

完了条件: Playerを何時間動かしてもtraining stepとepsilonが変化せず、Trainer停止中も推論が継続する。

### Phase D — core分離済みゲームへの横展開

- Drone Bastionへ共通driver、trainer、publisher/subscriberを追加する。
- Arena Shooterへ同じ仕組みを追加し、ゲーム固有コードなしでsupervisorが起動できることを確認する。
- 両ゲームでPlayer内学習を停止し、既存localStorageモデルを初回Trainer import用に移行する。

完了条件: Gunship、Drone Bastion、Arena Shooterが同じ並列実行・snapshot契約で動く。

### Phase E — 分離不足ゲームのcore化

- Network DefenseからThree.jsとflash pool依存を外し、headless専用の描画ダミーを削除する。
- One Line RPGの状態、戦闘step、報酬、終了判定をDOM/描画から抽出する。
- Zombie Survivorをcombat/campの二つのサブ環境と上位episode driverへ分ける。
- 各ゲームでPlayer/Trainer遷移一致テストを追加してから並列学習を有効にする。

完了条件: headless用にゲームルールを再記述せず、同じcoreを直接importしている。

進捗（Network Defense）:

- Playerとheadlessで、ゲーム状態・ノード状態・隣接表・辺速度・実体配列を作る`initializeNetworkDefenseSimulationState`を共有した。
- headlessからDOM shimとThree.js製flash poolの複製を削除し、表示イベントをno-op adapterへ置き換えた。
- 終了overlay、HUD、Seniorルール表示をDOMがない実行環境でも安全に扱えるようにした。
- headlessの辺を描画線ではなく同じ制御点を持つ論理曲線として生成し、`Scene`、`Mesh`、materialの生成を廃止した。agent・packetの描画handleは任意、firewallは論理的な有効期限だけで動作する。
- packet・agent・firewall・node表示を`NetworkDefenseVisualAdapter`へ集約した。PlayerはThree.js adapter、Trainerはnull adapterを注入し、ゲームルール側からThree.js importとnullableな描画分岐を除去した。
- 固定seedで記録visual adapterとnull adapterへ同じnode・packet・agent・firewall入力を与え、論理状態が完全一致する遷移テストを追加した。Network Defenseのcore/visual分離は完了し、次はTrainerのmodel publishとPlayerのrevision購読へ進む。
- Network Defenseを共通Supervisor、model store、manifest APIへ接続した。Headless Trainerだけが学習・revision公開を行い、Playerは互換manifestを検証して評価モードで読み込み、ローカル学習とlocalStorage保存を行わない。

### Phase 0 — ベースライン固定

- Network Defense、Drone Bastion、Arena Shooter、Gunshipの現行モデルを固定seedで評価する。
- One Line RPGとZombie Survivorは、core抽出前にheadless版を複製せず、現在のPlayerから取得できる指標と期待する遷移契約を記録する。
- ゲーム別のtask指標を定義する。
- 現行saveのmodel versionと観測schemaを記録する。

完了条件: コード変更前後を同じ条件で比較できる。

### Phase 1 — 共通環境・ログ境界

- `RlPolicy`、`RlTransition`、`RewardBreakdown`、`EpisodeMetrics`を追加する。
- 既存 `TabularQAgent` をadapter経由で利用できるようにする。
- `terminated` と `truncated` を区別する。
- 共通CSVまたはJSONL評価出力を追加する。

完了条件: 2ゲーム以上が同じ評価runnerとログschemaで動く。

### Phase 2 — 観測・報酬の比較

- Drone BastionにEngineered 96値と現行Minimalの切り替えを追加する。
- Network DefenseにEngineeredとMinimalの観測modeを追加する。
- 両ゲームにSparse／Shapedの報酬modeを追加する。
- 状態キーごとのTD target分散を計測し、aliasing候補を抽出する。

完了条件: 表現と報酬を独立した軸として比較できる。

### Phase 3 — Double DQNパイロット

- Drone Bastionを最初のDQN対象にする。
- 96値dense観測、現行13行動、0.12秒の意思決定周期を維持する。
- TabularとDQNで報酬、seed、学習stepを揃える。
- 次にArena ShooterまたはGunshipへ横展開する。

完了条件: 固定評価でTabularを上回るか、上回らない理由を再現可能なデータで判断できる。

### Phase 4 — ゲーム別分岐

- One Line RPG: 現行Tabularの状態十分性を検証し、必要な場合だけ短期履歴を追加する。
- Network Defense: 役職別headと共有encoderを比較し、信用割当を検証する。
- Arena Shooter / Gunship: 離散DQNを評価後、連続操作版PPOの必要性を判断する。
- Planet Strategy / Colony / Escort TD: 高レベル判断と低レベル実行を分離する。

完了条件: 各ゲームの標準方策と、採用しなかった方式の理由が記録される。

### Phase 5 — Watchability統合

- 方策種別、training/evaluation、explore、Q値または方策確率をHUDへ表示する。
- エージェントが重視した脅威方向、対象、意図を画面上で可視化する。
- ChampionモデルとTrainingモデルを分離する。
- 人間介入を学習データへ含めるか除外するかを明示する。

完了条件: ログを読まなくても、現在の方策と学習変化を画面から理解できる。

上記Phase A〜Eは実行系の改修、Phase 0〜5はRL比較実験の改修である。実装順は `Phase 0 → Phase 1 → Phase A → Phase B → Phase C → Phase D → Phase 2 → Phase 3` を基本とする。Phase EはPhase Dで共通方式が固まった後にゲーム単位で進め、同一環境と学習・推論分離を確立してからDQN比較へ進む。

## 8. 最初の実装対象

アルゴリズム比較の最初の縦切り対象は Drone Bastion とする。ただしその前に、実行基盤の縦切りとしてGunshipの二重シミュレーションを解消する。

理由は、完全なシミュレーション状態、固定seed、headlessテスト、MinimalなTabular方策、固定96値のdense観測がすでに存在し、観測表現とアルゴリズムの比較を環境の作り直しなしで行えるためである。

## 9. Active TODO

優先順に実施する。DQN比較は評価基盤とベースラインを固定してから開始する。

### P0 — 現行並列実行の仕上げ

- [x] Gunship、Drone Bastion、Arena Shooter、Network Defenseの`start:*-live`をElectronでスモーク確認する。`npm run smoke:rl-live`で隔離モデル領域を使い4ゲームを順次検証する。
- [x] Trainer停止後もPlayerが最後の正常snapshotで推論を継続することを確認する。短時間Trainer終了後もElectron pageの生存とrenderer error不在を検査する。
- [x] model reset、revision更新、manifest不一致時のfallbackを実機確認する。reset後の再publishと、schema versionを破壊したsnapshotの拒否状態までElectronから取得して検証する。
- [x] Playerが初回model取得を完了する前に未学習方策を実行しない起動境界を追加する。4ゲームとも初回fetch完了まではsimulation updateを開始しない。

### P1 — 共通評価基盤

- [x] 固定seedを受け取るゲーム非依存の評価runnerを追加する。`scripts/rl/evaluation_runner.ts`がadapterとseed列を受け取り、同一順序でepisodeを実行する。
- [x] `terminated`と`truncated`をepisode結果で区別する。4ゲームのheadless episode結果と共通評価schemaで明示する。
- [x] 共通`EpisodeMetrics` schemaでJSONLと集計JSONを出力する。
- [x] 勝率、平均報酬、到達wave、score、学習step、wall timeをゲーム別task指標として集計する。`npm run eval:rl-baselines`でJSONLとsummaryを生成する。
- [ ] 4ゲームの現行Tabular Qモデルを同じseed集合で評価し、比較用baselineを保存する。

### P2 — Championモデル管理

- [x] Training、Candidate、Championのsnapshotを分離する。共通`ModelLifecycleStore`を追加し、まずGunshipへ接続した。
- [x] Candidateを固定seedで評価し、採用条件を満たした場合だけChampionへ昇格する。Gunshipではhold-out評価の95%下限が現Champion中央値を超えることを条件にする。
- [x] Playerは学習途中のsnapshotではなくChampion revisionだけを購読する。既存のunsuffixed model APIをChampion専用として維持する。
- [x] reset時にmodelだけを対象とし、表示設定とメタ進行を保持する回帰テストを追加する。共通`clearStoredPolicyModels`とGunshipの保存キー回帰テストで保証する。

### P3 — Watchabilityと共通HUD

- [x] Trainer接続状態、model revision、公開時刻、training stepsを共通表示する。Supervisor heartbeat、共通status API、4ゲーム共通`RlHud`で表示する。
- [x] 方策種別、training/evaluation、選択action、Q値または方策確率を表示する。共通`RlHud`を4ゲームへ接続する。
- [x] Trainer異常終了、互換性エラー、最後の正常Champion使用中を画面上で区別する。heartbeat失効も`FAILED`として検出する。
- [x] エージェントが重視した脅威、対象、意図をゲーム別overlayへ接続する。4ゲームの共通HUDにゲーム固有の`INTENT`と`FOCUS`を表示する。

### P4 — 残りのcore分離

- [ ] One Line RPGの状態、戦闘step、報酬、終了判定をDOMと描画から抽出する。
- [ ] Zombie Survivorをcombat/campサブ環境と上位episode driverへ分ける。
- [ ] 両ゲームでPlayer/Trainerの固定seed遷移一致テストを追加する。
- [ ] 遷移一致後に共通Supervisorとmodel APIへ接続する。

### P5 — 観測・報酬比較

- [x] Drone BastionにMinimal／Engineered 96値の観測切り替えを追加する。
- [x] Network DefenseにMinimal／Engineeredの観測切り替えを追加する。
- [x] 両ゲームにSparse／Shaped報酬の切り替えを追加する。
- [ ] TD target分散と状態aliasing候補を評価ログへ出力する。

### P6 — Double DQNパイロット

- [x] Drone BastionへDouble DQNを追加する。
- [x] Tabular Qとseed、報酬、学習step、評価episodeを揃えて比較する。`npm run eval:drone-dqn`で3条件を同一seed列・同一episode上限で評価しJSON保存する。
- [ ] 改善が再現できた場合だけArena ShooterまたはGunshipへ横展開する。
- [x] 改善しない場合はTabular Qを標準として維持し、原因を評価結果とともに記録する。`DRONE_BASTION_DQN_EVALUATION.md`に固定seed比較と判断を保存した。

最初の比較は次の3条件に限定する。

1. 現行Minimal + Tabular Q
2. Engineered 96値 + Double DQN
3. DQN用観測を離散化したMinimal + Double DQN

これにより、性能差が「情報量」「関数近似」「両方」のどこから来たかを分離する。その後にSparse／Shaped比較を追加し、最初から全軸を同時に変更しない。

## 9. 対象外

初期計画では次を行わない。

- Canvas画像を直接入力するDQN/PPO
- 全ゲームの一括DQN化
- 評価基盤より先にニューラルネット依存を追加すること
- 合成報酬だけによるモデル選抜
- ゲームごとに互換性のないtrainerとログ形式を増やすこと
- 観察用シミュレーションへ目的が曖昧なRLを追加すること

本計画の成果は「最も複雑な学習器を採用すること」ではなく、各ゲームについて、最小の実装コストで内容に合った方策を選択し、その判断を再現可能にすることである。
