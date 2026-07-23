# RL Arena — Desktop Evolution Shooter 開発計画書

> ステータス: 設計 / プロトタイプ稼働中  
> 対象アプリ: `apps/arena-shooter/`  
> 仮題: **RL ARENA: DESKTOP EVOLUTION**  
> 更新日: 2026-07-23

## コンセプト一行

**画面の隅で戦い続ける自律戦闘機を観察し、武器と学習環境を整えながら、
敵・操縦AI・兵器の三者が際限なく進化していく放置型2D全方位シューティング。**

このゲームで成長するのは機体の数値だけではない。RLエージェント自身が
移動・旋回・照準・射撃を改善し、「同じ装備でも前より賢く戦う」ことを見せる。

## ゲームの4本柱

1. **三重の成長競争**  
   敵の量・構成・行動が強くなり、武器の火力と性質が進化し、RLエージェントの
   操縦も改善される。どれか一つだけの数値インフレにはしない。
2. **観察して分かる学習**  
   生存時間やスコアだけでなく、回避率、命中率、危険距離、行動選択を表示する。
   「学習した結果、何が上手くなったか」を画面上の動きで読めるようにする。
3. **敗北は訓練結果**  
   撃墜はゲームオーバーではなくエピソード終了。報酬、戦闘ログ、モデル更新、
   恒久資源を確定し、数秒後に次の訓練へ入る。
4. **邪魔しない常駐ゲーム**  
   大画面で観察しても、画面の隅に縮小して放置しても成立する。人間の介入は
   恒久研究、報酬設計、学習方針の選択に集中させる。ラン中のレベルアップは
   RLエージェント自身が選び、戦闘行動とビルド構築を一体として学習する。

---

## 目標としないもの

- プレイヤーの反射神経を主役にする手動ツインスティックシューター
- 敵HPと自機DPSだけを指数的に増やす放置ゲーム
- 学習しているように見せるだけの固定スクリプト
- セーブ更新で過去の学習成果を失う構造
- 長時間起動しないと取り返せない期間限定報酬

手動操縦はデバッグや教師データ収集用には用意するが、通常プレイの主役にはしない。

---

## 参考作品との比較と採用方針

### 結論

本作の設計比率は次を目安とする。

```text
Desktop Defender型の長期構造   70%
Vampire Survivors型の戦闘成長 30%
操縦・学習・モデル競争         本作独自
```

一言で表すと、

> **Desktop Defenderの「永久に育つ放置構造」の中で、
> Vampire Survivors級の大量殲滅戦をRLエージェントがプレイする。**

全体構造はDesktop Defender型を採用する。Vampire Survivors型をそのまま採用すると、
一定時間でランが完結し、毎回の序盤再構築が中心になるため、RLモデルを数時間から数日
観察して育てる目的と噛み合いにくい。一方でDesktop Defender型だけでは戦闘と武器の
変化が数値中心になりやすいため、瞬間的な戦闘の気持ちよさはVampire Survivorsから取り入れる。

参考:

