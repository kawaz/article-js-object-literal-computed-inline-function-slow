# V8 Bug Report Draft

## Title
Object literal with computed property method causes ~10x slower performance than class or property assignment

## Summary
When defining methods in object literals using computed property keys (e.g., `[Symbol.dispose]()`), performance degrades significantly (~10x slower) compared to equivalent patterns like classes or property assignment after object creation.

This is particularly impactful for code using `Symbol.dispose` / `Symbol.asyncDispose` with the new Explicit Resource Management feature.

## Minimal Reproduction

```javascript
const SYM = Symbol("test");

// SLOW: ~30ms for 100k iterations
function createSlow() {
  return { [SYM]() {} };
}

// FAST: ~3ms for 100k iterations  
function createFast() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}

// FAST: ~3ms for 100k iterations
class Fast {
  [SYM]() {}
}

// Benchmark
function bench(name, fn, n = 100000) {
  for (let i = 0; i < 1000; i++) fn(); // warmup
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const obj = fn();
    obj[SYM]();
  }
  console.log(`${name}: ${(performance.now() - start).toFixed(2)}ms`);
}

bench("literal + computed + method", createSlow);
bench("property assignment", createFast);
bench("class", () => new Fast());
```

## Results

Tested on Node.js v22.21.0 (V8 12.4.254.21)

| Pattern | Time (100k iterations) |
|---------|------------------------|
| **Literal + computed + method** | **~30ms** |
| Property assignment after creation | ~4ms |
| Class | ~4ms |
| Literal + computed + shared function | ~4ms |
| Literal + static key + method | ~3ms |

## Analysis

Running with `--trace-deopt` shows repeated bailouts:

```
[bailout (kind: deopt-eager, reason: wrong call target)]
```

The issue appears to be:
1. Each object literal with computed property method creates a new function object
2. Despite having the same shape, each function is a different object
3. JIT optimizes assuming the same function will be called
4. Actual call uses a different function → deopt
5. Cycle repeats, causing persistent performance degradation

## Key Finding

The slowness requires ALL THREE conditions:
- Object literal (not property assignment)
- Computed property key (not static key)
- Method/function definition (not primitive value)

Removing any one condition results in fast performance.

## Expected Behavior

Performance should be closer to the class or property-assignment patterns, since the object shape is identical and predictable.

## Possible Workarounds (for users)

```javascript
// Instead of:
function createLock() {
  return { [Symbol.dispose]() { /* ... */ } };
}

// Use class:
class Lock {
  [Symbol.dispose]() { /* ... */ }
}

// Or property assignment:
function createLock() {
  const obj = {};
  obj[Symbol.dispose] = function() { /* ... */ };
  return obj;
}

// Or shared function:
const dispose = function() { /* ... */ };
function createLock() {
  return { [Symbol.dispose]: dispose };
}
```

## Environment

- V8 version: 12.4.254.21-node.22
- Node.js version: v22.21.0
- OS: Linux (also reproduced on macOS)
- Also tested with Bun (JSC) - similar behavior observed

## Related

This issue is particularly relevant for Explicit Resource Management (using/await using) where `[Symbol.dispose]()` is commonly defined in object literals.

---

# How to File

1. Go to: https://bugs.chromium.org/p/v8/issues/entry
2. Sign in with Google account
3. Fill in the fields:
   - **Summary**: Object literal with computed property method causes ~10x slower performance than class or property assignment
   - **Type**: Bug (or Performance)
   - **Priority**: (leave default)
   - **Description**: (paste the content above)
4. Submit

---

# Alternative: JSC (WebKit) Bug Report

For the `using` overhead issue in JSC:

**URL**: https://bugs.webkit.org/enter_bug.cgi?product=WebKit

**Summary**: `using` declaration has ~48ns overhead per use compared to manual dispose call

**Description**:
```
The `using` declaration in Explicit Resource Management has a measurable overhead
compared to manual try-finally or direct dispose calls.

Benchmark shows:
- using obj = new Lock():     ~5ms / 100k iterations
- const obj = new Lock(); obj[Symbol.dispose](): ~0.06ms / 100k iterations

This is approximately 48ns overhead per `using` declaration.

In comparison, V8 (Node.js) shows near-zero overhead for the same pattern.

[Include benchmark code]
```
