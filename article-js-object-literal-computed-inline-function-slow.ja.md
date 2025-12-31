---
title: "「オブジェクトリテラル」+「computed property」+「リテラル内での直接関数定義」が遅い件"
emoji: "🐢"
type: "tech"
topics: ["javascript", "performance", "v8", "jsc"]
published: false
---

# 「オブジェクトリテラル」+「computed property」+「リテラル内での直接関数定義」が遅い件

## 結論

「オブジェクトリテラル」「computed property」「リテラル内での直接関数定義」の3条件が揃うと極端に遅くなる。

```ts
// 遅い（3条件が揃っている）
function createLock() {
  return {
    [Symbol.dispose]() { ... }  // リテラル + computed + 直接定義
  };
}

// これも遅い（メソッド定義構文でなくても直接定義なら遅い）
function createLock() {
  return {
    [Symbol.dispose]: function() { ... }  // リテラル + computed + 直接定義
  };
}
```

対応としては3条件のどれかを外す形に直してやれば良い。

```ts
// 速い（いずれかの条件を外す）
function createLock() {
  const release = () => { ... };
  return { [Symbol.dispose]: release };  // 変数経由で渡す
}

function createLock() {
  const obj = {};
  obj[Symbol.dispose] = function() { ... };  // 後付け
  return obj;
}

class Lock {
  [Symbol.dispose]() { ... }  // class
}
```

-----

## きっかけ

