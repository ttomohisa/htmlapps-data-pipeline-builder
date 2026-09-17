# Data Pipeline Builder / データ変換パイプライン

## 正式仕様書 + v0.1.0〜v1.0.0 開発計画

Browser Kitty向けに、新しいノード型アプリ **Data Pipeline Builder / データ変換パイプライン** を開発する。

リポジトリ名:

`ttomohisa/htmlapps-data-pipeline-builder`

英語名:

**Data Pipeline Builder**

日本語名:

**データ変換パイプライン**

---

# 1. アプリ概要

CSV / JSONL / Parquetなどの表データを読み込み、

- 列を選ぶ
- 列名を変える
- 行を絞り込む
- 並び替える
- 型を変換する
- 重複を除く
- 複数データを結合する
- 集計する
- CSV / JSONL / Parquetとして出力する

といった処理を、ノードをつないで組み立てるブラウザアプリ。

単発の表編集ツールではなく、

> 一度作ったデータ変換手順を保存し、別の同形式データにも繰り返し使える

ことを主要価値とする。

処理対象ファイルは外部サーバーへ送信せず、原則としてブラウザ内だけで処理する。

---

# 2. Browser Kittyとしての基本方針

以下を必須とする。

- ブラウザだけで完結
- 登録不要
- インストール不要
- 完全ローカル処理
- ユーザーデータを外部サーバーへ送信しない
- 単一HTML版を生成可能
- GitHub Pages / Azure Static Web Appsで利用可能
- PC / スマートフォン対応
- 日本語 / 英語対応
- リポジトリはPublic
- 最新の `htmlapps-template` に準拠
- ブランドカラー `#16624F`
- UIアイコンは原則SVG
- 技術用語を一般ユーザー向けUIへ不要に露出しない

単一HTML版では、実行時にCDNや外部APIへアクセスしない。

---

# 3. Node Editor Core

Node Editorは独自実装せず、**Node Editor Core**を使用する。

開発開始時点の最新版を使用する。

想定基準:

**Node Editor Core v1.1.x**

利用する主なCore機能:

- Graph / Node / Edge / Port
- typed Port
- NodeCanvas
- Pan / Zoom / Fit
- MiniMap
- Helper Lines
- Grid Snap
- Selection
- Edge操作
- Undo / Redo
- Clipboard
- Inspector hooks
- Runtime Status
- Validation Result
- Node追加
- Palette drag → Canvas座標変換
- Canvas Resize対応
- View State保存 / 復元

## Coreとの責務境界

Coreへ入れるもの:

- 汎用Graph操作
- 汎用Node Editor操作
- Viewport
- Connection
- History
- Selection
- Validation構造
- 汎用Canvas UX

Data Pipeline Builder側に残すもの:

- CSV / JSONL / Parquet処理
- 形式別Input / Output Adapter
- ファイル管理
- テーブルPreview
- 変換プラン生成
- Recipe
- 出力ファイル生成
- データ型
- 列設定
- Join条件
- 集計条件

Data Pipeline Builder固有の条件を `node-editor-core.mjs` へ直接追加しない。

開発中に汎用的なCore不足を発見した場合は、Consumer側で無理に回避策を増やす前にCoreへ戻せないか検討する。

---

# 4. 想定ユーザー

主な用途は、毎回似たデータ処理を行っているユーザー。

例:

### 定期CSVの整形

```text
CSV
 ↓
不要列削除
 ↓
日付型変換
 ↓
売上 > 0 の行だけ
 ↓
日付順
 ↓
CSV出力

```

### CSVとマスタの結合

```text
売上CSV ─┐
         Join
商品CSV ─┘
          ↓
       列選択
          ↓
       Parquet

```

### ログデータ集計

```text
JSONL
  ↓
Filter
  ↓
Group By
  ↓
Sort
  ↓
CSV

```

### 複数データの縦結合

```text
CSV A ─┐
CSV B ─┼─ Union → Deduplicate → CSV
CSV C ─┘

```

---

# 5. v1.0.0のスコープ

v1.0.0では**表形式データの変換**に集中する。

扱う入力:

- CSV
- TSV
- JSONL
- Parquet

扱う出力:

