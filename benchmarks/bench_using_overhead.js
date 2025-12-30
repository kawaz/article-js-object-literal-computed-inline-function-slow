// V8 vs JSC using syntax behavior comparison
// Discovery: JSC has overhead for using syntax itself

console.log("=== V8 vs JSC: using syntax detailed comparison ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol.dispose;

class Lock {
  [SYM]() {}
}

function createLiteral() {
  return { [SYM]() {} };
}

// Shared function pattern
const sharedDispose = () => {};
function createShared() {
  return { [SYM]: sharedDispose };
}

const N = 100000;

// ========================================
// Benchmark functions
// ========================================

function benchUsingClass() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    using obj = new Lock();
  }
  return performance.now() - start;
}

function benchTryFinallyClass() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = new Lock();
    try {} finally { obj[SYM](); }
  }
  return performance.now() - start;
}

function benchSimpleClass() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = new Lock();
    obj[SYM]();
  }
  return performance.now() - start;
}

function benchUsingLiteral() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    using obj = createLiteral();
  }
  return performance.now() - start;
}

function benchTryFinallyLiteral() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = createLiteral();
    try {} finally { obj[SYM](); }
  }
  return performance.now() - start;
}

function benchSimpleLiteral() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = createLiteral();
    obj[SYM]();
  }
  return performance.now() - start;
}

function benchUsingShared() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    using obj = createShared();
  }
  return performance.now() - start;
}

function benchSimpleShared() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = createShared();
    obj[SYM]();
  }
  return performance.now() - start;
}

// Warmup
for (let i = 0; i < 5; i++) {
  benchUsingClass();
  benchTryFinallyClass();
  benchSimpleClass();
  benchUsingLiteral();
  benchTryFinallyLiteral();
  benchSimpleLiteral();
  benchUsingShared();
  benchSimpleShared();
}

// ========================================
// Results output
// ========================================

console.log("=== class ===");
console.log(`  using:       ${benchUsingClass().toFixed(2)}ms`);
console.log(`  try-finally: ${benchTryFinallyClass().toFixed(2)}ms`);
console.log(`  simple:      ${benchSimpleClass().toFixed(2)}ms`);

console.log("\n=== literal (computed + method) ===");
console.log(`  using:       ${benchUsingLiteral().toFixed(2)}ms`);
console.log(`  try-finally: ${benchTryFinallyLiteral().toFixed(2)}ms`);
console.log(`  simple:      ${benchSimpleLiteral().toFixed(2)}ms`);

console.log("\n=== literal (shared function) ===");
console.log(`  using:       ${benchUsingShared().toFixed(2)}ms`);
console.log(`  simple:      ${benchSimpleShared().toFixed(2)}ms`);

// Calculate using overhead
console.log("\n\n=== using overhead ===");
const classUsing = benchUsingClass();
const classSimple = benchSimpleClass();
const literalUsing = benchUsingLiteral();
const literalSimple = benchSimpleLiteral();
const sharedUsing = benchUsingShared();
const sharedSimple = benchSimpleShared();

console.log(`  class:   using - simple = ${(classUsing - classSimple).toFixed(2)}ms`);
console.log(`  literal: using - simple = ${(literalUsing - literalSimple).toFixed(2)}ms`);
console.log(`  shared:  using - simple = ${(sharedUsing - sharedSimple).toFixed(2)}ms`);

// ========================================
// Measuring pure using overhead
// ========================================

console.log("\n\n=== Pure using overhead ===");

// Empty dispose
class EmptyLock {
  [SYM]() {}
}

function benchUsingEmpty() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    using obj = new EmptyLock();
  }
  return performance.now() - start;
}

function benchNoUsing() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = new EmptyLock();
  }
  return performance.now() - start;
}

// Pattern without calling dispose
function benchCreateOnly() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    new EmptyLock();
  }
  return performance.now() - start;
}

for (let i = 0; i < 5; i++) {
  benchUsingEmpty();
  benchNoUsing();
  benchCreateOnly();
}

const usingEmpty = benchUsingEmpty();
const noUsing = benchNoUsing();
const createOnly = benchCreateOnly();

console.log(`  using obj = new EmptyLock():  ${usingEmpty.toFixed(2)}ms`);
console.log(`  const obj = new EmptyLock():  ${noUsing.toFixed(2)}ms`);
console.log(`  new EmptyLock() (unused):     ${createOnly.toFixed(2)}ms`);
console.log(`  -> using syntax overhead: ${(usingEmpty - noUsing).toFixed(2)}ms (${N} iterations)`);
console.log(`  -> per call: ${((usingEmpty - noUsing) / N * 1000000).toFixed(2)}ns`);
