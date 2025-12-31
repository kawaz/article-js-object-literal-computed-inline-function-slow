// Deep dive into JSC (Bun) behavior that differs from V8

console.log("=== JSC-specific behavior deep dive ===\n");

const SYM = Symbol("test");

// ========================================
// Test 3: function / arrow / method differences
// V8 shows little difference, JSC shows variance
// ========================================

console.log("=== Test 3 reproduction: function vs arrow vs method ===\n");

function bench(name, fn, iterations = 100000) {
  for (let i = 0; i < 1000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return performance.now() - start;
}

function benchCreateAndCall(name, createFn, callKey, iterations = 100000) {
  for (let i = 0; i < 1000; i++) {
    const obj = createFn();
    obj[callKey]();
  }
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const obj = createFn();
    obj[callKey]();
  }
  return performance.now() - start;
}

// Creation only
console.log("[Creation cost only]");
const r1 = bench("computed + function", () => ({ [SYM]: function() {} }));
const r2 = bench("computed + arrow", () => ({ [SYM]: () => {} }));
const r3 = bench("computed + method", () => ({ [SYM]() {} }));
console.log(`  function: ${r1.toFixed(2)}ms`);
console.log(`  arrow:    ${r2.toFixed(2)}ms`);
console.log(`  method:   ${r3.toFixed(2)}ms`);

// Creation + call
console.log("\n[Creation + call]");
const c1 = benchCreateAndCall("", () => ({ [SYM]: function() {} }), SYM);
const c2 = benchCreateAndCall("", () => ({ [SYM]: () => {} }), SYM);
const c3 = benchCreateAndCall("", () => ({ [SYM]() {} }), SYM);
console.log(`  function: ${c1.toFixed(2)}ms`);
console.log(`  arrow:    ${c2.toFixed(2)}ms`);
console.log(`  method:   ${c3.toFixed(2)}ms`);

// ========================================
// Test 8: using vs try-finally vs simple
// V8 shows little difference, JSC (Bun) shows class + using is mysteriously slow
// ========================================

console.log("\n\n=== Test 8 reproduction: using vs try-finally ===\n");

class Lock {
  [SYM]() {}
}

function createLiteral() {
  return { [SYM]() {} };
}

// Check if using syntax is supported
const hasUsing = (() => {
  try {
    eval('{ using x = { [Symbol.dispose]() {} }; }');
    return true;
  } catch { return false; }
})();

console.log(`using syntax support: ${hasUsing}`);

if (hasUsing) {
  // using syntax
  const usingLiteral = new Function('createFn', 'SYM', `
    return function(iterations) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        using obj = createFn();
      }
      return performance.now() - start;
    };
  `)(createLiteral, SYM);

  const usingClass = new Function('Lock', 'SYM', `
    return function(iterations) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        using obj = new Lock();
      }
      return performance.now() - start;
    };
  `)(Lock, SYM);

  // try-finally
  function tryFinallyLiteral(iterations) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const obj = createLiteral();
      try {} finally { obj[SYM](); }
    }
    return performance.now() - start;
  }

  function tryFinallyClass(iterations) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const obj = new Lock();
      try {} finally { obj[SYM](); }
    }
    return performance.now() - start;
  }

  // simple loop
  function simpleLiteral(iterations) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const obj = createLiteral();
      obj[SYM]();
    }
    return performance.now() - start;
  }

  function simpleClass(iterations) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const obj = new Lock();
      obj[SYM]();
    }
    return performance.now() - start;
  }

  const N = 100000;

  // Warmup
  usingLiteral(1000);
  usingClass(1000);
  tryFinallyLiteral(1000);
  tryFinallyClass(1000);
  simpleLiteral(1000);
  simpleClass(1000);

  console.log("\n[literal (computed + method)]");
  console.log(`  using:       ${usingLiteral(N).toFixed(2)}ms`);
  console.log(`  try-finally: ${tryFinallyLiteral(N).toFixed(2)}ms`);
  console.log(`  simple:      ${simpleLiteral(N).toFixed(2)}ms`);

  console.log("\n[class]");
  console.log(`  using:       ${usingClass(N).toFixed(2)}ms`);
  console.log(`  try-finally: ${tryFinallyClass(N).toFixed(2)}ms`);
  console.log(`  simple:      ${simpleClass(N).toFixed(2)}ms`);

  // Multiple runs for stability check
  console.log("\n\n=== Multiple runs for stability check ===\n");

  console.log("class + using (5 runs):");
  for (let run = 0; run < 5; run++) {
    console.log(`  Run ${run + 1}: ${usingClass(N).toFixed(2)}ms`);
  }

  console.log("\nclass + simple (5 runs):");
  for (let run = 0; run < 5; run++) {
    console.log(`  Run ${run + 1}: ${simpleClass(N).toFixed(2)}ms`);
  }
}

// ========================================
// Additional: Exploring internal differences in method definition
// ========================================

console.log("\n\n=== Additional: Exploring method syntax internals ===\n");

// Check differences between method and function
const objMethod = { foo() {} };
const objFunction = { foo: function() {} };
const objArrow = { foo: () => {} };
const objNamed = { foo: function foo() {} };

console.log("Function toString():");
console.log(`  method:   ${objMethod.foo.toString().slice(0, 30)}...`);
console.log(`  function: ${objFunction.foo.toString().slice(0, 30)}...`);
console.log(`  arrow:    ${objArrow.foo.toString().slice(0, 30)}...`);
console.log(`  named:    ${objNamed.foo.toString().slice(0, 30)}...`);

console.log("\nFunction name property:");
console.log(`  method:   "${objMethod.foo.name}"`);
console.log(`  function: "${objFunction.foo.name}"`);
console.log(`  arrow:    "${objArrow.foo.name}"`);
console.log(`  named:    "${objNamed.foo.name}"`);

console.log("\nFunction prototype:");
console.log(`  method:   ${objMethod.foo.prototype}`);
console.log(`  function: ${objFunction.foo.prototype}`);
console.log(`  arrow:    ${objArrow.foo.prototype}`);

// Does prototype presence affect performance?
console.log("\n\n=== Prototype presence and performance ===\n");

const r4 = bench("arrow (no prototype)", () => ({ [SYM]: () => {} }));
const r5 = bench("function (has prototype)", () => ({ [SYM]: function() {} }));
const r6 = bench("method (no prototype)", () => ({ [SYM]() {} }));

console.log(`  arrow (no prototype):      ${r4.toFixed(2)}ms`);
console.log(`  function (has prototype):  ${r5.toFixed(2)}ms`);
console.log(`  method (no prototype):     ${r6.toFixed(2)}ms`);

// Same trend with static keys?
console.log("\n[static key]");
const s1 = bench("static + function", () => ({ foo: function() {} }));
const s2 = bench("static + arrow", () => ({ foo: () => {} }));
const s3 = bench("static + method", () => ({ foo() {} }));
console.log(`  function: ${s1.toFixed(2)}ms`);
console.log(`  arrow:    ${s2.toFixed(2)}ms`);
console.log(`  method:   ${s3.toFixed(2)}ms`);
