# CLAUDE.md

## 概要

JavaScriptエンジンのパフォーマンス問題を調査・検証した記録。

主な発見: **「オブジェクトリテラル」+「computed property」+「リテラル内での直接関数定義」の組み合わせは約10倍遅い**（V8/JSCのdeoptimizationが原因）。

## 作業時の指示

- **記事の編集方針**: 日本語版を原本として推敲し、最終的に記事公開時に英語版を作成する
- **タイトルの推敲**: 初期段階では気にしなくて良い。記事公開段階で全体を見てから考える。タイトルは本文と文体や見せ方が異なっても良く、読者への印象付けも意識する。基本は正確性重視で煽り系は避けつつ、読まれるバランスの良いタイトルを提案する（ユーザーはこれを考えるのが苦手）
- **Zenn公開フロー**:
  - 記事mdにZenn用frontmatterを最初から埋め込む（`published: false`）
  - 画像は元リポジトリに配置し `raw.githubusercontent.com` で参照
  - Twitter/Xリンクは `@[tweet](URL)` 形式に変換
  - 公開時: `kawaz/zenn/articles/` に記事mdをコピー、`published: true` に変更してpush
  - 詳細は下記「Zenn公開」セクション参照
- **記事の文体**: 日本語版は「だ・である」調で統一。ただし括弧内は筆者の内心・補足を表すため、断定調と異なることがある
- **コード内コメント**: 英語で記述
- **ユーザーが修正した場合・修正指示を出した場合（重要）**: 指示をそのまま受け入れず、必ず一度内容が妥当かどうか評価した上で通すこと。良い点・気になる点・疑問点があれば必ず伝える。盲従しない
- **検証コード/output更新時**: 記事内のコードや数値との整合性もチェックすること
- **コミット前の整合性確認**: 以下を常に確認すること
  - 用語の統一: エンジン名 (V8/JSC) とランタイム名 (Node/Bun) を混在させない
  - ファイル名の命名規則: `-v8`/`-jsc` など対になるものは統一
  - 記事内の数値とoutputファイルの整合性
- **ベンチマーク結果の表記**:
  - コード出力: 高精度で表示（小さい値はμs単位など）
  - 記事の表: 認知しやすい精度や単位にする
    - 1桁msが含まれる場合: 小数第2位まで表示（例: `1.23ms`）
    - 100ms以上の大きい値: 小数切り捨て、4桁以上はカンマ区切り（例: `1,576ms`）
    - 非常に小さい値: μs単位で表示（例: `32μs`）
    - 単位混在時: 小さい方の単位で揃える（例: ms と μs が混在なら全て μs）

## リポジトリ構成

```
article-js-object-literal-computed-inline-function-slow.md     # 技術記事（英語版）
article-js-object-literal-computed-inline-function-slow.ja.md  # 技術記事（日本語版）
benchmarks/                    # ベンチマークスクリプト
eslint-plugin/                 # 問題パターン検出用ESLintプラグイン
session/                       # 元のClaudeセッション記録
drafts/                        # 旧バージョン・下書き
```

## ベンチマーク実行

```bash
# 検証1: オブジェクト生成パターンの総当たり
node benchmarks/bench_patterns.js
bun benchmarks/bench_patterns.js

# 検証2: クロージャは関係あるか
node benchmarks/bench_closure.js
bun benchmarks/bench_closure.js

# 検証3: function/arrow/method 比較
node benchmarks/bench_fn_types.js
bun benchmarks/bench_fn_types.js

# 検証4: プリミティブ値 vs 関数
node benchmarks/bench_primitive.js
bun benchmarks/bench_primitive.js

# 検証6: メソッド定義 vs プロパティ代入（変数経由）
node benchmarks/bench_method_vs_property.js
bun benchmarks/bench_method_vs_property.js

# V8 deoptトレース付き
node --trace-opt --trace-deopt benchmarks/bench_patterns.js
```

## 技術的発見

「リテラル + computed + 毎回新関数」の組み合わせで `wrong call target` deoptが繰り返し発生し、大幅に遅くなる。

**解決策**（いずれかの条件を外す）:
- 関数を共有する
- オブジェクト生成後にプロパティを追加する
- classを使う

## Zenn公開

記事ごとに専用リポジトリを作成し、Zennリポジトリには記事mdのみコピーする方針。

### ディレクトリ構成

```
kawaz/article-{topic}/          ← 記事専用リポジトリ（公開）
├── article-{topic}.ja.md       ← 原本（Zenn frontmatter含む）
├── article-{topic}.md          ← 英語版（公開時に作成）
├── images/                     ← 画像
├── benchmarks/                 ← コード・データ
└── CLAUDE.md

kawaz/zenn/articles/            ← Zennリポジトリ
└── {slug}.md                   ← 記事のみコピー
```

### Frontmatter形式

```yaml
---
title: "記事タイトル"
emoji: "🐢"
type: "tech"
topics: ["javascript", "performance", "v8", "jsc"]
published: false
---
```

### slug命名規則

- Zenn制限: 12〜50文字（英小文字、数字、ハイフン、アンダースコア）
- 日本語版: `{slug}` (47文字以内を推奨)
- 英語版: `{slug}-en` (50文字以内)
- 日英両方公開する場合は日本語slugを47文字以内に抑える

### 公開手順

1. 元リポジトリを公開（画像URL等が参照可能になる）
2. 記事mdを `kawaz/zenn/articles/{slug}.md` にコピー
3. 変換作業:
   - Twitter/Xリンク → `@[tweet](URL)`
   - 相対パス（コード/テキスト） → `https://github.com/kawaz/{repo}/blob/main/...`
   - 相対パス（画像） → `https://raw.githubusercontent.com/kawaz/{repo}/main/...`
   - `<details><summary>タイトル</summary>` → `:::details タイトル` / `</details>` → `:::`
   - h1削除（frontmatterのtitleがh1として機能、h2から始めると目次がh2-h3で階層表示される）
4. `published: true` に変更
5. push → Zennに反映
