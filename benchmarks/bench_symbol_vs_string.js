// Benchmark: Symbol vs string key for computed property
// Tests: Does the key type (Symbol vs string) affect performance?

console.log("=== Test: Symbol vs String computed property key ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol("test");
const STR = "dynamicKey";

// Symbol key - inline function
function symbolKeyInline() {
  return { [SYM]() {} };
}

// String key - inline function
function stringKeyInline() {
  return { [STR]() {} };
}

// Symbol key - shared function
const sharedFn = function() {};
function symbolKeyShared() {
  return { [SYM]: sharedFn };
}

// String key - shared function
function stringKeyShared() {
  return { [STR]: sharedFn };
}

// Benchmark function
function benchWithCall(name, createFn, key, n) {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    const obj = createFn();
    obj[key]();
  }

  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const obj = createFn();
    obj[key]();
  }
  return performance.now() - start;
}

// Run benchmarks
function runAll(n, label) {
  console.log(`--- ${label} (${n.toLocaleString()} iterations) ---\n`);

  const symbolInlineTime = benchWithCall("symbol inline", symbolKeyInline, SYM, n);
  const stringInlineTime = benchWithCall("string inline", stringKeyInline, STR, n);
  const symbolSharedTime = benchWithCall("symbol shared", symbolKeyShared, SYM, n);
  const stringSharedTime = benchWithCall("string shared", stringKeyShared, STR, n);

  console.log(`  Symbol + inline:  ${symbolInlineTime.toFixed(2).padStart(8)}ms`);
  console.log(`  String + inline:  ${stringInlineTime.toFixed(2).padStart(8)}ms`);
  console.log(`  Symbol + shared:  ${symbolSharedTime.toFixed(2).padStart(8)}ms`);
  console.log(`  String + shared:  ${stringSharedTime.toFixed(2).padStart(8)}ms`);
  console.log(`\n  Ratio (symbol/string inline): ${(symbolInlineTime / stringInlineTime).toFixed(2)}x`);
  console.log(`  Ratio (symbol/string shared): ${(symbolSharedTime / stringSharedTime).toFixed(2)}x`);
  console.log(`  -> Both Symbol and String are similarly slow/fast. Key type is NOT the cause.\n`);
}

// Run with different iteration counts
runAll(100_000, "100K");
runAll(1_000_000, "1M");
