# Object Literal + Computed Property + Method Definition Performance Issue

## Conclusion

When "object literal", "computed property", and "method definition (function creation)" are combined, performance becomes extremely slow.

```ts
// Slow (all 3 conditions met)
function createLock() {
  return {
    [Symbol.dispose]() { ... }  // literal + computed + new function each time
  };
}
```

The fix is to remove any one of these three conditions.

```ts
// Fast (remove one of the conditions)
function createLock() {
  const release = () => { ... };
  return { [Symbol.dispose]: release };  // pre-defined function
}

function createLock() {
  const obj = {};
  obj[Symbol.dispose] = function() { ... };  // add after creation
  return obj;
}

class Lock {
  [Symbol.dispose]() { ... }  // class
}
```

-----

## Background

[@vanilagy's post](https://x.com/vanilagy/status/2005003400023593125) reported that a `[Symbol.dispose]()` line in a factory function showed 135.5ms in the profiler - abnormally slow. After rewriting to a class, performance improved dramatically.

```javascript
// The slow code
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

Initial hypotheses:

1. Closures are slow? (likely)
2. Creating new functions each time is slow? (likely)
3. Method definition is slow? (unlikely)
4. Computed property (`[expr]`) is slow? (likely)
5. Symbol computed property (`[Symbol.dispose]`) is slow? (unlikely, common usage)
6. Object literals are slow? (unlikely)

These were tested one by one.

-----

## Prerequisites: Hidden Classes and Inline Cache

Before testing, a brief explanation of JavaScript engine optimization (this is my first time researching this for understanding the phenomenon, so there may be errors).

### Hidden Classes

JavaScript is dynamically typed, but engines internally create "hidden classes" to track object shapes. Called Maps in V8, Structures in JSC.

```javascript
const obj = {};      // Shape S0 (empty)
obj.x = 1;           // Shape S0 → S1 (has x)
obj.y = 2;           // Shape S1 → S2 (has x, y)
```

Objects with properties added in the same order can share the same Shape, optimizing property access.

Creating with object literal in one shot is most efficient as no transitions occur - the final Shape is determined immediately.

However, this only applies to initial Shape creation. When creating second and subsequent objects with the same pattern, the existing chain is reused. So this rarely becomes a major problem (in hardcoded code, the addition order is fixed, so the issue mainly arises when dynamically generating from an indeterminate field list in a loop).

### Inline Cache (IC)

Optimization that caches results of property access and function calls, skipping lookups on subsequent calls.

```javascript
function call(obj) {
  obj.dispose();  // ← IC is applied here
}
```

IC optimizes assuming "always the same Shape / same function". When something different arrives, optimization is disabled (Deoptimization).

### Deoptimization (Deopt)

When assumptions made by the JIT compiler during optimization break down, the optimized code is discarded and reverts to slower code.

```
Optimization: "This call always invokes function A"
    ↓
Actually function B arrived
    ↓
Deopt due to "wrong call target"
    ↓
Try to reoptimize → different function again → Deopt...
```

-----

## Test 1: Isolating the Cause of Slowness

First, an exhaustive test to determine which conditions contribute to slowness.

### Test Code

```javascript
const SYM = Symbol("dispose");
const sharedFn = function() {};

// literal + computed + new function each time
function literalComputedNewFn() {
  return { [SYM]() {} };
}

// literal + computed + shared function
function literalComputedSharedFn() {
  return { [SYM]: sharedFn };
}

// literal + static key + new function each time
function literalStaticNewFn() {
  return { dispose() {} };
}

// literal + static key + shared function
function literalStaticSharedFn() {
  return { dispose: sharedFn };
}

// add later + computed + new function each time
function addLaterComputedNewFn() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}

// add later + computed + shared function
function addLaterComputedSharedFn() {
  const obj = {};
  obj[SYM] = sharedFn;
  return obj;
}

// class
class WithClass {
  [SYM]() {}
}
```

### Results: Creation + Call (100,000 times)

| Pattern | V8 (Node) | JSC (Bun) |
|---|---|---|
| **literal + computed + new function** | **30.12ms** | **13.22ms** |
| literal + computed + shared function | 4.30ms | 2.52ms |
| literal + static key + new function | 2.88ms | 3.80ms |
| literal + static key + shared function | 2.59ms | 1.32ms |
| add later + computed + new function | 4.19ms | 2.06ms |
| add later + computed + shared function | 2.30ms | 2.02ms |
| class + computed | 3.86ms | 3.20ms |

<details>
<summary>How to run benchmarks</summary>

```bash
# Node.js (V8)
node benchmarks/bench_fn_types.js

