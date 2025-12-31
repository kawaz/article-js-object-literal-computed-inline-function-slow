// Benchmark: Is the issue specific to function values?
// Tests: primitive value vs function value with computed property

console.log("=== Test 4: Primitive vs Function values ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol("test");
let counter = 0;

// New number each time
function createWithNewNumber() {
  return { [SYM]: counter++ };
}

// New function each time
function createWithNewFunction() {
  return { [SYM]: function() {} };
}

// Benchmark: create + access (read property)
function benchAccess(name, createFn, n) {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    const obj = createFn();
    void obj[SYM];
  }

  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const obj = createFn();
    void obj[SYM];
  }
  return performance.now() - start;
}

// Benchmark: create + call (invoke function)
function benchCall(name, createFn, n) {
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

  const numAccess = benchAccess("number access", createWithNewNumber, n);
  const fnAccess = benchAccess("function access", createWithNewFunction, n);
  const fnCall = benchCall("function call", createWithNewFunction, n);

  console.log(`  new number (access):    ${numAccess.toFixed(2).padStart(8)}ms`);
  console.log(`  new function (access):  ${fnAccess.toFixed(2).padStart(8)}ms`);
  console.log(`  new function (call):    ${fnCall.toFixed(2).padStart(8)}ms`);
  console.log(`\n  -> Function values are slow. Calling makes it even slower.\n`);
}

// Run with different iteration counts
runAll(100_000, "100K");
runAll(1_000_000, "1M");
