// Benchmark: Method definition syntax vs Property assignment
// Clarify if the slowness is due to "method definition syntax" or "new function each time"

console.log("=== Method definition vs Property assignment ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol("test");
const sharedFn = function() {};

// Pattern 1: Method definition syntax (slow pattern from Test 1)
function methodDefinition() {
  return { [SYM]() {} };
}

// Pattern 2: Property assignment with inline function (NEW - untested)
function propertyAssignInline() {
  return { [SYM]: function() {} };
}

// Pattern 3: Property assignment with local variable (factory-scoped)
function propertyAssignLocal() {
  const fn = () => {};
  return { [SYM]: fn };
}

// Pattern 4: Property assignment with shared function (module-scoped)
function propertyAssignShared() {
  return { [SYM]: sharedFn };
}

// Pattern 5: Add later with inline function
function addLaterInline() {
  const obj = {};
  obj[SYM] = function() {};
  return obj;
}

// Benchmark function
function benchWithCall(createFn, n) {
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

  const t1 = benchWithCall(methodDefinition, n);
  const t2 = benchWithCall(propertyAssignInline, n);
  const t3 = benchWithCall(propertyAssignLocal, n);
  const t4 = benchWithCall(propertyAssignShared, n);
  const t5 = benchWithCall(addLaterInline, n);

  console.log(`  1. { [SYM]() {} }              ${t1.toFixed(2).padStart(8)}ms  (method definition)`);
  console.log(`  2. { [SYM]: function() {} }    ${t2.toFixed(2).padStart(8)}ms  (property + inline fn)`);
  console.log(`  3. const fn=...; { [SYM]: fn } ${t3.toFixed(2).padStart(8)}ms  (property + local fn)`);
  console.log(`  4. { [SYM]: sharedFn }         ${t4.toFixed(2).padStart(8)}ms  (property + shared fn)`);
  console.log(`  5. obj[SYM] = function(){}     ${t5.toFixed(2).padStart(8)}ms  (add-later + inline fn)`);

  console.log(`\n  Key comparison:`);
  console.log(`    Method def vs Property inline: ${(t1/t2).toFixed(1)}x`);
  console.log(`    Property inline vs local:      ${(t2/t3).toFixed(1)}x`);
  console.log(`    Property local vs shared:      ${(t3/t4).toFixed(1)}x`);
  console.log();
}

runAll(100_000, "100K");
runAll(1_000_000, "1M");
