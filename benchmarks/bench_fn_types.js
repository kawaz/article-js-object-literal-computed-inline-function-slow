// Detailed comparison of function vs arrow vs method in JSC

console.log("=== function vs arrow vs method detailed comparison ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol("test");
const N = 100000;

function bench(name, fn) {
  // Warmup
  for (let i = 0; i < 1000; i++) fn();

  const start = performance.now();
  for (let i = 0; i < N; i++) fn();
  return performance.now() - start;
}

function benchCall(name, createFn, key) {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    const obj = createFn();
    obj[key]();
  }

  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = createFn();
    obj[key]();
  }
  return performance.now() - start;
}

// ========================================
// Creation cost only
// ========================================

console.log("=== Creation cost only ===\n");

console.log("[computed key (Symbol)]");
const c1 = bench("", () => ({ [SYM]: function() {} }));
const c2 = bench("", () => ({ [SYM]: () => {} }));
const c3 = bench("", () => ({ [SYM]() {} }));
console.log(`  function: ${c1.toFixed(2)}ms`);
console.log(`  arrow:    ${c2.toFixed(2)}ms`);
console.log(`  method:   ${c3.toFixed(2)}ms`);

console.log("\n[static key]");
const s1 = bench("", () => ({ foo: function() {} }));
const s2 = bench("", () => ({ foo: () => {} }));
const s3 = bench("", () => ({ foo() {} }));
console.log(`  function: ${s1.toFixed(2)}ms`);
console.log(`  arrow:    ${s2.toFixed(2)}ms`);
console.log(`  method:   ${s3.toFixed(2)}ms`);

// ========================================
// Creation + call cost
// ========================================

console.log("\n\n=== Creation + call cost ===\n");

console.log("[computed key (Symbol)]");
const cc1 = benchCall("", () => ({ [SYM]: function() {} }), SYM);
const cc2 = benchCall("", () => ({ [SYM]: () => {} }), SYM);
const cc3 = benchCall("", () => ({ [SYM]() {} }), SYM);
console.log(`  function: ${cc1.toFixed(2)}ms`);
console.log(`  arrow:    ${cc2.toFixed(2)}ms`);
console.log(`  method:   ${cc3.toFixed(2)}ms`);

console.log("\n[static key]");
const sc1 = benchCall("", () => ({ foo: function() {} }), 'foo');
const sc2 = benchCall("", () => ({ foo: () => {} }), 'foo');
const sc3 = benchCall("", () => ({ foo() {} }), 'foo');
console.log(`  function: ${sc1.toFixed(2)}ms`);
console.log(`  arrow:    ${sc2.toFixed(2)}ms`);
console.log(`  method:   ${sc3.toFixed(2)}ms`);

// ========================================
// Exploring function characteristics
// ========================================

console.log("\n\n=== Function characteristics ===\n");

// Presence of prototype
const objF = { [SYM]: function() {} };
const objA = { [SYM]: () => {} };
const objM = { [SYM]() {} };

console.log("Has prototype:");
console.log(`  function: ${objF[SYM].prototype !== undefined}`);
console.log(`  arrow:    ${objA[SYM].prototype !== undefined}`);
console.log(`  method:   ${objM[SYM].prototype !== undefined}`);

// Can be used as constructor
console.log("\nCan be used as constructor:");
try {
  new objF[SYM]();
  console.log("  function: true");
} catch { console.log("  function: false"); }
try {
  new objA[SYM]();
  console.log("  arrow:    true");
} catch { console.log("  arrow:    false"); }
try {
  new objM[SYM]();
  console.log("  method:   true");
} catch { console.log("  method:   false"); }

// ========================================
// Impact of prototype creation cost?
// ========================================

console.log("\n\n=== Prototype creation cost ===\n");

// Mass creation of functions with prototype
const pf1 = bench("function (has prototype)", () => {
  return function() {};
});

// Mass creation of arrows without prototype
const pf2 = bench("arrow (no prototype)", () => {
  return () => {};
});

console.log(`  function (has prototype): ${pf1.toFixed(2)}ms`);
console.log(`  arrow (no prototype):     ${pf2.toFixed(2)}ms`);
console.log(`  difference: ${(pf1 - pf2).toFixed(2)}ms`);

// ========================================
// Impact of this binding?
// ========================================

console.log("\n\n=== this binding ===\n");

// Arrow captures this
const outer = {
  value: 42,
  createArrow() {
    return { [SYM]: () => this.value };
  },
  createMethod() {
    const self = this;
    return { [SYM]() { return self.value; } };
  },
  createFunction() {
    const self = this;
    return { [SYM]: function() { return self.value; } };
  }
};

const ta = bench("arrow (this capture)", () => outer.createArrow());
const tm = bench("method (closure)", () => outer.createMethod());
const tf = bench("function (closure)", () => outer.createFunction());

console.log(`  arrow (this capture): ${ta.toFixed(2)}ms`);
console.log(`  method (closure):     ${tm.toFixed(2)}ms`);
console.log(`  function (closure):   ${tf.toFixed(2)}ms`);

// ========================================
// Multiple runs for stability check
// ========================================

console.log("\n\n=== Multiple runs (3-run average) ===\n");

function avgBench(name, fn, runs = 3) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(bench("", fn));
  }
  return results.reduce((a, b) => a + b, 0) / runs;
}

console.log("[computed key creation cost]");
console.log(`  function: ${avgBench("", () => ({ [SYM]: function() {} })).toFixed(2)}ms`);
console.log(`  arrow:    ${avgBench("", () => ({ [SYM]: () => {} })).toFixed(2)}ms`);
console.log(`  method:   ${avgBench("", () => ({ [SYM]() {} })).toFixed(2)}ms`);
