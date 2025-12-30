# オブジェクトリテラル + computed property + メソッド定義 の組み合わせが遅いという話

## 結論から

- オブジェクトリテラル内で `[Symbol.dispose]()` のような **computed property でメソッドを定義するのが遅い**
- class を使うか、後付けでプロパティを追加する方が速い
- V8 (Chrome/Node) でも JSC (Safari/Bun) でも同じ
- クロージャ自体は関係なかった

-----

## きっかけ

[@vanilagy氏のポスト](https://x.com/vanilagy/status/2005003400023593125)で、クロージャを返すファクトリ関数のある行がプロファイラで異常に遅いという話がありました。で、[class に書き換えたら劇的に改善した](https://x.com/vanilagy/status/2005219406880911479)と。

最初は「クロージャが遅いのかな？」と思ったんですが、調べてみたら違いました。

問題を再現する最小コード：

```javascript
// 遅い: オブジェクトリテラル + computed property メソッド
function createLock() {
  let released = false;
  return {
    release: () => {
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

## 実験してみた

### 検証コード

```javascript
// 独自 Symbol（モジュールスコープで1回だけ生成）
const SYM_Y = Symbol("y");

// パターン1: 静的キーのみ
function createStatic() {
  return { release() {}, dispose() {} };
}

// パターン2: computed Symbol
function createComputedSymbol() {
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

|パターン                    |V8 (Node)  |JSC (Bun)  |
|------------------------|-----------|-----------|
|静的キーのみ                  |3.16ms     |8.07ms     |
|**computed Symbol メソッド**|**30.23ms**|**22.63ms**|
|後付け Symbol メソッド         |6.37ms     |3.82ms     |
|class                   |1.39ms     |3.81ms     |

おー、約10倍の差。

### クロージャは関係ある？

クロージャなしで純粋に computed property の影響だけ検証してみました：

```javascript
const SYM_Y = Symbol("y");

// 値のみ（メソッドなし）
function createStaticValue() { return { x: 1, y: 2 }; }
function createComputedValue() { return { x: 1, [SYM_Y]: 2 }; }

// メソッドあり
function createStaticMethod() { return { foo() {}, bar() {} }; }
function createComputedMethod() { return { foo() {}, [Symbol.dispose]() {} }; }
```

|パターン                    |V8         |JSC        |
|------------------------|-----------|-----------|
|**値のみ**                 |           |           |
|静的キー `{ x, y }`         |5.48ms     |3.87ms     |
|computed Symbol 値       |4.18ms     |2.80ms     |
|**メソッド**                |           |           |
|静的キー `{ foo, bar }`     |3.16ms     |8.07ms     |
|**computed Symbol メソッド**|**30.23ms**|**22.63ms**|

あーなるほど、**「computed Symbol + メソッド定義」の組み合わせが特に遅い**んですね。値だけなら差は小さい。クロージャは無関係でした。

-----

## リテラル最適化の逆転現象

ここで面白いのが、**通常は「リテラル生成が最適」なのに、computed property + メソッド の場合は逆転する**という点です。

```javascript
// 通常: リテラル > 後付け
const obj1 = { x: 1, y: 2 };           // 最適
const obj2 = {}; obj2.x = 1; obj2.y = 2; // やや劣る

// computed + メソッド: リテラル < 後付け （逆転！）
const obj3 = { [Symbol.dispose]() {} };  // 遅い (30ms)
const obj4 = {}; obj4[Symbol.dispose] = function() {}; // 速い (6ms)
```

つまり、V8 の最適化パスにおいて：

- **静的リテラル** → Shape を事前決定できる → 最速
- **後付けプロパティ追加** → transition chain を辿る → まあまあ速い
- **computed property を含むリテラル** → Shape を事前決定できない → 遅い

という優先順位になっていて、computed property を含む場合は「リテラルで書く」という通常のベストプラクティスが裏目に出るわけです。

これは知らないとハマりますね…。`[Symbol.dispose]()` や `[Symbol.iterator]()` のような well-known symbols を使う場面で特に注意が必要です。

-----

## なんで computed property + メソッドは遅いのか

V8 はオブジェクトリテラルを見て「この Shape になる」って事前に推論したいんですが、`[expr]` があると：

1. 式を評価するまでキー名が確定しない
2. Shape を事前に決定できない
3. 最適化パスに乗りにくい

さらにメソッド定義が絡むと、関数オブジェクトの生成と computed key の評価が同時に発生してオーバーヘッドが増大します。

```javascript
// 遅い: V8 がリテラル解析時に Shape を決定できない
{ [Symbol.dispose]() {} }

// 速い: まず静的 Shape を作り、既知の transition で追加
const obj = { release() {} };  // Shape A
obj[Symbol.dispose] = fn;       // Shape A → B (transition)
```

V8 は「静的リテラル → プロパティ追加」のパターンは得意ですが、「最初から computed を含む」のは苦手みたいです。

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
    [Symbol.dispose]() { ... }  // 毎回評価
  };
}
```

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

|要因                              |影響度      |備考            |
|--------------------------------|---------|--------------|
|リテラル内 computed property + メソッド定義|**最大**   |約10倍遅い        |
|リテラル内 computed property + 値     |小        |ほぼ影響なし        |
|後付けでのプロパティ追加                    |なし       |むしろ速い場合も      |
|クロージャ生成                         |**ほぼ無関係**|今回の遅さの原因ではなかった|

最初は「クロージャが遅い」と思ってたんですが、実験してみたら **「オブジェクトリテラル内で computed property をキーとしてメソッドを定義する」という特定のパターンが遅い** ことがわかりました。クロージャかどうかは本質的な問題じゃなかったです。

そして面白いのは、通常「リテラル生成が最適」というセオリーが、computed property + メソッド の場合は逆転するという点。後付けの方が速いというのは意外でした。

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