# Bun (JSC)
bun benchmarks/bench_fn_types.js

# V8 with deopt trace
node --trace-opt --trace-deopt benchmarks/bench_fn_types.js
```

→ [benchmarks/bench_fn_types.js](benchmarks/bench_fn_types.js)

</details>

### Findings

Only the "literal + computed + new function each time" combination is significantly slow.

Removing any one condition makes it fast:

- Use shared function → fast
- Add after creation → fast
- Use static key → fast
- Use class → fast

-----

## Test 2: Are Closures Related?

Tested the hypothesis that closures are the cause.

```javascript
// With closure
function withClosure() {
  let state = false;
  return {
    [Symbol.dispose]() { state = true; }
  };
}

// Without closure
function withoutClosure() {
  return {
    [Symbol.dispose]() {}
  };
}
```

Result: Both are equally slow. **Closures are unrelated**.

-----

## Test 3: Difference Between function / arrow / method

Tested differences based on function syntax.

```javascript
// Method shorthand
{ [SYM]() {} }

// function
{ [SYM]: function() {} }

// arrow
{ [SYM]: () => {} }
```

| Pattern | V8 | JSC |
|---|---|---|
| computed + function | 28.44ms | 21.44ms |
| computed + arrow | 31.16ms | 19.15ms |
| computed + method | 32.09ms | 12.69ms |

<details>
<summary>How to run benchmarks</summary>

```bash
node benchmarks/bench_fn_types.js
bun benchmarks/bench_fn_types.js
```

→ [benchmarks/bench_fn_types.js](benchmarks/bench_fn_types.js)

</details>

Result: All are equally slow. **Function syntax is unrelated**.

-----

## Test 4: Is It OK with Primitive Values?

Tested whether non-function values are slow even when new each time.

```javascript
let counter = 0;

// New number each time
function createWithNewNumber() {
  return { [SYM]: counter++ };
}

// New function each time
function createWithNewFunction() {
  return { [SYM]: function() {} };
}
```

| Pattern | V8 (create+access) | V8 (create+call) |
|---|---|---|
| new number each time | 2.15ms | - |
| new function each time | 29.88ms | **89.59ms** |

Result: **Only functions are slow**. Furthermore, just accessing is around 30ms, but calling jumps to 90ms.

-----

## Test 5: Why Is "Calling" Slower?

Confirmed Deoptimization occurrence using V8 trace options.

```bash
node --trace-opt --trace-deopt bench.js
```

Output (excerpt):
```
[bailout (kind: deopt-eager, reason: wrong call target): ...]
[bailout (kind: deopt-eager, reason: wrong call target): ...]
```

Deopt was repeatedly occurring with the reason `wrong call target` (call target differs from expected).

Because a new function object is created each time, even when JIT optimizes assuming "this function will be called", a different function actually arrives causing Deopt. This repetition causes significant slowdown.

-----

## Test 6: Does Sharing Functions Speed Things Up?

Reusing the same function object should avoid Deopt.

```javascript
// Slow: new function each time
function createLock() {
  let released = false;
  return {
    release() { if (released) return; released = true; },
    [Symbol.dispose]() { this.release(); }
  };
}

// Fast: share the same function for release and dispose
function createLock() {
  let released = false;
  const release = () => { if (released) return; released = true; };
  return { release, [Symbol.dispose]: release };
}
```

| Pattern | V8 |
|---|---|
| new function each time | 36.23ms |
| **shared function** | **4.14ms** |
| class | 4.49ms |

Result: **~9x faster**. Achieves same speed as class.

-----

## Test 7: Are using Syntax or try-finally Related?

The original code was intended for use with `using` syntax. Tested whether the syntax itself causes slowness.

```javascript
// using syntax
{ using lock = createLock(); }

// try-finally
const lock = createLock();
try { } finally { lock[Symbol.dispose](); }

