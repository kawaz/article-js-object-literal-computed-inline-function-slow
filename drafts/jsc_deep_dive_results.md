# JSC (Bun) vs V8 (Node) の挙動の違い - 深掘り検証

## 発見のサマリ

### 1. JSC では `using` 構文自体にオーバーヘッドがある

| Runtime | using 構文のオーバーヘッド (10万回) |
|---------|-----------------------------------|
| **JSC (Bun)** | **4.81ms (1回あたり 48ns)** |
| V8 (Node) | ほぼ 0ms |

JSC では `using` 構文を使うだけで、class でも literal でも一律約 5ms のオーバーヘッドが発生する。

### 2. 詳細な比較

```
=== Bun (JSC) ===

class:
  using:       5.19ms   ← using のオーバーヘッド
  try-finally: 0.06ms
  simple:      0.07ms

literal (computed + method):
  using:       15.93ms  ← 元の問題 + using オーバーヘッド
  try-finally: 10.51ms  ← 元の問題のみ
  simple:      11.31ms  ← 元の問題のみ

literal (shared function):
  using:       5.42ms   ← using のオーバーヘッドのみ
  simple:      0.03ms   ← 超高速


=== Node (V8) ===

class:
  using:       0.06ms   ← オーバーヘッドなし
  try-finally: 0.55ms   ← むしろ try-finally が遅い
  simple:      0.07ms

literal (computed + method):
  using:       27.43ms  ← 元の問題
  try-finally: 27.70ms  ← 元の問題
  simple:      27.92ms  ← 元の問題

literal (shared function):
  using:       0.07ms
  simple:      0.06ms
```

## 考察

### JSC の using 実装

JSC は `using` 構文をまだ十分に最適化していない可能性がある。毎回の呼び出しで約 48ns のオーバーヘッドは、以下のような原因が考えられる：

1. `Symbol.dispose` の動的ルックアップ
2. dispose 呼び出しのための追加のスタック操作
3. スコープ終了時の暗黙的な try-finally 相当の処理
4. まだ JIT 最適化が十分に適用されていない

### V8 の using 実装

V8 は `using` を非常に効率的に実装している。オーバーヘッドがほぼゼロということは：

1. コンパイル時に `using` を効率的なコードに変換
2. または、simple 呼び出しと同等のコードを生成

### V8 の try-finally

興味深いことに、V8 では `try-finally` パターンの方が `using` より遅い：
- class + try-finally: 0.55ms
- class + using: 0.06ms

これは V8 が `using` を特別に最適化している証拠かもしれない。

## 元の問題との関係

元の問題「リテラル + computed + 毎回新関数」は両エンジンで発生するが、JSC ではさらに `using` 構文自体のオーバーヘッドが加算される。

| パターン | V8 | JSC |
|---------|-----|-----|
| literal + computed + method + using | 27ms | 16ms (元問題) + 5ms (using) = 21ms |
| class + using | 0.06ms | 5ms (using オーバーヘッド) |

## 結論

1. **JSC の `using` 実装はまだ最適化の余地がある** - 1回あたり 48ns は小さいが、ホットパスでは無視できない
2. **V8 は `using` を非常に効率的に実装** - try-finally より高速
3. **元の問題（リテラル + computed + 毎回新関数）は両エンジンで発生** - これは共通の問題
4. **JSC での遅さは複合要因** - 元の問題 + using オーバーヘッド

---

## 追加発見: function vs arrow vs method の違い

### 生成コスト（computed key）

| 関数タイプ | JSC (Bun) | V8 (Node) |
|-----------|-----------|-----------|
| function  | 25.48ms   | 31.61ms   |
| arrow     | 20.16ms   | 28.31ms   |
| **method**| **16.21ms** | 29.37ms |

**JSC では method 構文が最も速い**（V8 では大差なし）

### 生成コスト（static key）

| 関数タイプ | JSC (Bun) | V8 (Node) |
|-----------|-----------|-----------|
| function  | 1.74ms    | 2.47ms    |
| arrow     | 2.52ms    | 2.01ms    |
| method    | 3.65ms    | 2.32ms    |

**static key では JSC も V8 も大差なし**（JSC は function が若干速い）

### なぜ JSC は computed key で method が速いのか

推測：
1. JSC は method 構文を特別扱いして最適化している可能性
2. prototype の生成コストの違い（function は prototype あり）
3. method 構文の方がパース/コンパイルが効率的

ただし prototype 生成自体のコストは両エンジンで微小（0.05〜0.16ms）なので、主因ではなさそう。

### static vs computed の差が JSC で顕著

| パターン | JSC | V8 |
|---------|-----|-----|
| computed + method | 16.21ms | 29.37ms |
| static + method | 3.65ms | 2.32ms |
| **差** | **12.56ms** | **27.05ms** |

JSC は computed key のペナルティが V8 より小さい傾向にある。

---

## 貢献の可能性

### JSC (WebKit) への報告

1. **using 構文の最適化提案** - V8 の実装が参考になる
2. **computed property + 関数の最適化** - V8 と異なる挙動の報告

報告先: https://bugs.webkit.org/
Component: JavaScriptCore

### V8 への報告

1. **リテラル + computed + 毎回新関数の最適化提案**
2. **既知の問題かどうかの確認**

報告先: https://bugs.chromium.org/p/v8/issues/list
