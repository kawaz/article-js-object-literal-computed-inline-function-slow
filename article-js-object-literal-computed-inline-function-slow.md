---
title: "In JS, Object Literal + Computed Property + Inline Function Definition = Slow"
emoji: "🐢"
type: "tech"
topics: ["javascript", "performance", "v8", "jsc"]
published: false
---

# In JS, Object Literal + Computed Property + Inline Function Definition = Slow

> 🌐 [日本語版](article-js-object-literal-computed-inline-function-slow.ja.md)

## TL;DR

When these 3 conditions are met, performance degrades significantly (~10x slower). Avoid this pattern.

```ts
// Slow (all 3 conditions met)
function createLock() {
  return {
    [Symbol.dispose]() { ... }  // literal + computed + inline definition
  };
}

// Also slow (inline definition, not just method syntax)
function createLock() {
  return {
    [Symbol.dispose]: function() { ... }  // literal + computed + inline definition
  };
}
```

Fix by breaking any one of the 3 conditions:

```ts
// Fast (break one of the conditions)
function createLock() {
  const release = () => { ... };
  return { [Symbol.dispose]: release };  // pass via variable
}

function createLock() {
  const obj = {};
  obj[Symbol.dispose] = function() { ... };  // add-later
  return obj;
}

class Lock {
  [Symbol.dispose]() { ... }  // class
}
```

-----

## Background