- CSV
- JSONL
- Parquet

将来的な候補:

- Arrow
- ORC
- Avro
- SQLite
- DuckDB
- Excel
- Clipboard
- URL

ただしv1.0.0へ無理に入れない。

---

# 6. 非ゴール

v1.0.0では以下を目的にしない。

- Excel互換アプリ
- BIツール
- データベース管理ツール
- SQL IDE
- ETLサーバー
- クラウドWorkflow
- スケジュール実行
- チーム共有
- リアルタイム共同編集
- 外部DB接続
- API接続
- Python実行
- 任意JavaScript実行

「何でもできるWorkflow Builder」にはしない。

---

# 7. 基本UI

基本構成:

```text
┌─────────────────────────────────────┐
│ Header                              │
├─────────────────────────────────────┤
│ 保存したRecipeをすぐ使う           │
├─────────┬─────────────────┬─────────┤
│ Palette │ Canvas          │ Setting │
│         │                 │ Preview │
│         │                 │         │
├─────────┴─────────────────┴─────────┤
│ Status / Run                       │
└─────────────────────────────────────┘

```

## 左: Node Palette

カテゴリ単位で開閉可能。

初期状態は開く。

Palette自身が縦スクロールし、Node数によってCanvas高さを変えない。

Node追加方法:

- クリック
- Canvasへドラッグ＆ドロップ

ドラッグ時はドロップ位置へNodeを配置する。

---

# 8. Nodeカテゴリ

## Input

### CSV Input

CSV / TSVファイルを入力する。

設定:

- ファイル
- Headerあり / なし
- 区切り文字
  - Auto
  - comma
  - tab
  - semicolon
  - pipe
- Encoding

v1.0.0ではUTF-8を基本対応とする。

### JSONL Input

1行1JSON object形式。

設定:

- ファイル
- 自動Schema推定

### Parquet Input

Parquetファイルを入力。

Schemaを自動取得する。

---

# 9. Basic Transform Nodes

## Select Columns

残す列と順番を指定。

例:

```text
id
name
price
created_at

```

ドラッグによる列順変更を可能にする。

---

## Rename Columns

複数列をまとめて変更。

```text
old_name → new_name

```

---

## Filter Rows

一般ユーザー向け条件ビルダー。

例:

```text
price > 1000
status = "active"
created_at >= 2026-01-01

```

条件:

- \=
- !=
-

>

1.

> \=

1. <
2. <=
3. contains
4. starts with
5. ends with
6. is null
7. is not null

複数条件:

- AND
- OR

Raw SQLを一般UIへ直接出さない。

---

## Sort

複数キー対応。

例:

```text
created_at DESC
id ASC

```

---

## Limit

先頭N行のみ。

---

## Cast

列の型を変換。

最低限:

- String
- Integer
- Decimal / Double
- Boolean
- Date
- Timestamp

変換できない値については明確にエラーまたはNull扱いを選択する。

黙って壊さない。

---

## Deduplicate

重複行削除。

設定:

- 全列
- 指定列

---

## Null Handling

欠損値処理。

候補:

- Null行を除く
- Nullを固定値で置換

---

# 10. Combine Nodes

## Join

2入力。

```text
Left ─┐
      Join → Table
Right ─┘

```

設定:

Join type:

- Inner
- Left
- Right
- Full

Join condition:

```text
Left.customer_id = Right.id

```

複数キー対応を目標とする。

列名衝突時は明示的に扱う。

自動で黙って列を消さない。

---

## Union

2〜6入力を想定。

PDF Pipeline Builderの複数入力Mergeと同様に、入力Port数を設定可能。

設定:

- Input数
- 列名で合わせる
- 列順で合わせる

Input数を減らした結果Connectionが消える場合は、アプリ内確認ダイアログを表示する。

---

# 11. Aggregate Nodes

## Group By

設定:

Group columns:

```text
category
date

```

Aggregates:

- Count
- Sum
- Average
- Min
- Max

例:

```text
category
SUM(price) → total_price
COUNT(*) → count

```

複数Aggregateを追加可能。

---

# 12. Output Nodes

## CSV Output

設定:

- ファイル名
- 区切り文字
- Header
- 改行

UTF-8。

---