// simple loop
const lock = createLock();
lock[Symbol.dispose]();
```

| Pattern | Bun (literal) | Bun (class) |
|---|---|---|
| using | 25.31ms | 13.87ms |
| try-finally | 24.96ms | 2.38ms |
| simple loop | 23.28ms | 2.38ms |

<details>
<summary>How to run benchmarks</summary>

```bash
bun benchmarks/bench_jsc_using.js
```

→ [benchmarks/bench_jsc_using.js](benchmarks/bench_jsc_using.js)

</details>

Result: **Almost no difference by syntax**. The cause of slowness is the object creation pattern, not the syntax.

-----

## Test 8: The 135ms Mystery

The original post mentioned 135.5ms, but our tests showed at most 30-90ms.

When measuring time per batch during long-running execution:

```
literal computed: 83.1, 28.7, 30.2, 29.2, 27.2ms
class:            3.3,  2.7,  2.7,  2.5,  1.1ms
```

The first batch stands out at 83ms. This is initialization cost from repeated JIT compilation and Deopt.

DevTools profiler aggregates this Deopt cost to "that line", making it appear larger than reality. 135ms likely includes profiler overhead and other factors.

-----

## Why Is Only "Literal + Computed + New Function Each Time" Slow?

When all 3 conditions are met, it seems to miss V8's specific optimization path.

- **Add later**: Creates static Shape first, then adds via known transition, so optimization works
- **Static key**: Shape can be determined at literal parsing time, so optimization works
- **Shared function**: Call target is always the same, so IC remains stable
- **Class**: Shares same function on prototype, so IC remains stable

For "literal + computed + new function each time":
1. Cannot determine Shape at literal parsing due to computed property
2. New function object created each time
3. Deopt with `wrong call target` on every call
4. Cycle of optimization → Deopt → re-optimization

-----

## Summary

| Hypothesis | Result |
|---|---|
| Closures are slow | ❌ Unrelated |
| Computed property is slow | △ No problem alone |
| Object literal is slow | △ No problem alone |
| Method definition is slow | △ No problem alone |
| function/arrow/method difference | ❌ Unrelated |
| using syntax is slow | ❌ Unrelated |
| **Combination of 3 conditions** | ✅ **This is the cause** |

Slowdown condition: **"Literal" + "computed property" + "new function creation and invocation each time"**

-----

## Solutions

```javascript
// ❌ Slow
function createLock() {
  return {
    [Symbol.dispose]() { ... }
  };
}

// ✅ Fast: share function
function createLock() {
  const release = () => { ... };
  return { release, [Symbol.dispose]: release };
}

// ✅ Fast: define function at module level
const dispose = function() { this.release(); };
function createLock() {
  return { release() { ... }, [Symbol.dispose]: dispose };
}

// ✅ Fast: add after creation
function createLock() {
  const obj = { release() { ... } };
  obj[Symbol.dispose] = function() { this.release(); };
  return obj;
}

// ✅ Fast: class
class Lock {
  [Symbol.dispose]() { ... }
}
```

-----

## Appendix: Object Construction Best Practices

Based on this investigation, summarizing transition chain considerations during object construction.

### Basics: Single-shot Literal Creation is Best

```javascript
// Optimal: no transitions occur
const obj = { a: 1, b: 2, c: 3 };

// Second best: transitions occur, but cache works for same patterns
const obj = {};
obj.a = 1;
obj.b = 2;
obj.c = 3;
```

The latter transitions Shape with each property addition, but this only applies to initial Shape creation. For second and subsequent objects with the same pattern, the existing chain is reused, so mass creation isn't a major problem.

### Exception: Add Computed Properties After Creation

However, when computed properties are involved, things change.

```javascript
// ❌ Avoid: computed property + function inside literal
function create() {
  return {
    staticMethod() { ... },
    [Symbol.dispose]() { ... }  // This is the problem
  };
}

// ✅ Recommended: static properties in literal, dynamic properties added after
function create() {
  const obj = { staticMethod() { ... } };  // Static part in literal
  obj[Symbol.dispose] = function() { ... };  // Dynamic part added after
  return obj;
}
```

Especially when the computed property value is a function object, current V8/JSC optimizations show significant performance degradation with "literal + computed + new function each time". This combination should be avoided.

### Summary

| Situation | Recommendation |
|---|---|
| Static properties only | Single-shot literal creation |
| Has computed property (non-function value) | Literal creation is fine |
| Has computed property (function value) | Static part in literal, dynamic part added after or use class |

-----

## References

### V8 Official
- [Fast properties in V8](https://v8.dev/blog/fast-properties)
- [Maps (Hidden Classes) in V8](https://v8.dev/docs/hidden-classes)

### Articles
- [JavaScript engine fundamentals: Shapes and Inline Caches](https://mathiasbynens.be/notes/shapes-ics) - Mathias Bynens
- [JavaScript Engines Hidden Classes](https://draft.li/blog/2016/12/22/javascript-engines-hidden-classes/)
- [V8 Hidden class](https://engineering.linecorp.com/en/blog/v8-hidden-class) - LINE Engineering

### JSC
- [JavaScriptCore - WebKit Documentation](https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html)
