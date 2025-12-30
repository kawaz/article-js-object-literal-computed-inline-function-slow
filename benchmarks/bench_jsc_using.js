// JSC (Bun) での using 構文の挙動を直接検証

console.log("=== JSC (Bun) using 構文の詳細検証 ===\n");

const SYM = Symbol.dispose;

class Lock {
  [SYM]() {}
}

function createLiteral() {
  return { [SYM]() {} };
}

const N = 100000;

// ========================================
// using vs try-finally vs simple
// ========================================

function benchUsingLiteral() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    using obj = createLiteral();
  }
  return performance.now() - start;
}

function benchUsingClass() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    using obj = new Lock();
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

function benchTryFinallyClass() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = new Lock();
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

function benchSimpleClass() {
  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const obj = new Lock();
    obj[SYM]();
  }
  return performance.now() - start;
}

// ウォームアップ
for (let i = 0; i < 3; i++) {
  benchUsingLiteral();
  benchUsingClass();
  benchTryFinallyLiteral();
  benchTryFinallyClass();
  benchSimpleLiteral();
  benchSimpleClass();
}

console.log("【literal (computed + method)】");
console.log(`  using:       ${benchUsingLiteral().toFixed(2)}ms`);
console.log(`  try-finally: ${benchTryFinallyLiteral().toFixed(2)}ms`);
console.log(`  simple:      ${benchSimpleLiteral().toFixed(2)}ms`);

console.log("\n【class】");
console.log(`  using:       ${benchUsingClass().toFixed(2)}ms`);
console.log(`  try-finally: ${benchTryFinallyClass().toFixed(2)}ms`);
console.log(`  simple:      ${benchSimpleClass().toFixed(2)}ms`);

// 複数回実行
console.log("\n\n=== 複数回実行 (5回) ===\n");

console.log("class + using:");
for (let run = 0; run < 5; run++) {
  console.log(`  Run ${run + 1}: ${benchUsingClass().toFixed(2)}ms`);
}

console.log("\nclass + try-finally:");
for (let run = 0; run < 5; run++) {
  console.log(`  Run ${run + 1}: ${benchTryFinallyClass().toFixed(2)}ms`);
}

console.log("\nclass + simple:");
for (let run = 0; run < 5; run++) {
  console.log(`  Run ${run + 1}: ${benchSimpleClass().toFixed(2)}ms`);
}

console.log("\nliteral + using:");
for (let run = 0; run < 5; run++) {
  console.log(`  Run ${run + 1}: ${benchUsingLiteral().toFixed(2)}ms`);
}

// ========================================
// using の実装詳細を探る
// ========================================

console.log("\n\n=== using の内部実装を探る ===\n");

// using が生成するコードの挙動を確認
let disposeCount = 0;
let disposeOrder = [];

class TrackedLock {
  constructor(id) {
    this.id = id;
  }
  [SYM]() {
    disposeCount++;
    disposeOrder.push(this.id);
  }
}

{
  using a = new TrackedLock('a');
  using b = new TrackedLock('b');
  using c = new TrackedLock('c');
}

console.log(`Dispose count: ${disposeCount}`);
console.log(`Dispose order: ${disposeOrder.join(' -> ')}`);
console.log("(Expected: c -> b -> a, LIFO order)");

// null/undefined の扱い
disposeCount = 0;
try {
  using x = null;
  using y = undefined;
  console.log("\nnull/undefined は dispose されない (正常)");
} catch (e) {
  console.log(`\nnull/undefined でエラー: ${e.message}`);
}
console.log(`Dispose count after null/undefined: ${disposeCount}`);
