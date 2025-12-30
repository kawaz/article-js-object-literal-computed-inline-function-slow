# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Claudeセッションのアーカイブ。JavaScriptエンジンのパフォーマンス問題を調査した記録。主な発見: **オブジェクトリテラル + computed property + メソッド定義は約10倍遅い**（V8/JSCのdeoptimizationが原因）。

## リポジトリ構成

```
article-object-literal-computed-property-method-definition-performance.md  # 技術記事
benchmarks/          # ベンチマークスクリプト
  bench_fn_types.js
  bench_jsc_deep.js
  bench_jsc_using.js
  bench_using_overhead.js
eslint-plugin/       # 問題パターンを検出するESLintプラグイン
session/             # 元のClaudeセッション記録
drafts/              # 旧バージョン・下書き
```

## ベンチマーク実行

```bash
# Node.js (V8)
node benchmarks/bench_fn_types.js

# Bun (JSC)
bun benchmarks/bench_fn_types.js

# V8 deoptトレース付き
node --trace-opt --trace-deopt benchmarks/bench_fn_types.js
```

## 技術的発見

**「オブジェクトリテラル」+「computed property」+「毎回新しい関数」** の組み合わせでJIT deoptimizationが発生:

```javascript
// 遅い（約10倍）: 毎回新関数、"wrong call target" deoptが発生
function createLock() {
  return { [Symbol.dispose]() { ... } };
}

// 速い: 関数を共有
function createLock() {
  const release = () => { ... };
  return { [Symbol.dispose]: release };
}

// 速い: class（プロトタイプメソッドは共有される）
class Lock {
  [Symbol.dispose]() { ... }
}

// 速い: オブジェクト生成後にプロパティ追加
function createLock() {
  const obj = {};
  obj[Symbol.dispose] = function() { ... };
  return obj;
}
```
