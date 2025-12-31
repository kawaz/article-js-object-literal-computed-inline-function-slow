// Benchmark: All combinations of object creation patterns
// Tests: literal vs add-later vs class, computed vs static key, new fn vs shared fn

console.log("=== Test 1: Object creation pattern combinations ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol("dispose");
const sharedFn = function() {};

// Pattern functions
function literalComputedNewFn() {
  return { [SYM]() {} };
}

function literalComputedSharedFn() {
  return { [SYM]: sharedFn };
}

function literalStaticNewFn() {
  return { dispose() {} };
}

function literalStaticSharedFn() {
  return { dispose: sharedFn };
}

function addLaterComputedNewFn() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}

function addLaterComputedSharedFn() {
  const obj = {};
  obj[SYM] = sharedFn;
  return obj;
}

function addLaterStaticNewFn() {
  const obj = {};
  obj.dispose = function() {};
  return obj;
}

function addLaterStaticSharedFn() {
  const obj = {};
  obj.dispose = sharedFn;
  return obj;
}

class WithClass {
  [SYM]() {}
}

// Benchmark functions
function bench(name, fn, n) {
  // Warmup
  for (let i = 0; i < 1000; i++) fn();

  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  return performance.now() - start;
}

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
  console.log(`\n--- ${label} (${n.toLocaleString()} iterations) ---\n`);

  const results = [
    { name: "literal + computed + new fn", time: benchWithCall("", literalComputedNewFn, SYM, n) },
    { name: "literal + computed + shared fn", time: benchWithCall("", literalComputedSharedFn, SYM, n) },
    { name: "literal + static + new fn", time: benchWithCall("", literalStaticNewFn, "dispose", n) },
    { name: "literal + static + shared fn", time: benchWithCall("", literalStaticSharedFn, "dispose", n) },
    { name: "add-later + computed + new fn", time: benchWithCall("", addLaterComputedNewFn, SYM, n) },
    { name: "add-later + computed + shared fn", time: benchWithCall("", addLaterComputedSharedFn, SYM, n) },
    { name: "add-later + static + new fn", time: benchWithCall("", addLaterStaticNewFn, "dispose", n) },
    { name: "add-later + static + shared fn", time: benchWithCall("", addLaterStaticSharedFn, "dispose", n) },
    { name: "class", time: benchWithCall("", () => new WithClass(), SYM, n) },
  ];

  // Print results
  for (const r of results) {
    const marker = r.name === "literal + computed + new fn" ? "**" : "  ";
    console.log(`${marker}${r.name.padEnd(35)} ${r.time.toFixed(0).padStart(6)}ms`);
  }

  // Calculate ratio
  const slowest = results.find(r => r.name === "literal + computed + new fn").time;
  const classTime = results.find(r => r.name === "class").time;
  console.log(`\n  Ratio (literal+computed+newFn / class): ${(slowest / classTime).toFixed(1)}x`);
}

// Run with different iteration counts
runAll(100_000, "100K");
runAll(10_000_000, "10M");
