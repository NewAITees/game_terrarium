# RL ロードマップ(共通認識)

> 合意日: 2026-09-25
> 前提ルール: CLAUDE.md「no hand-authored policy」。挙動はすべて強化学習から。触ってよいのは環境と報酬。

このプロジェクトの主軸は「AIにゲームをプレイさせ、強化学習でだんだん上手くさせる」こと。
そのために、各ゲームの学習設定を **入力・出力・報酬の3点** で宣言し、
複数の設定を **並列に試してリーダーボードで比べ、筋の良いものを残す**。

## A. 強化学習の3点

各ゲームは3点を名前付きのバリアントとして宣言する。探索器(`npm run research`)はこの宣言の外を提案できない。

| 要素 | 定義 | 探索で変えてよいもの | 現在の置き場所 |
|---|---|---|---|
| 入力 (Observation) | 名前付き観測バリアント (`full` / `minimal` など) | バリアントの追加・選択 | `apps/<game>/*_agent.ts` / `*_rl.ts` / `*_types.ts` の `*_OBSERVATIONS` |
| 出力 (Action) | 名前付き行動セット (`full` / `coarse` など) | 行動セットの追加・選択 | 同上の `*_ACTION_SETS` |
| 報酬 (Reward) | `task` チャネル(採点用、どの重みでも変わらない) + shaping チャネル(学習用) | shaping の重みと mode。**`task` の定義は変えない** | `*RewardWeights` 型と `DEFAULT_*_REWARD_WEIGHTS` |

加えて学習器(tabular / DQN、ハイパーパラメータ)と難易度(environment)も探索対象。
これらすべてを束ねた宣言が `scripts/rl/<game>_experiment.ts` の `RlSearchSpace`。

## B. リーダーボード

- 1行 = 1つの spec(3点 + 学習器 + 難易度)を、独立した複数エージェント(`repeats`)で学習・評価した結果
- 順位の基準は **hold-out シードでの task return のみ**。shaped return では順位を付けない
- **同じゲーム・同じ環境(難易度と `capSeconds`)同士でだけ比べる**。環境が違えば別の表
- champion の交代は、挑戦者の bootstrap 95% 下限が champion の中央値を超えたときだけ(引き分けは現 champion)
- 各行には学習済みモデルを付けて保存し、`npm run research:publish` でそのまま画面へ出せる
- データの正本は `logs/rl-research/<game>.jsonl`(追記専用)。リーダーボードはそこから毎回計算し直す

## C. 回し方

```
3点のバリアント追加(人 or research:advise)
  → npm run research で並列実行 → ledger に追記
  → npm run research:board で筋の良いものを確認
  → 良いものは npm run research:publish で画面に反映
```

## 対象ゲーム

- 第1段階(探索に接続済み): gunship / drone-bastion / arena-shooter
- 第2段階(エージェントはあるが探索に未接続): network-defense / zombie-survivor / one-line-rpg
  - 接続には「そのゲームの task return を何にするか」の設計判断が必要なので、1本ずつ spec を切ってから行う
- RL を持たない体験(submarine-* / moss / city-traffic など)は観察ページとして扱う(整理方針は未決)
- `agent_rules/` / `faction_rules/` は旧来のルールエンジン。拡張しない

## やること(優先度順)

1. [x] 巨大ファイルの分割(escort-td / arena-shooter / drone-bastion、gunship は不要と判断)
2. [x] リーダーボード CLI: `npm run research:board`(環境ごとの順位表 + 3点の宣言 + 未試行の組み合わせ、`logs/rl-research/leaderboard.json`)
3. [x] drone-bastion / arena-shooter で research を回し、ledger を作った(各6件、下の「観測結果」参照)
4. [x] live_trainer の共通ループ化(`scripts/rl/live_trainer_loop.ts`。launcher は元から薄い。gunship は昇格ゲート付きの別契約なので対象外。headless_sim はゲーム固有部分が大半のため見送り)
5. [ ] 第2段階ゲームの adapter 追加(ゲームごとに task return を決める spec から)
6. [ ] RL を持たない体験の扱いを決める(ユーザー判断)
7. [ ] リーダーボードを Electron のページとして見られるようにする

## 観測結果(2026-09-25)

| ゲーム | 件数 | hold-out 中央値の幅 | shaping share | 所見 |
|---|---:|---|---|---|
| gunship | 24 | 5〜12.8 秒 | 32〜90% | 差は出ている。旧行は `learnerVariant` 未記録 |
| drone-bastion | 6 | 3.6〜5.0 | 0〜99% | 差は出ている。比較可能 |
| arena-shooter | 6 | 1.2〜1.3 | 98〜99% | **全設定がほぼ同点**。600ep×3 では task に届いていない。full 観測は状態数 11万超 |

arena-shooter は今のままでは探索しても順位が付かない。予算・観測の粒度・報酬のどれを動かすかを決めてから測る(ルールで補うのは禁止)。