[@vanilagy's post](https://x.com/vanilagy/status/2005003400023593125) reported that `[Symbol.dispose]()` in a factory function was showing 135.5ms in the profiler - abnormally slow. After rewriting to a class, performance improved dramatically.

Key code from the original post:

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

Initial hypotheses:

1. Closures are slow? (likely)
2. Creating new functions each time is slow? (likely)
3. Method definition is slow? (unlikely)
4. Difference between function / arrow / method syntax? (likely)
5. Computed property (`[expr]`) is slow? (likely)
6. Symbol computed property (`[Symbol.dispose]`) is slow? (unlikely - common usage)
7. Object literals are slow? (unlikely)

Tested all combinations exhaustively.

-----

## Background: Hidden Classes and Inline Cache

Before testing, a brief explanation of JavaScript engine optimizations (this is my understanding from researching this issue - may contain errors).

### Hidden Classes

JavaScript is dynamically typed, but engines internally create "hidden classes" to track object shapes. V8 calls them Maps, JSC calls them Structures.

```javascript
const obj = {};      // Shape S0 (empty)
obj.x = 1;           // Shape S0 → S1 (has x)
obj.y = 2;           // Shape S1 → S2 (has x, y)
```

Objects with properties added in the same order share the same Shape, enabling optimized property access.

Object literals create the final Shape immediately without transitions - most efficient.

However, this only matters for the first Shape creation. From the 2nd object onwards, existing chains are reused. So this rarely causes major issues (especially in hardcoded code where property order is fixed - problems mainly occur when dynamically generating from variable field lists in loops). No need to be overly paranoid.

### Inline Cache (IC)

Caches property access and function call results to skip lookups on subsequent calls.

```javascript
function call(obj) {
  obj.dispose();  // ← IC is set up here
}
```

IC assumes "always the same Shape / same function" and optimizes accordingly.
When different ones arrive, optimization is revoked (Deoptimization).

### Deoptimization (Deopt)

When assumptions made during JIT compilation break, optimized code is discarded and falls back to slow code.

```
Optimization: "This call always invokes function A"
    ↓
Actually function B arrived
    ↓
"wrong call target" → Deopt
    ↓
Try to reoptimize → Different function again → Deopt...
```

-----

## Initial Test (Test 1): Identifying the Cause

First, tested all combinations to identify which conditions contribute to slowness.

#### Test Code

```javascript
const SYM = Symbol("test");
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

// add-later + computed + new function each time
function addLaterComputedNewFn() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}

// add-later + computed + shared function
function addLaterComputedSharedFn() {
  const obj = {};
  obj[SYM] = sharedFn;
  return obj;
}

// add-later + static key + new function each time
function addLaterStaticNewFn() {
  const obj = {};
  obj.dispose = function() {};
  return obj;
}

// add-later + static key + shared function
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

#### Results: Create + Call (100K iterations)

| Pattern | V8 (Node) | JSC (Bun) |
|---|---|---|
| **literal + computed + new fn** | **16.94ms** | **6.38ms** |
| literal + computed + shared fn | 3.09ms | 1.21ms |
| literal + static key + new fn | 1.98ms | 1.73ms |
| literal + static key + shared fn | 1.34ms | 1.17ms |
| add-later + computed + new fn | 3.22ms | 1.40ms |
| add-later + computed + shared fn | 1.67ms | 1.41ms |
| add-later + static key + new fn | 2.89ms | 1.95ms |
| add-later + static key + shared fn | 1.55ms | 1.47ms |
| class | 1.62ms | 1.80ms |

#### Results: Create + Call (10M iterations)

| Pattern | V8 (Node) | JSC (Bun) |
|---|---|---|
| **literal + computed + new fn** | **1,677ms** | **550ms** |
| literal + static key + shared fn | 125ms | 79ms |
| class | 144ms | 90ms |
| **Ratio (vs class)** | **~12x** | **~6x** |

```bash
node benchmarks/bench_patterns.js  # Node.js (V8)
bun benchmarks/bench_patterns.js   # Bun (JSC)
```

→ [bench_patterns.js](benchmarks/bench_patterns.js) / [results](benchmarks/bench_patterns-output.txt)

#### Findings

Only "literal + computed + inline definition" is significantly slow.

Breaking any one condition makes it fast:

- Pass function via variable → fast
- Use add-later pattern → fast
- Use static key → fast
- Use class → fast

-----

## Deep Dive Tests (Tests 2-8)

### Test 2: Does Local Scope Variable Reference Matter?

Testing if referencing local scope variables causes the slowdown.

```javascript
// References local scope variable
function withScopeRef() {
  let state = false;
  return {
    [Symbol.dispose]() { state = true; }
  };
}

// No local scope reference
function withoutScopeRef() {
  return {
    [Symbol.dispose]() {}
  };
}
```

Result: Both equally slow. **Local scope variable reference is NOT the cause**.

```bash
node benchmarks/bench_scope_ref.js  # Node.js (V8)
bun benchmarks/bench_scope_ref.js   # Bun (JSC)
```

→ [bench_scope_ref.js](benchmarks/bench_scope_ref.js) / [results](benchmarks/bench_scope_ref-output.txt)

-----

### Test 3: function / arrow / method Differences

Testing if function syntax matters.

```javascript
// method syntax
{ [SYM]() {} }

// function
{ [SYM]: function() {} }

// arrow
{ [SYM]: () => {} }
```

| Pattern | V8 | JSC |
|---|---|---|
| computed + function | 16.61ms | 6.37ms |
| computed + arrow | 17.31ms | 5.22ms |
| computed + method | 17.33ms | 6.07ms |

```bash
node benchmarks/bench_fn_types.js  # Node.js (V8)
bun benchmarks/bench_fn_types.js   # Bun (JSC)
```

→ [bench_fn_types.js](benchmarks/bench_fn_types.js) / [results](benchmarks/bench_fn_types-output.txt)

Result: All equally slow. **Function syntax is NOT the cause**.

-----

### Test 4: What About Primitive Values?

Testing if non-function values have the same issue.

```javascript
const SYM = Symbol("test");
let counter = 0;

// new number each time
function createWithNewNumber() {
  return { [SYM]: counter++ };
}

// new function each time
function createWithNewFunction() {
  return { [SYM]: function() {} };
}

// access (read only)
let x;
for (let i = 0; i < n; i++) {
  const obj = createFn();
  x = obj[SYM];
}

// call (execute function)
for (let i = 0; i < n; i++) {
  const obj = createFn();
  obj[SYM]();
}
```

| Pattern | V8 (access) | V8 (call) | JSC (access) | JSC (call) |
|---|---|---|---|---|
| new number | 1.36ms | - | 0.96ms | - |
| new function | 16.21ms | 16.05ms | 5.20ms | 5.20ms |

Result: **Only functions are slow** (~12x on V8, ~5x on JSC). Primitives are fine. Access and call are about the same speed.

```bash
node benchmarks/bench_primitive.js  # Node.js (V8)
bun benchmarks/bench_primitive.js   # Bun (JSC)
```

→ [bench_primitive.js](benchmarks/bench_primitive.js) / [results](benchmarks/bench_primitive-output.txt)

-----

### Test 5: Symbol vs Regular String Key

Testing if Symbol keys are specifically slow.

```javascript
const SYM = Symbol("test");
const STR = "dynamicKey";

// Symbol key
function symbolKeyInline() {
  return { [SYM]() {} };
}

// String key
function stringKeyInline() {
  return { [STR]() {} };
}
```

| Pattern | V8 | JSC |
|---|---|---|
| Symbol + inline | 16.37ms | 6.40ms |
| String + inline | 13.72ms | 5.45ms |
| Symbol + shared | 3.26ms | 1.16ms |
| String + shared | 3.23ms | 1.68ms |

```bash
node benchmarks/bench_symbol_vs_string.js  # Node.js (V8)
bun benchmarks/bench_symbol_vs_string.js   # Bun (JSC)
```

→ [bench_symbol_vs_string.js](benchmarks/bench_symbol_vs_string.js) / [results](benchmarks/bench_symbol_vs_string-output.txt)

Result: Both Symbol and String are equally slow (when inline). **Key type is NOT the cause**.

-----

### Test 6: Profiler Deep Dive

Examined why it's slow using V8 and JSC profilers.

#### deopt trace (V8)

Used V8's trace options to confirm Deoptimization.

```bash
node --trace-opt --trace-deopt benchmarks/bench_patterns.js
```

Output (excerpt):
```
# On call
[bailout (kind: deopt-eager, reason: wrong call target): ...]

# On access and call
[bailout (kind: deopt-eager, reason: Insufficient type feedback for call): ...]
```

Since new function objects are created each time, JIT optimizes but then a different function arrives causing Deopt. This repetition causes significant slowdown.

- `wrong call target` (call target differs from expected): on function call
- `Insufficient type feedback for call` (insufficient type feedback): on function value access/call

These Deopts don't occur with primitive values (confirmed with `node --trace-opt --trace-deopt benchmarks/bench_primitive.js`). Only function values cause type information instability at object creation time, hindering optimization.

#### CPU Profile (V8/JSC)

CPU profiling on both engines to see which functions consume CPU time.

```bash
node --cpu-prof benchmarks/bench_patterns.js  # V8
bun run --cpu-prof benchmarks/bench_patterns.js  # JSC
```

Checked `hitCount` (how often the profiler sampled "currently executing this function") from generated `.cpuprofile`. Higher hitCount means more CPU time consumed.

**V8 (Node.js)**

| Function | hitCount | Percentage |
|---|---|---|
| `literalComputedNewFn` | **1193** | **52.5%** |
| (garbage collector) | 138 | 6.1% |
| `addLaterStaticNewFn` | 31 | 1.4% |
| `literalStaticNewFn` | 30 | 1.3% |
| Other | - | - |

※Total time: ~2.9s, total samples: ~2300

**JSC (Bun)**

| Function | Line | hitCount | Percentage |
|---|---|---|---|
| `literalComputedNewFn` | 13 | **403** | **38.6%** |
| `literalStaticNewFn` | 22 | 44 | 4.2% |
| `addLaterComputedNewFn` | 32 | 30 | 2.9% |
| `addLaterStaticNewFn` | 44 | 30 | 2.9% |
| Other | - | - | - |

※Total time: ~1.4s, total samples: ~1050

Both engines show `literalComputedNewFn` as the outlier. V8 at 52.5%, JSC at 38.6%. V8 has higher percentage, suggesting larger deopt penalty.
Also, V8 shows GC at 6.1%, confirming GC overhead from creating new function objects each time.

#### Line-level Confirmation (JSC)

JSC's profiler reports at line-number level.
So to identify which line in `literalComputedNewFn` is the hotspot, reformatted from single-line `return { [SYM]() {} }` to multiple lines.

```javascript
function literalComputedNewFn() {
  const obj = {      // line 12
    [SYM]() {}       // line 13 ← 38.6% of entire benchmark - the hotspot!
  };                 // line 14
  return obj;        // line 15
}
```

Result: Not line 12 `const obj = {` or line 15 `return obj;`, but **line 13 `[SYM]() {}` is the hotspot**.
This exactly matches the original X post reporting "`[Symbol.dispose]()` line at 135.5ms".

```bash
# V8 profile generation & analysis
node --cpu-prof --cpu-prof-name=benchmarks/bench_patterns-v8.cpuprofile benchmarks/bench_patterns.js
node benchmarks/analyze_profile.js benchmarks/bench_patterns-v8.cpuprofile

# JSC profile generation & analysis
bun run --cpu-prof --cpu-prof-name=benchmarks/bench_patterns-jsc.cpuprofile benchmarks/bench_patterns.js
node benchmarks/analyze_profile.js benchmarks/bench_patterns-jsc.cpuprofile
```

→ [analyze_profile.js](benchmarks/analyze_profile.js) / [V8 profile](benchmarks/bench_patterns-v8.cpuprofile) / [V8 analysis](benchmarks/bench_patterns-v8-profile-analysis.txt) / [JSC profile](benchmarks/bench_patterns-jsc.cpuprofile) / [JSC analysis](benchmarks/bench_patterns-jsc-profile-analysis.txt)

-----

### Test 7: Function Definition and Passing Patterns

Test 1 showed "shared function (sharedFn) is fast". But does the function object need to be identical? Even `const fn = () => {}` in local scope was fast. So identical object isn't required. Examined this more closely.

#### Test Patterns

```javascript
const SYM = Symbol("test");
const sharedFn = function() {};

// 1. Method definition syntax (slow)
function methodDefinition() {
  return { [SYM]() {} };
}

// 2. Inline definition in literal (slow)
function propertyInline() {
  return { [SYM]: function() {} };
}

// 3. Via local variable (fast)
function propertyLocal() {
  const fn = () => {};
  return { [SYM]: fn };
}

// 4. Module scope shared (fast)
function propertyShared() {
  return { [SYM]: sharedFn };
}

// 5. Add-later (fast)
function addLater() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}
```

#### Results (100K iterations)

| Pattern | V8 | JSC |
|---|---|---|
| `{ [SYM]() {} }` method definition | 17.14ms | 6.64ms |
| `{ [SYM]: function(){} }` inline | 17.27ms | 6.08ms |
| `const fn=...; { [SYM]: fn }` local variable | 3.65ms | 1.34ms |
| `{ [SYM]: sharedFn }` module shared | 3.09ms | 1.68ms |
| `obj[SYM] = function(){}` add-later | 2.73ms | 2.08ms |

#### Findings

- **Method definition syntax doesn't matter** (1 and 2 are about the same)
- **"Defining function directly in literal" is the cause**
- **Passing via variable is fast** (local or module scope)
- **Add-later is also fast**

```bash
node benchmarks/bench_method_vs_property.js  # Node.js (V8)
bun benchmarks/bench_method_vs_property.js   # Bun (JSC)
```

→ [bench_method_vs_property.js](benchmarks/bench_method_vs_property.js) / [results](benchmarks/bench_method_vs_property-output.txt)

-----

### Test 8 (Additional): Does `using` Syntax Matter?

Different angle from previous tests, but curious about the `[Symbol.dispose]` built-in symbol. This is for the relatively new `using` syntax. Could there be something in this mechanism causing slowness?

#### Background: `using` Syntax

`using` syntax was added in ES2024 for resource management. `[Symbol.dispose]()` is automatically called when leaving scope.

```javascript
{
  using lock = createLock();
  // lock[Symbol.dispose]() is automatically called on scope exit
}
```

#### Test

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

| Pattern | Node (literal) | Node (class) | Bun (literal) | Bun (class) |
|---|---|---|---|---|
| using | 25.7ms | 10.3ms | 7.68ms | 2.58ms |
| try-finally | 15.3ms | 52μs | 4.95ms | 33μs |
| simple | 15.5ms | 52μs | 4.63ms | 33μs |

```bash
node benchmarks/bench_jsc_using.js  # Node.js (V8)
bun benchmarks/bench_jsc_using.js   # Bun (JSC)
```

→ [bench_jsc_using.js](benchmarks/bench_jsc_using.js) / [results](benchmarks/bench_using-output.txt)

Result: **`using` syntax doesn't matter much**. The cause is object creation pattern, not syntax.

-----

## Summary of Test Results

### Condition Combination Evaluation

| Creation | Key | Value | Key Value | Result | Test |
|---|---|---|---|---|---|
| **literal** | **computed** | **function (inline)** | **Symbol** | 🔥 **slow** | Test 1,6 |
| **literal** | **computed** | **function (inline)** | **string** | 🔥 **slow** | Test 1,6 |
| literal | computed | function (via variable) | Symbol | ✅ fast | Test 7 |
| literal | computed | function (via variable) | string | ✅ fast | Test 7 |
| literal | computed | primitive | Symbol | ✅ fast | Test 4 |
| literal | computed | primitive | string | ✅ fast | Test 4 |
| literal | static | function (inline) | - | ✅ fast | Test 1 |
| literal | static | function (via variable) | - | ✅ fast | Test 1 |
| add-later | computed | function (inline) | Symbol | ✅ fast | Test 1 |
| add-later | computed | function (inline) | string | ✅ fast | Test 1 |
| add-later | computed | function (via variable) | Symbol | ✅ fast | Test 1 |
| add-later | computed | function (via variable) | string | ✅ fast | Test 1 |
| add-later | static | function (inline) | - | ✅ fast | Test 1 |
| add-later | static | function (via variable) | - | ✅ fast | Test 1 |
| class | - | - | - | ✅ fast | Test 1 |

### Conclusion

From the above evaluation, 🔥 slow patterns share **"literal + computed + inline function definition"**.

These conditions do NOT affect the result:
- Key value (Symbol / string) (Test 1,5)
- Function type (function / arrow / method) (Test 3)
- Scope variable reference (Test 2)

Essentially, these **3 conditions** together cause slowness:
- **In object literal** (in literal)
- **For computed property** (for computed key)
- **Define function inline** (inline function definition)

-----

## Why Only This Combination Is Slow

When 3 conditions are met, V8 / JSC optimization paths are bypassed.

Why other patterns are fast:
- **Add-later**: Creates static Shape first, then adds via known transition - optimization works
- **Static key**: Shape can be determined at literal parse time - optimization works
- **Via local variable**: Function definition is outside literal - optimization works
- **Module scope shared**: Call target is always the same - IC is stable
- **class**: Same function shared on prototype - Shape and IC are stable

For "literal + computed + inline function definition":
1. Cannot determine Shape at literal parse time due to computed property
2. New function object created each time
3. `wrong call target` Deopt on each call
4. Optimize → Deopt → Reoptimize cycle

<details>
<summary>Internal Mechanism Speculation (Thought Experiment)</summary>

This is speculation, but fits the observed results.

**When 3 conditions are met (slow)**:
```
1st: {staticKeys, [Symbol.dispose]: dynfn1} → Shape S0 created (no cache)
2nd: {staticKeys, [Symbol.dispose]: dynfn2} → Shape S0' created (no cache)
3rd: {staticKeys, [Symbol.dispose]: dynfn3} → Shape S0'' created (no cache)
...
```
- New Shape created each time, cache doesn't work
- wrong call target Deopt on each call, IC doesn't work
- Shapes grow infinitely, GC overhead increases
- → **Triple penalty**

**Add-later + computed + inline (fast)**:
```
1st: {staticKeys} → Shape S0 (no cache), S0 + [Symbol.dispose] → Shape S1 (no cache)
2nd: {staticKeys} → Shape S0 (cached), S0 + [Symbol.dispose] → Shape S1 (cached)
```
- Literal part Shape S0 reused from cache on 2nd+
- transition (S0 → S1) is also cached

**Literal + computed + via variable (fast)**:
```
1st: {staticKeys, [Symbol.dispose]: fn} → Shape S0 (no cache)
2nd: {staticKeys, [Symbol.dispose]: fn} → Shape S0 (cached)
```
- Same function object reference allows Shape caching

**Literal + static + inline (fast)**:
```
1st: {staticKeys, staticFnKey: dynfn1} → Shape S0 (no cache)
2nd: {staticKeys, staticFnKey: dynfn2} → Shape S0 (cached)
```
- Fixed key structure allows Shape caching

The truth requires reading V8 / JSC source. If anyone from inside is reading, please let us know.

</details>

-----

## Solutions

```javascript
// ❌ Slow
function createLock() {
  return {
    [Symbol.dispose]() { ... }
  };
}

// ✅ Fast: Define function in local scope
function createLock() {
  const release = () => { ... };
  return { release, [Symbol.dispose]: release };
}

// ✅ Fast: Define at module level
const dispose = function() { this.release(); };
function createLock() {
  return { release() { ... }, [Symbol.dispose]: dispose };
}

// ✅ Fast: Add-later
function createLock() {
  const obj = {};
  obj[Symbol.dispose] = () => { ... };
  return obj;
}

// ✅ Fast: class
class Lock {
  [Symbol.dispose]() { ... }
}
```

**Add-later** and **via variable** are simple rewrites that could easily be auto-detected and fixed by ESLint rules. **class** requires larger refactoring. Both patterns are fast, so choose based on ease of implementation.

Between the two simple fixes, **via variable** (pre-defining the function) is likely more efficient as it avoids extra Shape transitions that add-later would cause. Similar transformations could potentially be incorporated into V8 / JSC optimization passes.

-----

## Appendix: Object Construction Best Practices

Based on these findings, summary of transition chain considerations for object construction.

### Basic: Literal One-Shot Is Best

```javascript
// Optimal: no transitions
const obj = { a: 1, b: 2, c: 3 };

// Acceptable: transitions occur, but cached for same patterns
const obj = {};
obj.a = 1;
obj.b = 2;
obj.c = 3;
```

The latter transitions Shape on each property addition, but this only matters for initial Shape creation. From 2nd object onwards, existing chains are reused, so not a major issue even for mass creation.

### Exception: Use Add-Later for Computed Properties

However, computed properties change things.

```javascript
// ❌ Avoid: computed property + function definition in literal
function create() {
  return {
    staticMethod() { ... },     // static key in literal is OK
    [Symbol.dispose]() { ... }  // THIS is the problem
  };
}

// ✅ Recommended: Static in literal, dynamic add-later
function create() {
  const obj = { staticMethod() { ... } };    // static key in literal is OK
  obj[Symbol.dispose] = function() { ... };  // dynamic key add-later
  return obj;
}

// ✅ Recommended: Static in literal, pre-define function for dynamic
function create() {
  const dispose = function() { ... };  // pre-define function for dynamic key
  return {
    staticMethod() { ... },   // static key in literal is OK
    [Symbol.dispose]: dispose // passing pre-defined function is OK
  }
}
```

When computed property value is a function object, current V8 / JSC optimization has significant performance degradation with "literal + computed + inline function definition". Avoid this combination.

### Summary

| Situation | Recommendation |
|---|---|
| Static properties only | Literal one-shot |
| Computed property (non-function value) | Literal one-shot is fine |
| Computed property (function value) | Add-later or via variable (easy), class (requires refactor) |

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