## JSONL Output

1行1JSON object。

---

## Parquet Output

Parquet形式で保存。

---

# 13. 複数Output

v1.0.0では複数Output Nodeを許可する。

例:

```text
             → CSV Output
Input → Filter
             → Parquet Output

```

「実行」では接続された全Outputを生成する。

結果画面ではOutputごとに:

- ファイル名
- 形式
- 行数
- 列数
- ファイルサイズ
- Preview
- 保存

を表示する。

自動ダウンロードはしない。

ユーザーが「保存」を押した時だけダウンロードする。

---

# 14. 途中結果Preview

Data Pipeline Builderの重要機能とする。

Nodeを選択すると右Inspectorに、

**途中結果**

を表示する。

Output Nodeのみ:

**結果**

と表示する。

## Preview内容

最低限:

- Column名
- Data type
- 先頭100行
- 表形式Preview

可能であれば:

- 行数
- 列数
- 処理前 → 処理後の行数

例:

```text
Filter Rows

52,418 rows
↓
8,304 rows

12 columns

```

巨大データでCOUNTが高コストになる場合、Preview表示をCOUNT待ちでブロックしない。

まず100行Previewを表示し、必要に応じて行数を後から取得する。

---

# 15. Preview UI

表Previewは横スクロール可能。

ただし**ページ全体には横スクロールを発生させない**。

Column headerはstickyを推奨。

長い値はセル内で省略し、クリック等で全文を確認可能にする。

Preview右上に一般的な四隅型SVG拡大アイコンを置く。

拡大すると大きなダイアログで確認可能。

---

# 16. Execution Engine

処理エンジンは、巨大な汎用データベースランタイムを前提にせず、**形式Adapter + 共通Table Transform Runtime** とする。

基本方針:

- CSV / TSV: 内蔵JavaScript parser / writer
- JSONL: JavaScript streaming parser
- Parquet: 専用の軽量Reader / Writerをビルド時に内包
- Transform: Select / Filter / Sort / Cast / Join / Group By等を共通Table Runtimeで評価
- 完全ローカル処理
- runtime CDNなし
- runtime extension downloadなし
- `connect-src 'none'`

Parquetについては `hyparquet` / `hyparquet-writer` のようなブラウザ向け専用実装を候補とし、DuckDB-WASMのような汎用DBエンジンをv1.0.0の必須要件にはしない。

---

# 17. Execution Model

各NodeはSQL文字列ではなく、共通のTable表現に対する変換として評価する。

概念:

```text
Input Adapter
  ↓
Table { columns, rows / column buffers }
  ↓
Transform Node
  ↓
Table
  ↓
Output Adapter
```

途中Previewでは選択Nodeに必要なUpstreamだけを評価する。実装が進んだ段階で、大容量データ向けにWorker、streaming、columnar bufferを段階的に導入する。

---

# 18. Upstream-only evaluation

途中PreviewではGraph全体を実行しない。

選択Nodeに必要なUpstreamだけを評価する。

例えば:

```text
Input A → Filter → Preview
Input B → Join

```

でInput Bが未選択でも、

FilterまでのPreviewが可能なら表示する。

PDF Pipeline Builderで確立した考え方を踏襲する。

---

# 19. Runtime Status

Node Editor CoreのRuntime Statusを利用する。

Node状態:

- idle
- ready
- running
- success
- warning
- error
- disabled

実行中NodeはCanvas上でも状態が分かるようにする。

技術用語を大量に表示せず、

```text
準備完了
処理中
完了
確認が必要
エラー

```

程度の一般向け表示へ翻訳する。

---

# 20. Schema

各Nodeへ入力されたTableのSchemaを利用する。

Schema例:

```text
customer_id  INTEGER
name         VARCHAR
price        DOUBLE
created_at   TIMESTAMP

```

Inspectorでは一般ユーザー向けに、

```text
customer_id  整数
name         文字列
price        数値
created_at   日時

```

のように表示する。

詳細情報に内部型を表示してもよい。

---

# 21. Validation

実行前にValidationする。

例:

- Inputファイル未選択
- 必須Port未接続
- Columnが存在しない
- Cast対象Columnがない
- Join keyが存在しない
- Union Schema不一致
- Group By設定なし
- Output未接続
- 出力ファイル名不正

