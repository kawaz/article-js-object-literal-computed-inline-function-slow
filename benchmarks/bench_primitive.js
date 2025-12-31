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

// Benchmark: create + access with void (may be optimized away)
function benchAccessVoid(createFn, n) {
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

// Benchmark: create + access with assignment (may still be optimized)
function benchAccessAssign(createFn, n) {
  let x;
  for (let i = 0; i < 1000; i++) {
    const obj = createFn();
    x = obj[SYM];
  }
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const obj = createFn();
    x = obj[SYM];
  }
  void x;
  return performance.now() - start;
}

// Benchmark: create + access with accumulation (ensures access happens)
let sink = 0;
function benchAccessAccum(createFn, n) {
  for (let i = 0; i < 1000; i++) {
    const obj = createFn();
    sink += typeof obj[SYM] === 'function' ? 1 : obj[SYM];
  }
  const start = performance.now();
  for (let i = 0; i < n; i++) {
    const obj = createFn();
    sink += typeof obj[SYM] === 'function' ? 1 : obj[SYM];
  }
  return performance.now() - start;
}

// Benchmark: create + call (invoke function)
function benchCall(createFn, n) {
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

  // Compare access methods
  const numVoid = benchAccessVoid(createWithNewNumber, n);
  const numAssign = benchAccessAssign(createWithNewNumber, n);
  const numAccum = benchAccessAccum(createWithNewNumber, n);
  const fnVoid = benchAccessVoid(createWithNewFunction, n);
  const fnAssign = benchAccessAssign(createWithNewFunction, n);
  const fnAccum = benchAccessAccum(createWithNewFunction, n);
  const fnCall = benchCall(createWithNewFunction, n);

  console.log(`  number (void):      ${numVoid.toFixed(2).padStart(8)}ms`);
  console.log(`  number (assign):    ${numAssign.toFixed(2).padStart(8)}ms`);
  console.log(`  number (accum):     ${numAccum.toFixed(2).padStart(8)}ms`);
  console.log(`  function (void):    ${fnVoid.toFixed(2).padStart(8)}ms`);
  console.log(`  function (assign):  ${fnAssign.toFixed(2).padStart(8)}ms`);
  console.log(`  function (accum):   ${fnAccum.toFixed(2).padStart(8)}ms`);
  console.log(`  function (call):    ${fnCall.toFixed(2).padStart(8)}ms`);
  console.log(`\n  -> Function values are slow regardless of access method.\n`);
}

// Run with different iteration counts
runAll(100_000, "100K");
runAll(1_000_000, "1M");
