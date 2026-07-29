# TDジャンル リサーチノート — Escort TD 改修のための市場調査

> 目的: 「放置系メタ進行 × KING護衛 × 迷路構築」型TDを設計するために、
> 世の中の類似ゲームから「何が面白さの核か」を抽出する。
> 調査日: 2026-07-13

---

## 1. 放置系TDのメタ進行 — 「負けても必ず前進する」

### The Tower – Idle Tower Defense(最重要参考)

**構造がこのゲームの目指す形にもっとも近い。** 中央にタワー(=KING相当)、敵が全方位から接近、自動射撃で迎撃する放置ゲー。

- ラン中に稼ぐ**一時通貨**(コイン)でそのラン内の強化を買い、ランが終わる(=負ける)と
  **恒久通貨**に変換されて Workshop / 研究ツリーの永続強化に使う
- 「負ける」ことがゲームオーバーではなく**収穫のタイミング**。むしろ
  「進行が鈍ったら早めにリセットして恒久強化を回すほうが効率的」という設計
- シンプルな自動シューターの見た目の下に、インクリメンタル系の複利成長が仕込まれている

参考:
- [BlueStacks: Beginner's Guide](https://www.bluestacks.com/blog/game-guides/the-tower-idle-tower-defense/ttitd-beginners-guide-en.html)
- [公式Wiki: Beginners Guide](https://the-tower-idle-tower-defense.game-vault.net/wiki/Guide:Beginners_Guide)

### Rogue Tower(ローグライトTD)

- ラン終了時に**XP(=スコア)**を獲得 → 恒久アップグレード購入
  (新タワー解放、ラン中のカードドロー頻度・選択肢数の増加など)
- 恒久強化が「数値を盛る」だけでなく**ラン中の選択肢を増やす**方向に効いているのが上手い
- 高所地形にタワーを置くと射程・威力ボーナス — 地形とレイアウトが戦略になる

参考:
- [Rogue Tower Wiki: Upgrades](https://rogue-tower.fandom.com/wiki/Upgrades)
- [TheGamer: Beginner Tips](https://www.thegamer.com/rogue-tower-beginner-tips-tricks/)

### Infinitode 2(エンドレスTD)

- エンドレスモードのスコア・リソースで**400以上の研究ノード**を解放
- 「今回のランでどこまで行けたか」が次のランの初期戦力に直結する
- リソースが複数種類あり、どのマップ・モードを回すかで稼げる物が違う → 周回に目的が生まれる

参考:
- [Steam: Infinitode 2](https://store.steampowered.com/app/937310/Infinitode_2__Infinite_Tower_Defense/)
- [Infinitode 2 Wiki: Researches](https://infinitode-2.fandom.com/wiki/Researches)

### インクリメンタル系の設計心理学

- **損失回避の無効化**: 放置ゲーは「失うものがない」よう設計する。敗北時も必ず
  恒久通貨が入るので、心理的には常にプラス(losing is progress)
- **プレステージの黄金律**: 「進行が鈍化した時点でリセットすると、リセット後の序盤が
  前回より圧倒的に速い」という体感が快感の源。序盤の再走が速くなる強化
  (開始リソース、初期ユニット、自動化)を優先的に売るべき
- **自動化はメタ報酬**: 手動でやっていた操作(増援購入、リスタート)を恒久強化で
  自動化解放していくと、ゲームが徐々に「放置で観察するもの」に進化する

参考:
- [Wikipedia: Incremental game](https://en.wikipedia.org/wiki/Incremental_game)
- [The Core Loop: Anatomy of an Incremental Game](https://www.techguide.com.au/news/internet-news/the-core-loop-anatomy-of-an-incremental-game/)

---

## 2. 迷路構築(Mazing) — ルートと障害物の駆け引き

### Desktop Tower Defense 系(オープンフィールド迷路)

- 固定経路が存在せず、**タワー自体が障害物**。プレイヤーの配置が敵の経路を決める
- 「mazing」= 蛇行路を作って敵の移動距離を最大化するテクニックがジャンルの核
- 対抗要素として**飛行敵(迷路無視で直進)**や**障害物を攻撃する敵**を混ぜるのが定石。
  迷路一辺倒の最適解を壊し、対空・直衛の枠を強制する

参考:
- [Wikipedia: Tower defense](https://en.wikipedia.org/wiki/Tower_defense)
- [TV Tropes: Tower Defense](https://tvtropes.org/pmwiki/pmwiki.php/Main/TowerDefense)

### Emberward(テトリミノ迷路 × ローグライト)

- **テトリミノ型ブロックを落として自分で迷路を組む** → その上にタワーを置く
- 「事前に理想の迷路プラン(スイッチバック多め/長い直線)を持ち、実際のマップ地形に
  合わせて適応する」という2段階の意思決定が面白さの核と評価されている
- ビジュアルが「明るく・カートゥーン調で・非常に読みやすい」ことが
  レビューで一貫して称賛されている — **TDでは可読性がアートの最優先要件**

参考:
- [PC Gamer: Emberward demo](https://www.pcgamer.com/games/strategy/drop-blocks-to-make-your-own-maze-in-the-demo-for-tower-defense-game-emberward/)
- [Expert Game Reviews: Emberward](https://expertgamereviews.com/emberward-review-maze-building-meets-tower-defense-in-style/)

### They Are Billions(建物・壁が障害物の拠点防衛)

- 敵(ゾンビ)は**常に司令部への最短経路**を取る。壁や建物は経路計算に影響する障害物
- **漏斗(ファネル)型チョークポイント**が最重要テクニック: 敵側が狭く、
  自陣側が広い漏斗を作り、広い側に火力を集中する
- **森・山・水などの破壊不可地形を「天然の壁」として使う**のがリソース効率の要
  → 本作の「破壊不可のビル」はそのまま同じ役割を果たせる
- 防御優先度は「ユニット > タワー > 壁」— 動けるユニットが最も価値が高い

参考:
- [Steam Guide: Building and upgrading defenses](https://steamcommunity.com/sharedfiles/filedetails/?id=2644408902)
- [Kotaku: Tips For Playing They Are Billions](https://kotaku.com/tips-for-playing-they-are-billions-1822005149)

### 迷路設計の共通ルール

1. **完全封鎖の扱いを決める**: (a) 経路を完全に塞ぐ配置は禁止(Desktop TD式)か、
   (b) 塞ぐと敵が障害物を壊しに来る(They Are Billions式)。どちらかを明確に
2. **経路の可視化**: 配置を変えた瞬間に敵の新経路がプレビューされること。
   これがないと迷路構築は「試行錯誤の作業」になる
3. **迷路無効化ユニットの混在**: 飛行型・障害物破壊型が「完璧な迷路」への
   カウンターとして機能し、火力と直衛のバランスを強制する

---

## 3. 能動的に守るユニット — ブロッカー理論

### Kingdom Rush(バラック+ラリーポイント)

**「ユニットがKINGの周りを能動的に守る」の理論的裏付けがここにある。**

- バラックから出る兵士の仕事は**ダメージではなく「敵を止めること」**。
  敵は兵士と接敵すると強制的に足を止め、その間に後衛タワーの射撃時間(fire window)が生まれる
- **ラリーポイント**で兵士の展開位置をプレイヤーが動的に指示できる。
  静的な配置物が「戦況に介入する手段」に変わるのがこのゲーム最大の発明
- チョークポイント+多数の射撃タワーの射線が重なる場所にブロッカーを置くのが定石
- 複数バラックのラリーポイントを重ねて強敵を集団で受ける、という上級テクも生まれる

参考:
- [Kingdom Rush Wiki: Militia Barracks](https://kingdomrushtd.fandom.com/wiki/Militia_Barracks)
- [Game Developer: Kingdom Rush campaign level design](https://www.gamedeveloper.com/design/kingdom-rush---the-wonderful-campaign-level-design)

### 抽出できる原則

- **足止め役と火力役の分業**がユニット編成の基本文法。
  「Knightが受け、Rook/Bishopが焼く」構図をシステムとして保証する
- ブロッカーは「HPで受ける」のでリペア/交代の概念が要る(全滅→再展開のクールダウン)
- プレイヤーの介入は「個別ユニットの操作」ではなく
  **「どこで受けるかの指示(ラリーポイント/フォーメーション)」**に抽象化するのが観察系と相性が良い

---

## 4. バランス設計の方法論

### Goal Defense 開発者による具体式

- ウェーブ生存性の基礎式: **(8 + N) × L ≥ h × N**
  (N=ウェーブの敵数、L=攻撃半径下のタイル数、h=敵1体撃破に必要な弾数)
- **HP/ゴールド比が難易度曲線の主変数**: 敵1体の報酬は「1〜2ウェーブごとに
  新ユニット1体 or 強化1回を買える」水準に設定する
- **開始ゴールドは序盤難易度の最強の調整ノブ**(高すぎると一気にヌルゲー化)
- 難易度スケーリングは「敵HPの単純インフレ」より
  **「ウェーブの長さ=同時攻撃数」を伸ばす**ほうが体感が健全

参考:
- [Game Developer: Balance in TD games](https://www.gamedeveloper.com/design/balance-in-td-games)

### その他の知見

- ウェーブのペーシング(種類・量・タイミング)が難易度曲線の実体。
  難所は「速い大群 + 硬い単体」など**種類の組み合わせ**で作る(単種インフレで作らない)
- 動的難易度調整(DDA)はTDと相性が良い — 放置ゲーなら
  「詰まったら恒久強化が追いつくまで自然に足踏みする」構造自体がDDAとして機能する

参考:
- [Cubix: Tower Defense Game Architecture](https://www.cubix.co/blog/demystifying-tower-defense-game-architecture-practical-guide/)
- [DDA in Tower Defence (論文PDF)](https://www.sciencedirect.com/science/article/pii/S187705091502092X/pdf?md5=2b9d952163945b0773a5f9d16ae31c13&pid=1-s2.0-S187705091502092X-main.pdf)

---

## 5. 可読性・デザイン — Defender's Quest の設計原則

TDのUX論としてジャンル内で最も引用される記事。本シリーズの
「観察体験の可読性最優先」という方針と完全に一致する。

1. **FOCUS**: スクロールしないマップ(全体が1画面に収まる)は認知負荷を大きく下げる。
   画面外の脅威はストレスであって面白さではない
2. **完全情報**: どのユニット・敵の性能も即座に確認できる。
   「50%ダメージ」ではなく「5秒間、毎秒5ダメージ」のように具体数で書く
3. **時間制御**: ポーズと変速(0.25x〜4x)。敗北が「反応が遅かった」ではなく
   「判断が悪かった」に帰属するようにする — 放置ゲーでは倍速が特に重要
4. **視覚アーキタイプ**: 敵種・ユニット種はシルエットと色で一目で分かる。
   HPバー・状態アイコンを浮かせて盤面の状況を常時読めるようにする
5. **ロック&キー設計の回避**: 「この敵はこのタワーでしか倒せない」を作らない。
   トレードオフのある複数解を許す

参考:
- [Fortress of Doors: Optimizing Tower Defense for FOCUS and THINKING](https://www.fortressofdoors.com/optimizing-tower-defense-for-focus-and-thinking-defenders-quest/)

---

## 6. 本作への適用サマリ — 重要要素チェックリスト

| # | 要素 | 出典ジャンル | 本作への適用 |
|---|------|--------------|--------------|
| 1 | 敗北=収穫(スコア→恒久通貨) | The Tower / Rogue Tower | ラン終了時にスコアをCHIPに変換 |
| 2 | 恒久強化は「選択肢を増やす」方向にも | Rogue Tower | ユニット枠・新駒・自動化の解放 |
| 3 | 序盤再走が速くなる強化を優先販売 | インクリメンタル系 | 開始GOLD・初期編成の強化 |
| 4 | タワー/障害物が敵経路を決める | Desktop TD / Emberward | バリケード建設+ビル=天然障害 |
| 5 | 経路プレビュー必須 | 迷路TD共通 | フローフィールドの可視化 |
| 6 | 迷路へのカウンター敵(飛行・破壊) | ジャンル定石 | 飛行型+強襲型(障害物攻撃) |
| 7 | ブロッカーが火力の射撃時間を作る | Kingdom Rush | Knight近衛+ラリーポイント |
| 8 | 漏斗型チョークポイント | They Are Billions | ビル間の道を漏斗化する配置誘導 |
| 9 | HP/ゴールド比=難易度の主変数 | Goal Defense | バランス表を1変数で調整可能に |
| 10 | 1画面・完全情報・変速 | Defender's Quest | 固定俯瞰維持+2x/4x+ツールチップ |