[@vanilagy氏のポスト](https://x.com/vanilagy/status/2005003400023593125)で、ファクトリ関数内の `[Symbol.dispose]()` の行がプロファイラで 135.5ms と異常に遅いという報告があった。その後 class に書き換えたら劇的に改善したとのこと。

元ポストのコードから要点を抜き出すとこうなる:

```javascript
function createLock() {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
    },
    [Symbol.dispose]() {    // ← 135.5ms
      this.release();
    }
  };
}
```

最初に思いついた仮説は以下の通り

1. クロージャが遅い？(ありそう)
2. 毎回新しい関数を生成するのが遅い？(ありそう)
3. メソッド定義が遅い？(なさそう)
4. function / arrow / method の書き方で差がある？(ありそう)
5. computed property（`[expr]`）が遅い？(ありそう)
6. Symbol の computed property（`[Symbol.dispose]`）が遅い？(普通の用途だしなさそう)
7. オブジェクトリテラルが遅い？(なさそう)

これらの組み合わせを総当りで検証してみた。

-----

## 前提知識: Hidden Classes と Inline Cache

検証の前に、JavaScript エンジンの最適化の仕組みを簡単に説明する（今回の現象解読のために初めて調べた内容なので間違いがあるかもしれないが、自分の理解のまとめです）。

### Hidden Classes

JavaScript は動的型付けだが、エンジンは内部的に「隠しクラス」を作ってオブジェクトの形状（Shape）を追跡している。V8 では Maps、JSC では Structures と呼ばれている。

```javascript
const obj = {};      // Shape S0 (空)
obj.x = 1;           // Shape S0 → S1 (x を持つ)
obj.y = 2;           // Shape S1 → S2 (x, y を持つ)
```

同じ順序でプロパティを追加したオブジェクトは同じ Shape を共有でき、これによりプロパティアクセスが最適化される。

オブジェクトリテラルで一発生成する場合は transition が発生せず、最初から最終的な Shape が決まるので最も効率的。

ただし、これは最初の Shape 生成時だけの話で、同じパターンで2個目以降を作るときは既存のチェーンが再利用される。なのでこれが大きな問題になる事は少ないはず（特にハードコードされたコードでは追加順が固定されるのでそのパターン数も大した数にはならず、問題になるのはループで不定なフィールドリストから動的生成する場合くらいだと思う）。なのであまり神経質になる必要はないと思う。

### Inline Cache (IC)

プロパティアクセスや関数呼び出しの結果をキャッシュして、次回以降の検索をスキップする最適化。

```javascript
function call(obj) {
  obj.dispose();  // ← ここに IC が仕込まれる
}
```

IC は「常に同じ Shape / 同じ関数が来る」と仮定して最適化する。
異なるものが来ると最適化が解除（Deoptimization）される。

### Deoptimization (Deopt)

JIT コンパイラが最適化時に置いた仮定が崩れると、最適化されたコードを捨ててまた遅いコードに戻る。

```
最適化「この呼び出しでは常に関数Aが呼ばれるはず」
    ↓
実際は関数Bが来た
    ↓
"wrong call target" で Deopt
    ↓
再最適化を試みる → また違う関数 → Deopt...
```

-----

## 検証

### 検証1: 何が遅さの原因か切り分ける

まず、どの条件が遅さに寄与しているか思いついた条件の組み合わせを総当たりで検証した。

#### 検証コード

```javascript
const SYM = Symbol("test");
const sharedFn = function() {};

// リテラル + computed + 毎回新関数
function literalComputedNewFn() {
  return { [SYM]() {} };
}

// リテラル + computed + 共有関数
function literalComputedSharedFn() {
  return { [SYM]: sharedFn };
}

// リテラル + 静的キー + 毎回新関数
function literalStaticNewFn() {
  return { dispose() {} };
}

// リテラル + 静的キー + 共有関数
function literalStaticSharedFn() {
  return { dispose: sharedFn };
}

// 後付け + computed + 毎回新関数
function addLaterComputedNewFn() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}

// 後付け + computed + 共有関数
function addLaterComputedSharedFn() {
  const obj = {};
  obj[SYM] = sharedFn;
  return obj;
}

// 後付け + 静的キー + 毎回新関数
function addLaterStaticNewFn() {
  const obj = {};
  obj.dispose = function() {};
  return obj;
}

// 後付け + 静的キー + 共有関数
function addLaterStaticSharedFn() {
  const obj = {};
  obj.dispose = sharedFn;
  return obj;
}

// class
class WithClass {
  [SYM]() {}
}
```

#### 結果: 生成 + 呼び出し（10万回）

| パターン | V8 (Node) | JSC (Bun) |
|---|---|---|
| **リテラル + computed + 毎回新関数** | **16.94ms** | **6.38ms** |
| リテラル + computed + 共有関数 | 3.09ms | 1.21ms |
| リテラル + 静的キー + 毎回新関数 | 1.98ms | 1.73ms |
| リテラル + 静的キー + 共有関数 | 1.34ms | 1.17ms |
| 後付け + computed + 毎回新関数 | 3.22ms | 1.40ms |
| 後付け + computed + 共有関数 | 1.67ms | 1.41ms |
| 後付け + 静的キー + 毎回新関数 | 2.89ms | 1.95ms |
| 後付け + 静的キー + 共有関数 | 1.55ms | 1.47ms |
| class | 1.62ms | 1.80ms |

#### 結果: 生成 + 呼び出し（1000万回）

| パターン | V8 (Node) | JSC (Bun) |
|---|---|---|
| **リテラル + computed + 毎回新関数** | **1,677ms** | **550ms** |
| リテラル + 静的キー + 共有関数 | 125ms | 79ms |
| class | 144ms | 90ms |
| **倍率（class比）** | **約12倍** | **約6倍** |

<details>
<summary>ベンチマーク実行方法</summary>

```bash
node benchmarks/bench_patterns.js  # Node.js (V8)
bun benchmarks/bench_patterns.js   # Bun (JSC)
```

→ [bench_patterns.js](benchmarks/bench_patterns.js) / [実行結果](benchmarks/bench_patterns-output.txt)

</details>

#### 発見

「リテラル + computed + 直接定義」の組み合わせだけが突出して遅い。

条件を一つでも外すと速くなる：

- 変数経由で関数を渡す → 速い
- 後付けにする → 速い
- 静的キーにする → 速い
- class にする → 速い

-----

### 検証2: クロージャは関係あるか

クロージャが原因という仮説を検証。

```javascript
// クロージャあり
function withClosure() {
  let state = false;
  return {
    [Symbol.dispose]() { state = true; }
  };
}

// クロージャなし
function withoutClosure() {
  return {
    [Symbol.dispose]() {}
  };
}
```

結果: どちらも同様に遅い。**クロージャは無関係**。

<details>
<summary>ベンチマーク実行方法</summary>

```bash
node benchmarks/bench_closure.js  # Node.js (V8)
bun benchmarks/bench_closure.js   # Bun (JSC)
```

→ [bench_closure.js](benchmarks/bench_closure.js) / [実行結果](benchmarks/bench_closure-output.txt)

</details>

-----

### 検証3: function / arrow / method の違い

関数の書き方による違いを検証。

```javascript
// メソッド記法
{ [SYM]() {} }

// function
{ [SYM]: function() {} }

// arrow
{ [SYM]: () => {} }
```

| パターン | V8 | JSC |
|---|---|---|
| computed + function | 16.61ms | 6.37ms |
| computed + arrow | 17.31ms | 5.22ms |
| computed + method | 17.33ms | 6.07ms |

<details>
<summary>ベンチマーク実行方法</summary>

```bash
node benchmarks/bench_fn_types.js  # Node.js (V8)
bun benchmarks/bench_fn_types.js   # Bun (JSC)
```

→ [bench_fn_types.js](benchmarks/bench_fn_types.js) / [実行結果](benchmarks/bench_fn_types-output.txt)

</details>

結果: どれも同様に遅い。**関数の書き方は無関係**。

-----

### 検証4: 値がプリミティブ値の場合はどうなるか

毎回新しい値でも、値が関数以外の場合はどうなるかも検証。

```javascript
const SYM = Symbol("test");
let counter = 0;

// 毎回新しい数値
function createWithNewNumber() {
  return { [SYM]: counter++ };
}

// 毎回新しい関数
function createWithNewFunction() {
  return { [SYM]: function() {} };
}

// アクセス（参照のみ）
let x;
for (let i = 0; i < n; i++) {
  const obj = createFn();
  x = obj[SYM];
}

// 呼び出し（関数実行）
for (let i = 0; i < n; i++) {
  const obj = createFn();
  obj[SYM]();
}
```

| パターン | V8（アクセス） | V8（呼び出し） | JSC（アクセス） | JSC（呼び出し） |
|---|---|---|---|---|
| 毎回新しい数値 | 1.36ms | - | 0.96ms | - |
| 毎回新しい関数 | 16.21ms | 16.05ms | 5.20ms | 5.20ms |

結果: **関数の場合だけ遅い**（V8で約12倍、JSCで約5倍）。プリミティブ値なら問題ない。アクセスと呼び出しはほぼ同じ速度。

<details>
<summary>ベンチマーク実行方法</summary>

```bash
node benchmarks/bench_primitive.js  # Node.js (V8)
bun benchmarks/bench_primitive.js   # Bun (JSC)
```

→ [bench_primitive.js](benchmarks/bench_primitive.js) / [実行結果](benchmarks/bench_primitive-output.txt)

</details>

-----

### 検証5: プロファイラで深掘りしてみた

V8 と JSC の両方で、なぜ遅くなるかを確認した。

#### deopt トレース (V8)

V8 のトレースオプションで Deoptimization の発生を確認した。

```bash
node --trace-opt --trace-deopt benchmarks/bench_patterns.js
```

出力（抜粋）:
```
# 呼び出し時
[bailout (kind: deopt-eager, reason: wrong call target): ...]

# アクセス・呼び出し共通
[bailout (kind: deopt-eager, reason: Insufficient type feedback for call): ...]
```

毎回新しい関数オブジェクトが生成されるため、JIT が最適化しても実際には別の関数が来て Deopt が発生する。これが繰り返されることで大幅に遅くなる。

- `wrong call target`（呼び出し先が想定と違う）: 関数の呼び出し時
- `Insufficient type feedback for call`（型フィードバック不足）: 関数値へのアクセス・呼び出し両方

プリミティブ値ではこれらの Deopt は発生しない（`node --trace-opt --trace-deopt benchmarks/bench_primitive.js` で確認）。関数値の場合のみ、オブジェクト生成時点で型情報が安定せず最適化が阻害される。

#### CPU プロファイル (V8/JSC)

両エンジンで CPU プロファイリングを行い、どの関数が CPU 時間を消費しているか確認した。

```bash
node --cpu-prof benchmarks/bench_patterns.js  # V8
bun run --cpu-prof benchmarks/bench_patterns.js  # JSC
```

生成された `.cpuprofile` から `hitCount`（プロファイラが「今どの関数を実行中か」をサンプリングした回数）を確認。hitCount が高いほどその関数が CPU 時間を多く消費していることを意味する。

**V8 (Node.js)**

| 関数 | hitCount | 割合 |
|---|---|---|
| `literalComputedNewFn` | **1318** | **52.2%** |
| (garbage collector) | 151 | 6.0% |
| `addLaterStaticNewFn` | 49 | 1.9% |
| `literalStaticNewFn` | 35 | 1.4% |
| その他 | - | - |

※合計時間: 約3.1秒、総サンプル数: 約2500

**JSC (Bun)**

| 関数 | 行 | hitCount | 割合 |
|---|---|---|---|
| `literalComputedNewFn` | 13 | **459** | **39.8%** |
| `addLaterStaticNewFn` | 44 | 43 | 3.7% |
| `literalStaticNewFn` | 22 | 34 | 2.9% |
| `addLaterComputedNewFn` | 32 | 29 | 2.5% |
| その他 | - | - | - |

※合計時間: 約1.5秒、総サンプル数: 約1150

両エンジンとも `literalComputedNewFn` が突出して高い。V8 は 52.2%、JSC は 39.8%。V8 の方が割合が高く、deopt ペナルティがより大きいことがわかる。また V8 では GC が 6.0% を占めており、毎回新しい関数オブジェクトを生成することによる GC 負荷も確認できた。

#### 行レベルの確認 (JSC)

JSC のプロファイラは行番号レベルで報告してくれる。`literalComputedNewFn` 内のどの行がホットスポットか確認するため、元の1行を改行して確認した:

```javascript
function literalComputedNewFn() {
  const obj = {      // 12行目
    [SYM]() {}       // 13行目 ← ここがホットスポット
  };                 // 14行目
  return obj;        // 15行目
}
```

結果、12行目の `const obj = {` でも15行目の `return obj;` でもなく、**13行目の `[SYM]() {}` がホットスポット**であることが確認できた。これは元のXポストで「`[Symbol.dispose]()` の行が 135.5ms」と報告されていた内容と完全に一致する。

<details>
<summary>プロファイル解析の手順</summary>

```bash
# V8 プロファイル生成・解析
node --cpu-prof --cpu-prof-name=benchmarks/bench_patterns-v8.cpuprofile benchmarks/bench_patterns.js
node benchmarks/analyze_profile.js benchmarks/bench_patterns-v8.cpuprofile

# JSC プロファイル生成・解析
bun run --cpu-prof --cpu-prof-name=benchmarks/bench_patterns-jsc.cpuprofile benchmarks/bench_patterns.js
node benchmarks/analyze_profile.js benchmarks/bench_patterns-jsc.cpuprofile
```

→ [analyze_profile.js](benchmarks/analyze_profile.js) / [V8プロファイル](benchmarks/bench_patterns-v8.cpuprofile) / [V8解析結果](benchmarks/bench_patterns-v8-profile-analysis.txt) / [JSCプロファイル](benchmarks/bench_patterns-jsc.cpuprofile) / [JSC解析結果](benchmarks/bench_patterns-jsc-profile-analysis.txt)

</details>

-----

### 検証6: 変数経由で渡せば速くなるか

検証1で「共有関数にすると速い」と分かったが、より詳細に切り分けを行った。

#### 検証パターン

```javascript
const SYM = Symbol("test");
const sharedFn = function() {};

// 1. メソッド定義構文（遅い）
function methodDefinition() {
  return { [SYM]() {} };
}

// 2. リテラル内でインライン定義（遅い）
function propertyInline() {
  return { [SYM]: function() {} };
}

// 3. ローカル変数経由（速い）
function propertyLocal() {
  const fn = () => {};
  return { [SYM]: fn };
}

// 4. モジュールスコープ共有（速い）
function propertyShared() {
  return { [SYM]: sharedFn };
}

// 5. 後付け（速い）
function addLater() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}
```

#### 結果（10万回）

| パターン | V8 | JSC |
|---|---|---|
| `{ [SYM]() {} }` メソッド定義 | 17.14ms | 6.64ms |
| `{ [SYM]: function(){} }` インライン | 17.27ms | 6.08ms |
| `const fn=...; { [SYM]: fn }` ローカル変数 | 3.65ms | 1.34ms |
| `{ [SYM]: sharedFn }` モジュール共有 | 3.09ms | 1.68ms |
| `obj[SYM] = function(){}` 後付け | 2.73ms | 2.08ms |

#### 発見

- **メソッド定義構文かどうかは関係ない**（1と2がほぼ同じ速度）
- **「リテラル内で直接関数を定義する」ことが遅さの原因**
- **変数経由で渡せば速い**（ローカル変数でもモジュールスコープでも）
- **後付けも速い**

<details>
<summary>ベンチマーク実行方法</summary>

```bash
node benchmarks/bench_method_vs_property.js  # Node.js (V8)
bun benchmarks/bench_method_vs_property.js   # Bun (JSC)
```

→ [bench_method_vs_property.js](benchmarks/bench_method_vs_property.js) / [実行結果](benchmarks/bench_method_vs_property-output.txt)

</details>

-----

### 検証7: using 構文や try-finally は関係あるか

（追加検証）元のコードは `using` 構文で使うことを想定していたようだ。構文自体が遅さの原因か検証した。

```javascript
// using 構文
{ using lock = createLock(); }

// try-finally
const lock = createLock();
try { } finally { lock[Symbol.dispose](); }

// 単純なループ
const lock = createLock();
lock[Symbol.dispose]();
```

| パターン | Bun (literal) | Bun (class) |
|---|---|---|
| using | 8,020μs | 2,490μs |
| try-finally | 5,060μs | 32μs |
| simple loop | 4,630μs | 32μs |

<details>
<summary>ベンチマーク実行方法</summary>

```bash
bun benchmarks/bench_jsc_using.js  # Bun (JSC)
```

→ [bench_jsc_using.js](benchmarks/bench_jsc_using.js) / [実行結果](benchmarks/bench_jsc_using-output.txt)

</details>

結果: **構文による差はほぼない**。遅さの原因は構文ではなくオブジェクト生成パターンだ。

-----

### 検証8: 135ms の謎

元ポストでは 135.5ms という数字だったが、こちらの検証では最大でも 30〜90ms 程度だった。

長時間実行でバッチごとの時間を計測したところ：

```
literal computed: 83.1, 28.7, 30.2, 29.2, 27.2ms
class:            3.3,  2.7,  2.7,  2.5,  1.1ms
```

最初のバッチで 83ms と突出している。これは JIT コンパイルと Deopt の繰り返しによる初期化コスト。

DevTools のプロファイラはこの Deopt コストを「その行」に集約して表示するため、実際より大きく見えることがある。135ms はプロファイラのオーバーヘッドや他の要因も含まれていると考えられる。

-----

## なぜ「リテラル + computed + 毎回新関数」だけ遅いのか

3条件が揃うと V8 の特定の最適化パスを外れるようだ。

- **後付け**なら、静的な Shape を作ってから既知の transition で追加するため最適化が効く
- **静的キー**なら、リテラル解析時に Shape を決定できるため最適化が効く
- **共有関数**なら、呼び出し先が常に同じなので IC が安定する
- **class** なら、プロトタイプ上の同一関数を共有するので IC が安定する

「リテラル + computed + 毎回新関数」の場合：
1. computed property のためリテラル解析時に Shape を決定できない
2. 毎回新しい関数オブジェクトが生成される
3. 呼び出しのたびに `wrong call target` で Deopt
4. 最適化 → Deopt → 再最適化 の繰り返し

-----

## まとめ

| 仮説 | 結果 |
|---|---|
| クロージャが遅い | ❌ 無関係 |
| 毎回新しい関数を生成するのが遅い | △ 単独では問題ない |
| メソッド定義が遅い | △ 単独では問題ない |
| function/arrow/method の違い | ❌ 無関係 |
| computed property が遅い | △ 単独では問題ない |
| Symbol の computed property が遅い | △ 通常の computed と同じ |
| オブジェクトリテラルが遅い | △ 単独では問題ない |
| using 構文が遅い（追加検証） | ❌ 無関係 |
| **3条件の組み合わせ** | ✅ **これが原因** |

遅くなる条件: **「リテラル」+「computed property」+「毎回新しい関数の生成と呼び出し」**

-----

## 解決策

```javascript
// ❌ 遅い
function createLock() {
  return {
    [Symbol.dispose]() { ... }
  };
}

// ✅ 速い: 関数を共有
function createLock() {
  const release = () => { ... };
  return { release, [Symbol.dispose]: release };
}

// ✅ 速い: モジュールレベルで関数定義
const dispose = function() { this.release(); };
function createLock() {
  return { release() { ... }, [Symbol.dispose]: dispose };
}

// ✅ 速い: 後付け
function createLock() {
  const obj = { release() { ... } };
  obj[Symbol.dispose] = function() { this.release(); };
  return obj;
}

// ✅ 速い: class
class Lock {
  [Symbol.dispose]() { ... }
}
```

-----

## 補足: オブジェクト構築のベストプラクティス

今回の検証を踏まえて、オブジェクト構築時の transition chain についてまとめる。

### 基本: リテラル一発生成がベスト

```javascript
// 最適: transition が発生しない
const obj = { a: 1, b: 2, c: 3 };

// 次点: transition は発生するが、同じパターンならキャッシュが効く
const obj = {};
obj.a = 1;
obj.b = 2;
obj.c = 3;
```

後者はプロパティ追加のたびに Shape が遷移するが、これは最初の Shape 生成時だけの話。同じパターンで2個目以降を作るときは既存のチェーンを再利用するため、大量生成でもそこまで問題にならない。

### 例外: computed property は後付けにする

ただし computed property がある場合は話が変わる。

```javascript
// ❌ 避ける: リテラル内に computed property + 関数
function create() {
  return {
    staticMethod() { ... },
    [Symbol.dispose]() { ... }  // これが問題
  };
}

// ✅ 推奨: 静的プロパティはリテラルで、動的プロパティは後付け
function create() {
  const obj = { staticMethod() { ... } };  // 静的部分はリテラル
  obj[Symbol.dispose] = function() { ... };  // 動的部分は後付け
  return obj;
}
```

特に computed property の値が関数オブジェクトである場合、現状の V8 / JSC の最適化では「リテラル + computed + 毎回新関数」の組み合わせで大幅な性能劣化が発生する。この組み合わせは避けるべき。

### まとめ

| 状況 | 推奨 |
|---|---|
| 静的プロパティのみ | リテラル一発生成 |
| computed property あり（値が関数以外） | リテラル一発でも問題なし |
| computed property あり（値が関数） | 静的部分はリテラル、動的部分は後付け or class |

-----

## 参考資料

### V8 公式
- [Fast properties in V8](https://v8.dev/blog/fast-properties)
- [Maps (Hidden Classes) in V8](https://v8.dev/docs/hidden-classes)

### 解説記事
- [JavaScript engine fundamentals: Shapes and Inline Caches](https://mathiasbynens.be/notes/shapes-ics) - Mathias Bynens
- [JavaScript Engines Hidden Classes](https://draft.li/blog/2016/12/22/javascript-engines-hidden-classes/)
- [V8 Hidden class](https://engineering.linecorp.com/en/blog/v8-hidden-class) - LINE Engineering

### JSC
- [JavaScriptCore - WebKit Documentation](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html)
