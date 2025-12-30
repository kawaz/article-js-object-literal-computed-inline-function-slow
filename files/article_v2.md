# オブジェクトリテラル + computed property + メソッド定義 の組み合わせが遅いという話

## 結論から

- オブジェクトリテラル内で `[Symbol.dispose]()` のような **computed property でメソッドを定義するのが遅い**
- class を使うか、後付けでプロパティを追加する方が速い
- V8 (Chrome/Node) でも JSC (Safari/Bun) でも同じ
- クロージャ自体は関係なかった
- **生成だけでなく参照も遅くなる**（毎回別 Shape → IC が megamorphic）

-----

## きっかけ

[@vanilagy氏のポスト](https://x.com/vanilagy/status/2005003400023593125)で、クロージャを返すファクトリ関数のある行がプロファイラで異常に遅い（135.5ms）という話がありました。で、[class に書き換えたら劇的に改善した](https://x.com/vanilagy/status/2005219406880911479)と。

最初は「クロージャが遅いのかな？」と思ったんですが、調べてみたら違いました。

問題を再現する最小コード：

```javascript
// 遅い: オブジェクトリテラル + computed property メソッド
function createLock() {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
    },
    [Symbol.dispose]() {    // ← 135.5ms かかってた行
      this.release();
    }
  };
}

// 速い: class
class Lock {
  released = false;
  release() {
    if (this.released) return;
    this.released = true;
  }
  [Symbol.dispose]() {
    this.release();
  }
}
```

-----

## Hidden Classes とは

JavaScript は動的型付けですが、モダンなエンジンは内部的に「隠しクラス」を作ってオブジェクトの形状を追跡しています。

|エンジン                  |呼び名                  |
|----------------------|---------------------|
|V8 (Chrome/Node)      |Maps / Hidden Classes|
|JSC (Safari/Bun)      |Structures           |
|SpiderMonkey (Firefox)|Shapes               |

```javascript
const obj = {};      // Shape S0 (空)
obj.x = 1;           // Shape S0 → S1 (x を持つ)
obj.y = 2;           // Shape S1 → S2 (x, y を持つ)
```

**同じ順序でプロパティ追加したオブジェクトは同じ Shape を共有できます**。これでプロパティアクセスが最適化されるわけです。

-----

## Transition Chain と Inline Cache

### Transition Chain

プロパティ追加のたびに Shape が遷移して、チェーン状につながります。

```
S0 (empty) --"x"--> S1 {x: offset 0} --"y"--> S2 {x: offset 0, y: offset 1}
```

### これは生成時の話であって、参照時とは別

Transition chain はオブジェクト**生成時**にどの Shape を使うか決める仕組みです。生成後のオブジェクトへの**参照（プロパティアクセス）**は後述の Inline Cache の話になります。

### 通常はリテラル生成が最適

```javascript
// 最適: V8 が静的に Shape を決定できる
const obj = { x: 1, y: 2, z: 3 };

// 次点: 同じパターンなら transition chain を再利用
const obj = {};
obj.x = 1;
obj.y = 2;
obj.z = 3;
```

後者は3回の transition が発生しますが、**同じパターンで2個目以降を作るときは既存のチェーンを再利用**するので、大量生成でもそこまで問題になりません。

### プロパティ追加順序は揃えた方がいい

```javascript
// 良い: 同じ Shape を共有
function create1() { return { a: 1, b: 2 }; }
function create2() { return { a: 10, b: 20 }; }

// 悪い: 別の Shape が生まれる
function create1() { return { a: 1, b: 2 }; }
function create2() { return { b: 20, a: 10 }; }  // 順序が違う
```

まあこれは大量のオブジェクトを生成して同じ関数で処理する場合の話なので、普通のアプリコードでは神経質になる必要はないです。

### Inline Cache (IC)

プロパティアクセスの結果をキャッシュして、次回以降の検索をスキップする最適化です。

```javascript
function getX(obj) {
  return obj.x;  // ← ここに IC が仕込まれる
}
```

IC の状態：

|状態         |意味          |速度   |
|-----------|------------|-----|
|Monomorphic|常に同じ Shape  |最速   |
|Polymorphic|2〜4種類の Shape|やや遅い |
|Megamorphic|多すぎる Shape  |最適化放棄|

**異なる Shape のオブジェクトが大量に来ると、IC が megamorphic になって最適化が効かなくなります。**

-----

## 実験1: 生成コスト

### 検証コード

```javascript
// パターン1: 静的キーのみ
function createStatic() {
  return { release() {}, dispose() {} };
}

// パターン2: computed Symbol + 各種関数形式
function createComputedFunction() {
  return { release() {}, [Symbol.dispose]: function() {} };
}
function createComputedArrow() {
  return { release() {}, [Symbol.dispose]: () => {} };
}
function createComputedMethod() {
  return { release() {}, [Symbol.dispose]() {} };
}

// パターン3: 後付け
function createAddLater() {
  const obj = { release() {} };
  obj[Symbol.dispose] = function() {};
  return obj;
}

// パターン4: class
class StaticClass {
  release() {}
  [Symbol.dispose]() {}
}
```

### 結果（10万回生成）

|パターン|V8 (Node)|JSC (Bun)|
|---|---|---|
|静的キーのみ|3.38ms|5.19ms|
|**computed + function**|**28.44ms**|**21.44ms**|
|**computed + arrow**|**31.16ms**|**19.15ms**|
|**computed + method**|**32.09ms**|**12.69ms**|
|後付け + function|3.13ms|2.95ms|
|後付け + arrow|2.86ms|1.85ms|
|class|1.27ms|1.80ms|

**発見1**: function / arrow / method のどれを使っても computed property + リテラル内定義 は遅い。関数の形式は大きな差ではなかった。

**発見2**: 後付けパターンは静的キーと同等かそれ以上に速い。

-----

## 実験2: 参照コスト

元のポストでは **参照** に 135.5ms かかっていました。生成だけでなく参照も遅くなるのか検証します。

### 検証コード

```javascript
function benchAccess(name, createFn, iterations = 100000) {
  // オブジェクトを大量生成
  const objects = Array.from({ length: iterations }, createFn);
  
  // 参照のベンチマーク
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    objects[i][Symbol.dispose]();
  }
  return performance.now() - start;
}
```

### 結果（10万オブジェクトへの参照）

|パターン|V8 (Node)|JSC (Bun)|
|---|---|---|
|class (同一Shape)|1.30ms|1.64ms|
|literal computed + function|3.73ms|2.08ms|
|literal computed + arrow|2.05ms|2.33ms|
|literal computed + method|1.91ms|2.42ms|
|後付け + function|2.16ms|2.61ms|
|後付け + arrow|1.90ms|1.78ms|

参照だけなら 2〜4ms 程度で、135ms には程遠いですね…。

-----

## 実験3: 生成+参照の合計（using 文シミュレーション）

実際の `using` 構文では「生成 → すぐ dispose」という流れになります。

```javascript
function benchUsing(name, createFn, iterations = 100000) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const lock = createFn();
    lock[Symbol.dispose]();
  }
  return performance.now() - start;
}
```

### 結果（10万回の生成+dispose）

|パターン|V8 (Node)|JSC (Bun)|
|---|---|---|
|literal computed|32.34ms|28.93ms|
|後付け|9.24ms|7.48ms|
|class|4.22ms|2.92ms|

約8〜10倍の差が出ました。でもまだ 135ms には届かない…。

-----

## 実験4: 長時間実行での劣化

JIT コンパイルの影響を見るため、連続実行してバッチごとの時間を計測しました。

```javascript
function runLong(name, createFn) {
  const times = [];
  for (let batch = 0; batch < 10; batch++) {
    const start = performance.now();
    for (let i = 0; i < 100000; i++) {
      const lock = createFn();
      lock[Symbol.dispose]();
    }
    times.push(performance.now() - start);
  }
  console.log(`${name}: ${times.map(t => t.toFixed(1)).join(', ')}ms`);
}
```

### 結果

```
literal computed: 83.1, 28.7, 30.2, 29.2, 27.2, 27.4, 27.4, 27.9, 27.5, 27.5ms
class:            3.3,  2.7,  2.7,  2.5,  1.1,  1.1,  1.1,  1.1,  1.5,  1.0ms
```

**最初のバッチで 83.1ms！** これは 135ms にかなり近いです。

### 考察

最初のバッチが特に遅いのは：

1. **JIT コンパイルのコスト**: 最初はインタプリタで実行され、その後 JIT コンパイルが走る
2. **IC の状態遷移**: 最初は monomorphic → polymorphic → megamorphic と遷移していく
3. **Deoptimization**: 最適化されたコードが「やっぱり違った」と判断されて巻き戻される

literal + computed property の場合、**毎回新しい関数オブジェクトが生成される**ため、Shape が安定せず IC が megamorphic になりやすい。さらに JIT が最適化を試みては失敗を繰り返すことで、初期コストが膨れ上がると考えられます。

-----

## 実験5: Shape の一致確認

本当に毎回別 Shape になってるのか確認します。

```javascript
const lit1 = createLockLiteral();
const lit2 = createLockLiteral();
const cls1 = new LockClass();
const cls2 = new LockClass();

console.log("literal:", lit1[Symbol.dispose] === lit2[Symbol.dispose]);  // false
console.log("class:", cls1[Symbol.dispose] === cls2[Symbol.dispose]);    // true
```

### 結果

```
literal: dispose same? false   // 毎回新しい関数
class: dispose same? true      // プロトタイプ上の同一関数
```

literal の場合、**毎回新しい関数オブジェクトが生成**されています。これが Shape の不安定化と IC の megamorphic 化の原因です。

-----

## リテラル最適化の逆転現象

ここで面白いのが、**通常は「リテラル生成が最適」なのに、computed property + メソッド の場合は逆転する**という点です。

```javascript
// 通常: リテラル > 後付け
const obj1 = { x: 1, y: 2 };           // 最適
const obj2 = {}; obj2.x = 1; obj2.y = 2; // やや劣る

// computed + メソッド: リテラル < 後付け （逆転！）
const obj3 = { [Symbol.dispose]() {} };  // 遅い (30ms)
const obj4 = {}; obj4[Symbol.dispose] = function() {}; // 速い (3ms)
```

つまり、V8 の最適化パスにおいて：

- **静的リテラル** → Shape を事前決定できる → 最速
- **後付けプロパティ追加** → transition chain を辿る → まあまあ速い
- **computed property を含むリテラル + メソッド** → Shape を事前決定できない + 毎回新しい関数 → 遅い

という優先順位になっていて、computed property + メソッド を含む場合は「リテラルで書く」という通常のベストプラクティスが裏目に出るわけです。

これは知らないとハマりますね…。`[Symbol.dispose]()` や `[Symbol.iterator]()` のような well-known symbols を使う場面で特に注意が必要です。

-----

## なんで computed property + メソッドは遅いのか

V8 はオブジェクトリテラルを見て「この Shape になる」って事前に推論したいんですが、`[expr]` があると：

1. 式を評価するまでキー名が確定しない
2. Shape を事前に決定できない
3. 最適化パスに乗りにくい

さらにメソッド定義が絡むと、**関数オブジェクトが毎回新規生成**されます。これにより：

- 毎回微妙に異なる Shape が生まれる可能性
- IC が megamorphic になる
- **参照時も遅くなる**（元ポストの 135ms はここが効いてる）

```javascript
// 遅い: V8 がリテラル解析時に Shape を決定できない + 毎回新しい関数
{ [Symbol.dispose]() {} }

// 速い: まず静的 Shape を作り、既知の transition で追加
const obj = { release() {} };  // Shape A
obj[Symbol.dispose] = fn;       // Shape A → B (transition)
```

V8 は「静的リテラル → プロパティ追加」のパターンは得意ですが、「最初から computed を含む」のは苦手みたいです。

-----

## 135ms の謎

元ポストの 135.5ms という数字はかなり大きいですが、今回の検証では：

- **生成+参照の合計**: 30〜40ms 程度
- **JIT 初期化込みの最初のバッチ**: 80〜90ms 程度

まだ差があります。考えられる追加要因：

1. **実際のコードはもっと複雑**: クロージャ内の変数が多い、this 参照が複雑、など
2. **他の処理との相互作用**: 他の megamorphic な呼び出しサイトと IC を共有している可能性
3. **GC の影響**: 大量の短命オブジェクト生成による GC プレッシャー
4. **プロファイラ自体のオーバーヘッド**: 計測が重い処理に偏って見える可能性

いずれにせよ、**computed property + メソッド定義のパターンがボトルネックになりうる**ことは確かです。

-----

## class が速い理由

class では computed property であっても**クラス定義時に一度だけ評価**されて、プロトタイプに固定されます。

```javascript
class Lock {
  [Symbol.dispose]() { ... }  // クラス定義時に1回だけ評価
}

const lock1 = new Lock();
const lock2 = new Lock();
lock1[Symbol.dispose] === lock2[Symbol.dispose];  // true（プロトタイプ上の同一関数）
```

一方、オブジェクトリテラルは**生成のたびに評価**されます：

```javascript
function createLock() {
  return {
    [Symbol.dispose]() { ... }  // 毎回新しい関数オブジェクト
  };
}
```

この違いが：
- **Shape の安定性**: class は全インスタンスが同一 Shape
- **IC の状態**: class は monomorphic を維持しやすい
- **メモリ効率**: class は関数を共有

といった差につながります。

-----

## ベストプラクティス

### ✅ 推奨

```javascript
// 1. class を使う（最も安全で高速）
class Lock {
  [Symbol.dispose]() { ... }
}

// 2. 後付けでプロパティを追加
function createLock() {
  const obj = { release() { ... } };
  obj[Symbol.dispose] = function() { this.release(); };
  return obj;
}
```

### ❌ 避ける

```javascript
// オブジェクトリテラル内の computed property でメソッド定義
function createLock() {
  return {
    [Symbol.dispose]() { ... }  // 遅い
  };
}
```

-----

## まとめ

|要因|影響度|備考|
|---|---|---|
|リテラル内 computed property + メソッド定義|**最大**|生成も参照も遅い|
|リテラル内 computed property + 値|小|ほぼ影響なし|
|後付けでのプロパティ追加|なし|むしろ速い場合も|
|クロージャ生成|**ほぼ無関係**|今回の遅さの原因ではなかった|
|function vs arrow vs method|小|大差なし|

最初は「クロージャが遅い」と思ってたんですが、実験してみたら **「オブジェクトリテラル内で computed property をキーとしてメソッドを定義する」という特定のパターンが遅い** ことがわかりました。クロージャかどうかは本質的な問題じゃなかったです。

そして面白いのは、通常「リテラル生成が最適」というセオリーが、computed property + メソッド の場合は逆転するという点。後付けの方が速いというのは意外でした。

**生成時だけでなく参照時も遅くなる**のが厄介なところで、毎回新しい関数オブジェクトが生成されることで Shape が安定せず、IC が megamorphic になりやすいのが原因と考えられます。

class が速いのは、computed property であっても**クラス定義時に一度だけ評価**されてプロトタイプに固定されるからです。

-----

## 参考資料

### V8 公式

- [Fast properties in V8](https://v8.dev/blog/fast-properties)
- [Maps (Hidden Classes) in V8](https://v8.dev/docs/hidden-classes)

### 解説記事

- [JavaScript engine fundamentals: Shapes and Inline Caches](https://mathiasbynens.be/notes/shapes-ics) - Mathias Bynens
- [JavaScript Engines Hidden Classes](https://draft.li/blog/2016/12/22/javascript-engines-hidden-classes/)
- [V8 Hidden class](https://engineering.linecorp.com/en/blog/v8-hidden-class) - LINE Engineering
- [Grokking V8 closures for fun](https://mrale.ph/blog/2012/09/23/grokking-v8-closures-for-fun.html) - Vyacheslav Egorov

### JSC

- [JavaScriptCore - WebKit Documentation](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html)
