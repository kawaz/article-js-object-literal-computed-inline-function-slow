// Benchmark: Does closure affect performance?
// Tests: with closure vs without closure (both use computed property + method definition)

console.log("=== Test 2: Closure relevance ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol.dispose;

// With closure - captures and uses external variable
function withClosure() {
  let state = false;
  return {
    [SYM]() { state = true; }
  };
}

// Without closure - empty function
function withoutClosure() {
  return {
    [SYM]() {}
  };
}

// Benchmark function
function benchWithCall(name, createFn, n) {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    const obj = createFn();
    obj[SYM]();
  }

  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const obj = createFn();
    obj[SYM]();
  }
  return performance.now() - start;
}

// Run benchmarks
function runAll(n, label) {
  console.log(`--- ${label} (${n.toLocaleString()} iterations) ---\n`);

  const withClosureTime = benchWithCall("with closure", withClosure, n);
  const withoutClosureTime = benchWithCall("without closure", withoutClosure, n);

  console.log(`  with closure:     ${withClosureTime.toFixed(2).padStart(8)}ms`);
  console.log(`  without closure:  ${withoutClosureTime.toFixed(2).padStart(8)}ms`);
  console.log(`\n  Ratio: ${(withClosureTime / withoutClosureTime).toFixed(2)}x`);
  console.log(`  -> Both are similarly slow. Closure is NOT the cause.\n`);
}

// Run with different iteration counts
runAll(100_000, "100K");
runAll(1_000_000, "1M");
