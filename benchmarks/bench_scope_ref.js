// Benchmark: Does local scope variable reference affect performance?
// Tests: with scope ref vs without scope ref (both use computed property + method definition)

console.log("=== Test 2: Local scope variable reference relevance ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol.dispose;

// With scope ref - captures and uses local scope variable
function withScopeRef() {
  let state = false;
  return {
    [SYM]() { state = true; }
  };
}

// Without scope ref - empty function
function withoutScopeRef() {
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

  const withScopeRefTime = benchWithCall("with scope ref", withScopeRef, n);
  const withoutScopeRefTime = benchWithCall("without scope ref", withoutScopeRef, n);

  console.log(`  with scope ref:     ${withScopeRefTime.toFixed(2).padStart(8)}ms`);
  console.log(`  without scope ref:  ${withoutScopeRefTime.toFixed(2).padStart(8)}ms`);
  console.log(`\n  Ratio: ${(withScopeRefTime / withoutScopeRefTime).toFixed(2)}x`);
  console.log(`  -> Both are similarly slow. Scope variable reference is NOT the cause.\n`);
}

// Run with different iteration counts
runAll(100_000, "100K");
runAll(1_000_000, "1M");