- [Desktop Defender Steamページ](https://store.steampowered.com/app/3772810/Desktop_Defender/)
- [Vampire Survivors Steamページ](https://store.steampowered.com/app/1794680/Vampire_Survivors/)

### デザイン上の違い

| 比較軸 | Desktop Defender | Vampire Survivors | RL Arenaでの判断 |
|---|---|---|---|
| 主な遊び方 | 画面隅で放置・観察 | 1ランを集中して操作 | 放置・観察を主軸 |
| 移動操作 | 基本なし/自動 | プレイヤーが担当 | RLが担当 |
| 攻撃 | 自動 | 自動 | RLが照準・射撃・武器選択 |
| 時間構造 | 長時間、無限Wave | 通常は時間制ラン | 無限Wave |
| ラン内成長 | 装備・数値 | XP、3択、武器進化 | Vampire Survivors型 |
| 恒久成長 | 装備、研究、Ascension | Gold強化、解放 | Desktop Defender型を強化 |
| 敗北 | 収穫して再開 | ラン終了、再挑戦 | 学習確定して自動再出撃 |
| 長期目標 | 最高Wave、巨大数 | 解放、ビルド、ステージ攻略 | 最高Wave、モデル世代、Ascension |
| 面白さの核 | 効率と数値が増え続ける | 大群を薙ぎ倒す爽快感 | 両方を接続する |

### Desktop Defenderから採用する要素

- 無限Waveと最高Wave更新
- デスクトップ常駐、コンパクト表示
- プレイヤーが見ていなくても進行する自動戦闘
- 装備ドロップと恒久研究
- 撃墜後の自動再出撃
- Ascensionと周回加速
- Auto Buyerと自動強化選択
- オフライン進行
- 巨大数と長時間成長

### Vampire Survivorsから採用する要素

- 多数の敵が全方向から迫る戦場
- 撃破XPと頻繁なレベルアップ
- 3択アップグレード
- 複数武器によるビルド構築
- 武器とパッシブの組み合わせ
- 条件を満たした武器進化
- 投射物数、範囲、連射、貫通の視覚的成長
- Elite/Boss撃破後の大きな報酬
- 完成後も強化が続くLimit Break相当の仕組み
- 強化直後に大群を圧倒させるパワー誇示Wave

### 本作独自の中核

- 自機の移動、旋回、標的選択、射撃をRLが担当
- 同じ装備でもモデル世代によって成績が変わる
- 武器に応じて最適交戦距離と移動戦術を再学習する
- TrainingモデルとChampionモデルを固定seedで比較する
- 命中率、回避率、被弾率、交戦距離から学習改善を観察する
- Ascension後もモデルを失わず、新しい敵環境へ再適応する
- Directorがモデルの得意戦法を分析して次の課題を生成する
- プレイヤーが報酬設計、強化候補プール、学習方針へ介入する

### 意図的に採用しない要素

#### Vampire Survivorsから採用しないもの

- 通常プレイを20〜30分で強制終了する構造
- 毎ラン、すべての武器能力を完全にゼロから取り直す構造
- プレイヤーの手動移動をゲームの必須条件にすること
- 有限ステージのクリアを最終目標にすること
- ラン終了ごとに長いメニュー操作を要求すること

#### Desktop Defenderからそのまま採用しないもの

- 自機を完全固定して移動学習をなくすこと
- 後半をDPS、攻撃速度、XPだけの最適化に収束させること
- 装備管理のため頻繁に放置を中断させること
- 画面上へドロップ品を無制限に残すこと
- HP倍率だけで敵を強くすること

### プレイヤーとRLの役割分担

```text
プレイヤー:
  恒久研究 / Ascension / 報酬設計 / 学習方針

RLエージェント:
  移動 / 旋回 / 回避 / 標的選択 / 射撃 / 武器切り替え / ラン内強化選択

ゲームDirector:
  Wave生成 / 敵構成 / 難度予算 / モデルへの新しい課題
```

この分担により、プレイヤーは反射神経ではなく「育成環境の設計者」として参加する。
通常は眺めるだけで進み、介入すればビルドと学習方向を変えられる。

### 採用判断の検証条件

次の条件を満たせない場合は、両作品の要素が正しく統合できていないと判断する。

- 30分無操作でもゲームが止まらず、強化と再出撃が進む
- 5分観察する間に少なくとも一度、武器の目に見える変化が起きる
- 同一装備の旧モデルと新モデルで移動または回避の差を目視できる
- Ascension後、以前苦戦したWaveを明確に速く通過する
- 武器完成後もLimit Breakによって成長が止まらない
- 高Waveでも敵数soft capを守り、画面が認識不能にならない
- プレイヤーが操作しなくても成立するが、ビルド介入には成績上の意味がある

---

## コアループ

```text
【戦闘ループ】数秒
  観測 → RLが行動選択 → 移動/旋回/射撃 → 命中/回避/被弾 → 報酬

【ウェーブループ】30〜90秒
  敵編成の予告 → 通常群 → 複合群 → Elite/Boss
  → 武器選択または機体強化 → 次Wave

【エピソードループ】3分〜無制限
  出撃 → Wave進行 → 撃墜
  → 戦績と学習差分を確定 → 資源獲得 → 自動再出撃

【メタループ】数十分〜数日
  新武器/研究/センサー解放 → 敵Tier上昇 → 新しい観測と行動を学習
  → Ascensionで世界難度と報酬倍率を上げる
```

### プレイヤーが行うこと

- レベルアップ候補の解放範囲と報酬設計を調整する
- 出撃前に恒久装備と学習方針を設定する
- 研究資源を恒久アップグレードに使う
- 必要なら報酬ウェイト、探索率、強化候補プールへ介入する
- AIの世代ごとの戦績とリプレイを比較する

### RLエージェントが行うこと

- 前進・後退・旋回・回避方向を選ぶ
- どの敵を狙うか決める
- 射撃、武器切り替え、アクティブ能力の発動を決める
- 武器の射程や発射間隔に合わせて交戦距離を変える
- レベルアップ時の候補から、その機体と現在の戦況に合う強化を選ぶ

### 機体選択と機体アーキタイプ

プレイヤーは`AUTO / INTERCEPTOR / STRAFER / TURRET`から出撃機体を指定できる。
指定は保存され、明示した機体は撃墜後の再出撃でも維持する。`AUTO`ではエピソード開始時に
ゲーム側がランダム選択する。機体抽選はseed管理し、固定評価では各機体の出撃回数を均等にする。
機体選択自体はRLの行動には含めず、RLは配属された機体の制約へ適応する。
戦闘中に機体指定を変更した場合は、異なる機体の遷移を同じエピソードへ混在させないため、
現在の学習遷移を終了してWave 1から新しいランを開始する。途中ランのDATA回収は行わない。

| 機体 | 移動・攻撃特性 | 強み | 弱み | 重要になりやすい強化 |
|---|---|---|---|---|
| 旋回型 | 機首方向へ前後移動し、機首方向へ攻撃 | 前後速度と離脱力が高い | 横移動不可。射線を作るには機体全体の旋回が必要 | 旋回速度、弾速、連射、射撃方向数 |
| 平行移動型 | 向きを保ったまま前後左右へ移動 | 射線を保ちながら回避できる | 横方向の速度と加速が弱く、長距離離脱は苦手 | 横移動速度、加速、回避、連射 |
| 砲塔型 | 移動軸と独立した砲塔軸で攻撃 | 逃走方向と射撃方向を分離できる | 砲塔旋回が遅く、大きな照準変更に時間がかかる | 砲塔旋回速度、追尾、射撃方向数、後半の威力 |

各機体は相互の上位互換にしない。強化も固定の正解を置かず、敵編成、取得済み強化、
残りHP、命中率などによって価値が変わるようにする。攻撃強化は序中盤の命中改善
（射撃方向数、弾速、連射、追尾）と、長期Waveの耐久増加へ対応する威力強化を両方持つ。
砲塔型のレベルアップ候補には`TURRET DRIVE`を必ず1枠提示し、取得ごとに砲塔旋回速度を
16%上げる。残り2枠は既存の共通強化から選び、砲塔強化の追加で従来ビルドを削除しない。

ゲームプレイと学習を別モードには分けない。通常のWave進行、ラン内成長、Permanent
Research、Ascensionが動く本編そのものがオンライン学習環境でもある。旧Training URLは
互換入口として残しても、通常URLと同じ進行・セーブ・ルールを使用する。

### 宇宙空間の移動物理

自機の移動は速度を直接指定せず、スラスターの加速度を速度ベクトルへ加える。
推力を切っても空気抵抗による自然減速は発生せず、現在の速度と進行方向を維持する。
機首を旋回しても速度ベクトルは即座に追従しない。減速や方向転換には逆噴射、
別方向への推力、または境界との衝突が必要になる。

| 機体 | 前進加速度 | 後退加速度 | 横加速度 | 最高速度 |
|---|---:|---:|---:|---:|
| 旋回型 | 390 | 245 | 0 | 270 |
| 平行移動型 | 270 | 205 | 135 | 205 |
| 砲塔型 | 255 | 165 | 0 | 190 |

最高速度だけはゲーム空間の可読性と回避可能性を守るため機体ごとに制限する。
AI観測には速度帯と、機首基準の移動方向セクターを含める。

---

## レベルデザイン

### 大前提: Waveに終点はない

このゲームに最終Waveやキャンペーンクリアは置かない。Wave番号は1から始まり、
撃墜または任意のAscensionまで無制限に増え続ける。Wave 100、1,000、10,000以降も
同じ生成規則から戦闘が成立し、最高Wave更新そのものが長期目標になる。

```text
Wave 1 → 2 → 3 → … → 100 → … → 10,000 → …
                │                       │
                ├─ 撃墜 → 強化して自動再出撃
                └─ Ascension → Wave 1へ戻り、より速く以前の最高地点を越える
```

有限なのは敵や武器の基本アーキタイプであり、その組み合わせ、Elite特性、数値段階、
Ascension Modifier、RLの適応には終点を作らない。

### 基本原則

難度は単純なHP倍率ではなく、次の5軸を組み合わせて上げる。

| 軸 | 変化 | 試される能力 |
|---|---|---|
| 密度 | 同時出現数、出現間隔 | 経路選択、範囲攻撃 |
| 方向 | スポーン方向数、包囲速度 | 360度認識、退路確保 |
| 速度 | 移動・弾速・突進頻度 | 早期反応、回避 |
| 耐久 | HP、装甲、シールド | 集中攻撃、武器相性 |
| ルール | 分裂、牽引、妨害、地雷 | 状況認識、方針変更 |

一つのWaveで上げる軸は原則1〜2個にする。敗北理由を読み取れない
「全部が急に強い」Waveを避ける。

### 無限Waveの反復構造

5Waveを1サイクルとして永久に繰り返す。固定ステージを並べるのではなく、
サイクルの役割と現在のWave番号からDirectorが内容を生成する。

| サイクル内 | 役割 | 内容 |
|---|---|---|
| 1 | 回復/誇示 | 直前の強化で敵を圧倒し、成長を見せる |
| 2 | 上昇 | 敵の量または耐久を一段上げる |
| 3 | 混成 | 2〜3種の役割を組み合わせる |
| 4 | 圧力 | 多方向、Elite、環境効果を加える |
| 5 | 試験 | Elite群またはBossで現在の限界を測る |

試験Wave突破後にチェックポイントを置き、RLによる強化選択、HPの一部回復、
戦闘統計の短い表示を行う。強化選択も戦闘方策の一部なので、放置中を含めて
RLエージェントが選ぶ。プレイヤーの優先タグは候補生成や報酬への介入として扱う。

さらに長期のリズムを重ねる。

- **5Wave**: 小サイクル。強化選択
- **25Wave**: Zone更新。背景色、敵Modifier、報酬倍率が変化
- **100Wave**: Overlord Boss、Core報酬、モデル評価
- **1,000Wave**: Epoch更新。表示上の大きな節目と恒久実績

これらはクリア地点ではなく、次の倍率帯へ入るゲートである。

### 敵解放帯（上限ではない）

#### Calibration（初回Wave 1〜5）

- 敵: Scoutのみ
- 目的: 移動、旋回、正面射撃、距離認識を学ぶ
- 画面端から1〜2方向でスポーン
- 初回プレイでも60秒以上生存できる強さ

#### Crossfire（初回Wave 6〜15）

- Gunnerを追加
- 近接敵と遠距離弾の同時処理
- 2〜3方向スポーン
- 回避行動と射線管理が必要になる

#### Breaker（初回Wave 16〜30）

- Brute、突進型、分裂型を追加
- 単体火力と範囲火力の使い分け
- 敵の組み合わせによって安全距離が変化
- 最初の武器ビルド試験

#### Siege（初回Wave 31〜50）

- シールド、支援、減速弾、地雷を追加
- 優先標的の選択が必要
- 4方向以上からの段階的包囲
- 固定した一つの行動パターンでは突破できない

#### Evolution（初回Wave 51以降、永久生成）

- DirectorがプレイヤーのビルドとAIの得意行動を評価して編成を変える
- 高い命中率には小型高速敵、引き撃ちには挟撃、範囲火力にはEliteを混ぜる
- 完全なカウンターではなく、得意戦法だけで無限に進むことを防ぐ
- 5Waveごとに試験、25WaveごとにZone、100WaveごとにOverlordを生成
- 敵の基礎種を際限なく増やすのではなく、Elite特性と混成で無限の段階を作る

### 敵アーキタイプ

| 敵 | 戦場での役割 | RLへの課題 | 武器への課題 |
|---|---|---|---|
| Scout | 高速接近 | 旋回と距離維持 | 追尾/連射 |
| Gunner | 遠距離射撃 | 射線回避 | 長射程 |
| Brute | 低速高耐久 | 接触回避 | 単体DPS |
| Swarm | 小型の群れ | 包囲脱出 | 範囲攻撃 |
| Splitter | 撃破時に分裂 | 撃破位置の選択 | 貫通/爆発 |
| Warden | 周囲へシールド | 優先標的 | 精密射撃 |
| Dasher | 予告後に突進 | 予測回避 | 減速/ノックバック |
| Jammer | センサーを妨害 | 不完全観測 | 自律/設置武器 |
| Fortress | Boss | 全能力の統合 | ビルド完成度 |

### Directorによる動的難度

Directorは敵を弱くして救済するのではなく、次のWaveの「問い」を選ぶ。

入力:

- 直近3Waveの被弾率
- 命中率とオーバーキル率
- 敵との平均距離
- 使用武器のダメージ比率
- 画面端滞在率
- 行動エントロピー

出力:

- 次Waveの主アーキタイプ
- スポーン方向パターン
- Elite特性
- 敵予算

同じシードと同じDirector入力からは同じWaveを生成できるようにする。
リプレイとバランス検証の再現性を守るため、ラン中の乱数はすべてシード管理する。

### 敵予算

敵の強さはWaveごとの予算から生成する。

```text
cycle = floor((wave - 1) / 5)
zone = floor((wave - 1) / 25)

baseBudget(wave) = 10 × 1.075^(wave - 1)
compositionBudget = baseBudget × ascensionMultiplier × difficulty

Scout  = 1.0
Gunner = 2.2
Brute  = 4.5
Warden = 6.0
Elite modifier = 元コスト × 1.8〜3.5
Boss = そのWave予算の35〜55%
```

敵数を無限に増やすと描画と認知が破綻するため、同時存在数には上限を設ける。
上限到達後はHP、攻撃、Elite特性、再出現速度へ予算を移す。

```text
同時敵数 soft cap = 80
同時敵弾 soft cap = 300
上限超過分の予算:
  50% → HP/装甲
  25% → 攻撃/弾速
  15% → Elite特性
  10% → 撃破後の即時補充
```

指数は初期値であり、実測により調整する。「敵DPS」「敵の場持ち」
「同時認知負荷」を別々に測り、総予算だけで安全と判断しない。
Wave 10,000以降もオーバーフローしないよう、内部計算は後述する巨大数形式を使う。

### Waveテンプレート形式

無限Waveを1件ずつ保存することはできないため、静的なテンプレートと生成式だけを定義する。
実際のWaveは`waveNumber + runSeed + ascension + Director入力`から決定論的に生成する。

```ts
type ArenaWaveTemplate = {
  id: string;
  cycleSlot: 1 | 2 | 3 | 4 | 5;
  role: 'showcase' | 'ramp' | 'mixed' | 'pressure' | 'exam';
  minimumWave: number;
  spawnPattern: 'single' | 'opposite' | 'cross' | 'spiral' | 'surround';
  allowedEnemyTags: string[];
  budgetWeights: {
    count: number;
    durability: number;
    offense: number;
    elite: number;
  };
  reward: {
    xpMultiplier: number;
    scrapMultiplier: number;
  };
};

type GeneratedArenaWave = {
  waveNumber: string;
  templateId: string;
  generationSeed: string;
  budget: BigValue;
  durationSeconds: number;
  spawnGroups: ArenaSpawnGroup[];
  modifiers: ArenaWaveModifier[];
  bossId?: string;
  definitionHash: string;
};

type ArenaSpawnGroup = {
  enemyId: string;
  count: number;
  startSecond: number;
  intervalSeconds: number;
  entrySectors: number[];
  formation: 'single' | 'line' | 'arc' | 'cluster';
  eliteChance: number;
};

type ArenaWaveModifier =
  | { type: 'enemy_hp'; multiplier: BigValue }
  | { type: 'enemy_speed'; multiplier: number }
  | { type: 'enemy_fire_rate'; multiplier: number }
  | { type: 'sensor_jam'; strength: number }
  | { type: 'arena_hazard'; hazardId: string };
```

#### 定義例

```json
{
  "id": "crossfire-exam",
  "cycleSlot": 5,
  "role": "exam",
  "minimumWave": 10,
  "spawnPattern": "opposite",
  "allowedEnemyTags": ["scout", "gunner", "crossfire"],
  "budgetWeights": {
    "count": 0.35,
    "durability": 0.2,
    "offense": 0.25,
    "elite": 0.2
  },
  "reward": {
    "xpMultiplier": 1.25,
    "scrapMultiplier": 1.5
  }
}
```

#### Wave定義のルール

- 新敵の初回解放時だけ専用の導入テンプレートを優先する
- `showcase`は前サイクルより予算を20〜30%下げる
- `mixed`までは主な役割の組み合わせを3種類以内にする
- `exam`には報酬選択またはチェックポイントを必ず付ける
- Directorによる予算増減は通常Waveで±15%、Boss Waveで±5%以内
- Wave番号、テンプレートID、生成seedをセーブし、同じWaveを再生成可能にする
- 読み込み時に敵コスト合計、出現時刻、未登録ID、Tier逸脱を検証する
- 生成結果から`definitionHash`を作り、runセーブへ記録する

### Wave進行状態

Waveの静的定義と、進行中の可変状態は分けて保存する。

```ts
type ArenaWaveRuntimeState = {
  waveNumber: string;
  definitionId: string;
  definitionHash: string;
  elapsedSeconds: number;
  phase: 'warning' | 'active' | 'cleanup' | 'reward';
  spawnedByGroup: number[];
  remainingEnemyIds: number[];
  directorAdjustment: number;
  completed: boolean;
};
```

アップデートによって同じWave定義が変わり`definitionHash`が一致しない場合は、
進行中Waveだけを直前の安全なWaveチェックポイントから再開する。恒久進行、
ラン内装備、RLモデルは巻き戻さない。

### 難度の波

難度を常に右肩上がりにしない。

```text
導入 → 上昇 → 小休止 → 混成 → Boss → 報酬
```

Boss直後のWaveは敵予算を20〜30%下げ、新しい武器が強くなったことを見せる。
強化直後に敵も同じだけ強くして、成長を相殺しない。

---

## 武器成長

### 武器の役割

武器強化はDPS増加だけでなく、RLが学べる戦術を増やす。

| 系統 | 初期挙動 | 発展 | RL行動への影響 |
|---|---|---|---|
| Pulse | 正面単発 | 連射、貫通、跳弾 | 正面を向ける価値 |
| Missile | 低速追尾 | 多弾頭、爆発、再追尾 | 向きへの依存を下げる |
| Beam | 短時間照射 | 貫通、回転、連鎖 | 照準維持を学ぶ |
| Drone | 周回自動攻撃 | 台数、迎撃、集中 | 防御的移動を可能にする |
| Mine | 後方設置 | 吸引、連鎖、減速 | 退路設計を学ぶ |
| Nova | 周囲攻撃 | 範囲、クールダウン、反射 | 包囲への対抗 |

### ラン内成長

- 撃破XPでレベルアップ
- 3択から武器取得または強化
- 同じ強化を重ねるとLv.5で進化候補
- 武器スロットは初期2、恒久強化で最大4
- 能力候補にはタグを持たせる: `single`, `area`, `defense`, `mobility`, `economy`
- RLは候補、機体種、戦況、取得済み強化を観測し、選択結果を長期報酬で学習
- プレイヤーのタグ優先順位は候補出現率または報酬ウェイトを調整し、選択自体はRLが行う

### 恒久成長

- 武器解放: 新しい行動空間を増やす
- 基礎研究: 小さな数値補正
- Mastery: その武器を使った実績で挙動分岐を解放
- Blueprint: Bossドロップ。新しい進化先を解放

恒久DPS倍率は抑え、序盤Waveの再走を短縮する程度にする。
恒久成長の主報酬は「新しい選択肢」「オート化」「観測能力」とする。

---

## RL設計

### 現プロトタイプ

現在は8方向センサーと離散行動を使う表形式Q学習。

- 観測: 最寄り敵方向、最大脅威方向、距離帯、HP帯、敵数帯、射撃可能状態
- 行動: 前進、後退、左右旋回、それらと射撃の組み合わせ
- 報酬: 生存、命中、撃破、被弾、死亡

これはコアループ検証には十分だが、武器切り替え、多数の敵、連続的な回避を
長期学習するには状態表現が粗い。正式版では段階的に置き換える。

### モデル共有方針

基本方針は、全機体で一つの学習モデルを共有する。

- 観測へ`craftType`、機首角、移動速度、砲塔角、各軸の旋回可能量を含める
- 機体に存在しない操作はaction maskで選択不能にする
- 敵、敵弾、画面端、交戦距離の読み方は機体間で共有する
- 機体別の命中率、回避率、到達Wave、強化選択を別々に集計する
- プレイヤー指定またはAUTO抽選による機体決定はモデルの行動に含めない

共通モデルなら、ある機体で学んだ脅威認識や敵弾回避を別機体へ転用でき、各機体で
集めた経験を一つのモデルへ蓄積できる。一方、機体ごとの操作差による負の転移は監視する。
固定評価で「共通モデルが特定機体だけ継続的に悪化させる」ことが確認された場合は、
観測encoderを共有し、移動・照準・強化選択の出力headだけを機体別に分ける。
完全な機体別モデルは標準方式にせず、共通モデルとの比較ベンチマークとして保持する。

表形式Q学習の段階では状態キーへ機体種を追加する。同じQテーブル内で管理するが、
機体種ごとに状態が分かれるため、誤った行動価値の混在を防ぐ。DQN移行後に共通encoderの
転移効果を本格的に利用する。

### 発展段階

#### Stage A: Tabular Q（現行）

- レベルデザインと報酬設計の検証
- 決定論的なヘッドレスシミュレーション
- セーブ・ロードとモデル世代管理の確立

#### Stage B: DQN

- 固定長ベクトル観測
- Experience Replay
- Target Network
- Double DQN
- 推論と学習をWeb Workerへ分離
- TensorFlow.jsまたは小規模な自前推論層を比較検証

#### Stage C: Hierarchical Policy

- 高レベル: 目標敵、交戦距離、回避方針、武器選択
- 低レベル: 移動、旋回、射撃
- 武器が増えても行動空間が爆発しにくい構造

### 正式版の観測

```text
自機:
  機体種、HP、速度、移動方向、機首方向、砲塔方向、4辺までの距離、
  最寄り画面端の相対方向、各武器CD、実発射数、発射数の奇数/偶数

8〜16方向センサー:
  最寄り敵距離、敵密度、敵弾距離、接近速度、推定被弾時間

優先候補上位N体:
  相対位置、速度、HP、種別、脅威値、シールド状態

グローバル:
  Wave、敵数帯、敵弾数帯、敵残数、Boss状態、利用可能能力、取得済み強化、提示中の強化候補
```

生のCanvas画像を観測には使わない。学習速度、デバッグ性、セーブサイズ、
決定再現性を優先して構造化ベクトルを使う。

方向センサーは画面の縦横比に影響されない、機体中心の等角度セクターとして計算する。
描画も同じ境界角を使い、観測上の方向と画面表示を一致させる。敵本体と敵弾は別チャネル
にし、複数の敵がいる状況でも接近中の弾を敵密度に埋もれさせない。
敵数と敵弾数は`0 / 1〜2 / 3〜5 / 6〜9 / 10以上`の5段階で観測する。
画面端は左・右・上・下の各距離帯と、機首基準で最も近い端の方向を観測する。
拡散射撃は実際の発射体数と偶奇を別に観測する。奇数弾は照準軸上に中央弾を持つが、
偶数弾は照準軸を挟むため中央が空き、同じ照準誤差でも命中特性が異なる。

### 行動空間

正式版はMulti-Discreteを基本とする。

```text
forward:   -1 / 0 / +1
strafe:    -1 / 0 / +1
hullTurn:  -1 / 0 / +1
turretTurn:-1 / 0 / +1
fire:      off / on
target:    nearest / threat / weak / boss / manual-slot
weapon:    keep / next / slot 1..4
ability:   none / slot 1..2
```

すべての組み合わせを一つの巨大な離散行動にしない。各ヘッドを分離するか、
階層方策にして無効行動をマスクする。たとえば旋回型では`strafe`と`turretTurn`、
平行移動型では`turretTurn`、砲塔型では機体仕様にない軸をマスクする。

レベルアップは通常tickの行動とは別の高レベル方策として扱う。候補ID、強化タグ、
現在レベル、機体種、戦闘統計を観測し、提示候補から一つを選ぶ。選択直後の小さな
疑似報酬だけで決めず、その後の命中率、生存、撃破速度、Wave進行を選択時点へ還元する。

### 報酬設計

```text
+ 撃破価値
+ 与ダメージ × 小係数
+ 生存時間 × ごく小さい係数
+ 危険弾の回避成功
+ Bossフェーズ進行

- 被ダメージ
- 死亡
- 画面端への衝突
- 画面端付近への長時間滞在
- 無効射撃/過剰な弾薬消費
- 長時間の画面端張り付き
- 同一行動の不必要な反復
```

「生存だけして攻撃しない」「画面端を回り続ける」「弾を乱射する」といった
報酬ハックを、統計テストで検出する。照準方向そのものへ強い報酬を与えすぎず、
最終的には撃破と生存から戦術を学ばせる。

画面端付近では端から離れる移動へ小さな正報酬、さらに近づく移動へ小さな負報酬を与え、
実際の境界衝突には明確な負報酬を与える。端情報を観測するだけでなく、回避を学ぶ理由を作る。

### RLの成長を見せる指標

- 10エピソード移動平均生存時間
- 同一装備・同一シードでの最高Wave
- 命中率、被弾/分、撃破/分
- 危険弾回避率
- 平均交戦距離
- 無駄撃ち率
- 行動エントロピー
- 旧チャンピオンモデルとの評価戦勝率

モデル昇格は通常ランの一度の高得点ではなく、固定評価シード群で判定する。

### 学習とゲーム進行の分離

敵を倒せなくなった原因が「装備不足」か「操作不足」かを判定できるよう、
次の2種類の評価を定期実行する。

1. **固定装備ベンチマーク**: 操作能力だけを比較
2. **固定モデルベンチマーク**: 武器・恒久強化だけを比較

これにより、敵・武器・AIの三重成長が実際に成立しているか測定できる。

---

## 経済とプレステージ

### Cookie Clicker型の増加感

ゲームの快感は「前回苦戦したWaveを、次の周回では一瞬で通過する」ことから作る。
敵と自機の数値は長期的に指数増加し、表示は`K / M / B / T / Qa`から科学表記へ移る。

```text
序盤:     12 → 180 → 4.2K
中盤:     8.5M → 2.1B → 740T
長期:     3.48e42 → 9.12e103
```

ただし画面上の敵数や弾数は際限なく増やさない。巨大化するのは火力、耐久、
資源倍率、Wave番号であり、描画負荷はsoft capで一定範囲に保つ。

成長速度は三段階に分ける。

1. **秒単位**: 撃破、XP、Scrap、武器レベル
2. **分単位**: 撃墜収穫、Data研究、自動再出撃
3. **時間単位**: Ascension、Core研究、モデル世代更新

### 複利成長の構造

撃破がCookie Clickerのクリック、武器とDroneが自動生産設備に相当する。
敵を倒すほど武器が増え、武器が増えるほど撃破が速くなり、より高いWaveの
報酬倍率へ到達して、さらに購入速度が上がる正のフィードバックを作る。

```text
撃破 → Scrap/XP
  → 武器レベル/DPS上昇
    → 1秒あたり撃破数上昇
      → Wave進行速度と報酬倍率上昇
        → さらに速く武器を購入
```

武器レベルの基本コスト:

```text
cost(level) = baseCost × 1.15^level
weaponPower(level) = basePower × 1.12^level
```

単純にはコスト増加が出力増加を上回るため、以下の節目倍率で停滞を破る。

| レベル | 節目効果 |
|---:|---|
| 10 | 武器DPS ×2 |
| 25 | 発射体または攻撃回数 +1 |
| 50 | 武器DPS ×5、外見変化 |
| 100 | 武器進化、DPS ×10 |
| 以降100ごと | 累積DPS ×10または新特性 |

購入UIは`+1 / +10 / +100 / MAX / NEXT MILESTONE`へ対応する。
プレイヤーが不在でも、設定した優先順位に従ってAuto Buyerが購入する。

### 停滞と突破

インクリメンタルゲームには意図的な壁を置くが、何も起きない時間にはしない。

- 通常壁: 数分。武器レベルとRL改善で突破
- Zone壁: 10〜30分。ビルド変更またはData研究で突破
- Ascension壁: 1〜3時間。Ascensionで倍率を獲得して突破
- 長期壁: 数日。Core研究、新武器、モデル世代の改善で突破

壁で止まっている間も撃破、資源獲得、モデル学習は進む。現在のDPSと敵HPから
「突破予測 12分」「次の武器節目まで 3分」のように進展を表示する。

### 資源

| 資源 | 入手 | 消費 | リセット |
|---|---|---|---|
| XP | ラン中の撃破 | ラン内レベル | 撃墜時 |
| Scrap | 敵の撃破 | 撃墜時に2%をDataへ変換 | 撃墜時 |
| Data | エピソード評価 | センサー、学習、オート化 | 維持 |
| Core | Boss、最高Wave更新 | 武器解放、スロット | 維持 |
| Ascendium | Ascension | 世界規模の恒久強化 | 維持 |

### 撃墜時の収穫

```text
Data = floor(
  最高到達Wave × 2
  + 撃破数 × 0.35
  + Scrap × 0.02
)
```

最低保証を設け、短い失敗でも少量のDataを得る。ただし、意図的な即死周回が
最適にならないよう最低保証には時間クールダウンを付ける。

### Ascension

- 到達Wave 50以降で任意実行し、以後は到達Waveに応じて収益が指数的に増える
- 武器解放、Data、モデルは維持
- 到達Waveに応じてAscendiumを獲得
- Wave 1へ戻るが、恒久倍率により以前のWaveを高速で通過する
- 敵倍率と報酬倍率、新しいDirector Modifierを一段上げる
- 新しい観測または行動を解放する

```text
Ascendium獲得 =
  floor((highestWave / 50)^1.65 × ascensionBonus)
```

Ascension後の目標は、前回最高Waveの80%地点までを前回所要時間の
25〜40%で再到達すること。周回を重ねるたび、序盤が目に見えて高速化する。

モデルを完全に消さない。新環境への適応を見せるため、探索率を一時的に上げ、
Replay Bufferは新旧データの混合比率を調整する。

### オフライン進行

- 最後のChampionモデル、装備DPS、到達Wave、直近の撃破速度から要約計算する
- オフライン中の秒単位戦闘を全フレーム再現しない
- 安全に周回できるWaveまでは高速進行し、推定死亡地点で自動収穫する
- オート再出撃解放後は複数エピソードをまとめて計算する
- RLの重みはオフライン中に直接学習させない
- 代わりに「Training Data」を蓄積し、復帰後の学習へ利用する
- 初期上限8時間、研究で24時間まで拡張する

---

## セーブ設計

### 原則

1. **ゲーム進行とRLモデルを別スロットにする**
2. **セーブ中断でランが壊れないよう、書き込みは原子的に扱う**
3. **必ずschemaVersionとmodelFormatVersionを持つ**
4. **乱数状態を保存し、必要なら戦闘を再現できる**
5. **巨大なReplay Bufferと小さな進行データを分離する**
6. **破損時に直前の世代へ戻せる**
7. **古いセーブは読み取り後に段階的マイグレーションする**

### 巨大数形式

JavaScriptの`number`へ依存すると約`1.79e308`でInfinityになり、整数精度はそれより
はるか前に失われる。Wave、通貨、HP、ダメージは仮数と10進指数に分けて保存する。

```ts
type BigValue = {
  mantissa: number; // 1以上10未満、0だけは0
  exponent: number; // 10の指数
};

// 3.48e42
const example: BigValue = { mantissa: 3.48, exponent: 42 };
```

- 加算、乗算、比較、対数、短縮表示を共通モジュールへ集約する
- JSONでInfinity、NaN、実装依存の巨大数ライブラリ内部値を保存しない
- Wave番号は当面`number`で計算し、セーブ上は10進文字列として保持する
- すべてのBigValueは保存前に正規化する
- 単体テストで`1e10,000`相当まで演算と往復を検証する

### 保存先

正式版ではElectronメインプロセス側へセーブAPIを置き、`app.getPath('userData')` 配下へ保存する。
ブラウザの`localStorage`だけに依存しない。

```text
userData/
  rl-arena/
    profile.json
    run.json
    settings.json
    models/
      champion/
        manifest.json
        weights.bin
      training/
        manifest.json
        weights.bin
      archive/
        gen-000120/
    replay/
      replay-000042.bin
    history/
      episodes-2026-07.jsonl
    backups/
      profile.prev.json
      run.prev.json
```

### セーブ単位

#### `profile.json`

プレイヤーの恒久進行。小さく、Steam Cloud対象にする。

```ts
type ArenaProfileSave = {
  schemaVersion: number;
  saveId: string;
  createdAt: string;
  updatedAt: string;
  playtimeSeconds: number;
  currencies: {
    data: BigValue;
    cores: BigValue;
    ascendium: BigValue;
  };
  progression: {
    ascension: number;
    highestWave: string;
    totalKills: BigValue;
    totalEpisodes: number;
    unlockedWeapons: string[];
    unlockedUpgrades: string[];
    researchLevels: Record<string, number>;
  };
  loadouts: ArenaLoadoutSave[];
  automation: {
    autoRestart: boolean;
    autoUpgrade: boolean;
    preferredTags: string[];
  };
  activeModelId: string;
  checksum: string;
};
```

#### `run.json`

現在のラン。頻繁に更新するが、消えてもprofileは失わない。

```ts
type ArenaRunSave = {
  schemaVersion: number;
  runId: string;
  seed: string;
  rngState: number[];
  startedAt: string;
  wave: string;
  episodeTime: number;
  score: BigValue;
  xp: BigValue;
  scrap: BigValue;
  ship: SerializedShip;
  enemies: SerializedEnemy[];
  projectiles: SerializedProjectile[];
  weapons: SerializedWeapon[];
  director: SerializedDirectorState;
  pendingChoice: SerializedUpgradeChoice | null;
  lastSafeCheckpointWave: number;
};
```

Particleや画面揺れなど、再開後の戦闘結果に影響しない表示専用状態は保存しない。

#### `models/*/manifest.json`

```ts
type ArenaModelManifest = {
  modelFormatVersion: number;
  modelId: string;
  generation: number;
  algorithm: 'tabular-q' | 'dqn' | 'hierarchical-dqn';
  createdAt: string;
  observationSpecHash: string;
  actionSpecHash: string;
  rewardSpecVersion: number;
  trainingSteps: number;
  episodeCount: number;
  epsilon: number;
  evaluation: {
    seedSetVersion: number;
    meanWave: number;
    meanReward: number;
    survivalSeconds: number;
    hitRate: number;
    damageTakenPerMinute: number;
  };
  weightsFile: string;
  weightsChecksum: string;
  parentModelId: string | null;
};
```

観測または行動仕様が変わったモデルを誤ってロードしないよう、
`observationSpecHash`と`actionSpecHash`を照合する。

### オートセーブ契機

- Wave終了時
- レベルアップ選択直後
- Boss撃破直後
- 撃墜・エピソード確定時
- 恒久アップグレード購入時
- モデル昇格時
- アプリ終了要求時
- 60秒ごとの低頻度チェックポイント

戦闘の毎フレーム保存は行わない。

### 原子的書き込み

```text
1. profile.tmpへ書く
2. JSON構造とchecksumを検証
3. 現profile.jsonをprofile.prev.jsonへ移動
4. profile.tmpをprofile.jsonへrename
```

モデルもmanifestとweightsを一時ディレクトリへ書き、両方の検証後に世代ディレクトリを
切り替える。profileが未完成モデルを参照しないよう、モデル確定後に`activeModelId`を更新する。

### 世代管理

- `training`: 現在学習中
- `champion`: 固定評価で最良のモデル
- `archive`: 直近5世代、節目の世代、最高記録世代
- 通常戦闘は設定によりtraining/championを選択
- trainingが壊れた場合はchampionから復元

モデル昇格条件の初期値:

```text
固定20シードで評価
meanWaveがchampion比 +3%以上
かつ damageTakenPerMinuteが +10%より悪化していない
最低5エピソード分の新規学習
```

### Replay Buffer

- profileやモデル本体とは別ファイル
- 上限件数を設定したリングバッファ
- 古い経験を一様に消さず、Boss・死亡直前・新敵初遭遇を一定割合保持
- 破損しても学習履歴を失うだけで、モデルと進行はロード可能
- Steam Cloud対象外を基本とする

### マイグレーション

```ts
const migrations = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};
```

- 一度に最新版へ変換せず、1バージョンずつ適用
- 変換前ファイルをbackupsへ残す
- 未知の未来バージョンは書き換えず、読み込みを停止
- 武器ID変更時はaliasテーブルで変換
- モデル互換性がない場合もprofileは維持し、新モデルへ知識蒸留または初期化を選べる

### インポート・エクスポート

- profile、モデルmanifest、weightsを一つのzip相当へまとめる
- Replay Bufferと詳細履歴は任意
- 秘密情報やマシン固有パスを含めない
- 読み込み前にサイズ上限、schema、checksumを検証

---

## UI・観察性

### 通常HUD

- HP、Wave、敵残数、スコア
- 現在武器とクールダウン
- RLの現在行動と標的
- 探索/活用状態
- 直近報酬

### 学習HUD

- 現モデル世代とChampion世代
- 生存時間の移動平均
- 命中率、被弾率、回避率
- 今回の学習差分
- 直近10エピソードの小さな折れ線

### 死亡画面

「敗北」ではなく「TRAINING COMPLETE」として表示する。

- 到達Wave
- 主要死因
- 最高記録との差
- 獲得Data/Core
- 操作能力の改善指標
- モデル昇格の有無
- 次の出撃までのカウントダウン

### コンパクトモード

- 画面隅に固定できる小型ウィンドウ
- HUDはHP、Wave、現在行動だけ
- 重要イベント時のみ展開
- マウス透過の切り替え
- 常時最前面の切り替え
- 低負荷30fpsモード

---

## 技術構成

```text
apps/arena-shooter/
  arena_shooter.ts            ブートストラップ
  arena_shooter_core.ts       決定論的シミュレーション
  arena_shooter_agent.ts      RL推論インターフェース
  arena_shooter_weapons.ts    武器と弾
  arena_shooter_enemies.ts    敵アーキタイプ
  arena_shooter_director.ts   Wave生成と難度
  arena_shooter_progression.ts XP、選択、恒久成長
  arena_shooter_render.ts     Canvas描画
  arena_shooter_ui.ts         HUDと選択画面

game/arena-shooter/
  arena_shooter_save.ts       Electron側セーブ
  arena_shooter_migrations.ts schema migration
  arena_shooter_model_store.ts モデル世代管理

shared/types/
  arena_shooter.ts            境界を越える型

scripts/
  arena_shooter_headless_sim.ts
  arena_shooter_balance_sweep.ts
  arena_shooter_save_migration.test.ts
  arena_shooter_determinism.test.ts
```

シミュレーションはDOM、Canvas、Electronに依存させない。ヘッドレスで数千ランを高速実行し、
レベル曲線とRL学習を検証できる構造を守る。

---

## 開発フェーズ

### P0: 永続化可能なゲームループ

- [ ] 乱数をseeded RNGへ統一する
- [ ] 5Waveサイクルを無限生成するWave Directorを実装する
- [ ] BigValue演算、短縮表記、JSON codecを実装する
- [ ] XPと3択レベルアップを実装する
- [ ] Pulse、Missile、Novaの3武器を実装する
- [ ] Dataと撃墜時の収穫画面を実装する
- [ ] profile/run/modelを分離したセーブAPIを実装する
- [ ] Qテーブルのserialize/deserializeを実装する
- [ ] オートセーブ、バックアップ、checksumを実装する
- [ ] セーブ往復と破損復旧のテストを追加する

完了条件:

- アプリを終了してもWave、資源、装備、Qテーブルが復元される
- 30分放置で複数エピソードが自動進行する
- セーブを意図的に壊すと直前バックアップから復旧する
- Wave 10,000相当を生成しても数値や描画が破綻しない

### P1: レベルデザイン成立

- [ ] 5Wave単位の誇示→上昇→混成→圧力→試験を無限反復する
- [ ] 8種の敵アーキタイプを段階解放する
- [ ] 敵予算、Waveテンプレート、スポーンパターンをデータ定義化する
- [ ] 25WaveのZone、100WaveのOverlord、1,000WaveのEpochを実装する
- [ ] Bossを2種実装する
- [ ] Directorの入力統計と次Wave選択を実装する
- [ ] Wave予告と死亡理由表示を実装する
- [ ] バランススイープを自動化する

完了条件:

- 新敵の初登場Waveで単独挙動を理解できる
- 各Wave帯で主な敗北理由が1〜2種類に説明できる
- 同一seed・同一action列で結果が完全一致する
- 強化直後にプレイヤーが明確なパワー上昇を観察できる
- Wave 1,000以降も敵数soft capを守りながら難度が増加する

### P2: 武器とビルド

- [ ] 6系統の基本武器を実装する
- [ ] 各武器に最低2つの進化先を作る
- [ ] 武器タグと放置用自動選択を実装する
- [ ] BlueprintとMasteryを実装する
- [ ] ロードアウトを3枠保存できるようにする
- [ ] DPSだけでなく行動戦術が変わる強化を検証する

完了条件:

- 単体、範囲、防御、機動の4ビルドが少なくともTier 3まで成立する
- 一つの武器系統が全敵への最適解にならない
- RLが武器ごとに異なる平均交戦距離を獲得する

### P3: DQNとモデル競争

- [ ] `ArenaAgent`インターフェースでTabular/DQNを交換可能にする
- [ ] Web Worker学習を実装する
- [ ] Replay BufferとTarget Networkを実装する
- [ ] 固定評価seedセットを作る
- [ ] training/champion/archiveを実装する
- [ ] Champion昇格とロールバックを実装する
- [ ] 固定装備/固定モデルベンチマークを実装する

完了条件:

- 描画fpsと学習処理が分離される
- 同じ装備で世代間の改善を統計的に比較できる
- 観測・行動仕様不一致のモデルを安全に拒否できる
- 学習モデルが壊れてもChampionで継続できる

### P4: デスクトップ常駐体験

- [ ] コンパクトウィンドウと通常ウィンドウを切り替える
- [ ] 位置・サイズ・ディスプレイを保存する
- [ ] マウス透過、常時最前面、低負荷モードを実装する
- [ ] バックグラウンド時のsimulation tickを検証する
- [ ] 通知頻度と音量をイベント別に設定可能にする
- [ ] 長時間稼働テストを追加する

完了条件:

- 8時間動作でメモリが増え続けない
- コンパクト表示でも死亡理由と現在Waveが読める
- 別作業を妨げず、必要な選択だけ通知できる

### P5: Ascensionと長期運用

- [ ] 無限反復可能なAscensionと世界Modifierを実装する
- [ ] オフライン進行を要約シミュレーション方式で実装する
- [ ] Wave 10,000以降の科学表記と巨大数セーブを検証する
- [ ] 研究ツリーと自動化解放を実装する
- [ ] 長期実績とモデル殿堂を実装する
- [ ] セーブのexport/importを実装する
- [ ] 古いschema/modelからのmigration fixtureを蓄積する

---

## バランス検証

### 自動シミュレーション

各変更で最低限、次をヘッドレス実行する。

- 初期モデル × 初期装備 × 100seed
- Champion × 初期装備 × 100seed
- 固定モデル × 各主要武器ビルド × 100seed
- 各Ascension帯 × 代表モデル × 100seed

記録:

- Wave別生存率
- Wave別死亡原因
- 敵タイプ別被ダメージ
- 武器別ダメージ比率
- レベルアップ時間
- Data獲得/分
- 同じ行動の反復率

### 目標カーブ

| 状態 | 初回の目標到達 | 数エピソード後 |
|---|---:|---:|
| 未学習・初期装備 | Wave 4〜7 | Wave 8〜12 |
| Tier 1武器解放 | Wave 10〜15 | Wave 16〜22 |
| Tier 2研究 | Wave 20〜28 | Wave 30〜40 |

学習だけでも装備だけでも少し先へ進めるが、両方が成長すると明確に壁を突破できる配分にする。
以後は固定の到達上限を置かず、各Ascensionで前回最高Waveを10〜30%更新することを
標準ペースとする。研究が揃った節目では2〜5倍のWave更新が起きてもよい。

### 失敗判定

次の状態になった場合、レベルまたは報酬設計を見直す。

- 全モデルが同じWaveで急死する: 敵側の数値壁
- 装備更新だけで無限に進める: 操作課題不足
- 学習だけで武器選択が無意味になる: 武器差不足
- 生存時間は伸びるが撃破数が伸びない: 逃走報酬ハック
- 一種類の武器が総ダメージの80%以上を恒常的に占める: ビルド収束
- 新モデルの通常スコアは高いが固定評価で弱い: seed過学習

---

## 最初の実装順

次の変更はP0を細かく分けて進める。

1. seeded RNGとWave定義を導入
2. BigValueと無限5Waveサイクルを実装
3. 武器を自機から独立したデータモデルへ分離
4. XP、レベルアップ3択、オート選択
5. profile/run/modelの型とセーブcodecを実装
6. 表形式Qモデルを実際に保存・復元
7. 撃墜収穫画面、Data研究、Ascensionを追加
8. セーブmigration/破損復旧テスト
9. 30分放置とWave 10,000生成のヘッドレス検証

この順序なら、武器や敵を大量に追加する前に「遊んだ時間と学習成果を失わない」土台ができる。

---

## 重要な設計判断

1. RLモデルは恒久進行の一部だが、profileとは別保存する。
2. 敵難度、武器火力、RL操作能力を別ベンチマークで測る。
3. 新しい敵は単独導入してから混成する。
4. 強化直後は敵難度を一時的に緩め、強くなった絵を必ず見せる。
5. 撃墜してもモデルと恒久資源は失わない。
6. Replay Bufferが壊れてもゲームを継続できる。
7. 生の画像ではなく構造化観測で学習する。
8. 正式モデルは固定評価を通った世代だけChampionへ昇格する。
9. ゲーム進行の乱数はseed管理し、バグとバランスを再現可能にする。
10. 実装項目ごとにヘッドレス検証またはセーブ往復テストを追加する。
11. Waveに最終地点を作らず、5/25/100/1,000の節目を永久に生成する。
12. 敵数と弾数にはsoft capを設け、長時間観察しても負荷が増え続けないようにする。
13. Ascension後は過去の苦戦地点まで明確に速く戻れるようにする。
14. 巨大数を`number`のInfinityへ到達させず、保存・表示・比較できるようにする。
15. 機体はプレイヤーが指定可能とし、AUTO時はエピソードごとにseed付きで抽選する。RLに機体選択はさせない。
16. 学習モデルは全機体で共有し、機体種の観測とaction maskで操作差を表現する。
17. レベルアップ候補の選択はRLの高レベル行動とし、その後の戦果を選択へ還元する。