問題Nodeをクリック / Focusできること。

Node Editor CoreのValidation Resultを利用する。

---

# 22. Error UX

エラーは、

```text
Binder Error
Parser Error
VARCHAR → INTEGER conversion failed

```

のような内部実装由来のメッセージだけをそのまま出さない。

一般向けに翻訳する。

例:

```text
「price」列を数値として変換できない値があります。

```

詳細を開いた場合のみ元エラーを表示する。

---

# 23. File Runtime State

File bytesをGraph JSONへ保存しない。

Runtime:

```js
Map<inputNodeId, FileRuntime>

```

のようにConsumer側で管理する。

Graphへ保存する情報:

- Node type
- 設定
- 位置
- Connection
- Output filename

保存しない情報:

- File bytes
- File object
- Blob URL
- Preview result
- Parser / writer instance
- Runtime table
- Runtime status

---

# 24. Pipeline JSON

GraphはJSONとして保存・再読込できる。

用途:

- バックアップ
- Git管理
- 別端末へ移動
- Recipe共有

元データファイルは含めない。

Pipelineを開いた後はInputファイルを再選択する。

---

# 25. Recipe

PDF Pipeline Builderで確立したRecipe UXを基本にする。

## Recipeへ保存するもの

- Graph
- Node設定
- Connection
- Node位置
- Output設定

保存しないもの:

- Input File
- File name
- File bytes
- Preview
- Result

ただしInput Nodeの説明用ラベルなど、ユーザーが明示設定した情報は保存可能。

---

# 26. Quick Recipe

Node Editorより上に、

**保存したRecipeをすぐ使う**

を表示。

各Recipeは初期状態で閉じる。

一般的なDisclosure chevronを使用。

閉:

`>` 相当

開:

`v` 相当

絵文字は使わずSVG。

Recipeを開くと必要なInput Node数だけFile selectorを表示。

例:

```text
月次売上集計

Input 1
[ sales.csv ]

Input 2
[ master.csv ]

[ Canvasに反映 ] [ このRecipeを使う ]

```

---

# 27. Quick Recipeの2操作

## Canvasに反映

確認ダイアログを表示。

確定した場合:

- 現在GraphをRecipeへ置換
- 選択済みInput Fileも割り当て
- Node Editorで編集可能

## このRecipeを使う

現在Canvasを変更しない。

別GraphとしてRecipeを実行。

その後、

**出力結果Preview**

を表示。

自動ダウンロードしない。

結果Previewからユーザーが保存する。

---

# 28. 確認ダイアログ

ブラウザー標準の、

- `confirm()`
- `alert()`
- `prompt()`

は使用しない。

アプリ内確認ダイアログを使用する。

対象例:

- Node削除
- Pipeline置換
- Recipe上書き
- Recipe削除
- CanvasへRecipe反映
- Union入力数削減
- Input File解除

取り消し可能な処理ではUndoも利用する。

---

# 29. Canvas UX

PDF Pipeline Builderで改善した内容を最初から反映する。

- Palette / Canvas / Inspectorの3カラム
- Palette内部スクロール
- Inspector内部スクロール
- Palette内容量でCanvas高さを変えない
- Nodeカテゴリ開閉
- Click追加
- Drag追加
- MiniMap
- Helper Lines
- Grid Snap
- Fit View
- Fit Selection
- Undo / Redo
- Copy / Paste / Duplicate
- Edge選択
- Connection削除
- Context Menu

---

# 30. Canvas拡大

「浮かせて拡大」でも、

- Palette
- Canvas
- Inspector

を表示する。

Canvasだけを最大化して左右を消す構成にはしない。

拡大時:

- MiniMapを表示
- Canvas resizeをCoreが追従
- View Stateを退避

閉じた時:

- Viewport
- Selection
- Inspector
- MiniMap状態

を可能な範囲で復元する。

Node Editor Core v1.1系のView State / Resize機能を利用する。

---

# 31. Mobile UX

390px程度を必須確認対象とする。

スマートフォンでは:

