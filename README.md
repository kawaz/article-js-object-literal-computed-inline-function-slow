# JSで「オブジェクトリテラル」+「computed property」+「リテラル内での直接関数定義」が遅い件

JavaScriptエンジン（V8/JSC）のパフォーマンス問題を調査・検証した記録。

## 記事

- [日本語版](article-js-object-literal-computed-inline-function-slow.ja.md)
- [English version](article-js-object-literal-computed-inline-function-slow.md)

## 概要

「オブジェクトリテラル」「computed property」「リテラル内での直接関数定義」の3条件が揃うと約10倍遅くなる（V8/JSCのdeoptimizationが原因）。

```javascript
// ❌ 遅い
function createLock() {
  return { [Symbol.dispose]() { ... } };
}

// ✅ 速い（変数経由）
function createLock() {
  const dispose = () => { ... };
  return { [Symbol.dispose]: dispose };
}
```
