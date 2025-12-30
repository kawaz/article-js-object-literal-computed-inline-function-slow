// JSC (Bun) で V8 と異なる挙動を示す部分の深掘り検証

console.log("=== JSC 特有の挙動を深掘り ===\n");

const SYM = Symbol("dispose");

// ========================================
// 検証3: function / arrow / method の違い
// V8 では大差なし、JSC では差がある
// ========================================

console.log("=== 検証3再現: function vs arrow vs method ===\n");

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

// 生成のみ
console.log("【生成コストのみ】");
const r1 = bench("computed + function", () => ({ [SYM]: function() {} }));
const r2 = bench("computed + arrow", () => ({ [SYM]: () => {} }));
const r3 = bench("computed + method", () => ({ [SYM]() {} }));
console.log(`  function: ${r1.toFixed(2)}ms`);
console.log(`  arrow:    ${r2.toFixed(2)}ms`);
console.log(`  method:   ${r3.toFixed(2)}ms`);

// 生成 + 呼び出し
console.log("\n【生成 + 呼び出し】");
const c1 = benchCreateAndCall("", () => ({ [SYM]: function() {} }), SYM);
const c2 = benchCreateAndCall("", () => ({ [SYM]: () => {} }), SYM);
const c3 = benchCreateAndCall("", () => ({ [SYM]() {} }), SYM);
console.log(`  function: ${c1.toFixed(2)}ms`);
console.log(`  arrow:    ${c2.toFixed(2)}ms`);
console.log(`  method:   ${c3.toFixed(2)}ms`);

// ========================================
// 検証8: using vs try-finally vs simple
// V8 では大差なし、JSC (Bun) では class + using が謎に遅い
// ========================================

console.log("\n\n=== 検証8再現: using vs try-finally ===\n");

class Lock {
  [SYM]() {}
}

function createLiteral() {
  return { [SYM]() {} };
}

// using が使えるか確認
const hasUsing = (() => {
  try {
    eval('{ using x = { [Symbol.dispose]() {} }; }');
    return true;
  } catch { return false; }
})();

console.log(`using 構文サポート: ${hasUsing}`);

if (hasUsing) {
  // using 構文
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
  
  // ウォームアップ
  usingLiteral(1000);
  usingClass(1000);
  tryFinallyLiteral(1000);
  tryFinallyClass(1000);
  simpleLiteral(1000);
  simpleClass(1000);

  console.log("\n【literal (computed + method)】");
  console.log(`  using:       ${usingLiteral(N).toFixed(2)}ms`);
  console.log(`  try-finally: ${tryFinallyLiteral(N).toFixed(2)}ms`);
  console.log(`  simple:      ${simpleLiteral(N).toFixed(2)}ms`);

  console.log("\n【class】");
  console.log(`  using:       ${usingClass(N).toFixed(2)}ms`);
  console.log(`  try-finally: ${tryFinallyClass(N).toFixed(2)}ms`);
  console.log(`  simple:      ${simpleClass(N).toFixed(2)}ms`);

  // 複数回実行して安定性確認
  console.log("\n\n=== 複数回実行で安定性確認 ===\n");
  
  console.log("class + using (5回):");
  for (let run = 0; run < 5; run++) {
    console.log(`  Run ${run + 1}: ${usingClass(N).toFixed(2)}ms`);
  }

  console.log("\nclass + simple (5回):");
  for (let run = 0; run < 5; run++) {
    console.log(`  Run ${run + 1}: ${simpleClass(N).toFixed(2)}ms`);
  }
}

// ========================================
// 追加検証: JSC の method 定義の内部表現の違い?
// ========================================

console.log("\n\n=== 追加: method 構文の内部的な違いを探る ===\n");

// method と function で生成される関数の違いを確認
const objMethod = { foo() {} };
const objFunction = { foo: function() {} };
const objArrow = { foo: () => {} };
const objNamed = { foo: function foo() {} };

console.log("関数の toString():");
console.log(`  method:   ${objMethod.foo.toString().slice(0, 30)}...`);
console.log(`  function: ${objFunction.foo.toString().slice(0, 30)}...`);
console.log(`  arrow:    ${objArrow.foo.toString().slice(0, 30)}...`);
console.log(`  named:    ${objNamed.foo.toString().slice(0, 30)}...`);

console.log("\n関数の name プロパティ:");
console.log(`  method:   "${objMethod.foo.name}"`);
console.log(`  function: "${objFunction.foo.name}"`);
console.log(`  arrow:    "${objArrow.foo.name}"`);
console.log(`  named:    "${objNamed.foo.name}"`);

console.log("\n関数の prototype:");
console.log(`  method:   ${objMethod.foo.prototype}`);
console.log(`  function: ${objFunction.foo.prototype}`);
console.log(`  arrow:    ${objArrow.foo.prototype}`);

// prototype の有無でパフォーマンスが変わる?
console.log("\n\n=== prototype の有無とパフォーマンス ===\n");

const r4 = bench("arrow (no prototype)", () => ({ [SYM]: () => {} }));
const r5 = bench("function (has prototype)", () => ({ [SYM]: function() {} }));
const r6 = bench("method (no prototype)", () => ({ [SYM]() {} }));

console.log(`  arrow (no prototype):      ${r4.toFixed(2)}ms`);
console.log(`  function (has prototype):  ${r5.toFixed(2)}ms`);
console.log(`  method (no prototype):     ${r6.toFixed(2)}ms`);

// 静的キーでも同じ傾向?
console.log("\n【静的キーの場合】");
const s1 = bench("static + function", () => ({ foo: function() {} }));
const s2 = bench("static + arrow", () => ({ foo: () => {} }));
const s3 = bench("static + method", () => ({ foo() {} }));
console.log(`  function: ${s1.toFixed(2)}ms`);
console.log(`  arrow:    ${s2.toFixed(2)}ms`);
console.log(`  method:   ${s3.toFixed(2)}ms`);