- ページ全体の横スクロールなし
- Headerボタン重なりなし
- Dialogは画面内
- safe-area対応
- Tap target 44px以上
- 長いColumn名でも崩れない
- Table Previewのみ局所横スクロール可能
- Canvas toolbarは局所横スクロール可能
- Paletteも必要に応じ局所スクロール
- InspectorはBottom Sheet方式を検討
- Preview拡大はほぼ全画面

MiniMapは通常スマホでは非表示でよい。

拡大Canvasなど明示的な状況で必要ならCoreのforce表示を利用する。

---

# 32. Empty States

以下を明確に設計する。

## 初期状態

```text
左のNodeからInputを追加するか、
保存したRecipeを選んでください。

```

## Input未選択

```text
CSVファイルを選択してください。

```

## Previewなし

```text
Nodeを選択すると途中結果を確認できます。

```

## Outputなし

```text
Output Nodeを追加して接続してください。

```

「何をすればよいか分からない」状態を作らない。

---

# 33. Processing States

最低限:

- Idle
- Loading file
- Preparing engine
- Processing
- Preview ready
- Output ready
- Error
- Cancelled

処理中は二重実行を防ぐ。

長い処理はCancel対応を検討する。

古いPreview Queryの結果が後から返った場合、新しい選択状態を上書きしない。

Request token / generation IDなどで破棄する。

---

# 34. Privacy

基本表現:

**完全ローカル処理**

説明:

> 選択したデータファイルはブラウザ内で処理され、アプリから外部サーバーへ送信されません。

誇張しない。

GitHub Pages版ではHTML自体を取得する通信は発生することも明記する。

保存版単一HTMLでは完全オフライン利用を確認する。

---

# 35. CSP / Network

リリース版:

```text
connect-src 'none'

```

を基本とする。

以下を検査する。

- fetch
- XMLHttpRequest
- WebSocket
- EventSource
- runtime CDN
- dynamic external module import
- runtime codec / format module download

形式別Adapterに追加ライブラリ / Worker / assetsが必要な場合も、単一HTMLへ埋め込む。

---

# 36. Performance

最初から巨大データ対応を誇張しない。

目標:

- 100MB程度のCSV / Parquetで基本処理確認
- 100万行クラスのPreview / Filter / Group By確認
- UIをブロックしない
- Worker利用
- Previewは最大100行程度
- 不要な全件DOM描画をしない

ブラウザ・端末メモリに依存することをLimitationsへ明記。

固定の「何GBまで対応」といった保証はしない。

---

# 37. Memory Management

処理終了時 / Input変更時には、

- Adapterの一時バッファ
- Tables
- Result objects
- Blob URLs
- Worker resources

を適切に解放する。

同じInputの変更で古いDataが残らないこと。

---

# 38. Accessibility

最低限:

- Button aria-label
- Icon title
- aria-pressed
- Dialog focus trap
- Escape close
- Keyboard操作
- Focus visible
- Node selection状態
- Error navigation

を確認する。

---

# 39. v0.1.0〜v1.0.0 開発計画

## v0.1.0 — Foundation / CSV Vertical Slice

目的:

Node Editor Core + built-in JavaScript CSV engineの最小縦切りを成立させる。

実装:

- 最新htmlapps-template
- Node Editor Core統合
- CSV Input
- Select Columns
- CSV Output
- 実PDF Pipeline Builder相当の3カラムEditor
- File selection
- built-in JavaScript CSV engine埋め込み
- 完全ローカル処理
- 最小Preview
- 実CSV → 変換 → CSV生成

完成条件:

```text
CSV Input
→ Select Columns
→ CSV Output

```

が実ファイルで動く。

---

## v0.2.0 — Preview / Schema

実装:

- Node途中結果Preview
- 最大100行
- Schema表示
- Data type
- Preview拡大
- Output Nodeは「結果」
- CSV autodetect
- JSONL Input
- Parquet Input

ここでPreview UXを固める。

---

## v0.3.0 — Basic Transform

追加:

- Rename Columns
- Sort
- Limit
- Cast
- Deduplicate

Node設定UIを整える。

実装上の決定:

