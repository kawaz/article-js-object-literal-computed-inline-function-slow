# Bun Issue Report Draft

## Title
[Performance] Object literal with computed property method causes ~10x deoptimization in JSC - could `bun build` optimize this?

## What is the problem this feature/fix would solve?

When defining methods in object literals using computed property keys (e.g., `[Symbol.dispose]()`), JSC suffers significant performance degradation (~10x slower) compared to equivalent patterns.

This is particularly impactful for code using the new Explicit Resource Management feature (`using`), where `[Symbol.dispose]()` is commonly defined in object literals.

### Reproduction

```javascript
const SYM = Symbol("test");

// SLOW: ~15ms for 100k iterations in Bun
function createSlow() {
  return { [SYM]() {} };
}

// FAST: ~4ms for 100k iterations in Bun
function createFast() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}

// Benchmark
function bench(name, fn, n = 100000) {
  for (let i = 0; i < 1000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const obj = fn();
    obj[SYM]();
  }
  console.log(`${name}: ${(performance.now() - start).toFixed(2)}ms`);
}

bench("literal + computed + method", createSlow);
bench("property assignment", createFast);
```

### Results (Bun 1.3.5)

| Pattern | Time (100k iterations) |
|---------|------------------------|
| **Literal + computed + method** | **~15ms** |
| Property assignment after creation | ~4ms |
| Class | ~3ms |

### Additional Finding: `using` overhead in JSC

JSC also has ~48ns overhead per `using` declaration compared to V8 (which has near-zero overhead):

```javascript
// In Bun (JSC):
//   using obj = new Lock():        ~5ms / 100k
//   const obj = new Lock(); dispose(): ~0.06ms / 100k
//
// In Node (V8):
//   using obj = new Lock():        ~0.06ms / 100k
//   const obj = new Lock(); dispose(): ~0.06ms / 100k
```

## What is the feature you are proposing to solve the problem?

### Option 1: AST Transformation in `bun build`

`bun build` could detect this pattern and automatically transform it:

**Before (slow):**
```javascript
const obj = { staticProp: 1, [Symbol.dispose]() { cleanup(); } };
```

**After (fast):**
```javascript
const obj = { staticProp: 1 }; obj[Symbol.dispose] = function() { cleanup(); };
```

This transformation:
- Is semantically equivalent
- Preserves all static properties in the literal (optimal for V8/JSC)
- Only moves computed property methods to post-assignment
- Could be opt-in via a flag like `--optimize-computed-methods`

### Option 2: JSC-level optimization (longer term)

If Bun has influence over the WebKit/JSC fork, this optimization could be done at the engine level, benefiting all Bun users without build step changes.

### Option 3: Document the issue

At minimum, documenting this performance cliff in Bun's performance guide would help users avoid it.

## What alternatives have you considered?

1. **ESLint plugin** - I've created a working ESLint plugin that detects and auto-fixes this pattern. It also works with Oxlint. However, this requires users to actively adopt it.

2. **User education** - Telling users to use classes or property assignment, but this is easy to forget.

3. **JSC upstream contribution** - More complex, but would fix the root cause.

## Additional context

- This issue affects both V8 and JSC, but the transformation benefits both engines
- The ESLint plugin PoC is available if useful for reference
- V8's `--trace-deopt` shows "wrong call target" bailouts for this pattern
- Related: The `using` overhead in JSC might be a separate issue worth investigating

## Environment

- Bun version: 1.3.5
- OS: Linux (also reproduced on macOS)
- Architecture: x86_64

---

# Alternative: File as Feature Request for `bun build` plugin API

If `bun build` doesn't want to add built-in optimizations, exposing AST transformation hooks would let users implement this themselves. Related issues:
- #2729 (Support AST transforms)
- #12896 (Bun AST Parser)
