/**
 * ESLint Rule: no-computed-property-method
 * 
 * オブジェクトリテラル内の computed property に関数を定義するパターンを検出し、
 * 後付けパターンに自動修正する。
 * 
 * ❌ Bad (遅い - ~10x slower):
 *   const obj = { [Symbol.dispose]() {} };
 *   const obj = { [key]: function() {} };
 *   const obj = { [key]: () => {} };
 * 
 * ✅ Good (速い):
 *   const obj = {}; obj[Symbol.dispose] = function() {};
 *   class Obj { [Symbol.dispose]() {} }
 */

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow function definitions in computed properties of object literals due to V8/JSC deoptimization",
      category: "Performance",
      recommended: false,
    },
    fixable: "code",
    schema: [],
    messages: {
      avoidComputedMethod: 
        "Avoid defining functions in computed properties of object literals. " +
        "This causes ~10x performance degradation due to JIT deoptimization. " +
        "Use property assignment after object creation, or use a class instead.",
    }
  },

  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();

    /**
     * 値が関数定義かどうかを判定
     */
    function isFunctionDefinition(node) {
      return (
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      );
    }

    /**
     * プロパティがメソッド shorthand かどうか
     */
    function isMethodShorthand(property) {
      return property.method === true;
    }

    /**
     * 変数宣言の親を取得
     */
    function getVariableDeclarator(node) {
      let current = node.parent;
      while (current) {
        if (current.type === "VariableDeclarator") {
          return current;
        }
        current = current.parent;
      }
      return null;
    }

    /**
     * 自動修正を生成
     */
    function createFix(fixer, objectNode, property) {
      const declarator = getVariableDeclarator(objectNode);
      
      // 単純な変数宣言でない場合は自動修正しない
      if (!declarator || declarator.id.type !== "Identifier") {
        return null;
      }
      
      const varName = declarator.id.name;
      const keyText = sourceCode.getText(property.key);
      
      // 関数の本体を取得
      let funcText;
      if (isMethodShorthand(property)) {
        // method() {} → function() {}
        const params = property.value.params.map(p => sourceCode.getText(p)).join(", ");
        const body = sourceCode.getText(property.value.body);
        const async = property.value.async ? "async " : "";
        const generator = property.value.generator ? "*" : "";
        funcText = `${async}function${generator}(${params}) ${body}`;
      } else {
        funcText = sourceCode.getText(property.value);
      }
      
      // 他のプロパティ
      const otherProps = objectNode.properties.filter(p => p !== property);
      
      // 宣言文全体
      const declaration = declarator.parent;
      const declarationEnd = declaration.range[1];
      
      const fixes = [];
      
      if (otherProps.length === 0) {
        // 他のプロパティがない場合: {} に置き換え
        fixes.push(fixer.replaceText(objectNode, "{}"));
      } else {
        // computed property を除去
        const propIndex = objectNode.properties.indexOf(property);
        const isLast = propIndex === objectNode.properties.length - 1;
        const isFirst = propIndex === 0;
        
        if (isLast && propIndex > 0) {
          // 最後のプロパティ: 前のカンマから除去
          const prevProp = objectNode.properties[propIndex - 1];
          fixes.push(fixer.removeRange([prevProp.range[1], property.range[1]]));
        } else if (isFirst && otherProps.length > 0) {
          // 最初のプロパティ: 次のプロパティの前まで除去
          const nextProp = objectNode.properties[propIndex + 1];
          fixes.push(fixer.removeRange([property.range[0], nextProp.range[0]]));
        } else {
          // 中間のプロパティ
          const nextProp = objectNode.properties[propIndex + 1];
          fixes.push(fixer.removeRange([property.range[0], nextProp.range[0]]));
        }
      }
      
      // 後付けステートメントを追加
      fixes.push(
        fixer.insertTextAfterRange(
          [declarationEnd, declarationEnd],
          ` ${varName}[${keyText}] = ${funcText};`
        )
      );
      
      return fixes;
    }

    return {
      Property(node) {
        // computed property でない場合はスキップ
        if (!node.computed) {
          return;
        }
        
        // 親が ObjectExpression でない場合はスキップ
        if (node.parent.type !== "ObjectExpression") {
          return;
        }
        
        // 値が関数定義またはメソッド shorthand の場合
        if (isFunctionDefinition(node.value) || isMethodShorthand(node)) {
          context.report({
            node,
            messageId: "avoidComputedMethod",
            fix(fixer) {
              return createFix(fixer, node.parent, node);
            }
          });
        }
      }
    };
  }
};