- Sortは複数キーを上から優先し、Null / 空値は昇順・降順とも末尾に置く。
- Castは変換失敗時に「エラー」または「Nullへ置換」をNodeごとに選べる。
- Deduplicateは最初に現れた行を保持する。
- Sort / DeduplicateのPreviewは先頭100行だけを先に処理せず、上流全体へ変換を適用した後の先頭100行を表示する。

---

## v0.4.0 — Filter / Null Handling

追加:

- Filter Rows
- AND / OR
- 条件builder
- Null Handling

Raw SQLなしで一般ユーザーが使えることを重視する。

---

## v0.5.0 — Join / Union

実装済み。

追加:

- Join
- Inner / Left / Right / Full
- Join key
- Union
- 2〜6入力
- Schema mismatch表示

Node Editor Coreのmulti-inputを本格検証する版。

汎用的な不足が出た場合はCoreへ戻す。

---

## v0.6.0 — Group By / Aggregate

実装済み。

追加:

- Group By
- Count
- Sum
- Average
- Min
- Max
- 複数Aggregation
- Aggregation Preview

---

## v0.7.0 — Output Formats / Multi Output

実装済み。

追加:

- JSONL Output
- Parquet Output
- 複数Output Node
- Run All Outputs
- Result一覧
- Output Preview
- 個別保存

自動ダウンロードは行わない。

---

## v0.7.1 — Output refinement

- Expanded intermediate-result previews close when the backdrop is clicked.
- Generated Parquet metadata uses `created_by = Data Pipeline Builder`.
- Parquet Output keeps the lightweight flat writer and Snappy-compresses data pages.


## v0.8.0 — Recipe / Reuse

実装済み。

追加:

- Pipeline JSON Save / Open
- Recipe library
- Quick Recipe
- Recipe開閉
- Input File割当
- Canvasに反映
- このRecipeを使う
- Canvasを変更しないQuick execution
- Result Preview

Recipeは端末内保存。

元データはRecipeへ保存しない。

---

## v0.8.1 — UX Polish

実装済み。

- Canvasノードの削除ボタンをNode Editor Coreのaction-id callback contractへ合わせて修正
- Delete / Backspaceの削除確認を明示的な「削除」アクションへ統一
- 確認ダイアログをコンパクトな共通レイアウトへ整理し、外側クリックはキャンセル扱い
- Quick RecipeのInputファイル割当へドラッグ＆ドロップを追加

## v0.8.2以降 — UX Polish

必要に応じpatch releaseで:

- Palette scroll
- Inspector scroll
- Mobile
- Dialog
- Long filenames
- Long column names
- Canvas expanded
- MiniMap
- Preview
- Error UX

を磨く。

---

## v0.9.0 — Release Candidate

実装済み。新機能追加を止め、v1.0.0前の全体回帰と仕上げを行う。

RC仕上げ:

- 日本語 / 英語のHelp・Dialogのアクセシブル名を同期
- Help Dialogを外側クリックでも閉じられるよう統一
- `prefers-reduced-motion` を尊重し、不要なアニメーション / transitionを抑制
- v0.8.1までのRecipe / Pipeline JSON / Multi Output / Parquet Snappy等を維持したまま回帰確認

確認:

- CSV
- TSV
- JSONL
- Parquet
- Join
- Union
- Group By
- Recipe
- Pipeline JSON
- Multi Output
- Preview
- Result
- PC
- Mobile
- Japanese
- English
- Offline
- CSP
- Self Extract
- GitHub Pages

全体回帰。

---

## v1.0.0 — Stable Release

実装済み。正式リリースとして、RCの機能を維持したまま配布物・README・スクリーンショット・版数を最終化。

実施:

- 最終回帰
- README全面整備
- README.ja.md
- APP\_SPEC
- CHANGELOG
- SECURITY
- THIRD\_PARTY\_NOTICES
- VERIFY\_OFFLINE
- favicon
- screenshot.png
- screenshot-en.png
- screenshot-mobile.png
- バージョン正式化
- GitHub Pages確認
- 単一HTML確認

READMEはBrowser Kitty既存アプリ、

`ttomohisa/html-pdf-organizer`

の形式を基準とする。

---

# 40. Test Data

開発中にFixtureを用意する。

最低限:

## customers.csv

```text
id,name,region
1,Alice,East
2,Bob,West
3,Carol,East

```

