# Linter 対応状況まとめ

## 概要

| ツール | カスタムルール | 自動修正 | 難易度 | 備考 |
|--------|---------------|---------|--------|------|
| **ESLint** | ✅ JS プラグイン | ✅ | 低 | 完成済み |
| **Oxlint** | ✅ JS プラグイン (ESLint 互換) | ✅ | 低 | ESLint プラグインがそのまま動く |
| **Biome** | ✅ GritQL プラグイン | ❌ (検出のみ) | 中 | パターンマッチのみ |
| **TypeScript** | ⚠️ transform API | ✅ | 高 | コンパイラプラグインとして実装 |
| **SWC** | ⚠️ Rust プラグイン | ✅ | 高 | WASM または Rust で実装 |
| **esbuild** | ❌ | - | - | プラグイン API にはルール機能なし |

---

## 1. ESLint (完成済み)

```javascript
// eslint-plugin-perf/rules/no-computed-property-method.js
module.exports = {
  meta: { fixable: "code" },
  create(context) {
    return {
      Property(node) {
        if (node.computed && isFunctionValue(node.value)) {
          context.report({ node, fix: ... });
        }
      }
    };
  }
};
```

**メリット**: 最も広く使われている、ドキュメント豊富
**デメリット**: 速度が遅い（大規模プロジェクトで問題）

---

## 2. Oxlint (ESLint 互換)

Oxlint は **ESLint 互換の JS プラグイン** をサポート！

```json
// .oxlintrc.json
{
  "jsPlugins": ["./eslint-plugin-perf/index.js"],
  "rules": {
    "perf/no-computed-property-method": "warn"
  }
}
```

**メリット**: 
- ESLint プラグインがそのまま動く
- 50-100x 高速
- 既存の eslint-plugin-perf がそのまま使える

**デメリット**: 
- JS プラグインはまだ Technical Preview

---

## 3. Biome (GritQL)

Biome は **GritQL** でパターンマッチが書ける。

```grit
// no-computed-method.grit
language js

`{ $$$props }` where {
  $props <: contains `[$_]($$$) { $$$ }`,
  register_diagnostic(
    span = $props,
    message = "Avoid computed property method",
    severity = "warning"
  )
}
```

```json
// biome.json
{
  "plugins": ["./no-computed-method.grit"]
}
```

**現状**: 
- 単純なパターン（`Symbol.dispose` の検出など）は動作確認済み
- 複雑なパターンマッチはまだ GritQL サポートが発展途上
- **自動修正(fix)は未対応**（検出のみ）

**メリット**: 
- 宣言的なパターンマッチ
- Rust ベースで高速

**デメリット**: 
- 複雑なパターンは難しい
- 自動修正なし

---

## 4. TypeScript Compiler Plugin

コンパイル時に AST を変換する方法。

```typescript
// transformer.ts
import * as ts from 'typescript';

export default function transformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  return (context) => (sourceFile) => {
    function visit(node: ts.Node): ts.Node {
      if (ts.isObjectLiteralExpression(node)) {
        // computed property を検出して変換
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(sourceFile, visit) as ts.SourceFile;
  };
}
```

**メリット**: 
- 型情報にアクセスできる
- コンパイル時に自動変換

**デメリット**: 
- 設定が複雑 (ttypescript や ts-patch が必要)
- TypeScript のみ

---

## 5. SWC Plugin

Rust または WASM でプラグインを書く。

```rust
// src/lib.rs
use swc_core::ecma::{
    ast::*,
    visit::{VisitMut, VisitMutWith},
};

pub struct TransformVisitor;

impl VisitMut for TransformVisitor {
    fn visit_mut_object_lit(&mut self, obj: &mut ObjectLit) {
        // computed property を変換
    }
}
```

**メリット**: 
- 非常に高速
- esbuild, Vite, Next.js などで使える

**デメリット**: 
- Rust の知識が必要
- WASM ビルドが複雑

---

## 推奨アプローチ

### 短期（今すぐ）

1. **ESLint プラグイン** を公開 → 既存ユーザーが使える
2. **Oxlint** でも動作確認 → 高速な代替

### 中期

3. **Biome GritQL** でも検出ルールを追加（fix なし）
4. **V8/JSC** にバグ報告

### 長期

5. **V8/JSC のプリプロセス** として提案
6. または **Babel/SWC プラグイン** で自動変換

---

## 実装優先度

| 優先度 | ツール | 理由 |
|--------|--------|------|
| 1 | ESLint | 最も普及、既に完成 |
| 2 | Oxlint | ESLint プラグインがそのまま動く |
| 3 | Biome (GritQL) | 検出のみだが簡単に追加可能 |
| 4 | V8/JSC への報告 | 根本解決 |
| 5 | SWC/Babel | ビルド時変換が必要なら |
