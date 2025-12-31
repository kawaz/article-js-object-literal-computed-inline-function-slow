# CLAUDE.md

## 概要

JavaScriptエンジンのパフォーマンス問題を調査・検証した記録。

主な発見: **「オブジェクトリテラル」+「computed property」+「メソッド定義」の組み合わせは約10倍遅い**（V8/JSCのdeoptimizationが原因）。

## 作業時の指示

- **記事の編集方針**: 日本語版を原本として推敲し、最終的に記事公開時に英語版を作成する
- **記事の文体**: 日本語版は「だ・である」調で統一。ただし括弧内は筆者の内心・補足を表すため、断定調と異なることがある
- **コード内コメント**: 英語で記述
- **ユーザーが修正した場合**: 差分を確認し、良い点・気になる点を含めて評価すること
- **検証コード/output更新時**: 記事内のコードや数値との整合性もチェックすること
- **ベンチマーク結果の表記**:
  - コード出力: 高精度で表示（小さい値はμs単位など）
  - 記事の表: 認知しやすい精度や単位にする
    - 1桁msが含まれる場合: 小数第2位まで表示（例: `1.23ms`）
    - 100ms以上の大きい値: 小数切り捨て、4桁以上はカンマ区切り（例: `1,576ms`）
    - 非常に小さい値: μs単位で表示（例: `32μs`）
    - 単位混在時: 小さい方の単位で揃える（例: ms と μs が混在なら全て μs）

## リポジトリ構成

```
article-...-performance.md     # 技術記事（英語版）
article-...-performance.ja.md  # 技術記事（日本語版）
benchmarks/                    # ベンチマークスクリプト
eslint-plugin/                 # 問題パターン検出用ESLintプラグイン
session/                       # 元のClaudeセッション記録
drafts/                        # 旧バージョン・下書き
```

## ベンチマーク実行

```bash
# 検証1: オブジェクト生成パターンの総当たり
node benchmarks/bench_test1.js
bun benchmarks/bench_test1.js

# 検証2: クロージャは関係あるか
node benchmarks/bench_closure.js
bun benchmarks/bench_closure.js

# 検証3: function/arrow/method 比較
node benchmarks/bench_fn_types.js
bun benchmarks/bench_fn_types.js

# V8 deoptトレース付き
node --trace-opt --trace-deopt benchmarks/bench_test1.js
```

## 技術的発見

「リテラル + computed + 毎回新関数」の組み合わせで `wrong call target` deoptが繰り返し発生し、大幅に遅くなる。

**解決策**（いずれかの条件を外す）:
- 関数を共有する
- オブジェクト生成後にプロパティを追加する
- classを使う