## sales.csv

```text
id,customer_id,price,date
1,1,1200,2026-01-01
2,2,500,2026-01-02
3,1,2000,2026-01-03

```

同内容を、

- JSONL
- Parquet

でも用意する。

さらに:

- Nullあり
- 重複あり
- 型不一致
- Column不足
- 日本語文字
- 長いColumn名

のFixtureも作る。

---

# 41. Regression Tests

最低限自動化する。

- Graph serialization
- Node Definition
- Input runtime is not persisted
- Select
- Rename
- Filter
- Sort
- Limit
- Cast
- Deduplicate
- Join
- Union
- Group By
- CSV output
- JSONL output
- Parquet output
- upstream-only Preview
- multiple outputs
- Recipe sanitization
- Recipe execution does not mutate Canvas
- Canvasに反映 does mutate only after confirmation
- `connect-src 'none'`
- no runtime fetch / XHR / WebSocket
- Self Extract restoration

---

# 42. Release確認

リリース候補では必ず:

- PC表示
- 390pxスマートフォン
- 日本語
- 英語
- Empty state
- Loading
- Processing
- Success
- Error
- Cancel
- CSV
- TSV
- JSONL
- Parquet
- Preview
- Preview拡大
- Recipe
- Quick Recipe
- Pipeline Save/Open
- Multi Output
- File保存
- GitHub Pages
- file://単一HTML
- CSP
- 外部通信
- README
- favicon
- screenshots

を確認する。

---

# 43. v1.0.0時点で残してよい制限

以下はLimitationsとして明記すればよい。

- Shift-JIS CSVは未対応でもよい
- Excel XLSXは未対応
- 巨大ファイルはブラウザメモリに依存
- ネストが深いJSONの高度な操作は限定的
- SQL直接入力は未対応
- Cloud DB接続なし
- Schedulerなし
- Recipeへ元ファイルは保存しない
- built-in JavaScript CSV engineの処理性能は端末に依存

無理にv1.0.0へ全部入れない。

---

# 44. 将来候補

v1.0.0後に検討:

- Arrow Input / Output
- ORC
- Avro
- SQLite Input
- DuckDB file Input
- Excel
- Calculated Column
- Pivot
- Unpivot
- Regex Extract
- Split Column
- Merge Columns
- Date / Time transforms
- String transforms
- Batch folder processing
- Profile / Statistics Node
- Chart Preview
- Schema Diff
- Data Quality checks
- Conditional branching
- Sample Node
- Random Split
- AI Dataset export

ただし需要を見て追加する。

---

# 45. このアプリでNode Editor Coreへフィードバックしたい点

特に観察する。

- Dynamic input Port
- 2〜6入力Node
- SchemaによるPort validation
- 大規模Graph
- Runtime Status
- Async Preview
- Worker処理
- Canvas resize
- Node追加Drag UX
- View State
- MiniMap
- Inspector
- Error navigation

PDF Pipeline BuilderとData Pipeline Builderの両方で必要になった汎用機能は、Node Editor Coreへ戻す候補とする。

---

# 46. 最重要UX

このアプリの価値は、

> SQLを書かずに、データ変換手順を見える形で組み、保存して繰り返し使えること

に置く。

「Decoder」「Worker」「WASM」などの内部技術は一般画面の主役にしない。

一般ユーザーには、

- データを読み込む
- 列を選ぶ
- 行を絞る
- データを結合する
- 集計する
- 保存する

という言葉で見せる。

---

# 47. 実装開始時の指示

実装は必ず **v0.1.0 Foundation / CSV Vertical Slice** から開始する。

最初から全Nodeを実装しない。

まず、

```text
CSV Input
↓
Select Columns
↓
CSV Output

```

を、

- Node Editor
- 実ファイル
- built-in JavaScript CSV engine
- Preview
- Output
- 完全ローカル処理
- 単一HTML

まで一気通貫で成立させる。

その縦切りが安定してからNodeを増やす。

Node Editor Coreの既存機能をConsumer側で再実装しない。

既存Coreに不足がある場合は、まずCore APIで解決できないか確認する。

コード変更後は毎回、適切なGitコミットメッセージ案も提示する。