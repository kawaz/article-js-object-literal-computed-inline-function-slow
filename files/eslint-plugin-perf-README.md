# eslint-plugin-perf

JavaScript パフォーマンス問題を検出・自動修正する ESLint プラグイン

## インストール

```bash
npm install eslint-plugin-perf --save-dev
```

## 設定 (ESLint v9+)

```javascript
// eslint.config.js
import perfPlugin from "eslint-plugin-perf";

export default [
  {
    plugins: {
      perf: perfPlugin,
    },
    rules: {
      "perf/no-computed-property-method": "warn",
    },
  },
];
```

## ルール

### `perf/no-computed-property-method`

オブジェクトリテラル内の computed property に関数を定義するパターンを検出します。

このパターンは V8/JSC で約 **10倍** 遅くなります。

#### ❌ Bad

```javascript
const obj = { [Symbol.dispose]() {} };
const obj = { [key]: function() {} };
const obj = { [key]: () => {} };
```

#### ✅ Good

```javascript
// 後付けパターン
const obj = {};
obj[Symbol.dispose] = function() {};

// class
class MyClass {
  [Symbol.dispose]() {}
}

// 共有関数
const dispose = () => {};
const obj = { [Symbol.dispose]: dispose };
```

#### 自動修正

`--fix` オプションで自動修正できます：

```bash
npx eslint --fix your-file.js
```

Before:
```javascript
const obj = { 
  name: "test",
  [Symbol.dispose]() { console.log("cleanup"); }
};
```

After:
```javascript
const obj = { 
  name: "test"
}; 
obj[Symbol.dispose] = function() { console.log("cleanup"); };
```

## パフォーマンス改善効果

| Engine | Before | After | Speedup |
|--------|--------|-------|---------|
| V8 (Node) | 33ms | 5.6ms | **5.9x** |
| JSC (Bun) | 27ms | 7.9ms | **3.5x** |

(100,000 iterations)

## なぜ遅いのか

オブジェクトリテラル + computed property + 関数定義 の組み合わせは：

1. 毎回新しい関数オブジェクトが生成される
2. JIT が「同じ関数が呼ばれる」と仮定して最適化
3. 実際は毎回違う関数 → deoptimization
4. このサイクルが繰り返され、大幅な性能劣化

詳細: [V8 blog - Fast properties](https://v8.dev/blog/fast-properties)

## 関連

- [V8 Issue (予定)](#)
- [WebKit Bug (予定)](#)

## License

MIT
