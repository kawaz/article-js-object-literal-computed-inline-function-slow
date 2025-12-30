// JSC での function vs arrow vs method の詳細検証

console.log("=== function vs arrow vs method 詳細検証 ===\n");
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun (JSC)' : 'Node (V8)'}\n`);

const SYM = Symbol("test");
const N = 100000;

function bench(name, fn) {
  // ウォームアップ
  for (let i = 0; i < 1000; i++) fn();
  
  const start = performance.now();
  for (let i = 0; i < N; i++) fn();
  return performance.now() - start;
}

function benchCall(name, createFn, key) {
  // ウォームアップ
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
// 生成コスト
// ========================================

console.log("=== 生成コストのみ ===\n");

console.log("【computed key (Symbol)】");
const c1 = bench("", () => ({ [SYM]: function() {} }));
const c2 = bench("", () => ({ [SYM]: () => {} }));
const c3 = bench("", () => ({ [SYM]() {} }));
console.log(`  function: ${c1.toFixed(2)}ms`);
console.log(`  arrow:    ${c2.toFixed(2)}ms`);
console.log(`  method:   ${c3.toFixed(2)}ms`);

console.log("\n【static key】");
const s1 = bench("", () => ({ foo: function() {} }));
const s2 = bench("", () => ({ foo: () => {} }));
const s3 = bench("", () => ({ foo() {} }));
console.log(`  function: ${s1.toFixed(2)}ms`);
console.log(`  arrow:    ${s2.toFixed(2)}ms`);
console.log(`  method:   ${s3.toFixed(2)}ms`);

// ========================================
// 生成 + 呼び出しコスト
// ========================================

console.log("\n\n=== 生成 + 呼び出しコスト ===\n");

console.log("【computed key (Symbol)】");
const cc1 = benchCall("", () => ({ [SYM]: function() {} }), SYM);
const cc2 = benchCall("", () => ({ [SYM]: () => {} }), SYM);
const cc3 = benchCall("", () => ({ [SYM]() {} }), SYM);
console.log(`  function: ${cc1.toFixed(2)}ms`);
console.log(`  arrow:    ${cc2.toFixed(2)}ms`);
console.log(`  method:   ${cc3.toFixed(2)}ms`);

console.log("\n【static key】");
const sc1 = benchCall("", () => ({ foo: function() {} }), 'foo');
const sc2 = benchCall("", () => ({ foo: () => {} }), 'foo');
const sc3 = benchCall("", () => ({ foo() {} }), 'foo');
console.log(`  function: ${sc1.toFixed(2)}ms`);
console.log(`  arrow:    ${sc2.toFixed(2)}ms`);
console.log(`  method:   ${sc3.toFixed(2)}ms`);

// ========================================
// 関数の特性による違いを探る
// ========================================

console.log("\n\n=== 関数の特性 ===\n");

// prototype の有無
const objF = { [SYM]: function() {} };
const objA = { [SYM]: () => {} };
const objM = { [SYM]() {} };

console.log("prototype の有無:");
console.log(`  function: ${objF[SYM].prototype !== undefined}`);
console.log(`  arrow:    ${objA[SYM].prototype !== undefined}`);
console.log(`  method:   ${objM[SYM].prototype !== undefined}`);

// constructor として使えるか
console.log("\nconstructor として使えるか:");
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
// prototype 生成コストの影響?
// ========================================

console.log("\n\n=== prototype 生成コストの検証 ===\n");

// prototype を持つ function を大量生成
const pf1 = bench("function (prototype あり)", () => {
  return function() {};
});

// prototype を持たない arrow を大量生成
const pf2 = bench("arrow (prototype なし)", () => {
  return () => {};
});

console.log(`  function (prototype あり): ${pf1.toFixed(2)}ms`);
console.log(`  arrow (prototype なし):    ${pf2.toFixed(2)}ms`);
console.log(`  差分: ${(pf1 - pf2).toFixed(2)}ms`);

// ========================================
// this バインディングの影響?
// ========================================

console.log("\n\n=== this バインディングの検証 ===\n");

// arrow は this をキャプチャする
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
// 複数回実行で安定性確認
// ========================================

console.log("\n\n=== 複数回実行 (3回平均) ===\n");

function avgBench(name, fn, runs = 3) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(bench("", fn));
  }
  return results.reduce((a, b) => a + b, 0) / runs;
}

console.log("【computed key 生成コスト】");
console.log(`  function: ${avgBench("", () => ({ [SYM]: function() {} })).toFixed(2)}ms`);
console.log(`  arrow:    ${avgBench("", () => ({ [SYM]: () => {} })).toFixed(2)}ms`);
console.log(`  method:   ${avgBench("", () => ({ [SYM]() {} })).toFixed(2)}ms`);
