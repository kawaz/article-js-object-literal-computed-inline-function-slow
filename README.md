# In JS, Object Literal + Computed Property + Inline Function Definition = Slow

Investigation and benchmarks of a JavaScript engine (V8/JSC) performance issue.

## Articles

### Zenn
- [Japanese](https://zenn.dev/kawaz/articles/js-object-literal-computed-inline-function-slow)
- [English](https://zenn.dev/kawaz/articles/js-object-literal-computed-inline-function-slow-en)

### GitHub
- [Japanese](article-js-object-literal-computed-inline-function-slow.ja.md)
- [English](article-js-object-literal-computed-inline-function-slow.md)

## Summary

When these 3 conditions are met, performance degrades ~10x (caused by V8/JSC deoptimization):

```javascript
// ❌ Slow
function createLock() {
  return { [Symbol.dispose]() { ... } };
}

// ✅ Fast (via variable)
function createLock() {
  const dispose = () => { ... };
  return { [Symbol.dispose]: dispose };
}
```
