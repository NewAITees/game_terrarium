# Zombie Survivor 素材パック

初期プロトタイプ用に取得した素材。すべてゲーム内で使う前に、元ファイルのライセンスとサイズを確認する。

## 収録内容

| 用途 | パス | 内容 | ライセンス |
|---|---|---|---|
| 戦闘Wave | `zombie-files/png/male/` | 男性ゾンビのIdle / Walk / Attack / Dead | CC0 |
| 戦闘Wave | `zombie-files/png/female/` | 女性ゾンビのIdle / Walk / Attack / Dead | CC0 |
| 戦闘Wave | `sources/zombie-type-a-attack.png` | 128x128攻撃スプライトシート候補 | CC0 |
| 拠点・作業タイム | `graveyard-tileset/` | 墓地タイル、墓石、背景小物 | CC0 |

## シーン別の割り当て

### Scene 1: Wave戦闘

- `male` / `female` のWalkを通常ゾンビに使用
- Attackを近接攻撃の予備動作に使用
- Deadを撃破演出に使用
- スプライトの色調変更でRunner、Brute、Carrierを派生
- 床と背景は墓地タイルセットをベースにする

### Scene 2: 作業タイム

- 墓石、墓地、夜景タイルを拠点の周辺背景に使用
- バリケード、保管箱、発電機、燃料缶、食料箱は初期プロトタイプでは既存小物または図形で仮置き
- 後続でCC0のアイテム・UI素材を追加する

### Scene 3: Wave予告・報酬

- ゾンビのシルエットを敵予告アイコンに使用
- 墓地タイルの色違いをWave危険度パネルの背景に使用
- 食料、燃料、スクラップ、XPは仮アイコンをSVGまたはCSSで作成

### Scene 4: 撃破・武器演出

- Deadアニメーション
- Canvasで血しぶき、弾道、爆発、拾得物の光を生成
- 音素材は別途、CC0または自作で追加する

## 出典

- [The Zombie - Free Sprites](https://opengameart.org/content/the-zombie-free-sprites) — pzUH、CC0。男性・女性ゾンビ、各種アニメーション。
- [Free Graveyard Platformer Tileset](https://opengameart.org/content/free-graveyard-platformer-tileset) — pzUH、CC0。墓地タイルと小物。
- [128x128 2D Zombies Spritesheet](https://opengameart.org/content/128x128-2d-zombies-spritesheet) — ashuuya、CC0。攻撃・歩行スプライトシート。

取得元のZIPは`sources/`に保存し、加工後も元素材を削除しない。
